/**
 * fit.ts aggregates multi-gain trials into dual optima and a band-constrained pick.
 * Recommendation is argmax S_sub inside the S_obj acceptable band; pure peaks are
 * retained for UI honesty. Interval width expands when hold-out disagrees.
 *
 * Confidence is evidence-based, not decorative: a single run stays mid-high, and
 * only repeated same-family agreement raises it toward 1 while also fusing the
 * cm/360 point estimate. Disagreement widens the interval and cuts confidence so
 * a high percentage only appears when retests actually corroborate the pick.
 */

import { uniqueCm360Levels } from "./grid";
import { aggregateObjForGain, normalizeComfort } from "./metrics";
import type {
  CalibRecommendation,
  GainCondition,
  GainScore,
  SubjectiveRating,
  TaskFamily,
  TrialMetrics,
} from "./types";

/** Relative S_obj floor vs peak for the "acceptable band" (0.92 = within 8%). */
const OBJ_BAND_RATIO = 0.92;
/** Relative cm/360 distance that counts as corroborating a prior calibration. */
const HISTORY_AGREE_REL = 0.08;
/** How far back prior recommendations may fuse into this result. */
const HISTORY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Max prior runs inspected for agreement / disagreement. */
const HISTORY_LOOKBACK = 5;

/** Minimal shape needed to fuse accuracy and confidence with past outcomes. */
export type ConfidenceHistoryEntry = {
  cm360: number;
  taskFamily: TaskFamily;
  verified: boolean;
  createdAt: number;
};

/**
 * computeRunConfidence maps trial count and cognitive prior into an honest band.
 * A full default protocol (~10–15 trials) lands near 0.85 before prior discount;
 * reaching ~1.0 requires later corroboration from history fusion, not one run.
 */
export function computeRunConfidence(
  trialCount: number,
  priorDiscount: number,
): number {
  // 0.55 + 10 * 0.03 = 0.85 — sample evidence from one protocol, not certainty.
  const sample = Math.min(0.85, 0.55 + Math.max(0, trialCount) * 0.03);
  return Math.max(0.2, Math.min(1, sample * priorDiscount));
}

/**
 * fuseWithHistory blends agreeing priors into the cm/360 pick and adjusts confidence.
 * Agreement raises confidence and pulls the point estimate toward a weighted mean
 * so repeated consistent retests are both more confident and more accurate.
 * Disagreement lowers confidence and widens the interval without trusting outliers.
 */
export function fuseWithHistory(
  rec: CalibRecommendation,
  history: ConfidenceHistoryEntry[],
  now: number,
): {
  recommendation: CalibRecommendation;
  agreeingRuns: number;
  disagreeingRuns: number;
} {
  const recent = history
    .filter(
      (h) =>
        h.taskFamily === rec.taskFamily &&
        now - h.createdAt <= HISTORY_WINDOW_MS,
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, HISTORY_LOOKBACK);

  const agreeing: ConfidenceHistoryEntry[] = [];
  let disagreeingRuns = 0;
  for (const prior of recent) {
    const denom = Math.max(rec.cm360, prior.cm360, 1e-6);
    const rel = Math.abs(prior.cm360 - rec.cm360) / denom;
    if (rel <= HISTORY_AGREE_REL) agreeing.push(prior);
    else disagreeingRuns += 1;
  }

  // Current run always anchors the fuse; verified priors weigh as much as today.
  let weightSum = 1;
  let cmWeighted = rec.cm360;
  let confidence = rec.confidence;
  for (const prior of agreeing) {
    const weight = prior.verified ? 1 : 0.5;
    weightSum += weight;
    cmWeighted += prior.cm360 * weight;
    confidence += prior.verified ? 0.08 : 0.04;
  }

  // Each conflicting recent fit is evidence the estimate is unstable.
  for (let i = 0; i < disagreeingRuns; i += 1) {
    confidence *= 0.82;
  }

  const fusedCm360 = cmWeighted / weightSum;
  const agreeCms = agreeing.map((a) => a.cm360);
  let cm360Low = rec.cm360Low;
  let cm360High = rec.cm360High;
  if (agreeCms.length > 0) {
    // Interval covers the corroborating cloud around the fused point.
    const cloud = [fusedCm360, rec.cm360, ...agreeCms];
    cm360Low = Math.min(...cloud, cm360Low);
    cm360High = Math.max(...cloud, cm360High);
  }
  if (disagreeingRuns > 0) {
    // Widen so the UI shows uncertainty instead of a falsely tight band.
    const widen = 1 + 0.04 * disagreeingRuns;
    cm360Low *= 2 - widen;
    cm360High *= widen;
  }

  confidence = Math.max(0.2, Math.min(1, confidence));

  let explanation = rec.explanation;
  if (agreeing.length > 0) {
    explanation +=
      ` 已与近 ${agreeing.length} 次同任务族一致结果加权融合 cm/360，置信随复现上调。`;
  }
  if (disagreeingRuns > 0) {
    explanation +=
      ` 近 ${disagreeingRuns} 次同任务族结果不一致，已加宽区间并下调置信。`;
  }

  return {
    agreeingRuns: agreeing.length,
    disagreeingRuns,
    recommendation: {
      ...rec,
      cm360: fusedCm360,
      cm360Low: Math.min(cm360Low, fusedCm360),
      cm360High: Math.max(cm360High, fusedCm360),
      confidence,
      explanation,
    },
  };
}

