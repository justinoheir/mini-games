// Quick visual capture script for Path Trace QA
const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  const BASE = 'http://localhost:3001';

  // 1. First screenshot - name input phase
  await page.goto(BASE + '/games/path-trace');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'qa-1-name-input.png' });
  console.log('1. Name input captured');

  // Pre-populate mg_user to skip the name form
  await page.evaluate(() => {
    localStorage.setItem('mg_user', JSON.stringify({
      firstName: 'Alex',
      lastName: 'Test',
      email: 'alex@test.com',
      name: 'Alex Test',
      avatar: '✏️',
      id: 'qa-test-user',
    }));
  });

  // 2. Reload to get start screen (returning user, skips form)
  await page.reload();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'qa-2-start-screen.png' });
  console.log('2. Start screen captured');

  // 3. Tap start/continue
  try {
    // Click Continue on returning user screen
    const continueBtn = await page.locator('button:has-text("Continue"), button:has-text("Start")').first();
    await continueBtn.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'qa-3-after-name-start.png' });
    console.log('3. After start click captured');
  } catch (e) {
    console.log('Could not click start:', e.message);
  }

  // 4. Wait for game start screen then click Start
  try {
    const startBtn = await page.locator('button:has-text("Start")').first();
    await startBtn.waitFor({ timeout: 3000 });
    await page.screenshot({ path: 'qa-4-game-start.png' });
    console.log('4. Game start screen captured');
    await startBtn.click();
  } catch (e) {
    console.log('Could not find Start button:', e.message);
  }

  // 5. Countdown phase
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'qa-5-countdown.png' });
  console.log('5. Countdown captured');

  // 6. Playing phase (wait for GO to complete + small delay)
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'qa-6-playing.png' });
  console.log('6. Playing phase captured');

  // 7. Speed up timer and get end screen
  await page.evaluate(() => {
    const orig = window.setInterval.bind(window);
    window.setInterval = (fn, ms, ...args) => {
      if (ms === 1000) return orig(fn, 100, ...args);
      return orig(fn, ms, ...args);
    };
  });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'qa-7-end-screen.png' });
  console.log('7. End screen captured');

  console.log('\nJS Errors:', errors.length ? errors : 'None');
  await browser.close();
})();
