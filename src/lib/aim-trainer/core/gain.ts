/**
 * gain.ts converts between in-game sensitivity and physical Control-Display gain.
 * Search and recommendation use cm/360 so archives stay comparable across titles;
 * UI callers convert back with the active profile model and the user's DPI.
 * Linear games use sens×yawDeg; Peace Elite uses PUBG-exp; Minecraft Java uses the
 * cubic MouseHandler curve. Cross-game convertSensAcrossProfiles bridges via cm/360.
 */

import type { GameProfile } from "../store/profiles";
import {
  clampSensitivity,
  gainModelOf,
} from "../store/profiles";

/** Minimum accepted mouse DPI used when clamping user input. */
export const DPI_MIN = 100;
/** Maximum accepted mouse DPI used when clamping user input. */
export const DPI_MAX = 16000;

/** Soft lower bound for calibration search in cm/360 (very high gain). */
export const DEFAULT_CM360_MIN = 10;
/** Soft upper bound for calibration search in cm/360 (very low gain). */
export const DEFAULT_CM360_MAX = 80;

/**
 * clampDpi returns a finite DPI inside [DPI_MIN, DPI_MAX], or null when unset/invalid.
 * Callers treat null as "DPI not configured" and must block cm/360-dependent paths.
 */
export function clampDpi(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < DPI_MIN || rounded > DPI_MAX) {
    return Math.max(DPI_MIN, Math.min(DPI_MAX, rounded));
  }
  return rounded;
}

/**
 * edpi multiplies mouse DPI by in-game sens for same-game comparisons only.
 * Not meaningful for pubg-exp archives; UI should prefer cm/360 there.
 */
export function edpi(dpi: number, sensitivity: number): number {
  return dpi * sensitivity;
}

/**
 * minecraftDegPerCount evaluates Java MouseHandler °/count for a 0–200% slider.
 * Formula from decompiled code: 1.2 × (0.6 × (percent/200) + 0.2)³.
 */
export function minecraftDegPerCount(percent: number): number {
  const s = percent / 200;
  const f = 0.6 * s + 0.2;
  return 1.2 * f * f * f;
}

/**
 * minecraftPercentFromDegPerCount inverts the cubic slider for a target °/count.
 * Returns null when the angle is outside the vanilla 0–200% reachable range.
 */
export function minecraftPercentFromDegPerCount(
  degPerCount: number,
): number | null {
  if (!(degPerCount > 0)) return null;
  const root = Math.cbrt(degPerCount / 1.2);
  const s = (root - 0.2) / 0.6;
  if (!Number.isFinite(s)) return null;
  return s * 200;
}

/**
 * degPerCountForProfile returns degrees of yaw per mouse count at the given sens.
 * Linear: sens × yawDeg. pubg-exp: yawBase × 10^(sens / sensDecade).
 * Minecraft: cubic MouseHandler curve on the 0–200% slider.
 */
export function degPerCountForProfile(
  profile: GameProfile,
  sensitivity: number,
): number {
  const sens = clampSensitivity(profile, sensitivity);
  const model = gainModelOf(profile);
  if (model === "pubg-exp") {
    const base = profile.yawBase ?? 0.005;
    const decade = profile.sensDecade ?? 50;
    if (!(base > 0) || !(decade > 0)) return 0;
    return base * 10 ** (sens / decade);
  }
  if (model === "minecraft") {
    return minecraftDegPerCount(sens);
  }
  if (!(sens > 0) || !(profile.yawDeg > 0)) return 0;
  return sens * profile.yawDeg;
}

/**
 * cm360FromSens reports centimeters of mouse travel for a full 360° yaw turn.
 * Requires raw/unaccelerated input; returns null when dpi is missing or non-positive.
 */
export function cm360FromSens(
  profile: GameProfile,
  sensitivity: number,
  dpi: number | null,
): number | null {
  if (dpi === null || !(dpi > 0)) return null;
  const degPerCount = degPerCountForProfile(profile, sensitivity);
  if (!(degPerCount > 0)) return null;
  // cm/360 = 2.54 * 360 / (DPI * deg_per_count)
  return (2.54 * 360) / (dpi * degPerCount);
}

