const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3333';
const SD = path.join(__dirname, 'qa-screenshots');
if (!fs.existsSync(SD)) fs.mkdirSync(SD, { recursive: true });

const MOCK_USER = JSON.stringify({
  firstName: 'QATester', lastName: 'Bot', email: 'qa@test.com',
  name: 'QATester Bot', avatar: '🎮', id: 'qa-001',
  timestamp: Date.now(), consented: true,
});

async function testGame(browser, gameId) {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('console', m => { 
    if (m.type() === 'error') errors.push(m.text().substring(0, 150)); 
  });
  page.on('pageerror', e => errors.push(e.message.substring(0, 150)));

  try {
    console.log(`  goto...`);
    await page.goto(`${BASE_URL}/games/${gameId}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    console.log(`  inject localStorage...`);
    await page.evaluate((u) => {
      localStorage.setItem('mg_user', u);
      localStorage.setItem('mg_consent', 'true');
    }, MOCK_USER);
    await page.waitForTimeout(1500);
    
    console.log(`  screenshot before...`);
    await page.screenshot({ path: path.join(SD, `dbg-${gameId}-01.png`) });
    
    const hasStartCTA = await page.locator('[data-testid="start-cta"]').count() > 0;
    console.log(`  hasStartCTA: ${hasStartCTA}`);
    
    if (hasStartCTA) {
      await page.evaluate(() => { document.querySelector('[data-testid="start-cta"]')?.click(); });
      await page.waitForTimeout(800);
    }
    
    const hasWelcome = await page.locator('[data-testid="reg-welcome-continue"]').count() > 0;
    console.log(`  hasWelcome: ${hasWelcome}`);
    
    if (hasWelcome) {
      await page.evaluate(() => { document.querySelector('[data-testid="reg-welcome-continue"]')?.click(); });
      await page.waitForTimeout(500);
    }
    
    await page.waitForTimeout(3500);
    const canvas = await page.locator('canvas').count();
    await page.screenshot({ path: path.join(SD, `dbg-${gameId}-03.png`) });
    console.log(`  Canvas: ${canvas}, Errors: ${errors.slice(0,3).join(' | ')}`);
  } catch(e) {
    console.error(`  ERROR for ${gameId}: ${e.message}`);
  } finally {
    await ctx.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const games = ['wire-cross', 'balloon-pop', 'slingshot-smash'];
    for (const g of games) {
      console.log(`\n--- ${g} ---`);
      await testGame(browser, g);
    }
  } finally {
    await browser.close();
  }
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
