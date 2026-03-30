/**
 * Reaction Chain — Full QA phase screenshots
 * Properly navigates: Instructions → Registration → GameStart → Countdown → Playing → End
 */
import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:3000/games/reaction-chain';
const OUT_DIR = 'C:/Users/justi/.openclaw/workspace/mini-games/tests/screenshots';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});

const page = await context.newPage();
await page.addInitScript(() => {
  window.__DISABLE_AUDIO = true;
  const orig = window.setInterval.bind(window);
  window.setInterval = (fn, ms, ...args) => {
    if (ms === 1000) return orig(fn, 67, ...args); // 15x speed for timer
    return orig(fn, ms, ...args);
  };
});
page.on('pageerror', err => console.error('JS ERROR:', err.message));

await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

// ─── Phase 1: Instructions ────────────────────────────────────────────────────
await page.screenshot({ path: `${OUT_DIR}/rc-1-instructions.png` });
console.log('✓ Phase 1: instructions slide 1');

// Click through 3 instruction slides (Next, Next, Play)
for (let i = 0; i < 4; i++) {
  const btns = await page.locator('button').all();
  let forwardBtn = null;
  for (const btn of btns) {
    const txt = (await btn.textContent().catch(() => '')).trim();
    const testId = await btn.getAttribute('data-testid').catch(() => '');
    if (testId === 'start-cta') continue;
    if (txt.match(/^(Next →|Next|Play)$/i)) { forwardBtn = btn; break; }
  }
  if (!forwardBtn) break;
  const txt = (await forwardBtn.textContent().catch(() => '')).trim();
  console.log(`  Instruction click: "${txt}"`);
  await forwardBtn.tap({ force: true });
  await page.waitForTimeout(500);
}

// ─── Phase 2: Registration (PlayerNameInput overlay) ──────────────────────────
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT_DIR}/rc-2-registration-step1.png` });
console.log('✓ Phase 2: registration step 1 (first name)');

// Step 1: First name
const regInput = page.locator('[data-testid="reg-input"]');
const regInputVis = await regInput.isVisible({ timeout: 3000 }).catch(() => false);
if (regInputVis) {
  await regInput.fill('Alex');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/rc-2b-first-name-filled.png` });
  console.log('✓ Phase 2b: first name filled (yellow accent check)');
  
  await page.locator('[data-testid="reg-advance"]').tap({ force: true });
  await page.waitForTimeout(400);
} else {
  console.log('⚠ reg-input not found');
}

// Step 2: Last name
await page.screenshot({ path: `${OUT_DIR}/rc-2c-registration-step2.png` });
console.log('✓ Phase 2c: registration step 2 (last name)');
const regInput2 = page.locator('[data-testid="reg-input"]');
const regVis2 = await regInput2.isVisible({ timeout: 2000 }).catch(() => false);
if (regVis2) {
  await regInput2.fill('Smith');
  await page.locator('[data-testid="reg-advance"]').tap({ force: true });
  await page.waitForTimeout(400);
}

// Step 3: Email
const regInput3 = page.locator('[data-testid="reg-input"]');
const regVis3 = await regInput3.isVisible({ timeout: 2000 }).catch(() => false);
if (regVis3) {
  await regInput3.fill('alex@test.com');
  await page.locator('[data-testid="reg-advance"]').tap({ force: true });
  await page.waitForTimeout(400);
}

// Step 4: Consent
await page.screenshot({ path: `${OUT_DIR}/rc-2d-consent.png` });
console.log('✓ Phase 2d: consent screen');
const consentBtn = page.locator('[data-testid="reg-consent-agree"]');
const consentVis = await consentBtn.isVisible({ timeout: 2000 }).catch(() => false);
if (consentVis) {
  await consentBtn.tap({ force: true });
  await page.waitForTimeout(500);
  console.log('  ✓ Consent agreed');
} else {
  console.log('  ⚠ Consent button not found');
}

// ─── Phase 3: Start Screen (GameStartScreen CTA now visible) ──────────────────
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT_DIR}/rc-3-start-screen.png` });
console.log('✓ Phase 3: start screen (post-registration)');

const cta = page.locator('[data-testid="start-cta"]');
const ctaVis = await cta.isVisible({ timeout: 3000 }).catch(() => false);
console.log(`  CTA visible: ${ctaVis}`);

if (ctaVis) {
  await cta.tap({ force: true });
} else {
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="start-cta"]');
    if (btn) btn.click();
  });
}
await page.waitForTimeout(800);

// ─── Phase 4: Countdown ───────────────────────────────────────────────────────
await page.screenshot({ path: `${OUT_DIR}/rc-4-countdown.png` });
console.log('✓ Phase 4: countdown');

await page.waitForTimeout(4000); // Wait through countdown

// ─── Phase 5: Playing (early) ─────────────────────────────────────────────────
await page.screenshot({ path: `${OUT_DIR}/rc-5-playing-early.png` });
console.log('✓ Phase 5: playing (early)');

await page.waitForTimeout(6000);

// ─── Phase 6: Playing (active) ────────────────────────────────────────────────
await page.screenshot({ path: `${OUT_DIR}/rc-6-playing-active.png` });
console.log('✓ Phase 6: playing (active)');

// ─── Phase 7: End screen (timer at 15x speed → ~3s game, but started ~20s in so might be done) ─
// Wait for end — timer at 15x means 45s game = ~3s real, but we've been running ~15s so game over
await page.waitForTimeout(8000);
const endVisible = await page.locator('button:has-text("Play Again")').isVisible({ timeout: 3000 }).catch(() => false);
await page.screenshot({ path: `${OUT_DIR}/rc-7-end-screen.png` });
console.log(`✓ Phase 7: end screen (Play Again visible: ${endVisible})`);

await browser.close();
