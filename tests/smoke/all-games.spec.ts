/**
 * Tier 1 — Smoke Tests
 *
 * Dynamically discovers every game slug under app/games/ (excluding __scaffold__)
 * and runs a standard smoke flow for each:
 *
 *   1. Navigate to /games/<slug>
 *   2. Verify splash screen (title, emoji, CTA button)
 *   3. Click "Start Game →"
 *   4. Complete 4-step registration funnel
 *   5. Verify countdown ("3", "2", "1")
 *   6. Verify game canvas OR HUD appears after countdown
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { completeRegistration, waitForGameStart, mockAudio, mockMicrophone } from '../helpers/device-mocks';

// ─── Discover game slugs at collection time ───────────────────────────────────

const GAMES_DIR = path.resolve(__dirname, '../../app/games');

function discoverSlugs(): string[] {
  return fs
    .readdirSync(GAMES_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith('__') &&
        fs.existsSync(path.join(GAMES_DIR, entry.name, 'page.tsx')),
    )
    .map((entry) => entry.name)
    .sort();
}

const SLUGS = discoverSlugs();

// ─── Shared smoke test per slug ───────────────────────────────────────────────

for (const slug of SLUGS) {
  test(`[smoke] ${slug} — splash, registration, countdown, game start`, async ({ page }) => {
    // ── 1. Navigate ──────────────────────────────────────────────────────────
    await mockAudio(page);       // disable Tone.js before page load so initAudio() never blocks
    await mockMicrophone(page);  // mock getUserMedia for mic-based games
    await page.goto(`/games/${slug}`);

    // ── 2. Splash screen ─────────────────────────────────────────────────────
    // Title (h1) should be visible
    const title = page.locator('h1').first();
    await expect(title).toBeVisible({ timeout: 8_000 });

    // CTA button visible (data-testid is consistent across all games regardless of label)
    const cta = page.locator('[data-testid="start-cta"]');
    await expect(cta).toBeVisible({ timeout: 8_000 });

    // An emoji is present — any element with an emoji-like text in the splash area.
    // GameStartScreen renders the emoji in a large div; we just check the page
    // has something emoji-shaped (non-Latin character cluster).
    const bodyText = await page.locator('body').innerText();
    const hasEmoji = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(bodyText);
    expect(hasEmoji, `Expected an emoji on the splash screen for "${slug}"`).toBe(true);

    // ── 3–4. Registration funnel ──────────────────────────────────────────────
    await completeRegistration(page);

    // ── 4b. Mic-permission gate (crowd-roar, whisper-bomb, pitch-match, love-note) ──
    // Some games land on a 'permission' phase after registration that shows
    // an "Allow Mic" button before the countdown starts. Click it if present.
    const micBtn = page.getByRole('button', { name: /allow|enable mic|retry mic|grant mic/i }).first();
    const micVisible = await micBtn.isVisible({ timeout: 1_500 }).catch(() => false);
    if (micVisible) await micBtn.click();

    // ── 5. Countdown ──────────────────────────────────────────────────────────
    // Wait for "3" to appear
    const countdownThree = page.getByText('3', { exact: true }).first();
    await expect(countdownThree).toBeVisible({ timeout: 8_000 });

    // Wait for countdown to finish
    await page.waitForFunction(
      () => {
        // Countdown is gone when "3", "2", "1", "GO!" are all absent from the page
        const texts = ['3', '2', '1'];
        return texts.every((t) => {
          const el = [...document.querySelectorAll('*')].find(
            (e) => e.childElementCount === 0 && e.textContent?.trim() === t,
          );
          return !el || (el as HTMLElement).offsetParent === null;
        });
      },
      { timeout: 15_000, polling: 200 },
    );

    // Short buffer for game canvas / HUD to mount
    await page.waitForTimeout(400);

    // ── 6. Game canvas OR HUD ─────────────────────────────────────────────────
    const canvas = page.locator('canvas').first();
    // Broad HUD match — covers all game stat labels across all 33 games
    const hudLabel = page.getByText(/SCORE|TIME|LIVES|HEARTS|ROUND|LEVEL|STREAK|COMBO|HITS|NOTES|LENGTH|FUSE|VOLUME/i).first();

    const canvasVisible = await canvas.isVisible().catch(() => false);
    const hudVisible = await hudLabel.isVisible().catch(() => false);

    expect(
      canvasVisible || hudVisible,
      `Expected canvas or HUD to be visible after countdown for "${slug}"`,
    ).toBe(true);
  });
}
