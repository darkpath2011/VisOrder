/**
 * random.ts provides tiny Fisher–Yates helpers shared by cognitive drills.
 * Centralizing shuffle/pick keeps each drill free of duplicated permutation logic
 * while still producing fresh layouts every round so memorization cannot replace attention.
 */

/**
 * shuffle returns a new array with elements permuted uniformly at random.
 * The input is never mutated so callers can reuse source catalogs safely.
 */
export function shuffle<T>(items: readonly T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
  }
  return next;
}

/**
 * pickRandom returns one element from a non-empty list using Math.random.
 * Callers must pass at least one item; empty lists throw to catch data bugs early.
 */
export function pickRandom<T>(items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error("pickRandom requires a non-empty list");
  }
  return items[Math.floor(Math.random() * items.length)]!;
}
