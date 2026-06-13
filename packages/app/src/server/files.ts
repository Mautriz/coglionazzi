import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";

import mime from "mime";
import sharp from "sharp";

/** Public URL an uploaded file is served from (routes/api/files.ts). */
export const fileUrl = (path: string) =>
  `/api/files?fileId=${encodeURIComponent(path)}`;

/** Shape of files.metadata (recorded at upload time). */
export type FileMetadata = { name: string; type: string; size: number };

/** Raster images we downscale + recompress on upload. SVG (vector) and GIF
 *  (animation) are left untouched. */
const OPTIMIZABLE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Longest-edge cap — ~1080p-class. We show every image at a modest size, so
 *  there's no point storing 8K originals. */
const MAX_IMAGE_EDGE = 1920;

function swapExtension(name: string, ext: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}.${ext}`;
}

/** Auto-orient (EXIF), downscale to fit MAX_IMAGE_EDGE without enlarging, strip
 *  metadata, and recompress to WebP. Throws if the input isn't a real image. */
async function optimizeImage(input: Uint8Array): Promise<Buffer> {
  return sharp(input, { failOn: "none" })
    .rotate()
    .resize({
      width: MAX_IMAGE_EDGE,
      height: MAX_IMAGE_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toBuffer();
}

/** Disk-backed file storage. File ids are `<uuid>.<ext>` so they're safe to
 *  use directly as path segments and the mime type can be re-derived when
 *  serving (see routes/api/files.ts). */
class FileService {
  constructor(private basePath: string) {}

  getFilePath(fileId: string): string {
    const filePath = resolve(this.basePath, fileId);
    // Guard against path traversal — the resolved file must stay inside
    // the storage directory.
    if (!filePath.startsWith(resolve(this.basePath))) {
      throw new Error("Invalid file id");
    }
    return filePath;
  }

  getFileStream(fileId: string): ReadableStream {
    const nodeStream = createReadStream(this.getFilePath(fileId));
    return Readable.toWeb(nodeStream) as ReadableStream;
  }

  /** Persist an upload, optimizing raster images first (downscale + WebP).
   *  Returns the storage id plus the metadata of what was ACTUALLY stored
   *  (type/size/name change when an image is optimized). */
  async addFile(file: File): Promise<{ fileId: string; metadata: FileMetadata }> {
    await mkdir(this.basePath, { recursive: true });

    let bytes: Uint8Array = Buffer.from(await file.arrayBuffer());
    let type = file.type;
    let name = file.name;

    if (OPTIMIZABLE_IMAGE_TYPES.has(file.type)) {
      try {
        bytes = await optimizeImage(bytes);
        type = "image/webp";
        name = swapExtension(file.name, "webp");
      } catch {
        // Not a decodable image (corrupt / mislabeled) — store the original.
        bytes = Buffer.from(await file.arrayBuffer());
        type = file.type;
        name = file.name;
      }
    }

    const fileId = `${randomUUID()}.${mime.getExtension(type) ?? "bin"}`;
    await writeFile(this.getFilePath(fileId), bytes);

    return { fileId, metadata: { name, type, size: bytes.length } };
  }
}

export const fileService = new FileService(
  process.env.IMAGES_PATH ?? "./data/images",
);
