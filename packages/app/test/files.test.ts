import { unlink } from "node:fs/promises";
import { call } from "@orpc/server";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { fileService } from "../src/server/files";
import { appRouter } from "../src/server/orpc/router";
import { signUpTestUser } from "./helpers";

describe("file uploads — image optimization", () => {
  it("downscales a huge image to <=1920px and recompresses to WebP", async () => {
    // A deliberately oversized (4000x3000) PNG.
    const huge = await sharp({
      create: {
        width: 4000,
        height: 3000,
        channels: 3,
        background: { r: 20, g: 120, b: 200 },
      },
    })
      .png()
      .toBuffer();

    const file = new File([new Uint8Array(huge)], "8k-monster.PNG", {
      type: "image/png",
    });
    const { fileId, metadata } = await fileService.addFile(file);

    try {
      // Stored as optimized WebP, smaller than the original, renamed.
      expect(metadata.type).toBe("image/webp");
      expect(metadata.name).toBe("8k-monster.webp");
      expect(metadata.size).toBeLessThan(huge.length);

      // Actually resized on disk: longest edge capped at 1920 (4000 -> 1920,
      // 3000 -> 1440), and a real WebP.
      const stored = await sharp(fileService.getFilePath(fileId)).metadata();
      expect(stored.format).toBe("webp");
      expect(stored.width).toBe(1920);
      expect(stored.height).toBe(1440);
    } finally {
      await unlink(fileService.getFilePath(fileId));
    }
  });

  it("leaves non-raster types (e.g. SVG) untouched", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
    );
    const file = new File([svg], "vector.svg", { type: "image/svg+xml" });
    const { fileId, metadata } = await fileService.addFile(file);

    try {
      expect(metadata.type).toBe("image/svg+xml");
      expect(metadata.name).toBe("vector.svg");
      expect(metadata.size).toBe(svg.length);
    } finally {
      await unlink(fileService.getFilePath(fileId));
    }
  });
});

describe("file uploads — arbitrary types", () => {
  /** Store `file`, run `check` on the result, always clean up the blob. */
  async function withStored(
    file: File,
    check: (stored: Awaited<ReturnType<typeof fileService.addFile>>) => void,
  ) {
    const stored = await fileService.addFile(file);
    try {
      check(stored);
    } finally {
      await unlink(fileService.getFilePath(stored.fileId));
    }
  }

  it("stores types we have no special handling for, untouched", async () => {
    const csv = Buffer.from("a,b\n1,2\n");
    await withStored(
      new File([csv], "report.CSV", { type: "text/csv" }),
      ({ fileId, metadata }) => {
        expect(metadata).toEqual({
          name: "report.CSV",
          type: "text/csv",
          size: csv.length,
        });
        expect(fileId).toMatch(/\.csv$/);
      },
    );
  });

  it("derives the type from the name when the browser sends none", async () => {
    await withStored(
      new File([Buffer.from("<p>hi</p>")], "page.html", { type: "" }),
      ({ fileId, metadata }) => {
        expect(metadata.type).toBe("text/html");
        expect(fileId).toMatch(/\.html$/);
      },
    );
  });

  it("falls back to octet-stream + .bin for an unknown, extension-less file", async () => {
    await withStored(
      new File([Buffer.from([0, 1, 2])], "mystery", { type: "" }),
      ({ fileId, metadata }) => {
        expect(metadata.type).toBe("application/octet-stream");
        expect(fileId).toMatch(/\.bin$/);
      },
    );
  });

  it("accepts any type through rpc.file.upload (no allowlist)", async () => {
    const { context } = await signUpTestUser("Uploader");

    for (const [name, type] of [
      ["data.csv", "text/csv"],
      ["page.html", "text/html"],
      ["thing.blend", ""],
    ]) {
      const uploaded = await call(
        appRouter.file.upload,
        { file: new File([Buffer.from("x")], name, { type }) },
        { context },
      );
      try {
        expect(uploaded.name).toBe(name);
        expect(uploaded.url).toContain(uploaded.path);
      } finally {
        await unlink(fileService.getFilePath(uploaded.path));
      }
    }
  });
});
