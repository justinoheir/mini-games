import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  deviceScaleFactor: 2
});
const page = await ctx.newPage();

// Speed up timer 10x
await page.addInitScript(() => {
  window.__DISABLE_AUDIO = true;
  localStorage.setItem('seen_pitch-match', '1');
  localStorage.setItem('mg_user', JSON.stringify({ name: 'QA Tester', avatar: '🎵', consented: true }));
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', { value: {}, writable: true, configurable: true });
  }
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (c?.audio) {
      const audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      return dest.stream;
    }
    throw new Error('no video');
  };
  // Speed up timer
  const orig = window.setInterval.bind(window);
  window.setInterval = (fn, ms, ...args) => {
    if (ms === 1000) return orig(fn, 100, ...args);
    return orig(fn, ms, ...args);
  };
});

await page.goto('http://localhost:3000/games/pitch-match');
await page.waitForLoadState('load');
await page.waitForTimeout(1000);

// Click start button
const startBtn = page.locator('[data-testid="start-cta"]')
  .or(page.locator('button').filter({ hasText: /enable microphone/i }))
  .or(page.locator('button').filter({ hasText: /retry microphone/i }))
  .first();
await startBtn.click({ force: true });
await page.waitForTimeout(400);

// Handle welcome-back screen
const continueBtn = page.locator('[data-testid="reg-welcome-continue"]')
  .or(page.locator('button').filter({ hasText: /^continue/i })).first();
const cbV = await continueBtn.isVisible({ timeout: 1200 }).catch(() => false);
if (cbV) { await continueBtn.click({ force: true }); await page.waitForTimeout(400); }

// Handle consent
const consentBtn = page.locator('[data-testid="reg-consent-agree"]')
  .or(page.locator('button').filter({ hasText: /agree.*play/i })).first();
const conV = await consentBtn.isVisible({ timeout: 600 }).catch(() => false);
if (conV) { await consentBtn.click({ force: true }); await page.waitForTimeout(400); }

// Wait for game to end (45s / 10x = ~4.5s + buffer)
console.log('Waiting for game to end...');
await page.waitForSelector('button:has-text("Play Again")', { timeout: 12000 });
await page.waitForTimeout(500);
await page.screenshot({ path: 'tests/qa-screenshots/pm-06-end-screen.png' });
console.log('End screen screenshot saved');

// Check scrollability
const scrollH = await page.evaluate(() => document.documentElement.scrollHeight);
const viewH = await page.evaluate(() => window.innerHeight);
console.log(`End screen scroll: scrollH=${scrollH}, viewH=${viewH}, requires scroll: ${scrollH > viewH + 10}`);

// Check for score on end screen
const score = await page.locator('[data-testid="end-screen"]').textContent().catch(() => 'not found');
console.log('End screen text preview:', score?.substring(0, 200));

await browser.close();
console.log('Done');
