/**
 * Static analysis QA for all Glimmer games
 * Scans page.tsx files for common bug patterns
 */
const fs = require('fs');
const path = require('path');
const { GAME_IDS } = require('./qa-games.js');

const GAMES_DIR = path.join(__dirname, 'app', 'games');
const RESULTS_FILE = path.join(__dirname, 'qa-static-results.json');

const results = [];

// Bug patterns to detect
const PATTERNS = [
  // Object.assign on THREE objects (read-only properties)
  {
    name: 'THREE_OBJECT_ASSIGN',
    regex: /Object\.assign\s*\(\s*new\s+THREE\./g,
    verdict: 'BROKEN',
    fix: 'Use Object.assign on a plain object first, or set properties directly instead of Object.assign(new THREE.X, {...})',
  },
  // Accessing .current on ref that may not be set
  {
    name: 'NULL_REF_ACCESS',
    regex: /(\w+)Ref\.current\.(ctx|getContext|width|height|drawImage)\b/g,
    verdict: 'WARNING',
    fix: 'Add null check before accessing ref.current properties',
  },
  // Missing null check before canvas context
  {
    name: 'CANVAS_CTX_NO_CHECK',
    regex: /const\s+ctx\s*=\s*canvas\.getContext[^;]+;\s*\n[^i][^f]/g,
    verdict: 'WARNING',
    fix: 'Add null check: if (!ctx) return;',
  },
  // THREE.WebGLRenderer without proper cleanup
  {
    name: 'THREE_NO_DISPOSE',
    verdict: 'INFO',
    check: (src) => {
      const hasRenderer = /new THREE\.WebGLRenderer/.test(src);
      const hasDispose = /renderer\.dispose\(\)/.test(src) || /rendererRef\.current\?\.dispose/.test(src);
      return hasRenderer && !hasDispose;
    },
    fix: 'Add renderer.dispose() in cleanup',
  },
  // Using DeviceMotionEvent without iOS permission request
  {
    name: 'DEVICE_MOTION_NO_PERMISSION',
    verdict: 'WARNING',
    check: (src) => {
      const hasDeviceMotion = /DeviceMotionEvent|devicemotion|DeviceOrientationEvent/.test(src);
      const hasPermission = /requestPermission/.test(src);
      return hasDeviceMotion && !hasPermission;
    },
    fix: 'Request DeviceMotion permission on iOS: DeviceMotionEvent.requestPermission()',
  },
  // Using window.AudioContext directly (deprecated, should use AudioContext || webkitAudioContext)
  {
    name: 'AUDIO_CONTEXT',
    verdict: 'INFO',
    check: (src) => /new AudioContext\(\)/.test(src) && !/new \(window\.AudioContext|webkitAudioContext/.test(src),
    fix: 'Use: new (window.AudioContext || window.webkitAudioContext)()',
  },
  // Async function called without await/catch
  {
    name: 'UNHANDLED_ASYNC',
    regex: /navigator\.\w+(?:Microphone|Camera|Motion|Orientation)\s*\(/g,
    verdict: 'INFO',
    fix: 'Ensure async navigator calls are properly awaited and caught',
  },
  // canvas.getContext called on ref that might be null
  {
    name: 'CANVAS_REF_GETCONTEXT',
    regex: /canvasRef\.current\.getContext/g,
    verdict: 'WARNING',
    fix: 'Use: canvasRef.current?.getContext or add null check',
  },
];

function analyzeGame(gameId) {
  const gameDir = path.join(GAMES_DIR, gameId);
  const pagePath = path.join(gameDir, 'page.tsx');

  if (!fs.existsSync(gameDir)) {
    return { game_id: gameId, verdict: 'BROKEN', issues: [{ name: 'MISSING_DIR', desc: 'Game directory not found' }] };
  }
  if (!fs.existsSync(pagePath)) {
    return { game_id: gameId, verdict: 'BROKEN', issues: [{ name: 'MISSING_PAGE', desc: 'page.tsx not found' }] };
  }

  const src = fs.readFileSync(pagePath, 'utf8');
  const issues = [];

  for (const pattern of PATTERNS) {
    let found = false;
    let instances = [];

    if (pattern.regex) {
      const matches = [...src.matchAll(new RegExp(pattern.regex.source, pattern.regex.flags))];
      if (matches.length > 0) {
        found = true;
        instances = matches.map(m => `  line ~${src.substring(0, m.index).split('\n').length}: "${m[0].substring(0, 60)}"`);
      }
    } else if (pattern.check) {
      found = pattern.check(src);
    }

    if (found) {
      issues.push({
        name: pattern.name,
        verdict: pattern.verdict,
        fix: pattern.fix,
        instances: instances.slice(0, 3),
      });
    }
  }

  // Determine overall verdict
  const hasBroken = issues.some(i => i.verdict === 'BROKEN');
  const hasWarning = issues.some(i => i.verdict === 'WARNING');
  const verdict = hasBroken ? 'BROKEN' : hasWarning ? 'POOR' : 'OK';

  return { game_id: gameId, verdict, issues };
}

function main() {
  console.log(`\n🔍 Glimmers Static Analysis — ${GAME_IDS.length} games\n`);

  for (const gameId of GAME_IDS) {
    const result = analyzeGame(gameId);
    results.push(result);
  }

  const broken = results.filter(r => r.verdict === 'BROKEN');
  const poor = results.filter(r => r.verdict === 'POOR');
  const ok = results.filter(r => r.verdict === 'OK');

  console.log(`✅ OK: ${ok.length}  ⚠️ POOR: ${poor.length}  ❌ BROKEN: ${broken.length}\n`);

  if (broken.length) {
    console.log(`BROKEN (${broken.length}):`);
    broken.forEach(r => {
      console.log(`  ❌ ${r.game_id}`);
      r.issues.filter(i => i.verdict === 'BROKEN').forEach(i => {
        console.log(`     ${i.name}: ${i.fix}`);
        i.instances?.forEach(inst => console.log(`       ${inst}`));
      });
    });
  }

  if (poor.length) {
    console.log(`\nPOOR (${poor.length}):`);
    poor.forEach(r => {
      console.log(`  ⚠️  ${r.game_id}`);
      r.issues.filter(i => i.verdict === 'WARNING').forEach(i => {
        console.log(`     ${i.name}: ${i.fix}`);
        i.instances?.forEach(inst => console.log(`       ${inst}`));
      });
    });
  }

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log(`\nSaved: ${RESULTS_FILE}`);
}

main();
