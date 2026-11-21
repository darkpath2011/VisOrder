import * as THREE from 'three'

/** 目标外观配置 */
export interface TargetStyle {
  color: number
  emissive: number
  /** 球体半径（世界单位） */
  radius: number
}

/**
 * 模式配置 —— 引擎与 UI 完全基于配置驱动。
 * 新增模式 = 新增一个配置文件，引擎代码零改动。
 */
export interface ModeConfig {
  id: string
  name: string
  nameEn: string
  /** 单局时长（秒） */
  duration: number
  /** 同时存在的目标数量 */
  targetCount: number
  target: TargetStyle
  /** 目标球心之间允许的最小距离；默认是目标半径的三倍。 */
  minTargetDistance?: number
  /**
   * 生成一个目标候选位置，写入 out 并返回（调用方提供复用 buffer，零分配）。
   * 不保证与已有目标不重叠，由 TargetManager 做间距去重。
   * rng 注入便于测试与复用。
   */
  spawnPosition(rng: () => number, out: THREE.Vector3): THREE.Vector3
}
