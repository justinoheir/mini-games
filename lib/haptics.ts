/**
 * lib/haptics.ts — Semantic haptic patterns via Web Vibration API
 * ─────────────────────────────────────────────────────────────────
 * Wraps navigator.vibrate() with meaningful patterns so game code
 * expresses *intent* (score, fail, victory, impact) rather than raw
 * milliseconds.  Silent fallback on unsupported devices.
 */

function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    // Vibration API not available — silent fallback
  }
}

/**
 * hapticScore — fired on any successful scoring event
 * (basket made, goal scored, pass completed, correct tap, etc.)
 */
export function hapticScore(): void {
  vibrate([40, 20, 40]);
}

/**
 * hapticFail — fired on miss, failure, chain break, or wrong input
 */
export function hapticFail(): void {
  vibrate([80, 40, 80]);
}

/**
 * hapticVictory — fired on personal best, round complete, or game-end celebration
 */
export function hapticVictory(): void {
  vibrate([30, 20, 30, 20, 60, 20, 100]);
}

/**
 * hapticImpact — fired on physical collision events
 * (rim bounce, wall hit, block land, keeper save)
 */
export function hapticImpact(): void {
  vibrate([60]);
}

/**
 * hapticCelebration — fired on exceptional moments
 * (new personal best, streak milestone, perfect run)
 * Long escalating burst with a triumphant final kick.
 */
export function hapticCelebration(): void {
  vibrate([20, 10, 20, 10, 20, 10, 40, 20, 100]);
}

/**
 * hapticWarning — fired on near-miss or low time alert
 */
export function hapticWarning(): void {
  vibrate([40, 20, 40]);
}

/**
 * hapticCombo — fired on combo/streak increment (scales with level)
 */
export function hapticCombo(level: number = 1): void {
  const base = Math.min(level * 15, 60);
  vibrate([base, 10, base + 10]);
}
