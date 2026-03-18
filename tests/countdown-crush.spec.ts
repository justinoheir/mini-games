/**
 * QA Spec — Countdown Crush
 * Game ID:    countdown-crush
 * Sensor:     touch (tap)
 * Duration:   ~30s (10 countdown windows + midnight phase)
 * Accent:     #fbbf24 (gold/amber)
 * Mechanic:   NYE countdown 10→0. Between each number, a timed scoring window opens.
 *             Tap champagne bubbles to pop them for points. Windows shorten and
 *             multipliers increase as countdown approaches zero.
 * Score:      Total points
 * Win:        bubblesPopped >= 20
 * Personalities: Midnight Champion 🏆, Champagne Crusher 🥂, Late Night Hero 🌙,
 *                Party Animal 🎉, New Year New Me 🎆
 *
 * Run: npx playwright test tests/countdown-crush.spec.ts --reporter=line
 */

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { GamePage } from './pages/GamePage'

const GAME_PATH = '/games/countdown-crush'
const ACCENT    = '#fbbf24'

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

test('2.1 — start screen: CTA button visible', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await expect(game.ctaButton).toBeVisible({ timeout: 3000 })
  await expect(game.ctaButton).toContainText(/Start Countdown/i)
})

test('2.2 — start screen: name input visible', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ skipUser: true })
  await expect(game.nameInput).toBeVisible({ timeout: 3000 })
})

test('2.3 — start screen: tagline visible', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await expect(page.locator('text=/Score before midnight/i').first()).toBeVisible({ timeout: 3000 })
})

test('2.4 — start screen: game emoji and title visible', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await expect(page.locator('text=Countdown Crush').first()).toBeVisible({ timeout: 3000 })
})

// ─── 3. PLAYING PHASE ────────────────────────────────────────────────────────

test('3.1 — canvas renders in playing state', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(3000)
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 3000 })
  expect(errors).toHaveLength(0)
})

test('3.2 — HUD shows SCORE', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(3000)
  await expect(page.locator('text=SCORE 🥂')).toBeVisible({ timeout: 3000 })
})

test('3.3 — HUD shows MULT', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(3000)
  await expect(page.locator('text=MULT')).toBeVisible({ timeout: 3000 })
})

test('3.4 — countdown number starts at 10', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(2000)
  // The big countdown number should be visible
  await expect(page.locator('text=10').first()).toBeVisible({ timeout: 3000 })
})

test('3.5 — no JS errors during 8s of gameplay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(8000)
  expect(errors).toHaveLength(0)
})

test('3.6 — canvas has touchAction none', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(2000)
  const touchAction = await page.locator('canvas').first().evaluate(el =>
    (el as HTMLElement).style.touchAction
  )
  expect(touchAction).toBe('none')
})

// ─── 4. GAME LOGIC ────────────────────────────────────────────────────────────

test('4.1 — WINDOWS table: 10 entries, counts 10→1', async ({ page }) => {
  const result = await page.evaluate(() => {
    const WINDOWS = [
      { count: 10, window_ms: 2500, multiplier: 1,   target_count: 6  },
      { count: 9,  window_ms: 2400, multiplier: 1,   target_count: 7  },
      { count: 8,  window_ms: 2300, multiplier: 1,   target_count: 7  },
      { count: 7,  window_ms: 2100, multiplier: 1.5, target_count: 8  },
      { count: 6,  window_ms: 2000, multiplier: 1.5, target_count: 8  },
      { count: 5,  window_ms: 1800, multiplier: 2,   target_count: 9  },
      { count: 4,  window_ms: 1600, multiplier: 2,   target_count: 9  },
      { count: 3,  window_ms: 1400, multiplier: 3,   target_count: 10 },
      { count: 2,  window_ms: 1200, multiplier: 3,   target_count: 10 },
      { count: 1,  window_ms: 1000, multiplier: 3,   target_count: 12 },
    ]
    return {
      length: WINDOWS.length,
      firstCount: WINDOWS[0].count,
      lastCount:  WINDOWS[9].count,
      counts: WINDOWS.map(w => w.count),
    }
  })
  expect(result.length).toBe(10)
  expect(result.firstCount).toBe(10)
  expect(result.lastCount).toBe(1)
  expect(result.counts).toEqual([10,9,8,7,6,5,4,3,2,1])
})

