const { chromium, devices } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const iPhone = devices['iPhone 14'];
  const context = await browser.newContext({ ...iPhone });
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    (window).__DISABLE_AUDIO = true;
    localStorage.setItem('seen_tunnel', '1');
    localStorage.setItem('mg_user', JSON.stringify({
      name: 'QA Tester', avatar: '🎮', id: 'qa-test', timestamp: Date.now(), consented: true
    }));
    // Accelerate timer: 40ms instead of 1000ms  
    const orig = window.setInterval.bind(window);
    window.setInterval = (fn, ms, ...args) => {
      if (ms === 1000) return orig(fn, 40, ...args);
      return orig(fn, ms, ...args);
    };
  });
  
  await page.goto('http://localhost:3000/games/tunnel');
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);
  
  // Start the game
  const startBtn = page.locator('[data-testid="start-cta"]').or(
    page.locator('button').filter({ hasText: /launch|start|play/i })
  ).first();
  await startBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
  
  const continueBtnById = page.locator('[data-testid="reg-welcome-continue"]');
  const continueBtnByText = page.locator('button').filter({ hasText: /^continue/i }).first();
  const continueLocator = continueBtnById.or(continueBtnByText).first();
  try { await continueLocator.click({ force: true, timeout: 2000 }); } catch {}
  await page.waitForTimeout(300);

  const consentBtn = page.locator('[data-testid="reg-consent-agree"]').or(
    page.locator('button').filter({ hasText: /agree.*play/i })).first();
  try { await consentBtn.click({ force: true, timeout: 1000 }); } catch {}
  await page.waitForTimeout(1000);

  // Wait for countdown + game to start
  await page.waitForTimeout(5000);
  
  // Wait for end screen (at 40ms per tick, 60 ticks = 2.4s)
  await page.waitForSelector('button:has-text("Play Again")', { timeout: 15000 });
  await page.waitForTimeout(800);
  
  await page.screenshot({ path: 'tests/screenshots/tunnel-qa-endscreen.png', fullPage: false });
  console.log('End screen screenshot taken!');
  
  await browser.close();
})();
