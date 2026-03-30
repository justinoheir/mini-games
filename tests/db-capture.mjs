import { chromium } from '@playwright/test';
import path from 'path';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});

const page = await context.newPage();

// Inject motion permission + mock orientation
await page.addInitScript(() => {
  window.__DISABLE_AUDIO = true;
  class MockDOE extends Event {
    static requestPermission() { return Promise.resolve('granted'); }
    alpha = 0; beta = 0; gamma = 5;
    absolute = false;
  }
  window.DeviceOrientationEvent = MockDOE;
});

await page.goto('http://localhost:3000/games/dodge-blitz');
await page.waitForTimeout(2000);
await page.screenshot({ path: 'results/db-01-start.png' });
console.log('01 start screen');

// Dismiss swipe instructions if showing
const gotIt = page.locator('button').filter({ hasText: /got it|continue|ready|skip/i }).first();
const isGotIt = await gotIt.isVisible({ timeout: 1000 }).catch(() => false);
if (isGotIt) {
  // Click through all swipe steps
  for (let i = 0; i < 3; i++) {
    const btn = page.locator('button').filter({ hasText: /next|got it|continue|skip|start/i }).first();
    const vis = await btn.isVisible({ timeout: 500 }).catch(() => false);
    if (vis) { await btn.click(); await page.waitForTimeout(400); }
  }
  await page.screenshot({ path: 'results/db-01b-after-swipe.png' });
  console.log('01b after swipe instructions');
}

// Fill name
const nameInput = page.locator('input').first();
const nameVis = await nameInput.isVisible({ timeout: 1000 }).catch(() => false);
if (nameVis) {
  await nameInput.fill('QATester');
  await page.screenshot({ path: 'results/db-01c-name-entered.png' });
  console.log('01c name entered');
}

// Click start
const cta = page.locator('[data-testid="start-cta"], button').filter({ hasText: /start/i }).first();
await cta.click({ force: true });
await page.waitForTimeout(600);
await page.screenshot({ path: 'results/db-02-countdown.png' });
console.log('02 countdown');

await page.waitForTimeout(3200);
await page.screenshot({ path: 'results/db-03-playing-early.png' });
console.log('03 playing early');

await page.waitForTimeout(5000);
await page.screenshot({ path: 'results/db-04-playing-mid.png' });
console.log('04 playing mid');

await browser.close();
console.log('Done!');
