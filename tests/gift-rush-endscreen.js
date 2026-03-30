const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  
  await page.addInitScript(() => {
    localStorage.setItem('mg_user', JSON.stringify({ name: 'TestUser', avatar: '🎮', consented: true }));
    localStorage.setItem('seen_gift-rush', '1');
    window.__DISABLE_AUDIO = true;
    const origI = window.setInterval.bind(window);
    window.setInterval = (fn, ms, ...args) => origI(fn, ms === 1000 ? 100 : ms, ...args);
  });
  
  await page.goto('http://localhost:3000/games/gift-rush');
  await page.waitForTimeout(2000);
  
  await page.click('[data-testid="start-cta"]');
  await page.waitForTimeout(600);
  await page.click('button:has-text("Continue")');
  await page.waitForTimeout(600);
  
  await page.waitForSelector('button:has-text("Play Again")', { timeout: 20000 });
  await page.waitForTimeout(1000); // let animations complete
  await page.screenshot({ path: 'tests/screenshots/gift-rush-endscreen-full.png', fullPage: true });
  console.log('End screen full captured');
  
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
