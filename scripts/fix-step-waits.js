const fs = require('fs');
let src = fs.readFileSync('tests/helpers/device-mocks.ts', 'utf8');

// Add stepWait helper at top of completeRegistration body
src = src.replace(
  '  // Always start fresh',
  '  // Short wait for AnimatePresence exit animation between steps (~200ms)\n  const stepWait = () => page.waitForTimeout(350);\n\n  // Always start fresh'
);

// Add stepWait after each advance click (steps 1, 2, 3)
// After step 1 advance
src = src.replace(
  "  await page.locator('[data-testid=\"reg-advance\"]').click();\n\n  // \u2500\u2500 Step 2",
  "  await page.locator('[data-testid=\"reg-advance\"]').click();\n  await stepWait();\n\n  // \u2500\u2500 Step 2"
);
// After step 2 advance
src = src.replace(
  "  await page.locator('[data-testid=\"reg-advance\"]').click();\n\n  // \u2500\u2500 Step 3",
  "  await page.locator('[data-testid=\"reg-advance\"]').click();\n  await stepWait();\n\n  // \u2500\u2500 Step 3"
);
// After step 3 advance
src = src.replace(
  "  await page.locator('[data-testid=\"reg-advance\"]').click();\n\n  // \u2500\u2500 Step 4",
  "  await page.locator('[data-testid=\"reg-advance\"]').click();\n  await stepWait();\n\n  // \u2500\u2500 Step 4"
);

fs.writeFileSync('tests/helpers/device-mocks.ts', src, 'utf8');
console.log('Updated. Preview:');
const lines = src.split('\n');
const start = lines.findIndex(l => l.includes('stepWait'));
console.log(lines.slice(start - 1, start + 40).join('\n'));
