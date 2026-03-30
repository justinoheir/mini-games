import { chromium, devices } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:3000';
const GAME_ID = 'breath-rider';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    ...devices['iPhone 14'],
    permissions: ['microphone'],
  });
  const page = await ctx.newPage();
  
  // Set up consented user + skip instructions
  await page.goto(`${BASE_URL}/games/${GAME_ID}`);
  await page.evaluate(() => {
    localStorage.setItem('seen_breath-rider', '1');
    localStorage.setItem('mg_user', JSON.stringify({
      firstName: 'QA', lastName: 'Tester', email: 'qa@ether.com',
      name: 'QA Tester', avatar: '🦁', id: 'qa-test-id', consented: true,
    }));
  });
  await page.reload();
  await page.waitForTimeout(2000);

  // Click CTA and continue
  const cta = page.getByTestId('start-cta');
  await cta.waitFor({ state: 'visible', timeout: 5000 });
  await cta.click({ force: true });
  await page.waitForTimeout(800);
  
  const continueBtn = page.getByTestId('reg-welcome-continue');
  if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await continueBtn.click();
  }
  
  // Wait for countdown to finish and game to start
  await page.waitForTimeout(3500);
  
  // Check if we're in playing phase
  const hud = page.locator('[data-testid="hud"]');
  const isPlaying = await hud.isVisible({ timeout: 2000 }).catch(() => false);
  console.log('Is in playing phase:', isPlaying);

  // Simulate holding screen to gain altitude  
  // Hold the screen for a bit
  await page.mouse.down();
  await page.waitForTimeout(1000);
  await page.mouse.up();

  // Fast forward time by manipulating the game's internal state
  // Wait for 65 seconds naturally is too long — instead inject the end
  // The game loop uses setInterval for the timer, let's override timeLeft
  const endTriggered = await page.evaluate(() => {
    // Try to access the game's timer via DOM
    // We'll inject a custom timeout that fires much sooner
    return true;
  });

  // Just wait for game end - simulate pointerdown to keep flying then let it end
  // Since we have touch fallback, hold down and collect coins
  const canvas = page.locator('canvas');
  const isCanvasVisible = await canvas.isVisible({ timeout: 2000 }).catch(() => false);
  console.log('Canvas visible:', isCanvasVisible);

  if (isCanvasVisible) {
    // Simulate touch to keep character flying
    const bbox = await canvas.boundingBox();
    if (bbox) {
      // Simulate holding to fly
      await page.mouse.move(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(2000);
      await page.mouse.up();
    }
  }

  // Take a screenshot at different timer points
  await page.screenshot({ path: `${OUT}/08-playing-midgame.png` });
  console.log('8. Mid-game screenshot done');

  // We need the end screen - use time manipulation
  // Inject time acceleration by re-firing the timer
  await page.evaluate(() => {
    // Can't easily access React internals, but we can simulate it
    // by setting a shorter timeout and dispatching events
    // Instead, accelerate by hiding the actual time via window override
  });

  // Wait for natural end (need to check total time = game start + 60s)
  // Since we started at ~5s in, need to wait ~55s more
  // Too long - let's wait 55 seconds
  console.log('Waiting for game end (55s)...');
  
  // Instead let's check mid-game at various points  
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(5000);
    const timerVal = await page.locator('[data-testid="timer"]').textContent({ timeout: 1000 }).catch(() => '');
    const scoreVal = await page.locator('[data-testid="score"]').textContent({ timeout: 1000 }).catch(() => '');
    console.log(`Time: ${timerVal}, Score: ${scoreVal}`);
    
    // Hold screen occasionally
    if (isCanvasVisible) {
      const bbox = await canvas.boundingBox().catch(() => null);
      if (bbox) {
        await page.mouse.down();
        await page.waitForTimeout(800);
        await page.mouse.up();
      }
    }
    
    // Check if game is done
    const isDone = await page.locator('[data-testid="end-screen"]').isVisible({ timeout: 500 }).catch(() => false);
    if (isDone) {
      console.log('Game ended!');
      break;
    }
  }
  
  // Take end screen screenshot
  await page.screenshot({ path: `${OUT}/09-end-screen.png` });
  console.log('9. End screen screenshot done');

  await browser.close();
  console.log('Done!');
})();
