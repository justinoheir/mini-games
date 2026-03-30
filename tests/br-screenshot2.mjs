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
  // Skip SwipeInstructions and Registration
  localStorage.setItem('seen_breath-rider', '1');
  localStorage.setItem('mg_user', JSON.stringify({ name: 'Test Player', firstName: 'Test', avatar: '🎮' }));
  localStorage.setItem('mg_consent', '1');
  // Mock mic
  const fakeStream = { getTracks: () => [{ stop: () => {} }], getAudioTracks: () => [] };
  navigator.mediaDevices.getUserMedia = async () => fakeStream;
  const fakeData = new Uint8Array(128).fill(0);
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

// Check if PlayerNameInput showed a continue/welcome-back button
const welcomeBackBtn = page.locator('button').filter({ hasText: /continue|that.s me|let.s go|play now/i }).first();
if (await welcomeBackBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  await welcomeBackBtn.click({ force: true });
} else {
  // Try tab-through registration
  const nameInput = page.locator('input').first();
  if (await nameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await nameInput.fill('Test Player');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
  }
  // Try any visible button
  const anyBtn = page.locator('button:visible').last();
  if (await anyBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await anyBtn.click({ force: true });
    await page.waitForTimeout(500);
  }
}
await page.waitForTimeout(500);

// Take screenshot of current state (should be countdown or start)
await page.screenshot({ path: 'tests/screenshots/br-after-cta.png' });
console.log('After CTA captured');

// Wait for countdown
const countdown = page.locator('[data-testid="countdown-display"]');
if (await countdown.isVisible({ timeout: 5000 }).catch(() => false)) {
  await page.screenshot({ path: 'tests/screenshots/br-countdown.png' });
  console.log('Countdown captured');
}

// Wait for playing phase (canvas visible)
await page.waitForTimeout(4000);
const canvas = page.locator('canvas');
if (await canvas.isVisible({ timeout: 5000 }).catch(() => false)) {
  await page.screenshot({ path: 'tests/screenshots/br-playing.png' });
  console.log('Playing captured');
} else {
  await page.screenshot({ path: 'tests/screenshots/br-playing.png' });
  console.log('Playing state (or still in transition)');
}

// Speed up timer to end
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

// Check what's on the end screen
const endText = await page.locator('body').textContent();
console.log('End screen text (first 300 chars):', endText?.substring(0, 300));

await browser.close();
console.log('Done!');
