import {
  getSoundSettings,
  type MusicTrackId,
  type SoundSettings,
} from '../store/sound'

/** Web Audio 实时生成的多曲目播放器，无外部版权素材。 */
export class MusicPlayer {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private timer: number | null = null
  private nextStepTime = 0
  private step = 0
  private settings: SoundSettings

  constructor(settings: SoundSettings = { ...getSoundSettings() }) {
    this.settings = { ...settings }
  }

  start(): void {
    if (!this.ensure()) return
    if (this.timer !== null) return
    const ctx = this.ctx as AudioContext
    this.nextStepTime = ctx.currentTime + 0.08
    this.step = 0
    this.timer = window.setInterval(() => this.schedule(), 25)
  }

  applySettings(settings: SoundSettings): void {
    const trackChanged = settings.trackId !== this.settings.trackId
    this.settings = { ...settings }
    const ctx = this.ctx
    const master = this.master
    if (ctx && master) {
      master.gain.cancelScheduledValues(ctx.currentTime)
      master.gain.setTargetAtTime(this.outputVolume(), ctx.currentTime, 0.035)
      if (trackChanged) {
        this.step = 0
        this.nextStepTime = ctx.currentTime + 0.08
      }
    }
  }

  setMuted(muted: boolean): void {
    this.applySettings({ ...this.settings, muted })
  }

  dispose(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.master?.disconnect()
    this.ctx?.close().catch(() => {})
    this.ctx = null
    this.master = null
    this.noiseBuffer = null
  }

  private schedule(): void {
    const ctx = this.ctx
    // 音频被挂起（未获用户手势）时不排新音符，避免恢复瞬间积压爆音
    if (!ctx || ctx.state !== 'running') return
    const stepDuration = this.stepDuration()
    while (this.nextStepTime < ctx.currentTime + 0.2) {
      this.playStep(this.step, this.nextStepTime, stepDuration)
      this.nextStepTime += stepDuration
      this.step++
    }
  }

  private playStep(step: number, time: number, stepDuration: number): void {
    const track = TRACKS[this.settings.trackId]
    const bar = Math.floor(step / 16)
    const inBar = step % 16
    const section = bar % 8 >= 4
    const variation = Math.floor(bar / 8) % 3
    const chord = track.progression[bar % track.progression.length]

    if (inBar === 0) {
      const upperIndex = variation === 1 ? 2 : 1
      this.pad(chord.notes[0], chord.notes[upperIndex], time, stepDuration, track.padWave)
    }

    const bassSpacing = track.rhythm === 'pulse' ? 4 : track.rhythm === 'night' ? 8 : 4
    if (inBar % bassSpacing === 0) {
      const octave = section && variation === 2 && inBar === 8 ? 2 : 1
      this.bass(chord.bass * octave, time, section ? 0.095 : 0.07, stepDuration)
    }

    const arpSpacing = track.rhythm === 'pulse' || (section && track.rhythm === 'focus') ? 2 : 4
    if (inBar % arpSpacing === 0 && !(track.rhythm === 'night' && inBar === 12)) {
      const index = (Math.floor(inBar / arpSpacing) + variation) % chord.notes.length
      const directionIndex = variation === 2 ? chord.notes.length - 1 - index : index
      const octave = track.rhythm === 'flow' ? 2 : section ? 4 : 2
      this.pluck(chord.notes[directionIndex] * octave, time, track.pluckWave)
    }

    if (this.shouldKick(track.rhythm, inBar, bar)) this.kick(time)
    if (this.shouldHat(track.rhythm, inBar, section, variation)) this.hat(time, section)

    if (section && inBar === (variation === 1 ? 8 : 0) && bar % 2 === 1) {
      const note = chord.notes[(bar + variation) % chord.notes.length]
      this.lead(note * (track.rhythm === 'night' ? 2 : 4), time, track.leadWave)
    }
  }

  private shouldKick(rhythm: Rhythm, inBar: number, bar: number): boolean {
    if (rhythm === 'pulse') return inBar % 4 === 0
    if (rhythm === 'night') return inBar === 0 || (bar % 2 === 1 && inBar === 10)
    if (rhythm === 'flow') return inBar === 0 || inBar === 8
    return inBar % 4 === 0
  }

  private shouldHat(
    rhythm: Rhythm,
    inBar: number,
    section: boolean,
    variation: number,
  ): boolean {
    if (rhythm === 'night') return inBar === 6 || (section && inBar === 14)
    if (rhythm === 'flow') return inBar % (section ? 4 : 8) === 2
    if (rhythm === 'pulse') return inBar % (variation === 2 ? 1 : 2) === 0
    return inBar % (section ? 2 : 4) === 0
  }

