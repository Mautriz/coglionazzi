import { unlink } from "node:fs/promises";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { fileService } from "../src/server/files";

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
