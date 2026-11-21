import { getSoundSettings } from '../store/sound'

/**
 * UI 交互音效 —— 按钮点击的轻快"嗒"声（Web Audio 现场合成，零素材）。
 * 由 App.vue 全局 click 委托触发，所有 <button> 自动带上点击反馈音。
 */
let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null

export function playUiClick(): void {
  const settings = getSoundSettings()
  if (settings.muted || settings.uiVolume === 0) return
  try {
    const c = ensure()
    if (!c) return
    const now = c.currentTime
    const volume = settings.uiVolume / 100
    tone(c, 1100, 0.05, 0.06 * volume, now)
    tone(c, 2200, 0.03, 0.018 * volume, now)
    click(c, now, volume)
  } catch {
    // 音频不可用时静默降级
  }
}

function tone(
  c: AudioContext,
  freq: number,
  duration: number,
  gain: number,
  at: number,
): void {
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  g.gain.setValueAtTime(gain, at)
  g.gain.exponentialRampToValueAtTime(0.0001, at + duration)
  osc.connect(g)
  g.connect(c.destination)
  osc.start(at)
  osc.stop(at + duration + 0.02)
  osc.onended = () => {
    osc.disconnect()
    g.disconnect()
  }
}

/** 高频噪声瞬态：指尖敲击的起始感 */
function click(c: AudioContext, at: number, volume: number): void {
  if (!noise) {
    const seconds = 0.04
    noise = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1
    }
  }
  const src = c.createBufferSource()
  src.buffer = noise
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 4000
  const g = c.createGain()
  g.gain.setValueAtTime(0.035 * volume, at)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.025)
  src.connect(hp)
  hp.connect(g)
  g.connect(c.destination)
  src.start(at)
  src.stop(at + 0.03)
  src.onended = () => {
    src.disconnect()
    hp.disconnect()
    g.disconnect()
  }
}

function ensure(): AudioContext | null {
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  if (ctx.state === 'suspended') {
    void ctx.resume()
  }
  return ctx
}
