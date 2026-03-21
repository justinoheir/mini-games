/**
 * DPR fix script for Glimmers canvas games.
 * Applies devicePixelRatio handling to all canvas games that are missing it.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const BASE = 'C:\\Users\\justi\\.openclaw\\workspace\\mini-games\\app\\games';

// Pattern A: canvas uses canvas.offsetWidth in resize
const PATTERN_A_GAMES = [
  'steady-hand', 'dodge-blitz', 'balance-beam', 'pitch-match', 'crowd-roar',
  'color-cascade', 'memory-grid', 'shadow-tap', 'stack-drop', 'symbol-scan',
  'snow-catch', 'firework-launch', 'countdown-crush', 'cupid-shot',
  'turkey-trot', 'harvest-catch',
];

// Pattern B: canvas uses window.innerWidth in resize
const PATTERN_B_GAMES = [
  'breath-rider', 'penalty-kick', 'spiral-throw', 'reflex-rally', 'precision-putt',
];

const DPR_BLOCK_A = `const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      const ctx2 = canvas.getContext('2d');
      if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);`;

// Pattern A: replace the two-line resize block
// Handles both forms: `canvas.width = canvas.offsetWidth;` and
// `canvas.width = canvas.offsetWidth || window.innerWidth;`
function fixPatternA(content, game) {
  let out = content;

  // Replace the 2-line resize pattern (various forms)
  // Form 1: exactly canvas.offsetWidth
  out = out.replace(
    /canvas\.width\s*=\s*canvas\.offsetWidth;\s*\n(\s*)canvas\.height\s*=\s*canvas\.offsetHeight;/g,
    (_, indent) =>
      `${DPR_BLOCK_A.replace(/^/gm, '')}`.replace(/\n      /g, `\n${indent}`).trimStart()
  );

  // Form 2: canvas.offsetWidth || window.innerWidth
  out = out.replace(
    /canvas\.width\s*=\s*canvas\.offsetWidth\s*\|\|\s*window\.innerWidth;\s*\n(\s*)canvas\.height\s*=\s*canvas\.offsetHeight\s*\|\|\s*window\.innerHeight;/g,
    (_, indent) =>
      `${DPR_BLOCK_A.replace(/^/gm, '')}`.replace(/\n      /g, `\n${indent}`).trimStart()
  );

  // Now replace all remaining canvas.width READS (not the ones we just set in the DPR block)
  // After the replacements above, the only canvas.width/height left are reads
  // Replace: canvas.width (not preceded by `= ` assignment context we introduced)
  // Strategy: replace ALL canvas.width -> canvas.offsetWidth, canvas.height -> canvas.offsetHeight
  // The DPR block already sets canvas.width = w * dpr where w = canvas.offsetWidth, so
  // canvas.offsetWidth in those lines is fine.
  
  // Replace reads: canvas.width (as a value) → canvas.offsetWidth
  // But don't replace inside the DPR block we just inserted (where it's an assignment target)
  // The DPR block contains: `canvas.width  = w * dpr;` — this is the assignment
  // After our regex replace, the only `canvas.width` left are reads, EXCEPT in the DPR block
  // where we have `canvas.width  = w * dpr;` (assignment, not a read)
  
  // Simple approach: replace canvas.width = w * dpr (our assignment) temporarily,
  // then replace all remaining canvas.width, then restore
  const PLACEHOLDER_W = '__CANVAS_W_ASSIGN__';
  const PLACEHOLDER_H = '__CANVAS_H_ASSIGN__';
  
  out = out.replace(/canvas\.width\s*=\s*w \* dpr;/g, `${PLACEHOLDER_W}`);
  out = out.replace(/canvas\.height\s*=\s*h \* dpr;/g, `${PLACEHOLDER_H}`);
  
  out = out.replace(/canvas\.width/g, 'canvas.offsetWidth');
  out = out.replace(/canvas\.height/g, 'canvas.offsetHeight');
  
  out = out.replace(new RegExp(PLACEHOLDER_W, 'g'), 'canvas.width  = w * dpr;');
  out = out.replace(new RegExp(PLACEHOLDER_H, 'g'), 'canvas.height = h * dpr;');

  return out;
}

function fixPatternB(content, game) {
  let out = content;

  // Replace the inline pattern: canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  // followed by onResize function
  // The pattern in these games is on two consecutive lines (sometimes one long line):
  
  // Pattern: canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  // Then: const onResize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
  
  const DPR_BLOCK_B_INITIAL = `const dpr = window.devicePixelRatio || 1;
    canvas.width  = window.innerWidth  * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width  = window.innerWidth  + 'px';
    canvas.style.height = window.innerHeight + 'px';
    const ctx2 = canvas.getContext('2d');
    if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);`;

  const DPR_BLOCK_B_ONRESIZE = `const onResize = () => {
      const d = window.devicePixelRatio || 1;
      canvas.width  = window.innerWidth  * d;
      canvas.height = window.innerHeight * d;
      canvas.style.width  = window.innerWidth  + 'px';
      canvas.style.height = window.innerHeight + 'px';
      const c2 = canvas.getContext('2d');
      if (c2) c2.setTransform(d, 0, 0, d, 0, 0);
    };`;

  // Replace initial canvas size + onResize pattern
  out = out.replace(
    /canvas\.width\s*=\s*window\.innerWidth;\s*canvas\.height\s*=\s*window\.innerHeight;\s*\n\s*const onResize = \(\) => \{\s*canvas\.width\s*=\s*window\.innerWidth;\s*canvas\.height\s*=\s*window\.innerHeight;\s*\};\s*/,
    DPR_BLOCK_B_INITIAL + '\n    ' + DPR_BLOCK_B_ONRESIZE + '\n    '
  );

  // Replace all remaining canvas.width reads → window.innerWidth
  // Same placeholder approach
  const PW = '__WIN_W_ASSIGN__';
  const PH = '__WIN_H_ASSIGN__';
  
  // Protect our new assignments
  out = out.replace(/canvas\.width\s*=\s*window\.innerWidth\s*\*\s*d;/g, PW + 'W');
  out = out.replace(/canvas\.height\s*=\s*window\.innerHeight\s*\*\s*d;/g, PH + 'H');
  out = out.replace(/canvas\.width\s*=\s*window\.innerWidth\s*\*\s*dpr;/g, PW + 'WD');
  out = out.replace(/canvas\.height\s*=\s*window\.innerHeight\s*\*\s*dpr;/g, PH + 'HD');
  
  out = out.replace(/canvas\.width/g, 'window.innerWidth');
  out = out.replace(/canvas\.height/g, 'window.innerHeight');
  
  out = out.replace(new RegExp(PW + 'W', 'g'), 'canvas.width  = window.innerWidth  * d;');
  out = out.replace(new RegExp(PH + 'H', 'g'), 'canvas.height = window.innerHeight * d;');
  out = out.replace(new RegExp(PW + 'WD', 'g'), 'canvas.width  = window.innerWidth  * dpr;');
  out = out.replace(new RegExp(PH + 'HD', 'g'), 'canvas.height = window.innerHeight * dpr;');

  return out;
}

