/**
 * Glimmers Playwright QA Runner v6
 * Shared browser, isolated contexts per game
 * Restarts browser every N games to avoid memory issues
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { GAME_IDS } = require('./qa-games.js');

const BASE_URL = 'http://localhost:3333';
const RESULTS_FILE = path.join(__dirname, 'qa-results.json');
const SCREENSHOTS_DIR = path.join(__dirname, 'qa-screenshots');
const RESTART_EVERY = 20; // restart browser every N games

if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

process.on('unhandledRejection', () => {});

let results = [];
if (fs.existsSync(RESULTS_FILE)) {
  try { results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')); } catch { results = []; }
  if (results.length) console.log(`Resuming: ${results.length} already tested`);
}
const tested = new Set(results.map(r => r.game_id));

const MOCK_USER = JSON.stringify({
  firstName: 'QATester', lastName: 'Bot', email: 'qa@test.com',
  name: 'QATester Bot', avatar: '🎮', id: 'qa-001',
  timestamp: Date.now(), consented: true,
});

function save() { fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2)); }

async function launchBrowser() {
  return chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
           '--disable-gpu', '--no-first-run', '--disable-extensions'],
    timeout: 20000,
  });
}

async function testGame(browser, gameId) {
  const errors = [];
  let ctx, page;
  try {
    ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await ctx.newPage();

    page.on('console', m => {
      if (m.type() === 'error') {
        const t = m.text();
        if (!/favicon|ERR_BLOCKED|Failed to load resource|audiowavepro|download/.test(t)) {
          errors.push(t.substring(0, 200));
        }
      }
    });
    page.on('pageerror', e => {
      const m = e.message;
      if (!/ResizeObserver|Non-Error|Script error/.test(m)) errors.push(m.substring(0, 200));
    });

    await page.goto(`${BASE_URL}/games/${gameId}`, { waitUntil: 'domcontentloaded', timeout: 12000 });
    await page.evaluate((u) => { localStorage.setItem('mg_user', u); }, MOCK_USER);
    await page.waitForTimeout(1200);

    // 404 check
    const pt = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    if (/404|could not be found/.test(pt)) {
      return { game_id: gameId, verdict: 'BROKEN', errors: ['404'], notes: '404', canvas_visible: false };
    }

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${gameId}-before.png`) }).catch(() => {});

    // Start flow
    const hasStart = await page.locator('[data-testid="start-cta"]').count() > 0;
    if (hasStart) {
      await page.evaluate(() => document.querySelector('[data-testid="start-cta"]')?.click());
      await page.waitForTimeout(700);
      const hasWelcome = await page.locator('[data-testid="reg-welcome-continue"]').count() > 0;
      if (hasWelcome) {
        await page.evaluate(() => document.querySelector('[data-testid="reg-welcome-continue"]')?.click());
      } else {
        await page.evaluate(() => document.querySelector('[data-testid="reg-consent-agree"]')?.click());
      }
      await page.waitForTimeout(300);
    }

    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${gameId}-after.png`) }).catch(() => {});

    const canvasCount = await page.locator('canvas').count();

    // Taps
    for (let i = 0; i < 4; i++) {
      await page.mouse.click(195 + (Math.random()-0.5)*100, 500 + (Math.random()-0.5)*100).catch(() => {});
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${gameId}-final.png`) }).catch(() => {});

    const stillStart = await page.locator('[data-testid="start-cta"]').count() > 0;
    const stillWelcome = await page.locator('[data-testid="reg-welcome-continue"]').count() > 0;

    let verdict = 'OK', notes = '';
    const critical = errors.filter(e => /TypeError|ReferenceError|Cannot read|is not a function|is not defined|SyntaxError|Cannot set|Cannot assign/.test(e));

    if (critical.length > 0) {
      verdict = 'BROKEN'; notes = critical[0].substring(0, 120);
    } else if (stillStart || stillWelcome) {
      verdict = 'POOR'; notes = 'Stuck on start screen';
    } else if (canvasCount === 0 && hasStart) {
      const bodyLen = await page.evaluate(() => document.body?.innerText?.length ?? 0).catch(() => 0);
      if (bodyLen < 50) { verdict = 'POOR'; notes = 'No canvas and minimal content'; }
    }

    return { game_id: gameId, verdict, errors: errors.slice(0, 5), canvas_visible: canvasCount > 0, notes };

  } catch(e) {
    return { game_id: gameId, verdict: 'BROKEN', errors: [e.message.substring(0,200)], notes: e.message.substring(0,100), canvas_visible: false };
  } finally {
    try { if (page) await page.close().catch(() => {}); } catch {}
    try { if (ctx) await ctx.close().catch(() => {}); } catch {}
  }
}

async function main() {
  const remaining = GAME_IDS.filter(id => !tested.has(id));
  console.log(`\n🎮 Glimmers QA v6 — ${remaining.length} remaining\n`);

  let browser = await launchBrowser();
  let gamesThisBrowser = 0;

  for (let i = 0; i < remaining.length; i++) {
    const gameId = remaining[i];

    // Restart browser periodically
    if (gamesThisBrowser >= RESTART_EVERY) {
      try { await browser.close(); } catch {}
      await new Promise(r => setTimeout(r, 1000));
      browser = await launchBrowser();
      gamesThisBrowser = 0;
      console.log(`  [Browser restarted]`);
    }

    process.stdout.write(`[${i+1}/${remaining.length}] ${gameId} ... `);
    
    let result;
    try {
      result = await testGame(browser, gameId);
    } catch(e) {
      // Browser might have died — restart
      try { await browser.close(); } catch {}
      await new Promise(r => setTimeout(r, 2000));
      browser = await launchBrowser();
      gamesThisBrowser = 0;
      // Retry once
      try {
        result = await testGame(browser, gameId);
      } catch(e2) {
        result = { game_id: gameId, verdict: 'BROKEN', errors: [e2.message], notes: e2.message.substring(0,80), canvas_visible: false };
      }
    }

    gamesThisBrowser++;
    results.push(result);
    tested.add(gameId);
    save();

    const icon = result.verdict === 'OK' ? '✅' : result.verdict === 'POOR' ? '⚠️' : '❌';
    console.log(`${icon}${result.notes ? ' — ' + result.notes.substring(0, 60) : ''}`);
  }

  try { await browser.close(); } catch {}

  const broken = results.filter(r => r.verdict === 'BROKEN');
  const poor = results.filter(r => r.verdict === 'POOR');
  const ok = results.filter(r => r.verdict === 'OK');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ OK: ${ok.length}  ⚠️ POOR: ${poor.length}  ❌ BROKEN: ${broken.length}`);
  if (broken.length) {
    console.log(`\nBROKEN:`);
    broken.forEach(r => console.log(`  ❌ ${r.game_id}: ${(r.notes||r.errors[0]||'').substring(0,90)}`));
  }
  if (poor.length) {
    console.log(`\nPOOR:`);
    poor.forEach(r => console.log(`  ⚠️  ${r.game_id}: ${r.notes||''}`));
  }
  save();
}

main().catch(e => { console.error('FATAL:', e.message); save(); });
