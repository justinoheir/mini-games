const fs = require('fs');
const path = require('path');

const TESTS_DIR = path.join(__dirname, '..', 'tests');

let fixed = 0;

function fixFile(filePath) {
  let src = fs.readFileSync(filePath, 'utf8');
  const orig = src;

  // Fix unescaped apostrophes in single-quoted test/describe strings
  // Replace test('...don't...') with test(`...don't...`)
  // Strategy: find all test( or describe( calls with single-quoted first arg containing apostrophe
  src = src.replace(/\b(test|describe)\('((?:[^'\\]|\\.)*)'/g, (match, fn, content) => {
    if (content.includes("'")) {
      // Has unescaped apostrophe - switch to backtick
      return fn + '(`' + content + '`';
    }
    return match;
  });

  if (src !== orig) {
    fs.writeFileSync(filePath, src, 'utf8');
    console.log('Fixed: ' + path.basename(filePath));
    fixed++;
  }
}

// Root tests dir
for (const f of fs.readdirSync(TESTS_DIR)) {
  if (f.endsWith('.spec.ts')) {
    fixFile(path.join(TESTS_DIR, f));
  }
}

// Subdirs
for (const sub of ['smoke', 'gameplay']) {
  const subDir = path.join(TESTS_DIR, sub);
  if (fs.existsSync(subDir)) {
    for (const f of fs.readdirSync(subDir)) {
      if (f.endsWith('.spec.ts')) fixFile(path.join(subDir, f));
    }
  }
}

console.log('Done. Fixed ' + fixed + ' files.');
