import type { ModeConfig } from './types'
import { spawnOnTargetPlane } from './targetPlane'

/**
 * 网格射击（Gridshot）
 *
 * 玩法对齐 Aim Lab：同时 3 个大球，分布在玩家正前方的固定靶面，
 * 命中一个立即在同一靶面的随机空位重生，保持 3 个恒定。
 * 60 秒。目标为红色发光球体（比六目标大）。
 */
export const gridshotConfig: ModeConfig = {
  id: 'gridshot',
  name: '网格射击（终极）',
  nameEn: 'GRIDSHOT ULTIMATE',
  duration: 60,
  targetCount: 3,
  target: {
    color: 0xf4f6ff,
    emissive: 0x63718a,
    radius: 0.37,
  },
  spawnPosition: spawnOnTargetPlane,
}
