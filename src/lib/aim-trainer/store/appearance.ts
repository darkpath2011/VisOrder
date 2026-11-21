export type BackgroundId =
  | 'classic'
  | 'range'
  | 'white-room'
  | 'aurora'
  | 'foundry'

export interface AppearanceSettings {
  backgroundId: BackgroundId
  targetColor: string
}

export interface BackgroundOption {
  id: BackgroundId
  name: string
  description: string
  preview: string
}

export const BACKGROUND_OPTIONS: BackgroundOption[] = [
  {
    id: 'classic',
    name: '日光训练室',
    description: '当前的明亮棋盘训练房',
    preview: 'linear-gradient(150deg, #79bfe7 0 35%, #5d6267 35% 70%, #a7a6a2 70%)',
  },
  {
    id: 'range',
    name: '深空靶场',
    description: '干净靶墙、细地网与红色十字基准',
    preview: 'linear-gradient(150deg, #0f1922 0 34%, #1d2229 34% 69%, #29333d 69%)',
  },
  {
    id: 'white-room',
    name: '无影白棚',
    description: '无缝亮面与悬浮灯幕',
    preview: 'linear-gradient(150deg, #e8ecef 0 34%, #cbd2d6 34% 69%, #919ca3 69%)',
  },
  {
    id: 'aurora',
    name: '轨道极光',
    description: '开放星空与巨型光环',
    preview: 'linear-gradient(150deg, #091713 0 34%, #12342f 34% 69%, #1b6e68 69%)',
  },
  {
    id: 'foundry',
    name: '工业廊桥',
    description: '钢梁门架与深层跑道',
    preview: 'linear-gradient(150deg, #17191b 0 34%, #3b4042 34% 69%, #d7b84b 69%)',
  },
]

export const TARGET_COLORS = [
  { color: '#f4f6ff', name: '冰白' },
  { color: '#ff405c', name: '珊瑚红' },
  { color: '#00e0ff', name: '电光青' },
  { color: '#75f08c', name: '荧光绿' },
  { color: '#ffd34e', name: '亮黄' },
  { color: '#ff8a3d', name: '橙色' },
]

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  backgroundId: 'classic',
  targetColor: '#f4f6ff',
}

const KEY = 'aim-trainer-web.appearance'
const BACKGROUND_IDS = BACKGROUND_OPTIONS.map((background) => background.id)

export function loadAppearance(): AppearanceSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AppearanceSettings>
    return {
      backgroundId:
        typeof parsed.backgroundId === 'string' &&
        (BACKGROUND_IDS as string[]).includes(parsed.backgroundId)
          ? (parsed.backgroundId as BackgroundId)
          : DEFAULT_APPEARANCE.backgroundId,
      targetColor:
        typeof parsed.targetColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.targetColor)
          ? parsed.targetColor
          : DEFAULT_APPEARANCE.targetColor,
    }
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
}

export function saveAppearance(settings: AppearanceSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // 隐私模式下持久化失败不影响当前会话。
  }
}
