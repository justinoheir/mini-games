const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ 
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript(() => {
    localStorage.setItem('seen_crowd-roar', '1');
    localStorage.setItem('mg_user', JSON.stringify({ name: 'TestUser', avatar: '🎮' }));
    window.__DISABLE_AUDIO = true;
    // Mock microphone
    const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints && constraints.audio) {
        return { getTracks: () => [{ stop: () => {} }] };
      }
      return origGetUserMedia(constraints);
    };
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3000/games/crowd-roar');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'tests/screenshots/crowd-roar-start-clean.png' });
  
  // Click Continue (returning user screen) or the main CTA
  const continueBtn = page.locator('button').filter({ hasText: /continue/i }).first();
  const hasContinue = await continueBtn.isVisible().catch(() => false);
  if (hasContinue) {
    await continueBtn.click();
    await page.waitForTimeout(1000);
  }
  
  await page.screenshot({ path: 'tests/screenshots/crowd-roar-start-clean2.png' });
  
  // Click the main CTA (Allow Mic & Start)
  const cta = page.locator('button').filter({ hasText: /allow|start/i }).first();
  await cta.click().catch(async () => {
    const btns = await page.locator('button').all();
    if (btns.length > 0) await btns[0].click();
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'tests/screenshots/crowd-roar-permission.png' });
  
  // Click allow on permission screen
  const allowBtn = page.locator('button').filter({ hasText: /^allow/i }).first();
  await allowBtn.click().catch(() => {});
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'tests/screenshots/crowd-roar-gameplay.png' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'tests/screenshots/crowd-roar-gameplay2.png' });
  
  // Speed up timer and wait for end screen
  await page.addInitScript(() => {
    const orig = window.setInterval.bind(window);
    window.setInterval = (fn, ms, ...args) => {
      if (ms === 1000) return orig(fn, 100, ...args);
      return orig(fn, ms, ...args);
    };
  });
  await page.waitForSelector('button:has-text("Play Again")', { timeout: 10000 }).catch(() => {});
  await page.screenshot({ path: 'tests/screenshots/crowd-roar-endscreen.png' });
  
  await browser.close();
  console.log('Screenshots taken');
})();
