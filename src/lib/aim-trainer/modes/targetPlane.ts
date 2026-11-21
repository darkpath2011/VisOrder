import * as THREE from 'three'

/**
 * Aim Lab-style target board in front of the starting camera.
 * Keeping every target on this world-space plane makes their size and depth
 * stable while the player turns their view.
 */
export const TARGET_PLANE = {
  z: -7,
  minX: -2.65,
  maxX: 2.65,
  minY: 0.9,
  maxY: 3.45,
} as const

export const AIM_TRAINER_ROOM = {
  width: 18,
  height: 7,
  backZ: -9,
  frontZ: 7,
} as const

export const GRIDSHOT_3X3 = {
  centerY: 2.15,
  spacing: 1,
} as const

export function spawnOnTargetPlane(
  rng: () => number,
  out: THREE.Vector3,
): THREE.Vector3 {
  return out.set(
    THREE.MathUtils.lerp(TARGET_PLANE.minX, TARGET_PLANE.maxX, rng()),
    THREE.MathUtils.lerp(TARGET_PLANE.minY, TARGET_PLANE.maxY, rng()),
    TARGET_PLANE.z,
  )
}

/** Returns one of nine fixed slots in the compact grid around screen center. */
export function spawnOn3x3Grid(
  rng: () => number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const slot = Math.min(8, Math.floor(rng() * 9))
  const column = slot % 3
  const row = Math.floor(slot / 3)

  return out.set(
    (column - 1) * GRIDSHOT_3X3.spacing,
    GRIDSHOT_3X3.centerY + (1 - row) * GRIDSHOT_3X3.spacing,
    TARGET_PLANE.z,
  )
}
