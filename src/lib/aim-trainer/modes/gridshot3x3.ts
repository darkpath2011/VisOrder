import type { ModeConfig } from './types'
import { spawnOn3x3Grid } from './targetPlane'

/**
 * 网格射击（3×3）
 *
 * 与终极模式使用相同大小的三个目标，但目标只会出现在屏幕中心的
 * 九个固定槽位中。较短且规则的转枪距离适合入门和稳定节奏训练。
 */
export const gridshot3x3Config: ModeConfig = {
  id: 'gridshot-3x3',
  name: '网格射击（3×3）',
  nameEn: 'GRIDSHOT 3X3',
  duration: 60,
  targetCount: 3,
  target: {
    color: 0xf4f6ff,
    emissive: 0x63718a,
    radius: 0.37,
  },
  minTargetDistance: 0.9,
  spawnPosition: spawnOn3x3Grid,
}
