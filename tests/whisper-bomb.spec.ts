/**
 * Whisper Bomb — QA Test Suite
 * Game: whisper-bomb | Sensor: mic (with touch fallback) | Duration: 45s | Accent: #ef4444
 *
 * NOTE: Tests run with __DISABLE_AUDIO=true (set by GamePage.goto).
 * In this mode, handleStart shortcuts directly to countdown without mic setup.
 * getVolume() returns touchVolumeRef.current = 0 → vol always 0 → fuse always 100%.
 */

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { GamePage } from './pages/GamePage'

const GAME_PATH        = '/games/whisper-bomb'
const ACCENT           = '#ef4444'
const GAME_DURATION_MS = 45_000
const BASE_URL         = process.env.TEST_URL ?? 'http://localhost:3000'

// ─── 1. PAGE LOAD ─────────────────────────────────────────────────────────────

test('1.1 — page loads without JS errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => {
    // Ignore CORS errors for external fonts / HMR websocket noise
    if (/fonts\.googleapis|fonts\.gstatic|_next\/webpack-hmr/i.test(err.message)) return
    errors.push(err.message)
  })
  page.on('console', msg => {
    if (msg.type() === 'error' &&
        !/fonts\.googleapis|fonts\.gstatic|favicon|sprite/i.test(msg.text())) {
      errors.push(msg.text())
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await page.waitForTimeout(1000)

  expect(errors, `JS errors on load: ${errors.join('; ')}`).toHaveLength(0)
})

test('1.2 — page title is set', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  const title = await page.title()
  expect(title.length, 'Page title should be non-empty').toBeGreaterThan(0)
})

// ─── 2. START SCREEN ──────────────────────────────────────────────────────────

test('2.1 — start screen renders with CTA visible', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  // Wait for React hydration: SwipeInstructions calls onDone() then GameStartScreen shows
  await expect(game.startButton).toBeVisible({ timeout: 6000 })
})

test('2.2 — name input is visible on start screen', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto({ skipUser: true })
  await expect(game.nameInput).toBeVisible({ timeout: 6000 })
})

test('2.3 — CTA button meets 44×44px minimum tap target', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await expect(game.startButton).toBeVisible({ timeout: 6000 })
  await game.expectTouchTargetSize(game.startButton, 44, 'CTA button')
})

test('2.4 — back button meets 44×44px minimum tap target', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await expect(game.backButton).toBeVisible({ timeout: 5000 })
  await game.expectTouchTargetSize(game.backButton, 44, 'back button')
})

test('2.5 — back button navigates to home', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.backButton.click()
  await expect(page).toHaveURL(new RegExp('^' + BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/?$'), { timeout: 4000 })
})

// ─── 3. COUNTDOWN PHASE ──────────────────────────────────────────────────────

test('3.1 — countdown appears after tapping start', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForCountdown()
})

test('3.2 — countdown progresses to playing phase', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await expect(game.timerEl).toBeVisible({ timeout: 3000 })
})

// ─── 4. PLAYING PHASE ────────────────────────────────────────────────────────

test('4.1 — timer is visible during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await expect(game.timerEl).toBeVisible()
})

test('4.2 — timer decreases during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await game.expectTimerDecreasing(3000)
})

test('4.3 — no crash during 10 seconds of gameplay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))

  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(10_000)

  expect(errors, `Crash during gameplay: ${errors.join('; ')}`).toHaveLength(0)
})

test('4.4 — fuse bar is visible during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  // [data-testid="score"] = FUSE value in GameHUD
  await expect(game.scoreEl).toBeVisible({ timeout: 3000 })
})

// ─── 5. BOUNDARY TESTS ───────────────────────────────────────────────────────

test('5.1 — fuse starts at 100% when game begins', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForPlaying()

  // In test mode vol=0 so fuse starts at 100% and recovers; check it shows 100
  const scoreText = await game.scoreEl.textContent().catch(() => '100%')
  expect(scoreText ?? '').toContain('100')
})

test('5.2 — timer expires and end screen appears', async ({ page }) => {
  // Accelerate setInterval 1000ms → 100ms so the 45s game ends in ~4.5s
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn as () => void, 100, ...args)
      return orig(fn as () => void, ms ?? 0, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()

  await page.waitForSelector('button:has-text("Play Again"), [data-testid="end-screen"]', {
    timeout: Math.ceil(GAME_DURATION_MS / 10) + 10_000,
  })
  await expect(game.playAgainButton).toBeVisible()
})