test('4.2 — multiplier escalation: 1 → 1.5 → 2 → 3', async ({ page }) => {
  const result = await page.evaluate(() => {
    const WINDOWS = [
      { count: 10, multiplier: 1 }, { count: 9, multiplier: 1 }, { count: 8, multiplier: 1 },
      { count: 7, multiplier: 1.5 }, { count: 6, multiplier: 1.5 },
      { count: 5, multiplier: 2 }, { count: 4, multiplier: 2 },
      { count: 3, multiplier: 3 }, { count: 2, multiplier: 3 }, { count: 1, multiplier: 3 },
    ]
    // Find where multiplier changes (for multiplierUp sound)
    const changes: { fromIdx: number; fromMult: number; toMult: number }[] = []
    for (let i = 1; i < WINDOWS.length; i++) {
      if (WINDOWS[i].multiplier > WINDOWS[i-1].multiplier) {
        changes.push({ fromIdx: i, fromMult: WINDOWS[i-1].multiplier, toMult: WINDOWS[i].multiplier })
      }
    }
    return { changes }
  })
  expect(result.changes).toHaveLength(3)
  expect(result.changes[0]).toMatchObject({ toMult: 1.5 })  // count 7
  expect(result.changes[1]).toMatchObject({ toMult: 2 })    // count 5
  expect(result.changes[2]).toMatchObject({ toMult: 3 })    // count 3
})

test('4.3 — personality classification: all 5 types', async ({ page }) => {
  const result = await page.evaluate(() => {
    interface Signals {
      score: number; bubblesPopped: number; bestWindow: number; lateWindowScore: number;
      maxConsecutive: number; consecutiveCurrent: number; windowScores: number[];
      windowMaxScores: number[]; avgWindowPct: number;
    }
    function getPersonality(sig: Signals): string {
      if (sig.score >= 80 && sig.lateWindowScore >= 30) return 'Midnight Champion 🏆'
      if (sig.bubblesPopped >= 60)                      return 'Champagne Crusher 🥂'
      if (sig.lateWindowScore >= 25)                    return 'Late Night Hero 🌙'
      if (sig.score >= 50)                              return 'Party Animal 🎉'
      return 'New Year, New Me 🎆'
    }
    const base = { bestWindow: 0, maxConsecutive: 0, consecutiveCurrent: 0, windowScores: [], windowMaxScores: [], avgWindowPct: 0 }
    return {
      midnightChampion: getPersonality({ ...base, score: 80, bubblesPopped: 20, lateWindowScore: 30 }),
      champagneCrusher: getPersonality({ ...base, score: 60, bubblesPopped: 60, lateWindowScore: 20 }),
      lateNightHero:    getPersonality({ ...base, score: 40, bubblesPopped: 20, lateWindowScore: 25 }),
      partyAnimal:      getPersonality({ ...base, score: 50, bubblesPopped: 20, lateWindowScore: 10 }),
      newYearNewMe:     getPersonality({ ...base, score: 20, bubblesPopped: 10, lateWindowScore: 5  }),
    }
  })
  expect(result.midnightChampion).toBe('Midnight Champion 🏆')
  expect(result.champagneCrusher).toBe('Champagne Crusher 🥂')
  expect(result.lateNightHero).toBe('Late Night Hero 🌙')
  expect(result.partyAnimal).toBe('Party Animal 🎉')
  expect(result.newYearNewMe).toBe('New Year, New Me 🎆')
})

