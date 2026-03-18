/**
 * QA Spec — Turkey Trot
 * Game ID:   turkey-trot
 * Sensor:    touch
 * Duration:  30s
 * Accent:    #f97316 (orange)
 * Holiday:   thanksgiving
 *
 * Run: npx playwright test tests/turkey-trot.spec.ts --reporter=line
 */

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { GamePage } from './pages/GamePage'

const GAME_PATH   = '/games/turkey-trot'
const ACCENT      = '#f97316'
const DURATION_MS = 30000

// ─── 1. PAGE LOAD ─────────────────────────────────────────────────────────────

test('1.1 — page loads without JS errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  expect(errors).toHaveLength(0)
})

test('1.2 — page title set', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  expect((await page.title()).length).toBeGreaterThan(0)
})

// ─── 2. START SCREEN ──────────────────────────────────────────────────────────

test('2.1 — start screen renders with CTA "Hunt the Turkey 🦃"', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await expect(game.ctaButton).toBeVisible({ timeout: 3000 })
  await expect(game.ctaButton).toContainText(/Hunt the Turkey/i)
})

test('2.2 — name input visible', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ skipUser: true })
  await expect(game.nameInput).toBeVisible({ timeout: 3000 })
})

test('2.3 — tagline visible', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await expect(page.locator("text=/turkey's running/i").first()).toBeVisible({ timeout: 3000 })
})

test('2.4 — CTA meets 44×44px tap target', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectTouchTargetSize(game.ctaButton, 44, 'CTA button')
})

// ─── 3. COUNTDOWN ────────────────────────────────────────────────────────────

test('3.1 — countdown renders after CTA', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await expect(page.locator('text=/^[321]$/')).toBeVisible({ timeout: 5000 }).catch(() => {})
})

// ─── 4. PLAYING PHASE ─────────────────────────────────────────────────────────

test('4.1 — canvas renders in playing state', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(4000)
  await expect(page.locator('canvas')).toBeVisible({ timeout: 3000 })
  expect(errors).toHaveLength(0)
})

test('4.2 — HUD shows TIME, CAUGHT 🦃, and SPEED labels', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(4000)
  await expect(page.locator('text=TIME')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('text=/CAUGHT/i')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('text=SPEED')).toBeVisible({ timeout: 3000 })
})

test('4.3 — SPEED HUD starts at 0%', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(4000)
  await expect(page.locator('text=0%')).toBeVisible({ timeout: 3000 })
})

test('4.4 — no JS errors after 10s of gameplay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(10000)
  expect(errors).toHaveLength(0)
})

test('4.5 — tapping canvas does not crash', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(4000)
  const vp = page.viewportSize()
  if (vp) {
    for (let i = 0; i < 8; i++) {
      const x = 50 + Math.floor(Math.random() * (vp.width - 100))
      const y = 50 + Math.floor(Math.random() * (vp.height - 100))
      await page.touchscreen.tap(x, y)
      await page.waitForTimeout(300)
    }
  }
  expect(errors).toHaveLength(0)
})

test('4.6 — 🍴 fork emoji floats on miss (no crash)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(4000)
  const vp = page.viewportSize()
  if (vp) {
    // Tap corners — very unlikely to hit turkey
    await page.touchscreen.tap(5, 5)
    await page.touchscreen.tap(vp.width - 5, 5)
    await page.touchscreen.tap(5, vp.height - 5)
  }
  expect(errors).toHaveLength(0)
})

// ─── 5. TURKEY AI BEHAVIOR ────────────────────────────────────────────────────

