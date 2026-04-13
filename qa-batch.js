/**
 * Glimmers Playwright QA Runner v2
 * Bypasses onboarding via localStorage, properly tests each game
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { GAME_IDS } = require('./qa-games.js');

const BASE_URL = 'http://localhost:3333';
const BATCH_SIZE = 10;
const RESULTS_FILE = path.join(__dirname, 'qa-results.json');
const SCREENSHOTS_DIR = path.join(__dirname, 'qa-screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// Load existing results if resuming
let results = [];
if (fs.existsSync(RESULTS_FILE)) {
  results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  console.log(`Resuming from ${results.length} existing results`);
}
const tested = new Set(results.map(r => r.game_id));

// Pre-seeded localStorage to bypass onboarding
const MOCK_USER = JSON.stringify({ name: 'QATester', firstName: 'QATester', avatar: '🎮' });

async function testGame(context, gameId) {
  const errors = [];
  const page = await context.newPage();

  // Inject localStorage BEFORE navigating
  await context.addInitScript(() => {
    localStorage.setItem('mg_user', JSON.stringify({ name: 'QATester', firstName: 'QATester', avatar: '🎮' }));
    localStorage.setItem('mg_consent', 'true');
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const txt = msg.text();
      // Filter noise
      if (!txt.includes('favicon') && !txt.includes('ERR_BLOCKED_BY_CLIENT') && !txt.includes('audiowavepro')) {
        errors.push(txt.substring(0, 200));
      }
    }
  });
  page.on('pageerror', e => {
    const txt = e.message;
    if (!txt.includes('ResizeObserver') && !txt.includes('Non-Error promise rejection')) {
      errors.push(txt.substring(0, 200));
    }
  });

  const url = `${BASE_URL}/games/${gameId}`;
  let navigated = false;

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    navigated = true;
  } catch (e) {
    errors.push(`Navigation failed: ${e.message.substring(0, 100)}`);
  }

  if (!navigated) {
    await page.close();
    return { game_id: gameId, verdict: 'BROKEN', errors, notes: 'Failed to navigate' };
  }

  // Check for 404 / redirect
  const finalUrl = page.url();
  const pageText = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  const isErrorPage = pageText.includes('404') || pageText.includes('This page could not be found');

  if (isErrorPage || !finalUrl.includes(`/games/${gameId}`)) {
    await page.close();
    return { game_id: gameId, verdict: 'BROKEN', errors: ['404 or redirect'], notes: '404 page' };
  }

  // Screenshot before interaction (should show the start screen)
  const beforePath = path.join(SCREENSHOTS_DIR, `${gameId}-before.png`);
  await page.screenshot({ path: beforePath }).catch(() => {});

  // Wait for start button and click it
  let startClicked = false;
  try {
    // Primary: data-testid="start-cta" (GameStartScreen's Start Game button)
    const startBtn = page.locator('[data-testid="start-cta"]');
    if (await startBtn.isVisible({ timeout: 3000 })) {
      await startBtn.click({ timeout: 2000 });
      startClicked = true;
    }
  } catch (e) {}

  if (!startClicked) {
    // Fallback: any button with start-ish text
    const startSelectors = ['button:has-text("Start")', 'button:has-text("Play")', 'button:has-text("Tap to Begin")'];
    for (const sel of startSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1000 })) {
          await el.click({ timeout: 1000 });
          startClicked = true;
          break;
        }
      } catch {}
    }
  }

  if (!startClicked) {
    // Last resort: click center
    const vp = page.viewportSize() || { width: 390, height: 844 };
    await page.mouse.click(vp.width / 2, vp.height / 2).catch(() => {});
    startClicked = true;
  }

  // Wait for countdown/game to start
  await page.waitForTimeout(3000);

  // Check if canvas appeared (games use THREE.js canvas or HTML canvas)
  const canvasCount = await page.locator('canvas').count();
  const canvasVisible = canvasCount > 0;

  // Screenshot after start
  const afterPath = path.join(SCREENSHOTS_DIR, `${gameId}-after.png`);
  await page.screenshot({ path: afterPath }).catch(() => {});

  // Simulate gameplay taps
  const vp = page.viewportSize() || { width: 390, height: 844 };
  const cx = vp.width / 2;
  const cy = vp.height / 2 + 100; // lower center (game area)
  const tapPositions = [
    [cx, cy], [cx - 80, cy + 50], [cx + 80, cy - 30],
    [cx + 40, cy + 80], [cx - 60, cy - 60],
  ];
  for (const [x, y] of tapPositions) {
    await page.mouse.click(x, y).catch(() => {});
    await page.waitForTimeout(300);
  }

  await page.waitForTimeout(2000);

  // Final screenshot
  const finalPath = path.join(SCREENSHOTS_DIR, `${gameId}-final.png`);
  await page.screenshot({ path: finalPath }).catch(() => {});

  // Check if anything changed (rough byte comparison)
  const beforeBuf = fs.existsSync(beforePath) ? fs.readFileSync(beforePath) : null;
  const afterBuf = fs.existsSync(afterPath) ? fs.readFileSync(afterPath) : null;
  const gameChanged = beforeBuf && afterBuf
    ? !beforeBuf.slice(200, 500).equals(afterBuf.slice(200, 500))
    : false;

  // Determine verdict
  let verdict = 'OK';
  let notes = '';

  const criticalErrors = errors.filter(e =>
    e.includes('TypeError') || e.includes('ReferenceError') ||
    e.includes('Cannot read') || e.includes('is not a function') ||
    e.includes('is not defined') || e.includes('Failed to fetch') ||
    e.includes('SyntaxError') || e.includes('Uncaught')
  );

  if (criticalErrors.length > 0) {
    verdict = 'BROKEN';
    notes = criticalErrors[0].substring(0, 120);
  } else if (!canvasVisible && !startClicked) {
    verdict = 'POOR';
    notes = 'Could not find or click start button';
  } else if (!gameChanged && canvasVisible) {
    // Canvas present but nothing changed after tapping
    verdict = 'POOR';
    notes = 'Canvas visible but no visual change after taps (may be stuck)';
  }

  // Additional: check if still on start screen (game never advanced)
  const stillOnStart = await page.locator('[data-testid="start-cta"]').isVisible().catch(() => false);
  if (stillOnStart && verdict === 'OK') {
    verdict = 'POOR';
    notes = 'Start button still visible after clicks — game did not advance';
  }

  await page.close();

  return {
    game_id: gameId,
    verdict,
    errors: errors.slice(0, 5),
    canvas_visible: canvasVisible,
    game_changed: gameChanged,
    start_clicked: startClicked,
    notes,
  };
}

async function runBatch(gameIds) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-web-security'],
  });

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    storageState: undefined,
  });

  // Inject localStorage on every new page
  await context.addInitScript(() => {
    try {
      localStorage.setItem('mg_user', JSON.stringify({ name: 'QATester', firstName: 'QATester', avatar: '🎮' }));
      localStorage.setItem('mg_consent', 'true');
    } catch(e) {}
  });

  try {
    for (const gameId of gameIds) {
      if (tested.has(gameId)) {
        console.log(`  Skipping ${gameId} (already tested)`);
        continue;
      }

      process.stdout.write(`  Testing: ${gameId} ... `);
      let result;
      try {
        result = await testGame(context, gameId);
      } catch (e) {
        result = {
          game_id: gameId,
          verdict: 'BROKEN',
          errors: [e.message.substring(0, 200)],
          notes: `Exception: ${e.message.substring(0, 80)}`,
        };
      }

      results.push(result);
      tested.add(gameId);

      const icon = result.verdict === 'OK' ? '✅' : result.verdict === 'POOR' ? '⚠️' : '❌';
      console.log(`${icon} ${result.verdict}${result.notes ? ' — ' + result.notes.substring(0, 80) : ''}`);

      fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const gamesToTest = GAME_IDS.filter(id => !tested.has(id));
  console.log(`\n🎮 Glimmers QA v2 — Testing ${gamesToTest.length} games\n`);

  for (let i = 0; i < gamesToTest.length; i += BATCH_SIZE) {
    const batch = gamesToTest.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(gamesToTest.length / BATCH_SIZE);
    console.log(`\n📦 Batch ${batchNum}/${totalBatches}`);
    await runBatch(batch);
  }

  // Summary
  const broken = results.filter(r => r.verdict === 'BROKEN');
  const poor = results.filter(r => r.verdict === 'POOR');
  const ok = results.filter(r => r.verdict === 'OK');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`QA COMPLETE — ${results.length} games tested`);
  console.log(`${'='.repeat(60)}`);
  console.log(`✅ OK:     ${ok.length}`);
  console.log(`⚠️  POOR:  ${poor.length}`);
  console.log(`❌ BROKEN: ${broken.length}`);

  if (broken.length > 0) {
    console.log(`\nBROKEN:`);
    broken.forEach(r => console.log(`  ❌ ${r.game_id}: ${r.notes || (r.errors[0] || 'unknown').substring(0, 100)}`));
  }
  if (poor.length > 0) {
    console.log(`\nPOOR:`);
    poor.forEach(r => console.log(`  ⚠️  ${r.game_id}: ${r.notes || 'no details'}`));
  }

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

main().catch(console.error);
