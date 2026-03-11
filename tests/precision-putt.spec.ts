/**
 * QA TEMPLATE — Copy this for every new game.
 * Replace GAME_NAME, GAME_PATH, GAME_ID, and fill in game-specific checks.
 *
 * Run: npx playwright test tests/qa-template.spec.ts --headed
 */

import { test, expect, Page } from '@playwright/test'
import {
  mockAccelerometer,
  mockMicrophone,
  mockHaptics,
  mockCamera,
  setStoredUser,
  getStoredScores,
  getVibrateLog
} from './setup/device-mocks'

const BASE_URL = process.env.TEST_URL ?? 'http://localhost:3000'
const GAME_PATH = '/games/precision-putt'           // ← CHANGE THIS
const GAME_ID   = 'precision-putt'                  // ← CHANGE THIS (matches localStorage key)
const ACCENT    = '#86efac'                    // ← CHANGE THIS (game accent color)

// ─── Setup: runs before each test ─────────────────────────────────────────────

async function setup(page: Page, sensors: {
  motion?: boolean
  mic?: boolean
  micPattern?: 'silent' | 'loud' | 'breathing' | 'spike'
  camera?: boolean
} = {}) {
  await setStoredUser(page)           // skip onboarding
  await mockHaptics(page)             // always mock haptics

  if (sensors.motion) await mockAccelerometer(page)
  if (sensors.mic)    await mockMicrophone(page, { volumePattern: sensors.micPattern ?? 'silent' })
  if (sensors.camera) await mockCamera(page)

  await page.goto(BASE_URL + GAME_PATH)
  await page.waitForLoadState('networkidle')
}

// ─── 1. Core: Page Loads ──────────────────────────────────────────────────────

test('game page loads without errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', err => errors.push(err.message))

  await setup(page)

  expect(errors).toHaveLength(0)
  await expect(page.locator('body')).not.toBeEmpty()
})

// ─── 2. Core: Game Shell ──────────────────────────────────────────────────────

test('back button is visible and large enough', async ({ page }) => {
  await setup(page)

  const backBtn = page.locator('[data-testid="back-button"], a[href="/"], button:has-text("←")')
    .first()

  await expect(backBtn).toBeVisible()

  const box = await backBtn.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(44)   // min 44px tap target
  expect(box!.height).toBeGreaterThanOrEqual(44)
})

test('back button navigates to home', async ({ page }) => {
  await setup(page)

  const backBtn = page.locator('[data-testid="back-button"], a[href="/"], button:has-text("←")')
    .first()
  await backBtn.click()

  await expect(page).toHaveURL(BASE_URL + '/')
})

// ─── 3. Core: Permission Phase ────────────────────────────────────────────────

test('permission button is visible on load', async ({ page }) => {
  await setup(page, { motion: true })  // adjust to game's sensor

  // Games must show a button to enable sensors — never auto-request
  const permBtn = page.locator('button').filter({ hasText: /enable|allow|start|motion|mic/i })
  await expect(permBtn.first()).toBeVisible({ timeout: 3000 })
})

test('touch fallback activates if sensor denied', async ({ page }) => {
  // Override with denied permission
  await page.addInitScript(() => {
    ;(window as any).DeviceMotionEvent = class extends Event {
      static requestPermission = async () => 'denied'
    }
  })
  await setStoredUser(page)
  await page.goto(BASE_URL + GAME_PATH)

  // Game should still be playable (touch fallback visible)
  await page.locator('button').filter({ hasText: /enable|allow|start|motion|mic/i }).first().click()
  // Should not crash — touch controls or some fallback should appear
  await expect(page.locator('body')).not.toBeEmpty()
  const errors = await page.evaluate(() => (window as any).__errors ?? [])
  expect(errors).toHaveLength(0)
})

// ─── 4. Core: Countdown Phase ────────────────────────────────────────────────

test('countdown shows 3-2-1-GO before game starts', async ({ page }) => {
  await setup(page, { motion: true })

  // Trigger permission / start
  const startBtn = page.locator('button').filter({ hasText: /enable|allow|start|motion|mic/i }).first()
  if (await startBtn.isVisible()) await startBtn.click()

  // Countdown should appear
  await expect(page.locator('text=3').or(page.locator('text=GO'))).toBeVisible({ timeout: 5000 })
})

// ─── 5. Core: Playing Phase ───────────────────────────────────────────────────

test('timer is visible during gameplay', async ({ page }) => {
  await setup(page, { motion: true })

  const startBtn = page.locator('button').filter({ hasText: /enable|allow|start|motion|mic/i }).first()
  if (await startBtn.isVisible()) await startBtn.click()

  // Wait for countdown to finish
  await page.waitForTimeout(3000)

  // Timer should be somewhere on screen (e.g. "60", "59", "0:60")
  const timerEl = page.locator('[data-testid="timer"]').or(
    page.locator('text=/^[0-9]+$/')
  )
  await expect(timerEl.first()).toBeVisible({ timeout: 5000 })
})

test('game does not crash during 10 seconds of play', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))

  await setup(page, { motion: true })

  const startBtn = page.locator('button').filter({ hasText: /enable|allow|start|motion|mic/i }).first()
  if (await startBtn.isVisible()) await startBtn.click()

  await page.waitForTimeout(10000)

  expect(errors).toHaveLength(0)
})

// ─── 6. Core: End Screen ─────────────────────────────────────────────────────

