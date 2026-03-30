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
    const orig = window.setInterval;
    window.setInterval = (fn, ms, ...args) => {
      if (ms === 1000) return orig(fn, 100, ...args);
      return orig(fn, ms, ...args);
    };
  });
  await page.goto('http://localhost:3000/games/memory-grid');
  await page.waitForTimeout(2000);
  
  // Look for and click continue or start button
  const startBtn = page.locator('[data-testid="start-cta"], button').filter({ hasText: /start|play|begin|continue/i }).first();
  await startBtn.click().catch(e => console.log('start click error:', e.message));
  await page.waitForTimeout(500);
  
  // Check what page we're on
  const pageContent = await page.textContent('body').catch(() => '');
  console.log('After first click, body has:', pageContent.substring(0, 200));
  
  // If on welcome-back screen, click continue
  if (pageContent.includes('Welcome back') || pageContent.includes('Continue')) {
    await page.click('button:has-text("Continue")').catch(() => {});
    await page.waitForTimeout(500);
  }
  
  await page.screenshot({ path: 'tests/screenshots/mg-countdown2.png' });
  console.log('Countdown snapshot done');
  
  // Wait for countdown to finish (3+2+1+GO ~2.5s)
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'tests/screenshots/mg-playing2.png' });
  console.log('Playing snapshot done');
  
  // Wait for game to end
  await page.waitForSelector('button:has-text("Play Again"), button:has-text("Play again")', { timeout: 30000 });
  await page.screenshot({ path: 'tests/screenshots/mg-endscreen.png' });
  console.log('End screen snapshot done');
  
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
