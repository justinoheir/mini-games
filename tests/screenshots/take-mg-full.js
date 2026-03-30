const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.__DISABLE_AUDIO = true;
    // Skip all onboarding, instructions, consent
    localStorage.setItem('seen_memory-grid', '1');
    localStorage.setItem('mg_user', JSON.stringify({ name: 'TestUser', avatar: '🎮' }));
    localStorage.setItem('mg_consented', '1');
    localStorage.setItem('mg_tos', '1');
    // Speed up timer for endscreen
    const origSetInterval = window.setInterval.bind(window);
    window.setInterval = (fn, ms, ...args) => {
      if (ms === 1000) return origSetInterval(fn, 50, ...args);
      return origSetInterval(fn, ms, ...args);
    };
  });
  
  await page.goto('http://localhost:3000/games/memory-grid');
  await page.waitForTimeout(2000);
  
  // Screenshot start screen
  await page.screenshot({ path: 'tests/screenshots/mg-v2-start.png' });
  console.log('Start screen captured');
  
  // Click all buttons until we reach countdown  
  for (let i = 0; i < 8; i++) {
    const btn = page.locator('button').filter({ hasText: /start|play|begin|continue|agree|next/i }).first();
    const visible = await btn.isVisible().catch(() => false);
    if (visible) {
      console.log(`Clicking button attempt ${i+1}`);
      await btn.click();
      await page.waitForTimeout(500);
    }
    
    // Check if countdown appeared
    const countdown = await page.locator('[data-testid="countdown-display"]').isVisible().catch(() => false);
    if (countdown) {
      console.log('Countdown detected!');
      await page.screenshot({ path: 'tests/screenshots/mg-v2-countdown.png' });
      break;
    }
    
    await page.screenshot({ path: `tests/screenshots/mg-v2-step${i}.png` });
  }
  
  // Wait for playing phase (countdown completes in ~2.5s)
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'tests/screenshots/mg-v2-playing.png' });
  console.log('Playing captured');
  
  // Wait for end screen with faster timer
  await page.waitForSelector('[data-testid="end-screen"], button:has-text("Play")', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'tests/screenshots/mg-v2-end.png' });
  console.log('End screen captured');
  
  await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
