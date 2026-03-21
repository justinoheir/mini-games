#!/usr/bin/env node
/**
 * fix-play-again.js
 * Patches all game files to add missing state resets in handlePlayAgain:
 *  - setIsNewBest(false)   -- prevents "New Best" banner persisting
 *  - setStreak(0)          -- resets StreakBadge on replay
 *  - prevScoreRef.current = 0  -- ensures score pop fires correctly on replay
 */

const fs = require('fs');
const path = require('path');

const gamesDir = path.join(__dirname, 'app', 'games');
const games = fs.readdirSync(gamesDir).filter(d => d !== '__scaffold__');

let totalFixed = 0;

for (const game of games) {
  const filePath = path.join(gamesDir, game, 'page.tsx');
  if (!fs.existsSync(filePath)) continue;

  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // Determine what state this game has
  const hasIsNewBest = content.includes('const [isNewBest, setIsNewBest]');
  const hasStreak = content.includes('const [streak, setStreak]');
  const hasPrevScoreRef = content.includes('prevScoreRef');

  // Check what the handlePlayAgain already resets
  // We'll find the handlePlayAgain block by locating it and its closing }, []);
  const haSetIsNewBestFalse = content.includes('setIsNewBest(false)');
  const hasSetStreak0 = content.includes('setStreak(0)');
  const hasPrevScoreReset = content.includes('prevScoreRef.current = 0');

  const needsIsNewBest = hasIsNewBest && !haSetIsNewBestFalse;
  const needsStreak = hasStreak && !hasSetStreak0;
  const needsPrevScore = hasPrevScoreRef && !hasPrevScoreReset;

  if (!needsIsNewBest && !needsStreak && !needsPrevScore) {
    console.log(`  OK: ${game}`);
    continue;
  }

  // Build the lines to inject
  const injectLines = [];
  if (needsIsNewBest) injectLines.push('    setIsNewBest(false);');
  if (needsStreak)    injectLines.push('    setStreak(0);');
  if (needsPrevScore) injectLines.push('    prevScoreRef.current = 0;');

  // Strategy: Find handlePlayAgain callback block and inject before its closing `}, [`
  // The pattern is: handlePlayAgain = useCallback(() => { ... }, []);
  // or: handlePlayAgain = useCallback(async () => { ... }, []);
  // We find the callback start, then find the matching closing `}, [` at the same depth

  const startMarker = 'handlePlayAgain = useCallback(';
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) {
    console.log(`  SKIP (no handlePlayAgain): ${game}`);
    continue;
  }

  // Find the opening brace of the arrow function body
  // Pattern: useCallback(() => { or useCallback(async () => {
  let braceStart = content.indexOf('{', startIdx + startMarker.length);
  if (braceStart === -1) {
    console.log(`  SKIP (no brace): ${game}`);
    continue;
  }

  // Find the matching closing brace
  let depth = 0;
  let pos = braceStart;
  let closingBrace = -1;
  while (pos < content.length) {
    const ch = content[pos];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        closingBrace = pos;
        break;
      }
    }
    pos++;
  }

  if (closingBrace === -1) {
    console.log(`  SKIP (no closing brace): ${game}`);
    continue;
  }

  // Verify this is the handlePlayAgain closing (should be followed by , [])
  const afterBrace = content.slice(closingBrace, closingBrace + 20).replace(/\s/g, '');
  if (!afterBrace.startsWith('},[') && !afterBrace.startsWith('},[]')) {
    console.log(`  SKIP (unexpected pattern after brace): ${game} -> ${afterBrace.slice(0, 20)}`);
    continue;
  }

  // Inject before the closing brace
  const injection = '\n' + injectLines.join('\n');
  content = content.slice(0, closingBrace) + injection + '\n  ' + content.slice(closingBrace);

  fs.writeFileSync(filePath, content, 'utf8');
  changed = true;
  totalFixed++;

  const fixes = [];
  if (needsIsNewBest) fixes.push('setIsNewBest(false)');
  if (needsStreak)    fixes.push('setStreak(0)');
  if (needsPrevScore) fixes.push('prevScoreRef.current=0');
  console.log(`  FIXED: ${game} [${fixes.join(', ')}]`);
}

console.log(`\nDone. Fixed ${totalFixed} game(s).`);
