/**
 * Fixes Object.assign(new THREE.X, { position: ... }) bugs in all broken games.
 * The fix: replace the one-liner with explicit property setters.
 */
const fs = require('fs');
const path = require('path');

const GAMES_DIR = path.join(__dirname, 'app', 'games');

// Manual fixes for each broken game
// Pattern: [gameId, lineNumber (1-indexed), find, replace]
const FIXES = [
  // paint-splash:138
  ['paint-splash', `    scene.add(Object.assign(new THREE.PointLight(0x3b82f6, 40, 15), { position: new THREE.Vector3(-3, -2, 5) }));`,
   `    { const _pl2 = new THREE.PointLight(0x3b82f6, 40, 15); _pl2.position.set(-3, -2, 5); scene.add(_pl2); }`],

  // pixel-paint:165
  ['pixel-paint', `    scene.add(Object.assign(new THREE.PointLight(0x818cf8, 40, 20), { position: new THREE.Vector3(-5, 4, 5) }));`,
   `    { const _pl2 = new THREE.PointLight(0x818cf8, 40, 20); _pl2.position.set(-5, 4, 5); scene.add(_pl2); }`],

  // pattern-predict:159,160
  ['pattern-predict', `    scene.add(Object.assign(new THREE.PointLight(0x14b8a6, 60, 20), { position: new THREE.Vector3(2, 4, 7) }));`,
   `    { const _pl1 = new THREE.PointLight(0x14b8a6, 60, 20); _pl1.position.set(2, 4, 7); scene.add(_pl1); }`],
  ['pattern-predict', `    scene.add(Object.assign(new THREE.PointLight(0xa855f7, 40, 15), { position: new THREE.Vector3(-3, -3, 5) }));`,
   `    { const _pl2 = new THREE.PointLight(0xa855f7, 40, 15); _pl2.position.set(-3, -3, 5); scene.add(_pl2); }`],

  // path-trace:161,162
  ['path-trace', `    scene.add(Object.assign(new THREE.PointLight(0x059669, 50, 20), { position: new THREE.Vector3(0, 3, 7) }));`,
   `    { const _pl1 = new THREE.PointLight(0x059669, 50, 20); _pl1.position.set(0, 3, 7); scene.add(_pl1); }`],
  ['path-trace', `    scene.add(Object.assign(new THREE.PointLight(0x22d3ee, 30, 15), { position: new THREE.Vector3(-3, -2, 5) }));`,
   `    { const _pl2 = new THREE.PointLight(0x22d3ee, 30, 15); _pl2.position.set(-3, -2, 5); scene.add(_pl2); }`],

  // neon-archer:322 — uses plain object {x,y,z}
  ['neon-archer', `    scene.add(Object.assign(new THREE.PointLight(0x0066ff, 2, 30), { position: { x: 0, y: -2, z: 0 } }));`,
   `    { const _pl2 = new THREE.PointLight(0x0066ff, 2, 30); _pl2.position.set(0, -2, 0); scene.add(_pl2); }`],

  // reflex-rally:125
  ['reflex-rally', `    scene.add(Object.assign(new THREE.PointLight(0xfde047, 40, 15), { position: new THREE.Vector3(2, 2, 5) }));`,
   `    { const _pl2 = new THREE.PointLight(0xfde047, 40, 15); _pl2.position.set(2, 2, 5); scene.add(_pl2); }`],

  // pencil-pack:148,149
  ['pencil-pack', `    scene.add(Object.assign(new THREE.PointLight(0xf59e0b, 60, 20), { position: new THREE.Vector3(2, 4, 8) }));`,
   `    { const _pl1 = new THREE.PointLight(0xf59e0b, 60, 20); _pl1.position.set(2, 4, 8); scene.add(_pl1); }`],
  ['pencil-pack', `    scene.add(Object.assign(new THREE.PointLight(0x6366f1, 40, 15), { position: new THREE.Vector3(-3, -2, 6) }));`,
   `    { const _pl2 = new THREE.PointLight(0x6366f1, 40, 15); _pl2.position.set(-3, -2, 6); scene.add(_pl2); }`],

  // pulse-jump:144
  ['pulse-jump', `    scene.add(Object.assign(new THREE.PointLight(0x6366f1, 40, 15), { position: new THREE.Vector3(3, 1, 5) }));`,
   `    { const _pl2 = new THREE.PointLight(0x6366f1, 40, 15); _pl2.position.set(3, 1, 5); scene.add(_pl2); }`],

  // number-path:135,136
  ['number-path', `    scene.add(Object.assign(new THREE.PointLight(0x22c55e, 60, 20), { position: new THREE.Vector3(2, 3, 8) }));`,
   `    { const _pl1 = new THREE.PointLight(0x22c55e, 60, 20); _pl1.position.set(2, 3, 8); scene.add(_pl1); }`],
  ['number-path', `    scene.add(Object.assign(new THREE.PointLight(0x14b8a6, 40, 15), { position: new THREE.Vector3(-3, -2, 6) }));`,
   `    { const _pl2 = new THREE.PointLight(0x14b8a6, 40, 15); _pl2.position.set(-3, -2, 6); scene.add(_pl2); }`],

  // pixel-skate:152,153
  ['pixel-skate', `    scene.add(Object.assign(new THREE.PointLight(0x10b981, 60, 20), { position: new THREE.Vector3(-2, 4, 6) }));`,
   `    { const _pl1 = new THREE.PointLight(0x10b981, 60, 20); _pl1.position.set(-2, 4, 6); scene.add(_pl1); }`],
  ['pixel-skate', `    scene.add(Object.assign(new THREE.PointLight(0x6366f1, 40, 15), { position: new THREE.Vector3(3, 2, 5) }));`,
   `    { const _pl2 = new THREE.PointLight(0x6366f1, 40, 15); _pl2.position.set(3, 2, 5); scene.add(_pl2); }`],
];

