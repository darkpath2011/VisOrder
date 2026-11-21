import type { ModeConfig } from './types'
import { spawnOnTargetPlane } from './targetPlane'

/**
 * 六目标（终极）
 *
 * 玩法对齐 Aim Lab：固定靶面区域恒定 6 个红色小球，互不重叠，
 * 命中即在同一靶面换位重生。60 秒。
 */
export const sixshotConfig: ModeConfig = {
  id: 'sixshot',
  name: '六目标（终极）',
  nameEn: 'SIXSHOT ULTIMATE',
  duration: 60,
  targetCount: 6,
  target: {
    color: 0xf4f6ff,
    emissive: 0x63718a,
    radius: 0.055,
  },
  spawnPosition: spawnOnTargetPlane,
}
