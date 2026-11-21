/**
 * SchulteDrill.tsx adapts the existing clickable 5×5 Trainer into the suite drill contract.
 * History sidebar stays available in solo mode; suite mode hides it and forwards completion
 * through onComplete so TrainingHub can advance without knowing Schulte internals.
 */

"use client";

import { Trainer } from "@/components/Trainer";
import { formatDurationMs } from "@/lib/schulte";
import type { DrillResult } from "@/lib/trainings";

type SchulteDrillProps = {
  /** Called when 1→25 finishes so the hub can record duration and continue. */
  onComplete: (result: DrillResult) => void;
  /** When true, omit the history sidebar for a tighter suite layout. */
  compact?: boolean;
};

/**
 * SchulteDrill wraps Trainer with the shared DrillResult callback used by every suite item.
 */
export function SchulteDrill({ onComplete, compact = false }: SchulteDrillProps) {
  return (
    <Trainer
      hideHistory={compact}
      onComplete={(durationMs) =>
        onComplete({
          trainingId: "schulte",
          durationMs,
          detail: formatDurationMs(durationMs),
        })
      }
    />
  );
}
