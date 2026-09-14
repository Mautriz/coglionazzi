import { describe, expect, it } from "vitest";
import { attachmentContent, looksLikeText } from "./attachment";

const file = (type: string, bytes: Uint8Array | string, name = "file") => ({
  name,
  type,
  uri: "https://insacco.test/api/files?fileId=abc",
  bytes: typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes,
});

describe("looksLikeText", () => {
  it("accepts UTF-8 text", () => {
    expect(looksLikeText(new TextEncoder().encode("ciao — è così"))).toBe(true);
  });

  it("rejects NUL bytes and invalid UTF-8", () => {
    expect(looksLikeText(new Uint8Array([104, 0, 105]))).toBe(false);
    expect(looksLikeText(new Uint8Array([0xff, 0xfe, 0xfd]))).toBe(false);
  });
});

describe("attachmentContent", () => {
  it("returns viewable images as image blocks", () => {
    const [block] = attachmentContent(file("image/png", new Uint8Array([1, 2, 3])));
    expect(block).toEqual({ type: "image", data: "AQID", mimeType: "image/png" });
  });

  it("returns text types as text", () => {
    expect(attachmentContent(file("text/markdown", "# spec"))).toEqual([
      { type: "text", text: "# spec" },
    ]);
    expect(attachmentContent(file("image/svg+xml", "<svg/>"))).toEqual([
      { type: "text", text: "<svg/>" },
    ]);
  });

  it("reads text even when it is labelled as something else", () => {
    expect(
      attachmentContent(file("application/octet-stream", "const x = 1;")),
    ).toEqual([{ type: "text", text: "const x = 1;" }]);
  });

  it("embeds any binary file as a base64 resource", () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
    const blocks = attachmentContent(file("application/pdf", bytes, "report.pdf"));

    expect(blocks[0]).toMatchObject({ type: "text" });
    expect((blocks[0] as { text: string }).text).toContain("report.pdf");
    expect(blocks[1]).toEqual({
      type: "resource",
      resource: {
        uri: "https://insacco.test/api/files?fileId=abc",
        mimeType: "application/pdf",
        blob: Buffer.from(bytes).toString("base64"),
      },
    });
  });

  it("sends images a model can't view as a resource, not an image block", () => {
    const blocks = attachmentContent(file("image/tiff", new Uint8Array([0, 1, 2])));
    expect(blocks.map((b) => b.type)).toEqual(["text", "resource"]);
  });

  it("does not return a mislabelled binary as text", () => {
    const blocks = attachmentContent(file("text/plain", new Uint8Array([0xff, 0, 1])));
    expect(blocks.map((b) => b.type)).toEqual(["text", "resource"]);
  });
});
