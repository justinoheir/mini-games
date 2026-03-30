import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });

// First, capture start screen without timer acceleration
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    localStorage.setItem('seen_color-cascade', '1');
    localStorage.setItem('mg_user', JSON.stringify({ name: 'TestUser', avatar: '🎮' }));
    window.__DISABLE_AUDIO = true;
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3000/games/color-cascade');
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'tests/results/cc-start.png', fullPage: false });
  console.log('1. start screen saved');
  await context.close();
}

// Now capture countdown + playing + end with timer acceleration
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    localStorage.setItem('seen_color-cascade', '1');
    localStorage.setItem('mg_user', JSON.stringify({ name: 'TestUser', avatar: '🎮' }));
    window.__DISABLE_AUDIO = true;
    // Speed up timer 10x
    const origSetInterval = window.setInterval.bind(window);
    window.setInterval = (fn, ms, ...args) => {
      if (ms === 1000) return origSetInterval(fn, 100, ...args);
      return origSetInterval(fn, ms, ...args);
    };
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3000/games/color-cascade');
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);
  
  const cta = page.locator('[data-testid="start-cta"]').first();
  await cta.click({ force: true });
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'tests/results/cc-countdown.png', fullPage: false });
  console.log('2. countdown saved');

  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'tests/results/cc-playing.png', fullPage: false });
  console.log('3. playing saved');

  // The game should end in ~4.5s (45s at 10x). Wait up to 40s from game start.
  try {
    await page.waitForSelector('button:has-text("Play Again")', { timeout: 40000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'tests/results/cc-end.png', fullPage: false });
    console.log('4. end screen saved');
  } catch(e) {
    // Take screenshot anyway for debugging
    await page.screenshot({ path: 'tests/results/cc-end-debug.png', fullPage: false });
    console.log('End screen timeout - debug screenshot saved');
    // Get current page text to understand state
    const text = await page.locator('body').textContent();
    console.log('Page text preview:', text?.substring(0, 200));
  }
  await context.close();
}

await browser.close();
console.log('Done!');
