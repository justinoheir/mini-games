#!/usr/bin/env node
// Fix: replace finalSig.score (React state, null at time of check) with s.sig.score
const fs = require('fs');
const path = require('path');

const games = [
  'balance-beam','pitch-match','crowd-roar','color-cascade','memory-grid',
  'shadow-tap','symbol-scan','gift-rush','snow-catch','boo-blast',
  'firework-launch','countdown-crush','cupid-shot','turkey-trot','harvest-catch'
];

for (const game of games) {
  const filePath = `app/games/${game}/page.tsx`;
  let content = fs.readFileSync(filePath, 'utf8');
  
  // The PB block uses finalSig.score which is null. 
  // Find the score from the EndScreen score= prop to know what to use
  const scoreMatch = content.match(/score=\{[`'"]?([^`'"{}]+)[`'"]?\}/);
  
  // Simple fix: use s.sig?.score ?? 0 as fallback
  // But first check if s.sig has a score field
  const hasSigScore = content.includes('sig.score') || content.includes('.score:');
  
  if (hasSigScore) {
    content = content.replace(
      /const _pbVal = parseFloat\(String\(finalSig\.score\)\);/g,
      `const _pbVal = parseFloat(String(s.sig?.score ?? 0));`
    );
  } else {
    // Use scoreDisplay as fallback
    const hasScoreDisplay = content.includes('scoreDisplay');
    if (hasScoreDisplay) {
      // Score display is updated in the setInterval/rAF, so use it
      content = content.replace(
        /const _pbVal = parseFloat\(String\(finalSig\.score\)\);/g,
        `const _pbVal = parseFloat(String(s.sig?.score ?? s.sig?.coinsCollected ?? s.sig?.obstaclesAvoided ?? 0));`
      );
    } else {
      content = content.replace(
        /const _pbVal = parseFloat\(String\(finalSig\.score\)\);/g,
        `const _pbVal = 0; // TODO: fix score tracking`
      );
    }
  }
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Fixed PB in ${game}: hasSigScore=${hasSigScore}`);
}