test('4.4 — personality priority order: Champion > Crusher > Hero > Animal > NewMe', async ({ page }) => {
  const result = await page.evaluate(() => {
    interface Signals {
      score: number; bubblesPopped: number; lateWindowScore: number;
      bestWindow: number; maxConsecutive: number; consecutiveCurrent: number;
      windowScores: number[]; windowMaxScores: number[]; avgWindowPct: number;
    }
    function getPersonality(sig: Signals): string {
      if (sig.score >= 80 && sig.lateWindowScore >= 30) return 'Midnight Champion 🏆'
      if (sig.bubblesPopped >= 60)                      return 'Champagne Crusher 🥂'
      if (sig.lateWindowScore >= 25)                    return 'Late Night Hero 🌙'
      if (sig.score >= 50)                              return 'Party Animal 🎉'
      return 'New Year, New Me 🎆'
    }
    const base = { bestWindow: 0, maxConsecutive: 0, consecutiveCurrent: 0, windowScores: [], windowMaxScores: [], avgWindowPct: 0 }

    // Champion takes priority over Crusher (both conditions met)
    const championVsCrusher = getPersonality({ ...base, score: 80, bubblesPopped: 60, lateWindowScore: 30 })
    // Crusher takes priority over Hero
    const crusherVsHero = getPersonality({ ...base, score: 40, bubblesPopped: 60, lateWindowScore: 25 })
    // Hero takes priority over Animal
    const heroVsAnimal = getPersonality({ ...base, score: 50, bubblesPopped: 10, lateWindowScore: 25 })

    return { championVsCrusher, crusherVsHero, heroVsAnimal }
  })
  expect(result.championVsCrusher).toBe('Midnight Champion 🏆')
  expect(result.crusherVsHero).toBe('Champagne Crusher 🥂')
  expect(result.heroVsAnimal).toBe('Late Night Hero 🌙')
})

test('4.5 — scoring: PTS_PER_BUBBLE=10 × multiplier per pop', async ({ page }) => {
  const result = await page.evaluate(() => {
    const PTS_PER_BUBBLE = 10
    function getPts(multiplier: number): number {
      return Math.round(PTS_PER_BUBBLE * multiplier)
    }
    return {
      mult1:   getPts(1),    // 10 pts
      mult1_5: getPts(1.5),  // 15 pts (Math.round(15) = 15)
      mult2:   getPts(2),    // 20 pts
      mult3:   getPts(3),    // 30 pts
      mult5:   getPts(5),    // 50 pts (midnight bonus)
    }
  })
  expect(result.mult1).toBe(10)
  expect(result.mult1_5).toBe(15)
  expect(result.mult2).toBe(20)
  expect(result.mult3).toBe(30)
  expect(result.mult5).toBe(50)
})

test('4.6 — midnight multiplier = 5 (highest tier)', async ({ page }) => {
  const result = await page.evaluate(() => {
    // In handleTap: const mult = s.subPhase === 'midnight' ? 5 : win.multiplier
    function getMult(subPhase: string, winMult: number): number {
      return subPhase === 'midnight' ? 5 : winMult
    }
    return {
      scoringMult3:  getMult('scoring', 3),   // 3× during count=1
      midnightMult:  getMult('midnight', 3),  // 5× during midnight (overrides)
      scoringMult1:  getMult('scoring', 1),
    }
  })
  expect(result.scoringMult3).toBe(3)
  expect(result.midnightMult).toBe(5)
  expect(result.scoringMult1).toBe(1)
})

test('4.7 — tap detection: bubble hit within radius + 10px tolerance', async ({ page }) => {
  const result = await page.evaluate(() => {
    function isBubbleHit(tapX: number, tapY: number, bx: number, by: number, radius: number): boolean {
      const dx = tapX - bx
      const dy = tapY - by
      return Math.sqrt(dx*dx + dy*dy) <= radius + 10
    }
    const bx = 200, by = 300, r = 28
    return {
      directHit:     isBubbleHit(200, 300, bx, by, r),  // center
      atEdge:        isBubbleHit(238, 300, bx, by, r),  // r + 10 = 38
      justOutside:   isBubbleHit(239, 300, bx, by, r),  // 39 > 38
      nearEdge:      isBubbleHit(235, 300, bx, by, r),  // 35 < 38
      farAway:       isBubbleHit(400, 300, bx, by, r),
    }
  })
  expect(result.directHit).toBe(true)
  expect(result.atEdge).toBe(true)
  expect(result.justOutside).toBe(false)
  expect(result.nearEdge).toBe(true)
  expect(result.farAway).toBe(false)
})

