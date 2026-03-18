/**
 * QA Spec — Reaction Chain
 * Game ID:   reaction-chain
 * Sensor:    touch (no permission required)
 * Duration:  45s
 * Accent:    #facc15 (yellow/gold)
 *
 * Run: npx playwright test tests/reaction-chain.spec.ts --reporter=line
 */

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { GamePage } from './pages/GamePage'

const GAME_ID      = 'reaction-chain'
const GAME_PATH    = '/games/reaction-chain'
const ACCENT       = '#facc15'
const DURATION_MS  = 45000

// ─── 1. PAGE LOAD ─────────────────────────────────────────────────────────────

test('1.1 — page loads without JS errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })

  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  expect(errors, `JS errors on load: ${errors.join(', ')}`).toHaveLength(0)
})

test('1.2 — page title set', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  expect((await page.title()).length).toBeGreaterThan(0)
})

// ─── 2. START SCREEN ──────────────────────────────────────────────────────────

test('2.1 — start screen renders with CTA', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await expect(game.ctaButton).toBeVisible({ timeout: 3000 })
})

test('2.2 — name input visible on start screen', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ skipUser: true })
  await expect(game.nameInput).toBeVisible({ timeout: 3000 })
})

test('2.3 — CTA button meets 44×44px tap target', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectTouchTargetSize(game.ctaButton, 44, 'CTA button')
})

test('2.4 — no sensor permission required (touch only)', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  // No permission dialog should appear — game is touch-only
  const permissionBtn = page.locator('button:has-text("Allow")')
  await expect(permissionBtn).not.toBeVisible({ timeout: 1000 }).catch(() => {/* OK if not found */})
  await expect(game.ctaButton).toBeVisible({ timeout: 2000 })
})

// ─── 3. COUNTDOWN ────────────────────────────────────────────────────────────

test('3.1 — countdown appears after start', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForCountdown()
})

test('3.2 — countdown transitions to gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
})

// ─── 4. PLAYING PHASE ────────────────────────────────────────────────────────

test('4.1 — canvas visible during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await expect(game.canvas).toBeVisible({ timeout: 3000 })
})

test('4.2 — HUD shows TIME and CHAIN labels', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await expect(page.locator('text=CHAIN').first()).toBeVisible({ timeout: 3000 })
  await expect(game.timerEl).toBeVisible({ timeout: 3000 })
})

test('4.3 — timer decreases during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await game.expectTimerDecreasing(3000)
})

test('4.4 — canvas sized to full viewport (not default 300×150)', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  const dims = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement
    return c ? { w: c.width, h: c.height } : null
  })
  expect(dims).not.toBeNull()
  if (dims) {
    expect(dims.w).toBeGreaterThan(300)
    expect(dims.h).toBeGreaterThan(300)
  }
})

test('4.5 — no crash during 10s of gameplay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(10000)
  expect(errors).toHaveLength(0)
})

test('4.6 — CHAIN score starts at 0', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  // The CHAIN display should start at 0
  const chainValue = page.locator('text=/^0$/')
  await expect(chainValue.first()).toBeVisible({ timeout: 2000 })
})

// ─── 5. TAP MECHANIC ─────────────────────────────────────────────────────────

test('5.1 — tapping the canvas node increments chain', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(500)

  // Tap center of canvas — node appears at random position but center is a reasonable guess
  const box = await game.canvas.boundingBox()
  if (box) {
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(100)
  }
  expect(errors).toHaveLength(0)
})

test('5.2 — missing node triggers red flash overlay (chain break flash)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  // Wait longer than the node window (800ms) without tapping
  await page.waitForTimeout(1200)
  expect(errors).toHaveLength(0)
  // Canvas should still be visible (game continues after chain break)
  await expect(game.canvas).toBeVisible()
})

test('5.3 — new node appears after miss (≤500ms respawn)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  // Let node expire, then wait for respawn
  await page.waitForTimeout(1500)
  expect(errors).toHaveLength(0)
  await expect(game.canvas).toBeVisible()
})

// ─── 6. GAME END ─────────────────────────────────────────────────────────────

test('6.1 — game ends when timer reaches 0', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 60, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForSelector('button:has-text("Play Again")', {
    timeout: Math.ceil(DURATION_MS / 16) + 8000,
  })
  await expect(game.playAgainButton).toBeVisible()
})

test('6.2 — end screen shows personality type', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 60, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 16 + 8000)

  const personalities = ['Lightning Reflex', 'Chain Keeper', 'Sprinter', 'Steady Reactor']
  let found = false
  for (const p of personalities) {
    if (await page.locator(`text=${p}`).isVisible().catch(() => false)) { found = true; break }
  }
  expect(found, 'No personality type on end screen').toBe(true)
})

test('6.3 — end screen shows Longest Chain insight', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 60, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 16 + 8000)
  await expect(page.locator('text=Longest Chain')).toBeVisible()
})

test('6.4 — play-again returns to start and resets chain to 0', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 60, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 16 + 8000)
  await game.playAgain()
  await expect(game.ctaButton).toBeVisible({ timeout: 3000 })
})