/**
 * sensFromCm360 converts a physical cm/360 target into profile in-game sensitivity.
 * Result is clamped to the profile range so callers can write settings safely.
 */
export function sensFromCm360(
  profile: GameProfile,
  cm360: number,
  dpi: number,
): number {
  if (!(cm360 > 0) || !(dpi > 0)) {
    return clampSensitivity(profile, profile.sensitivityRange.min);
  }
  const model = gainModelOf(profile);
  if (model === "pubg-exp") {
    const base = profile.yawBase ?? 0.005;
    const decade = profile.sensDecade ?? 50;
    if (!(base > 0) || !(decade > 0)) {
      return clampSensitivity(profile, profile.sensitivityRange.min);
    }
    // deg/count = base * 10^(sens/decade) = 2.54*360 / (dpi*cm360)
    const ratio = (2.54 * 360) / (dpi * cm360 * base);
    if (!(ratio > 0)) {
      return clampSensitivity(profile, profile.sensitivityRange.min);
    }
    const raw = decade * Math.log10(ratio);
    return clampSensitivity(profile, raw);
  }
  if (model === "minecraft") {
    const degPerCount = (2.54 * 360) / (dpi * cm360);
    const percent = minecraftPercentFromDegPerCount(degPerCount);
    if (percent === null) {
      return clampSensitivity(profile, profile.sensitivityRange.min);
    }
    return clampSensitivity(profile, percent);
  }
  if (!(profile.yawDeg > 0)) {
    return clampSensitivity(profile, profile.sensitivityRange.min);
  }
  const raw = (2.54 * 360) / (dpi * cm360 * profile.yawDeg);
  return clampSensitivity(profile, raw);
}

/** Result of converting one archive's sens into another while keeping cm/360. */
export type CrossProfileConversion = {
  /** Physical cm/360 taken from the source settings (same DPI). */
  cm360: number;
  /** Clamped in-game sensitivity for the target profile. */
  sensitivity: number;
  /** True when the exact cm/360 cannot be reached inside the target slider range. */
  clamped: boolean;
  /** Human-readable reason when conversion fails. */
  error: string | null;
};

/**
 * convertSensAcrossProfiles keeps cm/360 while mapping source sens → target archive.
 * Same DPI is assumed (hardware does not change when you open another game).
 * Returns an error when DPI is missing or source cm/360 cannot be computed.
 */
export function convertSensAcrossProfiles(
  sourceProfile: GameProfile,
  sourceSens: number,
  targetProfile: GameProfile,
  dpi: number | null,
): CrossProfileConversion {
  if (dpi === null || !(dpi > 0)) {
    return {
      cm360: 0,
      sensitivity: clampSensitivity(
        targetProfile,
        targetProfile.sensitivityRange.min,
      ),
      clamped: false,
      error: "请先填写鼠标 DPI",
    };
  }
  const cm360 = cm360FromSens(sourceProfile, sourceSens, dpi);
  if (cm360 === null || !(cm360 > 0)) {
    return {
      cm360: 0,
      sensitivity: clampSensitivity(
        targetProfile,
        targetProfile.sensitivityRange.min,
      ),
      clamped: false,
      error: "当前灵敏度无法换算，请检查档案与感度",
    };
  }

  if (gainModelOf(targetProfile) === "minecraft") {
    const degPerCount = (2.54 * 360) / (dpi * cm360);
    const exact = minecraftPercentFromDegPerCount(degPerCount);
    if (exact === null) {
      return {
        cm360,
        sensitivity: clampSensitivity(
          targetProfile,
          targetProfile.sensitivityRange.min,
        ),
        clamped: true,
        error: "目标 cm/360 超出我的世界 0–200% 可达范围",
      };
    }
    const clampedSens = clampSensitivity(targetProfile, exact);
    const clamped =
      Math.abs(clampedSens - exact) > targetProfile.sensitivityRange.step / 2;
    return {
      cm360,
      sensitivity: clampedSens,
      clamped,
      error: clamped
        ? "已钳到我的世界滑条边界，cm/360 会略有偏差"
        : null,
    };
  }

  const exactRaw =
    gainModelOf(targetProfile) === "pubg-exp"
      ? (() => {
          const base = targetProfile.yawBase ?? 0.005;
          const decade = targetProfile.sensDecade ?? 50;
          const ratio = (2.54 * 360) / (dpi * cm360 * base);
          return decade * Math.log10(ratio);
        })()
      : (2.54 * 360) / (dpi * cm360 * targetProfile.yawDeg);
  const clampedSens = clampSensitivity(targetProfile, exactRaw);
  const clamped =
    Math.abs(clampedSens - exactRaw) > targetProfile.sensitivityRange.step;
  return {
    cm360,
    sensitivity: clampedSens,
    clamped,
    error: clamped ? "已钳到目标游戏滑条边界，cm/360 会略有偏差" : null,
  };
}