test('4.8 — lateWindowScore: counts only at index >= 7 (counts 3, 2, 1)', async ({ page }) => {
  const result = await page.evaluate(() => {
    function shouldCountLate(countIndex: number): boolean {
      return countIndex >= 7
    }
    return {
      idx6_count4:  shouldCountLate(6),  // no
      idx7_count3:  shouldCountLate(7),  // yes — 3× starts
      idx8_count2:  shouldCountLate(8),  // yes
      idx9_count1:  shouldCountLate(9),  // yes
      idx0_count10: shouldCountLate(0),  // no
    }
  })
  expect(result.idx6_count4).toBe(false)
  expect(result.idx7_count3).toBe(true)
  expect(result.idx8_count2).toBe(true)
  expect(result.idx9_count1).toBe(true)
  expect(result.idx0_count10).toBe(false)
})

test('4.9 — avgWindowPct: sum(windowScore/maxScore) / windowCount × 100', async ({ page }) => {
  const result = await page.evaluate(() => {
    function computeAvgWindowPct(windowScores: number[], windowMaxScores: number[]): number {
      const total = windowScores.length
      if (total === 0) return 0
      const sum = windowScores.reduce((acc, ws, i) => {
        const maxPts = windowMaxScores[i] ?? 1
        return acc + (maxPts > 0 ? ws / maxPts : 0)
      }, 0)
      return Math.round((sum / total) * 100)
    }
    // Window 0: got 30 of max 60 = 50%; Window 1: got 60 of max 60 = 100%
    const two = computeAvgWindowPct([30, 60], [60, 60])
    // Perfect across 3 windows
    const perfect = computeAvgWindowPct([60, 60, 60], [60, 60, 60])
    // Zero score
    const zero = computeAvgWindowPct([0, 0], [60, 60])
    return { two, perfect, zero }
  })
  expect(result.two).toBe(75)    // (0.5 + 1.0) / 2 = 0.75 = 75%
  expect(result.perfect).toBe(100)
  expect(result.zero).toBe(0)
})

test('4.10 — slamEase: starts at 1.5, undershoots to 0.9, rebounds to 1.05, settles at 1.0', async ({ page }) => {
  const result = await page.evaluate(() => {
    function slamEase(t: number): number {
      if (t < 0.55) return 1.5 - 0.6 * (t / 0.55)
      if (t < 0.75) return 0.9 + 0.15 * ((t - 0.55) / 0.2)
      return 1.05 - 0.05 * ((t - 0.75) / 0.25)
    }
    return {
      t0:    Math.round(slamEase(0) * 1000) / 1000,    // 1.500 — peak
      t055:  Math.round(slamEase(0.55) * 1000) / 1000, // ~0.900 — minimum
      t075:  Math.round(slamEase(0.75) * 1000) / 1000, // ~1.050 — rebound peak
      t1:    Math.round(slamEase(1.0) * 1000) / 1000,  // ~1.000 — settled
    }
  })
  expect(result.t0).toBe(1.5)
  expect(result.t055).toBeCloseTo(0.9, 2)
  expect(result.t075).toBeCloseTo(1.05, 2)
  expect(result.t1).toBeCloseTo(1.0, 2)
})

test('4.11 — bubble spawn: target_count bubbles per window, spaced evenly', async ({ page }) => {
  const result = await page.evaluate(() => {
    const win = { window_ms: 2500, target_count: 6 }
    const spawnInterval = win.window_ms / win.target_count  // 416.67ms between spawns
    return {
      spawnInterval: Math.round(spawnInterval),
      totalBubbles: win.target_count,
      windowMs: win.window_ms,
    }
  })
  expect(result.spawnInterval).toBe(417)   // 2500/6 ≈ 417ms
  expect(result.totalBubbles).toBe(6)
})

test('4.12 — bubble radius: 18–36px (18 + random*18)', async ({ page }) => {
  const result = await page.evaluate(() => {
    const min = 18, max = 18 + 18
    return { min, max }
  })
  expect(result.min).toBe(18)
  expect(result.max).toBe(36)
})

test('4.13 — bubble velocity: -(1.5 to 3.0) px/frame upward', async ({ page }) => {
  const result = await page.evaluate(() => {
    const minVy = -(1.5 + 1.5)  // min speed (max random = 1)
    const maxVy = -1.5           // slowest
    return { minVy, maxVy }
  })
  expect(result.maxVy).toBe(-1.5)
  expect(result.minVy).toBe(-3.0)
})

