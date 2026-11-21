/**
 * sensFinder.ts defines short Fitts-variant pointing configs for sensitivity calibration.
 * These modes are not high-score menu entries; the calib wizard launches them with
 * controlled (D, W) mixes so gain recommendations are not biased to one difficulty.
 * Targets stay on TARGET_PLANE (in front of the back wall) so spheres never clip through
 * the rear partition with only a “peeking” cap visible.
 */

import * as THREE from "three";
import { TARGET_PLANE } from "./targetPlane";
import type { ModeConfig } from "./types";
import type { FittsVariant } from "../calib/types";

/** Short trial length keeps multi-gain blocks under a few minutes. */
const TRIAL_DURATION_SEC = 12;

/**
 * spawnInBand writes a random point in a horizontal/vertical band on the aim plane.
 * y is clamped so the full sphere stays above the floor and inside the board.
 */
function spawnInBand(
  xSpan: number,
  yMin: number,
  yMax: number,
  radius: number,
  rng: () => number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const half = Math.min(xSpan, TARGET_PLANE.maxX - radius);
  const x = (rng() * 2 - 1) * half;
  // Keep the whole ball clear of the floor and within the visible board band.
  const lo = Math.max(yMin, TARGET_PLANE.minY, radius + 0.08);
  const hi = Math.min(yMax, TARGET_PLANE.maxY - radius);
  const y = lo >= hi ? lo : lo + rng() * (hi - lo);
  // Same depth as gridshot — well in front of the back wall at AIM_TRAINER_ROOM.backZ.
  return out.set(x, y, TARGET_PLANE.z);
}

/** Far / large targets: long travel, forgiving width (flick-biased). */
export const sensFinderFarLarge: ModeConfig = {
  id: "sens-finder-far-large",
  name: "感度校准 · 远距大靶",
  nameEn: "SENS FINDER FAR LARGE",
  duration: TRIAL_DURATION_SEC,
  targetCount: 2,
  target: { color: 0xf4f6ff, emissive: 0x63718a, radius: 0.42 },
  spawnPosition: (rng, out) => spawnInBand(2.4, 1.2, 2.6, 0.42, rng, out),
};

/** Far / small targets: long travel, precise stop. */
export const sensFinderFarSmall: ModeConfig = {
  id: "sens-finder-far-small",
  name: "感度校准 · 远距小靶",
  nameEn: "SENS FINDER FAR SMALL",
  duration: TRIAL_DURATION_SEC,
  targetCount: 2,
  target: { color: 0xf4f6ff, emissive: 0x63718a, radius: 0.22 },
  spawnPosition: (rng, out) => spawnInBand(2.4, 1.2, 2.6, 0.22, rng, out),
};

/** Near / small targets: short travel, pixel-ish precision (micro-biased). */
export const sensFinderNearSmall: ModeConfig = {
  id: "sens-finder-near-small",
  name: "感度校准 · 近距小靶",
  nameEn: "SENS FINDER NEAR SMALL",
  duration: TRIAL_DURATION_SEC,
  targetCount: 2,
  target: { color: 0xf4f6ff, emissive: 0x63718a, radius: 0.2 },
  spawnPosition: (rng, out) => spawnInBand(1.0, 1.4, 2.2, 0.2, rng, out),
};

/**
 * modeForVariant returns the ModeConfig for a Fitts difficulty tag.
 */
export function modeForVariant(variant: FittsVariant): ModeConfig {
  if (variant === "farLarge") return sensFinderFarLarge;
  if (variant === "farSmall") return sensFinderFarSmall;
  return sensFinderNearSmall;
}

/**
 * pickVariant chooses a Fitts variant; balanced mixes all three equally.
 */
export function pickVariant(
  family: "balanced" | "flick" | "micro",
  rng: () => number = Math.random,
): FittsVariant {
  if (family === "flick") {
    return rng() < 0.55 ? "farSmall" : "farLarge";
  }
  if (family === "micro") {
    return rng() < 0.65 ? "nearSmall" : "farSmall";
  }
  const r = rng();
  if (r < 0.34) return "farLarge";
  if (r < 0.67) return "farSmall";
  return "nearSmall";
}
