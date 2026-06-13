/** Stable string→bucket hash for hash-colored UI (avatars, tag chips): same
 *  key → same color everywhere, across reloads. */
export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Deterministically pick a palette entry for a key. */
export function pickByHash<T>(key: string, palette: readonly T[]): T {
  return palette[hashString(key) % palette.length];
}

/** Soft fill+text palette for round/square initials avatars (user + team). */
export const AVATAR_PALETTE = [
  "bg-primary/20 text-primary",
  "bg-green1/20 text-green1",
  "bg-orange1/20 text-orange1",
  "bg-blue1/20 text-blue1",
  "bg-red1/20 text-red1",
  "bg-purple/20 text-purple",
] as const;
