/**
 * QA Runner v3 — full exception logging
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { GAME_IDS } = require('./qa-games.js');

// GLOBAL exception handlers — critical for diagnosis
process.on('uncaughtException', e => {
  console.error('[UNCAUGHT EXCEPTION]', e.message, e.stack?.substring(0, 300));
  save();
  process.exit(0); // exit 0 so outer poller sees it completed
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', String(reason).substring(0, 200));
  // Don't exit — just log
});

const RESULTS_FILE = path.join(__dirname, 'qa-results.json');
const TIMEOUT_PER_GAME = 25000;

let results = [];
if (fs.existsSync(RESULTS_FILE)) {
  try { results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')); } catch { results = []; }
  if (results.length) console.log(`Resuming: ${results.length} already tested`);
}
const tested = new Set(results.map(r => r.game_id));

function save() {
  try { fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2)); } catch(e) {
    console.error('Save error:', e.message);
  }
}

function killZombieChrome() {
  try { execSync('taskkill /F /IM chrome.exe', { stdio: 'ignore', timeout: 3000 }); } catch {}
}

function runGame(gameId) {
  return new Promise((resolve) => {
    let resolved = false;
    let stdout = '';

    console.log(`  [spawn] starting ${gameId}`);
    
    const child = spawn('node', ['qa-single.js', gameId], {
      cwd: __dirname,
      windowsHide: true,
    });
    
    console.log(`  [spawn] pid=${child.pid}`);

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.log(`  [spawn] TIMEOUT for ${gameId}`);
        try { child.kill('SIGKILL'); } catch {}
        resolve({ game_id: gameId, verdict: 'BROKEN', errors: ['Timeout'], notes: 'Timeout 25s', canvas_visible: false });
      }
    }, TIMEOUT_PER_GAME);

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { /* ignore */ });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      console.log(`  [spawn] closed code=${code} signal=${signal}`);
      if (!resolved) {
        resolved = true;
        const lines = stdout.trim().split('\n').filter(l => l.trim().startsWith('{'));
        if (lines.length > 0) {
          try { resolve(JSON.parse(lines[lines.length - 1])); return; } catch(e) {
            console.log(`  [spawn] JSON parse error: ${e.message}`);
          }
        }
        resolve({ game_id: gameId, verdict: 'POOR', errors: ['No JSON'], notes: `exit ${code}`, canvas_visible: false });
      }
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      console.error(`  [spawn] error: ${e.message}`);
      if (!resolved) {
        resolved = true;
        resolve({ game_id: gameId, verdict: 'BROKEN', errors: [e.message], notes: e.message, canvas_visible: false });
      }
    });

    child.on('disconnect', () => console.log(`  [spawn] disconnected`));
    child.on('exit', (code, signal) => console.log(`  [spawn] exit code=${code} signal=${signal}`));
  });
}

async function main() {
  const remaining = GAME_IDS.filter(id => !tested.has(id));
  console.log(`\n🎮 QA Runner v3 — ${remaining.length} remaining\n`);

  // Kill zombies first
  killZombieChrome();
  await new Promise(r => setTimeout(r, 1000));

  for (let i = 0; i < remaining.length; i++) {
    const gameId = remaining[i];
    process.stdout.write(`[${i+1}/${remaining.length}] ${gameId} ... `);

    const result = await runGame(gameId);
    results.push(result);
    tested.add(gameId);
    save();

    const icon = result.verdict === 'OK' ? '✅' : result.verdict === 'POOR' ? '⚠️' : '❌';
    console.log(`${icon}${result.notes ? ' — ' + result.notes.substring(0, 60) : ''}`);

    // Cleanup zombie chrome every 5 games
    if ((i + 1) % 5 === 0) {
      killZombieChrome();
      await new Promise(r => setTimeout(r, 1000));
    }

    await new Promise(r => setTimeout(r, 300));
  }

  killZombieChrome();

  const broken = results.filter(r => r.verdict === 'BROKEN');
  const poor = results.filter(r => r.verdict === 'POOR');
  const ok = results.filter(r => r.verdict === 'OK');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ OK: ${ok.length}  ⚠️ POOR: ${poor.length}  ❌ BROKEN: ${broken.length}`);

  if (broken.length) {
    console.log(`\nBROKEN:`);
    broken.forEach(r => console.log(`  ❌ ${r.game_id}: ${(r.notes||r.errors[0]||'').substring(0,90)}`));
  }
  if (poor.length) {
    console.log(`\nPOOR:`);
    poor.forEach(r => console.log(`  ⚠️  ${r.game_id}: ${r.notes||''}`));
  }
  save();
}

main().catch(e => { console.error('main.catch:', e.message, e.stack); save(); });
