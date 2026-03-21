const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname);
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();

  await page.addInitScript(() => {
    localStorage.setItem('seen_color-cascade', '1');
    localStorage.setItem('mg_user', JSON.stringify({ name: 'QA', avatar: '🎮', id: 'qa-001', timestamp: Date.now() }));
    window.__DISABLE_AUDIO = true;
  });

  await page.goto('http://localhost:3000/games/color-cascade');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(OUT, 'start-screen.png') });
  console.log('start-screen.png saved');

  // Open PlayerNameInput overlay
  const cta = page.locator('[data-testid="start-cta"]');
  await cta.click({ force: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'name-input.png') });
  console.log('name-input.png saved');

  // Proceed through consent
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const c = btns.find(b => b.textContent.trim().startsWith('Continue'));
    if (c) c.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const a = btns.find(b => b.textContent.includes('Agree') && b.textContent.includes('Play'));
    if (a) a.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'countdown.png') });
  console.log('countdown.png saved');

  // Wait for gameplay
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(OUT, 'playing.png') });
  console.log('playing.png saved');

  await browser.close();
  console.log('All screenshots captured.');
})().catch(e => { console.error(e.message); process.exit(1); });
