/**
 * Glimmers Playwright QA Runner
 * Tests games in batches of 10, records verdicts
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { GAME_IDS } = require('./qa-games.js');

const BASE_URL = 'http://localhost:3333';
const BATCH_SIZE = 10;
const RESULTS_FILE = path.join(__dirname, 'qa-results.json');
const SCREENSHOTS_DIR = path.join(__dirname, 'qa-screenshots');

// Create screenshots dir
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// Load existing results if resuming
let results = [];
if (fs.existsSync(RESULTS_FILE)) {
  results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  console.log(`Resuming from ${results.length} existing results`);
}
const tested = new Set(results.map(r => r.game_id));

async function testGame(page, gameId) {
  const errors = [];
  const warnings = [];
  
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  page.on('pageerror', e => errors.push(e.message));

  const url = `${BASE_URL}/games/${gameId}`;
  let navigated = false;
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    navigated = true;
  } catch (e) {
    errors.push(`Navigation failed: ${e.message}`);
  }

  if (!navigated) {
    return { game_id: gameId, verdict: 'BROKEN', errors, warnings, notes: 'Failed to navigate' };
  }

  // Check if page redirected (game doesn't exist)
  const finalUrl = page.url();
  if (!finalUrl.includes(`/games/${gameId}`)) {
    return { game_id: gameId, verdict: 'BROKEN', errors: ['Page redirected away - game may not exist'], warnings, notes: `Redirected to ${finalUrl}` };
  }

  // Check for canvas
  const canvasVisible = await page.locator('canvas').count() > 0;
  
  // Screenshot before interaction
  const beforePath = path.join(SCREENSHOTS_DIR, `${gameId}-before.png`);
  await page.screenshot({ path: beforePath, fullPage: false }).catch(() => {});

  // Get before screenshot as base64 for comparison
  const beforeBuffer = fs.existsSync(beforePath) ? fs.readFileSync(beforePath) : null;

  // Try to find and click start button
  let startClicked = false;
  const startSelectors = [
    'button:has-text("Start")',
    'button:has-text("Play")',
    'button:has-text("Tap")',
    '[data-start]',
    '.start-btn',
    '#start',
  ];
  
  for (const sel of startSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 })) {
        await el.click({ timeout: 1000 });
        startClicked = true;
        break;
      }
    } catch (e) {}
  }

  // If no start button found, click center of canvas or body
  if (!startClicked) {
    try {
      const vp = page.viewportSize() || { width: 390, height: 844 };
      await page.mouse.click(vp.width / 2, vp.height / 2);
      startClicked = true;
    } catch (e) {}
  }

  await page.waitForTimeout(2000);

  // Screenshot after first interaction
  const afterPath = path.join(SCREENSHOTS_DIR, `${gameId}-after.png`);
  await page.screenshot({ path: afterPath, fullPage: false }).catch(() => {});

  // Rapid taps to simulate gameplay
  try {
    const vp = page.viewportSize() || { width: 390, height: 844 };
    const cx = vp.width / 2;
    const cy = vp.height / 2;
    for (let i = 0; i < 5; i++) {
      await page.mouse.click(cx + (Math.random() - 0.5) * 100, cy + (Math.random() - 0.5) * 100);
      await page.waitForTimeout(200);
    }
  } catch (e) {}

  await page.waitForTimeout(2000);

  // Final screenshot
  const finalPath = path.join(SCREENSHOTS_DIR, `${gameId}-final.png`);
  await page.screenshot({ path: finalPath, fullPage: false }).catch(() => {});

  // Simple pixel diff check: compare before vs after (rough size comparison)
  const afterBuffer = fs.existsSync(afterPath) ? fs.readFileSync(afterPath) : null;
  const gameChanged = beforeBuffer && afterBuffer 
    ? beforeBuffer.length !== afterBuffer.length || 
      !beforeBuffer.slice(100, 200).equals(afterBuffer.slice(100, 200))
    : false;

  // Check for blank/error page content
  const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
  const isErrorPage = pageText.includes('404') || pageText.includes('This page could not be found') || pageText.toLowerCase().includes('not found');

  // Determine verdict
  let verdict = 'OK';
  let notes = '';

  if (isErrorPage) {
    verdict = 'BROKEN';
    notes = '404 / Not Found page';
  } else if (errors.length > 0) {
    const criticalErrors = errors.filter(e => 
      !e.includes('favicon') && 
      !e.includes('net::ERR_ABORTED') &&
      !e.includes('Failed to load resource: net::ERR_BLOCKED_BY_CLIENT')
    );
    if (criticalErrors.length > 0) {
      verdict = 'BROKEN';
      notes = `Console errors: ${criticalErrors.slice(0, 3).join(' | ')}`;
    }
  }

  if (verdict === 'OK' && !canvasVisible) {
    // Check if it's an HTML game (no canvas needed)
    const hasGameElements = await page.locator('[class*="game"], [id*="game"], .game-container').count() > 0;
    if (!hasGameElements) {
      verdict = 'POOR';
      notes = 'No canvas and no game elements found';
    }
  }

  if (verdict === 'OK' && !gameChanged && canvasVisible) {
    // Canvas present but nothing changed - might be broken
    notes = 'Canvas visible but may not have changed (could still be OK for static-start games)';
  }

  return {
    game_id: gameId,
    verdict,
    errors: errors.filter(e => !e.includes('favicon') && !e.includes('ERR_BLOCKED_BY_CLIENT')),
    warnings: warnings.slice(0, 3),
    canvas_visible: canvasVisible,
    game_changed: gameChanged,
    start_clicked: startClicked,
    is_error_page: isErrorPage,
    notes,
  };
}

async function runBatch(gameIds) {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    for (const gameId of gameIds) {
      if (tested.has(gameId)) {
        console.log(`  Skipping ${gameId} (already tested)`);
        continue;
      }
      
      console.log(`  Testing: ${gameId}`);
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
      });
      const page = await context.newPage();
      
      let result;
      try {
        result = await testGame(page, gameId);
      } catch (e) {
        result = { 
          game_id: gameId, 
          verdict: 'BROKEN', 
          errors: [e.message], 
          warnings: [],
          notes: `Test threw exception: ${e.message}` 
        };
      }
      
      results.push(result);
      tested.add(gameId);
      
      const icon = result.verdict === 'OK' ? '✅' : result.verdict === 'POOR' ? '⚠️' : '❌';
      console.log(`  ${icon} ${gameId}: ${result.verdict}${result.notes ? ' — ' + result.notes.substring(0, 80) : ''}`);
      
      // Save after each game
      fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
      
      await page.close();
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  const gamesToTest = GAME_IDS.filter(id => !tested.has(id));
  console.log(`\n🎮 Glimmers QA — Testing ${gamesToTest.length} games (${GAME_IDS.length} total)\n`);
  
  // Run in batches
  for (let i = 0; i < gamesToTest.length; i += BATCH_SIZE) {
    const batch = gamesToTest.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(gamesToTest.length / BATCH_SIZE);
    console.log(`\n📦 Batch ${batchNum}/${totalBatches}: ${batch.join(', ')}`);
    await runBatch(batch);
  }
  
  // Summary
  const broken = results.filter(r => r.verdict === 'BROKEN');
  const poor = results.filter(r => r.verdict === 'POOR');
  const ok = results.filter(r => r.verdict === 'OK');
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`QA COMPLETE`);
  console.log(`${'='.repeat(60)}`);
  console.log(`✅ OK:     ${ok.length}`);
  console.log(`⚠️  POOR:  ${poor.length}`);
  console.log(`❌ BROKEN: ${broken.length}`);
  console.log(`\nBROKEN games:`);
  broken.forEach(r => console.log(`  - ${r.game_id}: ${r.notes || r.errors[0] || 'unknown'}`));
  console.log(`\nPOOR games:`);
  poor.forEach(r => console.log(`  - ${r.game_id}: ${r.notes}`));
  
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${RESULTS_FILE}`);
}

main().catch(console.error);
