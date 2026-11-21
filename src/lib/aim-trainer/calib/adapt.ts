/**
 * adapt.ts builds one post-explore refine pass around the coarse objective peak.
 * The explore grid stays a Weber-style relative sweep; refine then samples tighter
 * ±4%/±8% neighbors so the protocol adapts gain toward the athlete without
 * abandoning randomized multi-gain contrast. Levels already measured are skipped.
 */

import { hardwareCm360Bounds, relativeCm360Grid } from "../core/gain";
import { uniqueCm360Levels } from "./grid";
import { aggregateObjForGain } from "./metrics";
import type { GainCondition, TaskFamily, TrialMetrics } from "./types";

/** Relative refine offsets around the coarse peak (Weber-style). */
const REFINE_FACTORS = [0.92, 0.96, 1.04, 1.08] as const;
/** Max distinct new cm/360 levels appended in the refine pass. */
const MAX_REFINE_LEVELS = 3;
/** Repeats per refine level — fewer than explore to keep the session short. */
const REFINE_REPEATS = 2;
/** Relative distance treated as "already explored" vs a refine candidate. */
const SAME_LEVEL_REL = 0.02;

/**
 * estimateCoarsePeakCm360 picks the explore-phase cm/360 with the best S_obj.
 * When the peak's trials show heavy overshoot, the center is nudged toward higher
 * cm/360 (lower gain) before refine sampling so the next grid biases safer.
 */
export function estimateCoarsePeakCm360(
  trials: TrialMetrics[],
  family: TaskFamily,
): number | null {
  if (trials.length === 0) return null;
  const levels = [...new Set(trials.map((t) => t.cm360))].sort((a, b) => a - b);
  let bestCm = levels[0]!;
  let bestObj = -Infinity;
  for (const cm360 of levels) {
    const { sObj } = aggregateObjForGain(trials, cm360, family);
    if (sObj > bestObj) {
      bestObj = sObj;
      bestCm = cm360;
    }
  }

  const atPeak = trials.filter((t) => Math.abs(t.cm360 - bestCm) < 1e-6);
  const meanOvershoot =
    atPeak.length === 0
      ? 0
      : atPeak.reduce((sum, t) => sum + t.meanOvershootDeg, 0) / atPeak.length;
  // Large overshoot at the peak → prefer slightly lower gain for refine center.
  if (meanOvershoot > 8) {
    return Number((bestCm * 1.04).toFixed(3));
  }
  return bestCm;
}

/**
 * buildRefineConditions returns up to MAX_REFINE_LEVELS new GainCondition rows.
 * Call after explore finishes; pass already-played levels so duplicates are dropped.
 * deskCm clamps candidates to hardware bounds like the explore grid.
 */
export function buildRefineConditions(options: {
  peakCm360: number;
  exploredLevels: number[];
  deskCm?: number;
  rng?: () => number;
}): GainCondition[] {
  const rng = options.rng ?? Math.random;
  const bounds = hardwareCm360Bounds(options.deskCm);
  const candidates = relativeCm360Grid(
    options.peakCm360,
    REFINE_FACTORS,
    bounds,
  ).filter((cm360) => {
    return !options.exploredLevels.some((explored) => {
      const denom = Math.max(cm360, explored, 1e-6);
      return Math.abs(cm360 - explored) / denom <= SAME_LEVEL_REL;
    });
  });

  const shuffled = shuffle(candidates, rng).slice(0, MAX_REFINE_LEVELS);
  const conditions: GainCondition[] = [];
  for (const cm360 of shuffled) {
    for (let repeat = 0; repeat < REFINE_REPEATS; repeat += 1) {
      conditions.push({
        id: `refine-${cm360.toFixed(3)}-r${repeat}`,
        cm360,
        repeat,
      });
    }
  }
  return conditions;
}

/**
 * levelsAlreadyPlayed returns distinct cm/360 values from conditions played so far.
 */
export function levelsAlreadyPlayed(conditions: GainCondition[]): number[] {
  return uniqueCm360Levels(conditions);
}

/**
 * shuffle returns a Fisher–Yates copy so refine order is not peak-monotonic.
 */
function shuffle<T>(items: T[], rng: () => number): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
  }
  return next;
}
