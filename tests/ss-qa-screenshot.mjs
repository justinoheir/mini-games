import { chromium, devices } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 14'] });
const page = await ctx.newPage();

await page.goto('http://localhost:3000/games/symbol-scan', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.screenshot({ path: 'tests/results/ss-qa-1-instructions.png' });

// Dismiss SwipeInstructions by clicking through all steps
// SwipeInstructions has "Next" or "Got it" buttons
for (let i = 0; i < 5; i++) {
  const nextBtn = page.locator('button').filter({ hasText: /next|got it|done/i }).first();
  if (await nextBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await nextBtn.click();
    await page.waitForTimeout(400);
  } else {
    break;
  }
}

await page.screenshot({ path: 'tests/results/ss-qa-2-start.png' });

// Fill name 
const nameInput = page.locator('input').first();
if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
  await nameInput.fill('QA Tester');
}

// Click Start using force (avoid intercept issues)
const ctaBtn = page.locator('[data-testid="start-cta"]').first();
await ctaBtn.click({ force: true });
await page.waitForTimeout(800);
await page.screenshot({ path: 'tests/results/ss-qa-3-countdown.png' });

await page.waitForTimeout(3000);
await page.screenshot({ path: 'tests/results/ss-qa-4-playing.png' });

// Wait a bit more and take another screenshot
await page.waitForTimeout(8000);
await page.screenshot({ path: 'tests/results/ss-qa-5-playing-mid.png' });

await browser.close();
console.log('Screenshots done!');
