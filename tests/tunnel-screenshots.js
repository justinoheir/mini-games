// Quick screenshot capture for tunnel game QA
const { chromium, devices } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const iPhone = devices['iPhone 14'];
  
  const context = await browser.newContext({
    ...iPhone,
  });
  
  const page = await context.newPage();
  
  // Set up localStorage + disable audio
  await page.addInitScript(() => {
    (window).__DISABLE_AUDIO = true;
    localStorage.setItem('seen_tunnel', '1');
    localStorage.setItem('mg_user', JSON.stringify({
      name: 'QA Tester', avatar: '🎮', id: 'qa-test', timestamp: Date.now(), consented: true
    }));
  });
  
  // Navigate to tunnel game
  await page.goto('http://localhost:3000/games/tunnel');
  await page.waitForLoadState('load');
  await page.waitForTimeout(3000);
  
  // Screenshot 1: Start screen
  await page.screenshot({ path: 'tests/screenshots/tunnel-qa-start.png', fullPage: false });
  console.log('Screenshot 1: Start screen taken');
  
  // Click Start (Launch) button
  const startBtn = page.locator('[data-testid="start-cta"]').or(
    page.locator('button').filter({ hasText: /launch|start|play/i })
  ).first();
  
  if (await startBtn.isVisible({ timeout: 3000 })) {
    await startBtn.click({ force: true });
    await page.waitForTimeout(500);
  }
  
  // Handle continue button (returning user)
  const continueBtn = page.locator('[data-testid="reg-welcome-continue"]').or(
    page.locator('button').filter({ hasText: /^continue/i })
  ).first();
  if (await continueBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await continueBtn.click({ force: true });
    await page.waitForTimeout(500);
  }
  
  // Handle consent button
  const consentBtn = page.locator('[data-testid="reg-consent-agree"]').or(
    page.locator('button').filter({ hasText: /agree.*play/i })
  ).first();
  if (await consentBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await consentBtn.click({ force: true });
    await page.waitForTimeout(500);
  }
  
  await page.waitForTimeout(1500);
  
  // Screenshot 2: Countdown
  await page.screenshot({ path: 'tests/screenshots/tunnel-qa-countdown.png', fullPage: false });
  console.log('Screenshot 2: Countdown taken');
  
  // Wait for playing phase
  await page.waitForTimeout(5000);
  
  // Screenshot 3: Playing phase
  await page.screenshot({ path: 'tests/screenshots/tunnel-qa-playing.png', fullPage: false });
  console.log('Screenshot 3: Playing phase taken');
  
  // Fast-forward timer by manipulating timeLeft
  await page.evaluate(() => {
    (window).__fastForward = true;
  });
  
  // Wait for game to fast-forward to end (wait for end screen)
  // Try to find end screen or speed up
  let endFound = false;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(3000);
    const endScreen = page.locator('[data-testid="end-screen"]');
    if (await endScreen.isVisible({ timeout: 1000 }).catch(() => false)) {
      endFound = true;
      break;
    }
    // Check if play again button visible
    const playAgain = page.locator('button').filter({ hasText: /play again/i });
    if (await playAgain.isVisible({ timeout: 500 }).catch(() => false)) {
      endFound = true;
      break;
    }
  }
  
  if (endFound) {
    await page.screenshot({ path: 'tests/screenshots/tunnel-qa-endscreen.png', fullPage: false });
    console.log('Screenshot 4: End screen taken');
  } else {
    console.log('End screen not reached within timeout');
  }
  
  await browser.close();
  console.log('Done');
})();
