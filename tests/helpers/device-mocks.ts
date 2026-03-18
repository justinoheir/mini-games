import type { Page, Locator } from '@playwright/test';


/**
 * Disables Tone.js audio initialization entirely so initAudio() returns
 * immediately in headless tests. MUST be called before page.goto().
 */
export async function mockAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__DISABLE_AUDIO = true;
  });
}

const MG_USER_KEY = 'mg_user';

// ─── Registration ────────────────────────────────────────────────────────────

export interface RegistrationOpts {
  firstName?: string;
  lastName?: string;
  email?: string;
}

/**
 * Clears stored player data, clicks "Start Game →", then completes the
 * 4-step registration/consent funnel.
 */
export async function completeRegistration(
  page: Page,
  opts: RegistrationOpts = {},
): Promise<void> {
  const { firstName = 'Test', lastName = 'User', email = 'test@example.com' } = opts;

  // Short wait for AnimatePresence exit animation between steps (~200ms)
  const stepWait = () => page.waitForTimeout(350);

  // Always start fresh — returning users are sent straight to consent (step 4)
  // which would skip data-entry steps.
  await page.evaluate((key) => localStorage.removeItem(key), MG_USER_KEY);

  // Click the Start / CTA button on the splash screen
  await page.locator('[data-testid="start-cta"]').click();

  // ── Step 1: First name ───────────────────────────────────────────────────
  await page.locator('[data-testid="reg-input"]').fill(firstName);
  await page.locator('[data-testid="reg-advance"]').click();
  await stepWait();

  // ── Step 2: Last name ────────────────────────────────────────────────────
  await page.locator('[data-testid="reg-input"]').fill(lastName);
  await page.locator('[data-testid="reg-advance"]').click();
  await stepWait();

  // ── Step 3: Email ────────────────────────────────────────────────────────
  await page.locator('[data-testid="reg-input"]').fill(email);
  await page.locator('[data-testid="reg-advance"]').click();
  await stepWait();

  // ── Step 4: Consent ─────────────────────────────────────────────────────
  // Patch AudioContext.resume before clicking so initAudio() doesn't hang in headless
  await page.evaluate(() => {
    if (typeof AudioContext !== 'undefined') {
      AudioContext.prototype.resume = () => Promise.resolve(undefined);
    }
    if (typeof window.AudioContext === 'undefined' && typeof (window as unknown as Record<string, unknown>).webkitAudioContext !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitAudioContext.prototype.resume = () => Promise.resolve(undefined);
    }
  });
  await page.locator('[data-testid="reg-consent-agree"]').click();
}

// ─── Gyroscope / DeviceOrientation mock ──────────────────────────────────────

/**
 * Injects DeviceOrientationEvent and DeviceMotionEvent mocks so games that
 * rely on tilt controls can run in a headless browser environment.
 */
export async function mockGyroscope(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Override DeviceOrientationEvent permission to always grant
    if (typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function') {
      (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission = async () => 'granted';
    }
    if (typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function') {
      (DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission = async () => 'granted';
    }

    // Expose a helper the test can call to fire synthetic events
    (window as unknown as Record<string, unknown>).__fireOrientation = (
      alpha: number,
      beta: number,
      gamma: number,
    ) => {
      const evt = new DeviceOrientationEvent('deviceorientation', {
        alpha,
        beta,
        gamma,
        absolute: false,
      });
      window.dispatchEvent(evt);
    };

    (window as unknown as Record<string, unknown>).__fireMotion = (
      xAccel: number,
      yAccel: number,
      zAccel: number,
    ) => {
      const evt = new DeviceMotionEvent('devicemotion', {
        acceleration: { x: xAccel, y: yAccel, z: zAccel },
        accelerationIncludingGravity: { x: xAccel, y: yAccel, z: zAccel + 9.81 },
        rotationRate: { alpha: 0, beta: 0, gamma: 0 },
        interval: 16,
      });
      window.dispatchEvent(evt);
    };
  });
}

// ─── Microphone mock ─────────────────────────────────────────────────────────

