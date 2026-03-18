import { test, expect } from '@playwright/test';
import { mockAudio } from './helpers/device-mocks';

const MG_USER_KEY = 'mg_user';

test('debug: reflex-rally funnel step by step', async ({ page }) => {
  page.on('pageerror', err => console.log('[PAGE ERROR]', err.message));

  await mockAudio(page); // disable Tone.js before page load
  await page.goto('/games/reflex-rally');
  await page.waitForLoadState('domcontentloaded');

  await page.evaluate((key) => localStorage.removeItem(key), MG_USER_KEY);

  await page.locator('[data-testid="start-cta"]').click();
  await page.waitForTimeout(400);

  await page.locator('[data-testid="reg-input"]').fill('Test');
  await page.locator('[data-testid="reg-advance"]').click();
  await page.waitForTimeout(350);

  await page.locator('[data-testid="reg-input"]').fill('User');
  await page.locator('[data-testid="reg-advance"]').click();
  await page.waitForTimeout(350);

  await page.locator('[data-testid="reg-input"]').fill('test@example.com');
  await page.locator('[data-testid="reg-advance"]').click();
  await page.waitForTimeout(350);

  await expect(page.locator('[data-testid="reg-consent-agree"]')).toBeVisible({ timeout: 3_000 });
  await page.locator('[data-testid="reg-consent-agree"]').click();
  console.log('✅ Consent clicked');

  // Wait for countdown "3"
  const countdownThree = page.getByText('3', { exact: true }).first();
  await expect(countdownThree).toBeVisible({ timeout: 8_000 });
  console.log('✅ Countdown "3" visible!');

  // Wait for game to start
  await countdownThree.waitFor({ state: 'hidden', timeout: 10_000 });
  await page.waitForTimeout(2_500); // let countdown finish

  const canvas = page.locator('canvas').first();
  const hudScore = page.getByText('SCORE').first();
  const canvasVisible = await canvas.isVisible().catch(() => false);
  const hudVisible = await hudScore.isVisible().catch(() => false);
  console.log('Canvas visible:', canvasVisible, '| HUD SCORE visible:', hudVisible);

  expect(canvasVisible || hudVisible).toBe(true);
});