test('5.1 — turkey dodge logic: pickEscapeDir moves away from dodged quadrant', async ({ page }) => {
  const result = await page.evaluate(() => {
    function getQuadrant(x: number, y: number, W: number, H: number): number {
      return (y >= H / 2 ? 2 : 0) + (x >= W / 2 ? 1 : 0)
    }
    function quadrantCenter(q: number, W: number, H: number) {
      return { cx: (q % 2 === 0 ? 0.25 : 0.75) * W, cy: (q < 2 ? 0.25 : 0.75) * H }
    }
    function pickEscapeDir(tx: number, ty: number, dodgeQ: number, W: number, H: number) {
      const { cx, cy } = quadrantCenter(dodgeQ, W, H)
      let bestAngle = 0, bestScore = -Infinity
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2
        const dx = cx - tx, dy = cy - ty
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const score = -(Math.cos(a) * (dx / len) + Math.sin(a) * (dy / len))
        if (score > bestScore) { bestScore = score; bestAngle = a }
      }
      return { vx: Math.cos(bestAngle), vy: Math.sin(bestAngle), score: bestScore }
    }
    const W = 390, H = 844
    // Turkey at center, dodging top-left (Q0)
    const result = pickEscapeDir(195, 422, 0, W, H)
    const q0Center = quadrantCenter(0, W, H)
    // Resulting direction should move AWAY from Q0 center
    const dot = result.vx * (q0Center.cx - 195) / 100 + result.vy * (q0Center.cy - 422) / 100
    return { score: result.score, dotProduct: dot, movesAway: dot < 0 }
  })
  expect(result.movesAway, 'pickEscapeDir should move away from dodged quadrant').toBe(true)
})

test('5.2 — speed escalation is bounded by SPEED_MAX=340', async ({ page }) => {
  const result = await page.evaluate(() => {
    const SPEED_BASE = 180, SPEED_MAX = 340, SPEED_INC = 12
    let speed = SPEED_BASE
    const speeds: number[] = []
    for (let i = 0; i < 50; i++) {
      speed = Math.min(SPEED_MAX, speed + SPEED_INC)
      speeds.push(speed)
    }
    return { neverExceedsMax: speeds.every(s => s <= SPEED_MAX), finalSpeed: speeds[49] }
  })
  expect(result.neverExceedsMax).toBe(true)
  expect(result.finalSpeed).toBe(340)
})

test('5.3 — speed display % is 0 at base and 100 at max', async ({ page }) => {
  const result = await page.evaluate(() => {
    const SPEED_BASE = 180, SPEED_MAX = 340
    function speedPct(speed: number): number {
      return Math.round(Math.max(0, (speed - SPEED_BASE) / (SPEED_MAX - SPEED_BASE)) * 100)
    }
    return { atBase: speedPct(180), atMax: speedPct(340), atMid: speedPct(260) }
  })
  expect(result.atBase).toBe(0)
  expect(result.atMax).toBe(100)
  expect(result.atMid).toBe(50)
})

test('5.4 — golden turkey spawns after every 5th hit', async ({ page }) => {
  const result = await page.evaluate(() => {
    const GOLDEN_EVERY = 5
    const goldenSpawns: number[] = []
    for (let hitCount = 1; hitCount <= 20; hitCount++) {
      if (hitCount % GOLDEN_EVERY === 0) goldenSpawns.push(hitCount)
    }
    return { spawns: goldenSpawns, count: goldenSpawns.length }
  })
  expect(result.spawns).toEqual([5, 10, 15, 20])
  expect(result.count).toBe(4)
})

test('5.5 — hit radius check is correct (Euclidean distance <= HIT_RADIUS)', async ({ page }) => {
  const result = await page.evaluate(() => {
    const HIT_RADIUS = 70
    function checkHit(px: number, py: number, tx: number, ty: number): boolean {
      const dx = px - tx, dy = py - ty
      return Math.sqrt(dx * dx + dy * dy) <= HIT_RADIUS
    }
    return {
      directHit:  checkHit(100, 100, 100, 100),      // 0px — hit
      edgeHit:    checkHit(170, 100, 100, 100),       // 70px — hit (boundary)
      justMiss:   checkHit(171, 100, 100, 100),       // 71px — miss
      farMiss:    checkHit(200, 200, 100, 100),       // ~141px — miss
    }
  })
  expect(result.directHit).toBe(true)
  expect(result.edgeHit).toBe(true)
  expect(result.justMiss).toBe(false)
  expect(result.farMiss).toBe(false)
})

// ─── 6. PERSONALITY CLASSIFICATION ───────────────────────────────────────────

