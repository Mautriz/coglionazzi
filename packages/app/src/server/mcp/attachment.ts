/** How `get_attachment` turns a stored file into MCP content. Pure (bytes in,
 *  content blocks out) so every branch is unit-tested without a database. */

export type AttachmentContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | {
      type: "resource";
      resource: { uri: string; mimeType: string; blob: string };
    };

export interface AttachmentInput {
  name: string;
  type: string;
  /** Absolute URL of the file, used as the embedded resource's `uri`. */
  uri: string;
  bytes: Uint8Array;
}

/** The image formats a model can actually look at. Anything else labelled
 *  `image/*` (bmp, tiff, heic, …) would be rejected downstream, so it travels
 *  as a plain binary resource instead. */
const VIEWABLE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** True when the bytes are text: valid UTF-8 with no NUL bytes. Decided from
 *  the CONTENT, never the declared type — uploads often arrive labelled
 *  `application/octet-stream` (or, for `.ts`, `video/mp2t`) and a model should
 *  still get to read them, while a binary mislabelled `text/plain` must not
 *  arrive as mojibake. */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function attachmentContent(file: AttachmentInput): AttachmentContent[] {
  const bytes = Buffer.from(file.bytes);

  if (VIEWABLE_IMAGE_TYPES.has(file.type)) {
    return [{ type: "image", data: bytes.toString("base64"), mimeType: file.type }];
  }

  // SVG, source, markdown, CSV, JSON… whatever they were labelled.
  if (looksLikeText(bytes)) {
    return [{ type: "text", text: bytes.toString("utf8") }];
  }

  // Any other file: hand over the bytes themselves as an embedded resource,
  // with a line saying what they are so the model knows before decoding.
  return [
    {
      type: "text",
      text: `${file.name} (${file.type}, ${formatSize(bytes.length)}) — binary contents attached as a base64 resource.`,
    },
    {
      type: "resource",
      resource: {
        uri: file.uri,
        mimeType: file.type,
        blob: bytes.toString("base64"),
      },
    },
  ];
}
