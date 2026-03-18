/**
 * Tier 2 — Gameplay: reflex-rally
 *
 * After registration + countdown:
 *  - Waits for canvas to appear
 *  - Simulates a left swipe on the canvas (dx < -40)
 *  - Asserts HUD score element exists and canvas remains visible
 */

import { test, expect } from '@playwright/test';
import {
  completeRegistration,
  simulateSwipe,
  waitForGameStart,
} from '../helpers/device-mocks';

test('reflex-rally — left swipe during gameplay', async ({ page }) => {
  await page.goto('/games/reflex-rally');

  // Complete splash + registration
  await completeRegistration(page);

  // Wait for countdown to finish and game to start
  await waitForGameStart(page);

  // Canvas should be present
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 8_000 });

  // Simulate left swipe
  await simulateSwipe(page, canvas, { dx: -80, dy: 0, durationMs: 120 });

  // Small wait for any state update
  await page.waitForTimeout(300);

  // Assert: canvas still visible (no crash / error screen)
  await expect(canvas).toBeVisible();

  // Assert: HUD score label is present
  const scoreLabel = page.getByText('SCORE', { exact: false }).first();
  await expect(scoreLabel).toBeVisible({ timeout: 5_000 });
});
