const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'https://mini-games-green.vercel.app';
const PAGES = [
  { name: 'landing', url: '/' },
  { name: 'tilt-maze', url: '/games/tilt-maze' },
  { name: 'whisper-bomb', url: '/games/whisper-bomb' },
  { name: 'breath-rider', url: '/games/breath-rider' },
  { name: 'steady-hand', url: '/games/steady-hand' },
  { name: 'tunnel', url: '/games/tunnel' },
];

const screenshotDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir);

async function testPage(browser, { name, url }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  });

  const errors = [];
  const warnings = [];
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  page.on('pageerror', err => errors.push(`[PAGE ERROR] ${err.message}`));

  const fullUrl = BASE_URL + url;
  try {
    await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Screenshot initial state
    await page.screenshot({ path: path.join(screenshotDir, `${name}-initial.png`), fullPage: false });
    console.log(`  ✓ ${name} - page loaded`);

    // Check for blank screen (all black/empty)
    const bodyText = await page.evaluate(() => document.body.innerText.trim());
    const hasContent = bodyText.length > 0;
    console.log(`  Content present: ${hasContent} (${bodyText.substring(0, 100).replace(/\n/g, ' ')})`);

    // Try clicking the main button (Start/Launch/Allow Mic)
    if (name !== 'landing') {
      const btn = page.locator('button').first();
      const btnText = await btn.textContent().catch(() => '');
      console.log(`  Button found: "${btnText}"`);

      // Click start button (won't trigger mic/accel but tests click handler)
      await btn.click().catch(e => console.log(`  Button click failed: ${e.message}`));
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(screenshotDir, `${name}-after-click.png`), fullPage: false });
    } else {
      // Test landing page links
      const links = await page.locator('a').count();
      console.log(`  Links on landing: ${links}`);
    }

  } catch (err) {
    console.log(`  ERROR loading ${fullUrl}: ${err.message}`);
    errors.push(err.message);
  }

  await context.close();
  return { name, url, errors, warnings };
}

async function main() {
  console.log('Starting Playwright tests...\n');
  const browser = await chromium.launch({ headless: true });

  const results = [];
  for (const page of PAGES) {
    console.log(`Testing: ${page.name} (${page.url})`);
    const result = await testPage(browser, page);
    results.push(result);
    console.log(`  Errors: ${result.errors.length}, Warnings: ${result.warnings.length}`);
    if (result.errors.length > 0) {
      result.errors.forEach(e => console.log(`    ❌ ${e}`));
    }
    console.log('');
  }

  await browser.close();

  console.log('\n=== SUMMARY ===');
  results.forEach(r => {
    const status = r.errors.length === 0 ? '✅' : '❌';
    console.log(`${status} ${r.name}: ${r.errors.length} errors, ${r.warnings.length} warnings`);
  });

  // Save results
  fs.writeFileSync(path.join(__dirname, 'test-results.json'), JSON.stringify(results, null, 2));
  console.log('\nResults saved to test-results.json');
  console.log('Screenshots saved to screenshots/');
}

main().catch(console.error);
