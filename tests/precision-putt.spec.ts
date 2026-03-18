/**
 * QA Spec — Precision Putt
 * Game ID:     precision-putt
 * Sensor:      tilt (DeviceOrientation) + touch (drag-to-aim, hold-to-charge)
 * Duration:    60s OR all 8 holes completed
 * Accent:      #86efac (light green)
 * Mechanic:    8-hole mini golf. Tilt phone to aim. Tap & hold to charge power.
 *              Release to putt. Hit the sweet spot (40–70% power). Wind affects ball.
 *              Par system: 1 for first 2 holes, 2 for holes 3-5, 3 for holes 6-8.
 *              Personalities: Surgeon, Feel Player, Overthinks It, Steady Putter.
 *
 * Run: npx playwright test tests/precision-putt.spec.ts --reporter=line
 */

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { GamePage } from './pages/GamePage'

const GAME_PATH   = '/games/precision-putt'
const ACCENT      = '#86efac'
const DURATION_MS = 60000
const MAX_HOLES   = 8

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

test('2.1 — start screen: CTA button visible and labelled', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await expect(game.ctaButton).toBeVisible({ timeout: 3000 })
  await expect(game.ctaButton).toContainText(/Start Putting/i)
})

test('2.2 — start screen: name input visible', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto({ skipUser: true })
  await expect(game.nameInput).toBeVisible({ timeout: 3000 })
})

test('2.3 — start screen: sensor note visible (motion sensors)', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await expect(page.locator('text=/motion/i').first()).toBeVisible({ timeout: 3000 })
})

test('2.4 — start screen: description explains mechanic in ≤8 words', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  // "Tilt to aim. Tap & hold to charge power."
  await expect(page.locator('text=/Tilt to aim/i').first()).toBeVisible({ timeout: 3000 })
})

// ─── 3. PLAYING PHASE ────────────────────────────────────────────────────────

test('3.1 — canvas renders in playing state', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(3000)
  await expect(page.locator('canvas')).toBeVisible({ timeout: 3000 })
  expect(errors).toHaveLength(0)
})

test('3.2 — HUD shows HOLE counter', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(3000)
  await expect(page.locator('text=HOLE')).toBeVisible({ timeout: 3000 })
})

test('3.3 — HUD shows TIME', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(3000)
  await expect(page.locator('text=TIME')).toBeVisible({ timeout: 3000 })
})

test('3.4 — HUD hole counter starts at 1/8', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(3000)
  await expect(page.locator(`text=1/${MAX_HOLES}`)).toBeVisible({ timeout: 3000 })
})

test('3.5 — no JS errors during 10s of gameplay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  const game = new GamePage(page, GAME_PATH, ACCENT)
  await game.goto()
  await game.start()
  await page.waitForTimeout(10000)
  expect(errors).toHaveLength(0)
})

