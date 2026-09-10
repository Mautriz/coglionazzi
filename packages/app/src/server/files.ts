import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
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

const FALLBACK_TYPE = "application/octet-stream";

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

/** Any file type is accepted, so the browser-declared type is untrusted input:
 *  it ends up in a response header (see fileServeHeaders). Keep only
 *  well-formed `type/subtype` values, fall back to the name's extension. */
export function normalizeFileType(name: string, declared: string): string {
  const candidate = declared.trim().split(";")[0].trim().toLowerCase();
  if (/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(candidate)) {
    return candidate;
  }
  return mime.getType(name) ?? FALLBACK_TYPE;
}

/** Extension for the on-disk id. The uploaded name wins (it survives types we
 *  don't know), the mime type is the fallback — both sanitized, since the id
 *  is used as a path segment. */
export function storageExtension(name: string, type: string): string {
  const dot = name.lastIndexOf(".");
  const fromName = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (/^[a-z0-9]{1,12}$/.test(fromName)) return fromName;
  return mime.getExtension(type) ?? "bin";
}

/** Header-safe filename: no CR/LF, quotes or path separators. */
function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/["\\/]/g, "_")
    .trim();
  return cleaned || "download";
}

/** RFC 6266 / 5987 disposition: ASCII fallback + UTF-8 filename. */
function contentDisposition(
  kind: "inline" | "attachment",
  name: string,
): string {
  const safe = safeFilename(name);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/** Types the browser can render without executing anything of the uploader's:
 *  raster images, audio, video, PDF. NOT svg/html/xml/… — those are scriptable
 *  and we serve every upload from the app's own origin. */
function isInlineSafe(type: string): boolean {
  if (type === "image/svg+xml") return false;
  return (
    type === "application/pdf" ||
    type.startsWith("image/") ||
    type.startsWith("audio/") ||
    type.startsWith("video/")
  );
}

/** Response headers for serving a stored file. Anything scriptable is either
 *  sandboxed (SVG, which must stay inline to render in <img>) or forced to
 *  download as an opaque octet-stream — an uploaded .html served inline on our
 *  origin would be stored XSS with access to the session cookie. */
export function fileServeHeaders(
  metadata: Pick<FileMetadata, "name" | "type">,
): Record<string, string> {
  const type = normalizeFileType(metadata.name, metadata.type);
  const headers: Record<string, string> = {
    // Never let the browser sniff a type we didn't send.
    "X-Content-Type-Options": "nosniff",
  };

  if (isInlineSafe(type)) {
    headers["Content-Type"] = type;
    headers["Content-Disposition"] = contentDisposition(
      "inline",
      metadata.name,
    );
    return headers;
  }

  // `sandbox` (no allow-scripts) neuters scripts + gives an opaque origin if
  // the file is ever navigated to directly.
  headers["Content-Security-Policy"] = "sandbox";

  if (type === "image/svg+xml") {
    headers["Content-Type"] = type;
    headers["Content-Disposition"] = contentDisposition(
      "inline",
      metadata.name,
    );
    return headers;
  }

  headers["Content-Type"] = FALLBACK_TYPE;
  headers["Content-Disposition"] = contentDisposition(
    "attachment",
    metadata.name,
  );
  return headers;
}

/** Disk-backed file storage. File ids are `<uuid>.<ext>` so they're safe to
 *  use directly as path segments; the type/name served back come from the
 *  recorded metadata (see routes/api/files.ts). */
class FileService {
  constructor(private basePath: string) {}

  getFilePath(fileId: string): string {
    const base = resolve(this.basePath);
    const filePath = resolve(base, fileId);
    // Guard against path traversal — the resolved file must stay inside
    // the storage directory (trailing separator so `imagesX` isn't a match).
    if (!filePath.startsWith(base + sep)) {
      throw new Error("Invalid file id");
    }
    return filePath;
  }

  async exists(fileId: string): Promise<boolean> {
    try {
      return (await stat(this.getFilePath(fileId))).isFile();
    } catch {
      return false;
    }
  }

  getFileStream(fileId: string): ReadableStream {
    const nodeStream = createReadStream(this.getFilePath(fileId));
    return Readable.toWeb(nodeStream) as ReadableStream;
  }

  /** Persist an upload, optimizing raster images first (downscale + WebP).
   *  Every file type is accepted. Returns the storage id plus the metadata of
   *  what was ACTUALLY stored (type/size/name change when an image is
   *  optimized). */
  async addFile(file: File): Promise<{ fileId: string; metadata: FileMetadata }> {
    await mkdir(this.basePath, { recursive: true });

    const original = Buffer.from(await file.arrayBuffer());
    let bytes: Uint8Array = original;
    let type = normalizeFileType(file.name, file.type);
    let name = file.name;

    if (OPTIMIZABLE_IMAGE_TYPES.has(type)) {
      try {
        bytes = await optimizeImage(original);
        type = "image/webp";
        name = swapExtension(file.name, "webp");
      } catch {
        // Not a decodable image (corrupt / mislabeled) — store the original.
        bytes = original;
        type = normalizeFileType(file.name, file.type);
        name = file.name;
      }
    }

    const fileId = `${randomUUID()}.${storageExtension(name, type)}`;
    await writeFile(this.getFilePath(fileId), bytes);

    return { fileId, metadata: { name, type, size: bytes.length } };
  }

  /** The whole file as bytes. Used by the MCP `get_attachment` tool, which
   *  inlines small files into a tool result rather than linking to them. */
  async readFile(fileId: string): Promise<Buffer> {
    return readFile(this.getFilePath(fileId));
  }

  /** Remove the bytes for a storage id. Idempotent — a missing file is
   *  already the desired state (see `deleteFileIfUnreferenced`, which unlinks
   *  after committing the row delete). */
  async deleteFile(fileId: string): Promise<void> {
    try {
      await unlink(this.getFilePath(fileId));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }
}

export const fileService = new FileService(
  process.env.IMAGES_PATH ?? "./data/images",
);
