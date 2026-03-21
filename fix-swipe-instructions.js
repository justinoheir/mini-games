#!/usr/bin/env node
// fix-swipe-instructions.js
// Moves SwipeInstructions OUTSIDE GameShell for each game.

const fs = require('fs');
const path = require('path');

const GAMES_DIR = path.join(__dirname, 'app', 'games');

const GAMES = [
  'whisper-bomb', 'breath-rider', 'steady-hand', 'tunnel', 'pulse-sphere',
  'dodge-blitz', 'balance-beam', 'pitch-match', 'crowd-roar', 'penalty-kick',
  'spiral-throw', 'reflex-rally', 'precision-putt', 'color-cascade', 'memory-grid',
  'shadow-tap', 'stack-drop', 'symbol-scan', 'gift-rush', 'snow-catch',
  'firework-launch', 'countdown-crush', 'cupid-shot', 'love-note', 'turkey-trot',
  'harvest-catch'
];

function getStateVarName(content) {
  // Check for useState<...>('start')
  const m1 = content.match(/const \[(\w+),\s*set\w+\]\s*=\s*useState[^(]*\('start'\)/);
  if (m1) return m1[1];
  // Fallback: find first `xxx === 'start'` (exclude showInstructions)
  const m2 = content.match(/\b(gameState|gamePhase|outerPhase|phase)\b\s*===\s*['"]start['"]/);
  if (m2) return m2[1];
  return 'phase';
}

function fixGame(gameName) {
  const filePath = path.join(GAMES_DIR, gameName, 'page.tsx');

  if (!fs.existsSync(filePath)) {
    console.error(`  ✗ ${gameName}: file not found`);
    return false;
  }

  let content = fs.readFileSync(filePath, 'utf-8');

  // Check if already fixed
  if (content.includes('return (\n    <>') || content.includes('return (\r\n    <>')) {
    console.log(`  ✓ ${gameName}: already fixed`);
    return true;
  }

  // Validate expected wrong pattern
  if (!/return \(\s*\n\s*<GameShell/.test(content)) {
    console.error(`  ✗ ${gameName}: unexpected return structure`);
    return false;
  }

  // Find the SwipeInstructions block inside GameShell
  // Pattern: `      {showInstructions && (\n        <SwipeInstructions\n...        />\n      )}`
  const swipeOpenToken = '{showInstructions && (';
  const swipeStart = content.indexOf(swipeOpenToken);
  if (swipeStart === -1) {
    console.error(`  ✗ ${gameName}: no showInstructions block found`);
    return false;
  }

  // Find self-closing /> of SwipeInstructions
  const swipeTagStart = content.indexOf('<SwipeInstructions', swipeStart);
  if (swipeTagStart === -1) {
    console.error(`  ✗ ${gameName}: can't find <SwipeInstructions tag`);
    return false;
  }

  const swipeTagClose = content.indexOf('/>', swipeTagStart);
  if (swipeTagClose === -1) {
    console.error(`  ✗ ${gameName}: can't find SwipeInstructions />`);
    return false;
  }
  const swipeElementEnd = swipeTagClose + 2; // includes />

  // Find the closing )} of the block (first )} after the />)
  const closingParenBrace = content.indexOf(')}', swipeElementEnd);
  if (closingParenBrace === -1) {
    console.error(`  ✗ ${gameName}: can't find closing )}`);
    return false;
  }
  const blockEnd = closingParenBrace + 2;

  // Extract the SwipeInstructions element (from < to />)
  const swipeElement = content.substring(swipeTagStart, swipeElementEnd);

  // Get the line with {showInstructions to capture its indent
  const swipeLineStart = content.lastIndexOf('\n', swipeStart) + 1;
  const outerIndent = content.substring(swipeLineStart, swipeStart).match(/^(\s*)/)[1]; // e.g. "      "

  // Get the line with <SwipeInstructions to capture its indent
  const swipeElemLineStart = content.lastIndexOf('\n', swipeTagStart) + 1;
  const innerIndent = content.substring(swipeElemLineStart, swipeTagStart).match(/^(\s*)/)[1]; // e.g. "        "

  // Get state variable name
  const stateVar = getStateVarName(content);

  // Build the new outside block
  const newOutsideBlock =
    `${outerIndent}{${stateVar} === 'start' && showInstructions && (\n` +
    `${innerIndent}${swipeElement}\n` +
    `${outerIndent})}`;

  // Step 1: Remove the old SwipeInstructions block (including preceding newline)
  const removeFrom = content.lastIndexOf('\n', swipeStart); // \n before the block
  content = content.substring(0, removeFrom) + content.substring(blockEnd);

  // Step 2: Find `return (\n    <GameShell` and insert fragment + outside block before it
  const returnPos = content.indexOf('return (');
  if (returnPos === -1) {
    console.error(`  ✗ ${gameName}: can't find return ( after cleanup`);
    return false;
  }

  const gameShellPos = content.indexOf('<GameShell', returnPos);
  if (gameShellPos === -1) {
    console.error(`  ✗ ${gameName}: can't find <GameShell after cleanup`);
    return false;
  }

  // Find line start of <GameShell line
  const gsLineStart = content.lastIndexOf('\n', gameShellPos) + 1;
  const gsIndent = content.substring(gsLineStart, gameShellPos).match(/^(\s*)/)[1]; // e.g. "    "

  // Insert `<>\n{outsideBlock}\n` before <GameShell line
  const insertContent = `${gsIndent}<>\n${newOutsideBlock}\n`;
  content = content.substring(0, gsLineStart) + insertContent + content.substring(gsLineStart);

  // Step 3: Find last </GameShell> and insert </> after it
  const closeGS = content.lastIndexOf('</GameShell>');
  if (closeGS === -1) {
    console.error(`  ✗ ${gameName}: can't find </GameShell>`);
    return false;
  }
  const afterCloseGS = closeGS + '</GameShell>'.length;
  content = content.substring(0, afterCloseGS) + `\n${gsIndent}</>` + content.substring(afterCloseGS);

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`  ✓ ${gameName}: fixed (stateVar=${stateVar})`);
  return true;
}

let fixed = 0, failed = 0;
for (const game of GAMES) {
  try {
    if (fixGame(game)) fixed++;
    else failed++;
  } catch (err) {
    console.error(`  ✗ ${game}: EXCEPTION - ${err.message}`);
    console.error(err.stack);
    failed++;
  }
}

console.log(`\nDone: ${fixed} fixed, ${failed} failed`);
