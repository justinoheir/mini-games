const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  
  await page.addInitScript(() => {
    window.__DISABLE_AUDIO = true;
    window.__errors = [];
    // Stored user with consent (bypasses all onboarding screens)
    localStorage.setItem('mg_user', JSON.stringify({
      name: 'Alex', avatar: '🎮', id: 'test-001', timestamp: Date.now(), consented: true
    }));
    localStorage.setItem('mg_last_player', JSON.stringify({ name: 'Alex', avatar: '🎮' }));
    localStorage.setItem('seen_memory-grid', '1');
    // Speed up timer: 60s * 50ms = 3s game
    const origSetInterval = window.setInterval.bind(window);
    window.setInterval = (fn, ms, ...args) => {
      if (ms === 1000) return origSetInterval(fn, 50, ...args);
      return origSetInterval(fn, ms, ...args);
    };
  });
  
  await page.goto('http://localhost:3000/games/memory-grid');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  
  // Screenshot start screen
  await page.screenshot({ path: 'tests/screenshots/final-start.png' });
  console.log('Start screen captured');
  
  // Click Start button
  await page.locator('[data-testid="start-cta"]').click({ force: true });
  await page.waitForTimeout(400);
  
  // Click Continue (welcome-back screen)
  const continueBtn = page.locator('[data-testid="reg-welcome-continue"]').or(
    page.locator('button').filter({ hasText: /^continue/i })
  ).first();
  if (await continueBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await continueBtn.click({ force: true });
    await page.waitForTimeout(400);
  }
  
  // Consent may appear, click it too
  const consentBtn = page.locator('button').filter({ hasText: /agree.*play|i agree/i }).first();
  if (await consentBtn.isVisible({ timeout: 600 }).catch(() => false)) {
    await consentBtn.click({ force: true });
    await page.waitForTimeout(400);
  }
  
  await page.waitForTimeout(800);
  
  // Should now be in countdown
  await page.screenshot({ path: 'tests/screenshots/final-countdown.png' });
  console.log('Countdown captured');
  
  // Wait for countdown to complete (3+2+1+GO ~2.5s)
  await page.waitForTimeout(3500);
  await page.screenshot({ path: 'tests/screenshots/final-playing.png' });
  console.log('Playing captured');
  
  // Game ends quickly with accelerated timer
  await page.waitForSelector('button:has-text("Play Again")', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/screenshots/final-end.png' });
  console.log('End screen captured');
  
  await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
