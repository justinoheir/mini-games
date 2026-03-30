const { chromium, devices } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling']
  });
  const context = await browser.newContext({ ...devices['iPhone 14'] });
  
  await context.addInitScript(() => {
    localStorage.setItem('seen_stack-drop', '1');
    // Speed up timer 20x
    const origSetInterval = window.setInterval.bind(window);
    window.setInterval = function(fn, ms) {
      if (ms === 1000) return origSetInterval(fn, 50);
      return origSetInterval(fn, ms);
    };
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  
  await page.goto('http://localhost:3000/games/stack-drop', { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  // Screenshot the start screen
  await page.screenshot({ path: 'tests/results/cap3-start.png' });
  console.log('start captured');

  // Step 1: Find and click the startButton (what GamePage.ts calls it)
  // GamePage uses locator('[data-testid="start-cta"], button[aria-label*="play" i], button[aria-label*="start" i]').first()
  // or similar. Let's find button with text "Drop In"
  const cta = page.locator('button').filter({ hasText: /Drop In|Play|Start/i }).first();
  await page.waitForTimeout(500);
  if (await cta.isVisible({ timeout: 3000 }).catch(() => false)) {
    await cta.click({ force: true });
    console.log('CTA clicked');
  }
  await page.waitForTimeout(300);

  // Step 2: Handle welcome-back "Continue" screen if present
  const continueBtn = page.locator('[data-testid="reg-welcome-continue"]')
    .or(page.locator('button').filter({ hasText: /^continue/i })).first();
  try {
    await page.waitForTimeout(300);
    if (await continueBtn.isVisible({ timeout: 1500 })) {
      await continueBtn.click({ force: true });
      console.log('Continue clicked');
    }
  } catch(e) { console.log('No continue btn'); }

  // Step 3: Handle consent screen if present
  const consentBtn = page.locator('[data-testid="reg-consent-agree"]')
    .or(page.locator('button').filter({ hasText: /agree.*play/i })).first();
  try {
    if (await consentBtn.isVisible({ timeout: 800 })) {
      await consentBtn.click({ force: true });
      console.log('Consent clicked');
    }
  } catch(e) { console.log('No consent btn'); }

  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'tests/results/cap3-countdown.png' });
  console.log('countdown captured');

  // Wait for playing
  await page.waitForTimeout(3500);
  await page.screenshot({ path: 'tests/results/cap3-playing.png' });
  console.log('playing captured');

  // Wait for game end (60 ticks at 50ms = 3s)
  try {
    await page.waitForSelector('[data-testid="end-screen"], button:has-text("Play Again")', { timeout: 8000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tests/results/cap3-end.png' });
    console.log('end screen captured');
  } catch(e) {
    await page.screenshot({ path: 'tests/results/cap3-timeout.png' });
    console.log('Timeout - current state captured. Error:', e.message);
  }

  console.log('Errors:', errors);
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
