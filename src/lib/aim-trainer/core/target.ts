import * as THREE from 'three'
import type { ModeConfig } from '../modes/types'

/**
 * target.ts owns the pooled target meshes for one aim round.
 * It spawns a fixed count, respawns on hit inside the mode plane, and exposes
 * raycast plus forEachTarget so calibration can sample angular error without
 * allocating per frame.
 */
export class TargetManager {
  private targets: THREE.Mesh[] = []
  private intersections: THREE.Intersection[] = []
  /** 复用候选位置 buffer，避免命中重生路径上的对象分配（GC 卡顿来源） */
  private readonly pos = new THREE.Vector3()
  private readonly geometry = new THREE.SphereGeometry(1, 24, 24)
  private readonly material: THREE.MeshStandardMaterial

  constructor(
    private scene: THREE.Scene,
    private config: ModeConfig,
    color?: string,
  ) {
    const targetColor = new THREE.Color(color ?? config.target.color)
    this.material = new THREE.MeshStandardMaterial({
      color: targetColor,
      emissive: targetColor.clone().multiplyScalar(0.35),
      emissiveIntensity: 1.5,
      roughness: 0.35,
      metalness: 0.2,
    })
  }

  setColor(color: string): void {
    const targetColor = new THREE.Color(color)
    this.material.color.copy(targetColor)
    this.material.emissive.copy(targetColor).multiplyScalar(0.35)
    this.material.needsUpdate = true
  }

  /** 生成配置数量的目标（开局调用一次） */
  spawnAll(): void {
    for (let i = 0; i < this.config.targetCount; i++) {
      this.spawnOne()
    }
  }

  /** 命中：立即在限定靶面内换位，始终保持完整目标数。 */
  hit(mesh: THREE.Mesh): void {
    mesh.position.copy(this.pickFreePosition(mesh))
    mesh.updateMatrixWorld()
  }

  /**
   * 从相机中心发出一条射线做命中检测。
   * 返回被命中的目标 mesh，未命中返回 null。
   */
  raycast(raycaster: THREE.Raycaster): THREE.Mesh | null {
    this.intersections.length = 0
    raycaster.intersectObjects(this.targets, false, this.intersections)
    const hit = this.intersections[0]?.object as THREE.Mesh | undefined
    return hit ?? null
  }

  /**
   * forEachTarget invokes fn for every live target mesh.
   * Used by calibration kinematics to sample angular error to the nearest sphere.
   */
  forEachTarget(fn: (mesh: THREE.Mesh) => void): void {
    for (const mesh of this.targets) fn(mesh)
  }

  dispose(): void {
    for (const mesh of this.targets) {
      this.scene.remove(mesh)
    }
    this.geometry.dispose()
    this.material.dispose()
    this.targets = []
  }

  private spawnOne(): void {
    const mesh = new THREE.Mesh(this.geometry, this.material)
    mesh.castShadow = true
    mesh.scale.setScalar(this.config.target.radius)
    mesh.position.copy(this.pickFreePosition())
    this.scene.add(mesh)
    this.targets.push(mesh)
  }

  /** 生成不与现有目标重叠的位置（最多尝试 10 次），零分配 */
  private pickFreePosition(ignore?: THREE.Mesh): THREE.Vector3 {
    const minDist =
      this.config.minTargetDistance ?? this.config.target.radius * 3
    const minDistSq = minDist * minDist
    for (let i = 0; i < 10; i++) {
      this.config.spawnPosition(Math.random, this.pos)
      const moved = !ignore || ignore.position.distanceToSquared(this.pos) >= minDistSq
      const free =
        moved &&
        this.targets.every(
          (mesh) =>
            mesh === ignore ||
            mesh.position.distanceToSquared(this.pos) >= minDistSq,
        )
      if (free) return this.pos
    }
    // 兜底：接受最后一个候选
    this.config.spawnPosition(Math.random, this.pos)
    return this.pos
  }
}
