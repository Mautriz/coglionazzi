/** Client-side triage for dropped/picked files, so the obvious rejects never
 *  become a round trip that fails with a generic server error.
 *
 *  Pure on purpose — the DOM parts (drag events, highlight state) live in
 *  `components/custom/FileUploads.tsx`; this is the part worth testing. */

/** The upload endpoint's cap (`rpc.file.upload`, zod `.max()`). Kept in sync by
 *  hand — the server is still the authority; this only buys a better message. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface FileTriage {
  /** Files worth sending to the server, in the order they were given. */
  accepted: File[];
  /** Why each rejected file was rejected — ready to show the user. */
  rejected: { name: string; reason: string }[];
}

/** Does `file` satisfy an `accept` attribute? Supports the three forms an
 *  `<input accept>` takes: a wildcard type (`image/*`), an exact mime type
 *  (`application/pdf`), and an extension (`.png`). An empty/absent `accept`
 *  allows everything, which is the default for uploads here. */
export function matchesAccept(file: File, accept?: string): boolean {
  const patterns = (accept ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (patterns.length === 0) return true;

  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  return patterns.some((pattern) => {
    if (pattern.startsWith(".")) return name.endsWith(pattern);
    if (pattern.endsWith("/*")) {
      const group = pattern.slice(0, -1); // "image/*" -> "image/"
      return type.startsWith(group);
    }
    return type === pattern;
  });
}

/** Split files into what we'll upload and what we won't, with reasons.
 *  Size is checked before type so a huge wrong-typed file reports the size —
 *  the more surprising of the two. */
export function triageFiles(files: File[], accept?: string): FileTriage {
  const accepted: File[] = [];
  const rejected: { name: string; reason: string }[] = [];

  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      rejected.push({ name: file.name, reason: "over 20MB" });
      continue;
    }
    if (!matchesAccept(file, accept)) {
      rejected.push({ name: file.name, reason: "wrong file type" });
      continue;
    }
    accepted.push(file);
  }

  return { accepted, rejected };
}

/** One sentence naming what was skipped and why, or null when nothing was.
 *  Names the files when there are few; counts them when there are many. */
export function rejectionMessage(
  rejected: { name: string; reason: string }[],
): string | null {
  if (rejected.length === 0) return null;
  if (rejected.length === 1) {
    return `Skipped ${rejected[0].name} — ${rejected[0].reason}.`;
  }
  if (rejected.length <= 3) {
    return `Skipped ${rejected.map((r) => `${r.name} (${r.reason})`).join(", ")}.`;
  }
  return `Skipped ${rejected.length} files — too large or the wrong type.`;
}

/** True when a drag actually carries FILES, as opposed to dragged text, a
 *  link, or one of our own @dnd-kit kanban cards. Without this the drop
 *  overlay would flash while a user drags a card across the board. */
export function dragHasFiles(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  return Array.from(transfer.types).includes("Files");
}
