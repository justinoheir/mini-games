/**
 * lib/haptics.ts — Semantic haptic patterns via Web Vibration API
 * ─────────────────────────────────────────────────────────────────
 * Duolingo-level haptics: crisp, punchy, satisfying.
 * Each pattern is tuned to feel meaningful — not just a buzz.
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
 * hapticScore — satisfying double-punch on every score
 * Like Duolingo's correct answer: crisp, confident
 */
export function hapticScore(): void {
  vibrate([60, 30, 100]);
}

/**
 * hapticFail — thuddy triple that reads as "wrong"
 */
export function hapticFail(): void {
  vibrate([120, 60, 120, 60, 80]);
}

/**
 * hapticVictory — escalating celebration burst
 * Feels like confetti going off in your hand
 */
export function hapticVictory(): void {
  vibrate([40, 20, 60, 20, 80, 20, 120, 20, 200]);
}

/**
 * hapticImpact — single hard thud for physical collisions
 */
export function hapticImpact(): void {
  vibrate([100]);
}

/**
 * hapticCelebration — personal best / streak milestone
 * Maximum intensity — phone should feel it
 */
export function hapticCelebration(): void {
  vibrate([80, 30, 80, 30, 80, 30, 200, 50, 200]);
}

/**
 * hapticWarning — urgent pulse for low time / danger
 */
export function hapticWarning(): void {
  vibrate([80, 40, 80, 40, 120]);
}

/**
 * hapticCombo — escalates with combo level
 * Level 3: noticeable. Level 10: can't miss it.
 */
export function hapticCombo(level: number = 1): void {
  const intensity = Math.min(level * 20, 150);
  const pause = 30;
  if (level >= 10) {
    vibrate([intensity, pause, intensity, pause, intensity * 1.5]);
  } else if (level >= 5) {
    vibrate([intensity, pause, intensity]);
  } else {
    vibrate([intensity]);
  }
}

/**
 * hapticMilestone — 50% score, new area unlocked, major moment
 */
export function hapticMilestone(): void {
  vibrate([60, 20, 60, 20, 200]);
}

/**
 * hapticTick — subtle single tap for countdown / rhythm games
 */
export function hapticTick(): void {
  vibrate([30]);
}