  private pad(
    first: number,
    second: number,
    time: number,
    stepDuration: number,
    wave: OscillatorType,
  ): void {
    const ctx = this.ctx as AudioContext
    const master = this.master as GainNode
    const duration = stepDuration * 18
    for (const frequency of [first, second]) {
      for (const detune of [-5, 5]) {
        const oscillator = ctx.createOscillator()
        const filter = ctx.createBiquadFilter()
        const gain = ctx.createGain()
        oscillator.type = wave
        oscillator.frequency.value = frequency
        oscillator.detune.value = detune
        filter.type = 'lowpass'
        filter.frequency.value = this.settings.trackId === 'night' ? 720 : 1150
        gain.gain.setValueAtTime(0.0001, time)
        gain.gain.exponentialRampToValueAtTime(0.022, time + 0.45)
        gain.gain.setValueAtTime(0.022, time + stepDuration * 14)
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration)
        oscillator.connect(filter)
        filter.connect(gain)
        gain.connect(master)
        oscillator.start(time)
        oscillator.stop(time + duration)
        oscillator.onended = () => {
          oscillator.disconnect()
          filter.disconnect()
          gain.disconnect()
        }
      }
    }
  }

  private bass(frequency: number, time: number, volume: number, stepDuration: number): void {
    const ctx = this.ctx as AudioContext
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.exponentialRampToValueAtTime(volume, time + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + stepDuration * 3.6)
    oscillator.connect(gain)
    gain.connect(this.master as GainNode)
    oscillator.start(time)
    oscillator.stop(time + stepDuration * 4)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
    }
  }

  private pluck(frequency: number, time: number, wave: OscillatorType): void {
    const ctx = this.ctx as AudioContext
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = wave
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.07, time)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18)
    oscillator.connect(gain)
    gain.connect(this.master as GainNode)
    oscillator.start(time)
    oscillator.stop(time + 0.2)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
    }
  }

  private kick(time: number): void {
    const ctx = this.ctx as AudioContext
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(132, time)
    oscillator.frequency.exponentialRampToValueAtTime(44, time + 0.1)
    gain.gain.setValueAtTime(0.1, time)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12)
    oscillator.connect(gain)
    gain.connect(this.master as GainNode)
    oscillator.start(time)
    oscillator.stop(time + 0.14)
  }

  private hat(time: number, open: boolean): void {
    const ctx = this.ctx as AudioContext
    this.noiseBuffer ??= this.makeNoiseBuffer()
    const source = ctx.createBufferSource()
    const filter = ctx.createBiquadFilter()
    const gain = ctx.createGain()
    source.buffer = this.noiseBuffer
    filter.type = 'highpass'
    filter.frequency.value = open ? 5400 : 7200
    const duration = open ? 0.1 : 0.045
    gain.gain.setValueAtTime(open ? 0.018 : 0.025, time)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(this.master as GainNode)
    source.start(time)
    source.stop(time + duration + 0.01)
  }

  private lead(frequency: number, time: number, wave: OscillatorType): void {
    const ctx = this.ctx as AudioContext
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = wave
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.045, time)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.55)
    oscillator.connect(gain)
    gain.connect(this.master as GainNode)
    oscillator.start(time)
    oscillator.stop(time + 0.58)
  }

  private makeNoiseBuffer(): AudioBuffer {
    const ctx = this.ctx as AudioContext
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.12), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1
    return buffer
  }

  private stepDuration(): number {
    return 60 / TRACKS[this.settings.trackId].bpm / 4
  }

  private outputVolume(): number {
    return this.settings.muted ? 0 : this.settings.musicVolume / 100
  }

  private ensure(): boolean {
    try {
      if (!this.ctx) {
        const Constructor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Constructor) return false
        this.ctx = new Constructor()
        this.master = this.ctx.createGain()
        this.master.gain.value = this.outputVolume()
        this.master.connect(this.ctx.destination)
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return true
    } catch {
      return false
    }
  }
}

type Rhythm = 'focus' | 'flow' | 'pulse' | 'night'

interface Chord {
  bass: number
  notes: number[]
}

interface TrackDefinition {
  bpm: number
  rhythm: Rhythm
  padWave: OscillatorType
  pluckWave: OscillatorType
  leadWave: OscillatorType
  progression: Chord[]
}

const TRACKS: Record<MusicTrackId, TrackDefinition> = {
  focus: {
    bpm: 104,
    rhythm: 'focus',
    padWave: 'sawtooth',
    pluckWave: 'triangle',
    leadWave: 'triangle',
    progression: [
      { bass: 110, notes: [220, 261.63, 329.63, 440] },
      { bass: 87.31, notes: [174.61, 220, 261.63, 349.23] },
      { bass: 130.81, notes: [261.63, 329.63, 392, 523.25] },
      { bass: 98, notes: [196, 246.94, 293.66, 392] },
    ],
  },
  flow: {
    bpm: 92,
    rhythm: 'flow',
    padWave: 'triangle',
    pluckWave: 'sine',
    leadWave: 'sine',
    progression: [
      { bass: 130.81, notes: [261.63, 329.63, 392, 493.88] },
      { bass: 110, notes: [220, 261.63, 329.63, 440] },
      { bass: 146.83, notes: [293.66, 369.99, 440, 554.37] },
      { bass: 98, notes: [196, 246.94, 329.63, 392] },
    ],
  },
  pulse: {
    bpm: 118,
    rhythm: 'pulse',
    padWave: 'square',
    pluckWave: 'triangle',
    leadWave: 'sawtooth',
    progression: [
      { bass: 92.5, notes: [185, 220, 277.18, 369.99] },
      { bass: 123.47, notes: [246.94, 293.66, 369.99, 493.88] },
      { bass: 82.41, notes: [164.81, 207.65, 246.94, 329.63] },
      { bass: 110, notes: [220, 277.18, 329.63, 440] },
    ],
  },
  night: {
    bpm: 84,
    rhythm: 'night',
    padWave: 'sine',
    pluckWave: 'triangle',
    leadWave: 'sine',
    progression: [
      { bass: 73.42, notes: [146.83, 174.61, 220, 293.66] },
      { bass: 65.41, notes: [130.81, 164.81, 196, 261.63] },
      { bass: 82.41, notes: [164.81, 196, 246.94, 329.63] },
      { bass: 55, notes: [110, 146.83, 174.61, 220] },
    ],
  },
}
