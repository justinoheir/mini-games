'use client';
/**
 * MEMORY GRID — 3D glowing cell grid. Watch the pattern, repeat it.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Brain } from 'lucide-react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { playScoreHit, playVictoryFanfare } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';

const GAME_ID = 'memory-grid';
const PB_KEY = 'pb_memory-grid';
const ACCENT = '#8b5cf6';
const DURATION = 60;
const GAME_EMOJI = '🧠';
const GAME_TITLE = 'Memory Grid';
const GAME_TAGLINE = 'Remember the pattern. Repeat it.';

const CELL_COUNT = 9;
const GRID_COLS = 3;
const WATCH_SHOW_MS = 600;
const WATCH_GAP_MS = 200;
const FLASH_MS = 380;

interface Signals {
  score: number; roundsCompleted: number; maxSequenceLength: number;
  totalErrors: number; maxStreak: number;
}

function getPersonality(sig: Signals): string {
  if (sig.roundsCompleted >= 8 && sig.totalErrors === 0) return 'Perfect Memory 🧠';
  if (sig.maxSequenceLength >= 7) return 'Memory Champion 🏆';
  if (sig.roundsCompleted >= 5) return 'Pattern Master 🎯';
  if (sig.roundsCompleted >= 3) return 'Sharp Recall 💡';
  return 'Memory Warming Up 🌱';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';
type RoundPhase = 'watch' | 'recall' | 'feedback';

interface CellMesh {
  mesh: THREE.Mesh; light: THREE.PointLight; idx: number;
  baseColor: number; glowColor: number;
}

function MemoryGridGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { score: 0, roundsCompleted: 0, maxSequenceLength: 0, totalErrors: 0, maxStreak: 0 } as Signals,
    sequence: [] as number[],
    playerInput: [] as number[],
    roundPhase: 'watch' as RoundPhase,
    watchIdx: 0, watchTimer: 0,
    feedbackTimer: 0, feedbackOk: false,
    cells: [] as CellMesh[],
    streakCurrent: 0,
    scene: null as THREE.Scene | null,
    renderer: null as THREE.WebGLRenderer | null,
    camera: null as THREE.PerspectiveCamera | null,
    raycaster: new THREE.Raycaster(),
    pendingClick: null as THREE.Vector2 | null,
    pendingWatchTimeout: null as ReturnType<typeof setTimeout> | null,
    isNewBest: false,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [roundPhaseDisplay, setRoundPhaseDisplay] = useState<RoundPhase>('watch');
  const [isNewBest, setIsNewBest] = useState(false);
  const { pops, triggerPop } = useScorePop();

  const CELL_COLORS = [0x8b5cf6, 0x6d28d9, 0xa78bfa, 0x7c3aed, 0x5b21b6, 0x4c1d95, 0x8b5cf6, 0x7c3aed, 0xa78bfa];

  const flashCell = useCallback((idx: number, color: number, duration = 300) => {
    const s = stateRef.current;
    const cell = s.cells[idx];
    if (!cell) return;
    (cell.mesh.material as THREE.MeshPhongMaterial).color.setHex(color);
    (cell.mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 1.5;
    cell.light.intensity = 6;
    setTimeout(() => {
      (cell.mesh.material as THREE.MeshPhongMaterial).color.setHex(cell.baseColor);
      (cell.mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 0.2;
      cell.light.intensity = 0;
    }, duration);
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    if (s.pendingWatchTimeout) { clearTimeout(s.pendingWatchTimeout); s.pendingWatchTimeout = null; }
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
      if (s.sig.score > pb) { localStorage.setItem(PB_KEY, String(s.sig.score)); setIsNewBest(true); }
    } catch { /**/ }
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory(); playVictoryFanfare();
  }, []);

  const startRound = useCallback((seqLen: number) => {
    const s = stateRef.current;
    const seq = Array.from({ length: seqLen }, () => Math.floor(Math.random() * CELL_COUNT));
    s.sequence = seq;
    s.playerInput = [];
    s.roundPhase = 'watch';
    setRoundPhaseDisplay('watch');
    if (seq.length > s.sig.maxSequenceLength) s.sig.maxSequenceLength = seq.length;

    // Show sequence with delays
    let delay = 400;
    seq.forEach((idx, i) => {
      const t1 = delay + i * (WATCH_SHOW_MS + WATCH_GAP_MS);
      const t2 = t1 + WATCH_SHOW_MS;
      const to1 = setTimeout(() => { if (s.running) flashCell(idx, 0xffffff, WATCH_SHOW_MS); sfx.countdown(); haptic([20]); }, t1);
      s.pendingWatchTimeout = to1;
      setTimeout(() => {
        if (i === seq.length - 1 && s.running) {
          s.roundPhase = 'recall';
          setRoundPhaseDisplay('recall');
        }
      }, t2 + WATCH_GAP_MS);
    });
  }, [flashCell]);

  const startLoop = useCallback(() => {
    if (!mountRef.current) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, roundsCompleted: 0, maxSequenceLength: 0, totalErrors: 0, maxStreak: 0 };
    s.streakCurrent = 0; s.cells = []; s.pendingClick = null;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x050310);
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 200);
    camera.position.set(0, 0, 10);
    s.camera = camera;

    // Lights
    scene.add(new THREE.AmbientLight(0x1a0a3a, 4));
    const topLight = new THREE.PointLight(0x8b5cf6, 2, 20);
    topLight.position.set(0, 5, 5);
    scene.add(topLight);

    // Star field background
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 60;
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 60;
      starPos[i * 3 + 2] = (Math.random() - 0.5) * 30 - 5;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.04, transparent: true, opacity: 0.4 })));

    // Build 3x3 grid of glowing cells
    const CELL_W = 2.0, GAP = 0.25;
    const TOTAL = GRID_COLS * CELL_W + (GRID_COLS - 1) * GAP;
    const offsetX = -TOTAL / 2 + CELL_W / 2;
    const offsetY = TOTAL / 2 - CELL_W / 2;

    for (let idx = 0; idx < CELL_COUNT; idx++) {
      const row = Math.floor(idx / GRID_COLS);
      const col = idx % GRID_COLS;
      const x = offsetX + col * (CELL_W + GAP);
      const y = offsetY - row * (CELL_W + GAP);

      const geo = new THREE.BoxGeometry(CELL_W, CELL_W, 0.3);
      const baseColor = CELL_COLORS[idx % CELL_COLORS.length];
      const mat = new THREE.MeshPhongMaterial({
        color: baseColor, emissive: baseColor, emissiveIntensity: 0.2,
        transparent: true, opacity: 0.85, shininess: 80,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, 0);
      scene.add(mesh);

      // Edge glow
      const edgeGeo = new THREE.EdgesGeometry(geo);
      const edgeMat = new THREE.LineBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.4 });
      const edge = new THREE.LineSegments(edgeGeo, edgeMat);
      edge.position.copy(mesh.position);
      scene.add(edge);

      // Cell light
      const cellLight = new THREE.PointLight(baseColor, 0, 3);
      cellLight.position.set(x, y, 1);
      scene.add(cellLight);

      s.cells.push({ mesh, light: cellLight, idx, baseColor, glowColor: 0xffffff });
    }

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    // Start first round
    setTimeout(() => { if (s.running) startRound(3); }, 500);

    let t = 0;
    const loop = () => {
      if (!s.running) { renderer.dispose(); return; }
      t += 0.016;

      // Process click
      if (s.pendingClick && s.roundPhase === 'recall') {
        s.raycaster.setFromCamera(s.pendingClick, camera);
        const cellMeshes = s.cells.map(c => c.mesh);
        const hits = s.raycaster.intersectObjects(cellMeshes);
        if (hits.length > 0) {
          const hitMesh = hits[0].object as THREE.Mesh;
          const cell = s.cells.find(c => c.mesh === hitMesh);
          if (cell) {
            const expectedIdx = s.playerInput.length;
            const correctIdx = s.sequence[expectedIdx];

            if (cell.idx === correctIdx) {
              flashCell(cell.idx, 0x4ade80, FLASH_MS);
              sfx.collect(); haptic([20]);
              s.playerInput.push(cell.idx);

              if (s.playerInput.length === s.sequence.length) {
                // Round complete!
                s.sig.roundsCompleted++;
                s.streakCurrent++;
                if (s.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.streakCurrent;
                const pts = s.sequence.length * 10;
                s.sig.score += pts;
                setScoreDisplay(s.sig.score);
                hapticScore(); sfx.success();
                triggerPop(`+${pts}`, window.innerWidth / 2, 150);
                setTimeout(() => { if (s.running) startRound(Math.min(3 + Math.floor(s.sig.roundsCompleted / 2), 8)); }, 600);
              }
            } else {
              // Error
              flashCell(cell.idx, 0xef4444, FLASH_MS);
              sfx.collision(); hapticFail();
              s.sig.totalErrors++;
              s.streakCurrent = 0;
              s.playerInput = [];
              // Re-show sequence after brief pause
              setTimeout(() => { if (s.running) startRound(s.sequence.length); }, 800);
            }
          }
        }
        s.pendingClick = null;
      }

      // Subtle cell pulse in recall mode
      if (s.roundPhase === 'recall') {
        s.cells.forEach((cell, i) => {
          const mat = cell.mesh.material as THREE.MeshPhongMaterial;
          mat.emissiveIntensity = 0.15 + Math.sin(t * 2 + i * 0.7) * 0.1;
        });
      }

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      s.running = false;
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [endGame, startRound, triggerPop, flashCell]);

  useEffect(() => {
    const el = mountRef.current; if (!el) return;
    const onDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.renderer) return;
      const rect = s.renderer.domElement.getBoundingClientRect();
      s.pendingClick = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };
    el.addEventListener('pointerdown', onDown);
    return () => el.removeEventListener('pointerdown', onDown);
  }, [phase]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    if (stateRef.current.pendingWatchTimeout) clearTimeout(stateRef.current.pendingWatchTimeout);
    stateRef.current.renderer?.dispose();
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); sfx.click(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg,#050310 0%,#08051a 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} iconNode={<Brain size={80} color={ACCENT} strokeWidth={1.2} />}
          title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Train Your Memory 🧠" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none', touchAction: 'none' }} />
      {phase === 'playing' && (
        <>
          <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
            { label: 'TIME', value: timeLeft, danger: timeLeft <= 10, testId: 'timer' },
            { label: 'SCORE', value: scoreDisplay, testId: 'score' },
          ]} />
          <div style={{ position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 50, pointerEvents: 'none', textAlign: 'center' }}>
            <div style={{ background: roundPhaseDisplay === 'watch' ? 'rgba(139,92,246,0.2)' : 'rgba(74,222,128,0.2)', border: `1px solid ${roundPhaseDisplay === 'watch' ? '#8b5cf6' : '#4ade80'}`, borderRadius: 20, padding: '6px 18px', color: roundPhaseDisplay === 'watch' ? '#c4b5fd' : '#86efac', fontSize: 13, fontWeight: 700 }}>
              {roundPhaseDisplay === 'watch' ? '👁 WATCH' : '✋ REPEAT'}
            </div>
          </div>
          <ScorePopEffect pops={pops} accentColor={ACCENT} />
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Rounds Done', value: `${finalSig.roundsCompleted}`, color: ACCENT },
            { label: 'Max Length', value: `${finalSig.maxSequenceLength}`, color: '#fbbf24' },
            { label: 'Errors', value: `${finalSig.totalErrors}`, color: '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.roundsCompleted >= 5} />
      )}
      {phase === 'done' && finalSig && <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />}
      <AnimatePresence>
        {isNewBest && (
          <motion.div key="pb" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)', zIndex: 90, pointerEvents: 'none', background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', borderRadius: 20, padding: '8px 20px', fontSize: 20, fontWeight: 900, color: '#000', whiteSpace: 'nowrap' }}>
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, roundsCompleted: sig.roundsCompleted }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const MemoryGridGame = dynamic(() => Promise.resolve({ default: MemoryGridGameInner }), { ssr: false });
export default MemoryGridGame;
