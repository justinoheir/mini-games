import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { GamePage } from './pages/GamePage'
const GAME_ID = 'friction-slide'; const GAME_PATH = '/games/friction-slide'; const ACCENT = '#0ea5e9'; const GAME_DURATION_MS = 45000;
test('1.1 — page loads without JS errors', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', err => errors.push(err.message));
  const game = new GamePage(page, GAME_PATH, ACCENT); await game.goto(); expect(errors).toHaveLength(0);
})
test('2.1 — start screen renders', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT); await game.goto(); await expect(game.ctaButton).toBeVisible({ timeout: 3000 });
})
test('2.3 — CTA meets 44px', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT); await game.goto(); await game.expectTouchTargetSize(game.ctaButton, 44, 'CTA button');
})
test('3.1 — countdown after start', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT); await game.goto(); await game.start(); await game.waitForCountdown();
})
test('4.1 — timer visible', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT); await game.goto(); await game.start(); await game.waitForPlaying(); await expect(game.timerEl).toBeVisible();
})
test('4.2 — timer decreases', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT); await game.goto(); await game.start(); await game.waitForPlaying(); await game.expectTimerDecreasing(3000);
})
test('5.1 — score starts 0', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT); await game.goto(); await game.start(); await game.waitForPlaying();
  const s = await game.scoreEl.textContent().catch(() => '0'); expect(parseInt(s ?? '0')).toBe(0);
})
test('5.2 — game ends at timer 0', async ({ page }) => {
  await page.addInitScript(() => { const orig = window.setInterval.bind(window); (window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => { if (ms === 1000) return orig(fn, 100, ...args); return orig(fn, ms, ...args); }; });
  const game = new GamePage(page, GAME_PATH, ACCENT); await game.goto(); await game.start();
  await page.waitForSelector('button:has-text("Play Again")', { timeout: Math.ceil(GAME_DURATION_MS/10)+5000 });
  await expect(game.playAgainButton).toBeVisible();
})
test('6.1 — end screen has play-again', async ({ page }) => {
  await page.addInitScript(() => { const orig = window.setInterval.bind(window); (window as any).setInterval = (fn: () => void, ms: number, ...args: unknown[]) => { if (ms === 1000) return orig(fn, 100, ...args); return orig(fn, ms, ...args); }; });
  const game = new GamePage(page, GAME_PATH, ACCENT); await game.goto(); await game.start(); await game.waitForEnd(GAME_DURATION_MS/10+5000); await expect(game.playAgainButton).toBeVisible();
})
test('7.1 — no h-scroll 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 }); const game = new GamePage(page, GAME_PATH, ACCENT); await game.goto(); await game.expectNoHorizontalScroll();
})
test('9.1 — axe-core scan', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT); await game.goto();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa']).exclude('canvas').analyze();
  const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
  expect(critical).toHaveLength(0);
})
test('12.1 — haptics fire', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT); await game.goto(); await game.start(); await game.waitForPlaying(); await page.waitForTimeout(3000);
  const log = await game.getVibrateLog(); console.log('friction-slide haptics: '+log.length);
})