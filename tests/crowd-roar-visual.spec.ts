/**
 * Crowd Roar — Visual QA screenshots
 */
import { test, expect } from '@playwright/test'
import { GamePage } from './pages/GamePage'

const GAME_PATH = '/games/crowd-roar'
const ACCENT    = '#f59e0b'
const GAME_DURATION_MS = 45000

test.use({ viewport: { width: 390, height: 844 } })

test('screenshot: start screen', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, 'http://localhost:3002')
  await game.goto()
  await page.screenshot({ path: 'tests/results/cr-1-start.png', fullPage: false })
  await expect(game.ctaButton).toBeVisible({ timeout: 3000 })
})

test('screenshot: after clicking start (permission screen)', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, 'http://localhost:3002')
  await game.goto({ sensors: { mic: true } })
  await game.startButton.click({ force: true })
  // handle welcome-back / continue button
  const continueBtn = page.locator('[data-testid="reg-welcome-continue"]')
    .or(page.locator('button').filter({ hasText: /^continue/i })).first()
  try { await expect(continueBtn).toBeVisible({ timeout: 2000 }); await continueBtn.click() } catch {}
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'tests/results/cr-2-permission.png', fullPage: false })
})

test('screenshot: countdown phase', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, 'http://localhost:3002')
  await game.goto({ sensors: { mic: true } })
  await game.start()
  await game.waitForCountdown()
  await page.screenshot({ path: 'tests/results/cr-3-countdown.png', fullPage: false })
})

test('screenshot: playing phase', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, 'http://localhost:3002')
  await game.goto({ sensors: { mic: true } })
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: 'tests/results/cr-4-playing.png', fullPage: false })
})

test('screenshot: end screen', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)
      return orig(fn, ms, ...args)
    }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT, 'http://localhost:3002')
  await game.goto()
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 8000)
  await page.screenshot({ path: 'tests/results/cr-5-end.png', fullPage: false })
})

test('screenshot: mobile 375px layout', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const game = new GamePage(page, GAME_PATH, ACCENT, 'http://localhost:3002')
  await game.goto()
  await page.screenshot({ path: 'tests/results/cr-6-mobile375.png', fullPage: false })
})
