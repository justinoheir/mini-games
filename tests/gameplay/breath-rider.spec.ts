/**
 * Tier 2 — Gameplay: breath-rider
 *
 * - Mocks getUserMedia / AudioContext to return a silent stream
 * - Completes registration + countdown
 * - Verifies game reaches playing phase without crashing
 */

import { test, expect } from '@playwright/test';
import {
  completeRegistration,
  mockMicrophone,
  waitForGameStart,
} from '../helpers/device-mocks';

test('breath-rider — mic mock, reaches playing phase', async ({ page }) => {
  // Mock microphone before page loads
  await mockMicrophone(page);

  await page.goto('/games/breath-rider');

  await completeRegistration(page);

  // Wait for countdown to complete
  await waitForGameStart(page);

  // Game canvas should be visible
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 8_000 });

  // No microphone error overlay
  const errorOverlay = page.getByText(/microphone.*denied|permission.*denied|error/i).first();
  const hasError = await errorOverlay.isVisible().catch(() => false);
  expect(hasError, 'Expected no microphone permission error in breath-rider').toBe(false);
});
