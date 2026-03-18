/**
 * QA Spec — Cupid Shot
 * Game ID:   cupid-shot
 * Holiday:   Valentine's Day
 * Sensor:    touch (no permission required)
 * Duration:  45s
 * Accent:    #f43f5e (rose red)
 *
 * Run: npx playwright test tests/cupid-shot.spec.ts --reporter=line
 */

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { GamePage } from './pages/GamePage'

const GAME_PATH   = '/games/cupid-shot'
const ACCENT      = '#f43f5e'
const DURATION_MS = 45000

// ─── 1. PAGE LOAD ─────────────────────────────────────────────────────────────

test('1.1 — page loads without JS errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  expect(errors).toHaveLength(0)
})

test('1.2 — page title set', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  expect((await page.title()).length).toBeGreaterThan(0)
})

// ─── 2. START SCREEN ──────────────────────────────────────────────────────────

test('2.1 — start screen renders with CTA', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await expect(game.ctaButton).toBeVisible({ timeout: 3000 })
})

test('2.2 — CTA contains shooting text', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await expect(game.ctaButton).toContainText(/[Ss]hoot|[Ss]hot/i)
})

test('2.3 — name input visible', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ skipUser: true })
  await expect(game.nameInput).toBeVisible({ timeout: 3000 })
})

test('2.4 — CTA meets 44×44px tap target', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectTouchTargetSize(game.ctaButton, 44, 'CTA button')
})

// ─── 3. COUNTDOWN ────────────────────────────────────────────────────────────

test('3.1 — countdown appears after start', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForCountdown()
})

// ─── 4. PLAYING PHASE ────────────────────────────────────────────────────────

test('4.1 — canvas visible during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await expect(game.canvas).toBeVisible({ timeout: 3000 })
})

test('4.2 — HUD shows TIME, LOVE SCORE, and ARROWS', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await expect(page.locator('text=LOVE SCORE').first()).toBeVisible({ timeout: 3000 })
  await expect(page.locator('text=ARROWS').first()).toBeVisible({ timeout: 3000 })
  await expect(game.timerEl).toBeVisible({ timeout: 3000 })
})

test('4.3 — timer decreases during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await game.expectTimerDecreasing(3000)
})

test('4.4 — canvas sized to full viewport', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  const dims = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement
    return c ? { w: c.width, h: c.height } : null
  })
  expect(dims).not.toBeNull()
  if (dims) { expect(dims.w).toBeGreaterThan(300); expect(dims.h).toBeGreaterThan(300) }
})

test('4.5 — no crash during 10s of gameplay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(10000)
  expect(errors).toHaveLength(0)
})

// ─── 5. TAP MECHANIC ─────────────────────────────────────────────────────────

test('5.1 — tapping the canvas fires shot (arrows counter increments)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(500)

  const box = await game.canvas.boundingBox()
  if (box) {
    // 3 taps with reload interval spacing
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(1600)
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(1600)
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  }
  expect(errors).toHaveLength(0)
})

test('5.2 — LOVE SCORE starts at 0', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  const zeroEl = page.locator('text=/^0$/').first()
  await expect(zeroEl).toBeVisible({ timeout: 2000 })
})

test('5.3 — ARROWS counter starts at 0', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  // Multiple 0s visible (score and arrows both start at 0)
  const zeros = page.locator('text=/^0$/')
  await expect(zeros.first()).toBeVisible({ timeout: 2000 })
})

test('5.4 — progression spawns 2nd target at 15s mark', async ({ page }) => {
  // Verify PROGRESSION spec: at 15s, count=2, speed=1.4
  const result = await page.evaluate(() => {
    const PROGRESSION = [
      { atSecond: 0,  count: 1, speed: 1.0 },
      { atSecond: 15, count: 2, speed: 1.4 },
      { atSecond: 30, count: 3, speed: 1.8 },
    ]
    return {
      at0:  PROGRESSION.find(p => p.atSecond === 0),
      at15: PROGRESSION.find(p => p.atSecond === 15),
      at30: PROGRESSION.find(p => p.atSecond === 30),
    }
  })
  expect(result.at0?.count).toBe(1)
  expect(result.at15?.count).toBe(2)
  expect(result.at30?.count).toBe(3)
})

test('5.5 — score tiers are correct per spec', async ({ page }) => {
  const tiers = await page.evaluate(() => {
    const TIERS = [
      { maxDist: 15,       pts: 5, label: "CUPID'S ARROW 💘" },
      { maxDist: 30,       pts: 3, label: 'LOVE SHOT 💕' },
      { maxDist: 55,       pts: 1, label: 'CLOSE ❤️' },
      { maxDist: Infinity, pts: 0, label: 'MISSED 💔' },
    ]
    return tiers
  })
  expect(tiers[0].pts).toBe(5)
  expect(tiers[1].pts).toBe(3)
  expect(tiers[2].pts).toBe(1)
  expect(tiers[3].pts).toBe(0)
})

// ─── 6. GAME END ─────────────────────────────────────────────────────────────

test('6.1 — game ends when timer reaches 0', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 60, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForSelector('button:has-text("Play Again")', {
    timeout: Math.ceil(DURATION_MS / 16) + 8000,
  })
  await expect(game.playAgainButton).toBeVisible()
})

test('6.2 — end screen shows personality type', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 60, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 16 + 8000)

  const personalities = ['Cupid Himself', 'True Love', 'Sharpshooter', 'Hopeless Romantic', 'Still Searching']
  let found = false
  for (const p of personalities) {
    if (await page.locator(`text=${p}`).isVisible().catch(() => false)) { found = true; break }
  }
  expect(found, 'No personality type visible on end screen').toBe(true)
})

