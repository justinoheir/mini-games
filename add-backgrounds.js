const fs = require('fs');
const path = require('path');

const environments = {
  'penalty-kick': `radial-gradient(ellipse at 20% 0%, rgba(255,255,220,0.08) 0%, transparent 50%), radial-gradient(ellipse at 80% 0%, rgba(255,255,220,0.08) 0%, transparent 50%), radial-gradient(ellipse at 50% 110%, #1a5c2a 0%, #0d2e14 40%, #051209 70%, #020808 100%)`,
  'hoop-shot': `radial-gradient(ellipse at 50% 120%, #8b5e3c 0%, #6b4423 30%, #4a2d14 60%, #1a0f06 85%, #0a0604 100%), radial-gradient(ellipse at 50% 0%, rgba(255,160,80,0.12) 0%, transparent 60%)`,
  'precision-putt': `linear-gradient(180deg, #87ceeb 0%, #b8e4f7 25%, #5a9e6a 55%, #2d6e3a 75%, #1a4a25 100%), radial-gradient(ellipse at 75% 60%, rgba(255,220,150,0.15) 0%, transparent 40%)`,
  'breath-rider': `linear-gradient(180deg, #1a6eb5 0%, #2e8fd4 20%, #7ec8e3 45%, #c8e8f5 65%, #e8f4fa 80%, #f5faff 100%)`,
  'tunnel': `radial-gradient(ellipse at 50% 50%, #1a0a3a 0%, #0d0520 40%, #050212 70%, #020108 100%), radial-gradient(ellipse at 30% 20%, rgba(100,60,200,0.15) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(60,80,200,0.12) 0%, transparent 50%)`,
  'dodge-blitz': `linear-gradient(180deg, #0d0020 0%, #160035 40%, #1a0040 70%, #0a0015 100%), radial-gradient(ellipse at 0% 100%, rgba(180,0,255,0.12) 0%, transparent 50%), radial-gradient(ellipse at 100% 0%, rgba(0,200,255,0.08) 0%, transparent 50%)`,
  'snow-catch': `linear-gradient(180deg, #04091a 0%, #080f2a 30%, #0d1840 60%, #091228 85%, #040a1a 100%), radial-gradient(ellipse at 50% 0%, rgba(160,200,255,0.1) 0%, transparent 60%)`,
  'crowd-roar': `radial-gradient(ellipse at 50% 30%, rgba(255,160,60,0.18) 0%, rgba(255,100,30,0.08) 30%, transparent 65%), linear-gradient(180deg, #0a0608 0%, #120a10 40%, #0d0609 70%, #060305 100%)`,
  'cauldron-bubble': `radial-gradient(ellipse at 50% 80%, rgba(0,200,80,0.15) 0%, rgba(0,120,50,0.08) 40%, transparent 70%), linear-gradient(180deg, #0d0018 0%, #15002a 40%, #1a0030 65%, #0a0015 100%)`,
  'gift-rush': `radial-gradient(ellipse at 50% 0%, rgba(255,200,50,0.12) 0%, transparent 50%), linear-gradient(180deg, #1a0005 0%, #280008 30%, #320008 60%, #1a0005 100%)`,
  'love-note': `linear-gradient(160deg, #1a0520 0%, #2a0835 25%, #350a45 50%, #2a0830 75%, #1a0520 100%), radial-gradient(ellipse at 60% 30%, rgba(255,100,150,0.12) 0%, transparent 55%)`,
  'cupid-shot': `linear-gradient(180deg, #87cefa 0%, #a8d8f0 25%, #c5e8f8 50%, #dff0fa 70%, #eef8ff 90%, #f8fdff 100%), radial-gradient(ellipse at 30% 40%, rgba(255,255,255,0.5) 0%, transparent 30%), radial-gradient(ellipse at 70% 65%, rgba(255,255,255,0.4) 0%, transparent 25%)`,
  'reflex-rally': `linear-gradient(180deg, #7a2e1a 0%, #9e3c22 25%, #b8472a 45%, #8b3520 65%, #5a2010 85%, #2d1008 100%), radial-gradient(ellipse at 50% 50%, rgba(255,180,120,0.08) 0%, transparent 60%)`,
  'color-cascade': `radial-gradient(ellipse at 20% 80%, rgba(255,80,120,0.1) 0%, transparent 40%), radial-gradient(ellipse at 80% 20%, rgba(80,180,255,0.1) 0%, transparent 40%), radial-gradient(ellipse at 50% 50%, rgba(150,80,255,0.08) 0%, transparent 50%), linear-gradient(180deg, #080808 0%, #0f0f0f 50%, #080808 100%)`,
  'whisper-bomb': `radial-gradient(ellipse at 50% 60%, rgba(255,240,200,0.12) 0%, rgba(255,200,100,0.05) 30%, transparent 60%), linear-gradient(180deg, #020202 0%, #050505 50%, #020202 100%)`,
  'stack-drop': `radial-gradient(ellipse at 50% 0%, rgba(255,200,120,0.15) 0%, transparent 55%), linear-gradient(180deg, #2a1a08 0%, #3a2210 30%, #4a2a14 55%, #3a2210 80%, #2a1a08 100%)`,
  'shadow-tap': `radial-gradient(ellipse at 30% 60%, rgba(80,60,40,0.2) 0%, transparent 50%), radial-gradient(ellipse at 70% 30%, rgba(60,40,20,0.15) 0%, transparent 40%), linear-gradient(180deg, #040303 0%, #080605 40%, #060404 70%, #040303 100%)`,
  'pitch-match': `radial-gradient(ellipse at 50% 30%, rgba(0,180,255,0.08) 0%, transparent 50%), radial-gradient(ellipse at 20% 70%, rgba(0,255,150,0.06) 0%, transparent 40%), linear-gradient(180deg, #060809 0%, #080c0e 40%, #060a0c 70%, #040608 100%)`,
  'balance-beam': `radial-gradient(ellipse at 50% 20%, rgba(255,200,100,0.2) 0%, rgba(255,150,50,0.08) 40%, transparent 70%), linear-gradient(180deg, #0d0608 0%, #180b0d 30%, #200d10 55%, #180b0d 80%, #0d0608 100%)`,
  'memory-grid': `radial-gradient(ellipse at 50% 0%, rgba(255,180,80,0.12) 0%, transparent 55%), linear-gradient(180deg, #120d06 0%, #1e1508 30%, #2a1c0a 55%, #1e1508 80%, #120d06 100%)`,
  'symbol-scan': `radial-gradient(ellipse at 50% 50%, rgba(200,160,60,0.1) 0%, transparent 60%), radial-gradient(ellipse at 50% 100%, rgba(160,120,40,0.12) 0%, transparent 50%), linear-gradient(180deg, #0e0c09 0%, #16130c 35%, #1a160e 60%, #16130c 85%, #0e0c09 100%)`,
  'reaction-chain': `radial-gradient(ellipse at 50% 50%, rgba(0,80,200,0.12) 0%, transparent 60%), radial-gradient(ellipse at 20% 80%, rgba(0,150,255,0.08) 0%, transparent 40%), linear-gradient(180deg, #020810 0%, #040c18 35%, #060e1e 60%, #040c18 85%, #020810 100%)`,
  'pulse-sphere': `radial-gradient(ellipse at 50% 50%, rgba(0,180,160,0.12) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(0,220,200,0.08) 0%, transparent 40%), linear-gradient(180deg, #020c0c 0%, #031212 35%, #041616 60%, #031212 85%, #020c0c 100%)`,
  'countdown-crush': `radial-gradient(ellipse at 30% 30%, rgba(100,80,200,0.08) 0%, transparent 45%), radial-gradient(ellipse at 70% 70%, rgba(80,100,200,0.06) 0%, transparent 45%), linear-gradient(180deg, #080810 0%, #0c0c18 40%, #0a0a14 70%, #080810 100%)`,
  'turkey-trot': `radial-gradient(ellipse at 50% 100%, rgba(80,160,40,0.15) 0%, transparent 40%), linear-gradient(180deg, #1a0e04 0%, #2e1a06 25%, #3e2408 45%, #4a2e0a 60%, #3e2408 78%, #2a1804 92%, #1a0e04 100%)`,
  'spiral-throw': `linear-gradient(180deg, #3a8fd4 0%, #5aaae8 20%, #8dc8f0 40%, #b8def7 58%, #6db85e 62%, #3a9430 75%, #1e7018 90%, #0f5010 100%)`,
  'boo-blast': `radial-gradient(ellipse at 50% 80%, rgba(80,0,120,0.2) 0%, rgba(40,0,80,0.1) 40%, transparent 70%), linear-gradient(180deg, #04020a 0%, #080412 30%, #0c0618 55%, #080412 80%, #04020a 100%)`,
  'tilt-maze': `repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(255,255,255,0.025) 39px, rgba(255,255,255,0.025) 40px), repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(255,255,255,0.025) 39px, rgba(255,255,255,0.025) 40px), linear-gradient(180deg, #060809 0%, #090c10 50%, #060809 100%)`,
};

const gamesDir = path.join(__dirname, 'app', 'games');

for (const [gameId, bg] of Object.entries(environments)) {
  const filePath = path.join(gamesDir, gameId, 'page.tsx');
  if (!fs.existsSync(filePath)) {
    console.log(`SKIP (not found): ${gameId}`);
    continue;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // Match the opening <GameShell ... > tag (possibly multi-line but usually single line)
  // We need to insert background="..." before the closing >
  // The tag may end with > or have children on the same line
  
  // Find the GameShell opening tag and add background prop
  // Pattern: <GameShell ... > — we want to add background before the last >
  const gameShellRegex = /(<GameShell\b[^>]*?)(\s*>)/;
  
  if (gameShellRegex.test(content)) {
    // Check if background prop already exists
    if (content.includes('background=')) {
      console.log(`ALREADY DONE: ${gameId}`);
      continue;
    }
    
    const escapedBg = bg.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
    content = content.replace(gameShellRegex, `$1\n      background="${bg}"$2`);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`UPDATED: ${gameId}`);
  } else {
    console.log(`NO MATCH: ${gameId}`);
  }
}

console.log('Done!');
