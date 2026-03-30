const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('seen_memory-grid', '1');
    localStorage.setItem('mg_user', JSON.stringify({ name: 'TestUser', avatar: '🎮' }));
  });
  await page.goto('http://localhost:3000/games/memory-grid');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'tests/screenshots/mg-start-main.png' });
  console.log('Start screen done');
  
  // Click start button
  const btn = page.locator('button').filter({ hasText: /start|play|begin|continue/i }).first();
  await btn.click().catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'tests/screenshots/mg-countdown.png' });
  console.log('Countdown done');
  
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'tests/screenshots/mg-playing.png' });
  console.log('Playing done');
  
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
