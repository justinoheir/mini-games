import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { GamePage } from './pages/GamePage'

const GAME_PATH      = '/games/dream-catch'
const ACCENT         = '#818cf8'
const GAME_DURATION_MS = 60000

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

test('3.1 — countdown shows', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForCountdown()
})

test('4.1 — timer visible', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await expect(game.timerEl).toBeVisible({ timeout: 3000 })
})

test('4.2 — timer decreases', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await game.expectTimerDecreasing(3000)
})

test('4.3 — no crash during 10s gameplay', async ({ page }) => {
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
  const t = await game.scoreEl.textContent().catch(() => '0')
  expect(parseInt(t ?? '0')).toBe(0)
})

test('5.2 — game ends at timer 0', async ({ page }) => {
  await page.addInitScript(() => {
    const o = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...a: unknown[]) =>
      ms === 1000 ? o(fn, 100, ...a) : o(fn, ms, ...a)
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForSelector('button:has-text("Play Again")', { timeout: GAME_DURATION_MS / 10 + 5000 })
  await expect(game.playAgainButton).toBeVisible()
})

test('5.3 — play-again resets score', async ({ page }) => {
  await page.addInitScript(() => {
    const o = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...a: unknown[]) =>
      ms === 1000 ? o(fn, 100, ...a) : o(fn, ms, ...a)
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 5000)
  await game.playAgain()
  await game.waitForPlaying()
  const t = await game.scoreEl.textContent().catch(() => '0')
  expect(parseInt(t ?? '0')).toBe(0)
})

test('6.1 — end screen shows personality', async ({ page }) => {
  await page.addInitScript(() => {
    const o = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...a: unknown[]) =>
      ms === 1000 ? o(fn, 100, ...a) : o(fn, ms, ...a)
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 5000)
  const p = page.locator('text=/Dream Weaver|Night Collector|Heavy Sleeper|Lucid Dreamer|Dream Walker/').first()
  await expect(p).toBeVisible({ timeout: 3000 })
})

test('7.1 — no horizontal scroll on 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectNoHorizontalScroll()
})

test('9.1 — axe-core start screen', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  const r = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa']).exclude('canvas').analyze()
  const c = r.violations.filter((v: any) => v.impact === 'critical' || v.impact === 'serious')
  expect(c).toHaveLength(0)
})
