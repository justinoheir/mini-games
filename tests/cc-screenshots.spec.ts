import { test } from '@playwright/test';
import { GamePage } from './pages/GamePage';

const GAME_PATH = '/games/color-cascade';
const ACCENT = '#f43f5e';
const BASE_URL = 'http://localhost:3000';
const GAME_DURATION_MS = 45000;

test('capture screenshots', async ({ page }) => {
  // Inject localStorage keys before page loads
  await page.addInitScript(() => {
    localStorage.setItem('seen_color-cascade', '1');
    window.__DISABLE_AUDIO = true;
    // Speed up timer 10x
    const origSetInterval = window.setInterval.bind(window);
    (window as any).setInterval = (fn: () => void, ms: number, ...args: any[]) => {
      if (ms === 1000) return origSetInterval(fn, 100, ...args);
      return origSetInterval(fn, ms, ...args);
    };
  });

  const game = new GamePage(page, GAME_PATH, ACCENT, BASE_URL);
  await game.goto({ skipUser: false });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/results/cc-start.png', fullPage: false });

  await game.start();
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'tests/results/cc-countdown.png', fullPage: false });

  await game.waitForPlaying();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'tests/results/cc-playing.png', fullPage: false });

  await game.waitForEnd(GAME_DURATION_MS / 10 + 8000);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/results/cc-end.png', fullPage: false });
  
  console.log('All screenshots saved!');
});
