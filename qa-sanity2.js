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
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().substring(0, 100)); });
  page.on('pageerror', e => errors.push(e.message.substring(0, 100)));

  await page.goto(`${BASE_URL}/games/${gameId}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  
  // Inject localStorage immediately  
  await page.evaluate((u) => {
    localStorage.setItem('mg_user', u);
    localStorage.setItem('mg_consent', 'true');
  }, MOCK_USER);
  
  await page.waitForTimeout(1500);
  
  await page.screenshot({ path: path.join(SD, `s2-${gameId}-01.png`) });
  
  // State check
  const hasStartCTA = await page.locator('[data-testid="start-cta"]').count() > 0;
  const hasWelcome = await page.locator('[data-testid="reg-welcome-continue"]').count() > 0;
  const hasRegInput = await page.locator('[data-testid="reg-input"]').count() > 0;
  console.log(`[${gameId}] startCTA=${hasStartCTA} welcomeContinue=${hasWelcome} regInput=${hasRegInput}`);
  
  // Click start
  if (hasStartCTA) {
    await page.evaluate(() => { document.querySelector('[data-testid="start-cta"]')?.click(); });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SD, `s2-${gameId}-02.png`) });
    
    const hasWelcome2 = await page.locator('[data-testid="reg-welcome-continue"]').count() > 0;
    const hasConsent = await page.locator('[data-testid="reg-consent-agree"]').count() > 0;
    console.log(`  After start click: welcomeContinue=${hasWelcome2} consent=${hasConsent}`);
    
    if (hasWelcome2) {
      await page.evaluate(() => { document.querySelector('[data-testid="reg-welcome-continue"]')?.click(); });
      await page.waitForTimeout(500);
    } else if (hasConsent) {
      await page.evaluate(() => { document.querySelector('[data-testid="reg-consent-agree"]')?.click(); });
      await page.waitForTimeout(500);
    }
  }
  
  await page.waitForTimeout(3000);
  const canvas = await page.locator('canvas').count();
  await page.screenshot({ path: path.join(SD, `s2-${gameId}-03.png`) });
  console.log(`  Canvas: ${canvas}, Errors: ${errors.slice(0,2).join(' | ')}`);
  
  await ctx.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  await testGame(browser, 'paint-splash');
  await testGame(browser, 'speed-sort');
  await browser.close();
}
main().catch(console.error);
