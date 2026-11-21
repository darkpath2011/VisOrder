/**
 * session.ts runs one aim round: countdown → timed shooting → ended HUD snapshot.
 * Scoring follows the Aim Lab community approximation; optional look-delta hooks
 * accumulate overshoot/reversal proxies for sensitivity calibration without changing
 * normal mode scoring.
 */

import * as THREE from 'three'
import type { ModeConfig } from '../modes/types'
import { TargetManager } from './target'
import { SoundFX } from './audio'

/**
 * Points awarded per kill (Aim Lab community approximate score ≈ kills × 1000).
 */
export const POINTS_PER_KILL = 1000

/** Miss penalty is one-tenth of a kill; score never goes below zero. */
export const MISS_PENALTY = 100

export type Phase = 'idle' | 'countdown' | 'running' | 'ended'

/** HUD snapshot pushed to React when values change. */
export interface HudState {
  phase: Phase
  countdown: number
  timeLeft: number
  score: number
  hits: number
  shots: number
  accuracy: number // 0-100
  /** Mean seconds per kill; null when no hits yet. */
  avgKillTime: number | null
  /** Mean peak overshoot past the nearest target in degrees (calib). */
  meanOvershootDeg?: number
  /** Mean horizontal direction reversals per kill (calib). */
  meanReversals?: number
}

/**
 * GameSession owns one round's state machine, scoring, and optional kinematics.
 *
 * Flow: countdown(3s) → running(duration) → ended. Hits award POINTS_PER_KILL;
 * misses subtract MISS_PENALTY. When kinematics are enabled, look deltas update
 * reversal counts and angular-error peaks used by sens-finder S_obj.
 */
export class GameSession {
  private targets: TargetManager
  private sound = new SoundFX()
  private raycaster = new THREE.Raycaster()
  private aimPoint = new THREE.Vector2(0, 0)
  private phase: Phase = 'idle'
  private countdown = 0
  private timeLeft: number
  private score = 0
  private hits = 0
  private shots = 0
  private lastHud: HudState | null = null
  private onHudCb: ((s: HudState) => void) | null = null
  private onEndCb: ((s: HudState) => void) | null = null

  /** When true, noteLookDelta gathers overshoot/reversal proxies. */
  private kinematicsEnabled = false
  private lastDxSign = 0
  private reversals = 0
  private overshootSumDeg = 0
  private overshootSamples = 0
  private currentPeakErrDeg = 0
  private passedMinErr = false
  private minErrDeg = Infinity
  private readonly camDir = new THREE.Vector3()
  private readonly toTarget = new THREE.Vector3()

  constructor(
    scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private config: ModeConfig,
    targetColor?: string,
  ) {
    this.timeLeft = config.duration
    this.targets = new TargetManager(scene, config, targetColor)
  }

  setTargetColor(color: string): void {
    this.targets.setColor(color)
  }

  /**
   * setKinematicsEnabled turns on look-delta proxies for calibration trials.
   * Call before start(); ordinary menu modes leave this false.
   */
  setKinematicsEnabled(enabled: boolean): void {
    this.kinematicsEnabled = enabled
  }

  set onHud(cb: ((s: HudState) => void) | null) {
    this.onHudCb = cb
  }

  set onEnd(cb: ((s: HudState) => void) | null) {
    this.onEndCb = cb
  }

  /** Starts a round: reset counters, spawn targets, enter countdown. */
  start(): void {
    this.phase = 'countdown'
    this.countdown = 3
    this.score = 0
    this.hits = 0
    this.shots = 0
    this.timeLeft = this.config.duration
    this.lastDxSign = 0
    this.reversals = 0
    this.overshootSumDeg = 0
    this.overshootSamples = 0
    this.currentPeakErrDeg = 0
    this.passedMinErr = false
    this.minErrDeg = Infinity
    this.sound.prepare()
    this.targets.spawnAll()
    this.emitHud()
  }

