/**
 * orchestrator.ts is a pure state helper for the sens-finder calibration wizard.
 * React owns Engine sessions; this module builds conditions, tracks which cm/360
 * still need subjective ratings, runs the fit, and prepares hold-out levels.
 *
 * Protocol is explore (coarse Weber grid) then one adaptive refine pass around
 * the coarse S_obj peak before hold-out. Refine appends only after explore
 * completes and Likert for the last explore level is cleared, so subjective
 * gating stays per unique gain.
 */

import { cm360FromSens, sensFromCm360 } from "../core/gain";
import type { GameProfile } from "../store/profiles";
import type { SensitivitySettings } from "../store/settings";
import { computeCognitivePrior, type CognitivePrior } from "./cognitivePrior";
import {
  buildRefineConditions,
  estimateCoarsePeakCm360,
  levelsAlreadyPlayed,
} from "./adapt";
import { readRecommendationHistory } from "../store/recommendation";
import {
  applyHistoryFusion,
  applyHoldOut,
  computeRunConfidence,
  fitGainScores,
  recommendFromScores,
} from "./fit";
import {
  buildGainConditions,
  neighborCm360,
  uniqueCm360Levels,
} from "./grid";
import type {
  CalibRecommendation,
  GainCondition,
  SubjectiveRating,
  TaskFamily,
  TrialMetrics,
} from "./types";

/** Snapshot needed to start a calibration run. */
export type CalibSetup = {
  settings: SensitivitySettings;
  profile: GameProfile;
  taskFamily: TaskFamily;
  deskCm?: number;
  forceDespiteDefer?: boolean;
};

/**
 * CalibProtocolPhase tracks which gain-search stage the run is in.
 * explore = coarse grid; refine = adaptive neighbors; holdout = verification.
 */
export type CalibProtocolPhase = "explore" | "refine" | "holdout";

/** Mutable run state shared with the wizard UI. */
export type CalibRunState = {
  conditions: GainCondition[];
  conditionIndex: number;
  trials: TrialMetrics[];
  ratings: SubjectiveRating[];
  pendingSubjectiveCm360: number | null;
  recommendation: CalibRecommendation | null;
  holdoutLevels: number[];
  holdoutIndex: number;
  holdoutScores: number[];
  prior: CognitivePrior;
  taskFamily: TaskFamily;
  centerCm360: number;
  /** Optional desk width used when clamping refine candidates. */
  deskCm?: number;
  /** Current protocol stage for progress copy and refine gating. */
  protocolPhase: CalibProtocolPhase;
  /** True after the refine pass was considered (appended or skipped). */
  refined: boolean;
};

/**
 * createCalibRun validates DPI and builds shuffled gain conditions around S0.
 * Returns a blocked reason when DPI is missing or cognitive prior defers the run.
 */
export function createCalibRun(
  setup: CalibSetup,
): { ok: true; state: CalibRunState } | { ok: false; reason: string } {
  const dpi = setup.settings.dpi;
  if (dpi === null) {
    return { ok: false, reason: "请先填写鼠标 DPI，才能用 cm/360 搜索增益。" };
  }
  const prior = computeCognitivePrior();
  if (prior.deferCalibration && !setup.forceDespiteDefer) {
    return { ok: false, reason: prior.reason };
  }
  const center =
    cm360FromSens(setup.profile, setup.settings.sensitivity, dpi) ?? 30;
  const conditions = buildGainConditions({
    centerCm360: center,
    priorWidthScale: prior.priorWidthScale,
    deskCm: setup.deskCm,
  });
  return {
    ok: true,
    state: {
      conditions,
      conditionIndex: 0,
      trials: [],
      ratings: [],
      pendingSubjectiveCm360: null,
      recommendation: null,
      holdoutLevels: [],
      holdoutIndex: 0,
      holdoutScores: [],
      prior,
      taskFamily: setup.taskFamily,
      centerCm360: center,
      deskCm: setup.deskCm,
      protocolPhase: "explore",
      refined: false,
    },
  };
}

/**
 * currentCondition returns the active GainCondition, or null when trials are done.
 */
export function currentCondition(state: CalibRunState): GainCondition | null {
  return state.conditions[state.conditionIndex] ?? null;
}

/**
 * maybeAppendRefine adds adaptive refine conditions once explore is exhausted.
 * No-ops when Likert is pending, refine already ran, or conditions remain.
 */
function maybeAppendRefine(state: CalibRunState): CalibRunState {
  if (state.refined) return state;
  if (state.protocolPhase !== "explore") return state;
  if (state.conditionIndex < state.conditions.length) return state;
  if (state.pendingSubjectiveCm360 !== null) return state;

  const peak =
    estimateCoarsePeakCm360(state.trials, state.taskFamily) ??
    state.centerCm360;
  const refine = buildRefineConditions({
    peakCm360: peak,
    exploredLevels: levelsAlreadyPlayed(state.conditions),
    deskCm: state.deskCm,
  });
  if (refine.length === 0) {
    return { ...state, protocolPhase: "refine", refined: true };
  }
  return {
    ...state,
    conditions: [...state.conditions, ...refine],
    protocolPhase: "refine",
    refined: true,
  };
}

