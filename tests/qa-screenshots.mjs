import { chromium, devices } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:3000';
const GAME_ID = 'breath-rider';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

async function prepareStorage(page) {
  // Set up a returning, consented user so we can skip registration
  await page.evaluate(() => {
    localStorage.setItem('seen_breath-rider', '1');
    localStorage.setItem('mg_user', JSON.stringify({
      firstName: 'QA',
      lastName: 'Tester',
      email: 'qa@ether.com',
      name: 'QA Tester',
      avatar: '🦁',
      id: 'qa-test-id',
      consented: true,
    }));
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  
  // === Screenshot 1: SwipeInstructions (clear localStorage first) ===
  {
    const ctx = await browser.newContext({ ...devices['iPhone 14'] });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/games/${GAME_ID}`);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/01-swipe-instructions.png` });
    console.log('1. SwipeInstructions done');
    await ctx.close();
  }

  // === Screenshots 2-7: with pre-stored user ===
  {
    const ctx = await browser.newContext({
      ...devices['iPhone 14'],
      permissions: ['microphone'],
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/games/${GAME_ID}`);
    await prepareStorage(page);
    await page.reload();
    await page.waitForTimeout(2000);

    // 2. Start screen (no registration overlay)
    await page.screenshot({ path: `${OUT}/02-start-screen.png` });
    console.log('2. Start screen done');

    // Click CTA — this opens PlayerNameInput "welcome" step
    const cta = page.getByTestId('start-cta');
    await cta.waitFor({ state: 'visible', timeout: 5000 });
    await cta.click({ force: true });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/03-registration.png` });
    console.log('3. Registration/welcome done');

    // Continue from welcome (user is consented, goes straight to game)
    const continueBtn = page.getByTestId('reg-welcome-continue');
    if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await continueBtn.click();
      await page.waitForTimeout(600);
    }

    // 4. Should be in countdown or requesting mic
    await page.screenshot({ path: `${OUT}/04-requesting-or-countdown.png` });
    console.log('4. After start done');

    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT}/05-countdown.png` });
    console.log('5. Countdown done');

    // Wait for playing phase
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/06-playing-early.png` });
    console.log('6. Playing early done');

    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${OUT}/07-playing-active.png` });
    console.log('7. Playing active done');

    // Wait for game to end (60s game - use touch fallback and hold)
    // Fast-forward: inject timeLeft to 0
    await page.evaluate(() => {
      // Trigger game end by simulating time expiration - this needs the game's internals
      // For now, just wait for the game to end naturally isn't feasible
      // Instead, let's just screenshot what we have
    });
    
    await ctx.close();
  }

  await browser.close();
  console.log('All screenshots done');
})();
