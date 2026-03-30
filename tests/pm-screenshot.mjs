import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  deviceScaleFactor: 2
});
const page = await ctx.newPage();

await page.addInitScript(() => {
  window.__DISABLE_AUDIO = true;
  localStorage.setItem('seen_pitch-match', '1');
  localStorage.setItem('mg_user', JSON.stringify({ name: 'QA Tester', avatar: '🎵', consented: true }));
  // Mock mic
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
});

await page.goto('http://localhost:3000/games/pitch-match');
await page.waitForLoadState('load');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'tests/qa-screenshots/pm-01-start.png' });
console.log('Screenshot 1 - start screen');

// Find and click start button
const startBtn = page.locator('[data-testid="start-cta"]')
  .or(page.locator('button').filter({ hasText: /enable microphone/i }))
  .or(page.locator('button').filter({ hasText: /retry microphone/i }))
  .first();
  
const visible = await startBtn.isVisible({ timeout: 2000 }).catch(() => false);
console.log('Start button visible:', visible);

if (!visible) {
  const html = await page.content();
  console.log('Page HTML preview:', html.substring(0, 800));
} else {
  const box = await startBtn.boundingBox();
  console.log('Start btn size:', box?.width, 'x', box?.height);
  await startBtn.click({ force: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/qa-screenshots/pm-02-after-cta.png' });
  console.log('Screenshot 2 - after CTA click');

  // Handle welcome-back screen
  const continueBtn = page.locator('[data-testid="reg-welcome-continue"]')
    .or(page.locator('button').filter({ hasText: /^continue/i })).first();
  const cbVisible = await continueBtn.isVisible({ timeout: 1500 }).catch(() => false);
  if (cbVisible) { await continueBtn.click({ force: true }); await page.waitForTimeout(400); }
  
  // Handle consent
  const consentBtn = page.locator('[data-testid="reg-consent-agree"]')
    .or(page.locator('button').filter({ hasText: /agree.*play/i })).first();
  const conVisible = await consentBtn.isVisible({ timeout: 600 }).catch(() => false);
  if (conVisible) { await consentBtn.click({ force: true }); await page.waitForTimeout(400); }

  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'tests/qa-screenshots/pm-03-countdown.png' });
  console.log('Screenshot 3 - countdown');
  
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'tests/qa-screenshots/pm-04-playing.png' });
  console.log('Screenshot 4 - playing phase');
  
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'tests/qa-screenshots/pm-05-playing-mid.png' });
  console.log('Screenshot 5 - playing mid');
}

await browser.close();
console.log('Done');
