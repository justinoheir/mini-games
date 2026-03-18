const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--disable-web-security'] });
  const device = devices['iPhone 13'];
  const ctx = await browser.newContext({ ...device, locale: 'en-US' });
  const page = await ctx.newPage();
  
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  
  await page.goto('http://localhost:3000/games/path-trace', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/screenshots/pt-01-start.png' });
  
  // Click Start CTA
  const cta = page.locator('[data-testid="start-cta"]');
  if (await cta.isVisible()) {
    const box = await cta.boundingBox();
    console.log('CTA button size:', box ? box.width + 'x' + box.height : 'unknown');
    await cta.click();
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/screenshots/pt-02-registration.png' });
  
  // Fill in name and submit
  const nameInput = page.locator('input[type="text"], input[placeholder]').first();
  if (await nameInput.isVisible()) {
    await nameInput.fill('TestPlayer');
  }
  await page.waitForTimeout(300);
  
  // Click the Done/Start button in registration
  const allBtns = page.locator('button');
  const count = await allBtns.count();
  console.log('Buttons visible:', count);
  for (let i = 0; i < count; i++) {
    const txt = await allBtns.nth(i).innerText().catch(() => '');
    console.log('  Button', i, ':', txt.trim());
  }
  
  // Try clicking the last visible button (usually submit)
  const submitBtns = page.locator('button').filter({ hasText: /start|done|continue|play|ready|let/i });
  const submitCount = await submitBtns.count();
  if (submitCount > 0) {
    await submitBtns.first().click();
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/screenshots/pt-03-countdown.png' });
  
  // Wait for countdown to finish
  await page.waitForTimeout(3500);
  await page.screenshot({ path: 'tests/screenshots/pt-04-playing.png' });
  
  // Check timer and score visibility
  const hudItems = await page.locator('[data-testid]').all();
  for (const item of hudItems) {
    const id = await item.getAttribute('data-testid');
    const txt = await item.innerText().catch(() => '');
    const box = await item.boundingBox();
    console.log('HUD item testId=' + id, 'text=' + txt.trim(), 'size=' + (box ? box.width + 'x' + box.height : 'n/a'));
  }
  
  console.log('JS errors:', errors);
  await browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
