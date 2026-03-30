const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ 
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    window.__DISABLE_AUDIO = true;
    class MockDME extends Event {
      static requestPermission() { return Promise.resolve('granted'); }
      constructor(type, init) {
        super(type, init);
        this.accelerationIncludingGravity = { x: 0, y: 0, z: 9.8 };
        this.interval = 16;
      }
    }
    window.DeviceMotionEvent = MockDME;
    navigator.vibrate = () => true;
    localStorage.setItem('mg_user', JSON.stringify({ name: 'QA Tester', avatar: '🎮', id: 'qa-001', consented: true }));
    // Speed up timer
    const orig = window.setInterval.bind(window);
    window.setInterval = function(fn, ms, ...args) {
      if (ms === 1000) return orig(fn, 80, ...args);
      return orig(fn, ms, ...args);
    };
    // Fire motion events
    const fire = () => { try { window.dispatchEvent(new MockDME('devicemotion')); } catch(e) {} setTimeout(fire, 16); };
    setTimeout(fire, 100);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Screenshot 1: SwipeInstructions
  await page.goto('http://localhost:3000/games/steady-hand');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'tests/results/ss-1-instructions.png' });
  console.log('1. instructions');

  // Dismiss instructions
  for (let i = 0; i < 3; i++) {
    const btn = page.locator('button:has-text("Next"), button:has-text("Play")').first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(350);
    }
  }
  await page.waitForTimeout(600);

  // ──────────────────────────────────────────────────────────────────────────
  // Screenshot 2: Start Screen
  await page.screenshot({ path: 'tests/results/ss-2-start.png' });
  console.log('2. start screen');

  // Click CTA
  const cta = page.locator('[data-testid="start-cta"]').first();
  await cta.click({ force: true });
  await page.waitForTimeout(800);
  
  // Continue if needed
  const continueBtn = page.locator('[data-testid="reg-welcome-continue"], button:has-text("Continue")').first();
  if (await continueBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await continueBtn.click({ force: true });
    await page.waitForTimeout(400);
  }
  const agreeBtn = page.locator('[data-testid="reg-consent-agree"]').first();
  if (await agreeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await agreeBtn.click({ force: true });
    await page.waitForTimeout(400);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Screenshot 3: Countdown
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'tests/results/ss-4-countdown.png' });
  console.log('3. countdown');

  // Wait for playing
  await page.waitForTimeout(3000);
  // ──────────────────────────────────────────────────────────────────────────
  // Screenshot 4: Playing
  await page.screenshot({ path: 'tests/results/ss-5-playing.png' });
  console.log('4. playing');

  // Wait for end screen (45s / 12x = 3.75s + buffer)
  try {
    await page.waitForSelector('button:has-text("Play Again")', { timeout: 20000 });
    await page.waitForTimeout(1500);
    // ──────────────────────────────────────────────────────────────────────
    // Screenshot 5: End Screen
    await page.screenshot({ path: 'tests/results/ss-6-end.png' });
    console.log('5. end screen');
  } catch(e) {
    console.log('end screen not reached:', e.message.slice(0, 80));
    await page.screenshot({ path: 'tests/results/ss-6-timeout.png' });
  }

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
