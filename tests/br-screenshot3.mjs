import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';

mkdirSync('tests/screenshots', { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
await context.grantPermissions(['microphone']);
const page = await context.newPage();

await page.addInitScript(() => {
  window.__DISABLE_AUDIO = true;
  localStorage.setItem('seen_breath-rider', '1');
  localStorage.setItem('mg_user', JSON.stringify({
    name: 'Test Player', avatar: '🌬️',
    id: 'test-001', timestamp: Date.now(), consented: true
  }));
  localStorage.setItem('mg_last_player', JSON.stringify({ name: 'Test Player', avatar: '🌬️' }));
  const fakeStream = { getTracks: () => [{ stop: () => {} }], getAudioTracks: () => [] };
  navigator.mediaDevices.getUserMedia = async () => fakeStream;
  const fakeAnalyser = {
    fftSize: 256, frequencyBinCount: 128, smoothingTimeConstant: 0.3,
    getByteFrequencyData: (arr) => { arr.fill(0); },
    connect: () => {},
  };
  window.AudioContext = function() {
    return {
      createAnalyser: () => fakeAnalyser,
      createMediaStreamSource: () => ({ connect: () => {} }),
      close: async () => {},
      state: 'running',
    };
  };
  // Speed up timer from the start (10x faster)
  const orig = window.setInterval.bind(window);
  window.setInterval = (fn, ms, ...args) => {
    if (ms === 1000) return orig(fn, 100, ...args);
    return orig(fn, ms, ...args);
  };
});

await page.goto('http://localhost:3000/games/breath-rider');
await page.waitForTimeout(2000);
await page.screenshot({ path: 'tests/screenshots/br-start.png' });
console.log('1. Start screen');

// Click CTA - welcome back flow
const cta = page.locator('[data-testid="start-cta"]');
await cta.waitFor({ timeout: 5000 });
await cta.click({ force: true });
await page.waitForTimeout(500);

// Welcome-back continue
const contBtn = page.locator('[data-testid="reg-welcome-continue"]')
  .or(page.locator('button').filter({ hasText: /^continue/i })).first();
if (await contBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  await contBtn.click({ force: true });
  await page.waitForTimeout(300);
}

// Consent (if shown)
const consentBtn = page.locator('button').filter({ hasText: /agree.*play/i }).first();
if (await consentBtn.isVisible({ timeout: 500 }).catch(() => false)) {
  await consentBtn.click({ force: true });
  await page.waitForTimeout(300);
}

// Countdown
const countdown = page.locator('[data-testid="countdown-display"]');
if (await countdown.isVisible({ timeout: 5000 }).catch(() => false)) {
  await page.screenshot({ path: 'tests/screenshots/br-countdown.png' });
  console.log('2. Countdown');
}

// Playing phase
await page.waitForSelector('canvas', { timeout: 8000, state: 'visible' }).catch(() => {});
await page.waitForTimeout(2000);
await page.screenshot({ path: 'tests/screenshots/br-playing.png' });
console.log('3. Playing');

// Wait for end screen (timer at 10x speed: 60s = 6s real time)
const playAgain = page.locator('button').filter({ hasText: /play again/i }).first();
await playAgain.waitFor({ timeout: 15000 }).catch(() => console.log('Play again not found in time'));
await page.screenshot({ path: 'tests/screenshots/br-end.png' });
console.log('4. End screen');

const bodyText = await page.locator('body').innerText().catch(() => '');
console.log('Body preview:', bodyText.substring(0, 300));

await browser.close();
