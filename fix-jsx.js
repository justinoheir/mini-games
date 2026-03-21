#!/usr/bin/env node
// Fix JSX insertion issue: banner was placed inside a conditional expression
// Pattern: {phase === 'done' && sig && (\n{/* New best banner */}...
// Should be: {/* New best banner */}\n{isNewBest && ...}\n{phase === 'done' && sig && (

const fs = require('fs');
const games = process.argv.slice(2);

for (const gameName of games) {
  const filePath = `app/games/${gameName}/page.tsx`;
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Fix: banner was inserted INSIDE conditional parenthesis
  // Pattern: {(phase|gameState) === 'done' && (sig|finalSig|behavior) && (\n      {/* New best banner */}
  const badPattern = /(\{(?:phase|gameState) === 'done' && (?:sig|finalSig|behavior) && \()\n(\s*\{\/\* New best banner \*\/\})/g;
  
  if (badPattern.test(content)) {
    // Extract and move the banner BEFORE the conditional
    const bannerBlock = `
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
      </AnimatePresence>`;
    
    // Remove the misplaced banner (everything from {/* New best banner */} to </AnimatePresence>)
    // and remove the conditional that wraps the EndScreen incorrectly
    content = content.replace(
      /(\{(?:phase|gameState) === 'done' && (?:sig|finalSig|behavior) && \()\n(\s*\{\/\* New best banner \*\/\}[\s\S]*?<\/AnimatePresence>\s*\n)/,
      (match, conditional, bannerAndRest) => {
        // bannerAndRest has the misplaced banner; we want just the conditional
        return `${bannerBlock}\n      ${conditional}\n`;
      }
    );
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Fixed ${gameName}`);
  } else {
    console.log(`⚠️ Pattern not found in ${gameName}, checking manually...`);
    // Just check where the issue might be
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (line.includes('New best banner') || line.includes('isNewBest')) {
        console.log(`  Line ${i+1}: ${line.trim()}`);
      }
    });
  }
}