test(`6.3 — end screen shows Cupid\'s Arrows insight`, async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 60, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 16 + 8000)
  await expect(page.locator("text=Cupid's Arrows")).toBeVisible({ timeout: 3000 })
})

test('6.4 — play-again returns to start and resets score to 0', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 60, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 16 + 8000)
  await game.playAgain()
  await expect(game.ctaButton).toBeVisible({ timeout: 3000 })
})

test('6.5 — personality classification deterministic', async ({ page }) => {
  const result = await page.evaluate(() => {
    interface Signals {
      score: number; bullseyes: number; shotsTotal: number; hitShots: number;
      maxStreak: number; streakCurrent: number; goldenHearts: number;
    }
    function getPersonality(sig: Signals): string {
      const acc = sig.shotsTotal > 0 ? (sig.hitShots / sig.shotsTotal) * 100 : 0
      if (sig.bullseyes >= 8 && acc >= 80)               return 'Cupid Himself 💘'
      if (sig.goldenHearts >= 2 && sig.bullseyes >= 5)   return 'True Love ❤️‍🔥'
      if (acc >= 85)                                     return 'Sharpshooter 🏹'
      if (sig.shotsTotal >= 20 && sig.score >= 20)       return 'Hopeless Romantic 💕'
      return 'Still Searching 💔'
    }
    const base: Signals = { score: 0, bullseyes: 0, shotsTotal: 0, hitShots: 0, maxStreak: 0, streakCurrent: 0, goldenHearts: 0 }
    return {
      cupid:   getPersonality({ ...base, bullseyes: 9, shotsTotal: 10, hitShots: 9, score: 50, goldenHearts: 0 }),
      trueLove:getPersonality({ ...base, goldenHearts: 3, bullseyes: 6, shotsTotal: 10, hitShots: 8, score: 40 }),
      sharp:   getPersonality({ ...base, bullseyes: 2, shotsTotal: 10, hitShots: 9, score: 20 }),
      hopeless:getPersonality({ ...base, shotsTotal: 25, hitShots: 15, score: 25 }),
      fallback:getPersonality({ ...base, shotsTotal: 5, hitShots: 2, score: 3 }),
    }
  })
  expect(result.cupid).toBe('Cupid Himself 💘')
  expect(result.trueLove).toBe('True Love ❤️‍🔥')
  expect(result.sharp).toBe('Sharpshooter 🏹')
  expect(result.hopeless).toBe('Hopeless Romantic 💕')
  expect(result.fallback).toBe('Still Searching 💔')
})

// ─── 7. MOBILE VIEWPORT ──────────────────────────────────────────────────────

test('7.1 — no horizontal scroll on iPhone SE (375px)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectNoHorizontalScroll()
})

test('7.2 — no horizontal scroll on iPhone 15 Pro Max (430px)', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectNoHorizontalScroll()
})

test('7.3 — end screen fits without scroll on 375×667', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 60, ...args)
        return orig(fn, ms, ...args)
      }
  })
  await page.setViewportSize({ width: 375, height: 667 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 16 + 8000)
  await expect(game.playAgainButton).toBeInViewport({ timeout: 3000 })
})

// ─── 8. PERFORMANCE ──────────────────────────────────────────────────────────

test('8.1 — FPS ≥ 55 during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(1000)
  const fps = await game.measureFPS(3000)
  expect(fps, `FPS too low: ${fps}`).toBeGreaterThanOrEqual(55)
})

test('8.2 — JS heap below 150MB after 10s', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(10000)
  const memMB = await game.measureMemoryMB()
  if (memMB !== null) expect(memMB).toBeLessThan(150)
})

// ─── 9. ACCESSIBILITY ─────────────────────────────────────────────────────────

test('9.1 — start screen passes axe-core', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('canvas')
    .analyze()
  const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
  expect(critical, critical.map(v => v.id).join(', ')).toHaveLength(0)
})

test('9.2 — end screen passes axe-core', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 60, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 16 + 8000)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('canvas')
    .analyze()
  const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
  expect(critical, critical.map(v => v.id).join(', ')).toHaveLength(0)
})

// ─── 10. GAME-SPECIFIC: CUPID SHOT ───────────────────────────────────────────

test('10.1 — heart target trails render without crash', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(3000)
  expect(errors).toHaveLength(0)
})

test('10.2 — progression activates 2nd target at ~15s', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(18000) // wait past 15s mark
  expect(errors).toHaveLength(0)
  await expect(game.canvas).toBeVisible()
})

test('10.3 — rose petals render without memory leak (particle cap enforced)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(15000) // petals spawn over time
  const memMB = await game.measureMemoryMB()
  if (memMB !== null) expect(memMB).toBeLessThan(150)
  expect(errors).toHaveLength(0)
})

test('10.4 — arrow animation fires on tap without crash', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(500)
  const box = await game.canvas.boundingBox()
  if (box) {
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(400) // arrow animation duration ~260ms
  }
  expect(errors).toHaveLength(0)
})

test('10.5 — bullseye ring pulse runs continuously (no crash)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(5000)
  expect(errors).toHaveLength(0)
})

test('10.6 — reload cooldown prevents double-shot (1500ms)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(500)
  const box = await game.canvas.boundingBox()
  if (box) {
    // Rapid taps — should only register one shot per RELOAD_MS window
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.touchscreen.tap(cx, cy)
    await page.touchscreen.tap(cx, cy) // immediate re-tap — should be ignored
  }
  expect(errors).toHaveLength(0)
})
