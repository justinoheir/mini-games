import { chromium, devices } from 'playwright';

const browser = await chromium.launch({ 
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling']
});
const ctx = await browser.newContext({ 
  ...devices['iPhone 14'],
  locale: 'en-US',
  storageState: undefined,
});
const page = await ctx.newPage();

// Intercept setInterval to speed up timer
await page.addInitScript(() => {
  const orig = window.setInterval.bind(window);
  window.setInterval = (fn, ms, ...args) => {
    if (ms === 1000) return orig(fn, 100, ...args);
    return orig(fn, ms, ...args);
  };
  // Disable audio
  window.__DISABLE_AUDIO = true;
});

await page.goto('http://localhost:3000/games/symbol-scan', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

// Screenshot 1: Instructions overlay (step 1)
await page.screenshot({ path: 'tests/results/ss-qa-1-instructions.png' });

// Navigate through all instruction steps
for (let i = 0; i < 4; i++) {
  // Look for Next or Play button
  const btn = page.locator('button').filter({ hasText: /next|play|got it/i }).first();
  if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await btn.click({ force: true });
    await page.waitForTimeout(300);
  }
}

await page.waitForTimeout(500);
// Screenshot 2: Start screen (after instructions dismissed)
await page.screenshot({ path: 'tests/results/ss-qa-2-start.png' });

// Enter player name if visible
const nameInput = page.locator('input').first();
if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
  await nameInput.click({ force: true });
  await nameInput.fill('QA Tester');
}

// Click Start button (use data-testid)
await page.locator('[data-testid="start-cta"]').click({ force: true });
await page.waitForTimeout(600);

// Screenshot 3: Countdown
await page.screenshot({ path: 'tests/results/ss-qa-3-countdown.png' });

await page.waitForTimeout(3000);
// Screenshot 4: Playing phase (early)
await page.screenshot({ path: 'tests/results/ss-qa-4-playing.png' });

await page.waitForTimeout(3000);
// Screenshot 5: Playing mid-game
await page.screenshot({ path: 'tests/results/ss-qa-5-playing-mid.png' });

// Wait for game to end (10x timer speed so ~45/10 = ~4.5s total)
await page.waitForSelector('button:has-text("Play Again")', { timeout: 15000 });
// Screenshot 6: End screen
await page.screenshot({ path: 'tests/results/ss-qa-6-end.png' });

await browser.close();
console.log('All screenshots captured!');