/**
 * Injects a silent MediaStream so that getUserMedia-based games (breath-rider,
 * whisper-bomb) don't throw permission errors and can reach the playing state.
 */
export async function mockMicrophone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Patch getUserMedia directly on the prototype — works even when
    // navigator.mediaDevices itself is non-configurable.
    const stub = async (): Promise<MediaStream> => new MediaStream();

    try {
      // Most reliable: patch on the prototype
      Object.defineProperty(MediaDevices.prototype, 'getUserMedia', {
        configurable: true,
        writable: true,
        value: stub,
      });
    } catch {
      // Fallback: direct assignment
      try { navigator.mediaDevices.getUserMedia = stub; } catch { /* noop */ }
    }

    // Also stub enumerateDevices so permission checks don't hang
    try {
      Object.defineProperty(MediaDevices.prototype, 'enumerateDevices', {
        configurable: true,
        writable: true,
        value: async () => [{
          kind: 'audioinput', deviceId: 'mock', groupId: 'mock', label: 'Mock Mic',
          toJSON: () => ({}),
        }],
      });
    } catch { /* noop */ }
  });
}

// ─── Touch swipe ─────────────────────────────────────────────────────────────

export interface SwipeOpts {
  /** Horizontal delta — negative = left, positive = right */
  dx?: number;
  /** Vertical delta — negative = up, positive = down */
  dy?: number;
  /** Duration of the swipe in milliseconds (default 100) */
  durationMs?: number;
}

/**
 * Fires a TouchStart → TouchMove → TouchEnd sequence on the given element to
 * simulate a swipe gesture.
 */
export async function simulateSwipe(
  page: Page,
  element: Locator,
  opts: SwipeOpts = {},
): Promise<void> {
  const { dx = -80, dy = 0, durationMs = 100 } = opts;

  const box = await element.boundingBox();
  if (!box) throw new Error('simulateSwipe: element has no bounding box');

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const endX = startX + dx;
  const endY = startY + dy;

  await page.evaluate(
    ({ startX, startY, endX, endY, durationMs }) => {
      return new Promise<void>((resolve) => {
        const target = document.elementFromPoint(startX, startY);
        if (!target) { resolve(); return; }

        const makeTouch = (x: number, y: number, target: Element) =>
          new Touch({ identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y });

        const dispatchTouchEvent = (type: string, x: number, y: number) => {
          const touch = makeTouch(x, y, target);
          const event = new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === 'touchend' ? [] : [touch],
            changedTouches: [touch],
          });
          target.dispatchEvent(event);
        };

        dispatchTouchEvent('touchstart', startX, startY);

        // Animate through midpoints
        const steps = 5;
        let step = 0;
        const interval = setInterval(() => {
          step++;
          const progress = step / steps;
          const x = startX + (endX - startX) * progress;
          const y = startY + (endY - startY) * progress;
          dispatchTouchEvent('touchmove', x, y);
          if (step >= steps) {
            clearInterval(interval);
            dispatchTouchEvent('touchend', endX, endY);
            resolve();
          }
        }, durationMs / steps);
      });
    },
    { startX, startY, endX, endY, durationMs },
  );
}

// ─── Countdown wait ──────────────────────────────────────────────────────────

/**
 * Waits for the countdown overlay to disappear (i.e. game has started).
 * The Countdown component renders "3", "2", "1", "GO!" over ~2.2s then unmounts.
 */
export async function waitForGameStart(page: Page, extraMs = 500): Promise<void> {
  // Wait for "3" to appear first (signals countdown started)
  await page.getByText('3').waitFor({ state: 'visible', timeout: 10_000 });
  // Then wait for "GO!" or for countdown to fully vanish (whichever)
  await page.getByText('3').waitFor({ state: 'hidden', timeout: 10_000 });
  await page.getByText('2').waitFor({ state: 'hidden', timeout: 10_000 });
  await page.getByText('1').waitFor({ state: 'hidden', timeout: 10_000 });
  // Brief extra wait for the game canvas / HUD to mount
  await page.waitForTimeout(extraMs);
}
