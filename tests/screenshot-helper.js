const { chromium, devices } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await context.newPage();
  await page.goto('http://localhost:3000/games/stack-drop', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Phase 1: SwipeInstructions screen
  await page.screenshot({ path: 'tests/results/sd-1-swipe-instructions.png' });

  // Dismiss swipe instructions
  for (let i = 0; i < 3; i++) {
    try {
      const nextBtn = page.locator('button').filter({ hasText: /Next|Done|Play/ }).first();
      if (await nextBtn.isVisible({ timeout: 1000 })) {
        await nextBtn.click();
        await page.waitForTimeout(600);
      }
    } catch(e) {}
  }
  await page.waitForTimeout(800);

  // Phase 2: Game start screen
  await page.screenshot({ path: 'tests/results/sd-2-game-start.png' });

  // Type a name
  const nameInput = page.locator('input[type="text"], input[placeholder]').first();
  if (await nameInput.isVisible({ timeout: 2000 })) {
    await nameInput.fill('Justin');
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: 'tests/results/sd-3-name-entered.png' });

  // Click start
  const startBtn = page.locator('button').filter({ hasText: /Drop In|Play|Start/ }).first();
  if (await startBtn.isVisible({ timeout: 2000 })) {
    await startBtn.click();
    await page.waitForTimeout(300);
  }

  // Phase 3: Countdown
  await page.screenshot({ path: 'tests/results/sd-4-countdown.png' });
  await page.waitForTimeout(2500);

  // Phase 4: Playing
  await page.screenshot({ path: 'tests/results/sd-5-playing.png' });

  // Simulate some taps
  for (let i = 0; i < 5; i++) {
    await page.tap('canvas', { position: { x: 195, y: 400 } });
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: 'tests/results/sd-6-playing-active.png' });

  await browser.close();
  console.log('Screenshots done');
})().catch(e => console.error(e.message));
