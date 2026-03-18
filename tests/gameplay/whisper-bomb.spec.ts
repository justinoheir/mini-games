/**
 * Tier 2 — Gameplay: whisper-bomb
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

test('whisper-bomb — mic mock, reaches playing phase', async ({ page }) => {
  // Mock microphone before page loads
  await mockMicrophone(page);

  await page.goto('/games/whisper-bomb');

  // The splash may show a mic error message if permissions haven't been granted;
  // the mock should prevent that. Proceed with registration.
  await completeRegistration(page);

  // Wait for countdown to complete
  await waitForGameStart(page);

  // Game canvas should be visible
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 8_000 });

  // No error overlay — look for common error phrases and assert absence
  const errorOverlay = page.getByText(/microphone.*denied|permission.*denied|error/i).first();
  const hasError = await errorOverlay.isVisible().catch(() => false);
  expect(hasError, 'Expected no microphone permission error in whisper-bomb').toBe(false);
});
