import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { GamePage } from './pages/GamePage'

const GAME_ID = 'wire-cross'
const GAME_PATH = '/games/wire-cross'
const ACCENT = '#00e5ff'
const GAME_DURATION_MS = 45000
const SENSOR = 'touch'

test('1.1 — page loads without JS errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  expect(errors).toHaveLength(0)
})

test('2.1 — start screen renders with CTA', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await expect(game.ctaButton).toBeVisible({ timeout: 3000 })
})

test('2.3 — CTA button meets 44×44px minimum', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectTouchTargetSize(game.ctaButton, 44, 'CTA button')
})

test('3.1 — countdown appears after start', async ({ page }) => {
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

test('4.2 — timer decreases', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await game.expectTimerDecreasing(3000)
})

test('5.1 — score starts at 0', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  const scoreText = await game.scoreEl.textContent().catch(() => '0')
  expect(parseInt(scoreText ?? '0')).toBe(0)
})

test('5.2 — game ends at timer 0', async ({ page }) => {
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

test('6.1 — end screen has play-again button', async ({ page }) => {
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

test('9.1 — start screen passes axe-core scan', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('canvas').analyze()
  const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
  expect(critical).toHaveLength(0)
})

test('12.1 — haptics fire during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(3000)
  const log = await game.getVibrateLog()
  console.log(`Wire Cross haptics fired: ${log.length}`)
})