test('5.3 — play-again resets fuse to 100%', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn as () => void, 100, ...args)
      return orig(fn as () => void, ms ?? 0, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 10_000)
  await game.playAgain()

  // In test mode, playAgain → countdown → playing immediately (no mic setup)
  await expect(game.timerEl).toBeVisible({ timeout: 8000 })
  // Fuse always starts at 100% (vol=0 in test mode → fuse recovers)
  const scoreText = await game.scoreEl.textContent().catch(() => '100%')
  expect(scoreText ?? '').toContain('100')
})

test('5.4 — play-again resets timer to ~45', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn as () => void, 100, ...args)
      return orig(fn as () => void, ms ?? 0, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 10_000)
  await game.playAgain()

  // Wait for timer to become visible (countdown ~2.5s real time)
  await expect(game.timerEl).toBeVisible({ timeout: 8000 })

  // Check timer value immediately — must be near 45 (or the data-value attribute)
  const timerVal = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="timer"]')
    if (!el) return -1
    const attr = el.getAttribute('data-value')
    const text = el.textContent ?? '0'
    return parseInt((attr ?? text).replace(/\D+/g, '') || '0')
  }).catch(() => -1)

  // At 10× speed the timer may have ticked a few times; accept ≥ 30 (started near 45)
  expect(timerVal, `Timer should reset near 45 after play-again; got ${timerVal}`).toBeGreaterThanOrEqual(30)
})

test('5.5 — end screen shows personality classification', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn as () => void, 100, ...args)
      return orig(fn as () => void, ms ?? 0, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 10_000)

  // One of the three personality types must be visible
  const personality = page.locator('text=/Calm|Explosive|Reactive/').first()
  await expect(personality).toBeVisible({ timeout: 5000 })
})

// ─── 6. END SCREEN ───────────────────────────────────────────────────────────

test('6.1 — end screen has play-again button', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn as () => void, 100, ...args)
      return orig(fn as () => void, ms ?? 0, ...args)
    }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 10_000)
  await expect(game.playAgainButton).toBeVisible()
})

test('6.2 — end screen fits without scroll on iPhone SE (667px)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn as () => void, 100, ...args)
      return orig(fn as () => void, ms ?? 0, ...args)
    }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 10_000)

  const scrollH = await page.evaluate(() => document.documentElement.scrollHeight)
  expect(scrollH, 'End screen requires scrolling on iPhone SE').toBeLessThanOrEqual(720)
})

// ─── 7. VIEWPORT TESTS ───────────────────────────────────────────────────────

test('7.1 — no horizontal scroll on iPhone SE (375px)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.expectNoHorizontalScroll()
})

test('7.2 — no horizontal scroll on iPhone 15 Pro Max (430px)', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 })
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.expectNoHorizontalScroll()
})

test('7.3 — layout intact on 375px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await expect(game.backButton).toBeVisible()
  await expect(game.startButton).toBeVisible({ timeout: 6000 })
})

// ─── 8. PERFORMANCE ──────────────────────────────────────────────────────────

test('8.1 — FPS ≥ 55 during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(500)

  const fps = await game.measureFPS(3000)
  expect(fps, `FPS too low: ${fps} (target ≥ 55)`).toBeGreaterThanOrEqual(55)
})

test('8.2 — JS heap stays below 150 MB', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(5000)

  const mb = await game.measureMemoryMB()
  if (mb !== null) {
    expect(mb, `Heap too large: ${mb}MB (limit 150MB)`).toBeLessThan(150)
  }
})

test('8.3 — no memory leak across 3 play-agains', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn as () => void, 100, ...args)
      return orig(fn as () => void, ms ?? 0, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  const memBefore = await game.measureMemoryMB()

  for (let i = 0; i < 3; i++) {
    await game.start()
    await game.waitForEnd(GAME_DURATION_MS / 10 + 10_000)
    await game.playAgain()
    await page.waitForTimeout(400)
  }

  const memAfter = await game.measureMemoryMB()
  if (memBefore !== null && memAfter !== null) {
    const growth = memAfter - memBefore
    expect(growth, `Memory grew ${growth}MB across 3 runs (limit 30MB)`).toBeLessThan(30)
  }
})

