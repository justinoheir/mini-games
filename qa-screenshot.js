const { chromium, devices } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices['iPhone 14'],
    locale: 'en-US'
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__DISABLE_AUDIO = true;
    // Seed a player session so name input is skipped
    localStorage.setItem('mg_player', JSON.stringify({ name: 'TestPlayer', avatar: '🎮', timestamp: Date.now() }));
    // Make timer 10x faster
    const orig = window.setInterval.bind(window);
    window.setInterval = function(fn, ms, ...args) {
      if (ms === 1000) return orig(fn, 100, ...args);
      return orig(fn, ms, ...args);
    };
  });
  
  await page.goto('http://localhost:3000/games/symbol-scan');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'qa-ss-start.png', fullPage: false });
  console.log('Start screen captured');
  
  // Find and click the main Start CTA
  try {
    // Try to find start button
    const btn = page.locator('button').filter({ hasText: /^Start|Start Game/i }).first();
    await btn.waitFor({ timeout: 3000 });
    await btn.click();
    console.log('Clicked start button');
  } catch(e) {
    console.log('Could not find start button:', e.message);
    // Try any visible button
    const allBtns = await page.locator('button').all();
    console.log('All buttons:', await Promise.all(allBtns.map(b => b.textContent())));
  }
  
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'qa-ss-after-start.png' });
  console.log('After start captured');
  
  // Check if name input is showing - if so, fill it
  const nameInput = page.locator('input[type="text"], input[placeholder]').first();
  const nameInputVisible = await nameInput.isVisible().catch(() => false);
  if (nameInputVisible) {
    console.log('Name input visible - filling it');
    await nameInput.fill('QAPlayer');
    await page.waitForTimeout(200);
    // Click next/submit
    const submitBtn = page.locator('button[type="submit"], button').filter({ hasText: /continue|next|→|done|go/i }).first();
    const submitVisible = await submitBtn.isVisible().catch(() => false);
    if (submitVisible) {
      await submitBtn.click();
    } else {
      await nameInput.press('Enter');
    }
    await page.waitForTimeout(500);
    
    // May need to go through avatar selection or more steps
    await page.screenshot({ path: 'qa-ss-after-name.png' });
    console.log('After name entry captured');
    
    // Click through remaining steps (avatar, etc.)
    for (let i = 0; i < 5; i++) {
      const nextBtn = page.locator('button').filter({ hasText: /continue|next|→|start|let.s play/i }).first();
      const nextVisible = await nextBtn.isVisible().catch(() => false);
      if (nextVisible) {
        await nextBtn.click();
        await page.waitForTimeout(300);
      }
    }
  }
  
  // Wait for countdown
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'qa-ss-countdown.png' });
  console.log('Countdown phase captured');
  
  // Wait for playing phase (countdown takes ~3.2s)
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'qa-ss-playing.png' });
  console.log('Playing phase captured');
  
  // Wait for end screen (60s game at 10x speed = 6s)
  try {
    await page.waitForSelector('button:has-text("Play Again")', { timeout: 15000 });
    await page.screenshot({ path: 'qa-ss-end.png' });
    console.log('End screen captured');
  } catch(e) {
    console.log('End screen timeout:', e.message);
    await page.screenshot({ path: 'qa-ss-end.png' });
  }
  
  await browser.close();
  console.log('Done');
})().catch(e => { console.error(e); process.exit(1); });
