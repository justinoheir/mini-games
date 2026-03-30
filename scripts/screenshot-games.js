/**
 * screenshot-games.js
 * Takes gameplay screenshots of all (or specific) Glimmers games.
 *
 * Usage:
 *   node scripts/screenshot-games.js                 # screenshot all missing
 *   node scripts/screenshot-games.js --force         # re-screenshot everything
 *   node scripts/screenshot-games.js --game slam-dunk [--game tilt-maze ...]
 *   node scripts/screenshot-games.js --force --game slam-dunk
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'https://mini-games-green.vercel.app';
const OUT_DIR = path.join(__dirname, '../public/thumbnails');
const VIEWPORT = { width: 390, height: 560 };
const CONCURRENCY = 4;

// Parse CLI flags
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const gameArgIdx = args.indexOf('--game');
let TARGET_GAMES = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--game' && args[i + 1]) {
    TARGET_GAMES.push(args[i + 1]);
    i++;
  }
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Get all game IDs from the games directory
const gamesDir = path.join(__dirname, '../app/games');
const allGameIds = fs.readdirSync(gamesDir).filter(d => {
  if (d === '__scaffold__') return false;
  return fs.statSync(path.join(gamesDir, d)).isDirectory();
});

const gameIds = TARGET_GAMES.length > 0
  ? TARGET_GAMES.filter(id => allGameIds.includes(id))
  : allGameIds;

// Stored demo user that bypasses registration
const DEMO_USER = JSON.stringify({
  name: 'Demo',
  firstName: 'Demo',
  lastName: '',
  email: 'demo@ether.com',
  avatar: '⚡',
  consented: true,
  id: 'demo-screenshot',
});

async function screenshotGame(page, gameId) {
  const outPath = path.join(OUT_DIR, `${gameId}.jpg`);
  if (!FORCE && fs.existsSync(outPath)) {
    process.stdout.write(`  skip ${gameId}\n`);
    return;
  }

  try {
    // Inject stored user before page load so the start screen (not name input) shows
    await page.addInitScript(`
      localStorage.setItem('mg_user', ${JSON.stringify(DEMO_USER)});
    `);

    await page.goto(`${BASE_URL}/games/${gameId}`, {
      waitUntil: 'networkidle',
      timeout: 15000,
    });

    // Wait for start screen to fully render (animations settle)
    await page.waitForTimeout(1200);

    // Step 1: Click the Start CTA
    const cta = page.locator('[data-testid="start-cta"]');
    const ctaVisible = await cta.isVisible({ timeout: 3000 }).catch(() => false);
    if (ctaVisible) {
      await cta.click({ force: true, timeout: 5000 });
      // Step 2: Always try to click the welcome-continue button.
      // We use force:true so Framer Motion opacity animations don't block the click.
      // If there's no welcome screen, the click just fails silently.
      await page.locator('[data-testid="reg-welcome-continue"]')
        .click({ force: true, timeout: 3000 })
        .catch(() => { /* no welcome screen — start screen went straight to countdown */ });

      // Wait through the countdown (3, 2, 1, GO! ≈ 2.2s) + gameplay settle
      await page.waitForTimeout(3800);
    } else {
      // No CTA found — custom start screen, just capture what's there
      await page.waitForTimeout(2000);
    }

    await page.screenshot({
      path: outPath,
      type: 'jpeg',
      quality: 88,
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    });

    process.stdout.write(`  ✅ ${gameId}\n`);
  } catch (e) {
    process.stdout.write(`  ❌ ${gameId}: ${e.message.slice(0, 80)}\n`);
  }
}

async function runBatch(browser, batch) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    permissions: ['notifications', 'camera', 'microphone'],
    // Mute audio to avoid any audio errors
    bypassCSP: true,
  });

  // Grant device motion/orientation for games that need it
  await context.grantPermissions(['notifications']);

  const page = await context.newPage();

  // Silence console noise
  page.on('console', () => {});
  page.on('pageerror', () => {});

  for (const gameId of batch) {
    await screenshotGame(page, gameId);
    // Reset init script between games
    await page.addInitScript(`
      localStorage.setItem('mg_user', ${JSON.stringify(DEMO_USER)});
    `);
  }

  await context.close();
}

async function main() {
  const label = FORCE ? '(force)' : '(skip existing)';
  console.log(`\n📸 Screenshotting ${gameIds.length} games ${label}, ${CONCURRENCY} concurrent...\n`);

  const browser = await chromium.launch({ headless: true });

  // Split into batches
  const batchSize = Math.ceil(gameIds.length / CONCURRENCY);
  const batches = [];
  for (let i = 0; i < gameIds.length; i += batchSize) {
    batches.push(gameIds.slice(i, i + batchSize));
  }

  await Promise.all(batches.map(batch => runBatch(browser, batch)));
  await browser.close();

  const count = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.jpg')).length;
  console.log(`\n✅ Done — ${count} thumbnails in public/thumbnails/\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