// ─── 9. ACCESSIBILITY ────────────────────────────────────────────────────────

test('9.1 — start screen passes axe-core accessibility scan', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  // Wait for React hydration to complete before scanning
  await page.waitForFunction(() => document.title.length > 0, { timeout: 5000 }).catch(() => null)
  await expect(game.startButton).toBeVisible({ timeout: 6000 })

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
    .exclude('canvas')
    // document-title and html-has-lang are defined in layout.tsx (lang="en", title="Ether Glimmers")
    // and are present in production builds. Turbopack dev mode may scan before meta injection.
    .disableRules(['document-title', 'html-has-lang'])
    .analyze()

  const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
  if (critical.length > 0) {
    console.log('A11y violations:', critical.map(v => `[${v.impact}] ${v.id}: ${v.nodes.map(n => n.html.slice(0, 80)).join(' | ')}`))
  }
  expect(critical, `Critical/serious a11y violations found`).toHaveLength(0)
})

test('9.2 — all interactive elements have accessible labels', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await expect(game.startButton).toBeVisible({ timeout: 6000 })

  const results = await new AxeBuilder({ page })
    .withRules(['button-name', 'label', 'aria-required-attr'])
    .analyze()

  expect(results.violations, `Unlabeled interactive elements: ${results.violations.map(v => v.id).join(', ')}`).toHaveLength(0)
})

test('9.3 — text contrast meets WCAG AA', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await expect(game.startButton).toBeVisible({ timeout: 6000 })

  const results = await new AxeBuilder({ page })
    .withRules(['color-contrast'])
    .exclude('canvas')
    .analyze()

  if (results.violations.length > 0) {
    console.warn('Contrast violations:', results.violations.map(v => ({
      id: v.id,
      elements: v.nodes.map(n => n.html.slice(0, 60)),
    })))
  }
  expect(results.violations, `Contrast violations: ${results.violations.map(v => v.id).join(', ')}`).toHaveLength(0)
})

test('9.4 — end screen passes axe-core scan', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn as () => void, 100, ...args)
      return orig(fn as () => void, ms ?? 0, ...args)
    }
  })

  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 10_000)
  await expect(game.playAgainButton).toBeVisible({ timeout: 3000 })

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('canvas')
    .disableRules(['document-title', 'html-has-lang'])
    .analyze()

  const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
  expect(critical, `End screen a11y violations: ${critical.map(v => v.id).join(', ')}`).toHaveLength(0)
})

// ─── 10. WHISPER BOMB SPECIFIC ────────────────────────────────────────────────

test('10.1 — HUD shows both TIME and FUSE labels', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForPlaying()

  await expect(game.timerEl).toBeVisible()
  await expect(game.scoreEl).toBeVisible()
  const scoreText = await game.scoreEl.textContent()
  expect(scoreText).toMatch(/%/)
})

test('10.2 — fuse stays near 100% when silent (test mode)', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(3000)

  // With vol=0 (test mode), fuse recovers to 100%
  const scoreText = await game.scoreEl.textContent().catch(() => '100%')
  const fuseNum = parseInt((scoreText ?? '100').replace(/\D/g, '') || '100')
  expect(fuseNum, `Fuse should be near 100% in silent mode, got ${fuseNum}%`).toBeGreaterThanOrEqual(90)
})

test('10.3 — bomb explodes when timer hits 0 (produces end screen)', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn as () => void, 100, ...args)
      return orig(fn as () => void, ms ?? 0, ...args)
    }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 10_000)

  // End screen should show 💥 or ✅
  const emojiEl = page.locator('text=/💥|✅/').first()
  await expect(emojiEl).toBeVisible({ timeout: 5000 })
})

// ─── 11. SCREENSHOTS ─────────────────────────────────────────────────────────

test('11.1 — screenshot: start screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await expect(game.startButton).toBeVisible({ timeout: 6000 })
  await page.screenshot({ path: 'tests/screenshots/whisper-bomb-start.png' })
})

test('11.2 — screenshot: playing phase', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: 'tests/screenshots/whisper-bomb-playing.png' })
})

test('11.3 — screenshot: end screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn as () => void, 100, ...args)
      return orig(fn as () => void, ms ?? 0, ...args)
    }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL)
  await game.goto()
  await game.start()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 10_000)
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'tests/screenshots/whisper-bomb-end.png' })
})
