#!/usr/bin/env node
// Fix s.sig?.score for games that don't use stateRef pattern
const fs = require('fs');

const games = [
  'balance-beam','pitch-match','crowd-roar','color-cascade','memory-grid',
  'shadow-tap','symbol-scan','gift-rush','snow-catch','boo-blast',
  'firework-launch','countdown-crush','cupid-shot','turkey-trot','harvest-catch'
];

for (const game of games) {
  const filePath = `app/games/${game}/page.tsx`;
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Find what variable holds signals in this game's endGame
  // Look for patterns near the PB tracking block
  const pbIdx = content.indexOf('localStorage.getItem(PB_KEY)');
  if (pbIdx === -1) continue;
  
  // Look for the endGame function definition
  const endGameIdx = content.lastIndexOf('const endGame = useCallback', pbIdx);
  const endGameSnippet = content.slice(endGameIdx, pbIdx + 200);
  
  // Detect state pattern
  let scoreExpr = '0';
  
  if (endGameSnippet.includes('const s = stateRef.current')) {
    // Uses stateRef.current - check if s.sig exists
    if (content.includes('stateRef.current.sig') || content.includes('s.sig.')) {
      scoreExpr = 's.sig?.score ?? 0';
    } else {
      scoreExpr = '0';
    }
  } else if (endGameSnippet.includes('sigRef.current')) {
    scoreExpr = 'sigRef.current?.score ?? 0';
  } else if (endGameSnippet.includes('const sig = ')) {
    scoreExpr = 'sig?.score ?? 0';
  } else if (endGameSnippet.includes('runningRef')) {
    // Check for sigRef or other pattern
    if (content.includes('sigRef')) {
      scoreExpr = 'sigRef.current?.score ?? 0';
    } else {
      scoreExpr = '0';
    }
  }
  
  // Replace the broken reference
  const oldPbVal = "const _pbVal = parseFloat(String(s.sig?.score ?? 0));";
  if (content.includes(oldPbVal) && scoreExpr !== 's.sig?.score ?? 0') {
    content = content.replace(oldPbVal, `const _pbVal = parseFloat(String(${scoreExpr}));`);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Fixed ${game}: using ${scoreExpr}`);
  } else if (content.includes(oldPbVal)) {
    // Keep s.sig?.score but need to verify s exists
    // Check if endGame has `const s = stateRef.current`
    if (!endGameSnippet.includes('const s = stateRef.current') && !endGameSnippet.includes('const s =')) {
      // s is not defined, use 0
      content = content.replace(oldPbVal, `const _pbVal = 0; // score tracking N/A`);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Fixed ${game}: s not defined, using 0`);
    } else {
      console.log(`OK ${game}: s is defined`);
    }
  } else {
    // Check for other broken patterns
    const m = content.match(/const _pbVal = parseFloat\(String\(([^)]+)\)\)/);
    if (m) {
      console.log(`${game}: uses ${m[1]}`);
    } else {
      console.log(`${game}: PB block not found`);
    }
  }
}
