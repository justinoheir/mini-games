import { chromium, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(__dirname, 'screenshots');
mkdirSync(screenshotDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ...devices['iPhone 14'],
  permissions: ['microphone'],
});
const page = await context.newPage();
await page.goto('http://localhost:3000/games/pulse-sphere');
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(screenshotDir, 'ps-01-load.png'), fullPage: false });
console.log('Screenshot 1: initial load');

// Try to dismiss SwipeInstructions
let onGameStart = false;
try {
  // Look for a Next or Skip button  
  const nextBtn = page.locator('button').filter({ hasText: /next|skip|done|got it/i }).first();
  const isVisible = await nextBtn.isVisible({ timeout: 2000 }).catch(() => false);
  if (isVisible) {
    await nextBtn.click();
    await page.waitForTimeout(500);
    await nextBtn.click().catch(() => {});
    await page.waitForTimeout(500);
    await nextBtn.click().catch(() => {});
    await page.waitForTimeout(500);
    onGameStart = true;
  }
} catch {}
await page.screenshot({ path: path.join(screenshotDir, 'ps-02-start.png'), fullPage: false });
console.log('Screenshot 2: after swipe instructions');

// Start the game
try {
  const startBtn = page.locator('button').filter({ hasText: /begin|start|allow/i }).first();
  const isVisible = await startBtn.isVisible({ timeout: 2000 }).catch(() => false);
  if (isVisible) {
    await startBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(screenshotDir, 'ps-03-countdown.png'), fullPage: false });
    console.log('Screenshot 3: countdown');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(screenshotDir, 'ps-04-playing.png'), fullPage: false });
    console.log('Screenshot 4: playing');
  }
} catch (e) {
  console.log('Could not start game:', e.message);
}

// Fast-forward to end
await page.addInitScript(() => {});
try {
  // Trigger game end by fast-forwarding timer  
  await page.evaluate(() => {
    const orig = window.setInterval;
    // Already set - just wait
  });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(screenshotDir, 'ps-05-late-game.png'), fullPage: false });
  console.log('Screenshot 5: late game');
} catch {}

await browser.close();
console.log('Done! Screenshots saved to', screenshotDir);
