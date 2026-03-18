const fs = require('fs');
let src = fs.readFileSync('tests/helpers/device-mocks.ts', 'utf8');

// Replace Start Game button
src = src.replace(
  "await page.getByRole('button', { name: /Start Game/i }).click();",
  "await page.locator('[data-testid=\"start-cta\"]').click();"
);

// Replace step 1 (first name)
src = src.replace(
  "await page.locator('input[type=\"text\"]').first().fill(firstName);\n  await page.getByRole('button', { name: 'Continue' }).click();",
  "await page.locator('[data-testid=\"reg-input\"]').fill(firstName);\n  await page.locator('[data-testid=\"reg-advance\"]').click();"
);

// Replace step 2 (last name)
src = src.replace(
  "await page.locator('input[type=\"text\"]').first().fill(lastName);\n  await page.getByRole('button', { name: 'Continue' }).click();",
  "await page.locator('[data-testid=\"reg-input\"]').fill(lastName);\n  await page.locator('[data-testid=\"reg-advance\"]').click();"
);

// Replace step 3 (email)
src = src.replace(
  "await page.locator('input[type=\"email\"]').fill(email);\n  await page.getByRole('button', { name: 'Continue' }).click();",
  "await page.locator('[data-testid=\"reg-input\"]').fill(email);\n  await page.locator('[data-testid=\"reg-advance\"]').click();"
);

// Replace consent
src = src.replace(
  "await page.getByRole('button', { name: /I Agree & Play/i }).click();",
  "await page.locator('[data-testid=\"reg-consent-agree\"]').click();"
);

fs.writeFileSync('tests/helpers/device-mocks.ts', src, 'utf8');
console.log('done');
console.log('Preview of registration section:');
const lines = src.split('\n');
const start = lines.findIndex(l => l.includes('completeRegistration'));
console.log(lines.slice(start, start + 25).join('\n'));