// More complex fixes that need manual handling
const COMPLEX_FIXES = {
  // marathon-pace: uses group.add + position as plain object + as any
  'marathon-pace': [
    [`    group.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 10), mat), { position: { x: 0, y: 1.2, z: 0 } } as any));`,
     `    { const _head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 10), mat); _head.position.set(0, 1.2, 0); group.add(_head); }`],
    [`    group.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8), mat), { position: { x: 0, y: 0.75, z: 0 } } as any));`,
     `    { const _body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8), mat); _body.position.set(0, 0.75, 0); group.add(_body); }`],
  ],

  // dart-board: hacked position object
  'dart-board': [
    [`    playerGroup.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.3,1.4,8),bodyMat2),{position:{set:()=>{}}}) );`,
     `    { const _body2 = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.4, 8), bodyMat2); playerGroup.add(_body2); }`],
  ],

  // penalty-kick: DirectionalLight with castShadow
  'penalty-kick': [
    [`    scene.add(Object.assign(new THREE.DirectionalLight(0xffffff, 0.8), { position: new THREE.Vector3(5, 10, 5), castShadow: true }));`,
     `    { const _dl = new THREE.DirectionalLight(0xffffff, 0.8); _dl.position.set(5, 10, 5); _dl.castShadow = true; scene.add(_dl); }`],
  ],

  // spiral-throw: Mesh with position AND rotation
  'spiral-throw': [
    [`    postGroup.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 6), postMat), { position: new THREE.Vector3(0, 3, -35) }));`,
     `    { const _post1 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 6), postMat); _post1.position.set(0, 3, -35); postGroup.add(_post1); }`],
    [`    postGroup.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 6), postMat), { position: new THREE.Vector3(-1.25, 6, -35), rotation: new THREE.Euler(0, 0, Math.PI/2) }));`,
     `    { const _bar1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 6), postMat); _bar1.position.set(-1.25, 6, -35); _bar1.rotation.set(0, 0, Math.PI/2); postGroup.add(_bar1); }`],
    [`    postGroup.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 6), postMat), { position: new THREE.Vector3(1.25, 6, -35), rotation: new THREE.Euler(0, 0, Math.PI/2) }));`,
     `    { const _bar2 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 6), postMat); _bar2.position.set(1.25, 6, -35); _bar2.rotation.set(0, 0, Math.PI/2); postGroup.add(_bar2); }`],
  ],

  // domino-chain: hacked position object 
  'domino-chain': [
    [`    scene.add(Object.assign(new THREE.Mesh(tableGeo,tableMat),{position:{x:0,y:-0.8,z:0,set:()=>{}}}));`,
     `    { const _table = new THREE.Mesh(tableGeo, tableMat); _table.position.set(0, -0.8, 0); scene.add(_table); }`],
  ],

  // table-tennis: Mesh with position
  'table-tennis': [
    [`    scene.add(Object.assign(new THREE.Mesh(lineGeo, lineMat), { position: new THREE.Vector3(0, -0.42, 0) }));`,
     `    { const _line = new THREE.Mesh(lineGeo, lineMat); _line.position.set(0, -0.42, 0); scene.add(_line); }`],
    [`    scene.add(Object.assign(new THREE.Mesh(centerLineGeo, lineMat), { position: new THREE.Vector3(0, -0.42, 0) }));`,
     `    { const _cline = new THREE.Mesh(centerLineGeo, lineMat); _cline.position.set(0, -0.42, 0); scene.add(_cline); }`],
  ],
};

let fixedCount = 0;
let errorCount = 0;

function fixGame(gameId, pairs) {
  const filePath = path.join(GAMES_DIR, gameId, 'page.tsx');
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  for (const [find, replace] of pairs) {
    if (content.includes(find)) {
      content = content.replace(find, replace);
      console.log(`  ✅ Fixed: ${gameId} — "${find.trim().substring(0, 60)}..."`);
      changed = true;
    } else {
      console.log(`  ⚠️  NOT FOUND in ${gameId}: "${find.trim().substring(0, 60)}"`);
      errorCount++;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    fixedCount++;
  }
}

console.log('\n🔧 Fixing THREE.js Object.assign bugs...\n');

// Simple fixes
const grouped = {};
for (const [gameId, find, replace] of FIXES) {
  if (!grouped[gameId]) grouped[gameId] = [];
  grouped[gameId].push([find, replace]);
}
for (const [gameId, pairs] of Object.entries(grouped)) {
  fixGame(gameId, pairs);
}

// Complex fixes
for (const [gameId, pairs] of Object.entries(COMPLEX_FIXES)) {
  fixGame(gameId, pairs);
}

console.log(`\n✅ Fixed ${fixedCount} game files`);
if (errorCount) console.log(`⚠️  ${errorCount} patterns not found (may already be fixed)`);
