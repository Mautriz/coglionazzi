import { describe, expect, it } from "vitest";
import {
  fileServeHeaders,
  normalizeFileType,
  storageExtension,
} from "./files";

describe("normalizeFileType", () => {
  it("keeps a well-formed declared type", () => {
    expect(normalizeFileType("data.csv", "text/csv")).toBe("text/csv");
    expect(normalizeFileType("a.txt", "text/plain; charset=utf-8")).toBe(
      "text/plain",
    );
  });

  it("falls back to the filename when the browser sends no type", () => {
    expect(normalizeFileType("sheet.csv", "")).toBe("text/csv");
    expect(normalizeFileType("page.html", "   ")).toBe("text/html");
  });

  it("rejects junk (it ends up in a response header)", () => {
    expect(normalizeFileType("mystery.qqq", "not a mime type")).toBe(
      "application/octet-stream",
    );
    expect(normalizeFileType("x.qqq", "text/html\r\nX-Evil: 1")).toBe(
      "application/octet-stream",
    );
  });
});

describe("storageExtension", () => {
  it("prefers the uploaded name's extension, lowercased", () => {
    expect(storageExtension("REPORT.CSV", "text/csv")).toBe("csv");
    expect(storageExtension("weird.dat", "application/octet-stream")).toBe(
      "dat",
    );
  });

  it("falls back to the mime type, then to bin", () => {
    expect(storageExtension("noextension", "image/png")).toBe("png");
    expect(storageExtension("noextension", "application/octet-stream")).toBe(
      "bin",
    );
  });

  it("never lets a name smuggle a path segment into the id", () => {
    expect(storageExtension("evil.../../etc/passwd", "text/plain")).toBe("txt");
    expect(storageExtension("long.abcdefghijklmnop", "text/plain")).toBe("txt");
  });
});

describe("fileServeHeaders", () => {
  it("serves safe media inline with its real type", () => {
    const h = fileServeHeaders({ name: "cat.webp", type: "image/webp" });
    expect(h["Content-Type"]).toBe("image/webp");
    expect(h["Content-Disposition"]).toMatch(/^inline; filename="cat.webp"/);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Security-Policy"]).toBeUndefined();
  });

  it("keeps SVG inline (it must render in <img>) but sandboxes it", () => {
    const h = fileServeHeaders({ name: "logo.svg", type: "image/svg+xml" });
    expect(h["Content-Type"]).toBe("image/svg+xml");
    expect(h["Content-Disposition"]).toMatch(/^inline;/);
    expect(h["Content-Security-Policy"]).toBe("sandbox");
  });

  it("forces every other type to download as an opaque stream", () => {
    for (const [name, type] of [
      ["evil.html", "text/html"],
      ["sheet.csv", "text/csv"],
      ["notes.txt", "text/plain"],
      ["bundle.zip", "application/zip"],
    ]) {
      const h = fileServeHeaders({ name, type });
      expect(h["Content-Type"]).toBe("application/octet-stream");
      expect(h["Content-Disposition"]).toMatch(
        new RegExp(`^attachment; filename="${name}"`),
      );
      expect(h["Content-Security-Policy"]).toBe("sandbox");
    }
  });

  it("encodes a non-ASCII name and can't break out of the header", () => {
    // Control chars are dropped, quotes neutralized, and the real name is
    // carried by the RFC 5987 form.
    const h = fileServeHeaders({
      name: 'r\u00e9"sum\u00e9\r\nX-Evil: 1.pdf',
      type: "application/pdf",
    });
    const cleaned = 'r\u00e9_sum\u00e9X-Evil: 1.pdf';
    expect(h["Content-Disposition"]).toBe(
      `inline; filename="r__sum_X-Evil: 1.pdf"; filename*=UTF-8''${encodeURIComponent(cleaned)}`,
    );
  });

  it("never yields an empty filename", () => {
    const h = fileServeHeaders({ name: "   ", type: "text/csv" });
    expect(h["Content-Disposition"]).toMatch(/filename="download"/);
  });
});