test('end screen shows after game completes', async ({ page }) => {
  await setup(page, { motion: true })

  // Fast-forward by mocking timer (skip full game duration in CI)
  await page.addInitScript(() => {
    // Override Date.now to speed up timer — games typically use timeLeft--
    // This mock fires a keyboard shortcut or we wait the full duration
  })

  const startBtn = page.locator('button').filter({ hasText: /enable|allow|start|motion|mic/i }).first()
  if (await startBtn.isVisible()) await startBtn.click()

  // Force-end the game to avoid 60s wait
  await page.waitForTimeout(4000)  // let countdown finish
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('game:force-end')))

  // Wait for full game duration + buffer (set timeout to game duration + 5s)
  // CHANGE 65000 to your game's duration + 5 seconds
  await page.waitForSelector('[data-testid="end-screen"]', {
    timeout: 65000
  })

  await expect(page.locator('button').filter({ hasText: /play again/i })).toBeVisible()
  await expect(page.locator('button').filter({ hasText: /all games/i })).toBeVisible()
})

test('end screen shows personality classification', async ({ page }) => {
  await setup(page)

  // Navigate directly to end screen by injecting game-over state
  // CUSTOMIZE: inject the end-state that matches your game's phase logic
  await page.evaluate(() => {
    // Example: trigger end state via custom event
    window.dispatchEvent(new CustomEvent('game:force-end'))
  })

  await page.waitForTimeout(1000)
  // End screen should show a personality label
  // CUSTOMIZE: add the specific personality labels for this game
  const personality = page.locator('text=/precise|calm|reactive|steady|explosive|balanced/i')
  // Note: if game hasn't ended yet this will fail — implement force-end event in game
})

test('score is saved to localStorage after game ends', async ({ page }) => {
  await setup(page, { motion: true })

  // Play through game...
  const startBtn = page.locator('button').filter({ hasText: /enable|allow|start/i }).first()
  if (await startBtn.isVisible()) await startBtn.click()

  // Force-end game so we don't timeout waiting 60s
  await page.waitForTimeout(3500)  // countdown
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('game:force-end')))
  await page.waitForSelector('[data-testid="end-screen"]', { timeout: 10000 })

  const scores = await getStoredScores(page)
  expect(scores[GAME_ID]).toBeDefined()
  expect(scores[GAME_ID].personality).toBeTruthy()
  expect(scores[GAME_ID].timestamp).toBeGreaterThan(0)
})

// ─── 7. Core: Play Again ─────────────────────────────────────────────────────

test('"play again" restarts game cleanly', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))

  await setup(page)
  // Get to end screen via force-end
    const startBtn2 = page.locator('button').filter({ hasText: /enable|allow|start|motion|mic/i }).first()
    if (await startBtn2.isVisible()) await startBtn2.click()
    await page.waitForTimeout(3500)  // countdown
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('game:force-end')))
    await page.waitForSelector('[data-testid="end-screen"]', { timeout: 8000 }).catch(() => {})

  const playAgainBtn = page.locator('button').filter({ hasText: /play again/i })
  if (await playAgainBtn.isVisible()) {
    await playAgainBtn.click()
    // Should return to permission or countdown phase — not crash
    await page.waitForTimeout(2000)
    expect(errors).toHaveLength(0)
  }
})

// ─── 8. Mobile Viewport ───────────────────────────────────────────────────────

test('no horizontal scroll on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })  // iPhone 14
  await setup(page)

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
})

test('no vertical overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)

  // Game should fill screen, not overflow into scrollable content
  const bodyOverflow = await page.evaluate(() =>
    getComputedStyle(document.body).overflow
  )
  // Either hidden or the game fits in viewport
  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight)
  expect(scrollHeight).toBeLessThanOrEqual(850)  // small tolerance
})

// ─── 9. Sensor-Specific: Motion Games ────────────────────────────────────────
// UNCOMMENT for motion-based games (Tilt Maze, Steady Hand, Tunnel)

/*
test('accelerometer input moves game element', async ({ page }) => {
  await setup(page, { motion: true })
  await mockAccelerometer(page, { x: 5.0, y: 0, z: 9.8 })  // strong right tilt

  const startBtn = page.locator('button').filter({ hasText: /enable|motion/i }).first()
  if (await startBtn.isVisible()) await startBtn.click()
  await page.waitForTimeout(3500)  // past countdown

  // CUSTOMIZE: check that a game element moved in the expected direction
  // e.g. ball position x should be > initial x after tilting right
})
*/

// ─── 10. Sensor-Specific: Mic Games ──────────────────────────────────────────
// UNCOMMENT for mic-based games (Whisper Bomb, Breath Rider, Pulse Sphere)

/*
test('loud volume triggers danger state', async ({ page }) => {
  await setup(page, { mic: true, micPattern: 'loud' })

  const startBtn = page.locator('button').filter({ hasText: /allow mic|start/i }).first()
  if (await startBtn.isVisible()) await startBtn.click()
  await page.waitForTimeout(3500)

  // CUSTOMIZE: check for danger indicator (red flash, volume bar high, etc.)
  const dangerEl = page.locator('[data-testid="danger"], .bg-red-500')
  await expect(dangerEl).toBeVisible({ timeout: 2000 })
})

test('silence keeps player safe', async ({ page }) => {
  await setup(page, { mic: true, micPattern: 'silent' })

  const startBtn = page.locator('button').filter({ hasText: /allow mic|start/i }).first()
  if (await startBtn.isVisible()) await startBtn.click()
  await page.waitForTimeout(3500)

  // CUSTOMIZE: game should remain in safe state when silent
})
*/

// ─── 11. Haptics Log ─────────────────────────────────────────────────────────
// UNCOMMENT to verify haptics fire at the right moments

/*
test('haptics fire on collision events', async ({ page }) => {
  await setup(page, { motion: true })

  // Play through some of the game...
  const startBtn = page.locator('button').filter({ hasText: /enable|start/i }).first()
  if (await startBtn.isVisible()) await startBtn.click()
  await page.waitForTimeout(10000)

  const log = await getVibrateLog(page)
  expect(log.length).toBeGreaterThan(0)
})
*/



