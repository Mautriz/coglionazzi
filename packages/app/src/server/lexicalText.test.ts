import { describe, expect, it } from "vitest";
import { extractLexicalText, plainTextToLexical } from "./lexicalText";

const wrap = (children: unknown[]) =>
  JSON.stringify({
    root: { type: "root", children },
  });

const text = (t: string) => ({ type: "text", text: t });
const block = (type: string, children: unknown[]) => ({ type, children });

describe("extractLexicalText", () => {
  it("returns empty string for null / garbage input", () => {
    expect(extractLexicalText(null)).toBe("");
    expect(extractLexicalText("")).toBe("");
    expect(extractLexicalText("not json at all")).toBe("");
    expect(extractLexicalText("{}")).toBe("");
  });

  it("extracts text from a simple paragraph", () => {
    const state = wrap([block("paragraph", [text("hello world")])]);
    expect(extractLexicalText(state)).toBe("hello world");
  });

  it("joins inline siblings without separators, blocks with newlines", () => {
    const state = wrap([
      block("paragraph", [text("hello "), text("world")]),
      block("paragraph", [text("second block")]),
    ]);
    expect(extractLexicalText(state)).toBe("hello world\nsecond block");
  });

  it("walks nested structures (lists)", () => {
    const state = wrap([
      block("list", [
        block("listitem", [text("one")]),
        block("listitem", [text("two")]),
      ]),
    ]);
    expect(extractLexicalText(state)).toBe("one\ntwo");
  });

  it("does NOT leak structural noise into the text", () => {
    const state = wrap([block("paragraph", [text("just this")])]);
    const extracted = extractLexicalText(state);
    expect(extracted).not.toContain("paragraph");
    expect(extracted).not.toContain("root");
  });
});

describe("plainTextToLexical", () => {
  it("produces a valid editor state that round-trips back to the text", () => {
    expect(extractLexicalText(plainTextToLexical("hello world"))).toBe(
      "hello world",
    );
  });

  it("keeps multi-line text across paragraphs", () => {
    expect(extractLexicalText(plainTextToLexical("line one\nline two"))).toBe(
      "line one\nline two",
    );
  });

  it("is parseable JSON with a root node", () => {
    const parsed = JSON.parse(plainTextToLexical("x")) as {
      root: { type: string; children: unknown[] };
    };
    expect(parsed.root.type).toBe("root");
    expect(parsed.root.children).toHaveLength(1);
  });
});
