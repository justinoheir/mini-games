import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ 
  viewport: { width: 375, height: 812 },
  // Grant motion sensor permissions  
  permissions: ['accelerometer', 'gyroscope'],
  storageState: {
    cookies: [],
    origins: [{
      origin: 'http://localhost:3000',
      localStorage: [
        { name: 'mg_user', value: JSON.stringify({ name: 'Alex', avatar: '🎮' }) }
      ]
    }]
  }
});

// Grant deviceorientation
await ctx.grantPermissions(['accelerometer', 'gyroscope'], { origin: 'http://localhost:3000' }).catch(() => {});

const page = await ctx.newPage();
await page.goto('http://localhost:3000/games/balance-beam');
await page.waitForTimeout(1500);

// Dismiss SwipeInstructions by clicking Next 3 times
for (let i = 0; i < 3; i++) {
  const nextBtn = page.locator('button:has-text("Next")');
  if (await nextBtn.isVisible().catch(() => false)) {
    await nextBtn.click();
    await page.waitForTimeout(400);
  }
}
await page.waitForTimeout(800);
await page.screenshot({ path: 'tests/results/bb-start-actual.png' });
console.log('Screenshot 1: start screen (after swipe instructions)');

// Click "Allow Motion" / Start CTA
const ctaBtn = page.locator('[data-testid="start-cta"]');
if (await ctaBtn.isVisible().catch(() => false)) {
  await ctaBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/results/bb-countdown.png' });
  console.log('Screenshot 2: countdown');
  
  // Wait for playing phase
  await page.waitForTimeout(3500);
  await page.screenshot({ path: 'tests/results/bb-playing.png' });
  console.log('Screenshot 3: playing');
}

await browser.close();
console.log('Done');
