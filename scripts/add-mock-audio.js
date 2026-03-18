const fs = require('fs');
let src = fs.readFileSync('tests/helpers/device-mocks.ts', 'utf8');

const newFn = `
/**
 * Disables Tone.js audio initialization entirely so initAudio() returns
 * immediately in headless tests. MUST be called before page.goto().
 */
export async function mockAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__DISABLE_AUDIO = true;
  });
}

`;

src = src.replace('const MG_USER_KEY = ', newFn + 'const MG_USER_KEY = ');
fs.writeFileSync('tests/helpers/device-mocks.ts', src, 'utf8');
console.log('done');
