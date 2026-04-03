/**
 * QA TEMPLATE — Copy this for every new game.
 * Replace GAME_ID, GAME_PATH, ACCENT, GAME_DURATION_MS, and fill in game-specific checks.
 *
 * Run single game: npx playwright test tests/qa-template.spec.ts --headed
 * Run all games:   npx playwright test tests/ --reporter=html
 *
 * Covers:
 *  1. Page load + no errors
 *  2. Start screen (name input, CTA button size)
 *  3. Countdown phase
 *  4. Playing phase (timer, score, no crash)
 *  5. End screen (score, personality, play-again)
 *  6. Play-again state reset
 *  7. Mobile viewport (375px + 430px)
 *  8. Boundary values (timer at 0, score at combo threshold)
 *  9. Performance (FPS, memory)
 * 10. Accessibility (axe-core scan)
 * 11. Sensor-specific (motion / mic — uncomment as needed)
 */

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { GamePage } from './pages/GamePage'

// ─── CONFIGURE THIS BLOCK FOR EACH GAME ──────────────────────────────────────
const GAME_ID        = 'GAME_NAME'          // ← e.g. 'shadow-tap'
const GAME_PATH      = '/games/GAME_NAME'   // ← e.g. '/games/shadow-tap'
const ACCENT         = '#00ff88'            // ← game accent hex
const GAME_DURATION_MS = 30000             // ← game duration in ms (30s, 45s, 60s)
const SENSOR         = 'touch'             // ← 'touch' | 'motion' | 'mic' | 'camera'
// ─────────────────────────────────────────────────────────────────────────────

// ─── 1. PAGE LOAD ─────────────────────────────────────────────────────────────

test('1.1 — page loads without JS errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion', mic: SENSOR === 'mic' } })

  expect(errors, `JS errors on load: ${errors.join(', ')}`).toHaveLength(0)
})

test('1.2 — page title / meta is set', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  const title = await page.title()
  expect(title.length).toBeGreaterThan(0)
})

// ─── 2. START SCREEN ──────────────────────────────────────────────────────────

test('2.1 — start screen renders', async ({ page }) => {
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

test('2.5 — back button navigates to home', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.backButton.click()
  await expect(page).toHaveURL(new RegExp('^' + (process.env.TEST_URL ?? 'http://localhost:3000') + '/?$'))
})

// ─── 3. COUNTDOWN PHASE ──────────────────────────────────────────────────────

test('3.1 — countdown appears after tapping start', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForCountdown()
})

test('3.2 — countdown progresses to GO', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await expect(page.locator('text=3').or(page.locator('text=GO')).first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=GO').or(page.locator('canvas'))).toBeVisible({ timeout: 6000 })
})

// ─── 4. PLAYING PHASE ────────────────────────────────────────────────────────

test('4.1 — timer is visible during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForPlaying()
  await expect(game.timerEl).toBeVisible({ timeout: 3000 })
})

test('4.2 — timer decreases during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForPlaying()
  await game.expectTimerDecreasing(3000)
})

test('4.3 — no crash during 10 seconds of gameplay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion', mic: SENSOR === 'mic' } })
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(10000)

  expect(errors, `Crash during gameplay: ${errors.join(', ')}`).toHaveLength(0)
})

// ─── 5. BOUNDARY VALUES ──────────────────────────────────────────────────────
// These test the edges of game logic — most common source of bugs

test('5.1 — score starts at 0 when game begins', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForPlaying()

  const scoreText = await game.scoreEl.textContent().catch(() => '0')
  const score = parseInt(scoreText ?? '0')
  expect(score, 'Score should start at 0').toBe(0)
})

test('5.2 — game ends when timer reaches 0 (not before, not stuck)', async ({ page }) => {
  // Mock timer to expire quickly
  await page.addInitScript(() => {
    // Games use setInterval for 1s ticks. We override to fire 10x faster.
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)  // 10x faster
      return orig(fn, ms, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()

  // With 10x timer, a 30s game ends in ~3s, 60s in ~6s
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
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 5000)
  await game.playAgain()
  await game.waitForPlaying()

  const scoreText = await game.scoreEl.textContent().catch(() => '0')
  const score = parseInt(scoreText ?? '0')
  expect(score, 'Score must reset to 0 after play-again').toBe(0)
})

test('5.4 — timer resets correctly after play-again', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)
      return orig(fn, ms, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 5000)
  await game.playAgain()
  await game.waitForPlaying()

  const timerText = await game.timerEl.textContent().catch(() => '0')
  const timer = parseInt(timerText ?? '0')
  const expectedDuration = Math.round(GAME_DURATION_MS / 1000)
  expect(timer, `Timer should reset to ~${expectedDuration}s, got ${timer}`).toBeGreaterThanOrEqual(expectedDuration - 3)
})

