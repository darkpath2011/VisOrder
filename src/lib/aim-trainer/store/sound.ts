export type MusicTrackId = 'focus' | 'flow' | 'pulse' | 'night'
export type HitSoundId = 'crystal' | 'soft' | 'arcade' | 'wood'

export interface SoundSettings {
  muted: boolean
  musicVolume: number
  effectsVolume: number
  uiVolume: number
  trackId: MusicTrackId
  hitSoundId: HitSoundId
}

export const MUSIC_TRACKS: Array<{
  id: MusicTrackId
  name: string
  description: string
  bpm: number
}> = [
  { id: 'focus', name: '聚焦脉冲', description: '稳定电子节拍与渐进琶音', bpm: 104 },
  { id: 'flow', name: '清澈流动', description: '轻盈和弦与舒缓律动', bpm: 92 },
  { id: 'pulse', name: '反应回路', description: '更鲜明的节拍与速度感', bpm: 118 },
  { id: 'night', name: '夜间专注', description: '稀疏鼓点与深层氛围', bpm: 84 },
]

export const HIT_SOUNDS: Array<{
  id: HitSoundId
  name: string
  description: string
}> = [
  { id: 'crystal', name: '清脆水晶', description: '明亮短促，命中感最清晰' },
  { id: 'soft', name: '柔和气泡', description: '圆润轻快，适合长时间训练' },
  { id: 'arcade', name: '街机反馈', description: '俐利电子音，节奏感更强' },
  { id: 'wood', name: '木质敲击', description: '低沉扎实，声音更克制' },
]

export const DEFAULT_SOUND: SoundSettings = {
  muted: false,
  musicVolume: 45,
  effectsVolume: 70,
  uiVolume: 45,
  trackId: 'focus',
  hitSoundId: 'crystal',
}

const KEY = 'aim-trainer-web.sound'
const LEGACY_MUTE_KEY = 'aim-trainer-web.muted'
const TRACK_IDS = MUSIC_TRACKS.map((track) => track.id)
const HIT_SOUND_IDS = HIT_SOUNDS.map((sound) => sound.id)
let current: SoundSettings = { ...DEFAULT_SOUND }

const clampVolume = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : fallback

export function loadSoundSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<SoundSettings>) : {}
    current = {
      muted:
        typeof parsed.muted === 'boolean'
          ? parsed.muted
          : localStorage.getItem(LEGACY_MUTE_KEY) === '1',
      musicVolume: clampVolume(parsed.musicVolume, DEFAULT_SOUND.musicVolume),
      effectsVolume: clampVolume(parsed.effectsVolume, DEFAULT_SOUND.effectsVolume),
      uiVolume: clampVolume(parsed.uiVolume, DEFAULT_SOUND.uiVolume),
      trackId:
        typeof parsed.trackId === 'string' && (TRACK_IDS as string[]).includes(parsed.trackId)
          ? (parsed.trackId as MusicTrackId)
          : DEFAULT_SOUND.trackId,
      hitSoundId:
        typeof parsed.hitSoundId === 'string' &&
        (HIT_SOUND_IDS as string[]).includes(parsed.hitSoundId)
          ? (parsed.hitSoundId as HitSoundId)
          : DEFAULT_SOUND.hitSoundId,
    }
  } catch {
    current = { ...DEFAULT_SOUND }
  }
  return { ...current }
}

export function saveSoundSettings(settings: SoundSettings): void {
  current = {
    ...settings,
    musicVolume: clampVolume(settings.musicVolume, DEFAULT_SOUND.musicVolume),
    effectsVolume: clampVolume(settings.effectsVolume, DEFAULT_SOUND.effectsVolume),
    uiVolume: clampVolume(settings.uiVolume, DEFAULT_SOUND.uiVolume),
    trackId: (TRACK_IDS as string[]).includes(settings.trackId)
      ? settings.trackId
      : DEFAULT_SOUND.trackId,
    hitSoundId: (HIT_SOUND_IDS as string[]).includes(settings.hitSoundId)
      ? settings.hitSoundId
      : DEFAULT_SOUND.hitSoundId,
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
    localStorage.setItem(LEGACY_MUTE_KEY, current.muted ? '1' : '0')
  } catch {
    // 隐私模式下持久化失败不影响当前会话。
  }
}

/** 实时预览：更新运行时音效状态（不写入 localStorage），
 *  供设置面板拖动音量滑块时立即生效。 */
export function previewSoundSettings(settings: SoundSettings): void {
  current = {
    ...settings,
    musicVolume: clampVolume(settings.musicVolume, DEFAULT_SOUND.musicVolume),
    effectsVolume: clampVolume(settings.effectsVolume, DEFAULT_SOUND.effectsVolume),
    uiVolume: clampVolume(settings.uiVolume, DEFAULT_SOUND.uiVolume),
    trackId: (TRACK_IDS as string[]).includes(settings.trackId)
      ? settings.trackId
      : DEFAULT_SOUND.trackId,
    hitSoundId: (HIT_SOUND_IDS as string[]).includes(settings.hitSoundId)
      ? settings.hitSoundId
      : DEFAULT_SOUND.hitSoundId,
  }
}

export function getSoundSettings(): Readonly<SoundSettings> {
  return current
}
