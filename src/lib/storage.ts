/**
 * storage.ts keeps the legacy Schulte history helpers as a thin facade.
 * Persistence and Supabase sync live in training-history.ts; this module only
 * projects Schulte rows so older Trainer call sites keep compiling unchanged.
 */

import type { TrainingRecord } from "./schulte";
import {
  clearSessionsLocal,
  readSchulteHistory,
  recordDrillCompletion,
  toSchulteRecords,
} from "./training-history";

/**
 * readHistory loads Schulte-only sessions from the local-first history store.
 */
export function readHistory(): TrainingRecord[] {
  return readSchulteHistory();
}

/**
 * appendRecord stores a finished Schulte attempt and kicks off cloud sync when signed in.
 * Returns Schulte-projected rows so Trainer state stays typed as TrainingRecord[].
 */
export function appendRecord(record: TrainingRecord): TrainingRecord[] {
  const sessions = recordDrillCompletion(
    {
      trainingId: "schulte",
      durationMs: record.durationMs,
      detail: undefined,
    },
    { size: record.size },
  );
  return toSchulteRecords(sessions);
}

/**
 * clearHistory removes local sessions only; prefer clearAllHistory when signed-in reset
 * should also wipe cloud rows (Trainer reset uses clearAllHistory via async path).
 */
export function clearHistory(): void {
  clearSessionsLocal();
}