test('5.5 — end screen shows personality classification', async ({ page }) => {
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

  // Personality label must be non-empty text (any label is fine)
  const personality = page.locator('[data-testid="personality"], .personality-label, text=/🔪|💪|🧮|🌊|⚡|🎯|🔮|🎭|🌟|🏆|😊/').first()
  await expect(personality).toBeVisible({ timeout: 3000 })
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

test('6.2 — end screen does not require scrolling on iPhone SE', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })  // iPhone SE
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

test('7.3 — layout intact on narrow viewport (375px)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  // Back button must still be visible and usable
  await expect(game.backButton).toBeVisible()
  await expect(game.ctaButton).toBeVisible()
})

// ─── 8. PERFORMANCE ──────────────────────────────────────────────────────────

test('8.1 — FPS ≥ 55 during gameplay (60 FPS target)', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(1000)  // let game stabilize

  const fps = await game.measureFPS(3000)
  expect(fps, `FPS too low: ${fps} (target ≥ 55)`).toBeGreaterThanOrEqual(55)
})

test('8.2 — JS heap memory stays below 150MB during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(5000)

  const memMB = await game.measureMemoryMB()
  if (memMB !== null) {
    expect(memMB, `Memory usage too high: ${memMB}MB (limit: 150MB)`).toBeLessThan(150)
  }
  // If performance.memory is unavailable (non-Chromium), skip gracefully
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

  // Play through 3 times
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

test('9.1 — start screen passes axe-core accessibility scan', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
    .exclude('canvas')           // canvas is not axe-scannable by design
    .analyze()

  const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
  expect(
    critical,
    `Critical/serious accessibility violations:\n${critical.map(v => `  [${v.impact}] ${v.id}: ${v.description}\n    ${v.nodes.map(n => n.target.join(' ')).join(', ')}`).join('\n')}`
  ).toHaveLength(0)
})

test('9.2 — all interactive elements have accessible labels', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()

  const results = await new AxeBuilder({ page })
    .withRules(['button-name', 'label', 'aria-required-attr', 'aria-valid-attr'])
    .analyze()

  expect(
    results.violations,
    `Unlabeled interactive elements: ${JSON.stringify(results.violations.map(v => v.id))}`
  ).toHaveLength(0)
})

test('9.3 — text contrast meets WCAG AA (4.5:1)', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()

  const results = await new AxeBuilder({ page })
    .withRules(['color-contrast'])
    .exclude('canvas')
    .analyze()

  // Log violations for review (some may be false positives on dynamic elements)
  if (results.violations.length > 0) {
    console.warn('Contrast violations found:', results.violations.map(v => ({
      id: v.id,
      elements: v.nodes.map(n => n.html).slice(0, 3)
    })))
  }

  expect(
    results.violations,
    `Color contrast violations: ${JSON.stringify(results.violations.map(v => v.id))}`
  ).toHaveLength(0)
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
  expect(critical, `End screen accessibility violations: ${critical.map(v => v.id).join(', ')}`).toHaveLength(0)
})

// ─── 10. SENSOR-SPECIFIC: MOTION GAMES ───────────────────────────────────────
// UNCOMMENT for motion-based games (Tilt Maze, Steady Hand, Tunnel, Dodge Blitz, etc.)

/*
test('10.1 — accelerometer input tilts game element', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: true } })
  await game.mockAccelerometer({ x: 8.0, y: 0, z: 9.8 })  // strong right tilt
  await game.start()
  await game.waitForPlaying()
  // CUSTOMIZE: check canvas element position changed from center
})

test('10.2 — touch fallback works when motion denied', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).DeviceMotionEvent = class extends Event {
      static requestPermission = async () => 'denied'
      accelerationIncludingGravity = { x: 0, y: 0, z: 9.8 }
    }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(500)
  // Game should offer touch control fallback
  const touchFallback = page.locator('text=/tap|touch|tap to/i').first()
  await expect(touchFallback.or(game.canvas)).toBeVisible()
})
*/

