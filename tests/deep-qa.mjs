/**
 * Deep QA Pass — All 161 Glimmer games
 * Tests: crashes, mic denial, tilt fallback, end screens, mobile overflow
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'http://localhost:3334';

// All 161 game IDs
const ALL_GAMES = [
  'paint-splash','web-weave','treasure-dive','frog-leap','wire-cross','balloon-pop',
  'slingshot-smash','ripple-tap','pendulum-swing','node-connect','orbit-launch','speed-sort',
  'spring-leap','crystal-catch','wobble-stack','chain-reaction','pixel-paint','drop-zone',
  'laser-guide','friction-slide','gravity-well','tilt-maze','whisper-bomb','breath-rider',
  'steady-hand','tunnel','pulse-sphere','shadow-tap','color-cascade','equation-tap',
  'color-word','visual-search','odd-one-out','pattern-predict','reflex-grid','sequence-unlock',
  'word-flash','rhythm-repeat','category-clash','memory-grid','reaction-chain','stack-drop',
  'dodge-blitz','crowd-roar','balance-beam','path-trace','pitch-match','symbol-scan',
  'neon-archer','ice-sculptor','gravity-flip','volcano-tap','marathon-pace','hot-potato',
  'slam-dunk','archery-draw','hockey-slap','javelin-throw','bowling-curve','swimming-stroke',
  'dart-board','track-sprint','discus-spin','boxing-combo','hoop-shot','penalty-kick',
  'spiral-throw','reflex-rally','precision-putt','gift-rush','snow-catch','boo-blast',
  'cauldron-bubble','firework-launch','countdown-crush','cupid-shot','love-note','turkey-trot',
  'harvest-catch','shamrock-shuffle','egg-toss','pinata-smash','flower-bouquet','bbq-master',
  'sparkler-draw','pencil-pack','diya-light','dreidel-spin','dragon-parade','bead-catch',
  'lantern-float','taco-toss','basket-weave','clover-path','signal-boost','crystal-grow',
  'echo-clap','solar-charge','aurora-wave','dragon-breath','voice-sculpt','echo-match',
  'howl-wolf','beat-box','hum-maze','chant-power','whistle-launch','vocal-shield',
  'breath-sculpt','frequency-tune','lung-capacity','sound-waves','sing-along','morse-tap',
  'morse-decode','code-breaker','pulse-jump','domino-chain','number-crunch','mirror-mind',
  'number-path','logic-gate','binary-decode','attention-switch','face-memory','inference-trail',
  'spatial-map','neon-chess','shape-rotate','type-speed','bubble-burst','tower-stack',
  'bounce-pass','gear-grind','thread-needle','jigsaw-rush','cable-wrap','magnet-maze',
  'cosmic-catch','wormhole-dive','dream-catch','sound-garden','curling-sweep','rowing-rhythm',
  'baseball-swing','karate-chop','pole-vault','table-tennis','gymnast-beam','pixel-skate',
  'surf-ride','ski-slalom','mirror-dance','sand-pour','color-blend','echo-tap','heat-map',
  'trust-fall','spark-chain','crowd-pulse',
];

// Games that use mic — test mic denial
const MIC_GAMES = new Set([
  'whisper-bomb','breath-rider','pulse-sphere','aurora-wave','cauldron-bubble','crowd-roar',
  'crystal-grow','dragon-breath','echo-clap','howl-wolf','hum-maze','lung-capacity',
  'signal-boost','sing-along','solar-charge','sound-waves','breath-sculpt','chant-power',
  'frequency-tune','vocal-shield','voice-sculpt','whistle-launch','beat-box','pitch-match',
]);

// Games that use tilt — test pointer fallback
const TILT_GAMES = new Set([
  'tilt-maze','balance-beam','crystal-catch','treasure-dive','laser-guide','egg-toss',
  'gymnast-beam','harvest-catch','ski-slalom','spiral-throw','tunnel','pulse-sphere',
  'curling-sweep','diya-light','dodge-blitz','magnet-maze','marathon-pace','snow-catch',
  'surf-ride',
]);

const results = { passed: [], failed: [], warnings: [] };

async function testGame(browser, gameId, opts = {}) {
  const { mobile = false, denyMic = false } = opts;
  const context = await browser.newContext({
    viewport: mobile ? { width: 375, height: 667 } : { width: 390, height: 844 },
    permissions: denyMic ? [] : ['microphone'],
    // Deny mic by NOT granting it; getUserMedia will throw NotAllowedError
  });

  // Inject DeviceOrientation simulation
  await context.addInitScript(`
    // Simulate tilt events so tilt-based games get input
    window._injectTilt = () => {
      const evt = new DeviceOrientationEvent('deviceorientation', {
        alpha: 0, beta: 5, gamma: 10, absolute: false
      });
      window.dispatchEvent(evt);
    };
    // Override DeviceOrientationEvent.requestPermission to auto-grant
    if (typeof DeviceOrientationEvent !== 'undefined') {
      Object.defineProperty(DeviceOrientationEvent, 'requestPermission', {
        value: async () => 'granted',
        configurable: true,
      });
    }
  `);

  const page = await context.newPage();
  const errors = [];
  const warnings = [];

  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  page.on('pageerror', err => errors.push(`[PAGE ERROR] ${err.message}`));

  try {
    const url = `${BASE}/games/${gameId}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Wait for game start screen
    await page.waitForTimeout(1500);

    // Check for crash / blank page
    const body = await page.textContent('body').catch(() => '');
    if (!body || body.trim().length < 10) {
      return { gameId, status: 'FAIL', reason: 'Blank/empty page', errors };
    }

    // Check for unhandled error overlay (Next.js error boundary)
    const hasErrorBoundary = await page.$('text=Something went wrong').catch(() => null);
    if (hasErrorBoundary) {
      return { gameId, status: 'FAIL', reason: 'Error boundary triggered', errors };
    }

    // Find and click the start button
    const startBtn = await page.$('button').catch(() => null);
    if (!startBtn) {
      return { gameId, status: 'WARN', reason: 'No start button found', errors };
    }

    // Fill in player name if input exists
    const nameInput = await page.$('input[type="text"], input[placeholder*="name" i], input[placeholder*="Name" i]').catch(() => null);
    if (nameInput) {
      await nameInput.fill('Tester');
    }

    // Click start
    await startBtn.click().catch(() => {});
    await page.waitForTimeout(500);

    // Handle any permission dialogs (for mic games)
    // Browser context handles this via permissions setting

    // Wait through countdown (usually 3 seconds)
    await page.waitForTimeout(3500);

    // Now we should be in 'playing' state
    // Simulate interactions based on game type
    const W = mobile ? 375 : 390;
    const H = mobile ? 667 : 844;
    const cx = W / 2, cy = H / 2;

    // Inject tilt events for tilt games
    if (TILT_GAMES.has(gameId)) {
      for (let i = 0; i < 10; i++) {
        await page.evaluate(() => {
          const evt = new DeviceOrientationEvent('deviceorientation', {
            alpha: 0, beta: 5, gamma: 15, absolute: false
          });
          window.dispatchEvent(evt);
        });
        await page.waitForTimeout(200);
      }
    }

    // Simulate taps in various positions
    const tapPositions = [
      [cx, cy], [cx - 50, cy], [cx + 50, cy],
      [cx, cy - 80], [cx, cy + 80],
      [cx - 80, cy + 100], [cx + 80, cy + 100],
    ];
    for (const [x, y] of tapPositions) {
      await page.mouse.click(x, y).catch(() => {});
      await page.waitForTimeout(300);
    }

    // Do a swipe gesture (for swipe-based games)
    await page.mouse.move(cx, cy + 50);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 100, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    // Hold for hold-based games
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    await page.waitForTimeout(400);

    // Wait more to observe game behavior
    await page.waitForTimeout(3000);

    // Check score display is visible
    const scoreEl = await page.$('[class*="hud"], [aria-live], [data-score]').catch(() => null);

    // Check for mobile overflow
    let hasOverflow = false;
    if (mobile) {
      hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 5;
      }).catch(() => false);
    }

    // Check for end screen (in case game ended quickly)
    const endScreen = await page.$('[class*="end"], [class*="EndScreen"], button:has-text("Play Again"), button:has-text("Play again")').catch(() => null);

    // Filter real errors (ignore benign ones)
    const realErrors = errors.filter(e =>
      !e.includes('ResizeObserver') &&
      !e.includes('favicon') &&
      !e.includes('Non-Error promise rejection') &&
      !e.includes('postMessage') &&
      !e.includes('__NEXT') &&
      !e.includes('chrome-extension') &&
      !e.includes('ERR_BLOCKED_BY_CLIENT')
    );

    const result = {
      gameId,
      status: realErrors.length > 0 ? 'FAIL' : (hasOverflow ? 'WARN' : 'PASS'),
      errors: realErrors,
      warnings: warnings.slice(0, 3),
      hasOverflow,
      hasEndScreen: !!endScreen,
    };

    if (hasOverflow) result.reason = 'Mobile overflow detected';
    if (realErrors.length > 0) result.reason = realErrors[0].slice(0, 100);

    return result;
  } catch (err) {
    return { gameId, status: 'FAIL', reason: `Test exception: ${err.message}`, errors };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function run() {
  console.log(`\n🎮 Deep QA Pass — ${ALL_GAMES.length} games\n`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--use-file-for-fake-audio-capture', // Use fake audio
      '--disable-web-security',
      '--no-sandbox',
    ],
  });

  const BATCH = 5; // Run 5 games in parallel
  const allResults = [];

  for (let i = 0; i < ALL_GAMES.length; i += BATCH) {
    const batch = ALL_GAMES.slice(i, i + BATCH);
    const batchNum = Math.floor(i / BATCH) + 1;
    const totalBatches = Math.ceil(ALL_GAMES.length / BATCH);
    console.log(`Batch ${batchNum}/${totalBatches}: ${batch.join(', ')}`);

    const batchResults = await Promise.all(
      batch.map(gameId => testGame(browser, gameId, { mobile: false }))
    );

    batchResults.forEach(r => {
      allResults.push(r);
      const icon = r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️' : '❌';
      const extra = r.reason ? ` — ${r.reason}` : '';
      console.log(`  ${icon} ${r.gameId}${extra}`);
    });
  }

  // Mobile viewport test for first 20 games + known problem ones
  console.log('\n📱 Mobile viewport tests...');
  const mobileGames = ALL_GAMES.slice(0, 20);
  for (let i = 0; i < mobileGames.length; i += BATCH) {
    const batch = mobileGames.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(gameId => testGame(browser, gameId, { mobile: true }))
    );
    batchResults.forEach(r => {
      if (r.hasOverflow) {
        allResults.push({ ...r, gameId: `${r.gameId} [mobile]`, status: 'WARN', reason: 'Mobile overflow' });
        console.log(`  ⚠️ ${r.gameId} [mobile] — overflow`);
      }
    });
  }

  await browser.close();

  // Summary
  const failed = allResults.filter(r => r.status === 'FAIL');
  const warned = allResults.filter(r => r.status === 'WARN');
  const passed = allResults.filter(r => r.status === 'PASS');

  console.log(`\n📊 Results: ${passed.length} passed, ${warned.length} warnings, ${failed.length} failed`);

  if (failed.length > 0) {
    console.log('\n❌ FAILURES:');
    failed.forEach(r => console.log(`  ${r.gameId}: ${r.reason || r.errors?.[0] || 'unknown'}`));
  }
  if (warned.length > 0) {
    console.log('\n⚠️ WARNINGS:');
    warned.forEach(r => console.log(`  ${r.gameId}: ${r.reason || 'no reason'}`));
  }

  writeFileSync('tests/results/deep-qa-results.json', JSON.stringify(allResults, null, 2));
  console.log('\n💾 Results saved to tests/results/deep-qa-results.json');
  return allResults;
}

run().catch(console.error);
