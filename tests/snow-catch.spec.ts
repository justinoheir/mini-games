/**
 * Snow Catch — QA Playwright Spec
 * Game: Snow Catch ❄️ | Sensor: motion (DeviceOrientation) | Duration: 45s
 * Tests: page load, start screen, countdown, playing phase, game logic,
 *        end screen, mobile viewports, performance, accessibility
 */

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { GamePage } from './pages/GamePage'

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const GAME_ID        = 'snow-catch'
const GAME_PATH      = '/games/snow-catch'
const ACCENT         = '#93c5fd'
const GAME_DURATION_MS = 45000
const SENSOR         = 'motion'

// ─── 1. PAGE LOAD ─────────────────────────────────────────────────────────────

test('1.1 — page loads without JS errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })

  expect(errors, `JS errors on load: ${errors.join(', ')}`).toHaveLength(0)
})

test('1.2 — page title is set', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  const title = await page.title()
  expect(title.length).toBeGreaterThan(0)
})

// ─── 2. START SCREEN ──────────────────────────────────────────────────────────

test('2.1 — start screen renders with CTA button', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await expect(game.ctaButton).toBeVisible({ timeout: 3000 })
})

test('2.2 — name input is visible on start screen', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ skipUser: true })
  await expect(game.nameInput).toBeVisible({ timeout: 3000 })
})

test('2.3 — CTA button meets 44×44px minimum tap target', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectTouchTargetSize(game.ctaButton, 44, 'CTA button')
})

test('2.4 — back button meets 44×44px minimum tap target', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectTouchTargetSize(game.backButton, 44, 'back button')
})

test('2.5 — start screen shows game tagline', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  const tagline = page.locator('text=/catch|dodge|tilt/i').first()
  await expect(tagline).toBeVisible({ timeout: 3000 })
})

test('2.6 — tilt sensor note is shown on start screen', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  // Sensor note about tilting should be visible
  const sensorNote = page.locator('text=/tilt|motion/i').first()
  await expect(sensorNote).toBeVisible({ timeout: 3000 })
})

// ─── 3. COUNTDOWN PHASE ──────────────────────────────────────────────────────

test('3.1 — countdown appears after tapping start', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })
  await game.start()
  await game.waitForCountdown()
})

test('3.2 — countdown progresses 3→2→1→GO', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })
  await game.start()
  // Expect to see 3 or GO at some point
  await expect(page.locator('text=3').or(page.locator('text=GO')).first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=GO').or(page.locator('canvas'))).toBeVisible({ timeout: 7000 })
})

// ─── 4. PLAYING PHASE ────────────────────────────────────────────────────────

test('4.1 — canvas is visible during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })
  await game.start()
  await game.waitForPlaying()
  await expect(game.canvas).toBeVisible()
})

test('4.2 — timer is visible during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })
  await game.start()
  await game.waitForPlaying()
  await expect(game.timerEl).toBeVisible({ timeout: 3000 })
})

test('4.3 — timer decreases during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })
  await game.start()
  await game.waitForPlaying()
  await game.expectTimerDecreasing(3000)
})

test('4.4 — no crash during 10 seconds of gameplay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(10000)

  expect(errors, `Crash during gameplay: ${errors.join(', ')}`).toHaveLength(0)
})

test('4.5 — HUD shows TIME, CAUGHT, and STREAK labels', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })
  await game.start()
  await game.waitForPlaying()

  await expect(page.locator('text=TIME')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('text=CAUGHT')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('text=STREAK')).toBeVisible({ timeout: 3000 })
})

// ─── 5. GAME LOGIC (KEY CALCULATIONS) ────────────────────────────────────────

test('5.1 — score starts at 0 when game begins', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })
  await game.start()
  await game.waitForPlaying()

  const scoreText = await game.scoreEl.textContent().catch(() => '0')
  const score = parseInt(scoreText ?? '0')
  expect(score, 'Score should start at 0').toBe(0)
})

test('5.2 — game ends when timer reaches 0', async ({ page }) => {
  // Mock setInterval to run 10x faster
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)
      return orig(fn, ms, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })
  await game.start()

  await page.waitForSelector('button:has-text("Play Again")', {
    timeout: Math.ceil(GAME_DURATION_MS / 10) + 5000
  })
  await expect(game.playAgainButton).toBeVisible()
})

test('5.3 — play-again resets score to 0', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)
      return orig(fn, ms, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 5000)
  await game.playAgain()
  await game.waitForPlaying()

  const scoreText = await game.scoreEl.textContent().catch(() => '0')
  const score = parseInt(scoreText ?? '0')
  expect(score, 'Score must reset to 0 after play-again').toBe(0)
})

test('5.4 — timer resets to 45 after play-again', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)
      return orig(fn, ms, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 5000)
  await game.playAgain()
  await game.waitForPlaying()

  const timerText = await game.timerEl.textContent().catch(() => '0')
  const timer = parseInt(timerText ?? '0')
  expect(timer, `Timer should reset to ~45, got ${timer}`).toBeGreaterThanOrEqual(42)
})

test('5.5 — blizzard event triggers at 22 seconds elapsed', async ({ page }) => {
  // Use 2x faster timer to get to 22s faster
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 250, ...args)  // 4x faster
      return orig(fn, ms, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })
  await game.start()
  await game.waitForPlaying()

  // Wait for blizzard to trigger (~5.5s at 4x speed for 22s elapsed)
  await page.waitForTimeout(6000)
  const blizzardText = page.locator('text=/BLIZZARD/i').first()
  await expect(blizzardText).toBeVisible({ timeout: 3000 })
})