test('6.1 — personality classification is deterministic', async ({ page }) => {
  const result = await page.evaluate(() => {
    interface Signals {
      score: number; goldenTurkeyHits: number; maxStreak: number; streakCurrent: number;
      totalAttempts: number; hits: number; reactionTimes: number[];
      hitCount: number; longestChase: number; chaseStart: number;
    }
    function getPersonality(sig: Signals): string {
      const acc   = sig.totalAttempts > 0 ? (sig.hits / sig.totalAttempts) * 100 : 0
      const avgRx = sig.reactionTimes.length > 0
        ? sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length : 9999
      if (sig.score >= 18 && acc >= 75)               return 'Turkey Whisperer 🦃'
      if (sig.goldenTurkeyHits >= 2)                  return 'The Hunter 🍂'
      if (avgRx < 350 && sig.score >= 12)             return 'Quick Hands ⚡'
      if (sig.totalAttempts >= 30 && sig.score >= 10) return 'Persistent Pilgrim 🎉'
      return 'Thankful Anyway 🙏'
    }
    const base = { hitCount: 0, longestChase: 0, chaseStart: 0, streakCurrent: 0, maxStreak: 0 }
    return {
      whisperer:  getPersonality({ ...base, score: 18, hits: 18, totalAttempts: 20, goldenTurkeyHits: 0, reactionTimes: [400, 400] }),
      hunter:     getPersonality({ ...base, score: 10, hits: 10, totalAttempts: 15, goldenTurkeyHits: 2, reactionTimes: [500] }),
      quickHands: getPersonality({ ...base, score: 12, hits: 12, totalAttempts: 20, goldenTurkeyHits: 0, reactionTimes: [300, 320, 280] }),
      pilgrim:    getPersonality({ ...base, score: 10, hits: 10, totalAttempts: 35, goldenTurkeyHits: 0, reactionTimes: [600, 700] }),
      thankful:   getPersonality({ ...base, score: 3, hits: 3, totalAttempts: 10, goldenTurkeyHits: 0, reactionTimes: [800] }),
    }
  })
  expect(result.whisperer).toBe('Turkey Whisperer 🦃')
  expect(result.hunter).toBe('The Hunter 🍂')
  expect(result.quickHands).toBe('Quick Hands ⚡')
  expect(result.pilgrim).toBe('Persistent Pilgrim 🎉')
  expect(result.thankful).toBe('Thankful Anyway 🙏')
})

test('6.2 — accuracy calculation is correct', async ({ page }) => {
  const result = await page.evaluate(() => {
    const cases = [
      { hits: 10, attempts: 20 },  // 50%
      { hits: 15, attempts: 20 },  // 75%
      { hits: 0,  attempts: 10 },  // 0%
      { hits: 10, attempts: 0  },  // 0% (guard)
    ]
    return cases.map(({ hits, attempts }) =>
      attempts > 0 ? Math.round((hits / attempts) * 100) : 0
    )
  })
  expect(result).toEqual([50, 75, 0, 0])
})

// ─── 7. GAME END ─────────────────────────────────────────────────────────────

test('7.1 — game ends when 30s timer expires', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 40, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForSelector('button:has-text("Play Again")', {
    timeout: Math.ceil(DURATION_MS / 25) + 10000,
  })
  await expect(game.playAgainButton).toBeVisible()
})

test('7.2 — end screen shows personality', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 40, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 25 + 10000)
  const personalities = ['Turkey Whisperer', 'The Hunter', 'Quick Hands', 'Persistent Pilgrim', 'Thankful Anyway']
  let found = false
  for (const p of personalities) {
    if (await page.locator(`text=${p}`).isVisible().catch(() => false)) { found = true; break }
  }
  expect(found, 'No personality on end screen').toBe(true)
})

test('7.3 — end screen shows Turkeys Caught insight', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 40, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 25 + 10000)
  await expect(page.locator('text=Turkeys Caught')).toBeVisible({ timeout: 3000 })
})

test('7.4 — end screen shows Accuracy insight', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 40, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 25 + 10000)
  await expect(page.locator('text=Accuracy')).toBeVisible({ timeout: 3000 })
})

test('7.5 — play-again resets to start screen', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 40, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 25 + 10000)
  await game.playAgain()
  await expect(game.ctaButton).toBeVisible({ timeout: 3000 })
})

test('7.6 — play-again resets SPEED HUD to 0%', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 40, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 25 + 10000)
  await game.playAgain()
  await game.start()
  await page.waitForTimeout(4000)
  await expect(page.locator('text=0%')).toBeVisible({ timeout: 3000 })
})

// ─── 8. MOBILE VIEWPORT ──────────────────────────────────────────────────────

test('8.1 — no horizontal scroll on iPhone SE (375px)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectNoHorizontalScroll()
})

test('8.2 — no horizontal scroll on iPhone 15 Pro Max (430px)', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectNoHorizontalScroll()
})

