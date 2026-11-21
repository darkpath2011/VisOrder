/**
 * cognitivePrior.ts turns recent cognitive suite/drill outcomes into search priors.
 * It never emits an in-game sensitivity: outputs are only width, confidence discount,
 * and a defer gate so fatigued sessions do not drive S*(G) estimates.
 */

import { readSessions, readSuiteRuns } from "@/lib/training-history";
import type { DrillResult } from "@/lib/trainings";

/** Prior used to narrow the sens-finder cm/360 grid and discount confidence. */
export type CognitivePrior = {
  /** Multiplier on geometric grid span; 1 = full DEFAULT_GAIN_FACTORS width. */
  priorWidthScale: number;
  /** Multiplier applied to fit confidence after calibration. */
  confidenceDiscount: number;
  /** When true, wizard should warn/block starting a new calibration. */
  deferCalibration: boolean;
  /** Short Chinese reason for UI. */
  reason: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * computeCognitivePrior inspects recent drills/suites and returns range/gate knobs.
 * Attention/inhibition speed and accuracy adjust width and confidence only.
 */
export function computeCognitivePrior(now = Date.now()): CognitivePrior {
  const sessions = readSessions().filter((s) => now - s.completedAt < 7 * DAY_MS);
  const suites = readSuiteRuns().filter((s) => now - s.completedAt < 7 * DAY_MS);

  if (sessions.length === 0 && suites.length === 0) {
    return {
      priorWidthScale: 1,
      confidenceDiscount: 0.85,
      deferCalibration: false,
      reason: "暂无认知训练记录，使用默认搜索宽度。",
    };
  }

  const recentSuite = suites[suites.length - 1];
  const drillLike: DrillResult[] =
    recentSuite?.results ??
    sessions.slice(-6).map((s) => ({
      trainingId: s.trainingId,
      durationMs: s.durationMs,
      accuracy: s.accuracy,
      detail: s.detail,
    }));

  const schulte = drillLike.filter((d) => d.trainingId === "schulte");
  const interference = drillLike.filter(
    (d) =>
      d.trainingId === "stroop" ||
      d.trainingId === "number-size" ||
      d.trainingId === "reverse-cue",
  );

  const schulteSlow =
    schulte.length > 0 &&
    average(schulte.map((d) => d.durationMs)) > 45000;
  const interferenceInaccurate =
    interference.length > 0 &&
    average(interference.map((d) => d.accuracy ?? 1)) < 0.7;

  // Very poor recent suite → defer rather than fit a noisy S*.
  if (schulteSlow && interferenceInaccurate) {
    return {
      priorWidthScale: 1,
      confidenceDiscount: 0.5,
      deferCalibration: true,
      reason: "近期认知套件偏慢且干扰错误偏多，建议休息后再校准。",
    };
  }

  // Fast/accurate attention → slightly narrower search (stronger prior around S0).
  const schulteFast =
    schulte.length > 0 &&
    average(schulte.map((d) => d.durationMs)) < 25000;
  const interferenceGood =
    interference.length === 0 ||
    average(interference.map((d) => d.accuracy ?? 1)) >= 0.85;

  if (schulteFast && interferenceGood) {
    return {
      priorWidthScale: 0.75,
      confidenceDiscount: 1,
      deferCalibration: false,
      reason: "近期注意/抑制表现稳定，已收窄增益搜索范围。",
    };
  }

  if (schulteSlow || interferenceInaccurate) {
    return {
      priorWidthScale: 1.15,
      confidenceDiscount: 0.8,
      deferCalibration: false,
      reason: "近期认知表现波动，搜索范围略放宽并降低置信。",
    };
  }

  return {
    priorWidthScale: 1,
    confidenceDiscount: 0.95,
    deferCalibration: false,
    reason: "已结合近期认知训练作为先验，不直接改动感度。",
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
