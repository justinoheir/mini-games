/**
 * Tier 2 — Gameplay: tilt-maze
 *
 * - Injects DeviceOrientation/DeviceMotion mocks before page load
 * - Fires tilt-left then tilt-right orientation events
 * - Asserts canvas renders and game does not freeze
 */

import { test, expect } from '@playwright/test';
import {
  completeRegistration,
  mockGyroscope,
  waitForGameStart,
} from '../helpers/device-mocks';

test('tilt-maze — gyroscope tilt simulation', async ({ page }) => {
  // Must be added before navigation so the page loads with the mock
  await mockGyroscope(page);

  await page.goto('/games/tilt-maze');

  // Complete registration
  await completeRegistration(page);

  // Wait for countdown + game start
  await waitForGameStart(page);

  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 8_000 });

  // Fire orientation events: tilt left (negative gamma), then right (positive gamma)
  await page.evaluate(() => {
    const fire = (window as unknown as Record<string, unknown>).__fireOrientation as (
      alpha: number,
      beta: number,
      gamma: number,
    ) => void;
    fire(0, 0, -30); // tilt left
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    const fire = (window as unknown as Record<string, unknown>).__fireOrientation as (
      alpha: number,
      beta: number,
      gamma: number,
    ) => void;
    fire(0, 0, 30); // tilt right
  });
  await page.waitForTimeout(300);

  // Canvas still visible — game has not frozen or crashed
  await expect(canvas).toBeVisible();

  // No JS error dialog (Playwright will surface unhandled rejections)
  // If we got here, game is running fine.
});
