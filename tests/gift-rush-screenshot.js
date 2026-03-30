const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  
  await page.addInitScript(() => {
    localStorage.setItem('mg_user', JSON.stringify({ name: 'TestUser', avatar: '🎮' }));
    localStorage.setItem('seen_gift-rush', '1');
    window.__DISABLE_AUDIO = true;
  });
  
  await page.goto('http://localhost:3000/games/gift-rush');
  await page.waitForTimeout(2000);
  
  // Click main CTA
  await page.click('[data-testid="start-cta"]');
  await page.waitForTimeout(600);
  
  // Click Continue (returning user)
  await page.click('button:has-text("Continue")');
  await page.waitForTimeout(600);
  
  // Click I Agree & Play (consent)
  await page.click('button:has-text("Agree")');
  await page.waitForTimeout(300);
  
  // Should be in countdown now
  await page.screenshot({ path: 'tests/screenshots/gift-rush-countdown-final.png' });
  console.log('Countdown screenshot taken');
  
  // Wait for playing phase
  await page.waitForTimeout(3200);
  await page.screenshot({ path: 'tests/screenshots/gift-rush-playing-final.png' });
  console.log('Playing screenshot taken');
  
  // Do some swipes
  for (let i = 0; i < 5; i++) {
    try {
      const card = page.locator('[style*="cursor: grab"]').first();
      const box = await card.boundingBox({ timeout: 2000 });
      if (box) {
        await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
        await page.mouse.down();
        // Swipe right (nice items)
        await page.mouse.move(box.x + box.width/2 + 120, box.y + box.height/2, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(700);
      }
    } catch(e) {
      console.log('Swipe ' + i + ' failed:', e.message.split('\n')[0]);
    }
  }
  
  await page.screenshot({ path: 'tests/screenshots/gift-rush-playing-scored.png' });
  console.log('Scored screenshot taken');
  
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
