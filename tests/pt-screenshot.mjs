import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const ctx = await browser.newContext({ 
  viewport: { width: 390, height: 844 }, 
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  storageState: {
    cookies: [],
    origins: [{
      origin: 'http://localhost:3000',
      localStorage: [
        { name: 'seen_path-trace', value: '1' },
        { name: 'mg_user', value: JSON.stringify({ name: 'Alex', avatar: '✏️' }) }
      ]
    }]
  }
});
const page = await ctx.newPage();

await page.goto('http://localhost:3000/games/path-trace', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: 'tests/results/pt-2-start.png' });
console.log('2. Start screen');

// Helper: click any visible button matching a pattern
async function clickBtn(pattern) {
  for (let i = 0; i < 8; i++) {
    const btn = page.locator('button').filter({ hasText: pattern }).first();
    const visible = await btn.isVisible({ timeout: 800 }).catch(() => false);
    if (visible) {
      await btn.click({ force: true });
      await page.waitForTimeout(400);
      return true;
    }
    await page.waitForTimeout(300);
  }
  return false;
}

// Step through all pre-game screens: Start → Continue → I Agree & Play → countdown
await clickBtn(/start/i);
await page.waitForTimeout(400);
await clickBtn(/continue/i);
await page.waitForTimeout(400);
await clickBtn(/agree/i);
await page.waitForTimeout(600);

await page.screenshot({ path: 'tests/results/pt-4-countdown.png' });
console.log('4. Countdown');

// Wait for countdown to finish (3+2+1+GO = ~2s)
await page.waitForTimeout(3200);
await page.screenshot({ path: 'tests/results/pt-5-playing.png' });
console.log('5. Playing');

await page.waitForTimeout(5000);
await page.screenshot({ path: 'tests/results/pt-6-playing-mid.png' });
console.log('6. Playing mid');

await browser.close();
console.log('Done');
