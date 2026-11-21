import { getSoundSettings, type HitSoundId } from '../store/sound'

/**
 * 音效 —— Web Audio 现场合成，零素材、零体积。
 * 首次播放时创建 AudioContext（此时必在用户手势内，满足浏览器策略）。
 */
export class SoundFX {
  private ctx: AudioContext | null = null
  private noiseBuffer: AudioBuffer | null = null

  /** 在开局手势中初始化，避免第一次射击时创建音频图造成掉帧。 */
  prepare(): void {
    try {
      this.ensure()
    } catch {
      // 音频不可用时静默降级
    }
  }

  /**
   * 命中音：清脆悦耳的"叮"。
   * 基础正弦音 + 高八度泛音（增加光泽）+ 短噪声瞬态（弹珠般的起始感），
   * 快速指数衰减，不刺耳。
   */
  hit(): void {
    const settings = getSoundSettings()
    if (settings.muted || settings.effectsVolume === 0) return
    const now = this.ensureTime()
    if (now === null) return
    const volume = settings.effectsVolume / 100
    this.playHit(settings.hitSoundId, volume, now)
  }

  previewHit(soundId: HitSoundId, volume: number): void {
    const now = this.ensureTime()
    if (now === null) return
    this.playHit(soundId, Math.max(0, Math.min(1, volume)), now)
  }

  /** 空枪音：低沉短促，带一点摩擦感 */
  miss(): void {
    const settings = getSoundSettings()
    if (settings.muted || settings.effectsVolume === 0) return
    const now = this.ensureTime()
    if (now === null) return
    const volume = settings.effectsVolume / 100
    this.tone(150, 0.1, 0.14 * volume, 'triangle', now)
    this.click(0.015, now, volume, 3200)
  }

  private playHit(soundId: HitSoundId, volume: number, at: number): void {
    switch (soundId) {
      case 'soft':
        this.tone(620, 0.12, 0.12 * volume, 'sine', at)
        this.tone(930, 0.09, 0.045 * volume, 'triangle', at + 0.012)
        this.click(0.018, at, 0.32 * volume, 1800)
        break
      case 'arcade':
        this.tone(520, 0.07, 0.085 * volume, 'square', at)
        this.tone(780, 0.085, 0.07 * volume, 'square', at + 0.035)
        this.click(0.018, at, 0.45 * volume, 2800)
        break
      case 'wood':
        this.tone(230, 0.08, 0.16 * volume, 'triangle', at)
        this.tone(345, 0.055, 0.06 * volume, 'sine', at + 0.008)
        this.click(0.045, at, 0.85 * volume, 520)
        break
      case 'crystal':
      default:
        this.tone(880, 0.14, 0.16 * volume, 'sine', at)
        this.tone(1760, 0.1, 0.05 * volume, 'sine', at)
        this.tone(2637, 0.06, 0.02 * volume, 'sine', at)
        this.click(0.03, at, volume, 3200)
        break
    }
  }

  dispose(): void {
    this.ctx?.close().catch(() => {})
    this.ctx = null
    this.noiseBuffer = null
  }

  /** 单个带指数衰减包络的音调 */
  private tone(
    freq: number,
    duration: number,
    gain: number,
    type: OscillatorType,
    at: number,
  ): void {
    const ctx = this.ctx
    if (!ctx) return
    try {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = type
      osc.frequency.value = freq
      g.gain.setValueAtTime(gain, at)
      g.gain.exponentialRampToValueAtTime(0.0001, at + duration)
      osc.connect(g)
      g.connect(ctx.destination)
      osc.start(at)
      osc.stop(at + duration + 0.05)
      osc.onended = () => {
        osc.disconnect()
        g.disconnect()
      }
    } catch {
      // 静默降级
    }
  }

  /** 高频噪声瞬态（敲击起始感），复用白噪声 buffer */
  private click(duration: number, at: number, volume: number, filterFrequency: number): void {
    const ctx = this.ctx
    if (!ctx) return
    try {
      if (!this.noiseBuffer) {
        this.noiseBuffer = this.makeNoiseBuffer(0.05)
      }
      const src = ctx.createBufferSource()
      src.buffer = this.noiseBuffer
      const hp = ctx.createBiquadFilter()
      hp.type = filterFrequency < 1000 ? 'lowpass' : 'highpass'
      hp.frequency.value = filterFrequency
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.07 * volume, at)
      g.gain.exponentialRampToValueAtTime(0.0001, at + duration)
      src.connect(hp)
      hp.connect(g)
      g.connect(ctx.destination)
      src.start(at)
      src.stop(at + duration + 0.01)
      src.onended = () => {
        src.disconnect()
        hp.disconnect()
        g.disconnect()
      }
    } catch {
      // 静默降级
    }
  }

  private ensureTime(): number | null {
    try {
      return this.ensure().currentTime
    } catch {
      return null
    }
  }

  private makeNoiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx as AudioContext
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1
    }
    return buffer
  }

  private ensure(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (!Ctor) throw new Error('Web Audio is unavailable')
      this.ctx = new Ctor()
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume()
    }
    return this.ctx
  }
}