  /**
   * noteLookDelta records horizontal look motion for reversal/overshoot proxies.
   * Engine calls this from rotate when a session is attached; no-ops unless kinematics on.
   */
  noteLookDelta(dxRad: number): void {
    if (!this.kinematicsEnabled || this.phase !== 'running') return
    const sign = dxRad === 0 ? 0 : dxRad > 0 ? 1 : -1
    if (sign !== 0 && this.lastDxSign !== 0 && sign !== this.lastDxSign) {
      // Count a correction only when the user clearly reverses yaw direction.
      this.reversals++
    }
    if (sign !== 0) this.lastDxSign = sign

    const errDeg = this.nearestTargetErrorDeg()
    if (errDeg === null) return
    if (errDeg < this.minErrDeg) {
      this.minErrDeg = errDeg
      this.passedMinErr = true
      this.currentPeakErrDeg = errDeg
    } else if (this.passedMinErr && errDeg > this.currentPeakErrDeg) {
      // After closing on a target, further growth is treated as overshoot.
      this.currentPeakErrDeg = errDeg
    }
  }

  /** Fires at screen center under pointer lock. */
  shoot(): void {
    if (this.phase !== 'running') return
    this.shots++
    this.raycaster.setFromCamera(this.aimPoint, this.camera)
    const hit = this.targets.raycast(this.raycaster)
    if (hit) {
      this.hits++
      this.score += POINTS_PER_KILL
      if (this.kinematicsEnabled) {
        this.overshootSumDeg += Math.max(
          0,
          this.currentPeakErrDeg - this.minErrDeg,
        )
        this.overshootSamples++
        this.minErrDeg = Infinity
        this.passedMinErr = false
        this.currentPeakErrDeg = 0
      }
      this.targets.hit(hit)
      this.sound.hit()
    } else {
      this.score = Math.max(0, this.score - MISS_PENALTY)
      this.sound.miss()
    }
    this.emitHud()
  }

  /** Per-frame driver invoked by Engine. */
  tick(dt: number): void {
    if (this.phase === 'countdown') {
      this.countdown -= dt
      if (this.countdown <= 0) {
        this.countdown = 0
        this.phase = 'running'
      }
      this.emitHud()
    } else if (this.phase === 'running') {
      this.timeLeft -= dt
      if (this.timeLeft <= 0) {
        this.timeLeft = 0
        this.phase = 'ended'
        this.emitHud()
        this.onEndCb?.(this.hud())
      } else {
        this.emitHud()
      }
    }
  }

  dispose(): void {
    this.targets.dispose()
    this.sound.dispose()
  }

  private nearestTargetErrorDeg(): number | null {
    this.camera.getWorldDirection(this.camDir)
    let best: number | null = null
    this.targets.forEachTarget((mesh) => {
      this.toTarget.subVectors(mesh.position, this.camera.position).normalize()
      const dot = Math.max(-1, Math.min(1, this.camDir.dot(this.toTarget)))
      const deg = (Math.acos(dot) * 180) / Math.PI
      if (best === null || deg < best) best = deg
    })
    return best
  }

  private hud(): HudState {
    const elapsed = this.config.duration - this.timeLeft
    const base: HudState = {
      phase: this.phase,
      countdown: Math.max(0, Math.ceil(this.countdown)),
      timeLeft: Math.max(0, Math.ceil(this.timeLeft)),
      score: this.score,
      hits: this.hits,
      shots: this.shots,
      accuracy: this.shots === 0 ? 0 : (this.hits / this.shots) * 100,
      avgKillTime: this.hits === 0 ? null : elapsed / this.hits,
    }
    if (this.kinematicsEnabled) {
      base.meanOvershootDeg =
        this.overshootSamples === 0
          ? 0
          : this.overshootSumDeg / this.overshootSamples
      base.meanReversals = this.hits === 0 ? 0 : this.reversals / this.hits
    }
    return base
  }

  /** Emits only when HUD numbers change to avoid React spam. */
  private emitHud(): void {
    const hud = this.hud()
    const prev = this.lastHud
    if (
      !prev ||
      prev.phase !== hud.phase ||
      prev.countdown !== hud.countdown ||
      prev.timeLeft !== hud.timeLeft ||
      prev.score !== hud.score ||
      prev.hits !== hud.hits ||
      prev.shots !== hud.shots
    ) {
      this.lastHud = hud
      this.onHudCb?.(hud)
    }
  }
}