/**
 * applyHistoryFusion seals post-hold-out accuracy/confidence using local history.
 */
export function applyHistoryFusion(
  rec: CalibRecommendation,
  history: ConfidenceHistoryEntry[],
  now: number,
): CalibRecommendation {
  return fuseWithHistory(rec, history, now).recommendation;
}

/**
 * fitGainScores builds per-cm360 dual scores from trials and comfort ratings.
 */
export function fitGainScores(
  trials: TrialMetrics[],
  ratings: SubjectiveRating[],
  family: TaskFamily,
): GainScore[] {
  const levels = [
    ...new Set([
      ...trials.map((t) => t.cm360),
      ...ratings.map((r) => r.cm360),
    ]),
  ].sort((a, b) => a - b);

  return levels.map((cm360) => {
    const { sObj, nTrials } = aggregateObjForGain(trials, cm360, family);
    const rating = ratings.find((r) => Math.abs(r.cm360 - cm360) < 1e-6);
    return {
      cm360,
      sObj,
      sSub: rating ? normalizeComfort(rating.comfort) : null,
      nTrials,
    };
  });
}

/**
 * recommendFromScores picks the comfort-maximizing gain inside the objective band.
 * When no subjective ratings exist, falls back to the objective peak alone.
 */
export function recommendFromScores(
  scores: GainScore[],
  family: TaskFamily,
  confidence: number,
): CalibRecommendation | null {
  if (scores.length === 0) return null;

  let objBest = scores[0];
  for (const s of scores) {
    if (s.sObj > objBest.sObj) objBest = s;
  }

  const band = scores.filter(
    (s) => s.sObj >= objBest.sObj * OBJ_BAND_RATIO,
  );
  const bandOrAll = band.length > 0 ? band : scores;

  let subBest = objBest;
  for (const s of scores) {
    const sub = s.sSub ?? -1;
    const bestSub = subBest.sSub ?? -1;
    if (sub > bestSub) subBest = s;
  }

  let pick = objBest;
  for (const s of bandOrAll) {
    const sub = s.sSub;
    if (sub === null) continue;
    if (pick.sSub === null || sub > pick.sSub) pick = s;
    else if (sub === pick.sSub && s.sObj > pick.sObj) pick = s;
  }
  // If nobody in-band was rated, keep objective peak.
  if (pick.sSub === null) pick = objBest;

  const sortedCm = scores.map((s) => s.cm360).sort((a, b) => a - b);
  const idx = sortedCm.findIndex((c) => Math.abs(c - pick.cm360) < 1e-6);
  const low =
    idx > 0 ? sortedCm[idx - 1] : Math.max(sortedCm[0], pick.cm360 * 0.92);
  const high =
    idx >= 0 && idx < sortedCm.length - 1
      ? sortedCm[idx + 1]
      : pick.cm360 * 1.08;

  return {
    cm360: pick.cm360,
    cm360Low: Math.min(low, pick.cm360),
    cm360High: Math.max(high, pick.cm360),
    cm360ObjBest: objBest.cm360,
    cm360SubBest: subBest.cm360,
    sObj: pick.sObj,
    sSub: pick.sSub ?? 0,
    verified: false,
    confidence,
    taskFamily: family,
    explanation:
      "推荐值取客观表现可接受带内主观舒适最高的增益；并给出表现最佳与最舒适对照点。",
  };
}

/**
 * applyHoldOut adjusts verification and widens the interval when neighbor wins.
 * recommendedObj/neighborObj are proxy or full S_obj from the hold-out shorts.
 * Pass adds a small confidence bump; fail cuts harder so unverified picks stay
 * visibly less trustworthy than corroborated ones.
 */
export function applyHoldOut(
  rec: CalibRecommendation,
  recommendedObj: number,
  neighborObj: number,
): CalibRecommendation {
  const ok = recommendedObj + 0.02 >= neighborObj;
  if (ok) {
    return {
      ...rec,
      verified: true,
      confidence: Math.min(1, rec.confidence + 0.04),
    };
  }
  const widen = 0.08;
  return {
    ...rec,
    verified: false,
    cm360Low: rec.cm360Low * (1 - widen),
    cm360High: rec.cm360High * (1 + widen),
    confidence: Math.max(0.2, rec.confidence * 0.7),
    explanation:
      rec.explanation +
      " 独立验证中邻近增益表现接近或更优，已加宽建议区间并降低置信。",
  };
}

/**
 * conditionsForLevels filters GainCondition rows to the given cm/360 values.
 */
export function conditionsForLevels(
  conditions: GainCondition[],
  levels: number[],
): GainCondition[] {
  const uniq = uniqueCm360Levels(
    levels.map((cm360, i) => ({ id: `h-${i}`, cm360, repeat: 0 })),
  );
  return conditions.filter((c) =>
    uniq.some((u) => Math.abs(u - c.cm360) < 1e-6),
  );
}
