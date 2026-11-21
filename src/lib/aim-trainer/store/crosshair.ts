/**
 * 准心设置 —— 样式 + 颜色,本地持久化。
 * 对应后端 settings 模块的 crosshair 文档(前端本地版)。
 */

export type CrosshairStyle =
  | 'dot'
  | 'cross'
  | 'hollow-cross'
  | 'ring'
  | 'ring-dot'

export interface CrosshairSettings {
  /** 准心样式:点 / 实心十字 / 空心十字 / 圆环 / 圆环+点 */
  style: CrosshairStyle
  /** 准心颜色(hex) */
  color: string
  /** 准心整体尺寸（CSS 像素） */
  size: number
  /** 线条粗细（CSS 像素） */
  thickness: number
  /** 空心十字中心留白（CSS 像素） */
  gap: number
  /** 深色描边可增强复杂背景上的可见性 */
  outline: boolean
}

export const CROSSHAIR_STYLES: Array<{ id: CrosshairStyle; name: string }> = [
  { id: 'dot', name: '点准心' },
  { id: 'cross', name: '十字准心' },
  { id: 'hollow-cross', name: '空心十字' },
  { id: 'ring', name: '圆环' },
  { id: 'ring-dot', name: '圆环+点' },
]

export const PRESET_COLORS: Array<{ color: string; name: string }> = [
  { color: '#ff2f92', name: '品红' },
  { color: '#00d4ff', name: '青色' },
  { color: '#ffffff', name: '白色' },
  { color: '#39ff88', name: '绿色' },
  { color: '#ffd166', name: '黄色' },
  { color: '#ff4d6a', name: '红色' },
]

export const DEFAULT_CROSSHAIR: CrosshairSettings = {
  style: 'dot',
  color: '#ff2f92',
  size: 18,
  thickness: 2,
  gap: 6,
  outline: true,
}

const KEY = 'aim-trainer-web.crosshair'

const STYLE_IDS = CROSSHAIR_STYLES.map((s) => s.id)

export function loadCrosshair(): CrosshairSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_CROSSHAIR }
    const parsed = JSON.parse(raw) as Partial<CrosshairSettings>
    return {
      style:
        typeof parsed.style === 'string' &&
        (STYLE_IDS as string[]).includes(parsed.style)
          ? (parsed.style as CrosshairStyle)
          : DEFAULT_CROSSHAIR.style,
      color:
        typeof parsed.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.color)
          ? parsed.color
          : DEFAULT_CROSSHAIR.color,
      size: clampNumber(parsed.size, 8, 48, DEFAULT_CROSSHAIR.size),
      thickness: clampNumber(parsed.thickness, 1, 6, DEFAULT_CROSSHAIR.thickness),
      gap: clampNumber(parsed.gap, 2, 16, DEFAULT_CROSSHAIR.gap),
      outline:
        typeof parsed.outline === 'boolean' ? parsed.outline : DEFAULT_CROSSHAIR.outline,
    }
  } catch {
    return { ...DEFAULT_CROSSHAIR }
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback
}

export function saveCrosshair(settings: CrosshairSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // 忽略（隐私模式等场景下写入失败不影响使用）
  }
}
