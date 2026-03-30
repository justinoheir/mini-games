import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:3001';
const browser = await chromium.launch({ headless: true });

async function startGame(page) {
  // Click CTA
  const cta = page.locator('[data-testid="start-cta"]').first();
  await cta.click({ force: true });
  
  // Handle "Welcome back" continue button if present
  const continueBtn = page.locator('[data-testid="reg-welcome-continue"], button:has-text("Continue")').first();
  const hasContinue = await continueBtn.isVisible({ timeout: 2000 }).catch(() => false);
  if (hasContinue) await continueBtn.click({ force: true });
  
  // Handle consent screen if present
  const consentBtn = page.locator('[data-testid="reg-consent-agree"], button:has-text("Play")').first();
  const hasConsent = await consentBtn.isVisible({ timeout: 1000 }).catch(() => false);
  if (hasConsent) await consentBtn.click({ force: true });
  
  await page.waitForTimeout(800);
}

// Screenshot 1: Start screen (clean)
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    localStorage.setItem('seen_color-cascade', '1');
    localStorage.setItem('mg_user', JSON.stringify({ name: 'TestUser', avatar: '🎮', consented: true }));
  });
  const page = await context.newPage();
  await page.goto(BASE_URL + '/games/color-cascade');
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'tests/results/cc-prod-start.png', fullPage: false });
  console.log('1. start screen saved');
  await context.close();
}

// Screenshots 2-4 with accelerated timer
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    localStorage.setItem('seen_color-cascade', '1');
    localStorage.setItem('mg_user', JSON.stringify({ name: 'TestUser', avatar: '🎮', consented: true }));
    const origSetInterval = window.setInterval.bind(window);
    window.setInterval = (fn, ms, ...args) => {
      if (ms === 1000) return origSetInterval(fn, 100, ...args);
      return origSetInterval(fn, ms, ...args);
    };
  });
  const page = await context.newPage();
  await page.goto(BASE_URL + '/games/color-cascade');
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);
  
  await startGame(page);
  
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'tests/results/cc-prod-countdown.png', fullPage: false });
  console.log('2. countdown saved');

  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'tests/results/cc-prod-playing.png', fullPage: false });
  console.log('3. playing saved');

  // Wait for end screen (45s at 10x = 4.5s + ~2.5s countdown already elapsed, so ~5s remaining)
  await page.waitForSelector('[data-testid="end-screen"], button:has-text("Play Again")', { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/results/cc-prod-end.png', fullPage: false });
  console.log('4. end screen saved');
  await context.close();
}

await browser.close();
console.log('All production screenshots done!');
