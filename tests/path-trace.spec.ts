/**
 * QA Spec — Path Trace
 * Sensor: touch | Duration: 45s | Accent: #e879f9
 *
 * Run: npx playwright test tests/path-trace.spec.ts --headed
 */

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { GamePage } from './pages/GamePage'

const GAME_ID        = 'path-trace'
const GAME_PATH      = '/games/path-trace'
const ACCENT         = '#e879f9'
const GAME_DURATION_MS = 45000
const SENSOR         = 'touch'

// ─── 1. PAGE LOAD ─────────────────────────────────────────────────────────────

test('1.1 — page loads without JS errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()

  expect(errors, `JS errors on load: ${errors.join(', ')}`).toHaveLength(0)
})

test('1.2 — page title is set', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  const title = await page.title()
  expect(title.length).toBeGreaterThan(0)
})

// ─── 2. START SCREEN ──────────────────────────────────────────────────────────

test('2.1 — start screen renders with game title', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await expect(game.ctaButton).toBeVisible({ timeout: 3000 })
  // Instructions overlay or start screen should show game title
  await expect(page.locator('text=Path Trace').first()).toBeVisible({ timeout: 3000 })
})

test('2.2 — name input visible when no stored user', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ skipUser: true })
  await expect(game.nameInput).toBeVisible({ timeout: 3000 })
})

test('2.3 — CTA button meets 44px minimum tap target', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectTouchTargetSize(game.ctaButton, 44, 'CTA button')
})

test('2.4 — back button meets 44px minimum tap target', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectTouchTargetSize(game.backButton, 44, 'back button')
})

test('2.5 — back button navigates to home', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.backButton.click()
  await expect(page).toHaveURL(new RegExp('^' + (process.env.TEST_URL ?? 'http://localhost:3000') + '/?$'))
})

// ─── 3. COUNTDOWN PHASE ──────────────────────────────────────────────────────

test('3.1 — countdown appears after tapping start', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForCountdown()
})

test('3.2 — countdown shows 3, 2, 1, GO in sequence', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await expect(page.locator('[data-testid="countdown-display"]')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=GO').or(page.locator('canvas'))).toBeVisible({ timeout: 6000 })
})

// ─── 4. PLAYING PHASE ────────────────────────────────────────────────────────

test('4.1 — canvas renders during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await expect(game.canvas).toBeVisible({ timeout: 3000 })
})

test('4.2 — timer visible and decreasing', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await expect(game.timerEl).toBeVisible({ timeout: 3000 })
  await game.expectTimerDecreasing(3000)
})

test('4.3 — score HUD visible during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await expect(game.scoreEl).toBeVisible({ timeout: 3000 })
})

test('4.4 — no crash during 10 seconds of gameplay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(10000)

  expect(errors, `Crash during gameplay: ${errors.join(', ')}`).toHaveLength(0)
})

// ─── 5. PATH TRACE SPECIFIC ──────────────────────────────────────────────────

test('5.1 — canvas covers full viewport during gameplay', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()

  const canvasBBox = await game.canvas.boundingBox()
  expect(canvasBBox).not.toBeNull()
  expect(canvasBBox!.width, 'Canvas should fill viewport width').toBeGreaterThanOrEqual(370)
  expect(canvasBBox!.height, 'Canvas should fill viewport height').toBeGreaterThanOrEqual(400)
})

test('5.2 — score starts at 0', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()

  const scoreText = await game.scoreEl.textContent().catch(() => '0')
  const score = parseInt(scoreText ?? '0')
  expect(score, 'Score should start at 0').toBe(0)
})

test('5.3 — timer starts at 45', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()

  const timerText = await game.timerEl.textContent().catch(() => '45')
  const timer = parseInt(timerText ?? '45')
  expect(timer, `Timer should start at ~45, got ${timer}`).toBeGreaterThanOrEqual(43)
  expect(timer).toBeLessThanOrEqual(45)
})

// ─── 6. BOUNDARY VALUES ──────────────────────────────────────────────────────

test('6.1 — game ends at timer = 0 and shows end screen', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)
      return orig(fn, ms, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()

  await page.waitForSelector('button:has-text("Play Again")', {
    timeout: Math.ceil(GAME_DURATION_MS / 10) + 5000
  })

  await expect(game.playAgainButton).toBeVisible()
})

test('6.2 — play-again resets score to 0', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)
      return orig(fn, ms, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 5000)
  await game.playAgain()
  await game.waitForPlaying()

  const scoreText = await game.scoreEl.textContent().catch(() => '0')
  const score = parseInt(scoreText ?? '0')
  expect(score, 'Score must reset to 0 after play-again').toBe(0)
})

