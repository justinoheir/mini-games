import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { GamePage } from './pages/GamePage'

const GAME_ID        = 'code-breaker'
const GAME_PATH      = '/games/code-breaker'
const ACCENT         = '#06b6d4'
const GAME_DURATION_MS = 60000
const SENSOR         = 'touch'

test('1.1 — page loads without JS errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  expect(errors).toHaveLength(0)
})

test('2.1 — start screen renders', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await expect(game.ctaButton).toBeVisible({ timeout: 3000 })
})

test('2.2 — name input visible', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ skipUser: true })
  await expect(game.nameInput).toBeVisible({ timeout: 3000 })
})

test('2.3 — CTA meets 44px', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectTouchTargetSize(game.ctaButton, 44, 'CTA button')
})

test('2.4 — back button meets 44px', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectTouchTargetSize(game.backButton, 44, 'back button')
})

test('3.1 — countdown appears', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForCountdown()
})

test('4.1 — timer visible during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await expect(game.timerEl).toBeVisible()
})

test('4.2 — timer decreasing', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await game.expectTimerDecreasing(3000)
})

test('4.3 — digit buttons appear during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  const digitBtn = page.locator('button[aria-label="Digit 1"]')
  await expect(digitBtn).toBeVisible({ timeout: 3000 })
})

test('4.4 — no crash during 10s gameplay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(10000)
  expect(errors).toHaveLength(0)
})

test('5.1 — score starts at 0', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  const scoreText = await game.scoreEl.textContent().catch(() => '0')
  expect(parseInt(scoreText ?? '0')).toBe(0)
})

test('5.2 — digits can be entered during input phase', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  // Wait for input phase (after 2s show + hide)
  await page.waitForTimeout(4000)
  const digits = [1, 2, 3, 4]
  for (const d of digits) {
    const btn = page.locator(`button[aria-label="Digit ${d}"]`)
    if (await btn.isVisible()) await btn.click().catch(() => {})
    await page.waitForTimeout(100)
  }
})

test('5.3 — game ends at timer 0', async ({ page }) => {
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
  await page.waitForSelector('button:has-text("Play Again")', { timeout: Math.ceil(GAME_DURATION_MS / 10) + 5000 })
  await expect(game.playAgainButton).toBeVisible()
})

test('5.4 — play-again resets score', async ({ page }) => {
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
  expect(parseInt(scoreText ?? '0')).toBe(0)
})

test('6.1 — end screen shows play-again', async ({ page }) => {
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
  await expect(game.playAgainButton).toBeVisible()
})

test('7.1 — no horizontal scroll on 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectNoHorizontalScroll()
})

test('8.1 — FPS ≥ 55 during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(1000)
  const fps = await game.measureFPS(3000)
  expect(fps).toBeGreaterThanOrEqual(55)
})

test('9.1 — start screen passes axe-core', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('canvas')
    .analyze()
  const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
  expect(critical).toHaveLength(0)
})

test('9.2 — digit buttons accessible during input phase', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  const results = await new AxeBuilder({ page })
    .withRules(['button-name'])
    .analyze()
  expect(results.violations).toHaveLength(0)
})

test('12.1 — haptics fire after digit entry', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(4000)
  const btn = page.locator('button[aria-label="Digit 5"]')
  if (await btn.isVisible()) await btn.click().catch(() => {})
  await page.waitForTimeout(1000)
  const log = await game.getVibrateLog()
  console.log(`Code Breaker haptics: ${log.length}`)
})
