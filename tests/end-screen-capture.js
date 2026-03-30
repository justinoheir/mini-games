const { chromium, devices } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling']
  });
  const context = await browser.newContext({ 
    ...devices['iPhone 14'],
    serviceWorkers: 'block'
  });
  
  // Skip SwipeInstructions and pre-fill user
  await context.addInitScript(() => {
    localStorage.setItem('seen_stack-drop', '1');
    localStorage.setItem('mg_user', JSON.stringify({ name: 'Justin', avatar: '🧱' }));
    // Speed up timer 20x
    const orig = window.setInterval.bind(window);
    window.setInterval = function(fn, ms, ...args) {
      if (ms === 1000) return orig(fn, 50, ...args);
      return orig(fn, ms, ...args);
    };
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  
  await page.goto('http://localhost:3000/games/stack-drop', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(1500);
  
  // Screenshot: start screen
  await page.screenshot({ path: 'tests/results/sd-final-start.png' });
  console.log('Captured start screen');
  
  // Click CTA
  const cta = page.locator('[data-testid="start-cta"]').first();
  if (await cta.isVisible({ timeout: 3000 }).catch(() => false)) {
    await cta.click({ force: true });
  } else {
    // Try Continue button (returning user)
    const cont = page.locator('button:has-text("Continue")').first();
    if (await cont.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cont.click({ force: true });
    }
  }
  await page.waitForTimeout(500);
  
  // Screenshot: countdown
  await page.screenshot({ path: 'tests/results/sd-final-countdown.png' });
  console.log('Captured countdown');
  
  // Wait for playing phase (countdown = ~3s)
  await page.waitForTimeout(3500);
  await page.screenshot({ path: 'tests/results/sd-final-playing.png' });
  console.log('Captured playing phase');
  
  // Wait for game to end (with 20x timer, 60s game ends in ~3s)
  await page.waitForSelector('button:has-text("Play Again")', { timeout: 15000 });
  await page.waitForTimeout(500);
  
  // Screenshot: end screen
  await page.screenshot({ path: 'tests/results/sd-final-end.png' });
  console.log('Captured end screen');
  
  console.log('JS Errors:', errors);
  await browser.close();
  console.log('Done');
})().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
