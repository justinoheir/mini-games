const fs = require('fs');
let src = fs.readFileSync('tests/helpers/device-mocks.ts', 'utf8');

// Patch AudioContext.resume before the consent click so initAudio() doesn't hang in headless
const oldConsent = "  // \u2500\u2500 Step 4: Consent \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n  await page.locator('[data-testid=\"reg-consent-agree\"]').click();";
const newConsent = `  // ── Step 4: Consent ─────────────────────────────────────────────────────
  // Patch AudioContext.resume before clicking so initAudio() doesn't hang in headless
  await page.evaluate(() => {
    if (typeof AudioContext !== 'undefined') {
      AudioContext.prototype.resume = () => Promise.resolve(undefined);
    }
    if (typeof window.AudioContext === 'undefined' && typeof (window as unknown as Record<string, unknown>).webkitAudioContext !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitAudioContext.prototype.resume = () => Promise.resolve(undefined);
    }
  });
  await page.locator('[data-testid="reg-consent-agree"]').click();`;

// Find and replace the consent section - use indexOf for reliability
const idx = src.indexOf("  // \u2500\u2500 Step 4: Consent");
if (idx === -1) {
  console.error('Could not find consent section!');
  process.exit(1);
}
const consentEnd = src.indexOf("click();", idx) + "click();".length;
src = src.slice(0, idx) + newConsent + src.slice(consentEnd);

fs.writeFileSync('tests/helpers/device-mocks.ts', src, 'utf8');
console.log('Done. Consent section:');
const lines = src.split('\n');
const start = lines.findIndex(l => l.includes('Step 4: Consent'));
console.log(lines.slice(start, start + 14).join('\n'));