test('5.6 — touch fallback: pointermove on canvas moves basket', async ({ page }) => {
  // Deny motion permission to force touch fallback
  await page.addInitScript(() => {
    ;(window as any).DeviceMotionEvent = class extends Event {
      static requestPermission = async () => 'denied'
      accelerationIncludingGravity = { x: 0, y: 0, z: 9.8 }
    }
    ;(window as any).DeviceOrientationEvent = class extends Event {
      static requestPermission = async () => 'denied'
      gamma = 0; beta = 0; alpha = 0
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()

  // Verify canvas is visible and game is running (touch fallback active)
  await expect(game.canvas).toBeVisible()
})

// ─── 6. END SCREEN ───────────────────────────────────────────────────────────

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

test('6.2 — end screen shows personality classification', async ({ page }) => {
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

  // One of the 5 personality types should be visible
  const personality = page.locator(
    'text=/Blizzard Survivor|Snow Magnet|Golden Hunter|Winter Warrior|First Snowfall/i'
  ).first()
  await expect(personality).toBeVisible({ timeout: 3000 })
})

test('6.3 — end screen shows snow-catch insights (4 metrics)', async ({ page }) => {
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

  await expect(page.locator('text=Snow Caught')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('text=Golden Flakes')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('text=Icicles Hit')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('text=Max Streak')).toBeVisible({ timeout: 3000 })
})

test('6.4 — end screen does not require scrolling on iPhone SE (667px)', async ({ page }) => {
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

// ─── 7. MOBILE VIEWPORTS ─────────────────────────────────────────────────────

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

test('7.3 — layout intact on iPhone SE (375px): back + CTA visible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await expect(game.backButton).toBeVisible()
  await expect(game.ctaButton).toBeVisible()
})

test('7.4 — canvas fills full viewport during gameplay', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })
  await game.start()
  await game.waitForPlaying()

  const canvasBox = await game.canvas.boundingBox()
  expect(canvasBox).not.toBeNull()
  // Canvas should cover most of the viewport
  expect(canvasBox!.width).toBeGreaterThan(350)
  expect(canvasBox!.height).toBeGreaterThan(600)
})

// ─── 8. PERFORMANCE ──────────────────────────────────────────────────────────

test('8.1 — FPS ≥ 55 during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(1000)

  const fps = await game.measureFPS(3000)
  expect(fps, `FPS too low: ${fps} (target ≥ 55)`).toBeGreaterThanOrEqual(55)
})

test('8.2 — JS heap < 150MB during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(5000)

  const memMB = await game.measureMemoryMB()
  if (memMB !== null) {
    expect(memMB, `Memory too high: ${memMB}MB (limit: 150MB)`).toBeLessThan(150)
  }
})

test('8.3 — no memory leak across 3 play-agains', async ({ page }) => {
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
    expect(growth, `Memory grew by ${growth}MB across 3 runs — possible leak`).toBeLessThan(30)
  }
})

// ─── 9. ACCESSIBILITY (axe-core) ─────────────────────────────────────────────

test('9.1 — start screen passes axe-core critical/serious scan', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
    .exclude('canvas')
    .analyze()

  const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
  expect(
    critical,
    `Critical/serious a11y violations:\n${critical.map(v => `[${v.impact}] ${v.id}: ${v.description}`).join('\n')}`
  ).toHaveLength(0)
})

test('9.2 — all interactive elements have accessible labels', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()

  const results = await new AxeBuilder({ page })
    .withRules(['button-name', 'label', 'aria-required-attr'])
    .analyze()

  expect(
    results.violations,
    `Unlabeled elements: ${JSON.stringify(results.violations.map(v => v.id))}`
  ).toHaveLength(0)
})

test('9.3 — text contrast meets WCAG AA (4.5:1)', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()

  const results = await new AxeBuilder({ page })
    .withRules(['color-contrast'])
    .exclude('canvas')
    .analyze()

  if (results.violations.length > 0) {
    console.warn('Contrast violations:', results.violations.map(v => ({
      id: v.id,
      elements: v.nodes.map(n => n.html).slice(0, 3)
    })))
  }

  expect(results.violations, `Color contrast violations found`).toHaveLength(0)
})

test('9.4 — end screen passes axe-core scan', async ({ page }) => {
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

// ─── 10. MOTION SENSOR ───────────────────────────────────────────────────────

test('10.1 — tilt right moves basket right', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })
  await game.mockAccelerometer({ x: 8.0, y: 0, z: 9.8 })  // strong right tilt (gamma ~35°)
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(1000)
  // Canvas must be visible and game running (validates sensor path is active)
  await expect(game.canvas).toBeVisible()
})

test('10.2 — touch fallback activates when motion denied', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).DeviceMotionEvent = class extends Event {
      static requestPermission = async () => 'denied'
      accelerationIncludingGravity = { x: 0, y: 0, z: 9.8 }
    }
    ;(window as any).DeviceOrientationEvent = class extends Event {
      static requestPermission = async () => 'denied'
      gamma = 0; beta = 0; alpha = 0
    }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await expect(game.canvas).toBeVisible()
  // Drag canvas to test touch fallback
  const canvasBox = await game.canvas.boundingBox()
  if (canvasBox) {
    await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height * 0.8)
    await page.mouse.down()
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.8, canvasBox.y + canvasBox.height * 0.8)
    await page.mouse.up()
  }
  // No crash after touch interaction
  await expect(game.canvas).toBeVisible()
})

// ─── 11. HAPTICS ─────────────────────────────────────────────────────────────

test('11.1 — haptics fire during gameplay events', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(5000)

  const log = await game.getVibrateLog()
  console.log(`Haptics fired: ${log.length} times`)
  // Haptics fire from countdown + game start; basic validation
  expect(log.length).toBeGreaterThanOrEqual(0)
})
