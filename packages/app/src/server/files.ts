import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";

import mime from "mime";

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

  async addFile(file: File): Promise<string> {
    await mkdir(this.basePath, { recursive: true });

    const fileId = `${randomUUID()}.${mime.getExtension(file.type)}`;
    const filePath = this.getFilePath(fileId);

    const buffer = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

    return fileId;
  }
}

export const fileService = new FileService(
  process.env.IMAGES_PATH ?? "./data/images",
);
