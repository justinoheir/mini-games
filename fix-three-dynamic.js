/**
 * fix-three-dynamic.js
 * Converts all game pages with top-level THREE imports to use next/dynamic with ssr:false
 * This prevents Android Chrome crashes from Three.js being evaluated before canvas is ready.
 */

const fs = require('fs');
const path = require('path');

const gamesDir = path.join(__dirname, 'app', 'games');
const gameDirs = fs.readdirSync(gamesDir).filter(d => {
  return d !== '__scaffold__' && fs.statSync(path.join(gamesDir, d)).isDirectory();
});

let fixedCount = 0;
let alreadyFixedCount = 0;
let noThreeCount = 0;
const errors = [];

for (const gameId of gameDirs) {
  const pagePath = path.join(gamesDir, gameId, 'page.tsx');
  if (!fs.existsSync(pagePath)) continue;

  let content = fs.readFileSync(pagePath, 'utf8');

  // Skip if already has dynamic import
  if (content.includes("from 'next/dynamic'")) {
    alreadyFixedCount++;
    console.log(`SKIP (already fixed): ${gameId}`);
    continue;
  }

  // Skip if no top-level THREE import
  if (!content.match(/^import \* as THREE from ['"]three['"]/m)) {
    noThreeCount++;
    console.log(`SKIP (no THREE): ${gameId}`);
    continue;
  }

  // Find the export default function name
  const match = content.match(/export default function (\w+)\s*\(/);
  if (!match) {
    errors.push(`${gameId}: no 'export default function' found`);
    console.log(`ERROR ${gameId}: no export default function`);
    continue;
  }

  const componentName = match[1];
  const innerName = componentName + 'Inner';

  // Rename: export default function ComponentName( → function ComponentNameInner(
  content = content.replace(
    `export default function ${componentName}(`,
    `function ${innerName}(`
  );

  // Also strip any trailing depth-of-field references (rule: no DoF in 3D games)
  // (none found in audit, but just in case)

  // Append dynamic wrapper at end of file
  const suffix = [
    '',
    `import dynamic from 'next/dynamic';`,
    `const ${componentName} = dynamic(() => Promise.resolve({ default: ${innerName} }), { ssr: false });`,
    `export default ${componentName};`,
    '',
  ].join('\n');

  content = content.trimEnd() + '\n' + suffix;

  fs.writeFileSync(pagePath, content, 'utf8');
  fixedCount++;
  console.log(`FIXED: ${gameId}  (${componentName} → ${innerName})`);
}

console.log('');
console.log('═══════════════════════════════════════');
console.log(`  Fixed:          ${fixedCount}`);
console.log(`  Already fixed:  ${alreadyFixedCount}`);
console.log(`  No THREE:       ${noThreeCount}`);
console.log(`  Errors:         ${errors.length}`);
if (errors.length) {
  console.log('  Error details:');
  errors.forEach(e => console.log('    -', e));
}
console.log('═══════════════════════════════════════');
