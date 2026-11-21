/**
 * grid.ts builds the randomized multi-gain condition list for sens-finder.
 * Candidates live in cm/360 with geometric spacing (Weber), then intersect the
 * cognitive prior width and hardware bounds before shuffle + repeats.
 */

import {
  hardwareCm360Bounds,
  relativeCm360Grid,
} from "../core/gain";
import type { GainCondition, TaskFamily } from "./types";

/** Default multiplicative offsets around S0 (±~25% span). */
export const DEFAULT_GAIN_FACTORS = [0.8, 0.9, 1, 1.12, 1.25] as const;

/**
 * Repeats per unique cm/360 level in the objective phase.
 * Three passes reduce single-gain noise so the band pick is more stable before
 * hold-out and history fusion refine confidence.
 */
export const DEFAULT_REPEATS = 3;

/**
 * buildGainConditions creates shuffled GainCondition rows for one calibration run.
 * priorWidthScale < 1 narrows the factor span when cognitive priors are confident.
 */
export function buildGainConditions(options: {
  centerCm360: number;
  priorWidthScale?: number;
  deskCm?: number;
  factors?: readonly number[];
  repeats?: number;
  rng?: () => number;
}): GainCondition[] {
  const rng = options.rng ?? Math.random;
  const repeats = options.repeats ?? DEFAULT_REPEATS;
  const width = options.priorWidthScale ?? 1;
  const baseFactors = options.factors ?? DEFAULT_GAIN_FACTORS;
  // Shrink offsets toward 1 when prior says search less aggressively.
  const factors = baseFactors.map((f) => 1 + (f - 1) * width);
  const bounds = hardwareCm360Bounds(options.deskCm);
  const levels = shuffle(
    relativeCm360Grid(options.centerCm360, factors, bounds),
    rng,
  );

  // Keep repeats of the same cm/360 contiguous so Likert prompts follow each block.
  const conditions: GainCondition[] = [];
  for (const cm360 of levels) {
    for (let repeat = 0; repeat < repeats; repeat++) {
      conditions.push({
        id: `g${cm360.toFixed(3)}-r${repeat}`,
        cm360,
        repeat,
      });
    }
  }
  return conditions;
}

/**
 * uniqueCm360Levels returns sorted distinct cm/360 values from a condition list.
 */
export function uniqueCm360Levels(conditions: GainCondition[]): number[] {
  const set = new Set(conditions.map((c) => c.cm360));
  return [...set].sort((a, b) => a - b);
}

/**
 * neighborCm360 picks the adjacent grid step for hold-out comparison.
 * Direction +1 prefers a lower-gain (higher cm/360) neighbor when available.
 */
export function neighborCm360(
  levels: number[],
  recommended: number,
  direction: 1 | -1 = 1,
): number {
  if (levels.length === 0) return recommended;
  const sorted = [...levels].sort((a, b) => a - b);
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < sorted.length; i++) {
    const d = Math.abs(sorted[i] - recommended);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  const neighborIdx = Math.max(
    0,
    Math.min(sorted.length - 1, bestIdx + direction),
  );
  if (neighborIdx === bestIdx && sorted.length > 1) {
    return sorted[bestIdx === 0 ? 1 : bestIdx - 1];
  }
  return sorted[neighborIdx];
}

/**
 * taskFamilyWeights maps Fitts variants to relative importance by task family.
 */
export function taskFamilyWeights(
  family: TaskFamily,
): Record<"farLarge" | "farSmall" | "nearSmall", number> {
  if (family === "flick") {
    return { farLarge: 1.2, farSmall: 1.4, nearSmall: 0.6 };
  }
  if (family === "micro") {
    return { farLarge: 0.6, farSmall: 1, nearSmall: 1.5 };
  }
  return { farLarge: 1, farSmall: 1, nearSmall: 1 };
}

/**
 * shuffle returns a new Fisher–Yates shuffled copy using the provided rng.
 */
function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
