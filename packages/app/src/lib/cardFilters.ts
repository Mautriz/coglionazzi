/** Client-side card filtering for the board view. The whole board is
 *  already loaded by board.get, so filtering is a pure function over it —
 *  state lives in the board route's search params (shareable URLs). */

export type CardFilters = {
  /** Substring of title or description text (case-insensitive). */
  q?: string;
  /** Match cards having ANY of these tags. */
  tags?: string[];
  /** Match cards assigned to ANY of these user ids. */
  assignees?: string[];
  /** Created on/after this day (yyyy-mm-dd). */
  from?: string;
  /** Created on/before this day (yyyy-mm-dd). */
  to?: string;
};

type FilterableCard = {
  title: string;
  description_text: string;
  tags: string[];
  assignees: { id: string }[];
  created_at: Date | string;
};

/** The filter keys, for iterating/clearing. */
export const FILTER_KEYS = ["q", "tags", "assignees", "from", "to"] as const;

export function isFilterActive(f: CardFilters): boolean {
  return Boolean(
    f.q?.trim() || f.tags?.length || f.assignees?.length || f.from || f.to,
  );
}

/** Merge a partial filter patch into the previous search params, dropping
 *  emptied filter keys so the URL stays clean. Non-filter keys (e.g. `card`)
 *  are preserved. Used by both the board and archive filter UIs. */
export function mergeFilters<T extends CardFilters>(
  prev: T,
  patch: Partial<CardFilters>,
): T {
  const next = { ...prev, ...patch };
  for (const k of FILTER_KEYS) {
    const v = next[k];
    if (!v || (Array.isArray(v) && v.length === 0)) delete next[k];
  }
  return next;
}

export function cardMatchesFilters(
  card: FilterableCard,
  f: CardFilters,
): boolean {
  const q = f.q?.trim().toLowerCase();
  if (q) {
    const haystack =
      `${card.title}\n${card.description_text}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  if (f.tags?.length && !f.tags.some((t) => card.tags.includes(t))) {
    return false;
  }

  if (
    f.assignees?.length &&
    !card.assignees.some((a) => f.assignees!.includes(a.id))
  ) {
    return false;
  }

  if (f.from || f.to) {
    // Compare on UTC calendar days so the range is inclusive on both ends
    // and deterministic regardless of timezone: a card created any time on
    // 2026-06-13 (UTC) matches `from: 2026-06-13` and `to: 2026-06-13`.
    const created = new Date(card.created_at);
    const day = Date.UTC(
      created.getUTCFullYear(),
      created.getUTCMonth(),
      created.getUTCDate(),
    );
    if (f.from && day < new Date(`${f.from}T00:00:00Z`).getTime()) return false;
    if (f.to && day > new Date(`${f.to}T00:00:00Z`).getTime()) return false;
  }

  return true;
}
