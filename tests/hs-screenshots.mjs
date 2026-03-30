import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const ctx = await browser.newContext({ 
  viewport: {width:390, height:844}, 
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
});
const page = await ctx.newPage();

await page.goto('http://localhost:3000/games/hoop-shot');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'tests/results/hs-p1-initial.png' });

// Dismiss swipe instructions if present (click anywhere on overlay)
await page.screenshot({ path: 'tests/results/hs-p1b-instructions.png' });
// Click the "Got it" or "Let's play" type buttons
const btns = await page.locator('button').all();
for (const b of btns) {
  const txt = await b.textContent().catch(() => '');
  if (/got it|let|play|ok|next|go/i.test(txt)) {
    await b.click({ force: true }).catch(() => {});
    break;
  }
}
await page.waitForTimeout(800);
await page.screenshot({ path: 'tests/results/hs-p2-start.png' });

// Enter name
const nameInput = page.locator('input').first();
if (await nameInput.isVisible().catch(() => false)) {
  await nameInput.fill('QA Test');
}

// Click start
const startBtn = page.locator('button').filter({ hasText: /start/i }).first();
if (await startBtn.isVisible().catch(() => false)) {
  await startBtn.click({ force: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/results/hs-p3-countdown.png' });
  await page.waitForTimeout(4500);
  await page.screenshot({ path: 'tests/results/hs-p4-playing.png' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'tests/results/hs-p5-playing-mid.png' });
}

// Accelerate timer to get to end screen
await page.evaluate(() => {
  window.__DISABLE_AUDIO = true;
});
// Force game to end by overriding interval
await page.evaluate(() => {
  window.dispatchEvent(new Event('game:force-end'));
});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'tests/results/hs-p6-end.png' });

await browser.close();
console.log('SCREENSHOTS DONE');
