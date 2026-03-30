const { chromium, devices } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling']
  });
  const context = await browser.newContext({ 
    ...devices['iPhone 14'],
  });
  
  // Skip SwipeInstructions only; let user enter name naturally
  await context.addInitScript(() => {
    localStorage.setItem('seen_stack-drop', '1');
    // Speed up timer 20x once game starts
    const origSetInterval = window.setInterval.bind(window);
    window.setInterval = function(fn, ms, ...args) {
      if (ms === 1000) return origSetInterval(fn, 50, ...args);
      return origSetInterval(fn, ms, ...args);
    };
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  
  await page.goto('http://localhost:3000/games/stack-drop', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);
  
  // Screenshot: start screen
  await page.screenshot({ path: 'tests/results/sd2-start.png' });
  console.log('Screenshot: start screen');
  
  // Enter name
  const nameInput = page.locator('input').first();
  if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await nameInput.click({ force: true });
    await nameInput.fill('Justin');
    await page.waitForTimeout(300);
    console.log('Name entered');
  } else {
    console.log('No name input found');
  }
  
  await page.screenshot({ path: 'tests/results/sd2-name.png' });
  
  // Click ANY button that starts the game
  const allBtns = await page.locator('button').all();
  console.log('Buttons found:', allBtns.length);
  for (const btn of allBtns) {
    const txt = await btn.textContent().catch(() => '');
    console.log(' - Button:', txt.trim().substring(0, 30));
  }
  
  // Try the start button
  const startBtn = page.locator('[data-testid="start-cta"]').first();
  const isVisible = await startBtn.isVisible({ timeout: 2000 }).catch(() => false);
  console.log('start-cta visible:', isVisible);
  
  if (isVisible) {
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="start-cta"]');
      if (btn) btn.click();
    });
    console.log('Clicked via evaluate');
  }
  
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'tests/results/sd2-countdown.png' });
  console.log('Screenshot: countdown');
  
  // Wait for playing (countdown ~2.5s)
  await page.waitForTimeout(3500);
  await page.screenshot({ path: 'tests/results/sd2-playing.png' });
  console.log('Screenshot: playing');
  
  // Wait for end screen (game = 60 ticks × 50ms = 3s)
  try {
    await page.waitForSelector('button:has-text("Play Again")', { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tests/results/sd2-end.png' });
    console.log('Screenshot: end screen');
  } catch(e) {
    await page.screenshot({ path: 'tests/results/sd2-end-timeout.png' });
    console.log('End screen timeout - captured current state');
  }
  
  console.log('JS Errors:', errors);
  await browser.close();
})().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