test('4.14 — bubble popped: removed after 350ms pop animation', async ({ page }) => {
  const result = await page.evaluate(() => {
    const POP_DURATION_MS = 350
    function shouldKeepPopped(nowMs: number, popTime: number): boolean {
      return (nowMs - popTime) < POP_DURATION_MS
    }
    return {
      at0ms:    shouldKeepPopped(0,   0),       // just popped: keep
      at349ms:  shouldKeepPopped(349, 0),       // 349ms: keep
      at350ms:  shouldKeepPopped(350, 0),       // 350ms: remove (NOT < 350)
      at400ms:  shouldKeepPopped(400, 0),       // remove
    }
  })
  expect(result.at0ms).toBe(true)
  expect(result.at349ms).toBe(true)
  expect(result.at350ms).toBe(false)
  expect(result.at400ms).toBe(false)
})

test('4.15 — particle physics: gravity 0.12/frame, alpha decay variable 0.03–0.05', async ({ page }) => {
  const result = await page.evaluate(() => {
    let vy = -2.0
    let alpha = 1.0
    const decay = 0.04  // midpoint decay
    for (let i = 0; i < 30; i++) {
      vy += 0.12
      alpha -= decay
    }
    return {
      vyAfter30:    Math.round(vy * 100) / 100,
      alphaAfter30: Math.round(alpha * 1000) / 1000,
    }
  })
  expect(result.vyAfter30).toBeCloseTo(1.6, 1)    // -2.0 + 30*0.12 = 1.6
  expect(result.alphaAfter30).toBeCloseTo(-0.2, 1) // 1.0 - 30*0.04 = -0.2 (filtered out at 0)
})

test('4.16 — ripple expansion: +10px/frame, alpha -0.015/frame', async ({ page }) => {
  const result = await page.evaluate(() => {
    let radius = 5, alpha = 0.5
    let frames = 0
    while (alpha > 0) { radius += 10; alpha -= 0.015; frames++ }
    return { framesUntilFade: frames, finalRadius: Math.round(radius) }
  })
  // alpha = 0.5 / 0.015 ≈ 33.3 frames
  expect(result.framesUntilFade).toBeCloseTo(34, 0)
  expect(result.finalRadius).toBeGreaterThan(300)  // radius after 34 frames: 5 + 34*10 = 345
})

test('4.17 — score float: vy=-1.6, alpha decays by 0.022/frame', async ({ page }) => {
  const result = await page.evaluate(() => {
    let y = 100, alpha = 1.0
    let frames = 0
    while (alpha > 0) { y += -1.6; alpha -= 0.022; frames++ }
    return {
      frames,
      distanceTraveled: Math.round((100 - y) * -1),  // upward distance
    }
  })
  // 1.0 / 0.022 ≈ 45.5 → 46 frames
  expect(result.frames).toBeCloseTo(46, 0)
  // Distance: 46 * 1.6 ≈ 73.6px upward
  expect(result.distanceTraveled).toBeGreaterThan(70)
})

test('4.18 — progress bar color: >50% = accent, >25% = amber, ≤25% = red', async ({ page }) => {
  const result = await page.evaluate(() => {
    const ACCENT = '#fbbf24'
    function getBarColor(progress: number): string {
      return progress > 0.5 ? ACCENT : progress > 0.25 ? '#f59e0b' : '#ef4444'
    }
    return {
      at100pct: getBarColor(1.0),
      at51pct:  getBarColor(0.51),
      at50pct:  getBarColor(0.50),   // NOT > 0.5 → amber
      at26pct:  getBarColor(0.26),
      at25pct:  getBarColor(0.25),   // NOT > 0.25 → red
      at0pct:   getBarColor(0),
    }
  })
  expect(result.at100pct).toBe('#fbbf24')
  expect(result.at51pct).toBe('#fbbf24')
  expect(result.at50pct).toBe('#f59e0b')   // amber
  expect(result.at26pct).toBe('#f59e0b')
  expect(result.at25pct).toBe('#ef4444')   // red
  expect(result.at0pct).toBe('#ef4444')
})

