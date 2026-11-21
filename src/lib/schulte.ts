/**
 * schulte.ts owns Schulte-table board generation and session scoring helpers.
 * Boards are random permutations of 1..n² so each round forces fresh visual search;
 * timing helpers stay pure so UI and storage can share the same units.
 */

/** One completed training attempt persisted for progress curves. */
export type TrainingRecord = {
  /** Unix epoch milliseconds when the session finished. */
  completedAt: number;
  /** Elapsed search time in milliseconds from first clickable state to last correct cell. */
  durationMs: number;
  /** Grid edge length; VisOrder starts at 5 (25 cells). */
  size: number;
};

/** Default Schulte size matches the classic 5×5 attention drill. */
export const DEFAULT_GRID_SIZE = 5;

/**
 * buildBoard returns a shuffled list of 1..size² for a size×size Schulte grid.
 * Callers must treat the array as row-major cell values and must not assume sorted order.
 */
export function buildBoard(size: number = DEFAULT_GRID_SIZE): number[] {
  const count = size * size;
  const values = Array.from({ length: count }, (_, index) => index + 1);
  // Fisher–Yates keeps every permutation equally likely so memorized layouts do not stick.
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = values[i]!;
    values[i] = values[j]!;
    values[j] = tmp;
  }
  return values;
}

/**
 * formatDurationMs renders millisecond durations as m:ss.cs for the timer and history list.
 * Centiseconds keep short sessions readable without claiming millisecond precision on screen.
 */
export function formatDurationMs(durationMs: number): string {
  const totalCs = Math.max(0, Math.floor(durationMs / 10));
  const minutes = Math.floor(totalCs / 6000);
  const seconds = Math.floor((totalCs % 6000) / 100);
  const centiseconds = totalCs % 100;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const cs = String(centiseconds).padStart(2, "0");
  return `${mm}:${ss}.${cs}`;
}

/**
 * summarizeRecords derives best and latest times from a chronological record list.
 * Empty history yields null metrics so the UI can show an empty state instead of fake zeros.
 */
export function summarizeRecords(records: TrainingRecord[]): {
  bestMs: number | null;
  latestMs: number | null;
  count: number;
} {
  if (records.length === 0) {
    return { bestMs: null, latestMs: null, count: 0 };
  }
  let bestMs = records[0]!.durationMs;
  for (const record of records) {
    if (record.durationMs < bestMs) {
      bestMs = record.durationMs;
    }
  }
  return {
    bestMs,
    latestMs: records[records.length - 1]!.durationMs,
    count: records.length,
  };
}
