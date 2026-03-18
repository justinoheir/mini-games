/**
 * Tier 2 — Gameplay: pulse-sphere
 *
 * - Completes registration + countdown
 * - Simulates a touch tap on the canvas center
 * - Asserts canvas visible, no crash
 */

import { test, expect } from '@playwright/test';
import {
  completeRegistration,
  waitForGameStart,
} from '../helpers/device-mocks';

test('pulse-sphere — touch tap on canvas', async ({ page }) => {
  await page.goto('/games/pulse-sphere');

  await completeRegistration(page);
  await waitForGameStart(page);

  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 8_000 });

  // Simulate a touch tap at the canvas center
  const box = await canvas.boundingBox();
  if (!box) throw new Error('pulse-sphere canvas has no bounding box');

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.evaluate(({ cx, cy }) => {
    const target = document.elementFromPoint(cx, cy) ?? document.body;
    const makeTouch = (x: number, y: number) =>
      new Touch({ identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y });

    const touchStart = new TouchEvent('touchstart', {
      bubbles: true,
      cancelable: true,
      touches: [makeTouch(cx, cy)],
      changedTouches: [makeTouch(cx, cy)],
    });
    const touchEnd = new TouchEvent('touchend', {
      bubbles: true,
      cancelable: true,
      touches: [],
      changedTouches: [makeTouch(cx, cy)],
    });

    target.dispatchEvent(touchStart);
    setTimeout(() => target.dispatchEvent(touchEnd), 80);
  }, { cx, cy });

  await page.waitForTimeout(300);

  // Canvas still visible — no crash
  await expect(canvas).toBeVisible();
});
