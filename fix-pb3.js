#!/usr/bin/env node
// Fix: replace all finalSig.X references in PB blocks
// Strategy: find the endGame function, look for what local var holds score before setFinalSig
const fs = require('fs');
const path = require('path');

const games = process.argv[2] ? [process.argv[2]] : [
  'love-note','stack-drop','shadow-tap','symbol-scan',
  'pitch-match','crowd-roar','color-cascade','memory-grid',
  'snow-catch','firework-launch','countdown-crush','cupid-shot',
  'turkey-trot','harvest-catch'
];

for (const game of games) {
  const filePath = `app/games/${game}/page.tsx`;
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Find the PB block
  const pbIdx = content.indexOf('localStorage.getItem(PB_KEY)');
  if (pbIdx === -1) { console.log(`${game}: no PB block`); continue; }
  
  // Get context around PB block to find endGame's local state variable
  const contextStart = content.lastIndexOf('const endGame = useCallback', pbIdx);
  const snippet = content.slice(contextStart, pbIdx + 100);
  
  // Check what local variable holds the signal data
  let scoreExpr = '0';
  
  // Pattern 1: const s = stateRef.current; ... setFinalSig({ ...s.sig })
  if (snippet.includes('const s = stateRef.current')) {
    // Check for s.sig.score or s.score etc
    const afterPb = content.slice(pbIdx, pbIdx + 500);
    const sigScoreMatch = afterPb.match(/setFinalSig\(\{[^}]*\.\.(s\.sig|stateRef\.current\.sig)[^}]*\}/);
    if (sigScoreMatch) {
      scoreExpr = 's.sig?.score ?? 0';
    } else {
      // Try to find the score field name from s.sig
      const sigTypeMatch = content.match(/score:\s*number/);
      scoreExpr = sigTypeMatch ? 's.sig?.score ?? 0' : '0';
    }
  }
  // Pattern 2: sigRef.current
  else if (content.includes('sigRef') && snippet.includes('sigRef')) {
    scoreExpr = 'sigRef.current?.score ?? 0';
  }
  // Pattern 3: const sig = computed before setFinalSig
  else if (snippet.includes('const bData') || snippet.includes('const sig =')) {
    const bDataScore = content.slice(contextStart, pbIdx).match(/(?:bData|sig)\s*=\s*\{[^}]*score[^}]*\}/);
    scoreExpr = bDataScore ? '(bData?.score ?? 0)' : '0';
  }
  
  // Replace any finalSig.SOMETHING in the PB block
  const pbLineRegex = /const _pbVal = parseFloat\(String\(finalSig[^)]+\)\);/;
  if (pbLineRegex.test(content)) {
    content = content.replace(pbLineRegex, `const _pbVal = parseFloat(String(${scoreExpr}));`);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Fixed ${game}: using ${scoreExpr}`);
  } else {
    // Check for s.sig?.score that might fail  
    const sMatch = content.match(/const _pbVal = parseFloat\(String\(([^)]+)\)\)/);
    if (sMatch) {
      console.log(`${game}: uses ${sMatch[1]} (OK or needs check)`);
    } else {
      console.log(`${game}: PB pattern not found`);
    }
  }
}
