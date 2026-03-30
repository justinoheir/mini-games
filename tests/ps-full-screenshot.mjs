import { chromium, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(__dirname, 'screenshots');
mkdirSync(screenshotDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
});

const context = await browser.newContext({
  ...devices['iPhone 14'],
  permissions: ['microphone'],
});

// Speed up setInterval for faster game end
await context.addInitScript(() => {
  // Don't speed up - just grant mic permission
});

const page = await context.newPage();

// Suppress console errors
page.on('console', msg => {
  if (msg.type() === 'error') console.log('Console error:', msg.text());
});

await page.goto('http://localhost:3000/games/pulse-sphere');
await page.waitForTimeout(2000);

// Step through SwipeInstructions (3 pages)
console.log('Dismissing SwipeInstructions...');
for (let i = 0; i < 3; i++) {
  try {
    // Find Next or Play button
    const btn = page.locator('button').filter({ hasText: /^(Next →|Play)$/ }).first();
    await btn.waitFor({ state: 'visible', timeout: 3000 });
    if (i === 2) {
      await page.screenshot({ path: path.join(screenshotDir, 'ps-swipe-3.png') });
      console.log('Screenshot: swipe step 3 (voice page)');
    }
    await btn.click();
    await page.waitForTimeout(600);
  } catch(e) {
    console.log(`Step ${i}: ${e.message}`);
    break;
  }
}

await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(screenshotDir, 'ps-game-start.png') });
console.log('Screenshot: game start screen');

// Enter name
try {
  const nameInput = page.locator('input[placeholder*="name"], input[type="text"]').first();
  await nameInput.waitFor({ state: 'visible', timeout: 3000 });
  await nameInput.fill('QA Tester');
  await page.screenshot({ path: path.join(screenshotDir, 'ps-name-entered.png') });
  console.log('Screenshot: name entered');
} catch(e) {
  console.log('Name input:', e.message);
}

// Click CTA
try {
  const cta = page.locator('button').filter({ hasText: /allow|begin/i }).first();
  await cta.waitFor({ state: 'visible', timeout: 3000 });
  await cta.click();
  console.log('Clicked CTA');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(screenshotDir, 'ps-countdown.png') });
  console.log('Screenshot: countdown phase');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(screenshotDir, 'ps-playing.png') });
  console.log('Screenshot: playing phase');
} catch(e) {
  console.log('CTA click:', e.message);
  await page.screenshot({ path: path.join(screenshotDir, 'ps-after-cta.png') });
}

await browser.close();
console.log('Done!');
