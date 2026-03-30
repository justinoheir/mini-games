const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    ...devices['iPhone 14'],
    storageState: {
      cookies: [],
      origins: [{
        origin: 'http://localhost:3000',
        localStorage: [
          { name: 'mg_user', value: JSON.stringify({ name: 'Test', avatar: '🎮', id: 'test', consented: true }) },
          { name: 'seen_steady-hand', value: '1' }
        ]
      }]
    }
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__DISABLE_AUDIO = true; });
  await page.goto('http://localhost:3000/games/steady-hand');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  // Click start
  const btn = await page.waitForSelector('[data-testid="start-cta"], button', { timeout: 5000 });
  await btn.click({ force: true });
  // Handle continue screen
  try {
    const cont = await page.waitForSelector('text=Continue', { timeout: 2000 });
    await cont.click({ force: true });
  } catch(e) {}
  // Wait for countdown to finish (3.5s) then capture gameplay
  await page.waitForTimeout(4200);
  await page.screenshot({ path: 'C:/Users/justi/.openclaw/workspace/steady-hand-gameplay.png' });
  await browser.close();
  console.log('Done');
})().catch(e => { console.error(e.message); process.exit(1); });
