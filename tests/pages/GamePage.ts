/**
 * GamePage — Page Object Model for Ether Mini-Games
 *
 * Encapsulates all selectors and interactions so tests stay readable.
 * Usage:
 *   const game = new GamePage(page, '/games/shadow-tap', '#8b5cf6')
 *   await game.goto()
 *   await game.start()
 *   await game.waitForEnd()
 *   await game.playAgain()
 */

import { Page, Locator, expect } from '@playwright/test'

export interface GamePageOptions {
  sensors?: {
    motion?: boolean
    mic?: boolean
    camera?: boolean
  }
  skipUser?: boolean  // default false — set stored user by default
}

export class GamePage {
  readonly page: Page
  readonly path: string
  readonly accent: string
  readonly baseUrl: string

  constructor(page: Page, path: string, accent = '#00ff88', baseUrl = process.env.TEST_URL ?? 'http://localhost:3000') {
    this.page = page
    this.path = path
    this.accent = accent
    this.baseUrl = baseUrl
  }

  get url() { return this.baseUrl + this.path }

  // ─── Selectors ──────────────────────────────────────────────────────────────

  get backButton(): Locator {
    return this.page.locator('[data-testid="back-button"], a[href="/"]').first()
  }

  get startButton(): Locator {
    // Prefer explicit data-testid first, fall back to text heuristic
    return this.page.locator('[data-testid="start-cta"], button').filter({
      hasText: /enable|allow|start|motion|mic|begin|play|drop|go/i
    }).first()
  }

  get nameInput(): Locator {
    return this.page.locator('input[placeholder*="name" i], input[type="text"]').first()
  }

  get ctaButton(): Locator {
    // The final CTA button after name is entered (may be same as startButton)
    // Prefer explicit data-testid, fall back to text heuristic
    return this.page.locator('[data-testid="start-cta"], button').filter({
      hasText: /start|play|go|begin|drop/i
    }).last()
  }

  get countdownEl(): Locator {
    return this.page.locator('text=3').or(
      this.page.locator('text=GO')
    ).first()
  }

  get timerEl(): Locator {
    return this.page.locator('[data-testid="timer"]').or(
      this.page.locator('text=/^[0-9]+$/')
    ).first()
  }

  get scoreEl(): Locator {
    return this.page.locator('[data-testid="score"]').or(
      this.page.locator('text=/score/i').locator('..').locator('text=/^[0-9]+$/')
    ).first()
  }

  get playAgainButton(): Locator {
    return this.page.locator('button').filter({ hasText: /play again/i }).first()
  }

  get endScreen(): Locator {
    return this.page.locator('[data-testid="end-screen"]').or(
      this.page.locator('text=/play again/i').locator('..')
    ).first()
  }

  get leaderboardButton(): Locator {
    return this.page.locator('button').filter({ hasText: /leaderboard|all games/i }).first()
  }

  get canvas(): Locator {
    return this.page.locator('canvas').first()
  }

  // ─── Setup ──────────────────────────────────────────────────────────────────

  async mockHaptics() {
    await this.page.addInitScript(() => {
      const log: number[][] = []
      ;(window as any).__vibrateLog = log
      navigator.vibrate = (pattern: number | number[]) => {
        log.push(Array.isArray(pattern) ? pattern : [pattern])
        return true
      }
    })
  }

  async mockAccelerometer(opts: { x?: number; y?: number; z?: number } = {}) {
    const { x = 0, y = 0, z = 9.8 } = opts
    await this.page.addInitScript(({ x, y, z }) => {
      ;(window as any).__mockMotion = { x, y, z }
      ;(window as any).DeviceMotionEvent = class extends Event {
        accelerationIncludingGravity = { x, y, z }
        static requestPermission = async () => 'granted'
      }
      const fire = () => {
        const ev = new (window as any).DeviceMotionEvent('devicemotion')
        window.dispatchEvent(ev)
        setTimeout(fire, 16)
      }
      setTimeout(fire, 100)
    }, { x, y, z })
  }

  async mockMicrophone(pattern: 'silent' | 'loud' | 'breathing' | 'spike' = 'silent') {
    await this.page.addInitScript((pattern) => {
      // Ensure navigator.mediaDevices exists (may be undefined in HTTP WebKit contexts)
      if (!navigator.mediaDevices) {
        Object.defineProperty(navigator, 'mediaDevices', {
          value: {},
          writable: true,
          configurable: true,
        })
      }

      const volumes: Record<string, number[]> = {
        silent: [0, 0, 2, 1, 0],
        loud: [200, 220, 210, 230, 215],
        breathing: [0, 10, 30, 60, 80, 60, 30, 10, 0],
        spike: [0, 0, 0, 200, 0, 0, 0],
      }
      const vol = volumes[pattern] ?? volumes.silent
      let idx = 0

      navigator.mediaDevices.getUserMedia = async (constraints: MediaStreamConstraints) => {
        if (constraints?.audio) {
          const ctx = new AudioContext()
          const dest = ctx.createMediaStreamDestination()
          const gain = ctx.createGain()
          gain.gain.value = vol[idx % vol.length] / 255
          gain.connect(dest)
          setInterval(() => { gain.gain.value = vol[++idx % vol.length] / 255 }, 100)
          return dest.stream
        }
        return Promise.reject(new Error('getUserMedia mock: video not supported'))
      }
    }, pattern)
  }

  async setStoredUser(name = 'Test Player', avatar = '🎮') {
    await this.page.addInitScript(({ name, avatar }) => {
      localStorage.setItem('mg_user', JSON.stringify({
        name, avatar, id: 'test-user-001', timestamp: Date.now()
      }))
      localStorage.setItem('mg_last_player', JSON.stringify({ name, avatar }))
    }, { name, avatar })
  }