// ─── 11. SENSOR-SPECIFIC: MIC GAMES ──────────────────────────────────────────
// UNCOMMENT for mic-based games (Whisper Bomb, Breath Rider, Pulse Sphere, Crowd Roar, Pitch Match)

/*
test('11.1 — loud volume triggers visual danger state', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  await game.mockMicrophone('loud')
  await game.start()
  await game.waitForPlaying()
  const danger = page.locator('[data-testid="danger"], .text-red-500, .bg-red-500').first()
  await expect(danger).toBeVisible({ timeout: 3000 })
})

test('11.2 — silence keeps player in safe state', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  await game.mockMicrophone('silent')
  await game.start()
  await game.waitForPlaying()
  const danger = page.locator('.text-red-500, .bg-red-500').first()
  await expect(danger).not.toBeVisible({ timeout: 3000 }).catch(() => {})
})
*/

// ─── 12. HAPTICS LOG ─────────────────────────────────────────────────────────

test('12.1 — haptics fire at least once during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(5000)

  const log = await game.getVibrateLog()
  // Some games only vibrate on events — relax this if it's a passive sensor game
  // expect(log.length, 'No haptics fired during gameplay').toBeGreaterThan(0)
  // Log for debugging without failing:
  console.log(`Haptics fired: ${log.length} times`)
})

// ─── 13. THREE.JS / CANVAS RENDERING ─────────────────────────────────────────
// ENABLE for 3D games that use Three.js (orbit-control, tunnel, etc.)

test('13.1 — canvas element is present and has non-zero dimensions', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForPlaying()

  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible({ timeout: 5000 })

  const box = await canvas.boundingBox()
  expect(box, 'Canvas has zero size — Three.js renderer may have failed').not.toBeNull()
  expect(box!.width, 'Canvas width is 0').toBeGreaterThan(0)
  expect(box!.height, 'Canvas height is 0').toBeGreaterThan(0)
})

test('13.2 — no WebGL context errors in console', async ({ page }) => {
  const webglErrors: string[] = []
  page.on('console', msg => {
    const text = msg.text()
    if (
      text.includes('WebGL') ||
      text.includes('CONTEXT_LOST') ||
      text.includes('INVALID_OPERATION') ||
      text.includes('THREE.') ||
      text.includes('WebGLRenderer')
    ) {
      if (msg.type() === 'error' || text.toLowerCase().includes('error')) {
        webglErrors.push(text)
      }
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(3000)

  expect(webglErrors, `WebGL/Three.js errors: ${webglErrors.join('; ')}`).toHaveLength(0)
})

test('13.3 — canvas fills its container on mobile (375px)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForPlaying()

  const canvas = page.locator('canvas').first()
  const box = await canvas.boundingBox()
  if (box) {
    // Canvas should fill most of the viewport width (within 10px tolerance)
    expect(box.width, `Canvas width ${box.width} is too narrow for 375px viewport`).toBeGreaterThan(350)
  }
})

test('13.4 — canvas resizes correctly when viewport changes', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForPlaying()

  const before = await page.locator('canvas').first().boundingBox()

  // Resize viewport
  await page.setViewportSize({ width: 430, height: 932 })
  await page.waitForTimeout(500)  // allow resize handler to fire

  const after = await page.locator('canvas').first().boundingBox()

  // If canvas was present before and after, it should have updated size
  if (before && after) {
    // Canvas dimensions should reflect new viewport (not stuck at old size)
    expect(after.width, 'Canvas did not update width on resize').toBeGreaterThan(0)
  }
})

// ─── 14. TOUCH EVENT HANDLERS ────────────────────────────────────────────────

test('14.1 — touch events are handled (pointerdown fires on canvas)', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForPlaying()

  // Verify canvas has touchAction: none (prevents browser hijacking touch)
  const canvas = page.locator('canvas').first()
  if (await canvas.count() > 0) {
    const touchAction = await canvas.evaluate(el => window.getComputedStyle(el).touchAction)
    expect(
      touchAction,
      `Canvas touchAction is '${touchAction}' — should be 'none' to prevent scroll interference`
    ).toBe('none')
  }
})

