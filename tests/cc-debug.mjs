// Debug script - check timer state
import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:3001';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

await context.addInitScript(() => {
  localStorage.setItem('seen_color-cascade', '1');
  localStorage.setItem('mg_user', JSON.stringify({ name: 'TestUser', avatar: '🎮', consented: true }));
  const origSetInterval = window.setInterval.bind(window);
  window.setInterval = (fn, ms, ...args) => {
    if (ms === 1000) {
      console.log('[TIMER-OVERRIDE] setInterval 1000ms -> 100ms');
      return origSetInterval(fn, 100, ...args);
    }
    return origSetInterval(fn, ms, ...args);
  };
});

const page = await context.newPage();
const logs = [];
page.on('console', msg => {
  if (msg.text().includes('TIMER')) logs.push(msg.text());
});

await page.goto(BASE_URL + '/games/color-cascade');
await page.waitForLoadState('load');
await page.waitForTimeout(1500);

const cta = page.locator('[data-testid="start-cta"]').first();
await cta.click({ force: true });
console.log('Clicked start at t=0');

// Wait 12 seconds and check state
await page.waitForTimeout(12000);

// Check what's on screen
const bodyText = await page.locator('body').textContent();
const timerEl = page.locator('[data-testid="timer"]');
const timerVisible = await timerEl.isVisible().catch(() => false);
const timerValue = timerVisible ? await timerEl.getAttribute('data-value').catch(() => 'N/A') : 'N/A';

console.log('Timer logs:', logs.join(', '));
console.log('Timer visible:', timerVisible);
console.log('Timer value after 12s:', timerValue);
console.log('Phase (body text snippet):', bodyText?.substring(0, 150));

const endScreen = await page.locator('[data-testid="end-screen"]').isVisible().catch(() => false);
const playAgain = await page.locator('button:has-text("Play Again")').isVisible().catch(() => false);
console.log('End screen visible:', endScreen);
console.log('Play Again button visible:', playAgain);

await page.screenshot({ path: 'tests/results/cc-debug-12s.png', fullPage: false });
console.log('Debug screenshot saved');

await browser.close();
