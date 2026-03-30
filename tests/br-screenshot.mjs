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
  // Mark SwipeInstructions as already seen so we skip to start screen
  localStorage.setItem('seen_breath-rider', '1');
  // Mock getUserMedia
  const fakeAnalyser = {
    fftSize: 256,
    frequencyBinCount: 128,
    smoothingTimeConstant: 0.3,
    getByteFrequencyData: (arr) => { arr.fill(0); },
    connect: () => {},
  };
  const fakeCtx = {
    createAnalyser: () => fakeAnalyser,
    createMediaStreamSource: () => ({ connect: () => {} }),
    close: async () => {},
    state: 'running',
  };
  const fakeStream = { getTracks: () => [{ stop: () => {} }], getAudioTracks: () => [] };
  navigator.mediaDevices.getUserMedia = async () => fakeStream;
  window.AudioContext = function() { return fakeCtx; };
});

await page.goto('http://localhost:3000/games/breath-rider');
await page.waitForTimeout(2000);
await page.screenshot({ path: 'tests/screenshots/br-start.png' });
console.log('Start screen captured');

// Click CTA
const cta = page.locator('[data-testid="start-cta"]');
await cta.waitFor({ timeout: 5000 });
await cta.click({ force: true });
await page.waitForTimeout(800);

// Handle PlayerNameInput if shown
const nameInput = page.locator('input').first();
if (await nameInput.isVisible({ timeout: 1500 }).catch(() => false)) {
  await nameInput.fill('Test Player');
}
const contBtn = page.locator('button').filter({ hasText: /continue|let.s go|play|start/i }).first();
if (await contBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  await contBtn.click({ force: true });
}
await page.waitForTimeout(500);
await page.screenshot({ path: 'tests/screenshots/br-registration.png' });
console.log('Registration captured');

// Wait for countdown
await page.waitForTimeout(2000);
await page.screenshot({ path: 'tests/screenshots/br-countdown.png' });
console.log('Countdown captured');

// Wait for playing phase
await page.waitForTimeout(3500);
await page.screenshot({ path: 'tests/screenshots/br-playing.png' });
console.log('Playing captured');

// Speed up timer to reach end screen
await page.evaluate(() => {
  const orig = window.setInterval.bind(window);
  window.setInterval = (fn, ms, ...args) => {
    if (ms === 1000) return orig(fn, 50, ...args);
    return orig(fn, ms, ...args);
  };
});
await page.waitForTimeout(6000);
await page.screenshot({ path: 'tests/screenshots/br-end.png' });
console.log('End screen captured');

await browser.close();
console.log('All screenshots done!');