/**
 * hardwareCm360Bounds returns soft search limits, optionally capped by mousepad width.
 * When deskCm is set, values needing more than ~0.9 of pad travel for 360° are excluded.
 */
export function hardwareCm360Bounds(deskCm?: number): {
  min: number;
  max: number;
} {
  let max = DEFAULT_CM360_MAX;
  if (typeof deskCm === "number" && deskCm > 0) {
    // Leave ~10% pad margin so clutching is still possible near the bound.
    max = Math.min(max, deskCm * 0.9);
  }
  return { min: DEFAULT_CM360_MIN, max: Math.max(DEFAULT_CM360_MIN + 1, max) };
}

/**
 * relativeCm360Grid builds a geometric (Weber-style) candidate grid around center.
 * factors are multiplicative offsets (e.g. [0.8, 0.9, 1, 1.1, 1.25]); duplicates
 * after clamping to bounds are removed so each condition maps to a distinct gain.
 */
export function relativeCm360Grid(
  center: number,
  factors: readonly number[],
  bounds: { min: number; max: number } = hardwareCm360Bounds(),
): number[] {
  const safeCenter = Number.isFinite(center) && center > 0 ? center : 30;
  const values: number[] = [];
  for (const factor of factors) {
    if (!(factor > 0)) continue;
    const raw = safeCenter * factor;
    const clamped = Math.max(bounds.min, Math.min(bounds.max, raw));
    const rounded = Number(clamped.toFixed(3));
    if (!values.some((v) => Math.abs(v - rounded) < 1e-6)) {
      values.push(rounded);
    }
  }
  return values.sort((a, b) => a - b);
}

/**
 * formatCm360 formats a cm/360 value for UI display with one decimal place.
 */
export function formatCm360(cm360: number | null): string {
  if (cm360 === null || !Number.isFinite(cm360)) return "—";
  return `${cm360.toFixed(1)} cm/360`;
}

/** Degrees per mouse count under a constant yaw (unaccelerated). */
export function degPerCount(sens: number, yawDeg: number): number {
  return sens * yawDeg;
}

/**
 * convertSensAcrossYaw keeps the same °/count when switching yaw multipliers.
 * Example: VALORANT sens 0.892 at yaw 0.07 → sens at yaw 0.0027 is ≈ 23.126.
 */
export function convertSensAcrossYaw(
  sens: number,
  fromYawDeg: number,
  toYawDeg: number,
): number {
  if (!(toYawDeg > 0) || !(fromYawDeg > 0) || !Number.isFinite(sens)) {
    return sens;
  }
  return (sens * fromYawDeg) / toYawDeg;
}

/**
 * rotationExprForYawFactor builds `sens * <yaw> * pi / 180` with a fixed yaw factor.
 */
export function rotationExprForYawFactor(yawFactor: number): string {
  const rounded = Number(yawFactor.toPrecision(6));
  return `sens * ${rounded} * pi / 180`;
}
