/**
 * Quick sanity test — fixed approach
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3333';
const SCREENSHOTS_DIR = path.join(__dirname, 'qa-screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

async function testGame(browser, gameId) {
  console.log(`\n--- Testing: ${gameId} ---`);
  
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });

  // Inject localStorage before page scripts run
  await context.addInitScript(() => {
    Object.defineProperty(window, '_qaInjected', { value: true });
    // Override localStorage directly
    try {
      const stored = JSON.stringify({ name: 'QATester', firstName: 'QATester', avatar: '🎮' });
      window.__qaUser = stored;
    } catch(e) {}
  });
  
  const errors = [];
  const page = await context.newPage();

  // Inject user data before page load
  await page.route('**/*', async route => {
    await route.continue();
  });

  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text().substring(0, 150));
  });
  page.on('pageerror', e => errors.push(e.message.substring(0, 150)));

  // Navigate  
  await page.goto(`${BASE_URL}/games/${gameId}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  
  // Immediately set localStorage via evaluate (runs in page context)
  await page.evaluate(() => {
    localStorage.setItem('mg_user', JSON.stringify({ name: 'QATester', firstName: 'QATester', avatar: '🎮' }));
    localStorage.setItem('mg_consent', 'true');
  });
  
  // Wait for React to render
  await page.waitForTimeout(2000);
  
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `sanity-${gameId}-01-initial.png`) });
  
  // Check what we see
  const lsUser = await page.evaluate(() => localStorage.getItem('mg_user'));
  const hasStartBtn = await page.locator('[data-testid="start-cta"]').count() > 0;
  const hasNameInput = await page.locator('input[placeholder="Jane"]').count() > 0;
  const canvasCount = await page.locator('canvas').count();
  
  console.log(`  localStorage mg_user set: ${!!lsUser}`);
  console.log(`  Start button visible: ${hasStartBtn}`);
  console.log(`  Name input visible: ${hasNameInput}`);
  console.log(`  Canvas count: ${canvasCount}`);
  
  // JS click start button (bypasses pointer event interceptors)
  if (hasStartBtn) {
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="start-cta"]');
      if (btn) btn.click();
    });
    console.log(`  Clicked start button via JS`);
    await page.waitForTimeout(500);
    
    // If name input appears, fill it
    const nameInputVisible = await page.locator('input[placeholder="Jane"]').isVisible().catch(() => false);
    if (nameInputVisible) {
      await page.locator('input[placeholder="Jane"]').fill('QATester');
      await page.keyboard.press('Enter');
      console.log(`  Filled name input`);
      await page.waitForTimeout(500);
    }
    
    // Click next/continue buttons if any
    const continueBtn = page.locator('button').filter({ hasText: /continue|next|ok|done/i }).first();
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }
  }
  
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `sanity-${gameId}-02-afterstart.png`) });
  
  const canvasCountAfter = await page.locator('canvas').count();
  console.log(`  Canvas after start: ${canvasCountAfter}`);
  console.log(`  Errors: ${errors.slice(0,3).join(' | ')}`);
  
  await context.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  
  for (const gameId of ['paint-splash', 'balloon-pop', 'speed-sort']) {
    try {
      await testGame(browser, gameId);
    } catch(e) {
      console.error(`  ERROR: ${e.message}`);
    }
  }
  
  await browser.close();
}

main().catch(console.error);