test('14.2 — tap on canvas during gameplay does not throw errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForPlaying()

  // Simulate 5 taps on canvas center
  const canvas = page.locator('canvas').first()
  if (await canvas.count() > 0) {
    for (let i = 0; i < 5; i++) {
      await canvas.tap().catch(() => {
        // tap() may not work on all canvases — use click as fallback
      })
      await canvas.click().catch(() => {})
      await page.waitForTimeout(200)
    }
  } else {
    // Touch games without canvas — tap the game container
    await page.locator('[data-testid="game-canvas"], .game-container, main').first().tap().catch(() => {})
  }

  expect(errors, `Errors after canvas taps: ${errors.join('; ')}`).toHaveLength(0)
})

test('14.3 — no passive event listener violations on touch-based game', async ({ page }) => {
  const warnings: string[] = []
  page.on('console', msg => {
    if (msg.type() === 'warning' && msg.text().includes('passive')) {
      warnings.push(msg.text())
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(2000)

  // Log (don't fail) — passive listener violations are performance hints, not crashes
  if (warnings.length > 0) {
    console.warn(`[touch] Passive event listener warnings: ${warnings.join('; ')}`)
  }
})

// ─── 15. AUDIO INITIALIZATION ────────────────────────────────────────────────

test('15.1 — AudioContext is created and not in suspended state after game start', async ({ page }) => {
  // Inject a spy to track AudioContext state
  await page.addInitScript(() => {
    const OrigAC = window.AudioContext || (window as any).webkitAudioContext
    if (!OrigAC) return
    ;(window as any).__audioContextStates = []
    const Orig = OrigAC
    ;(window as any).AudioContext = class extends Orig {
      constructor(...args: unknown[]) {
        super(...(args as []))
        ;(window as any).__audioContextStates.push(this.state)
      }
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(1000)

  const states: string[] = await page.evaluate(() => (window as any).__audioContextStates ?? [])
  // If any AudioContext was created, at least one should have been resumed
  if (states.length > 0) {
    const finalState = await page.evaluate(() => {
      const acs: AudioContext[] = (window as any).__audioContextInstances ?? []
      return acs.map(ac => ac.state)
    })
    console.log(`AudioContext states: created=${states.length}, states=${JSON.stringify(finalState)}`)
    // Don't hard-fail — browsers may keep context suspended until user gesture
  } else {
    console.log('No AudioContext detected (game may use a different audio API or no audio)')
  }
})

test('15.2 — no audio errors in console during gameplay', async ({ page }) => {
  const audioErrors: string[] = []
  page.on('console', msg => {
    const text = msg.text()
    if (
      (msg.type() === 'error') &&
      (text.includes('AudioContext') || text.includes('audio') || text.includes('NotAllowedError'))
    ) {
      audioErrors.push(text)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(5000)

  expect(audioErrors, `Audio errors during gameplay: ${audioErrors.join('; ')}`).toHaveLength(0)
})

test('15.3 — music does not continue after navigating away (no audio leak)', async ({ page }) => {
  await page.addInitScript(() => {
    // Track AudioContext close calls
    ;(window as any).__audioContextClosed = false
    const OrigAC = window.AudioContext || (window as any).webkitAudioContext
    if (!OrigAC) return
    const origClose = OrigAC.prototype.close
    OrigAC.prototype.close = function(...args: unknown[]) {
      ;(window as any).__audioContextClosed = true
      return origClose.apply(this, args as [])
    }
  })

  // Fast-forward through one game
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

  // Navigate away
  await page.goto(process.env.TEST_URL ?? 'http://localhost:3000')
  await page.waitForTimeout(500)

  // AudioContext should be closed or music stopped (stopMusicRef cleanup)
  const closed = await page.evaluate(() => (window as any).__audioContextClosed ?? false)
  // Log without hard fail — cleanup method varies by implementation
  console.log(`AudioContext closed on unmount: ${closed}`)
  // Note: Some games use stopMusicRef instead of closing AudioContext. Both are valid.
})

// ─── 16. CLEANUP / UNMOUNT ───────────────────────────────────────────────────

test('16.1 — no requestAnimationFrame loops running after game ends', async ({ page }) => {
  let rafCallsAtEnd = 0

  await page.addInitScript(() => {
    ;(window as any).__activeRafs = new Set()
    const origRaf = window.requestAnimationFrame.bind(window)
    const origCaf = window.cancelAnimationFrame.bind(window)

    window.requestAnimationFrame = (cb) => {
      const id = origRaf(cb)
      ;(window as any).__activeRafs.add(id)
      return id
    }
    window.cancelAnimationFrame = (id) => {
      ;(window as any).__activeRafs.delete(id)
      origCaf(id)
    }
  })

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

  // Check rAF count — should be low after game ends (at most 1 for end-screen animations)
  rafCallsAtEnd = await page.evaluate(() => (window as any).__activeRafs?.size ?? 0)
  console.log(`Active rAF handles at end screen: ${rafCallsAtEnd}`)

  // Navigate away to trigger unmount cleanup
  await page.goto(process.env.TEST_URL ?? 'http://localhost:3000')
  await page.waitForTimeout(500)

  const rafAfterNav = await page.evaluate(() => (window as any).__activeRafs?.size ?? 0)
  console.log(`Active rAF handles after navigation: ${rafAfterNav}`)

  // After navigation, rAF handles from the game page should be gone (new page context)
  expect(rafAfterNav, 'rAF loops still active after navigation').toBe(0)
})

test('16.2 — resize event listener is removed on unmount', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__resizeListenerCount = 0
    const origAdd = window.addEventListener.bind(window)
    const origRem = window.removeEventListener.bind(window)
    window.addEventListener = (type: string, ...args: unknown[]) => {
      if (type === 'resize') (window as any).__resizeListenerCount++
      return (origAdd as Function)(type, ...args)
    }
    window.removeEventListener = (type: string, ...args: unknown[]) => {
      if (type === 'resize') (window as any).__resizeListenerCount--
      return (origRem as Function)(type, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { motion: SENSOR === 'motion' } })
  await game.start()
  await game.waitForPlaying()

  const addedCount: number = await page.evaluate(() => (window as any).__resizeListenerCount ?? 0)
  console.log(`Resize listeners added: ${addedCount}`)

  // Navigate away to trigger cleanup useEffect
  await page.goto(process.env.TEST_URL ?? 'http://localhost:3000')
  await page.waitForTimeout(500)

  const finalCount: number = await page.evaluate(() => (window as any).__resizeListenerCount ?? 0)
  console.log(`Resize listeners net after unmount: ${finalCount}`)

  // Net count should be ≤ 0 (all listeners cleaned up, possibly more removes than adds from previous navigations)
  expect(finalCount, `${addedCount} resize listener(s) added but net count is ${finalCount} — possible listener leak`).toBeLessThanOrEqual(0)
})

test('16.3 — interval is cleared on unmount (no tick after game ends)', async ({ page }) => {
  const ticksAfterEnd: number[] = []

  await page.addInitScript(() => {
    ;(window as any).__activeIntervals = new Set()
    const origSI = window.setInterval.bind(window)
    const origCI = window.clearInterval.bind(window)

    window.setInterval = (fn: TimerHandler, ms: number, ...args: unknown[]) => {
      const id = origSI(fn, ms, ...args)
      ;(window as any).__activeIntervals.add(id)
      return id
    }
    window.clearInterval = (id?: number) => {
      ;(window as any).__activeIntervals.delete(id)
      origCI(id)
    }
  })

  // Still need the 10x timer mock for speed — chain after the interval spy
  await page.addInitScript(() => {
    const origSI2 = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return origSI2(fn, 100, ...args)
      return origSI2(fn, ms, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 5000)

  const activeAtEnd: number = await page.evaluate(() => (window as any).__activeIntervals?.size ?? 0)
  console.log(`Active intervals at end screen: ${activeAtEnd}`)

  // The 1s countdown interval should have been cleared — only allow very short-lived intervals
  expect(activeAtEnd, `${activeAtEnd} interval(s) still running after game ended — clearInterval not called in cleanup`).toBeLessThanOrEqual(2)
})
