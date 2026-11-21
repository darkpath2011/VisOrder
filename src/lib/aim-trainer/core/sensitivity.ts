/**
 * sensitivity.ts converts profile + in-game sens into radians per mouse count.
 * Built-in profiles supply yaw/FOV; an optional rotation expression lets users
 * replace the default sens*yaw*pi/180 mapping from the control settings panel.
 * Peace Elite (pubg-exp) and Minecraft Java use effective °/count from
 * degPerCountForProfile so the trainer camera matches their non-linear curves
 * used for cm/360, without multiplying sens a second time in the expression.
 */

import {
  DEFAULT_ROTATION_EXPR,
  evaluateExpression,
  rotationScope,
} from "./expression";
import { degPerCountForProfile } from "./gain";
import {
  clampSensitivity,
  gainModelOf,
  type GameProfile,
} from "../store/profiles";

/**
 * radPerPixel converts native game sensitivity to radians per unaccelerated count.
 * When rotationExpr is omitted or invalid, the classic Aim Lab-style formula is used
 * so a bad custom expression never leaves the camera stuck at NaN.
 */
export function radPerPixel(
  profile: GameProfile,
  sensitivity: number,
  rotationExpr: string = DEFAULT_ROTATION_EXPR,
): number {
  const sens = clampSensitivity(profile, sensitivity);
  const degPerCount = degPerCountForProfile(profile, sens);
  const model = gainModelOf(profile);

  // Non-linear archives already bake sens into degPerCount — do not multiply again.
  if (model === "pubg-exp" || model === "minecraft") {
    const scope = rotationScope(sens, degPerCount, profile.verticalFovDeg);
    if (rotationExpr && rotationExpr !== DEFAULT_ROTATION_EXPR) {
      const custom = evaluateExpression(rotationExpr, scope);
      if (custom.ok && custom.value >= 0) {
        return custom.value;
      }
    }
    return (degPerCount * Math.PI) / 180;
  }

  const scope = rotationScope(sens, profile.yawDeg, profile.verticalFovDeg);
  const custom = evaluateExpression(rotationExpr, scope);
  if (custom.ok && custom.value >= 0) {
    return custom.value;
  }
  const fallback = evaluateExpression(DEFAULT_ROTATION_EXPR, scope);
  return fallback.ok ? fallback.value : (sens * profile.yawDeg * Math.PI) / 180;
}
