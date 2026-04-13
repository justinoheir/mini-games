/**
 * Quick sanity test on 3 games
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3333';
const SCREENSHOTS_DIR = path.join(__dirname, 'qa-screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const TEST_GAMES = ['paint-splash', 'balloon-pop', 'speed-sort'];

async function testGame(context, gameId) {
  const errors = [];
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text().substring(0, 150));
  });
  page.on('pageerror', e => errors.push(e.message.substring(0, 150)));

  await page.goto(`${BASE_URL}/games/${gameId}`, { waitUntil: 'networkidle', timeout: 15000 });

  // Check what's on the page
  const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
  const hasNameInput = bodyText.includes("What's your first name");
  const hasStartBtn = await page.locator('[data-testid="start-cta"]').isVisible().catch(() => false);

  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `sanity-${gameId}-01-initial.png`) });

  console.log(`${gameId}: hasNameInput=${hasNameInput}, hasStartBtn=${hasStartBtn}`);
  console.log(`  Page snippet: "${bodyText.substring(0, 100)}"`);

  // Try clicking start CTA
  if (hasStartBtn) {
    await page.locator('[data-testid="start-cta"]').click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `sanity-${gameId}-02-afterstart.png`) });
    const afterText = await page.evaluate(() => document.body?.innerText ?? '');
    const hasNameInputNow = afterText.includes("What's your first name");
    console.log(`  After click: hasNameInput=${hasNameInputNow}`);
    console.log(`  Text: "${afterText.substring(0, 100)}"`);
  }

  // Check localStorage
  const lsUser = await page.evaluate(() => localStorage.getItem('mg_user')).catch(() => null);
  console.log(`  localStorage mg_user: ${lsUser}`);

  const canvasCount = await page.locator('canvas').count();
  console.log(`  Canvas count: ${canvasCount}`);
  console.log(`  Errors: ${errors.length} — ${errors.slice(0,2).join(' | ')}`);

  await page.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  
  // Test WITH and WITHOUT localStorage injection
  console.log('\n=== WITHOUT localStorage injection ===');
  const ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await testGame(ctx1, 'paint-splash');
  await ctx1.close();

  console.log('\n=== WITH localStorage injection ===');
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx2.addInitScript(() => {
    localStorage.setItem('mg_user', JSON.stringify({ name: 'QATester', firstName: 'QATester', avatar: '🎮' }));
    localStorage.setItem('mg_consent', 'true');
  });
  for (const gameId of TEST_GAMES) {
    await testGame(ctx2, gameId);
  }
  await ctx2.close();

  await browser.close();
}

main().catch(console.error);
