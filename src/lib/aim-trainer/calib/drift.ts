/**
 * drift.ts compares recent aim-session proxies at the recommended cm/360 to baseline.
 * When performance drops for several sessions after a verified calibration, the UI
 * surfaces a retest hint without changing the stored recommendation automatically.
 */

import { proxyObjFromSession } from "./metrics";
import { readAimSessionLog } from "../store/sessionLog";
import {
  loadRecommendation,
  type SensitivityRecommendation,
} from "../store/recommendation";

/** Result of a local drift check against the last verified recommendation. */
export type DriftStatus = {
  shouldRetest: boolean;
  message: string | null;
  recommendation: SensitivityRecommendation | null;
};

/** Relative cm/360 tolerance when matching aim logs to the recommendation. */
const CM360_MATCH_TOL = 0.08;
/** Minimum recent sessions near the recommended gain before flagging drift. */
const MIN_RECENT = 3;
/** Drop vs baseline mean that triggers a retest hint. */
const DROP_RATIO = 0.85;

/**
 * checkSensitivityDrift reads aim logs near the recommended gain and compares proxies.
 * Returns shouldRetest when the recent mean S_obj proxy falls below baseline * DROP_RATIO.
 */
export function checkSensitivityDrift(now = Date.now()): DriftStatus {
  const recommendation = loadRecommendation();
  if (!recommendation || !recommendation.verified) {
    return { shouldRetest: false, message: null, recommendation };
  }

  const log = readAimSessionLog().filter(
    (e) =>
      e.cm360 !== null &&
      Math.abs(e.cm360 - recommendation.cm360) / recommendation.cm360 <=
        CM360_MATCH_TOL,
  );
  if (log.length < MIN_RECENT + 2) {
    return { shouldRetest: false, message: null, recommendation };
  }

  // Baseline: earliest post-calib sessions near the gain; recent: latest N.
  const post = log.filter((e) => e.completedAt >= recommendation.createdAt);
  if (post.length < MIN_RECENT + 2) {
    return { shouldRetest: false, message: null, recommendation };
  }

  const baselineRows = post.slice(0, Math.min(3, post.length - MIN_RECENT));
  const recentRows = post.slice(-MIN_RECENT);
  const baseline =
    average(
      baselineRows.map((e) =>
        proxyObjFromSession({
          accuracy: e.accuracy,
          avgKillTime: e.avgKillTime,
          score: e.score,
        }),
      ),
    ) || 0;
  const recent =
    average(
      recentRows.map((e) =>
        proxyObjFromSession({
          accuracy: e.accuracy,
          avgKillTime: e.avgKillTime,
          score: e.score,
        }),
      ),
    ) || 0;

  if (baseline <= 0.05) {
    return { shouldRetest: false, message: null, recommendation };
  }

  const ageDays = (now - recommendation.createdAt) / (24 * 60 * 60 * 1000);
  if (recent < baseline * DROP_RATIO && ageDays >= 1) {
    return {
      shouldRetest: true,
      message:
        "近期在推荐增益附近的瞄准表现低于校准后基线，建议复测灵敏度。",
      recommendation,
    };
  }

  return { shouldRetest: false, message: null, recommendation };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
