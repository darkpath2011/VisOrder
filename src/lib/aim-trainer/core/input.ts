export type LookHandler = (dxPixels: number, dyPixels: number) => void
export type LockChangeHandler = (locked: boolean) => void

const CLICK_STABILIZE_WINDOW_MS = 24
const CLICK_JITTER_MAX_DISTANCE = 32

export class PointerLookController {
  private locked = false
  private skipNextMove = false
  private pendingDx = 0
  private pendingDy = 0
  private guardedDx = 0
  private guardedDy = 0
  private clickGuardUntil = 0
  private lockCb: LockChangeHandler | null = null
  private failCb: (() => void) | null = null
  private shootCb: (() => void) | null = null

  constructor(
    private element: HTMLElement,
    private handler: LookHandler,
  ) {
    this.element.addEventListener('click', this.request)
    document.addEventListener('mousemove', this.handleMouseMove)
    document.addEventListener('mousedown', this.handleMouseDown)
    document.addEventListener('pointerlockchange', this.handleLockChange)
  }

  set onLockChange(handler: LockChangeHandler | null) {
    this.lockCb = handler
  }

  set onLockFail(handler: (() => void) | null) {
    this.failCb = handler
  }

  set onShoot(handler: (() => void) | null) {
    this.shootCb = handler
  }

  /** Apply accumulated raw movement once, immediately before the next render. */
  flush(): void {
    if (this.clickGuardUntil > 0 && performance.now() > this.clickGuardUntil) {
      this.clearClickGuard()
    }
    if (this.pendingDx === 0 && this.pendingDy === 0) return
    const dx = this.pendingDx
    const dy = this.pendingDy
    this.pendingDx = 0
    this.pendingDy = 0
    this.handler(dx, dy)
  }

  /** Prefer unaccelerated mouse counts, matching native FPS raw-input behavior. */
  request = (): void => {
    if (this.locked) return
    try {
      const result = this.element.requestPointerLock?.({
        unadjustedMovement: true,
      }) as Promise<void> | undefined
      result?.catch((error: unknown) => {
        if (
          error instanceof TypeError ||
          (error instanceof DOMException && error.name === 'NotSupportedError')
        ) {
          this.requestAdjustedFallback()
        } else {
          this.failCb?.()
        }
      })
    } catch {
      this.requestAdjustedFallback()
    }
  }

  /**
   * exit releases pointer lock so React overlays (comfort rating, results) can be clicked.
   * Safe to call when already unlocked.
   */
  exit(): void {
    this.resetMovement()
    if (document.pointerLockElement === this.element) {
      document.exitPointerLock()
    }
  }

  private handleMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return
    if (this.skipNextMove) {
      this.skipNextMove = false
      return
    }

    const dx = event.movementX
    const dy = event.movementY
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
      return
    }

    const now = performance.now()
    if (this.clickGuardUntil > 0) {
      if (now <= this.clickGuardUntil) {
        this.guardedDx += dx
        this.guardedDy += dy
        if (Math.hypot(this.guardedDx, this.guardedDy) > CLICK_JITTER_MAX_DISTANCE) {
          this.pendingDx += this.guardedDx
          this.pendingDy += this.guardedDy
          this.clearClickGuard()
        }
        return
      }
      this.clearClickGuard()
    }

    this.pendingDx += dx
    this.pendingDy += dy
  }

  private handleMouseDown = (event: MouseEvent): void => {
    if (!this.locked || event.button !== 0) return

    const pendingDistance = Math.hypot(this.pendingDx, this.pendingDy)
    if (pendingDistance <= CLICK_JITTER_MAX_DISTANCE) {
      this.guardedDx = this.pendingDx
      this.guardedDy = this.pendingDy
      this.pendingDx = 0
      this.pendingDy = 0
    } else {
      this.guardedDx = 0
      this.guardedDy = 0
    }
    this.clickGuardUntil = performance.now() + CLICK_STABILIZE_WINDOW_MS
    this.shootCb?.()
  }

  private handleLockChange = (): void => {
    this.locked = document.pointerLockElement === this.element
    this.skipNextMove = this.locked
    this.resetMovement()
    this.lockCb?.(this.locked)
  }

  private requestAdjustedFallback(): void {
    try {
      const result = this.element.requestPointerLock?.() as Promise<void> | undefined
      result?.catch(() => this.failCb?.())
    } catch {
      this.failCb?.()
    }
  }

  private clearClickGuard(): void {
    this.guardedDx = 0
    this.guardedDy = 0
    this.clickGuardUntil = 0
  }

  private resetMovement(): void {
    this.pendingDx = 0
    this.pendingDy = 0
    this.clearClickGuard()
  }

  dispose(): void {
    this.resetMovement()
    this.element.removeEventListener('click', this.request)
    document.removeEventListener('mousemove', this.handleMouseMove)
    document.removeEventListener('mousedown', this.handleMouseDown)
    document.removeEventListener('pointerlockchange', this.handleLockChange)
    if (document.pointerLockElement === this.element) {
      document.exitPointerLock()
    }
  }
}
