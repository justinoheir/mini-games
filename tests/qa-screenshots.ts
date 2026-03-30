import { chromium, devices } from 'playwright';
import path from 'path';
import fs from 'fs';

const BASE_URL = 'http://localhost:3000';
const GAME_ID = 'breath-rider';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    ...devices['iPhone 14'],
    permissions: ['microphone'],
  });
  const page = await ctx.newPage();
  
  // Clear localStorage so SwipeInstructions shows
  await page.goto(`${BASE_URL}/games/${GAME_ID}`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/01-swipe-instructions.png`, fullPage: false });
  console.log('1. SwipeInstructions screenshot');

  // Dismiss instructions
  await page.click('button:has-text("Next →")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Next →")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Play")');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/02-start-screen.png`, fullPage: false });
  console.log('2. Start screen screenshot');

  // Type a name
  const nameInput = page.locator('input[placeholder*="name"], input[type="text"]').first();
  if (await nameInput.isVisible()) {
    await nameInput.fill('QA Tester');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/03-name-entered.png`, fullPage: false });
    console.log('3. Name entered screenshot');
  }

  // Dismiss mic permission dialog and start - use click on CTA
  page.on('dialog', async dialog => {
    console.log('Dialog:', dialog.message());
    await dialog.dismiss();
  });
  
  const ctaBtn = page.locator('button').filter({ hasText: /allow|play|start/i }).first();
  if (await ctaBtn.isVisible()) {
    await ctaBtn.click();
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/04-countdown.png`, fullPage: false });
  console.log('4. Countdown screenshot');

  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/05-playing.png`, fullPage: false });
  console.log('5. Playing screenshot');

  await browser.close();
  console.log('Done!');
})();
