import type { ModeConfig } from './types'
import { spawnOnTargetPlane } from './targetPlane'

/** 六目标（初级）：保留六目标玩法，以接近参考图的双倍目标直径降低精度门槛。 */
export const sixshotBeginnerConfig: ModeConfig = {
  id: 'sixshot-beginner',
  name: '六目标（初级）',
  nameEn: 'SIXSHOT BEGINNER',
  duration: 60,
  targetCount: 6,
  target: {
    color: 0xf4f6ff,
    emissive: 0x63718a,
    radius: 0.11,
  },
  minTargetDistance: 0.42,
  spawnPosition: spawnOnTargetPlane,
}