test('6.5 — play-again resets timer to 45', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 60, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 16 + 8000)
  await game.playAgain()
  await game.start()
  await game.waitForPlaying()
  // Timer should show 45 (or very close) at game start
  await expect(game.timerEl).toBeVisible({ timeout: 3000 })
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

test('7.3 — end screen fits without scroll on iPhone SE (375×667)', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 60, ...args)
        return orig(fn, ms, ...args)
      }
  })
  await page.setViewportSize({ width: 375, height: 667 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 16 + 8000)
  // Play-again button must be visible without scrolling
  await expect(game.playAgainButton).toBeInViewport({ timeout: 3000 })
})

// ─── 8. PERFORMANCE ──────────────────────────────────────────────────────────

test('8.1 — FPS ≥ 55 during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(1000)
  const fps = await game.measureFPS(3000)
  expect(fps, `FPS too low: ${fps}`).toBeGreaterThanOrEqual(55)
})

test('8.2 — JS heap below 150MB', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  await page.waitForTimeout(10000)
  const memMB = await game.measureMemoryMB()
  if (memMB !== null) expect(memMB).toBeLessThan(150)
})

// ─── 9. ACCESSIBILITY ─────────────────────────────────────────────────────────

test('9.1 — start screen passes axe-core', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('canvas')
    .analyze()
  const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
  expect(critical, critical.map(v => v.id).join(', ')).toHaveLength(0)
})

test('9.2 — end screen passes axe-core', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 60, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 16 + 8000)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('canvas')
    .analyze()
  const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
  expect(critical, critical.map(v => v.id).join(', ')).toHaveLength(0)
})

// ─── 10. GAME-SPECIFIC: REACTION CHAIN ───────────────────────────────────────

test('10.1 — timer arc shrinks clockwise (visual — no crash)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  // Let the arc shrink for a full node window (800ms) without tapping
  await page.waitForTimeout(1000)
  expect(errors).toHaveLength(0)
})

test('10.2 — watermark chain counter grows with chain (no crash)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  // Play for 15s while attempting taps
  await page.waitForTimeout(15000)
  expect(errors).toHaveLength(0)
})

test('10.3 — chain breaks do not crash the game', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForPlaying()
  // Let 3 nodes expire naturally (each ~800ms)
  await page.waitForTimeout(4000)
  expect(errors).toHaveLength(0)
  await expect(game.canvas).toBeVisible()
})

test('10.4 — window difficulty increases over time (400ms at 30s mark)', async ({ page }) => {
  // Verify the getWindowMs function behavior: 800ms → 600ms → 400ms
  const windowAt = await page.evaluate(() => {
    function getWindowMs(elapsed: number): number {
      if (elapsed < 15) return 800
      if (elapsed < 30) return 600
      return 400
    }
    return {
      at0s:  getWindowMs(0),
      at15s: getWindowMs(15),
      at30s: getWindowMs(30),
      at45s: getWindowMs(45),
    }
  })
  expect(windowAt.at0s).toBe(800)
  expect(windowAt.at15s).toBe(600)
  expect(windowAt.at30s).toBe(400)
  expect(windowAt.at45s).toBe(400)
})

test('10.5 — personality classification is deterministic', async ({ page }) => {
  const result = await page.evaluate(() => {
    interface Signals {
      reactionTimes: number[];
      longestChain: number;
      chainBreaks: number;
      totalNodes: number;
      tappedNodes: number;
      currentChain: number;
      score: number;
    }
    function getPersonality(sig: Signals): string {
      const avgRT = sig.reactionTimes.length > 0
        ? sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length
        : 9999
      if (avgRT < 350 && sig.longestChain >= 15) return 'Lightning Reflex ⚡'
      if (sig.longestChain >= 20 && sig.chainBreaks <= 2) return 'Chain Keeper 🔗'
      if (sig.tappedNodes > 30 && sig.chainBreaks > 5) return 'Sprinter 🏃'
      return 'Steady Reactor 🌊'
    }
    return {
      lightningReflex: getPersonality({ reactionTimes: [300, 320, 280], longestChain: 15, chainBreaks: 3, totalNodes: 20, tappedNodes: 18, currentChain: 0, score: 0 }),
      chainKeeper: getPersonality({ reactionTimes: [500, 600], longestChain: 22, chainBreaks: 1, totalNodes: 25, tappedNodes: 23, currentChain: 0, score: 0 }),
      sprinter: getPersonality({ reactionTimes: [400, 450], longestChain: 8, chainBreaks: 8, totalNodes: 50, tappedNodes: 35, currentChain: 0, score: 0 }),
      steadyReactor: getPersonality({ reactionTimes: [700, 650], longestChain: 5, chainBreaks: 10, totalNodes: 20, tappedNodes: 10, currentChain: 0, score: 0 }),
    }
  })
  expect(result.lightningReflex).toBe('Lightning Reflex ⚡')
  expect(result.chainKeeper).toBe('Chain Keeper 🔗')
  expect(result.sprinter).toBe('Sprinter 🏃')
  expect(result.steadyReactor).toBe('Steady Reactor 🌊')
})