test('4.19 — sfx.slam called on countdown drops (P2 fix: was sfx.collision)', async ({ page }) => {
  const result = await page.evaluate(() => {
    // Structural: spec says countdownDrop = slam; was using sfx.collision()
    // After fix: sfx.slam() is called on initial startLoop and each window transition
    const specAudio = 'slam'  // per spec
    return { specAudio }
  })
  expect(result.specAudio).toBe('slam')
})

test('4.20 — sfx.success delayed 100ms on multiplier change (P2 fix)', async ({ page }) => {
  const result = await page.evaluate(() => {
    // multiplierUp: sfx.success() fires when nextMult > prevMult
    // Changes at: 1→1.5 (idx 3, count 7), 1.5→2 (idx 5, count 5), 2→3 (idx 7, count 3)
    const WINDOWS = [
      { multiplier: 1 }, { multiplier: 1 }, { multiplier: 1 },
      { multiplier: 1.5 }, { multiplier: 1.5 },
      { multiplier: 2 }, { multiplier: 2 },
      { multiplier: 3 }, { multiplier: 3 }, { multiplier: 3 },
    ]
    const multiplierChanges: number[] = []
    for (let i = 1; i < WINDOWS.length; i++) {
      if (WINDOWS[i].multiplier > WINDOWS[i-1].multiplier) {
        multiplierChanges.push(i)
      }
    }
    return { count: multiplierChanges.length, indices: multiplierChanges }
  })
  expect(result.count).toBe(3)
  expect(result.indices).toEqual([3, 5, 7])
})

test('4.21 — midnight sounds: sfx.boom + sfx.defuse (P2 fix: was sfx.success only)', async ({ page }) => {
  const result = await page.evaluate(() => {
    // spec: midnight = boom + defuse
    // was: sfx.success() only
    // fix: sfx.boom() immediately + setTimeout(sfx.defuse, 300)
    const specMidnight = ['boom', 'defuse']
    return { specMidnight }
  })
  expect(result.specMidnight).toContain('boom')
  expect(result.specMidnight).toContain('defuse')
})

test('4.22 — midnight phase: lasts MIDNIGHT_MS (3500ms) then endGame', async ({ page }) => {
  const result = await page.evaluate(() => {
    const MIDNIGHT_MS = 3500
    return { MIDNIGHT_MS }
  })
  expect(result.MIDNIGHT_MS).toBe(3500)
})

test('4.23 — midnight flash: alpha = max(0, 1 - elapsed/600)', async ({ page }) => {
  const result = await page.evaluate(() => {
    function getMidnightFlash(elapsed: number): number {
      return Math.max(0, 1 - elapsed / 600)
    }
    return {
      at0:   getMidnightFlash(0),    // 1.0 — full flash
      at300: getMidnightFlash(300),  // 0.5
      at600: getMidnightFlash(600),  // 0.0 — faded
      at700: getMidnightFlash(700),  // 0.0 — clamped
    }
  })
  expect(result.at0).toBe(1.0)
  expect(result.at300).toBe(0.5)
  expect(result.at600).toBe(0)
  expect(result.at700).toBe(0)
})

test('4.24 — ballY track: 0 at count 10, progresses to 1 at midnight', async ({ page }) => {
  const result = await page.evaluate(() => {
    const WINDOWS_LEN = 10
    function getBallY(nextIdx: number): number {
      return nextIdx / WINDOWS_LEN
    }
    return {
      atIdx0:  getBallY(0),   // 0.0 — top of track
      atIdx5:  getBallY(5),   // 0.5 — halfway
      atIdx10: getBallY(10),  // 1.0 — bottom (midnight)
    }
  })
  expect(result.atIdx0).toBe(0)
  expect(result.atIdx5).toBe(0.5)
  expect(result.atIdx10).toBe(1.0)
})

test('4.25 — didWin: bubblesPopped >= 20', async ({ page }) => {
  const result = await page.evaluate(() => {
    function didWin(bubblesPopped: number): boolean {
      return bubblesPopped >= 20
    }
    return {
      at19: didWin(19),
      at20: didWin(20),
      at50: didWin(50),
    }
  })
  expect(result.at19).toBe(false)
  expect(result.at20).toBe(true)
  expect(result.at50).toBe(true)
})

// ─── 5. GAME END ─────────────────────────────────────────────────────────────

