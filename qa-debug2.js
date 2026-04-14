const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3333';
const SD = path.join(__dirname, 'qa-screenshots');
const MOCK_USER = JSON.stringify({
  firstName: 'QATester', lastName: 'Bot', email: 'qa@test.com',
  name: 'QATester Bot', avatar: '🎮', id: 'qa-001',
  timestamp: Date.now(), consented: true,
});

process.on('unhandledRejection', (r) => { console.error('unhandled rejection:', r); });
process.on('uncaughtException', (e) => { console.error('uncaughtException:', e.message); });

async function testGame(browser, gameId) {
  console.log(`\n[${gameId}] starting...`);
  let ctx, page;
  try {
    ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().substring(0, 100)); });
    page.on('pageerror', e => { 
      console.error(`  pageerror: ${e.message.substring(0, 100)}`);
      errors.push(e.message.substring(0, 100)); 
    });
    page.on('crash', () => console.error('  PAGE CRASHED'));
    
    console.log(`[${gameId}] goto...`);
    await page.goto(`${BASE_URL}/games/${gameId}`, { waitUntil: 'domcontentloaded', timeout: 12000 });
    console.log(`[${gameId}] inject ls...`);
    await page.evaluate((u) => {
      localStorage.setItem('mg_user', u);
    }, MOCK_USER);
    await page.waitForTimeout(1200);
    
    console.log(`[${gameId}] click start...`);
    await page.evaluate(() => { document.querySelector('[data-testid="start-cta"]')?.click(); });
    await page.waitForTimeout(800);
    
    console.log(`[${gameId}] click welcome...`);
    await page.evaluate(() => { document.querySelector('[data-testid="reg-welcome-continue"]')?.click(); });
    await page.waitForTimeout(500);
    
    console.log(`[${gameId}] waiting for game...`);
    await page.waitForTimeout(3000);
    
    const canvas = await page.locator('canvas').count();
    console.log(`[${gameId}] DONE. canvas=${canvas}, errors=${JSON.stringify(errors.slice(0,2))}`);
    
    await page.screenshot({ path: path.join(SD, `dbg2-${gameId}.png`) });
  } catch(e) {
    console.error(`[${gameId}] ERROR: ${e.message}`);
  } finally {
    if (page) await page.close().catch(() => {});
    if (ctx) await ctx.close().catch(() => {});
  }
}

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const games = ['orbit-launch', 'speed-sort', 'spring-leap'];
    for (const g of games) {
      await testGame(browser, g);
    }
  } finally {
    await browser.close();
    console.log('Done.');
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(0); });
