const { chromium, devices } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 14'] });
  
  // Pre-set localStorage to skip SwipeInstructions
  await context.addInitScript(() => {
    localStorage.setItem('seen_stack-drop', '1');
    localStorage.setItem('mg_user', JSON.stringify({ name: 'Justin', avatar: '🎮' }));
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://localhost:3000/games/stack-drop', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Screenshot 1: Start screen
  await page.screenshot({ path: 'tests/results/sd-start.png' });
  console.log('Screenshot 1: start screen');

  // Type name
  const nameInput = page.locator('input').first();
  if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await nameInput.fill('Justin');
    await page.waitForTimeout(400);
  }
  
  // Screenshot 2: Name entered
  await page.screenshot({ path: 'tests/results/sd-name-entered.png' });
  console.log('Screenshot 2: name entered');

  // Click CTA
  const ctaBtn = page.locator('[data-testid="start-cta"]').first();
  await ctaBtn.click({ force: true });
  await page.waitForTimeout(400);

  // Screenshot 3: Countdown
  await page.screenshot({ path: 'tests/results/sd-countdown.png' });
  console.log('Screenshot 3: countdown');

  // Wait for playing
  await page.waitForTimeout(3500);

  // Screenshot 4: Playing early
  await page.screenshot({ path: 'tests/results/sd-playing-early.png' });
  console.log('Screenshot 4: playing early');

  // Simulate some taps
  for (let i = 0; i < 4; i++) {
    await page.tap('canvas', { position: { x: 195, y: 500 } });
    await page.waitForTimeout(900);
  }
  
  // Screenshot 5: Playing active
  await page.screenshot({ path: 'tests/results/sd-playing-active.png' });
  console.log('Screenshot 5: playing active');

  // Speed up timer by overriding - use a separate page eval approach
  // Wait for game to end (45s game with 10x speed = ~4.5s but we just wait)
  // Actually let's just wait for it naturally to see if we can trigger end screen via JS
  await page.evaluate(() => {
    // Find and trigger the interval faster
  });

  console.log('Errors:', errors);
  await browser.close();
  console.log('Done');
})().catch(e => {
  console.error(e.message);
  process.exit(1);
});
