/**
 * metrics.ts scores objective pointing performance for one sens-finder trial.
 * Speed, accuracy, overshoot, and reversals are combined into an explainable
 * S_obj in [0, 1]; weights stay fixed so dual-optima reporting remains honest.
 */

import { taskFamilyWeights } from "./grid";
import type { FittsVariant, TaskFamily, TrialMetrics } from "./types";

/** Weights for the objective composite (must sum conceptually to emphasis, not 1). */
const W_SPEED = 0.35;
const W_ACCURACY = 0.35;
const W_OVERSHOOT = 0.15;
const W_REVERSALS = 0.15;

/**
 * scoreTrialObj maps raw trial metrics into [0, 1] before task-family weighting.
 * Faster avgKillTime and higher accuracy raise the score; overshoot/reversals lower it.
 */
export function scoreTrialObj(trial: TrialMetrics): number {
  const speed =
    trial.avgKillTime === null || trial.avgKillTime <= 0
      ? 0
      : clamp01(1 - trial.avgKillTime / 1.8);
  const accuracy = clamp01(trial.accuracy / 100);
  const overshootPenalty = clamp01(trial.meanOvershootDeg / 25);
  const reversalPenalty = clamp01(trial.meanReversals / 4);
  return clamp01(
    W_SPEED * speed +
      W_ACCURACY * accuracy -
      W_OVERSHOOT * overshootPenalty -
      W_REVERSALS * reversalPenalty,
  );
}

/**
 * aggregateObjForGain averages weighted trial scores for one cm/360 level.
 */
export function aggregateObjForGain(
  trials: TrialMetrics[],
  cm360: number,
  family: TaskFamily,
): { sObj: number; nTrials: number } {
  const weights = taskFamilyWeights(family);
  const matched = trials.filter((t) => Math.abs(t.cm360 - cm360) < 1e-6);
  if (matched.length === 0) return { sObj: 0, nTrials: 0 };
  let num = 0;
  let den = 0;
  for (const trial of matched) {
    const w = weights[trial.variant as FittsVariant] ?? 1;
    num += scoreTrialObj(trial) * w;
    den += w;
  }
  return { sObj: den > 0 ? num / den : 0, nTrials: matched.length };
}

/**
 * normalizeComfort maps Likert 1–5 onto [0, 1].
 */
export function normalizeComfort(comfort: number): number {
  return clamp01((comfort - 1) / 4);
}

/**
 * proxyObjFromSession builds a coarse S_obj from ordinary aim HUD stats.
 * Used by the drift monitor when kinematic calib metrics are unavailable.
 */
export function proxyObjFromSession(input: {
  accuracy: number;
  avgKillTime: number | null;
  score: number;
}): number {
  const speed =
    input.avgKillTime === null || input.avgKillTime <= 0
      ? 0
      : clamp01(1 - input.avgKillTime / 1.8);
  const accuracy = clamp01(input.accuracy / 100);
  const scorePart = clamp01(input.score / 30000);
  return clamp01(0.4 * speed + 0.4 * accuracy + 0.2 * scorePart);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
