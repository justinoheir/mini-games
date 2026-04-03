'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'reflex-grid';
const ACCENT = '#ef4444';
const DURATION = 30;
const GAME_EMOJI = '⚡';
const GAME_TITLE = 'Reflex Grid';
const GAME_TAGLINE = 'Tap the flash. Never miss twice.';
const PB_KEY = 'mg_pb_reflex-grid';
const COLS = 4;
const ROWS = 4;

interface ActiveCell { id: number; col: number; row: number; spawnTime: number; windowMs: number; mesh: THREE.Mesh; }
interface Signals { score: number; hits: number; misses: number; maxStreak: number; streakCurrent: number; avgReaction: number; reactionTimes: number[]; }
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const avg = sig.avgReaction;
  const acc = sig.hits + sig.misses > 0 ? sig.hits / (sig.hits + sig.misses) : 0;
  if (avg < 280 && acc >= 0.85) return 'Lightning ⚡';
  if (avg < 400 && acc >= 0.75) return 'Quick Draw 🔫';
  if (acc >= 0.7) return 'Steady Reflex 🎯';
  if (sig.hits >= 10) return 'Persistent Tapper 👆';
  return 'Warming Up 🌡️';
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function ReflexGridGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const spawnTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const cellMeshesRef = useRef<THREE.Mesh[][]>([]);
  const activeCellsRef = useRef<ActiveCell[]>([]);
  const nextIdRef = useRef(0);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  const accentLightRef = useRef<THREE.PointLight | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { score: 0, hits: 0, misses: 0, maxStreak: 0, streakCurrent: 0, avgReaction: 0, reactionTimes: [] as number[] } as Signals,
    speedLevel: 1, cellWindow: 1800, maxActive: 2,
    accentColor: ACCENT, nextId: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streakDisplay, setStreakDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (spawnTimerRef.current) { clearInterval(spawnTimerRef.current); spawnTimerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.gameOver(); haptic([100]);
    s.sig.avgReaction = s.sig.reactionTimes.length > 0 ? Math.round(s.sig.reactionTimes.reduce((a,b)=>a+b,0)/s.sig.reactionTimes.length) : 0;
    try { const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0'); if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score)); } catch { /**/ }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const spawnCell = useCallback(() => {
    const s = stateRef.current;
    if (!s.running || activeCellsRef.current.length >= s.maxActive) return;
    const occupied = new Set(activeCellsRef.current.map(c => `${c.col},${c.row}`));
    const available: [number, number][] = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (!occupied.has(`${c},${r}`)) available.push([c, r]);
    if (!available.length) return;
    const [col, row] = available[Math.floor(Math.random() * available.length)];
    const mesh = cellMeshesRef.current[row]?.[col];
    if (!mesh) return;
    const id = nextIdRef.current++;
    activeCellsRef.current.push({ id, col, row, spawnTime: Date.now(), windowMs: s.cellWindow, mesh });
    (mesh.material as THREE.MeshStandardMaterial).color.set(0xef4444);
    (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 2;
    mesh.userData.active = true;
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, hits: 0, misses: 0, maxStreak: 0, streakCurrent: 0, avgReaction: 0, reactionTimes: [] };
    s.speedLevel = 1; s.cellWindow = 1800; s.maxActive = 2;
    activeCellsRef.current = []; nextIdRef.current = 0;
    setScoreDisplay(0); setStreakDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x140000);
    scene.fog = new THREE.Fog(0x140000, 15, 30);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 60);
    camera.position.set(0, 0, 10);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x200000, 3));
    const pLight = new THREE.PointLight(0xef4444, 60, 20);
    pLight.position.set(0, 0, 8);
    scene.add(pLight);
    accentLightRef.current = pLight;

    // Subtle particle bg
    const sg = new THREE.BufferGeometry();
    const sp = new Float32Array(300);
    for (let i = 0; i < 300; i += 3) { sp[i] = (Math.random()-0.5)*30; sp[i+1] = (Math.random()-0.5)*30; sp[i+2] = -8 - Math.random()*5; }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xef4444, size: 0.05 })));

    // 4x4 Grid of tiles
    const SPACING = 2.0, TILE_SIZE = 1.7;
    const offset = ((Math.max(COLS, ROWS) - 1) * SPACING) / 2;
    cellMeshesRef.current = [];
    for (let r = 0; r < ROWS; r++) {
      cellMeshesRef.current[r] = [];
      for (let c = 0; c < COLS; c++) {
        const tileGeo = new THREE.BoxGeometry(TILE_SIZE, TILE_SIZE, 0.2);
        const tileMat = new THREE.MeshStandardMaterial({ color: 0x1a0000, emissive: 0xef4444, emissiveIntensity: 0, roughness: 0.4, metalness: 0.5 });
        const tile = new THREE.Mesh(tileGeo, tileMat);
        tile.position.set(c * SPACING - offset, -(r * SPACING - offset), 0);
        tile.userData = { col, row: r, active: false };
        scene.add(tile);
        cellMeshesRef.current[r][c] = tile;
      }
    }

    const raycaster = new THREE.Raycaster();
    const onTap = (e: PointerEvent) => {
      if (!s.running) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(((e.clientX - rect.left)/rect.width)*2-1, -((e.clientY - rect.top)/rect.height)*2+1);
      raycaster.setFromCamera(mouse, camera);
      const allTiles = cellMeshesRef.current.flat();
      const hits = raycaster.intersectObjects(allTiles);
      if (!hits.length) return;
      const tile = hits[0].object as THREE.Mesh;
      const { col, row } = tile.userData as { col: number; row: number };
      const activeIdx = activeCellsRef.current.findIndex(a => a.col === col && a.row === row);
      const tileMat = tile.material as THREE.MeshStandardMaterial;
      if (activeIdx >= 0) {
        const cell = activeCellsRef.current[activeIdx];
        const rt = Date.now() - cell.spawnTime;
        s.sig.hits++; s.sig.reactionTimes.push(rt); s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const bonus = s.sig.streakCurrent >= 5 ? 3 : s.sig.streakCurrent >= 3 ? 2 : 1;
        s.sig.score += bonus; setScoreDisplay(s.sig.score); setStreakDisplay(s.sig.streakCurrent);
        activeCellsRef.current.splice(activeIdx, 1);
        tileMat.color.set(0x4ade80); tileMat.emissiveIntensity = 2;
        tile.userData.active = false;
        sfx.collect(); haptic([30]);
        // Speed up
        s.speedLevel = 1 + Math.floor(s.sig.score / 5);
        s.cellWindow = Math.max(600, 1800 - s.speedLevel * 120);
        s.maxActive = Math.min(4, 2 + Math.floor(s.sig.score / 8));
        setTimeout(() => { tileMat.color.set(0x1a0000); tileMat.emissiveIntensity = 0; }, 200);
      } else {
        s.sig.misses++; s.sig.streakCurrent = 0; setStreakDisplay(0);
        tileMat.color.set(0xef4444); tileMat.emissiveIntensity = 1;
        sfx.nearMiss(); haptic([20, 30, 20]);
        setTimeout(() => { tileMat.color.set(0x1a0000); tileMat.emissiveIntensity = 0; }, 200);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onTap);

    let spawnInterval = 900;
    const rescheduleSpawn = () => {
      if (spawnTimerRef.current) clearInterval(spawnTimerRef.current);
      spawnTimerRef.current = setInterval(() => {
        spawnCell();
        const ni = Math.max(350, 900 - s.speedLevel * 60);
        if (ni !== spawnInterval) { spawnInterval = ni; rescheduleSpawn(); }
      }, spawnInterval);
    };
    rescheduleSpawn(); spawnCell();

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) { sfx.warning(); haptic([50, 30, 50]); }
      else if (s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    let t = 0;
    const loop = () => {
      if (!s.running) return;
      animRef.current = requestAnimationFrame(loop);
      t += 0.01;
      const now = Date.now();

      // Expire cells
      for (let i = activeCellsRef.current.length - 1; i >= 0; i--) {
        const cell = activeCellsRef.current[i];
        const age = now - cell.spawnTime;
        const pct = Math.min(1, age / cell.windowMs);
        if (pct >= 1) {
          activeCellsRef.current.splice(i, 1);
          s.sig.misses++; s.sig.streakCurrent = 0; setStreakDisplay(0);
          sfx.nearMiss(); haptic([20, 30, 20]);
          const mat = cell.mesh.material as THREE.MeshStandardMaterial;
          mat.color.set(0x1a0000); mat.emissiveIntensity = 0;
          cell.mesh.userData.active = false;
          continue;
        }
        // Urgency color: green → red as time runs out
        const mat = cell.mesh.material as THREE.MeshStandardMaterial;
        const r = Math.round(239 * (1 - pct) + 74 * pct);
        const g = Math.round(68 * (1 - pct) + 222 * pct);
        mat.color.set(new THREE.Color(r/255, g/255, 68/255));
        mat.emissiveIntensity = 1.5 + Math.sin(now * 0.012) * 0.5;
        // Slightly pop active tiles out
        cell.mesh.position.z = 0.2 + Math.sin(now * 0.01) * 0.05;
      }

      if (accentLightRef.current) { accentLightRef.current.position.x = Math.sin(t * 0.5) * 4; accentLightRef.current.intensity = 30 + Math.sin(t * 3) * 15; }
      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => { renderer.domElement.removeEventListener('pointerdown', onTap); };
  }, [endGame, spawnCell]);

  useEffect(() => {
    const onResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      const W = window.innerWidth, H = window.innerHeight;
      cameraRef.current.aspect = W / H; cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(W, H);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (spawnTimerRef.current) clearInterval(spawnTimerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
      if (rendererRef.current && mountRef.current) {
        try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
        rendererRef.current.dispose();
      }
    };
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    stateRef.current.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (spawnTimerRef.current) { clearInterval(spawnTimerRef.current); spawnTimerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (rendererRef.current && mountRef.current) {
      try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
      rendererRef.current.dispose(); rendererRef.current = null;
    }
    activeCellsRef.current = []; cellMeshesRef.current = [];
    setScoreDisplay(0); setStreakDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
    setPhase('start');
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 20%, rgba(239,68,68,0.1) 0%, transparent 60%), linear-gradient(180deg, #140000 0%, #0a0000 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start →" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={() => startLoop()} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={accent} items={[
              { label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 5, testId: 'timer' },
              { label: 'SCORE', value: scoreDisplay, testId: 'score' },
              { label: 'STREAK', value: streakDisplay, testId: 'streak' },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Taps Hit', value: String(finalSig.hits), color: accent },
              { label: 'Missed', value: String(finalSig.misses), color: finalSig.misses === 0 ? '#4ade80' : '#ef4444' },
              { label: 'Best Streak', value: `${finalSig.maxStreak}x`, color: '#fbbf24' },
              { label: 'Avg Reaction', value: `${finalSig.avgReaction}ms`, color: finalSig.avgReaction < 350 ? '#4ade80' : '#facc15' },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 10} finalScore={finalSig.score} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}