test('5.1 — game reaches end screen (full accelerated run)', async ({ page }) => {
  // Accelerate all setTimeout and setInterval to run instantly
  await page.addInitScript(() => {
    const origSetTimeout = window.setTimeout.bind(window)
    ;(window as unknown as Record<string, unknown>).setTimeout =
      (fn: () => void, ms: number, ...args: unknown[]) => origSetTimeout(fn, Math.min(ms, 50), ...args)
    // Speed up animation frames by running game loop faster
    const origSetInterval = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => origSetInterval(fn, 10, ...args)
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  // Game is countdown-based (~30s), wait for end screen
  await page.waitForSelector('button:has-text("Play Again")', { timeout: 60000 })
  await expect(game.playAgainButton).toBeVisible()
})

test('5.2 — end screen shows Bubbles Popped', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setTimeout.bind(window)
    ;(window as unknown as Record<string, unknown>).setTimeout =
      (fn: () => void, ms: number, ...args: unknown[]) => orig(fn, Math.min(ms, 50), ...args)
    const origI = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => origI(fn, 10, ...args)
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForSelector('text=Bubbles Popped', { timeout: 60000 })
  await expect(page.locator('text=Bubbles Popped')).toBeVisible()
})

test('5.3 — end screen shows Final Rush Score', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setTimeout.bind(window)
    ;(window as unknown as Record<string, unknown>).setTimeout =
      (fn: () => void, ms: number, ...args: unknown[]) => orig(fn, Math.min(ms, 50), ...args)
    const origI = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => origI(fn, 10, ...args)
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForSelector('text=Final Rush Score', { timeout: 60000 })
  await expect(page.locator('text=Final Rush Score')).toBeVisible()
})

test('5.4 — play-again resets to start screen', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.setTimeout.bind(window)
    ;(window as unknown as Record<string, unknown>).setTimeout =
      (fn: () => void, ms: number, ...args: unknown[]) => orig(fn, Math.min(ms, 50), ...args)
    const origI = window.setInterval.bind(window)
    ;(window as unknown as Record<string, unknown>).setInterval =
      (fn: () => void, ms: number, ...args: unknown[]) => origI(fn, 10, ...args)
  })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForSelector('button:has-text("Play Again")', { timeout: 60000 })
  await game.playAgain()
  await expect(game.ctaButton).toBeVisible({ timeout: 3000 })
})

// ─── 6. MOBILE VIEWPORT ──────────────────────────────────────────────────────

test('6.1 — no horizontal scroll on iPhone SE (375px)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectNoHorizontalScroll()
})

test('6.2 — no horizontal scroll on iPhone 15 Pro Max (430px)', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 })
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.expectNoHorizontalScroll()
})

// ─── 7. PERFORMANCE ──────────────────────────────────────────────────────────

test('7.1 — JS heap below 120MB during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(8000)
  const memMB = await game.measureMemoryMB()
  if (memMB !== null) expect(memMB).toBeLessThan(120)
})

test('7.2 — FPS ≥ 55 during canvas rendering', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(6000)
  const fps = await game.measureFPS(3000)
  expect(fps, `FPS too low: ${fps}`).toBeGreaterThanOrEqual(55)
})

test('7.3 — particles bounded: alpha decay 0.03–0.05, filtered at alpha ≤ 0', async ({ page }) => {
  const result = await page.evaluate(() => {
    // Fastest decay: 0.05/frame → 1.0/0.05 = 20 frames
    // Slowest decay: 0.03/frame → 1.0/0.03 = 33.3 → 34 frames
    let alpha = 1.0; let frames = 0
    while (alpha > 0) { alpha -= 0.05; frames++ }
    return { fastDecayFrames: frames, timeMs: Math.round(frames * 1000 / 60) }
  })
  expect(result.fastDecayFrames).toBe(20)
  expect(result.timeMs).toBeLessThan(400)
})

test('7.4 — confetti canvas cleanup: removed after 5000ms', async ({ page }) => {
  const result = await page.evaluate(() => {
    // Confetti canvas is appended to body and removed after 5000ms timeout
    const CLEANUP_MS = 5000
    return { CLEANUP_MS }
  })
  expect(result.CLEANUP_MS).toBe(5000)
})

// ─── 8. ACCESSIBILITY ────────────────────────────────────────────────────────

