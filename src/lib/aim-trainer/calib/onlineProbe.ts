/**
 * onlineProbe.ts implements literature route C: rare ±5% cm/360 probes in daily aim.
 * Probes never write settings by themselves; they only change the live engine gain for
 * one round, then callers restore the athlete's saved sens. Outcomes feed a weak
 * history fuse so confidence and cm/360 move only when evidence agrees.
 */

import { proxyObjFromSession } from "./metrics";
import type { TaskFamily } from "./types";
import { applyHistoryFusion, type ConfidenceHistoryEntry } from "./fit";
import type { CalibRecommendation } from "./types";
import type { SensitivityRecommendation } from "../store/recommendation";
import type { AimSessionLogEntry } from "../store/sessionLog";
import type { SensitivitySettings } from "../store/settings";

/** Probe direction relative to the verified recommendation point. */
export type ProbeKind = "baseline" | "plus" | "minus";

/** Planned gain for one daily probe round. */
export type ProbePlan = {
  kind: ProbeKind;
  /** Physical cm/360 applied for this round only. */
  cm360: number;
};

/** How the probe proxy compared to recent baseline sessions. */
export type ProbeVerdict = "agree" | "worse" | "inconclusive";

/** Relative step used for plus/minus probes (Weber-style). */
export const PROBE_REL_STEP = 0.05;
/** Probe about one in every N finished daily aim rounds. */
export const PROBE_EVERY_N_SESSIONS = 3;
/** Relative cm/360 match when harvesting baseline proxies from aim logs. */
const BASELINE_MATCH_REL = 0.04;
/** Proxy margin before calling a neighbor clearly better/worse. */
const PROXY_EDGE = 0.02;

/**
 * shouldProbeThisSession reports whether this daily round should run a gain probe.
 * Requires a verified recommendation, configured DPI, and sessionCount % N === 0.
 */
export function shouldProbeThisSession(
  settings: SensitivitySettings,
  recommendation: SensitivityRecommendation | null,
  sessionCount: number,
): boolean {
  if (settings.dpi === null) return false;
  if (!recommendation || !recommendation.verified) return false;
  if (sessionCount <= 0) return false;
  return sessionCount % PROBE_EVERY_N_SESSIONS === 0;
}

/**
 * pickProbeCm360 chooses baseline / +5% / −5% cm/360 around the recommendation.
 * rng lets tests inject determinism; production passes Math.random.
 */
export function pickProbeCm360(
  recommendation: SensitivityRecommendation,
  rng: () => number = Math.random,
): ProbePlan {
  const roll = rng();
  const center = recommendation.cm360;
  if (roll < 1 / 3) {
    return { kind: "baseline", cm360: Number(center.toFixed(3)) };
  }
  if (roll < 2 / 3) {
    return {
      kind: "plus",
      cm360: Number((center * (1 + PROBE_REL_STEP)).toFixed(3)),
    };
  }
  return {
    kind: "minus",
    cm360: Number((center * (1 - PROBE_REL_STEP)).toFixed(3)),
  };
}

/**
 * baselineProxyFromLogs averages recent aim proxies near the recommended cm/360.
 * Returns null when fewer than two matching sessions exist (caller treats as soft).
 */
export function baselineProxyFromLogs(
  logs: AimSessionLogEntry[],
  recommendedCm360: number,
): number | null {
  const matched = logs
    .filter((e) => {
      if (e.cm360 === null) return false;
      const denom = Math.max(recommendedCm360, e.cm360, 1e-6);
      return Math.abs(e.cm360 - recommendedCm360) / denom <= BASELINE_MATCH_REL;
    })
    .slice(-6);
  if (matched.length < 2) return null;
  const values = matched.map((e) =>
    proxyObjFromSession({
      accuracy: e.accuracy,
      avgKillTime: e.avgKillTime,
      score: e.score,
    }),
  );
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * evaluateProbe compares this round's proxy to the baseline neighborhood mean.
 * baseline kind is always inconclusive for direction; plus/minus use PROXY_EDGE.
 */
export function evaluateProbe(input: {
  kind: ProbeKind;
  probeProxy: number;
  baselineProxy: number | null;
}): ProbeVerdict {
  if (input.kind === "baseline") return "inconclusive";
  if (input.baselineProxy === null) return "inconclusive";
  if (input.probeProxy >= input.baselineProxy + PROXY_EDGE) return "agree";
  if (input.probeProxy + PROXY_EDGE < input.baselineProxy) return "worse";
  return "inconclusive";
}

/**
 * recommendationToCalibShape maps a stored recommendation into CalibRecommendation
 * fields required by applyHistoryFusion (obj/sub peaks fall back to the point).
 */
export function recommendationToCalibShape(
  rec: SensitivityRecommendation,
): CalibRecommendation {
  return {
    cm360: rec.cm360,
    cm360Low: rec.cm360Low,
    cm360High: rec.cm360High,
    cm360ObjBest: rec.cm360,
    cm360SubBest: rec.cm360,
    sObj: rec.sObj,
    sSub: rec.sSub,
    verified: rec.verified,
    confidence: rec.confidence ?? 0.5,
    taskFamily: rec.taskFamily,
    explanation: "日常 ±5% 精修探测后的更新。",
  };
}

/**
 * applyProbeToRecommendation fuses or penalizes the latest recommendation in place.
 * agree on plus/minus treats the probe cm/360 as an unverified corroborating prior;
 * worse widens the interval and multiplies confidence by 0.9; inconclusive is a no-op.
 * Does not touch settings — callers decide whether to adopt the probe gain.
 */
export function applyProbeToRecommendation(
  rec: SensitivityRecommendation,
  plan: ProbePlan,
  verdict: ProbeVerdict,
  now: number,
): SensitivityRecommendation {
  if (verdict === "inconclusive" || plan.kind === "baseline") {
    return rec;
  }

  if (verdict === "agree") {
    const asCalib = recommendationToCalibShape(rec);
    const prior: ConfidenceHistoryEntry = {
      cm360: plan.cm360,
      taskFamily: rec.taskFamily as TaskFamily,
      verified: false,
      createdAt: now,
    };
    // Fuse keeps the stored point as anchor and pulls toward the better probe.
    const fused = applyHistoryFusion(asCalib, [prior], now);
    return {
      ...rec,
      cm360: fused.cm360,
      cm360Low: fused.cm360Low,
      cm360High: fused.cm360High,
      confidence: fused.confidence,
    };
  }

  // worse: keep point, widen band, soft-penalize confidence
  const widen = 1.04;
  return {
    ...rec,
    cm360Low: rec.cm360Low * (2 - widen),
    cm360High: rec.cm360High * widen,
    confidence: Math.max(0.2, (rec.confidence ?? 0.5) * 0.9),
  };
}

/**
 * probeAdoptAvailable reports whether the UI should offer writing probe gain.
 */
export function probeAdoptAvailable(
  plan: ProbePlan | null,
  verdict: ProbeVerdict | null,
): boolean {
  return (
    plan !== null &&
    verdict === "agree" &&
    (plan.kind === "plus" || plan.kind === "minus")
  );
}
