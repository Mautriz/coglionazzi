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
