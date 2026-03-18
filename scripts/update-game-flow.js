/**
 * Batch update all game files:
 * 1. Remove `import PlayerNameInput from '@/components/PlayerNameInput'`
 * 2. Change handleStart signature to accept (name, avatar) args
 * 3. Add setPlayerName/setPlayerAvatar calls inside handleStart
 * 4. Update savePlayerSession to use arg vars instead of state vars
 * 5. Update useCallback deps: [playerName, playerAvatar] → []
 * 6. Remove <PlayerNameInput .../> JSX from inside GameStartScreen
 * 7. Convert <GameStartScreen ...> </GameStartScreen> to self-closing or remove children
 */

const fs   = require('fs');
const path = require('path');

const GAMES_DIR = path.join(__dirname, '..', 'app', 'games');

let updated = 0;
let skipped = 0;

for (const name of fs.readdirSync(GAMES_DIR)) {
  const filePath = path.join(GAMES_DIR, name, 'page.tsx');
  if (!fs.existsSync(filePath)) continue;

  let src = fs.readFileSync(filePath, 'utf8');
  const orig = src;

  // ── 1. Remove PlayerNameInput import ──────────────────────────────────
  src = src.replace(/^import PlayerNameInput from '@\/components\/PlayerNameInput';\n/m, '');

  // ── 2. Change handleStart signature ───────────────────────────────────
  src = src.replace(
    /const handleStart = useCallback\(async \(\) => \{/g,
    'const handleStart = useCallback(async (name: string, avatar: string) => {'
  );

  // ── 3. Update savePlayerSession calls (playerName, playerAvatar) → (name, avatar) ──
  src = src.replace(
    /savePlayerSession\(GAME_ID,\s*playerName,\s*playerAvatar\)/g,
    'savePlayerSession(GAME_ID, name, avatar)'
  );

  // ── 4. After "playerSessionRef.current = savePlayerSession(" injection ──
  // Inject setPlayerName/setPlayerAvatar before the savePlayerSession line
  // but only if those setters exist in the file
  if (src.includes('setPlayerName') && src.includes('setPlayerAvatar')) {
    src = src.replace(
      /(const handleStart = useCallback\(async \(name: string, avatar: string\) => \{\s*\n)/,
      '$1    setPlayerName(name);\n    setPlayerAvatar(avatar);\n'
    );
  }

  // ── 5. Update useCallback deps: [playerName, playerAvatar] → [] ───────
  // Matches the closing of handleStart's useCallback
  src = src.replace(/\}, \[playerName, playerAvatar\]\)/g, '}, [])');

  // ── 6. Remove <PlayerNameInput ... /> block from inside GameStartScreen ──
  // Pattern: optional whitespace + <PlayerNameInput\n...accentColor=...\n...onReady=...\n.../>
  src = src.replace(
    /\s*<PlayerNameInput[\s\S]*?\/>/gm,
    (match) => {
      // Only remove if it's the PlayerNameInput usage (not an import)
      if (match.includes('accentColor') || match.includes('onReady')) return '';
      return match;
    }
  );

  // ── 7. Convert <GameStartScreen ...>\n  </GameStartScreen> pattern ──────
  // After removing children, convert to self-closing if leftover empty children
  // Find pattern: onStart={handleStart}\n        >\n        </GameStartScreen>
  src = src.replace(
    /(onStart=\{handleStart\})\s*\n\s*>\s*\n\s*<\/GameStartScreen>/g,
    '$1\n        />'
  );
  // Also handle: onStart={handleStart}\n      >\n    </GameStartScreen>
  src = src.replace(
    /(onStart=\{handleStart\})\s*>\s*<\/GameStartScreen>/g,
    '$1\n        />'
  );

  if (src !== orig) {
    fs.writeFileSync(filePath, src, 'utf8');
    console.log(`✅ Updated: ${name}`);
    updated++;
  } else {
    console.log(`⏭  Skipped (no changes): ${name}`);
    skipped++;
  }
}

console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