let totalChanged = 0;

for (const game of PATTERN_A_GAMES) {
  const filePath = join(BASE, game, 'page.tsx');
  try {
    const original = readFileSync(filePath, 'utf8');
    const fixed = fixPatternA(original, game);
    if (fixed !== original) {
      writeFileSync(filePath, fixed, 'utf8');
      console.log(`✅ FIXED (Pattern A): ${game}`);
      totalChanged++;
    } else {
      console.log(`⚠️  No changes made to: ${game} (pattern not found?)`);
    }
  } catch (e) {
    console.error(`❌ ERROR: ${game}: ${e.message}`);
  }
}

for (const game of PATTERN_B_GAMES) {
  const filePath = join(BASE, game, 'page.tsx');
  try {
    const original = readFileSync(filePath, 'utf8');
    const fixed = fixPatternB(original, game);
    if (fixed !== original) {
      writeFileSync(filePath, fixed, 'utf8');
      console.log(`✅ FIXED (Pattern B): ${game}`);
      totalChanged++;
    } else {
      console.log(`⚠️  No changes made to: ${game} (pattern not found?)`);
    }
  } catch (e) {
    console.error(`❌ ERROR: ${game}: ${e.message}`);
  }
}

console.log(`\nDone. ${totalChanged} files modified.`);
