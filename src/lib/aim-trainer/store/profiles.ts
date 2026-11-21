/**
 * profiles.ts defines built-in game archives for Control-Display gain conversion.
 * Linear titles use constant yawDeg at sens=1; Peace Elite PC emulator uses the
 * PUBG-family exponential slider; Minecraft Java uses the documented cubic curve
 * so cross-game conversion can keep the same cm/360 when hopping titles.
 */

/** How in-game sensitivity maps to degrees per unaccelerated mouse count. */
export type GainModel = "linear" | "pubg-exp" | "minecraft";

export interface GameProfile {
  id: string;
  name: string;
  /**
   * Linear model only: degrees per mouse count at sensitivity 1.
   * Placeholder / unused for pubg-exp and minecraft (see yawBase / cubic).
   */
  yawDeg: number;
  /** Vertical world FOV matching the game's standard aspect-ratio behavior. */
  verticalFovDeg: number;
  sensitivityRange: { min: number; max: number; step: number };
  /**
   * Gain curve used by cm/360 and the trainer camera.
   * Defaults to linear when omitted so older profile objects stay valid.
   */
  gainModel?: GainModel;
  /**
   * pubg-exp: base degrees/count at sens=0 in LastConvertedSensitivity-style fits.
   * Community reference ≈ 0.005 for PUBG-family hipfire cm/360 (Lokx / config fits).
   */
  yawBase?: number;
  /**
   * pubg-exp: decade of the exponential slider; +sensDecade ≈ 10× rotation rate.
   * PUBG / 和平精英 camera sliders use 50.
   */
  sensDecade?: number;
  /**
   * Short unit label for the sensitivity slider (e.g. "%", empty for dimensionless).
   */
  sensUnit?: string;
}

const VALORANT_RANGE = { min: 0.001, max: 10, step: 0.001 };

/**
 * PEACE_ELITE_NOTE documents the two-layer emulator setup for UI copy.
 * Layer 1 is GameLoop/雷电 mouse sens; Layer 2 is the in-game 镜头灵敏度 slider.
 */
export const PEACE_ELITE_EMULATOR_NOTE =
  "请先固定模拟器鼠标灵敏度，再填游戏内「镜头灵敏度」。换算按 PUBG 系指数滑条近似，训练场请实测 360° 校验。";

/**
 * MINECRAFT_NOTE explains the cubic slider so users do not treat % as linear eDPI.
 */
export const MINECRAFT_NOTE =
  "我的世界 Java 灵敏度不是线性：°/count = 1.2×(0.6×%/200+0.2)³。滑条为游戏内显示的 0–200%。";

export const GAME_PROFILES: GameProfile[] = [
  {
    id: "valorant",
    name: "无畏契约 VALORANT",
    yawDeg: 0.07,
    // 103 degrees horizontal at 16:9.
    verticalFovDeg: 70.5328004329168,
    sensitivityRange: VALORANT_RANGE,
    gainModel: "linear",
  },
  {
    id: "cs2",
    name: "反恐精英 2 CS2",
    yawDeg: 0.022,
    // Source's 90-degree horizontal 4:3 base FOV (106.26 degrees at 16:9).
    verticalFovDeg: 73.739795291688,
    sensitivityRange: { min: 0.01, max: 8, step: 0.01 },
    gainModel: "linear",
  },
  {
    id: "apex",
    name: "Apex 英雄",
    yawDeg: 0.022,
    verticalFovDeg: 70.5328004329168,
    sensitivityRange: { min: 0.1, max: 8, step: 0.1 },
    gainModel: "linear",
  },
  {
    id: "peace-elite-emulator",
    name: "和平精英 · PC模拟器",
    // Placeholder for UI that still prints yawDeg; engine uses yawBase instead.
    yawDeg: 0.005,
    // Approximate third-person trainer FOV; Peace Elite FOV varies by mode.
    verticalFovDeg: 70.5328004329168,
    // In-game 镜头灵敏度 is typically 1–200 (integer).
    sensitivityRange: { min: 1, max: 200, step: 1 },
    gainModel: "pubg-exp",
    yawBase: 0.005,
    sensDecade: 50,
  },
  {
    id: "minecraft-java",
    name: "我的世界 Java",
    // At 100% the cubic evaluates to 0.15°/count (documented MouseHandler path).
    yawDeg: 0.15,
    verticalFovDeg: 70,
    sensitivityRange: { min: 0, max: 200, step: 0.1 },
    gainModel: "minecraft",
    sensUnit: "%",
  },
];

/**
 * findProfile returns the archive for id, or VALORANT when the id is unknown.
 */
export function findProfile(id: string): GameProfile {
  return GAME_PROFILES.find((profile) => profile.id === id) ?? GAME_PROFILES[0]!;
}

/**
 * sensitivityRangeOf returns the clamped slider bounds for a profile.
 */
export function sensitivityRangeOf(profile: GameProfile) {
  return profile.sensitivityRange;
}

/**
 * gainModelOf returns the active gain curve, defaulting to linear.
 */
export function gainModelOf(profile: GameProfile): GainModel {
  return profile.gainModel ?? "linear";
}

/**
 * isPubgExpProfile reports whether the archive uses the exponential slider model.
 */
export function isPubgExpProfile(profile: GameProfile): boolean {
  return gainModelOf(profile) === "pubg-exp";
}

/**
 * isMinecraftProfile reports whether the archive uses Minecraft's cubic slider.
 */
export function isMinecraftProfile(profile: GameProfile): boolean {
  return gainModelOf(profile) === "minecraft";
}

/**
 * clampSensitivity snaps a raw slider value onto the profile range and step.
 */
export function clampSensitivity(profile: GameProfile, value: number): number {
  const { min, max, step } = profile.sensitivityRange;
  const finiteValue = Number.isFinite(value) ? value : min;
  const clamped = Math.max(min, Math.min(max, finiteValue));
  const stepped = Math.round(clamped / step) * step;
  const precision = Math.max(0, Math.ceil(-Math.log10(step) || 0));
  return Number(stepped.toFixed(precision));
}
