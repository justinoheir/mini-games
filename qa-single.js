/**
 * Tests a single game. Called as a subprocess.
 * Args: node qa-single.js <gameId>
 * Outputs JSON result to stdout.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const gameId = process.argv[2];
if (!gameId) { console.log(JSON.stringify({ error: 'no gameId' })); process.exit(0); }

const BASE_URL = 'http://localhost:3333';
const SCREENSHOTS_DIR = path.join(__dirname, 'qa-screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const MOCK_USER = JSON.stringify({
  firstName: 'QATester', lastName: 'Bot', email: 'qa@test.com',
  name: 'QATester Bot', avatar: '🎮', id: 'qa-001',
  timestamp: Date.now(), consented: true,
});

async function run() {
  const errors = [];
  let browser, ctx, page;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await ctx.newPage();

    page.on('console', m => {
      if (m.type() === 'error') {
        const t = m.text();
        if (!/favicon|ERR_BLOCKED|Failed to load resource|audiowavepro/.test(t)) {
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

    const pt = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    if (/404|could not be found/.test(pt)) {
      console.log(JSON.stringify({ game_id: gameId, verdict: 'BROKEN', errors: ['404'], notes: '404', canvas_visible: false }));
      return;
    }

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${gameId}-before.png`) }).catch(() => {});

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

    console.log(JSON.stringify({ game_id: gameId, verdict, errors: errors.slice(0,5), canvas_visible: canvasCount > 0, notes }));
  } catch(e) {
    console.log(JSON.stringify({ game_id: gameId, verdict: 'BROKEN', errors: [e.message.substring(0,200)], notes: e.message.substring(0,100), canvas_visible: false }));
  } finally {
    try { if (page) await page.close().catch(() => {}); } catch {}
    try { if (ctx) await ctx.close().catch(() => {}); } catch {}
    try { if (browser) await browser.close().catch(() => {}); } catch {}
  }
}

run().then(() => process.exit(0)).catch(() => process.exit(0));
