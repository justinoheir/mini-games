/**
 * DPR fix for Pattern B canvas games (window.innerWidth-based resize).
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const BASE = 'C:\\Users\\justi\\.openclaw\\workspace\\mini-games\\app\\games';

const PATTERN_B_GAMES = [
  'breath-rider', 'penalty-kick', 'spiral-throw', 'reflex-rally', 'precision-putt',
];

function fixPatternB(content) {
  let out = content;

  // The original pattern across games is two lines (possibly same line) + onResize arrow function.
  // Replace the initial resize + onResize block.
  // We'll match it flexibly since formatting varies.

  const DPR_INITIAL = [
    `const dpr = window.devicePixelRatio || 1;`,
    `    canvas.width  = window.innerWidth  * dpr;`,
    `    canvas.height = window.innerHeight * dpr;`,
    `    canvas.style.width  = window.innerWidth  + 'px';`,
    `    canvas.style.height = window.innerHeight + 'px';`,
    `    const ctx2 = canvas.getContext('2d');`,
    `    if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);`,
  ].join('\n');

  const ONRESIZE_NEW = [
    `const onResize = () => {`,
    `      const d = window.devicePixelRatio || 1;`,
    `      canvas.width  = window.innerWidth  * d;`,
    `      canvas.height = window.innerHeight * d;`,
    `      canvas.style.width  = window.innerWidth  + 'px';`,
    `      canvas.style.height = window.innerHeight + 'px';`,
    `      const c2 = canvas.getContext('2d');`,
    `      if (c2) c2.setTransform(d, 0, 0, d, 0, 0);`,
    `    };`,
  ].join('\n');

  // Replace: canvas.width = window.innerWidth; canvas.height = window.innerHeight;\n
  //          const onResize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
  // (May be on one line or two lines)
  out = out.replace(
    /canvas\.width\s*=\s*window\.innerWidth;\s*canvas\.height\s*=\s*window\.innerHeight;\s*[\n]?\s*const onResize = \(\) => \{\s*canvas\.width\s*=\s*window\.innerWidth;\s*canvas\.height\s*=\s*window\.innerHeight;\s*\};/,
    DPR_INITIAL + '\n    ' + ONRESIZE_NEW
  );

  // Now replace remaining canvas.width/height reads with window.innerWidth/innerHeight.
  // The new assignments we introduced are:
  //   canvas.width  = window.innerWidth  * dpr;  (uses 'dpr')
  //   canvas.height = window.innerHeight * dpr;  (uses 'dpr')
  //   canvas.width  = window.innerWidth  * d;    (uses 'd', inside onResize)
  //   canvas.height = window.innerHeight * d;    (uses 'd', inside onResize)
  // We need to protect these before replacing reads.

  // Use unique tokens that definitely won't appear in the code
  const A = '\x00A\x00'; // canvas.width = * dpr (protect longer first!)
  const B = '\x00B\x00'; // canvas.height = * dpr
  const C = '\x00C\x00'; // canvas.width = * d
  const D = '\x00D\x00'; // canvas.height = * d
  const E = '\x00E\x00'; // canvas.style.width
  const F = '\x00F\x00'; // canvas.style.height

  // Protect style assignments first (they contain canvas. but not canvas.width/height directly)
  out = out.replace(/canvas\.style\.width/g, E);
  out = out.replace(/canvas\.style\.height/g, F);

  // Protect the DPR assignments — LONGER PATTERNS FIRST to avoid prefix matching
  out = out.replace(/canvas\.width\s*=\s*window\.innerWidth\s*\*\s*dpr;/g, A);
  out = out.replace(/canvas\.height\s*=\s*window\.innerHeight\s*\*\s*dpr;/g, B);
  out = out.replace(/canvas\.width\s*=\s*window\.innerWidth\s*\*\s*d;/g, C);
  out = out.replace(/canvas\.height\s*=\s*window\.innerHeight\s*\*\s*d;/g, D);

  // Replace remaining reads
  out = out.replace(/canvas\.width/g, 'window.innerWidth');
  out = out.replace(/canvas\.height/g, 'window.innerHeight');

  // Restore protected assignments
  out = out.replace(new RegExp(A.replace(/\x00/g, '\\x00'), 'g'), 'canvas.width  = window.innerWidth  * dpr;');
  out = out.replace(new RegExp(B.replace(/\x00/g, '\\x00'), 'g'), 'canvas.height = window.innerHeight * dpr;');
  out = out.replace(new RegExp(C.replace(/\x00/g, '\\x00'), 'g'), 'canvas.width  = window.innerWidth  * d;');
  out = out.replace(new RegExp(D.replace(/\x00/g, '\\x00'), 'g'), 'canvas.height = window.innerHeight * d;');
  out = out.replace(new RegExp(E.replace(/\x00/g, '\\x00'), 'g'), 'canvas.style.width');
  out = out.replace(new RegExp(F.replace(/\x00/g, '\\x00'), 'g'), 'canvas.style.height');

  return out;
}

for (const game of PATTERN_B_GAMES) {
  const filePath = join(BASE, game, 'page.tsx');
  try {
    const original = readFileSync(filePath, 'utf8');
    const fixed = fixPatternB(original);
    if (fixed !== original) {
      // Sanity check: no null bytes should remain
      if (fixed.includes('\x00')) {
        console.error(`❌ SANITY FAIL (null bytes remain): ${game}`);
        continue;
      }
      writeFileSync(filePath, fixed, 'utf8');
      console.log(`✅ FIXED: ${game}`);
    } else {
      console.log(`⚠️  No changes: ${game}`);
    }
  } catch (e) {
    console.error(`❌ ERROR: ${game}: ${e.message}`);
  }
}

console.log('Done.');
