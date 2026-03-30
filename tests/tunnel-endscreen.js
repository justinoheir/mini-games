const { chromium, devices } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const iPhone = devices['iPhone 14'];
  const context = await browser.newContext({ ...iPhone });
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    (window).__DISABLE_AUDIO = true;
    localStorage.setItem('seen_tunnel', '1');
    localStorage.setItem('mg_user', JSON.stringify({
      name: 'QA Tester', avatar: '🎮', id: 'qa-test', timestamp: Date.now(), consented: true
    }));
  });
  
  await page.goto('http://localhost:3000/games/tunnel');
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);
  
  // Start the game
  const startBtn = page.locator('[data-testid="start-cta"]').or(
    page.locator('button').filter({ hasText: /launch|start|play/i })
  ).first();
  await startBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
  
  const continueBtnById = page.locator('[data-testid="reg-welcome-continue"]');
  const continueBtnByText = page.locator('button').filter({ hasText: /^continue/i }).first();
  const continueLocator = continueBtnById.or(continueBtnByText).first();
  try { await continueLocator.click({ force: true, timeout: 2000 }); } catch {}
  await page.waitForTimeout(300);

  const consentBtn = page.locator('[data-testid="reg-consent-agree"]').or(
    page.locator('button').filter({ hasText: /agree.*play/i })).first();
  try { await consentBtn.click({ force: true, timeout: 1000 }); } catch {}
  await page.waitForTimeout(1000);
  
  // Wait for game to start (countdown + playing)
  await page.waitForTimeout(5000);
  
  // Fast-forward the timer by manipulating React state
  await page.evaluate(() => {
    // Find the react fiber to manipulate state
    const fakeEnd = () => {
      // Dispatch custom event to trigger game end
      window.dispatchEvent(new CustomEvent('qa_force_end'));
    };
    // Try to find stateRef and set timeLeft to 0
    // Use a different approach - manipulate document time
    fakeEnd();
  });
  
  // Wait and see if end screen appears
  await page.waitForTimeout(2000);
  
  // Check if already ended; if not, try manual manipulation via exposed functions
  let endFound = await page.locator('[data-testid="end-screen"]').isVisible({ timeout: 1000 }).catch(() => false);
  
  if (!endFound) {
    // Try to directly set the timer to 0 via global state manipulation
    await page.evaluate(() => {
      // Access Next.js page's stateRef via __reactFiber
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const keys = Object.keys(el).filter(k => k.startsWith('__reactFiber'));
        for (const key of keys) {
          try {
            const fiber = (el as any)[key];
            // Walk fiber tree to find the game component
            let f = fiber;
            while (f) {
              if (f.memoizedState && f.memoizedState.queue) {
                // Found useState hook
              }
              f = f.return;
            }
          } catch {}
        }
      }
    });
    await page.waitForTimeout(1000);
  }
  
  // Just wait for actual game to end (up to 65 seconds total)
  console.log('Waiting for game to end naturally...');
  const endLocator = page.locator('[data-testid="end-screen"]').or(
    page.locator('button').filter({ hasText: /play again/i })
  ).first();
  
  await endLocator.waitFor({ timeout: 70000 }).catch(() => {
    console.log('End screen did not appear in time');
  });
  
  const isEnd = await endLocator.isVisible({ timeout: 1000 }).catch(() => false);
  if (isEnd) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tests/screenshots/tunnel-qa-endscreen.png', fullPage: false });
    console.log('End screen screenshot taken!');
  } else {
    console.log('Could not reach end screen');
  }
  
  await browser.close();
})();