  // ─── Navigation ─────────────────────────────────────────────────────────────

  async goto(options: GamePageOptions = {}) {
    await this.page.addInitScript(() => {
      ;(window as any).__errors = []
      window.addEventListener('error', e => (window as any).__errors.push(e.message))
      // Disable Tone.js audio in headless test environment.
      // audio.ts checks __DISABLE_AUDIO and skips all Tone.js init when set.
      // Haptics (navigator.vibrate) still work normally.
      ;(window as any).__DISABLE_AUDIO = true
    })
    await this.mockHaptics()
    if (!options.skipUser) await this.setStoredUser()
    if (options.sensors?.motion) await this.mockAccelerometer()
    if (options.sensors?.mic) await this.mockMicrophone()

    await this.page.goto(this.url)
    await this.page.waitForLoadState('networkidle')
  }

  // ─── Interactions ────────────────────────────────────────────────────────────

  async enterName(name = 'Test Player') {
    const input = this.nameInput
    if (await input.isVisible({ timeout: 1000 }).catch(() => false)) {
      await input.fill(name)
    }
  }

  async start() {
    // Current GameStartScreen flow: CTA shown first → click CTA → PlayerNameInput overlay appears
    // Stored user (set by setStoredUser in goto()) → "Welcome back" screen → Continue → Consent → I Agree & Play

    // Step 1: Click the game CTA button to open the PlayerNameInput overlay
    if (await this.startButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await this.startButton.click({ force: true })
    }

    // Step 2: Wait for PlayerNameInput overlay to mount and render
    await this.page.waitForTimeout(500)

    // Step 3: Click "Continue" on welcome-back screen (stored user path)
    await this.page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const continueBtn = buttons.find(b => b.textContent?.trim().startsWith('Continue'))
      if (continueBtn) (continueBtn as HTMLButtonElement).click()
    }).catch(() => {})

    // Step 4: Wait for consent screen animation
    await this.page.waitForTimeout(400)

    // Step 5: Click "I Agree & Play" on consent screen
    await this.page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const agreeBtn = buttons.find(b => {
        const t = b.textContent?.trim() ?? ''
        return t.includes('Agree') && t.includes('Play')
      })
      if (agreeBtn) (agreeBtn as HTMLButtonElement).click()
    }).catch(() => {})

    // Step 6: Wait for overlay to dismiss (220ms animation) + React state propagation
    await this.page.waitForTimeout(700)
  }

  async waitForCountdown() {
    await expect(this.countdownEl).toBeVisible({ timeout: 5000 })
  }

  async waitForPlaying(timeoutMs = 8000) {
    // Wait for countdown to finish + game to start
    await this.page.waitForTimeout(4000)
    await expect(this.timerEl).toBeVisible({ timeout: timeoutMs })
  }

  async waitForEnd(gameDurationMs = 65000) {
    await this.page.waitForSelector(
      '[data-testid="end-screen"], button:has-text("Play Again")',
      { timeout: gameDurationMs + 5000 }
    )
  }

  async playAgain() {
    await this.playAgainButton.click()
    await this.page.waitForTimeout(500)
  }

  // ─── Assertions ──────────────────────────────────────────────────────────────

  async expectNoErrors() {
    const errors = await this.page.evaluate(() => (window as any).__errors ?? [])
    expect(errors, 'Page had JS errors').toHaveLength(0)
  }

  async expectNoConsoleErrors() {
    // Use alongside page.on('console') tracking
  }

  async expectTimerDecreasing(waitMs = 3000) {
    const before = await this.timerEl.textContent()
    await this.page.waitForTimeout(waitMs)
    const after = await this.timerEl.textContent()
    const bNum = parseInt(before ?? '999')
    const aNum = parseInt(after ?? '999')
    expect(aNum, `Timer should decrease: was ${bNum}, now ${aNum}`).toBeLessThan(bNum)
  }

  async expectNoHorizontalScroll() {
    const scrollWidth = await this.page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await this.page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth, 'Page has horizontal scroll').toBeLessThanOrEqual(clientWidth + 1)
  }

  async expectTouchTargetSize(locator: Locator, minPx = 44, label = 'element') {
    const box = await locator.boundingBox()
    expect(box, `${label} not found`).not.toBeNull()
    expect(box!.width, `${label} width < ${minPx}px`).toBeGreaterThanOrEqual(minPx)
    expect(box!.height, `${label} height < ${minPx}px`).toBeGreaterThanOrEqual(minPx)
  }

  // ─── Performance ─────────────────────────────────────────────────────────────

  async measureFPS(durationMs = 3000): Promise<number> {
    return this.page.evaluate((durationMs) => {
      return new Promise<number>((resolve) => {
        let frames = 0
        let start = performance.now()
        const count = (ts: number) => {
          frames++
          if (ts - start < durationMs) {
            requestAnimationFrame(count)
          } else {
            resolve(Math.round(frames / (durationMs / 1000)))
          }
        }
        requestAnimationFrame(count)
      })
    }, durationMs)
  }

  async measureMemoryMB(): Promise<number | null> {
    return this.page.evaluate(() => {
      const mem = (performance as any).memory
      if (!mem) return null
      return Math.round(mem.usedJSHeapSize / 1024 / 1024)
    })
  }

  // ─── Accessibility ───────────────────────────────────────────────────────────

  async getVibrateLog(): Promise<number[][]> {
    return this.page.evaluate(() => (window as any).__vibrateLog ?? [])
  }

  async getLocalStorageKey(key: string): Promise<unknown> {
    return this.page.evaluate((k) => {
      const val = localStorage.getItem(k)
      return val ? JSON.parse(val) : null
    }, key)
  }
}
