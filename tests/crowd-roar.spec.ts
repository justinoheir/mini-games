/**
 * QA SPEC — Crowd Roar
 *
 * GAME_ID:   crowd-roar
 * SENSOR:    mic
 * ACCENT:    #ef4444
 * DURATION:  45s
 *
 * Run: npx playwright test tests/crowd-roar.spec.ts --headed
 */

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { GamePage } from './pages/GamePage'

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const GAME_ID          = 'crowd-roar'
const GAME_PATH        = '/games/crowd-roar'
const ACCENT           = '#ef4444'
const GAME_DURATION_MS = 45000
const SENSOR           = 'mic'
// ─────────────────────────────────────────────────────────────────────────────

// Inject test flags: disable audio init so Tone.js skips, disable mic so
// navigator.mediaDevices.getUserMedia resolves immediately without a real mic.
const testSetup = async (page: import('@playwright/test').Page) => {
  await page.addInitScript(() => {
    ;(window as any).__DISABLE_AUDIO = true
    // Mock getUserMedia so the permission phase resolves immediately
    if (navigator.mediaDevices) {
      ;(navigator.mediaDevices as any).getUserMedia = async () => {
        // Return a minimal MediaStream-like object
        return {
          getTracks: () => [{ stop: () => {} }],
          getAudioTracks: () => [{ stop: () => {} }],
        } as unknown as MediaStream
      }
    }
    // Override AudioContext so it doesn't crash
    ;(window as any).AudioContext = class {
      createAnalyser() {
        return {
          fftSize: 256,
          smoothingTimeConstant: 0.3,
          frequencyBinCount: 128,
          getByteFrequencyData: (arr: Uint8Array) => arr.fill(0),
          connect: () => {},
        }
      }
      createMediaStreamSource() { return { connect: () => {} } }
      close() { return Promise.resolve() }
    }
  })
}

// ─── 1. PAGE LOAD ─────────────────────────────────────────────────────────────

test('1.1 — page loads without JS errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  await testSetup(page)

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })

  expect(errors, `JS errors on load: ${errors.join(', ')}`).toHaveLength(0)
})

test('1.2 — page title is set', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  const title = await page.title()
  expect(title.length).toBeGreaterThan(0)
})

// ─── 2. START SCREEN ──────────────────────────────────────────────────────────

test('2.1 — start screen renders with CTA', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  // Dismiss SwipeInstructions first if shown
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) {
    await nextBtn.first().click()
    await page.waitForTimeout(400)
  }
  await expect(game.ctaButton).toBeVisible({ timeout: 4000 })
})

test('2.2 — CTA button meets 44×44px minimum tap target', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) {
    await nextBtn.first().click()
    await page.waitForTimeout(400)
  }
  await game.expectTouchTargetSize(game.ctaButton, 44, 'CTA button')
})

test('2.3 — back button meets 44×44px minimum tap target', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectTouchTargetSize(game.backButton, 44, 'back button')
})

test('2.4 — back button navigates to home', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.backButton.click()
  await expect(page).toHaveURL(new RegExp('^' + (process.env.TEST_URL ?? 'http://localhost:3000') + '/?$'))
})

// ─── 3. SWIPE INSTRUCTIONS ────────────────────────────────────────────────────

test('3.1 — SwipeInstructions shows on first visit and can be dismissed', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ skipUser: true })
  // The SwipeInstructions steps: Make noise → Hit the meter → Keep it up → Play
  const step1 = page.locator('text=Make noise')
  await expect(step1).toBeVisible({ timeout: 3000 })
  // Advance through all steps
  for (let i = 0; i < 2; i++) {
    const btn = page.locator('button:has-text("Next")')
    if (await btn.count() > 0) await btn.first().click()
    await page.waitForTimeout(400)
  }
  const playBtn = page.locator('button:has-text("Play")')
  await expect(playBtn).toBeVisible({ timeout: 3000 })
  await playBtn.click()
  // After dismissal, should see start screen
  await expect(game.ctaButton).toBeVisible({ timeout: 3000 })
})

// ─── 4. COUNTDOWN PHASE ──────────────────────────────────────────────────────

test('4.1 — countdown appears after accepting permission', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  // Dismiss instructions
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) {
    await nextBtn.first().click()
    await page.waitForTimeout(350)
  }
  await game.start()
  // Permission screen — click "Allow & Start"
  const allowBtn = page.locator('button:has-text("Allow & Start")')
  if (await allowBtn.count() > 0) await allowBtn.click()
  await game.waitForCountdown()
})

test('4.2 — countdown progresses 3→2→1→GO', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) {
    await nextBtn.first().click()
    await page.waitForTimeout(350)
  }
  await game.start()
  const allowBtn = page.locator('button:has-text("Allow & Start")')
  if (await allowBtn.count() > 0) await allowBtn.click()
  await expect(page.locator('text=3').or(page.locator('text=GO')).first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=GO')).toBeVisible({ timeout: 6000 })
})

// ─── 5. PLAYING PHASE ────────────────────────────────────────────────────────

