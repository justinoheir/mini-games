import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const GAMES = {
  'whisper-bomb': [
    { icon: '🎤', title: 'Blow softly', body: 'Use your mic to breathe into the bomb fuse.' },
    { icon: '💣', title: 'Control the fuse', body: 'Too loud = fuse burns fast. Too quiet = nothing happens.' },
    { icon: '🏆', title: 'Last longest', body: 'Survive longer than your personal best.' },
  ],
  'breath-rider': [
    { icon: '🌬️', title: 'Breathe in', body: 'Inhale slowly to rise. Exhale to descend.' },
    { icon: '🚀', title: 'Navigate', body: 'Guide your rider through the gaps.' },
    { icon: '💨', title: 'Stay smooth', body: 'Calm, steady breaths = better control.' },
  ],
  'steady-hand': [
    { icon: '✋', title: 'Hold still', body: 'Keep your device as still as possible.' },
    { icon: '⏱️', title: 'Steady wins', body: 'The less you move, the higher you score.' },
    { icon: '🏆', title: 'Beat your best', body: 'Try to beat your personal steadiness record.' },
  ],
  'tunnel': [
    { icon: '👆', title: 'Tap to steer', body: 'Tap left or right to move through the tunnel.' },
    { icon: '⚡', title: "Don't touch walls", body: 'Hitting the walls ends your run.' },
    { icon: '🔥', title: 'Go further', body: 'The tunnel speeds up — how far can you go?' },
  ],
  'pulse-sphere': [
    { icon: '👆', title: 'Tap the sphere', body: 'Tap in rhythm with the pulse to score.' },
    { icon: '🎵', title: 'Feel the beat', body: 'The sphere glows on every beat.' },
    { icon: '🔥', title: 'Build combos', body: 'Perfect timing builds your streak multiplier.' },
  ],
  'dodge-blitz': [
    { icon: '👆', title: 'Tap to dodge', body: 'Tap anywhere to jump or dodge incoming obstacles.' },
    { icon: '⚡', title: 'React fast', body: 'Obstacles speed up as your score grows.' },
    { icon: '🔥', title: 'Survive', body: 'How long can you last?' },
  ],
  'balance-beam': [
    { icon: '📱', title: 'Tilt to balance', body: 'Tilt your device left and right to stay on the beam.' },
    { icon: '⚖️', title: 'Stay centered', body: 'Too far either way and you fall off.' },
    { icon: '🏆', title: 'Beat your time', body: 'Balance as long as possible to set a new best.' },
  ],
  'pitch-match': [
    { icon: '🎤', title: 'Sing or hum', body: 'Match the target pitch shown on screen.' },
    { icon: '🎵', title: 'Hold steady', body: 'Stay on pitch as long as you can.' },
    { icon: '🏆', title: 'Score points', body: 'The closer your pitch, the more you score.' },
  ],
  'crowd-roar': [
    { icon: '📣', title: 'Make noise', body: 'Shout, clap, or cheer into your mic.' },
    { icon: '🔊', title: 'Hit the meter', body: 'Fill the volume meter to energize the crowd.' },
    { icon: '🏟️', title: 'Keep it up', body: "Don't let the crowd go quiet — sustain the roar!" },
  ],
  'penalty-kick': [
    { icon: '👆', title: 'Swipe to kick', body: 'Swipe in the direction you want to shoot.' },
    { icon: '⚽', title: 'Aim for gaps', body: 'The goalkeeper moves — find the open corner.' },
    { icon: '🥅', title: 'Score goals', body: 'You have 5 shots. Score as many as possible.' },
  ],
  'spiral-throw': [
    { icon: '👆', title: 'Swipe to throw', body: 'Swipe up to launch the football in a spiral.' },
    { icon: '🏈', title: 'Hit the target', body: 'Aim for the moving receiver downfield.' },
    { icon: '🔥', title: 'Build combos', body: 'Consecutive completions multiply your score.' },
  ],
  'reflex-rally': [
    { icon: '👆', title: 'Tap to return', body: 'Tap when the ball reaches your side.' },
    { icon: '⚡', title: 'Time it right', body: 'Tap too early or too late and you miss.' },
    { icon: '🔥', title: 'Speed up', body: 'Each rally gets faster — how long can you keep it going?' },
  ],
  'precision-putt': [
    { icon: '👆', title: 'Swipe to putt', body: 'Swipe to aim and set the power of your putt.' },
    { icon: '⛳', title: 'Read the green', body: 'Adjust for distance and angle to the hole.' },
    { icon: '🏆', title: 'Fewer strokes', body: 'Get the ball in with as few shots as possible.' },
  ],
  'color-cascade': [
    { icon: '🎨', title: 'Match the color', body: 'Tap the falling block that matches the target color.' },
    { icon: '⚡', title: 'Move fast', body: 'Blocks speed up as your score grows.' },
    { icon: '🔥', title: 'Build combos', body: 'Consecutive correct taps multiply your score.' },
  ],
  'memory-grid': [
    { icon: '👁️', title: 'Watch the pattern', body: 'A sequence of tiles will light up.' },
    { icon: '👆', title: 'Repeat it', body: 'Tap the tiles in the same order.' },
    { icon: '🧠', title: 'Go longer', body: 'Each round adds one more tile to remember.' },
  ],
  'shadow-tap': [
    { icon: '👁️', title: 'Watch the shadow', body: 'A shape will appear briefly then vanish.' },
    { icon: '👆', title: 'Tap the match', body: 'Find and tap the matching shape from the options.' },
    { icon: '⚡', title: 'Be quick', body: 'You have limited time — trust your memory.' },
  ],
  'stack-drop': [
    { icon: '👆', title: 'Tap to drop', body: 'Tap the screen to drop the block onto the stack.' },
    { icon: '⬜', title: 'Stack perfectly', body: 'Align blocks precisely — overhanging parts fall off.' },
    { icon: '🏆', title: 'Stack higher', body: 'How tall can you build before it falls?' },
  ],
  'symbol-scan': [
    { icon: '👁️', title: 'Find the symbol', body: 'Scan the grid to find the target symbol.' },
    { icon: '👆', title: 'Tap it fast', body: 'Tap the correct symbol before time runs out.' },
    { icon: '🔥', title: 'Chain correct taps', body: 'Fast correct answers build your streak.' },
  ],
  'gift-rush': [
    { icon: '🎁', title: 'Catch the gifts', body: 'Tap falling gifts before they hit the ground.' },
    { icon: '⭐', title: 'Gold gifts = bonus', body: 'Golden gifts are worth extra points — prioritize them.' },
    { icon: '💨', title: 'Speed increases', body: 'Gifts fall faster as time goes on. Keep up!' },
  ],
  'snow-catch': [
    { icon: '❄️', title: 'Catch the snowflakes', body: 'Tilt your device to move the catcher left and right.' },
    { icon: '⭐', title: 'Big flakes = more', body: 'Larger snowflakes score more points.' },
    { icon: '🔥', title: 'Build a streak', body: 'Catch consecutive flakes without missing for a bonus.' },
  ],
  'boo-blast': [
    { icon: '👆', title: 'Tap to blast', body: 'Tap the ghosts before they reach you.' },
    { icon: '👻', title: "Don't miss", body: 'Letting 3 ghosts through ends the game.' },
    { icon: '💥', title: 'Bigger ghosts = more', body: 'Larger ghosts are worth more points but move slower.' },
  ],
  'firework-launch': [
    { icon: '👆', title: 'Tap to launch', body: 'Tap and hold to aim, release to fire.' },
    { icon: '🎆', title: 'Hit the targets', body: 'Launch fireworks to hit the glowing targets.' },
    { icon: '🔥', title: 'Chain explosions', body: 'Hitting multiple targets with one burst multiplies your score.' },
  ],
  'countdown-crush': [
    { icon: '🔢', title: 'Find the number', body: 'Tap numbers in order from lowest to highest.' },
    { icon: '⏱️', title: 'Race the clock', body: 'You have limited time — move fast.' },
    { icon: '🔥', title: 'Clear the board', body: 'Clear all numbers before time runs out to win.' },
  ],
  'cupid-shot': [
    { icon: '💘', title: 'Aim with Cupid', body: "Tilt or swipe to aim Cupid's arrow." },
    { icon: '❤️', title: 'Hit the hearts', body: 'Shoot your arrow to hit floating hearts.' },
    { icon: '🔥', title: 'Chain shots', body: 'Hit multiple hearts in a row for a combo bonus.' },
  ],
  'love-note': [
    { icon: '🎵', title: 'Tap in rhythm', body: 'Tap along with the falling music notes.' },
    { icon: '❤️', title: 'Hit on the beat', body: 'Perfect timing scores the most points.' },
    { icon: '🔥', title: 'Build combos', body: 'Consecutive perfect taps multiply your score.' },
  ],
  'turkey-trot': [
    { icon: '🦃', title: 'Help the turkey run', body: 'Tap left or right to dodge obstacles.' },
    { icon: '🌽', title: 'Collect corn', body: 'Grab corn for bonus points as you run.' },
    { icon: '🏃', title: "Don't get caught", body: "Avoid the farmer — how far can you run?" },
  ],
  'harvest-catch': [
    { icon: '🍎', title: 'Catch the harvest', body: 'Tilt your device to move the basket.' },
    { icon: '⭐', title: 'Rare items = more', body: "Golden items are worth extra — don't miss them." },
    { icon: '🚫', title: 'Avoid rocks', body: 'Catching rocks costs you a life.' },
  ],
};