/**
 * recordTrial appends metrics and advances; may pause for subjective rating.
 * After finishing all repeats of a cm/360 (by occurrence count), requests Likert.
 * When explore ends, appends one adaptive refine pass before fit.
 */
export function recordTrial(
  state: CalibRunState,
  trial: TrialMetrics,
): CalibRunState {
  const trials = [...state.trials, trial];
  const nextIndex = state.conditionIndex + 1;
  const finished = state.conditions[state.conditionIndex];
  const cm360 = finished.cm360;

  const totalForLevel = state.conditions.filter(
    (c) => Math.abs(c.cm360 - cm360) < 1e-6,
  ).length;
  const doneForLevel = state.conditions
    .slice(0, nextIndex)
    .filter((c) => Math.abs(c.cm360 - cm360) < 1e-6).length;

  const needsSubjective =
    doneForLevel >= totalForLevel &&
    !state.ratings.some((r) => Math.abs(r.cm360 - cm360) < 1e-6);

  const next: CalibRunState = {
    ...state,
    trials,
    conditionIndex: nextIndex,
    pendingSubjectiveCm360: needsSubjective ? cm360 : null,
  };
  return maybeAppendRefine(next);
}

/**
 * recordSubjective stores comfort and clears the pending prompt.
 * May append refine conditions when the last explore Likert was the blocker.
 */
export function recordSubjective(
  state: CalibRunState,
  comfort: number,
): CalibRunState {
  if (state.pendingSubjectiveCm360 === null) return state;
  const next: CalibRunState = {
    ...state,
    ratings: [
      ...state.ratings,
      { cm360: state.pendingSubjectiveCm360, comfort },
    ],
    pendingSubjectiveCm360: null,
  };
  return maybeAppendRefine(next);
}

/**
 * trialsComplete reports whether every gain condition has been played.
 * Explore must have attempted refine (refined=true) before this can be true.
 */
export function trialsComplete(state: CalibRunState): boolean {
  return (
    state.refined &&
    state.conditionIndex >= state.conditions.length &&
    state.pendingSubjectiveCm360 === null
  );
}

/**
 * finalizeFit computes dual optima + band pick and schedules hold-out levels.
 * Single-run confidence stays honest; history fusion (accuracy + confidence)
 * waits until hold-out finishes so the result reflects verification and retests.
 */
export function finalizeFit(state: CalibRunState): CalibRunState {
  const scores = fitGainScores(state.trials, state.ratings, state.taskFamily);
  const confidence = computeRunConfidence(
    state.trials.length,
    state.prior.confidenceDiscount,
  );
  const recommendation = recommendFromScores(
    scores,
    state.taskFamily,
    confidence,
  );
  if (!recommendation) return state;
  const levels = uniqueCm360Levels(state.conditions);
  const neighbor = neighborCm360(levels, recommendation.cm360, 1);
  const holdoutLevels = [recommendation.cm360, neighbor].filter(
    (v, i, arr) => arr.findIndex((x) => Math.abs(x - v) < 1e-6) === i,
  );
  return {
    ...state,
    protocolPhase: "holdout",
    recommendation,
    holdoutLevels,
    holdoutIndex: 0,
    holdoutScores: [],
  };
}

/**
 * sealRecommendation applies hold-out, then fuses agreeing history into cm/360.
 * Call only when hold-out is complete so Date.now / localStorage stay off SSR
 * (orchestrator runs from client session callbacks only).
 */
function sealRecommendation(
  recommendation: CalibRecommendation,
  holdoutScores: number[],
): CalibRecommendation {
  const sealed =
    holdoutScores.length >= 2
      ? applyHoldOut(recommendation, holdoutScores[0], holdoutScores[1])
      : {
          ...recommendation,
          verified: true,
          confidence: Math.min(1, recommendation.confidence + 0.04),
        };
  return applyHistoryFusion(sealed, readRecommendationHistory(), Date.now());
}

/**
 * recordHoldoutScore stores one hold-out S_obj and advances the index.
 * When the last hold-out finishes, verification plus history fusion are sealed
 * onto the recommendation shown on the result screen.
 */
export function recordHoldoutScore(
  state: CalibRunState,
  sObj: number,
): CalibRunState {
  const holdoutScores = [...state.holdoutScores, sObj];
  const holdoutIndex = state.holdoutIndex + 1;
  let recommendation = state.recommendation;
  if (
    recommendation &&
    holdoutIndex >= state.holdoutLevels.length &&
    holdoutScores.length >= 1
  ) {
    recommendation = sealRecommendation(recommendation, holdoutScores);
  }
  return { ...state, holdoutScores, holdoutIndex, recommendation };
}

/**
 * applyRecommendationToSettings converts cm/360 into clamped in-game sens.
 * Requires dpi; returns null when conversion is impossible.
 */
export function applyRecommendationToSettings(
  settings: SensitivitySettings,
  profile: GameProfile,
  cm360: number,
): SensitivitySettings | null {
  if (settings.dpi === null) return null;
  return {
    ...settings,
    sensitivity: sensFromCm360(profile, cm360, settings.dpi),
  };
}