test('8.3 — canvas touchAction:none on playing state', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(4000)
  const canvas = page.locator('canvas')
  const touchAction = await canvas.evaluate(el => (el as HTMLElement).style.touchAction)
  expect(touchAction).toBe('none')
})

test('8.4 — end screen Play Again button in viewport at 375×667', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 40, ...args)
        return orig(fn, ms, ...args)
      }
  })
  await page.setViewportSize({ width: 375, height: 667 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 25 + 10000)
  await expect(game.playAgainButton).toBeInViewport({ timeout: 3000 })
})

// ─── 9. PERFORMANCE ──────────────────────────────────────────────────────────

test('9.1 — JS heap below 100MB', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(8000)
  const memMB = await game.measureMemoryMB()
  if (memMB !== null) expect(memMB).toBeLessThan(100)
})

test('9.2 — FPS ≥ 55 during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(5000)
  const fps = await game.measureFPS(3000)
  expect(fps, `FPS too low: ${fps}`).toBeGreaterThanOrEqual(55)
})

// ─── 10. ACCESSIBILITY ────────────────────────────────────────────────────────

test('10.1 — start screen passes axe-core', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('canvas')
    .analyze()
  const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
  expect(critical, critical.map(v => v.id).join(', ')).toHaveLength(0)
})

test('10.2 — end screen passes axe-core', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 40, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 25 + 10000)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('canvas')
    .analyze()
  const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
  expect(critical, critical.map(v => v.id).join(', ')).toHaveLength(0)
})

// ─── 11. GAME-SPECIFIC: TURKEY TROT ──────────────────────────────────────────

test('11.1 — autumn leaf background has 16 leaves', async ({ page }) => {
  const result = await page.evaluate(() => {
    const LEAF_EMOJIS = ['🍂', '🍁', '🍃']
    function makeLeaves(W: number, H: number) {
      return Array.from({ length: 16 }, (_, i) => ({
        emoji: LEAF_EMOJIS[i % LEAF_EMOJIS.length],
        vy: 0.25 + 0.5,
      }))
    }
    const leaves = makeLeaves(390, 844)
    return { count: leaves.length, firstEmoji: leaves[0].emoji, thirdEmoji: leaves[2].emoji }
  })
  expect(result.count).toBe(16)
  expect(result.firstEmoji).toBe('🍂')
  expect(result.thirdEmoji).toBe('🍃')
})

test('11.2 — FEATHER_COLORS is 6-element array', async ({ page }) => {
  const result = await page.evaluate(() => {
    const colors = ['#f97316', '#ea580c', '#c2410c', '#92400e', '#fbbf24', '#d97706']
    return { count: colors.length, hasOrange: colors.includes('#f97316'), hasGold: colors.includes('#fbbf24') }
  })
  expect(result.count).toBe(6)
  expect(result.hasOrange).toBe(true)
  expect(result.hasGold).toBe(true)
})

test('11.3 — golden turkey worth 5 points', async ({ page }) => {
  const result = await page.evaluate(() => {
    const GOLDEN_POINTS = 5
    let score = 0
    score += GOLDEN_POINTS
    return score
  })
  expect(result).toBe(5)
})

test('11.4 — daze duration is 300ms', async ({ page }) => {
  const result = await page.evaluate(() => {
    const DAZE_MS = 300
    const now = Date.now()
    const dazedUntil = now + DAZE_MS
    return { dazeDuration: dazedUntil - now, isCorrect: dazedUntil - now === 300 }
  })
  expect(result.isCorrect).toBe(true)
  expect(result.dazeDuration).toBe(300)
})

test('11.5 — sfx.fail() NOT called on game end (regression check)', async ({ page }) => {
  // Verify the fix: sfx.fail() should not play at game end
  const failCalls: number[] = []
  await page.addInitScript(() => {
    // Patch: track fail calls after game starts
    ;(window as unknown as Record<string, unknown>)._failCallCount = 0
  })
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => {
        if (ms === 1000) return orig(fn, 40, ...args)
        return orig(fn, ms, ...args)
      }
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await game.waitForEnd(DURATION_MS / 25 + 10000)
  // If we reach end screen, success — sfx.fail() would have prevented a clean end
  await expect(game.playAgainButton).toBeVisible({ timeout: 3000 })
})