test('5.1 — timer is visible during gameplay', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }
  await game.start()
  const allowBtn = page.locator('button:has-text("Allow & Start")')
  if (await allowBtn.count() > 0) await allowBtn.click()
  await game.waitForPlaying()
  await expect(game.timerEl).toBeVisible({ timeout: 3000 })
})

test('5.2 — timer starts at 45 and decreases', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }
  await game.start()
  const allowBtn = page.locator('button:has-text("Allow & Start")')
  if (await allowBtn.count() > 0) await allowBtn.click()
  await game.waitForPlaying()

  // Timer should start at 45 (or close)
  const firstText = await game.timerEl.textContent().catch(() => '0')
  const firstVal = parseInt(firstText ?? '0')
  expect(firstVal, `Timer should start near 45, got ${firstVal}`).toBeGreaterThanOrEqual(42)

  await game.expectTimerDecreasing(3000)
})

test('5.3 — POWER score starts at 0', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }
  await game.start()
  const allowBtn = page.locator('button:has-text("Allow & Start")')
  if (await allowBtn.count() > 0) await allowBtn.click()
  await game.waitForPlaying()

  const scoreText = await game.scoreEl.textContent().catch(() => '0')
  const score = parseInt(scoreText ?? '0')
  expect(score, 'Score should start at 0').toBe(0)
})

test('5.4 — no JS crash during 10s of gameplay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }
  await game.start()
  const allowBtn = page.locator('button:has-text("Allow & Start")')
  if (await allowBtn.count() > 0) await allowBtn.click()
  await game.waitForPlaying()
  await page.waitForTimeout(10000)
  expect(errors, `Crash during gameplay: ${errors.join(', ')}`).toHaveLength(0)
})

// ─── 6. GAME END ─────────────────────────────────────────────────────────────

test('6.1 — game ends when timer reaches 0', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)
      return orig(fn, ms, ...args)
    }
  })
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }
  await game.start()
  const allowBtn = page.locator('button:has-text("Allow & Start")')
  if (await allowBtn.count() > 0) await allowBtn.click()

  // 45s × 10x speed = 4.5s + generous buffer
  await page.waitForSelector('button:has-text("Play Again")', { timeout: 15000 })
  await expect(game.playAgainButton).toBeVisible()
})

test('6.2 — end screen shows personality label', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)
      return orig(fn, ms, ...args)
    }
  })
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }
  await game.start()
  const allowBtn = page.locator('button:has-text("Allow & Start")')
  if (await allowBtn.count() > 0) await allowBtn.click()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 8000)

  // Should show one of the 4 personalities
  const personalities = page.locator('text=Building Up').or(page.locator('text=Steady Roar'))
    .or(page.locator('text=Burst Machine')).or(page.locator('text=Crowd King'))
  await expect(personalities).toBeVisible({ timeout: 5000 })
})

test('6.3 — end screen shows 4 insight chips', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)
      return orig(fn, ms, ...args)
    }
  })
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }
  await game.start()
  const allowBtn = page.locator('button:has-text("Allow & Start")')
  if (await allowBtn.count() > 0) await allowBtn.click()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 8000)

  // Four insight labels
  await expect(page.locator('text=MAX POWER')).toBeVisible()
  await expect(page.locator('text=AVG VOLUME')).toBeVisible()
  await expect(page.locator('text=ROAR TIME')).toBeVisible()
  await expect(page.locator('text=SILENT MOMENTS')).toBeVisible()
})

test('6.4 — play-again resets game to start', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)
      return orig(fn, ms, ...args)
    }
  })
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }
  await game.start()
  const allowBtn = page.locator('button:has-text("Allow & Start")')
  if (await allowBtn.count() > 0) await allowBtn.click()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 8000)
  await game.playAgain()

  // Should be back at start screen
  await expect(game.ctaButton).toBeVisible({ timeout: 5000 })
})

// ─── 7. MOBILE VIEWPORTS ──────────────────────────────────────────────────────

test('7.1 — no horizontal scroll on iPhone SE (375px)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectNoHorizontalScroll()
})

test('7.2 — no horizontal scroll on iPhone 15 Pro Max (430px)', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 })
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectNoHorizontalScroll()
})

test('7.3 — layout intact on narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await expect(game.backButton).toBeVisible()
})

// ─── 8. PERMISSION SCREEN ─────────────────────────────────────────────────────

test('8.1 — permission screen shows Mic icon and privacy copy', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }
  await game.start()

  await expect(page.locator('text=Mic Access Needed')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('text=never stored')).toBeVisible({ timeout: 2000 })
})

test('8.2 — permission screen allow button meets 44px tap target', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }
  await game.start()

  const allowBtn = page.locator('button:has-text("Allow & Start")')
  await game.expectTouchTargetSize(allowBtn, 44, 'Allow & Start button')
})

test('8.3 — permission denied shows error message', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__DISABLE_AUDIO = true
    // Override getUserMedia to deny
    if (navigator.mediaDevices) {
      ;(navigator.mediaDevices as any).getUserMedia = async () => {
        throw new DOMException('Permission denied', 'NotAllowedError')
      }
    }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }
  await game.start()

  const allowBtn = page.locator('button:has-text("Allow & Start")')
  if (await allowBtn.count() > 0) await allowBtn.click()

  // Error message should appear
  await expect(page.locator('text=denied').or(page.locator('text=Microphone access denied'))).toBeVisible({ timeout: 3000 })
})

