/** Extract the plain text of a serialized Lexical editor state. Walks the
 *  node tree collecting `text` leaves; block boundaries become newlines.
 *  Used to fill the *_text companion columns that power fuzzy search —
 *  searching the raw JSON would match structural noise ("paragraph", …). */
export function extractLexicalText(serialized: string | null): string {
  if (!serialized) return "";

  let root: unknown;
  try {
    root = (JSON.parse(serialized) as { root?: unknown }).root;
  } catch {
    return "";
  }

  const parts: string[] = [];

  function walk(node: unknown) {
    if (node == null || typeof node !== "object") return;
    const n = node as {
      text?: unknown;
      children?: unknown[];
      type?: unknown;
    };
    if (typeof n.text === "string") parts.push(n.text);
    if (Array.isArray(n.children)) {
      for (const child of n.children) walk(child);
      // Block-level nodes separate their text from the next block.
      parts.push("\n");
    }
  }

  walk(root);

  return parts.join("").replace(/\n{2,}/g, "\n").trim();
}

/** Wrap plain text into a minimal serialized Lexical editor state — one
 *  paragraph per line. The inverse of `extractLexicalText`. Used when a source
 *  that isn't the rich editor (e.g. the public support widget) produces a
 *  message that must live in the Lexical-bodied `chat_messages`. */
export function plainTextToLexical(text: string): string {
  const lines = text.split("\n");
  const paragraph = (line: string) => ({
    type: "paragraph",
    version: 1,
    direction: null as null,
    format: "",
    indent: 0,
    children: line
      ? [
          {
            type: "text",
            version: 1,
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            text: line,
          },
        ]
      : [],
  });
  return JSON.stringify({
    root: {
      type: "root",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: lines.map(paragraph),
    },
  });
}
