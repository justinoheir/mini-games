const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.__DISABLE_AUDIO = true;
    localStorage.setItem('seen_memory-grid', '1');
    localStorage.setItem('mg_user', JSON.stringify({ name: 'TestUser', avatar: '🎮' }));
    // Speed up timer
    const origSetInterval = window.setInterval.bind(window);
    window.setInterval = (fn, ms, ...args) => {
      if (ms === 1000) return origSetInterval(fn, 50, ...args);
      return origSetInterval(fn, ms, ...args);
    };
  });
  
  await page.goto('http://localhost:3000/games/memory-grid');
  await page.waitForTimeout(2000);
  
  // Force-click start button
  await page.locator('[data-testid="start-cta"]').click({ force: true });
  await page.waitForTimeout(500);
  
  // May hit welcome-back screen
  const contBtn = page.locator('button:has-text("Continue")');
  if (await contBtn.isVisible().catch(() => false)) {
    await contBtn.click({ force: true });
    await page.waitForTimeout(500);
  }
  
  // Screenshot countdown
  await page.screenshot({ path: 'tests/screenshots/mg-phase-countdown.png' });
  console.log('Countdown captured');
  
  // Wait for playing phase
  await page.waitForTimeout(4500);
  await page.screenshot({ path: 'tests/screenshots/mg-phase-playing.png' });
  console.log('Playing captured');
  
  // Game will end faster with sped-up timer (60 * 50ms = 3s)
  await page.waitForTimeout(6000);
  await page.screenshot({ path: 'tests/screenshots/mg-phase-end.png' });
  console.log('End screen captured');
  
  await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
