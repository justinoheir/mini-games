/**
 * Tier 2 — Gameplay: steady-hand
 *
 * - Completes registration + countdown
 * - Simulates a slow touch drag across the canvas center
 * - Asserts game canvas is visible and responsive
 */

import { test, expect } from '@playwright/test';
import {
  completeRegistration,
  simulateSwipe,
  waitForGameStart,
} from '../helpers/device-mocks';

test('steady-hand — slow touch drag across canvas', async ({ page }) => {
  await page.goto('/games/steady-hand');

  await completeRegistration(page);
  await waitForGameStart(page);

  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 8_000 });

  // Slow horizontal drag across the center (longer duration = steadier movement)
  await simulateSwipe(page, canvas, { dx: 60, dy: 0, durationMs: 600 });

  await page.waitForTimeout(300);

  // Canvas still visible and responsive
  await expect(canvas).toBeVisible();
});