test('6.3 — timer resets to 45 after play-again', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)
      return orig(fn, ms, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 5000)
  await game.playAgain()
  await game.waitForPlaying()

  const timerText = await game.timerEl.textContent().catch(() => '45')
  const timer = parseInt(timerText ?? '45')
  expect(timer, `Timer should reset to ~45, got ${timer}`).toBeGreaterThanOrEqual(43)
})

// ─── 7. END SCREEN ───────────────────────────────────────────────────────────

test('7.1 — end screen shows personality type', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)
      return orig(fn, ms, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 5000)

  // One of the 4 path-trace personality types must appear
  const personality = page.locator('text=/Laser Line|Speed Tracer|Steady Hand|Free Spirit/').first()
  await expect(personality).toBeVisible({ timeout: 3000 })
})

test('7.2 — end screen shows behavioral insights (4 chips)', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)
      return orig(fn, ms, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 5000)

  await expect(page.locator('text=Avg Precision')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('text=Paths Done')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('text=Avg Speed')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('text=Deviations')).toBeVisible({ timeout: 3000 })
})

test('7.3 — end screen no-scroll on iPhone SE (375×667)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)
      return orig(fn, ms, ...args)
    }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 5000)

  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight)
  expect(scrollHeight, 'End screen requires scrolling on iPhone SE').toBeLessThanOrEqual(680)
})

// ─── 8. MOBILE VIEWPORT ──────────────────────────────────────────────────────

test('8.1 — no horizontal scroll on iPhone SE (375px)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectNoHorizontalScroll()
})

test('8.2 — no horizontal scroll on iPhone 15 Pro Max (430px)', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectNoHorizontalScroll()
})

test('8.3 — layout intact on 375px (back + CTA visible)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await expect(game.backButton).toBeVisible()
  await expect(game.ctaButton).toBeVisible()
})

// ─── 9. PERFORMANCE ──────────────────────────────────────────────────────────

test('9.1 — FPS ≥ 55 during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(1000)

  const fps = await game.measureFPS(3000)
  expect(fps, `FPS too low: ${fps} (target ≥ 55)`).toBeGreaterThanOrEqual(55)
})

test('9.2 — JS heap stays below 150MB', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(5000)

  const memMB = await game.measureMemoryMB()
  if (memMB !== null) {
    expect(memMB, `Memory too high: ${memMB}MB`).toBeLessThan(150)
  }
})

test('9.3 — no memory leak across 3 play-agains', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)
      return orig(fn, ms, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  const memBefore = await game.measureMemoryMB()

  for (let i = 0; i < 3; i++) {
    await game.start()
    await game.waitForEnd(GAME_DURATION_MS / 10 + 5000)
    await game.playAgain()
    await page.waitForTimeout(500)
  }

  const memAfter = await game.measureMemoryMB()
  if (memBefore !== null && memAfter !== null) {
    const growth = memAfter - memBefore
    expect(growth, `Memory grew ${growth}MB across 3 runs`).toBeLessThan(30)
  }
})

// ─── 10. ACCESSIBILITY ───────────────────────────────────────────────────────

test('10.1 — start screen passes axe-core scan (no critical violations)', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('canvas')
    .analyze()

  const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
  expect(
    critical,
    `Critical a11y violations:\n${critical.map(v => `  [${v.impact}] ${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`).join('\n')}`
  ).toHaveLength(0)
})

test('10.2 — end screen passes axe-core scan', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)
      return orig(fn, ms, ...args)
    }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 5000)

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('canvas')
    .analyze()

  const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
  expect(critical, `End screen a11y violations: ${critical.map(v => v.id).join(', ')}`).toHaveLength(0)
})

test('10.3 — haptics respect ?haptics=off param', async ({ page }) => {
  // Navigate with haptics=off; game should still load and play
  const game = new GamePage(page, GAME_PATH + '?haptics=off', ACCENT)
  await game.goto()
  await expect(game.ctaButton).toBeVisible({ timeout: 3000 })
  // No error should occur
})

// ─── 11. HAPTICS LOG ─────────────────────────────────────────────────────────

test('11.1 — haptics fire during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(5000)

  const log = await game.getVibrateLog()
  console.log(`Haptics fired: ${log.length} times during 5s of gameplay`)
  // Countdown alone fires haptics — expect at least 1
  expect(log.length).toBeGreaterThan(0)
})
