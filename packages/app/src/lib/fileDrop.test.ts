import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  dragHasFiles,
  matchesAccept,
  rejectionMessage,
  triageFiles,
} from "./fileDrop";

/** A File stand-in with a controllable size (constructing a real 21MB File in
 *  a test would allocate 21MB). Only name/type/size are read. */
function fakeFile(name: string, type: string, size = 10): File {
  return { name, type, size } as File;
}

describe("matchesAccept", () => {
  it("allows anything when no accept is given", () => {
    expect(matchesAccept(fakeFile("a.exe", "application/x-msdownload"))).toBe(
      true,
    );
  });

  it("allows anything for an empty accept string", () => {
    expect(
      matchesAccept(fakeFile("a.exe", "application/octet-stream"), ""),
    ).toBe(true);
  });

  it("matches a wildcard group", () => {
    expect(matchesAccept(fakeFile("a.png", "image/png"), "image/*")).toBe(true);
    expect(matchesAccept(fakeFile("a.pdf", "application/pdf"), "image/*")).toBe(
      false,
    );
  });

  it("matches an exact mime type", () => {
    expect(
      matchesAccept(fakeFile("a.pdf", "application/pdf"), "application/pdf"),
    ).toBe(true);
    expect(
      matchesAccept(fakeFile("a.png", "image/png"), "application/pdf"),
    ).toBe(false);
  });

  it("matches an extension, ignoring case", () => {
    expect(matchesAccept(fakeFile("HOLIDAY.PNG", ""), ".png")).toBe(true);
    expect(matchesAccept(fakeFile("a.gif", ""), ".png")).toBe(false);
  });

  it("accepts a file matching any one of several patterns", () => {
    const accept = "image/*,application/pdf";
    expect(matchesAccept(fakeFile("a.pdf", "application/pdf"), accept)).toBe(
      true,
    );
    expect(matchesAccept(fakeFile("a.png", "image/png"), accept)).toBe(true);
    expect(matchesAccept(fakeFile("a.zip", "application/zip"), accept)).toBe(
      false,
    );
  });

  it("does not let a mime prefix collide across groups", () => {
    // "image/*" must not admit "imageish/png".
    expect(matchesAccept(fakeFile("a", "imageish/png"), "image/*")).toBe(false);
  });
});

describe("triageFiles", () => {
  it("keeps every file when they all pass", () => {
    const files = [
      fakeFile("a.png", "image/png"),
      fakeFile("b.pdf", "application/pdf"),
    ];

    const { accepted, rejected } = triageFiles(files);

    expect(accepted).toHaveLength(2);
    expect(rejected).toEqual([]);
  });

  it("rejects a file over the size cap", () => {
    const big = fakeFile("huge.png", "image/png", MAX_UPLOAD_BYTES + 1);

    const { accepted, rejected } = triageFiles([big]);

    expect(accepted).toEqual([]);
    expect(rejected).toEqual([{ name: "huge.png", reason: "over 20MB" }]);
  });

  it("allows a file exactly at the cap", () => {
    const exact = fakeFile("edge.png", "image/png", MAX_UPLOAD_BYTES);

    expect(triageFiles([exact]).accepted).toHaveLength(1);
  });

  it("rejects a file of the wrong type when accept is set", () => {
    const { accepted, rejected } = triageFiles(
      [fakeFile("notes.pdf", "application/pdf")],
      "image/*",
    );

    expect(accepted).toEqual([]);
    expect(rejected).toEqual([
      { name: "notes.pdf", reason: "wrong file type" },
    ]);
  });

  it("reports size rather than type when a file fails both", () => {
    const both = fakeFile("huge.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1);

    expect(triageFiles([both], "image/*").rejected[0].reason).toBe("over 20MB");
  });

  it("keeps the good files from a mixed drop, in order", () => {
    const files = [
      fakeFile("ok1.png", "image/png"),
      fakeFile("bad.pdf", "application/pdf"),
      fakeFile("ok2.jpg", "image/jpeg"),
    ];

    const { accepted, rejected } = triageFiles(files, "image/*");

    expect(accepted.map((f) => f.name)).toEqual(["ok1.png", "ok2.jpg"]);
    expect(rejected).toHaveLength(1);
  });
});

describe("rejectionMessage", () => {
  it("is null when nothing was rejected", () => {
    expect(rejectionMessage([])).toBeNull();
  });

  it("names a single file and its reason", () => {
    expect(
      rejectionMessage([{ name: "a.pdf", reason: "wrong file type" }]),
    ).toBe("Skipped a.pdf — wrong file type.");
  });

  it("names a handful of files", () => {
    const message = rejectionMessage([
      { name: "a.pdf", reason: "wrong file type" },
      { name: "b.zip", reason: "over 20MB" },
    ]);

    expect(message).toContain("a.pdf");
    expect(message).toContain("b.zip");
  });

  it("counts instead of listing when there are many", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      name: `f${i}.zip`,
      reason: "over 20MB",
    }));

    expect(rejectionMessage(many)).toBe(
      "Skipped 5 files — too large or the wrong type.",
    );
  });
});

describe("dragHasFiles", () => {
  it("is true for a drag carrying files", () => {
    expect(dragHasFiles({ types: ["Files"] } as unknown as DataTransfer)).toBe(
      true,
    );
  });

  it("is false for dragged text", () => {
    expect(
      dragHasFiles({ types: ["text/plain"] } as unknown as DataTransfer),
    ).toBe(false);
  });

  it("is false when there is no transfer at all", () => {
    expect(dragHasFiles(null)).toBe(false);
  });
});
