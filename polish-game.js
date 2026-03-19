#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const gameName = process.argv[2];
if (!gameName) { console.error('Usage: node polish-game.js <game-name>'); process.exit(1); }

const filePath = path.join('app', 'games', gameName, 'page.tsx');
let content = fs.readFileSync(filePath, 'utf8');
let modified = false;

// 1. Add haptics/audio imports
if (!content.includes('hapticScore, hapticFail, hapticVictory')) {
  content = content.replace(
    /(import \{ (?:initAudio|sfx|haptic|startMusic)[^\n]+ from '@\/lib\/audio';)/,
    `$1\nimport { playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';\nimport { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';`
  );
  modified = true;
}

// 2. Add PB_KEY after GAME_ID
if (!content.includes('PB_KEY')) {
  content = content.replace(
    /(const GAME_ID\s+=\s+'[^']+';)/,
    `$1\nconst PB_KEY       = 'pb_${gameName}';`
  );
  modified = true;
}

// 3. Add streak + isNewBest state near useScorePop
if (!content.includes('const [streak, setStreak]') && content.includes('useScorePop')) {
  content = content.replace(
    /(const \{ pops, triggerPop \} = useScorePop\(\);)/,
    `$1\n  const [streak, setStreak] = useState(0);\n  const [isNewBest, setIsNewBest] = useState(false);`
  );
  modified = true;
} else if (!content.includes('const [streak, setStreak]')) {
  // Add near playerSessionRef
  content = content.replace(
    /(const playerSessionRef\s+=\s+useRef<PlayerSession \| null>\(null\);)/,
    `$1\n  const [streak, setStreak] = useState(0);\n  const [isNewBest, setIsNewBest] = useState(false);`
  );
  modified = true;
}

// 4. Update useEffect to add hapticScore + streak update
if (content.includes('triggerPop(`+${numScore - prevScoreRef.current}`') && !content.includes('hapticScore();')) {
  content = content.replace(
    /triggerPop\(`\+\$\{numScore - prevScoreRef\.current\}`([^;]+);\s*\n/,
    `triggerPop(\`+\${numScore - prevScoreRef.current}\`$1;\n      hapticScore();\n      playScoreHit('default', numScore - prevScoreRef.current);\n      setStreak(Math.floor(numScore / 5));\n`
  );
  modified = true;
}

// 5. Replace haptic victory calls in endGame
if (content.includes('haptic([30, 50, 30, 50, 100])')) {
  content = content.replace(
    /sfx\.success\(\);\s*\n\s*haptic\(\[30, 50, 30, 50, 100\]\);/g,
    `sfx.success();\n    hapticVictory();\n    playVictoryFanfare();`
  );
  modified = true;
}

// Also replace the collision haptic if it uses haptic([200]) or haptic([300])
if (content.includes('sfx.collision(); haptic([200])') || content.includes('sfx.collision(); haptic([300])')) {
  content = content.replace(/sfx\.collision\(\); haptic\(\[200\]\)/g, 'sfx.collision(); hapticFail()');
  content = content.replace(/sfx\.collision\(\); haptic\(\[300\]\)/g, 'sfx.collision(); hapticFail()');
  modified = true;
}

// 6. Add PB tracking before setFinalSig or setBehavior or setGameState('done')
if (!content.includes('localStorage.setItem(PB_KEY')) {
  // Find score variable from EndScreen score prop
  const scoreMatch = content.match(/score=\{String\(([^)]+)\)\}/);
  const scoreExpr = scoreMatch ? scoreMatch[1] : 'finalSig?.score ?? 0';
  const pbBlock = `
    // Personal best tracking
    try {
      const _pbPrev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      const _pbVal = parseFloat(String(${scoreExpr}));
      if (!isNaN(_pbVal) && _pbVal > _pbPrev) {
        localStorage.setItem(PB_KEY, String(Math.round(_pbVal)));
        setIsNewBest(true);
      }
    } catch { /* ignore */ }
`;
  // Insert before setFinalSig({
  if (content.includes('setFinalSig({')) {
    content = content.replace(/(\s*setFinalSig\(\{)/, `${pbBlock}\n$1`);
    modified = true;
  } else if (content.includes('setBehavior(bData)')) {
    content = content.replace(/(\s*setBehavior\(bData\))/, `${pbBlock}\n$1`);
    modified = true;
  } else if (content.includes("setGameState('done')")) {
    content = content.replace(/(\s*setGameState\('done'\))/, `${pbBlock}\n$1`);
    modified = true;
  }
}

// 7. Fix StreakBadge streak={0}
if (content.includes('<StreakBadge streak={0}')) {
  content = content.replace(/<StreakBadge streak=\{0\}/g, '<StreakBadge streak={streak}');
  modified = true;
}

// 8. Add New Best banner if not present
if (!content.includes('New Best!') && content.includes('<EndScreen')) {
  const banner = `
      {/* New best banner */}
      <AnimatePresence>
        {isNewBest && (
          <motion.div
            key="new-best"
            initial={{ opacity: 0, y: -20, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, delay: 0.5 }}
            style={{
              position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)',
              zIndex: 90, pointerEvents: 'none',
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
              borderRadius: 20, padding: '8px 20px', fontSize: 20,
              fontWeight: 900, color: '#000', whiteSpace: 'nowrap',
              boxShadow: '0 4px 20px rgba(251,191,36,0.5)',
            }}
          >
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>
`;
  // Insert before first EndScreen render or before End Screen comment
  const insertBefore = content.includes('End Screen') 
    ? /(\s*\{\/\*[^*]*End Screen[^*]*\*\/\})/
    : /({\s*(?:phase|gameState) === 'done' && (?:finalSig|behavior) &&)/;
  
  if (insertBefore.test(content)) {
    content = content.replace(insertBefore, `${banner}\n$1`);
    modified = true;
  } else {
    // Fallback: before first <EndScreen
    content = content.replace(/(\s*<EndScreen)/, `${banner}\n$1`);
    modified = true;
  }
}

// 9. Reset streak/isNewBest in startLoop (find the start game initialization)
if (!content.includes('setStreak(0)') && content.includes('setStreak')) {
  // Add reset near other setXxx(x) reset calls
  content = content.replace(
    /(setTimeLeft\((?:60|45|30)\);.*setGameState\('playing'\))/s,
    `$1\n    setStreak(0); setIsNewBest(false);`
  );
  modified = true;
}

if (modified) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`✅ Patched ${gameName}`);
} else {
  console.log(`⚠️ No changes needed for ${gameName}`);
}
