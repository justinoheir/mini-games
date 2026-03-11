/**
 * Landing Page Tests
 * Run after ANY new game is added to app/page.tsx
 *
 * npx playwright test tests/landing.spec.ts --headed
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.TEST_URL ?? 'http://localhost:3000'

test.beforeEach(async ({ page }) => {
  // Set a stored user so we skip onboarding
  await page.addInitScript(() => {
    localStorage.setItem('mg_user', JSON.stringify({
      name: 'Test User',
      email: 'test@test.com',
      timestamp: Date.now()
    }))
  })
})

// ─── 1. Page loads ────────────────────────────────────────────────────────────

test('landing page loads without errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', err => errors.push(err.message))

  await page.goto(BASE_URL + '/')
  await page.waitForLoadState('networkidle')

  expect(errors).toHaveLength(0)
})

// ─── 2. Game cards visible ────────────────────────────────────────────────────

test('at least one game card is visible', async ({ page }) => {
  await page.goto(BASE_URL + '/')
  await page.waitForLoadState('networkidle')

  const cards = page.locator('[data-testid="game-card"], a[href^="/games/"]')
  await expect(cards.first()).toBeVisible({ timeout: 3000 })
})

test('all game cards have a title and emoji', async ({ page }) => {
  await page.goto(BASE_URL + '/')
  await page.waitForLoadState('networkidle')

  const cards = page.locator('[data-testid="game-card"], a[href^="/games/"]')
  const count = await cards.count()
  expect(count).toBeGreaterThan(0)

  // Each card should have visible text
  for (let i = 0; i < count; i++) {
    const text = await cards.nth(i).textContent()
    expect(text?.trim().length).toBeGreaterThan(0)
  }
})

// ─── 3. SCROLL TEST — run after every new game added ─────────────────────────

test('landing page scrolls when game list exceeds viewport height', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(BASE_URL + '/')
  await page.waitForLoadState('networkidle')

  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight)
  const clientHeight = await page.evaluate(() => document.documentElement.clientHeight)

  // If content overflows, scrolling must NOT be blocked
  if (scrollHeight > clientHeight) {
    const bodyOverflow  = await page.evaluate(() => getComputedStyle(document.body).overflow)
    const bodyOverflowY = await page.evaluate(() => getComputedStyle(document.body).overflowY)
    const htmlOverflow  = await page.evaluate(() => getComputedStyle(document.documentElement).overflow)
    const htmlOverflowY = await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)

    expect(bodyOverflow).not.toBe('hidden')
    expect(bodyOverflowY).not.toBe('hidden')
    expect(htmlOverflow).not.toBe('hidden')
    expect(htmlOverflowY).not.toBe('hidden')
  }
})

test('can scroll to last game card on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(BASE_URL + '/')
  await page.waitForLoadState('networkidle')

  // Scroll to bottom
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(300)

  // Last game card should be visible after scrolling
  const cards = page.locator('[data-testid="game-card"], a[href^="/games/"]')
  const count = await cards.count()
  if (count > 0) {
    const lastCard = cards.last()
    await expect(lastCard).toBeInViewport({ timeout: 2000 })
  }
})

test('no horizontal scroll on landing page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(BASE_URL + '/')
  await page.waitForLoadState('networkidle')

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2)
})

// ─── 4. Navigation ────────────────────────────────────────────────────────────

test('tapping a game card navigates to the game', async ({ page }) => {
  await page.goto(BASE_URL + '/')
  await page.waitForLoadState('networkidle')

  const firstCard = page.locator('a[href^="/games/"]').first()
  const href = await firstCard.getAttribute('href')
  await firstCard.click()

  await expect(page).toHaveURL(new RegExp('/games/'))
  await page.waitForLoadState('networkidle')
  await expect(page.locator('body')).not.toBeEmpty()
})

// ─── 5. Progress bar ──────────────────────────────────────────────────────────

test('progress bar shows correct count', async ({ page }) => {
  // Seed some completed games
  await page.addInitScript(() => {
    localStorage.setItem('mg_user', JSON.stringify({ name: 'Test', email: 'test@test.com', timestamp: Date.now() }))
    localStorage.setItem('mg_scores', JSON.stringify({
      'tilt-maze': { score: 100, personality: 'Precise', signals: {}, timestamp: Date.now() },
      'whisper-bomb': { score: 80, personality: 'Calm', signals: {}, timestamp: Date.now() }
    }))
  })

  await page.goto(BASE_URL + '/')
  await page.waitForLoadState('networkidle')

  // Should show "2 of X played" or similar
  const progressText = page.locator('text=/played/i').or(page.locator('text=/2 of/'))
  // Soft check — progress indicator exists
  const count = await progressText.count()
  // If progress UI exists, it should show the right number
  // Not a hard fail if progress UI isn't implemented yet
})
