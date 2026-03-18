const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    permissions: ['microphone'],
    viewport: { width: 390, height: 844 }
  });
  const page = await context.newPage();
  
  // Disable audio + mock mic + speed up timer for end screen
  await page.addInitScript(() => {
    window.__DISABLE_AUDIO = true;
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => {} }],
          getAudioTracks: () => [],
        })
      },
      configurable: true
    });
    // Speed up timer 20x 
    const orig = window.setInterval.bind(window);
    window.setInterval = (fn, ms, ...args) => {
      if (ms === 1000) return orig(fn, 50, ...args);
      return orig(fn, ms, ...args);
    };
  });
  
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  
  await page.goto('http://localhost:3000/games/whisper-bomb', { timeout: 30000 });
  await page.waitForTimeout(2000);
  
  // Screenshot start screen
  await page.screenshot({ path: 'tests/screenshots/wb-1-start.png' });
  console.log('1. Start screen OK');
  
  // Click CTA
  const cta = page.locator('[data-testid="start-cta"]');
  await cta.waitFor({ timeout: 5000 });
  await cta.click();
  await page.waitForTimeout(600);
  
  // Step 1: First name
  await page.fill('[data-testid="reg-input"]', 'QA');
  await page.click('[data-testid="reg-advance"]');
  await page.waitForTimeout(400);
  
  // Step 2: Last name
  await page.fill('[data-testid="reg-input"]', 'Tester');
  await page.click('[data-testid="reg-advance"]');
  await page.waitForTimeout(400);
  
  // Step 3: Email
  await page.fill('[data-testid="reg-input"]', 'qa@test.com');
  await page.click('[data-testid="reg-advance"]');
  await page.waitForTimeout(400);
  
  // Step 4: Consent
  await page.click('[data-testid="reg-consent-agree"]');
  await page.waitForTimeout(500);
  
  // Now we should be in countdown
  await page.screenshot({ path: 'tests/screenshots/wb-2-countdown.png' });
  console.log('2. Countdown screenshot');
  
  // Wait for playing phase
  await page.waitForTimeout(3500);
  await page.screenshot({ path: 'tests/screenshots/wb-3-playing.png' });
  console.log('3. Playing screenshot');
  
  // Wait for end screen (timer at 20x speed: 30s * 50ms = 1.5s + buffer)
  await page.waitForSelector('[data-testid="end-screen"]', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/screenshots/wb-4-endscreen.png' });
  console.log('4. End screen screenshot');
  
  if (errors.length > 0) {
    console.log('JS ERRORS:', errors.join('; '));
  } else {
    console.log('No JS errors during run');
  }
  
  await browser.close();
  console.log('All screenshots done');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
