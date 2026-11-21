/**
 * 成绩存储接口 —— UI 与引擎不直接接触 localStorage。
 * 将来接后端时新增 RemoteScoreStorage 实现即可，调用方零改动。
 */
export interface ScoreStorage {
  getBest(modeId: string): number | null
  /** 保存最佳成绩，返回是否刷新纪录 */
  saveBest(modeId: string, score: number): boolean
}

export class LocalScoreStorage implements ScoreStorage {
  private key(modeId: string): string {
    return `aim-trainer-web.best.${modeId}`
  }

  getBest(modeId: string): number | null {
    try {
      const raw = localStorage.getItem(this.key(modeId))
      if (raw === null) return null
      const v = Number(raw)
      return Number.isFinite(v) ? v : null
    } catch {
      return null
    }
  }

  saveBest(modeId: string, score: number): boolean {
    const prev = this.getBest(modeId)
    if (prev !== null && score <= prev) return false
    try {
      localStorage.setItem(this.key(modeId), JSON.stringify(score))
    } catch {
      // 忽略
    }
    return true
  }
}