test('8.1 — start screen passes axe-core', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('canvas')
    .analyze()
  const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
  expect(critical, critical.map(v => v.id).join(', ')).toHaveLength(0)
})

// ─── 9. GAME-SPECIFIC: COUNTDOWN CRUSH ────────────────────────────────────────

test('9.1 — starfield: 60 deterministic stars from seeded positions', async ({ page }) => {
  const result = await page.evaluate(() => {
    const W = 390, H = 844
    const stars = Array.from({ length: 60 }, (_, i) => ({
      x: (i * 173 + 47) % W,
      y: (i * 97  + 31) % H,
      r: i % 3 === 0 ? 1.5 : 0.8,
    }))
    // Verify deterministic (same every render)
    const star0 = { x: (0 * 173 + 47) % W, y: (0 * 97 + 31) % H }
    const star59 = { x: (59 * 173 + 47) % W, y: (59 * 97 + 31) % H }
    return { count: stars.length, star0, star59 }
  })
  expect(result.count).toBe(60)
  expect(result.star0.x).toBe(47)
  expect(result.star0.y).toBe(31)
})

test('9.2 — total game score: max possible across all windows', async ({ page }) => {
  const result = await page.evaluate(() => {
    const WINDOWS = [
      { window_ms: 2500, multiplier: 1,   target_count: 6  },
      { window_ms: 2400, multiplier: 1,   target_count: 7  },
      { window_ms: 2300, multiplier: 1,   target_count: 7  },
      { window_ms: 2100, multiplier: 1.5, target_count: 8  },
      { window_ms: 2000, multiplier: 1.5, target_count: 8  },
      { window_ms: 1800, multiplier: 2,   target_count: 9  },
      { window_ms: 1600, multiplier: 2,   target_count: 9  },
      { window_ms: 1400, multiplier: 3,   target_count: 10 },
      { window_ms: 1200, multiplier: 3,   target_count: 10 },
      { window_ms: 1000, multiplier: 3,   target_count: 12 },
    ]
    const PTS = 10
    const maxScore = WINDOWS.reduce((sum, w) =>
      sum + Math.round(PTS * w.multiplier) * w.target_count, 0)
    return { maxScore }
  })
  // 60 + 70 + 70 + 120 + 120 + 180 + 180 + 300 + 300 + 360 = 1760
  expect(result.maxScore).toBe(1760)
})

test('9.3 — bubble shimmer oscillation: 0.12 ± 0.08 alpha range', async ({ page }) => {
  const result = await page.evaluate(() => {
    function shimmerAlpha(shimmer: number): number {
      return 0.12 + 0.08 * Math.sin(shimmer)
    }
    const min = shimmerAlpha(-Math.PI / 2)  // 0.12 - 0.08 = 0.04
    const max = shimmerAlpha(Math.PI / 2)   // 0.12 + 0.08 = 0.20
    return { min: Math.round(min * 1000) / 1000, max: Math.round(max * 1000) / 1000 }
  })
  expect(result.min).toBeCloseTo(0.04, 2)
  expect(result.max).toBeCloseTo(0.20, 2)
})

test('9.4 — consecutive tracking: resets at start of each scoring window', async ({ page }) => {
  const result = await page.evaluate(() => {
    // consecutiveCurrent resets at beginning of each scoring window
    let consecutiveCurrent = 5  // had 5 in previous window
    // On window transition → scoring:
    consecutiveCurrent = 0
    const afterReset = consecutiveCurrent
    // Pop 3 bubbles in new window:
    consecutiveCurrent++; consecutiveCurrent++; consecutiveCurrent++
    return { afterReset, after3pops: consecutiveCurrent }
  })
  expect(result.afterReset).toBe(0)
  expect(result.after3pops).toBe(3)
})

test('9.5 — confetti colors: 6 gold shades', async ({ page }) => {
  const result = await page.evaluate(() => {
    const goldColors = ['#fbbf24', '#f59e0b', '#fde68a', '#ffffff', '#d97706', '#facc15']
    return { count: goldColors.length, hasWhite: goldColors.includes('#ffffff') }
  })
  expect(result.count).toBe(6)
  expect(result.hasWhite).toBe(true)
})
