const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ 
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    window.__DISABLE_AUDIO = true;
    localStorage.setItem('mg_user', JSON.stringify({ name: 'Test', avatar: '🎮', id: 'test', timestamp: Date.now(), consented: true }));
    localStorage.setItem('mg_last_player', JSON.stringify({ name: 'Test', avatar: '🎮' }));
    localStorage.setItem('seen_memory-grid', '1');
  });
  
  await page.goto('http://localhost:3000/games/memory-grid');
  await page.waitForLoadState('load');
  await page.waitForTimeout(1000);
  
  await page.screenshot({ path: 'tests/qa-screenshots/mg-01-start.png' });
  console.log('Shot 1: start screen');
  
  // Start game - click CTA
  const cta = page.locator('[data-testid="start-cta"]').first();
  const ctaVisible = await cta.isVisible().catch(() => false);
  if (ctaVisible) {
    await cta.click({ force: true });
  } else {
    await page.locator('button').filter({ hasText: /start/i }).first().click({ force: true });
  }
  await page.waitForTimeout(500);
  
  // Continue button (returning user flow)
  try {
    const cont = page.locator('[data-testid="reg-welcome-continue"]').first();
    if (await cont.isVisible({ timeout: 1500 })) {
      await cont.click({ force: true });
    }
  } catch(e) {}
  
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/qa-screenshots/mg-02-countdown.png' });
  console.log('Shot 2: countdown');
  
  // Wait for playing phase
  await page.waitForTimeout(4500);
  await page.screenshot({ path: 'tests/qa-screenshots/mg-03-playing-watch.png' });
  console.log('Shot 3: playing watch phase');
  
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'tests/qa-screenshots/mg-04-playing-recall.png' });
  console.log('Shot 4: playing recall phase');
  
  // Accelerate timer to see end screen
  await page.evaluate(() => {
    const orig = window.setInterval.bind(window);
    window.setInterval = function(fn, ms, ...args) {
      if (ms === 1000) return orig(fn, 50, ...args);
      return orig(fn, ms, ...args);
    };
  });
  
  await page.waitForTimeout(32000);
  await page.screenshot({ path: 'tests/qa-screenshots/mg-05-end.png' });
  console.log('Shot 5: end screen');
  
  await browser.close();
  console.log('All screenshots done');
})().catch(e => { console.error(e.message); process.exit(1); });