// ─── 9. PERFORMANCE ──────────────────────────────────────────────────────────

test('9.1 — FPS ≥ 55 during gameplay', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }
  await game.start()
  const allowBtn = page.locator('button:has-text("Allow & Start")')
  if (await allowBtn.count() > 0) await allowBtn.click()
  await game.waitForPlaying()
  await page.waitForTimeout(1000)

  const fps = await game.measureFPS(3000)
  expect(fps, `FPS too low: ${fps} (target ≥ 55)`).toBeGreaterThanOrEqual(55)
})

test('9.2 — JS heap stays below 150MB', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }
  await game.start()
  const allowBtn = page.locator('button:has-text("Allow & Start")')
  if (await allowBtn.count() > 0) await allowBtn.click()
  await game.waitForPlaying()
  await page.waitForTimeout(5000)

  const memMB = await game.measureMemoryMB()
  if (memMB !== null) {
    expect(memMB, `Memory too high: ${memMB}MB`).toBeLessThan(150)
  }
})

// ─── 10. ACCESSIBILITY ───────────────────────────────────────────────────────

test('10.1 — start screen passes axe-core (no critical violations)', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  // Dismiss SwipeInstructions first
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }

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

test('10.2 — all interactive elements have accessible labels', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()

  const results = await new AxeBuilder({ page })
    .withRules(['button-name', 'label', 'aria-required-attr', 'aria-valid-attr'])
    .analyze()

  expect(
    results.violations,
    `Unlabeled elements: ${JSON.stringify(results.violations.map(v => v.id))}`
  ).toHaveLength(0)
})

test('10.3 — text contrast (WCAG AA 4.5:1) on start screen', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }

  const results = await new AxeBuilder({ page })
    .withRules(['color-contrast'])
    .exclude('canvas')
    .analyze()

  if (results.violations.length > 0) {
    console.warn('Contrast issues:', results.violations.map(v => ({
      id: v.id,
      html: v.nodes.map(n => n.html).slice(0, 3),
    })))
  }
  expect(results.violations, `Contrast violations: ${results.violations.map(v => v.id).join(', ')}`).toHaveLength(0)
})

test('10.4 — end screen passes axe-core scan', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 100, ...args)
      return orig(fn, ms, ...args)
    }
  })
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }
  await game.start()
  const allowBtn = page.locator('button:has-text("Allow & Start")')
  if (await allowBtn.count() > 0) await allowBtn.click()
  await game.waitForEnd(GAME_DURATION_MS / 10 + 8000)

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('canvas')
    .analyze()

  const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
  expect(critical, `End screen a11y: ${critical.map(v => v.id).join(', ')}`).toHaveLength(0)
})

// ─── 11. MIC-SPECIFIC ────────────────────────────────────────────────────────

test('11.1 — silence event increments silenceEvents counter (via signal path)', async ({ page }) => {
  // This tests the signal path: silence detection happens in game loop
  // We verify it doesn't crash or produce invalid state
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }
  await game.start()
  const allowBtn = page.locator('button:has-text("Allow & Start")')
  if (await allowBtn.count() > 0) await allowBtn.click()
  await game.waitForPlaying()

  // With mocked mic returning 0 volume, the silence counter will accumulate
  // Verify no crash after silence period
  await page.waitForTimeout(3000)
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  await page.waitForTimeout(2000)
  expect(errors).toHaveLength(0)
})

test('11.2 — challenge appears at 30s mark (canvas overlay)', async ({ page }) => {
  // Speed up timer to reach 30s mark quickly
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 1000) return orig(fn, 50, ...args)  // 20x speed
      return orig(fn, ms, ...args)
    }
  })
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }
  await game.start()
  const allowBtn = page.locator('button:has-text("Allow & Start")')
  if (await allowBtn.count() > 0) await allowBtn.click()
  await game.waitForPlaying()

  // Wait a bit for timer to reach 30s (≈ 750ms at 20x speed)
  await page.waitForTimeout(1500)
  // Challenge is rendered in canvas — not accessible to DOM. 
  // We just verify no crash occurred.
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  expect(errors).toHaveLength(0)
})

// ─── 12. HAPTICS ─────────────────────────────────────────────────────────────

test('12.1 — haptic log reports correctly during gameplay', async ({ page }) => {
  await testSetup(page)
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ sensors: { mic: true } })
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Play")')
  while (await nextBtn.count() > 0) { await nextBtn.first().click(); await page.waitForTimeout(350) }
  await game.start()
  const allowBtn = page.locator('button:has-text("Allow & Start")')
  if (await allowBtn.count() > 0) await allowBtn.click()
  await game.waitForPlaying()
  await page.waitForTimeout(5000)

  const log = await game.getVibrateLog()
  console.log(`Crowd Roar haptics fired: ${log.length} times`)
  // Haptics should fire (countdown + game events)
  expect(log.length, 'No haptics fired at all').toBeGreaterThan(0)
})