const BASE = 'C:\\Users\\justi\\.openclaw\\workspace\\mini-games';

function stepsToCode(steps) {
  return '[' + steps.map(s => 
    `{ icon: ${JSON.stringify(s.icon)}, title: ${JSON.stringify(s.title)}, body: ${JSON.stringify(s.body)} }`
  ).join(', ') + ']';
}

function processGame(gameId, steps) {
  const filePath = join(BASE, 'app', 'games', gameId, 'page.tsx');
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error(`  ✗ Cannot read ${filePath}: ${e.message}`);
    return false;
  }

  // Already patched?
  if (content.includes('SwipeInstructions')) {
    console.log(`  ⏭  ${gameId} — already has SwipeInstructions, skipping`);
    return false;
  }

  // 1. Add import after the last import line
  const importRegex = /^import .+$/mg;
  let lastImportIndex = -1;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    lastImportIndex = match.index + match[0].length;
  }
  if (lastImportIndex === -1) {
    console.error(`  ✗ ${gameId} — could not find import statements`);
    return false;
  }
  const importLine = `\nimport SwipeInstructions from '@/components/SwipeInstructions';`;
  content = content.slice(0, lastImportIndex) + importLine + content.slice(lastImportIndex);

  // 2. Add showInstructions state after first useState( in function body
  // Find the export default function first
  const funcMatch = /export default function \w+/.exec(content);
  if (!funcMatch) {
    console.error(`  ✗ ${gameId} — could not find export default function`);
    return false;
  }
  const funcStart = funcMatch.index;
  // Find first useState( after function declaration
  const afterFunc = content.indexOf('useState(', funcStart);
  if (afterFunc === -1) {
    console.error(`  ✗ ${gameId} — could not find useState in function body`);
    return false;
  }
  // Find the start of that line
  const lineStart = content.lastIndexOf('\n', afterFunc) + 1;
  const indent = content.slice(lineStart, afterFunc).match(/^\s*/)[0];
  const stateLine = `${indent}const [showInstructions, setShowInstructions] = useState(true);\n`;
  content = content.slice(0, lineStart) + stateLine + content.slice(lineStart);

  // 3. Add SwipeInstructions JSX - inject as first child of GameShell (or first child in return)
  // Strategy: find <GameShell ...> opening and inject right after its closing >
  // GameShell tag ends with >\n
  const gameShellMatch = /<GameShell[^>]*>/.exec(content);
  if (gameShellMatch) {
    const insertPos = gameShellMatch.index + gameShellMatch[0].length;
    const stepsCode = stepsToCode(steps);
    const jsxSnippet = `\n      {showInstructions && (\n        <SwipeInstructions\n          gameId="${gameId}"\n          steps={${stepsCode}}\n          onDone={() => setShowInstructions(false)}\n        />\n      )}`;
    content = content.slice(0, insertPos) + jsxSnippet + content.slice(insertPos);
  } else {
    // Fallback: inject right after return (
    const returnMatch = /return \(\n/.exec(content);
    if (!returnMatch) {
      console.error(`  ✗ ${gameId} — could not find return ( or <GameShell>`);
      return false;
    }
    const insertPos = returnMatch.index + returnMatch[0].length;
    const stepsCode = stepsToCode(steps);
    const jsxSnippet = `      {showInstructions && (\n        <SwipeInstructions\n          gameId="${gameId}"\n          steps={${stepsCode}}\n          onDone={() => setShowInstructions(false)}\n        />\n      )}\n`;
    content = content.slice(0, insertPos) + jsxSnippet + content.slice(insertPos);
  }

  writeFileSync(filePath, content, 'utf8');
  console.log(`  ✓ ${gameId}`);
  return true;
}

let modified = 0;
for (const [gameId, steps] of Object.entries(GAMES)) {
  if (processGame(gameId, steps)) modified++;
}
console.log(`\nDone. Modified ${modified}/${Object.keys(GAMES).length} games.`);
