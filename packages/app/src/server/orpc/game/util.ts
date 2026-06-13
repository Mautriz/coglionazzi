/** Bracket sizing: a Versus game uses a power-of-2 number of cards. */

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;
}

/** The playable sizes for a deck of `deckSize` cards: 2, 4, 8, … up to the
 *  largest power of 2 that fits. Empty if the deck has fewer than 2 cards. */
export function powerOfTwoSizes(deckSize: number): number[] {
  const sizes: number[] = [];
  for (let s = 2; s <= deckSize; s *= 2) sizes.push(s);
  return sizes;
}

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