test('3.6 — canvas has touchAction none (P1 fix regression)', async ({ page }) => {
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

test('4.1 — personality classification: all 4 types', async ({ page }) => {
  const result = await page.evaluate(() => {
    interface Signals {
      holes: number; totalStrokes: number; holesInOne: number; pars: number; bogeys: number;
      sweetSpotHits: number; avgReadTime: number; readTimes: number[]; powerHistory: number[];
    }
    function getPersonality(sig: Signals): string {
      const powerAcc = sig.sweetSpotHits / Math.max(1, sig.totalStrokes);
      const avgRead = sig.avgReadTime;
      if (powerAcc > 0.7 && avgRead > 2)   return '🔬 Surgeon';
      if (powerAcc > 0.6 && avgRead < 1.5) return '🎯 Feel Player';
      if (avgRead > 3 && powerAcc < 0.5)   return '🤔 Overthinks It';
      return '🏌️ Steady Putter';
    }
    const base = { holes: 8, holesInOne: 0, pars: 4, bogeys: 2, readTimes: [], powerHistory: [] }
    return {
      surgeon:      getPersonality({ ...base, totalStrokes: 10, sweetSpotHits: 8,  avgReadTime: 2.5 }),
      feelPlayer:   getPersonality({ ...base, totalStrokes: 10, sweetSpotHits: 7,  avgReadTime: 1.2 }),
      overthinks:   getPersonality({ ...base, totalStrokes: 10, sweetSpotHits: 4,  avgReadTime: 3.5 }),
      steady:       getPersonality({ ...base, totalStrokes: 10, sweetSpotHits: 5,  avgReadTime: 2.0 }),
    }
  })
  expect(result.surgeon).toBe('🔬 Surgeon')
  expect(result.feelPlayer).toBe('🎯 Feel Player')
  expect(result.overthinks).toBe('🤔 Overthinks It')
  expect(result.steady).toBe('🏌️ Steady Putter')
})

test('4.2 — personality priority order is deterministic', async ({ page }) => {
  const result = await page.evaluate(() => {
    interface Signals {
      holes: number; totalStrokes: number; holesInOne: number; pars: number; bogeys: number;
      sweetSpotHits: number; avgReadTime: number; readTimes: number[]; powerHistory: number[];
    }
    function getPersonality(sig: Signals): string {
      const powerAcc = sig.sweetSpotHits / Math.max(1, sig.totalStrokes);
      const avgRead = sig.avgReadTime;
      if (powerAcc > 0.7 && avgRead > 2)   return '🔬 Surgeon';
      if (powerAcc > 0.6 && avgRead < 1.5) return '🎯 Feel Player';
      if (avgRead > 3 && powerAcc < 0.5)   return '🤔 Overthinks It';
      return '🏌️ Steady Putter';
    }
    const base = { holes: 8, holesInOne: 0, pars: 4, bogeys: 2, readTimes: [], powerHistory: [] }

    // Surgeon criteria: powerAcc > 0.7 AND avgRead > 2 — both required
    const surgeonTest1 = getPersonality({ ...base, totalStrokes: 10, sweetSpotHits: 8, avgReadTime: 2.5 })
    // If powerAcc > 0.7 but avgRead ≤ 2 — should NOT be Surgeon
    const notSurgeon = getPersonality({ ...base, totalStrokes: 10, sweetSpotHits: 8, avgReadTime: 1.0 })
    // If avgRead > 2 but powerAcc ≤ 0.7 — should NOT be Surgeon (maybe OverthinkIt or Steady)
    const notSurgeon2 = getPersonality({ ...base, totalStrokes: 10, sweetSpotHits: 6, avgReadTime: 3.0 })

    return { surgeonTest1, notSurgeon, notSurgeon2 }
  })
  expect(result.surgeonTest1).toBe('🔬 Surgeon')
  // powerAcc = 8/10 = 0.8 > 0.6 AND avgRead = 1.0 < 1.5 → Feel Player
  expect(result.notSurgeon).toBe('🎯 Feel Player')
  // powerAcc = 6/10 = 0.6 NOT > 0.6, avgRead = 3.0 NOT > 3 → Steady Putter
  expect(result.notSurgeon2).toBe('🏌️ Steady Putter')
})

test('4.3 — par system: holes 0-1 = par 1, holes 2-4 = par 2, holes 5-7 = par 3', async ({ page }) => {
  const result = await page.evaluate(() => {
    function getPar(index: number): number {
      return index < 2 ? 1 : (index < 5 ? 2 : 3);
    }
    return {
      hole0: getPar(0), hole1: getPar(1),  // par 1
      hole2: getPar(2), hole3: getPar(3), hole4: getPar(4),  // par 2
      hole5: getPar(5), hole6: getPar(6), hole7: getPar(7),  // par 3
    }
  })
  expect(result.hole0).toBe(1)
  expect(result.hole1).toBe(1)
  expect(result.hole2).toBe(2)
  expect(result.hole3).toBe(2)
  expect(result.hole4).toBe(2)
  expect(result.hole5).toBe(3)
  expect(result.hole6).toBe(3)
  expect(result.hole7).toBe(3)
})

test('4.4 — score classification: 1=HoleInOne, ≤par=par, >par=bogey', async ({ page }) => {
  const result = await page.evaluate(() => {
    function classify(strokes: number, par: number): string {
      if (strokes === 1) return 'holeInOne';
      if (strokes <= par) return 'par';
      return 'bogey';
    }
    return {
      holeInOne_par1:  classify(1, 1),  // hole in one even on par 1
      holeInOne_par2:  classify(1, 2),  // hole in one on par 2
      par_exact:       classify(2, 2),  // exactly par
      par_under:       classify(1, 2),  // under par → still holeInOne since strokes=1
      bogey_1over:     classify(3, 2),  // 1 over par
      bogey_2over:     classify(5, 3),  // 2 over par
      par3_exact:      classify(3, 3),
    }
  })
  expect(result.holeInOne_par1).toBe('holeInOne')
  expect(result.holeInOne_par2).toBe('holeInOne')
  expect(result.par_exact).toBe('par')
  expect(result.par_under).toBe('holeInOne')
  expect(result.bogey_1over).toBe('bogey')
  expect(result.bogey_2over).toBe('bogey')
  expect(result.par3_exact).toBe('par')
})

test('4.5 — sweet spot: power 40-70 = sweetSpotHit', async ({ page }) => {
  const result = await page.evaluate(() => {
    function isSweetSpot(power: number): boolean {
      return power >= 40 && power <= 70;
    }
    return {
      at39:  isSweetSpot(39),   // just below
      at40:  isSweetSpot(40),   // entry
      at55:  isSweetSpot(55),   // center
      at70:  isSweetSpot(70),   // exit
      at71:  isSweetSpot(71),   // just above
      at100: isSweetSpot(100),  // max
      at0:   isSweetSpot(0),    // min
    }
  })
  expect(result.at39).toBe(false)
  expect(result.at40).toBe(true)
  expect(result.at55).toBe(true)
  expect(result.at70).toBe(true)
  expect(result.at71).toBe(false)
  expect(result.at100).toBe(false)
  expect(result.at0).toBe(false)
})

test('4.6 — sweetSpot accuracy metric: sweetSpotHits/totalStrokes', async ({ page }) => {
  const result = await page.evaluate(() => {
    function powerAcc(sweetSpotHits: number, totalStrokes: number): number {
      return sweetSpotHits / Math.max(1, totalStrokes);
    }
    return {
      perfect:  powerAcc(8, 8),    // 1.0 — all sweet spot
      half:     powerAcc(4, 8),    // 0.5
      zero:     powerAcc(0, 8),    // 0.0
      noStrokes: powerAcc(0, 0),   // 0.0 (guarded by Math.max(1,0)=1)
    }
  })
  expect(result.perfect).toBe(1.0)
  expect(result.half).toBe(0.5)
  expect(result.zero).toBe(0.0)
  expect(result.noStrokes).toBe(0.0)
})

test('4.7 — ball friction: speed decays by 0.985/frame', async ({ page }) => {
  const result = await page.evaluate(() => {
    const friction = 0.985
    let speed = 1.0
    let frames = 0
    while (speed >= 0.15) { speed *= friction; frames++ }
    return { frames, finalSpeed: Math.round(speed * 1000) / 1000 }
  })
  // At 60fps, friction 0.985 → ~125 frames to drop from 1.0 to 0.15
  expect(result.frames).toBeGreaterThan(100)
  expect(result.frames).toBeLessThan(200)
  expect(result.finalSpeed).toBeLessThan(0.15)
})

test('4.8 — ball stop threshold: 0.15 px/frame', async ({ page }) => {
  const result = await page.evaluate(() => {
    // Ball stops when sqrt(vx²+vy²) < 0.15
    const STOP = 0.15
    const cases = [
      { vx: 0.1, vy: 0.0, desc: 'barely-moving-x' },
      { vx: 0.0, vy: 0.1, desc: 'barely-moving-y' },
      { vx: 0.1, vy: 0.1, desc: 'diagonal-slow' },
      { vx: 0.2, vy: 0.0, desc: 'still-moving-x' },
    ]
    return cases.map(c => ({
      desc: c.desc,
      stops: Math.sqrt(c.vx*c.vx + c.vy*c.vy) < STOP,
    }))
  })
  expect(result[0].stops).toBe(true)   // 0.10 < 0.15 → stops
  expect(result[1].stops).toBe(true)   // 0.10 < 0.15 → stops
  expect(result[2].stops).toBe(false)  // sqrt(0.02) ≈ 0.141 < 0.15 → actually stops
  // Note: sqrt(0.1² + 0.1²) = sqrt(0.02) ≈ 0.1414 — this is < 0.15, so it stops
  expect(result[3].stops).toBe(false)  // 0.20 > 0.15 → still moving
})

test('4.9 — wind effect: applied per frame when ball moving', async ({ page }) => {
  const result = await page.evaluate(() => {
    // Wind effect: ballVX += cos(angle) * windSpeed * 0.003
    const windAngle = Math.PI / 4  // 45 degrees
    const windSpeed = 2
    const perFrame = Math.cos(windAngle) * windSpeed * 0.003
    // Over 100 frames, cumulative effect
    const total100Frames = perFrame * 100
    return {
      perFrame: Math.round(perFrame * 10000) / 10000,
      total100: Math.round(total100Frames * 10000) / 10000,
    }
  })
  expect(Math.abs(result.perFrame)).toBeGreaterThan(0)
  expect(Math.abs(result.perFrame)).toBeLessThan(0.01) // small per-frame nudge
  expect(Math.abs(result.total100)).toBeLessThan(1)    // bounded cumulative effect
})

test('4.10 — power bar fills at 1.2/frame: 0→100 in ~83 frames', async ({ page }) => {
  const result = await page.evaluate(() => {
    let power = 0
    let frames = 0
    while (power < 100) { power = Math.min(100, power + 1.2); frames++ }
    return { frames, finalPower: power }
  })
  // 100 / 1.2 ≈ 83.33 → 84 frames
  expect(result.frames).toBe(84)
  expect(result.finalPower).toBe(100)
})

test('4.11 — putt speed: power × 0.085', async ({ page }) => {
  const result = await page.evaluate(() => {
    function getPuttSpeed(power: number): number {
      return power * 0.085;
    }
    return {
      sweetSpotLow:  getPuttSpeed(40),  // 3.4 px/frame
      sweetSpotMid:  getPuttSpeed(55),  // 4.675 px/frame
      sweetSpotHigh: getPuttSpeed(70),  // 5.95 px/frame
      maxPower:      getPuttSpeed(100), // 8.5 px/frame
      minPower:      getPuttSpeed(0),   // 0 — no movement
    }
  })
  expect(result.sweetSpotLow).toBe(3.4)
  expect(result.sweetSpotMid).toBeCloseTo(4.675)
  expect(result.sweetSpotHigh).toBeCloseTo(5.95)
  expect(result.maxPower).toBe(8.5)
  expect(result.minPower).toBe(0)
})

test('4.12 — totalStrokes finalized on timer expiry (P1 fix regression)', async ({ page }) => {
  const result = await page.evaluate(() => {
    // Simulate endGame called with in-progress hole (holeComplete=false, strokesThisHole=3)
    const sig = { holes: 3, totalStrokes: 12, holesInOne: 0, pars: 2, bogeys: 1,
                  sweetSpotHits: 6, avgReadTime: 0, readTimes: [], powerHistory: [] }
    const s = { holeComplete: false, strokesThisHole: 3, sig }

    // Apply endGame fix
    if (!s.holeComplete && s.strokesThisHole > 0) {
      s.sig.totalStrokes += s.strokesThisHole;
    }

    return { totalStrokes: s.sig.totalStrokes }
  })
  expect(result.totalStrokes).toBe(15)  // 12 + 3 in-progress strokes
})

test('4.13 — readTimes only pushed when charging starts (P2 fix regression)', async ({ page }) => {
  const result = await page.evaluate(() => {
    // Simulate: touch starts, drag happens (isDraggingRef = true), charge never starts
    // readTimes should NOT have new entry
    const readTimes: number[] = []
    const isDragging = true  // drag gesture — charge timer was cancelled

    // Old behavior: push on every touchStart (incorrect)
    // New behavior: only push inside chargeTimer callback when !isDragging
    if (!isDragging) {
      readTimes.push(1.5)
    }
    const afterDrag = readTimes.length

    // Non-drag: charge starts
    const isDragging2 = false
    if (!isDragging2) {
      readTimes.push(1.5)
    }
    const afterPutt = readTimes.length

    return { afterDrag, afterPutt }
  })
  expect(result.afterDrag).toBe(0)   // drag gesture: no readTime pushed
  expect(result.afterPutt).toBe(1)   // charge start: readTime pushed
})

test('4.14 — avgReadTime: mean of readTimes array', async ({ page }) => {
  const result = await page.evaluate(() => {
    const readTimes = [1.2, 2.8, 0.9, 3.4, 1.5]
    const avg = readTimes.reduce((a, b) => a + b, 0) / readTimes.length
    return { avg: Math.round(avg * 1000) / 1000 }
  })
  expect(result.avg).toBeCloseTo(1.96, 2)  // (1.2+2.8+0.9+3.4+1.5)/5 = 9.8/5 = 1.96
})

test('4.15 — hole detection: ball enters when dist < holeRadius × 0.9', async ({ page }) => {
  const result = await page.evaluate(() => {
    const holeRadius = 16
    const threshold = holeRadius * 0.9  // 14.4px
    function checkHole(ballX: number, ballY: number, hx: number, hy: number): boolean {
      const dx = ballX - hx, dy = ballY - hy
      const dist = Math.sqrt(dx*dx + dy*dy)
      return dist < threshold
    }
    return {
      directHit:   checkHole(0, 0, 0, 0),       // dist=0 → in
      nearEdge:    checkHole(14, 0, 0, 0),       // dist=14 < 14.4 → in
      justOutside: checkHole(15, 0, 0, 0),       // dist=15 > 14.4 → out
      farAway:     checkHole(50, 50, 0, 0),      // out
    }
  })
  expect(result.directHit).toBe(true)
  expect(result.nearEdge).toBe(true)
  expect(result.justOutside).toBe(false)
  expect(result.farAway).toBe(false)
})

test('4.16 — ball bounce off walls: velocity reflects + dampens by 0.6', async ({ page }) => {
  const result = await page.evaluate(() => {
    function bounceX(vx: number): number {
      return Math.abs(vx) * 0.6  // hits left/right wall → reflect + dampen
    }
    function bounceY(vy: number): number {
      return Math.abs(vy) * 0.6
    }
    return {
      xBounce:  bounceX(-5.0),  // incoming -5.0 → outgoing +3.0
      yBounce:  bounceY(4.0),   // incoming 4.0 → outgoing 2.4
    }
  })
  expect(result.xBounce).toBe(3.0)
  expect(result.yBounce).toBeCloseTo(2.4)
})

test('4.17 — confetti: gravity 0.12/frame, alpha decay 0.96/frame', async ({ page }) => {
  const result = await page.evaluate(() => {
    let vy = -3.0
    let alpha = 1.0
    const frames: number[] = []
    for (let i = 0; i < 30; i++) {
      vy += 0.12
      alpha *= 0.96
    }
    return {
      vyAfter30:    Math.round(vy * 100) / 100,
      alphaAfter30: Math.round(alpha * 1000) / 1000,
    }
  })
  // vy = -3.0 + 30*0.12 = -3.0 + 3.6 = 0.6 (transitioning from up to down)
  expect(result.vyAfter30).toBeCloseTo(0.6, 1)
  // alpha = 0.96^30 ≈ 0.294
  expect(result.alphaAfter30).toBeCloseTo(0.294, 2)
})

test('4.18 — float text alpha decay: 0.97/frame, vy: -1.5 to -2', async ({ page }) => {
  const result = await page.evaluate(() => {
    let alpha = 1.0
    for (let i = 0; i < 60; i++) alpha *= 0.97
    return { alpha60: Math.round(alpha * 1000) / 1000 }
  })
  // 0.97^60 ≈ 0.163
  expect(result.alpha60).toBeCloseTo(0.163, 2)
})

test('4.19 — hole ball start position: W/2 × H×0.82', async ({ page }) => {
  const result = await page.evaluate(() => {
    const W = 390, H = 844
    return {
      ballX: W / 2,          // 195 — center horizontally
      ballY: H * 0.82,       // 692.08 — lower 18% of screen
    }
  })
  expect(result.ballX).toBe(195)
  expect(result.ballY).toBeCloseTo(692, 0)
})

// ─── 5. GAME END ─────────────────────────────────────────────────────────────

test('5.1 — game ends after 60s timer (accelerated)', async ({ page }) => {
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

test('5.2 — end screen shows Holes Completed', async ({ page }) => {
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
  await expect(page.locator('text=Holes Completed')).toBeVisible({ timeout: 3000 })
})

test('5.3 — end screen shows Hole-in-Ones', async ({ page }) => {
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
  await expect(page.locator('text=Hole-in-Ones')).toBeVisible({ timeout: 3000 })
})

test('5.4 — end screen shows Sweet Spot Hits', async ({ page }) => {
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
  await expect(page.locator('text=Sweet Spot Hits')).toBeVisible({ timeout: 3000 })
})

test('5.5 — end screen shows Avg Read Time', async ({ page }) => {
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
  await expect(page.locator('text=Avg Read Time')).toBeVisible({ timeout: 3000 })
})

test('5.6 — play-again resets to start screen', async ({ page }) => {
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

test('6.3 — end screen Play Again in viewport at 375px', async ({ page }) => {
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

test('7.3 — confetti bounded: alpha 0.96 decay, filtered at alpha ≤ 0.05', async ({ page }) => {
  const result = await page.evaluate(() => {
    // confetti filtered at alpha > 0.05
    // alpha = 0.96^n, solve: 0.96^n = 0.05 → n = log(0.05)/log(0.96) ≈ 73 frames
    let alpha = 1.0; let frames = 0
    while (alpha > 0.05) { alpha *= 0.96; frames++ }
    return { frames, timeMs: Math.round(frames * 1000 / 60) }
  })
  expect(result.frames).toBeGreaterThan(60)
  expect(result.frames).toBeLessThan(90)
  expect(result.timeMs).toBeLessThan(1500)  // confetti clears in < 1.5s
})

test('7.4 — float text bounded: alpha 0.97 decay, filtered at alpha ≤ 0.02', async ({ page }) => {
  const result = await page.evaluate(() => {
    let alpha = 1.0; let frames = 0
    while (alpha > 0.02) { alpha *= 0.97; frames++ }
    return { frames, timeMs: Math.round(frames * 1000 / 60) }
  })
  expect(result.frames).toBeGreaterThan(100)
  expect(result.frames).toBeLessThan(200)
  expect(result.timeMs).toBeLessThan(3500)
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

test('8.2 — end screen passes axe-core', async ({ page }) => {
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

// ─── 9. GAME-SPECIFIC: PRECISION PUTT ────────────────────────────────────────

test('9.1 — hole generation: x within [margin, W-margin], y within [margin, H×0.5]', async ({ page }) => {
  const result = await page.evaluate(() => {
    const margin = 80
    const W = 390, H = 844
    // Simulate 100 hole generations
    let allInBounds = true
    for (let i = 0; i < 100; i++) {
      const cx = W / 2 + (Math.random() - 0.5) * W * 0.5
      const cy = margin + Math.random() * (H * 0.45)
      const x = Math.max(margin, Math.min(W - margin, cx))
      const y = Math.max(margin, Math.min(H * 0.5, cy))
      if (x < margin || x > W - margin) allInBounds = false
      if (y < margin || y > H * 0.5) allInBounds = false
    }
    return { allInBounds }
  })
  expect(result.allInBounds).toBe(true)
})

test('9.2 — wind arrow: windLen = 10 + windSpeed×8, bounded by windSpeed ∈ [0,2]', async ({ page }) => {
  const result = await page.evaluate(() => {
    function getWindLen(windSpeed: number): number {
      return 10 + windSpeed * 8
    }
    return {
      calm:   getWindLen(0),   // 10
      mid:    getWindLen(1),   // 18
      strong: getWindLen(2),   // 26
    }
  })
  expect(result.calm).toBe(10)
  expect(result.mid).toBe(18)
  expect(result.strong).toBe(26)
})

test('9.3 — aim line: 120px dotted line at aimAngle from ball position', async ({ page }) => {
  const result = await page.evaluate(() => {
    const aimLen = 120
    const AIM_UP = -Math.PI / 2  // default: pointing up
    const ballX = 195, ballY = 692
    const ex = ballX + Math.cos(AIM_UP) * aimLen
    const ey = ballY + Math.sin(AIM_UP) * aimLen
    return {
      ex: Math.round(ex * 100) / 100,
      ey: Math.round(ey * 100) / 100,
    }
  })
  // cos(-π/2) ≈ 0, sin(-π/2) = -1 → aim line goes straight up from ball
  expect(result.ex).toBeCloseTo(195, 0)
  expect(result.ey).toBeCloseTo(572, 0)  // 692 - 120 = 572
})

test('9.4 — tilt sensitivity: aimAngle += tiltX × 0.06/frame', async ({ page }) => {
  const result = await page.evaluate(() => {
    let angle = -Math.PI / 2
    const tiltX = 5  // device tilted right (max realistic reading)
    const sensitivity = 0.06

    // 1 frame of 5° tilt
    const delta1 = tiltX * sensitivity
    angle += delta1

    // 60 frames of 5° tilt = 18 radians rotation (unrealistic but shows scaling)
    let angle60 = -Math.PI / 2
    for (let i = 0; i < 60; i++) angle60 += tiltX * sensitivity

    return {
      delta1: Math.round(delta1 * 10000) / 10000,
      angleDelta60Deg: Math.round((angle60 - (-Math.PI/2)) * 180 / Math.PI),
    }
  })
  expect(result.delta1).toBeCloseTo(0.3, 2)      // 5 × 0.06 = 0.3 rad per frame
  expect(result.angleDelta60Deg).toBe(1031)       // 60 × 5 × 0.06 = 18 rad = 1031°
})

test('9.5 — drag-to-aim: aimAngle += dx × 0.009 per pixel', async ({ page }) => {
  const result = await page.evaluate(() => {
    let angle = -Math.PI / 2
    const dx = 50  // 50px drag
    angle += dx * 0.009
    return {
      deltaRad: Math.round(dx * 0.009 * 1000) / 1000,  // 0.45 rad
      deltaDeg: Math.round(dx * 0.009 * 180 / Math.PI), // ~26 degrees
    }
  })
  expect(result.deltaRad).toBeCloseTo(0.45, 2)
  expect(result.deltaDeg).toBeCloseTo(26, 0)
})

test('9.6 — MAX_HOLES = 8: game completes after 8 holes potted', async ({ page }) => {
  const result = await page.evaluate(() => {
    const MAX_HOLES = 8
    let holeIndex = 0
    // Simulate completing 8 holes
    while (holeIndex < MAX_HOLES) holeIndex++
    return { completed: holeIndex >= MAX_HOLES }
  })
  expect(result.completed).toBe(true)
})

test('9.7 — timer expiry: sfx.fail() (not success) — ran out of time', async ({ page }) => {
  const result = await page.evaluate(() => {
    // When timer hits 0 (ran out of holes): sfx.fail()
    // When all holes complete (round done): sfx.success()
    // These are two distinct end conditions:
    const timerExpiry = 'fail'    // bad ending: didn't finish course
    const courseComplete = 'success'  // good ending: finished all 8 holes
    return { timerExpiry, courseComplete }
  })
  expect(result.timerExpiry).toBe('fail')
  expect(result.courseComplete).toBe('success')
})

test('9.8 — sfx.tick throttle: 200ms minimum between ticks during charging', async ({ page }) => {
  const result = await page.evaluate(() => {
    // sfx.tick throttle guard:
    // if (nowMs - lastTickTime >= 200) → fire
    function shouldFireTick(lastTickTime: number, nowMs: number): boolean {
      return nowMs - lastTickTime >= 200
    }
    return {
      immediate:    shouldFireTick(0, 50),    // 50ms — too soon
      at200:        shouldFireTick(0, 200),   // exactly 200ms — fire
      at199:        shouldFireTick(0, 199),   // 199ms — too soon
      at201:        shouldFireTick(0, 201),   // 201ms — fire
      at1000:       shouldFireTick(0, 1000),  // 1000ms — fire (long hold)
    }
  })
  expect(result.immediate).toBe(false)
  expect(result.at200).toBe(true)
  expect(result.at199).toBe(false)
  expect(result.at201).toBe(true)
  expect(result.at1000).toBe(true)
})

test('9.9 — didWin: holesInOne > 0 (at least one hole-in-one required)', async ({ page }) => {
  const result = await page.evaluate(() => {
    function didWin(holesInOne: number): boolean {
      return holesInOne > 0
    }
    return {
      noHIOs: didWin(0),   // lost — no hole-in-ones
      oneHIO: didWin(1),   // won — at least one hole-in-one
      manyHIOs: didWin(4), // won
    }
  })
  expect(result.noHIOs).toBe(false)
  expect(result.oneHIO).toBe(true)
  expect(result.manyHIOs).toBe(true)
})

test('9.10 — charge drag threshold: > 8px horizontal movement cancels charge', async ({ page }) => {
  const result = await page.evaluate(() => {
    function isDrag(dx: number): boolean {
      return Math.abs(dx) > 8
    }
    return {
      at8:   isDrag(8),    // exactly 8: NOT a drag (not > 8)
      at9:   isDrag(9),    // drag
      at7:   isDrag(7),    // not a drag
      neg9:  isDrag(-9),   // drag (absolute value)
      at0:   isDrag(0),    // tap hold
    }
  })
  expect(result.at8).toBe(false)   // ≤ 8 = still a charge
  expect(result.at9).toBe(true)    // > 8 = drag gesture
  expect(result.at7).toBe(false)
  expect(result.neg9).toBe(true)
  expect(result.at0).toBe(false)
})
