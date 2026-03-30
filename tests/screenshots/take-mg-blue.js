const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  
  // Capture console to debug accent color
  page.on('console', msg => {
    if (msg.type() === 'log') console.log('PAGE:', msg.text());
    if (msg.type() === 'error') console.error('PAGE ERROR:', msg.text());
  });
  
  await page.addInitScript(() => {
    window.__DISABLE_AUDIO = true;
    window.__errors = [];
    localStorage.setItem('mg_user', JSON.stringify({
      name: 'Alex', avatar: '🎮', id: 'test-001', timestamp: Date.now(), consented: true
    }));
    localStorage.setItem('mg_last_player', JSON.stringify({ name: 'Alex', avatar: '🎮' }));
    localStorage.setItem('seen_memory-grid', '1');
    // Speed up timer for end screen
    const origSetInterval = window.setInterval.bind(window);
    window.setInterval = (fn, ms, ...args) => {
      if (ms === 1000) return origSetInterval(fn, 50, ...args);
      return origSetInterval(fn, ms, ...args);
    };
  });
  
  // No-cache headers
  await page.goto('http://localhost:3000/games/memory-grid', {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(3000);  // Wait for React hydration + theme effects
  
  // Debug: check what accent color is applied
  const accent = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="start-cta"]');
    return btn ? window.getComputedStyle(btn).backgroundColor : 'NOT FOUND';
  });
  console.log('CTA button background:', accent);
  
  await page.screenshot({ path: 'tests/screenshots/blue-start.png' });
  console.log('Start captured');
  
  // Click start
  await page.locator('[data-testid="start-cta"]').click({ force: true });
  await page.waitForTimeout(400);
  
  // Click continue (welcome back)
  const continueBtn = page.locator('[data-testid="reg-welcome-continue"]').or(
    page.locator('button').filter({ hasText: /^continue/i })
  ).first();
  if (await continueBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await continueBtn.click({ force: true });
    await page.waitForTimeout(400);
  }
  
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'tests/screenshots/blue-countdown.png' });
  console.log('Countdown captured');
  
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'tests/screenshots/blue-playing.png' });
  console.log('Playing captured');
  
  await page.waitForSelector('button:has-text("Play Again")', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/screenshots/blue-end.png' });
  console.log('End captured');
  
  await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
