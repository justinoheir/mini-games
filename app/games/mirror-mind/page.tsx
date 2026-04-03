'use client';
/**
 * MIRROR MIND — 3D grid with mirror plane. Complete the left pattern on the right.
 */
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

const GAME_ID = 'mirror-mind';
const PB_KEY = 'mg_pb_mirror-mind';
const ACCENT = '#8b5cf6';
const DURATION = 45;
const GAME_EMOJI = '🪞';
const GAME_TITLE = 'Mirror Mind';
const GAME_TAGLINE = 'Half the pattern is shown — tap cells to complete the mirror image.';

const ROWS = 4, HALF_COLS = 3;

interface Signals { score: number; roundsCompleted: number; correctTaps: number; wrongTaps: number; maxStreak: number; }

function getPersonality(sig: Signals): string {
  const total = sig.correctTaps + sig.wrongTaps;
  const acc = total > 0 ? sig.correctTaps / total : 0;
  if (sig.roundsCompleted >= 8 && acc >= 0.90) return 'Mirror Master 🪞';
  if (sig.roundsCompleted >= 5 && acc >= 0.75) return 'Spatial Thinker 🧠';
  if (acc >= 0.8) return 'Reflective Mind ✨';
  if (sig.roundsCompleted >= 3) return 'Pattern Seeker 🔍';
  return 'Getting Symmetric 🌀';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface CellObj {
  mesh: THREE.Mesh; row: number; col: number; side: 'left' | 'right';
  isPattern: boolean; tapped: boolean; correct: boolean;
}

export default function MirrorMindGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { score: 0, roundsCompleted: 0, correctTaps: 0, wrongTaps: 0, maxStreak: 0 } as Signals,
    cells: [] as CellObj[],
    leftPattern: [] as boolean[][],
    rightTarget: [] as boolean[][],
    roundPhase: 'show' as 'show' | 'input',
    streakCurrent: 0,
    scene: null as THREE.Scene | null,
    renderer: null as THREE.WebGLRenderer | null,
    camera: null as THREE.PerspectiveCamera | null,
    raycaster: new THREE.Raycaster(),
    pendingClick: null as THREE.Vector2 | null,
    mirrorPlane: null as THREE.Mesh | null,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [roundPhaseDisplay, setRoundPhaseDisplay] = useState<'show' | 'input'>('show');

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const buildRound = useCallback((scene: THREE.Scene) => {
    const s = stateRef.current;
    // Clear old cells
    s.cells.forEach(c => scene.remove(c.mesh));
    s.cells = [];

    const CELL = 1.1, GAP = 0.12;
    const totalW = HALF_COLS * CELL + (HALF_COLS - 1) * GAP;
    const totalH = ROWS * CELL + (ROWS - 1) * GAP;
    const offsetX = -totalW - 0.5;
    const offsetY = totalH / 2 - CELL / 2;

    // Generate random left pattern
    const leftPat = Array.from({ length: ROWS }, () =>
      Array.from({ length: HALF_COLS }, () => Math.random() > 0.45)
    );
    s.leftPattern = leftPat;

    // Mirror: mirror horizontally (col HALF_COLS-1-c)
    const rightTarget = leftPat.map(row => [...row].reverse());
    s.rightTarget = rightTarget;

    for (let side = 0; side < 2; side++) {
      const baseX = side === 0 ? offsetX : 0.5;
      const sideLabel = side === 0 ? 'left' : 'right';

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < HALF_COLS; c++) {
          const x = baseX + c * (CELL + GAP);
          const y = offsetY - r * (CELL + GAP);

          const isPattern = side === 0 ? leftPat[r][c] : false;
          const geo = new THREE.BoxGeometry(CELL, CELL, 0.2);
          const mat = new THREE.MeshPhongMaterial({
            color: side === 0 && isPattern ? 0x8b5cf6 : 0x1a0a3a,
            emissive: side === 0 && isPattern ? 0x4c1d95 : 0x050318,
            emissiveIntensity: isPattern ? 0.6 : 0.1,
            transparent: true, opacity: 0.9,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(x, y, 0);
          scene.add(mesh);
          s.cells.push({ mesh, row: r, col: c, side: sideLabel as 'left' | 'right', isPattern, tapped: false, correct: false });
        }
      }
    }

    s.roundPhase = 'input';
    setRoundPhaseDisplay('input');
  }, []);

  const checkRound = useCallback((scene: THREE.Scene) => {
    const s = stateRef.current;
    const rightCells = s.cells.filter(c => c.side === 'right');
    const allCorrect = rightCells.every(c => c.tapped === s.rightTarget[c.row][c.col]);
    if (allCorrect) {
      s.sig.roundsCompleted++;
      s.streakCurrent++;
      if (s.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.streakCurrent;
      const pts = 5 * (s.streakCurrent >= 3 ? 2 : 1);
      s.sig.score += pts;
      setScoreDisplay(s.sig.score);
      sfx.success(); haptic([30, 20, 50]);
      setTimeout(() => { if (s.running) buildRound(scene); }, 500);
    }
  }, [buildRound]);

  const startLoop = useCallback(() => {
    if (!mountRef.current) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, roundsCompleted: 0, correctTaps: 0, wrongTaps: 0, maxStreak: 0 };
    s.streakCurrent = 0; s.cells = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x050318);
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 200);
    camera.position.set(0, 0, 10);
    s.camera = camera;

    // Lights
    scene.add(new THREE.AmbientLight(0x1a0a3a, 5));
    const topLight = new THREE.PointLight(0x8b5cf6, 3, 20);
    topLight.position.set(0, 5, 5);
    scene.add(topLight);

    // Mirror plane
    const mirrorGeo = new THREE.PlaneGeometry(0.08, ROWS * 1.1 + 0.5);
    const mirrorMat = new THREE.MeshPhongMaterial({ color: 0x60a5fa, emissive: 0x1e3a5f, transparent: true, opacity: 0.7 });
    const mirrorPlane = new THREE.Mesh(mirrorGeo, mirrorMat);
    mirrorPlane.position.set(0, 0, 0.15);
    scene.add(mirrorPlane);
    s.mirrorPlane = mirrorPlane;

    // Mirror glow light
    const mirrorLight = new THREE.PointLight(0x60a5fa, 2, 8);
    mirrorLight.position.set(0, 0, 1);
    scene.add(mirrorLight);

    // Star field
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(400 * 3);
    for (let i = 0; i < 400; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 40;
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 30;
      starPos[i * 3 + 2] = (Math.random() - 0.5) * 20 - 5;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xc4b5fd, size: 0.04, transparent: true, opacity: 0.4 })));

    // Labels
    buildRound(scene);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    let t = 0;
    const loop = () => {
      if (!s.running) { renderer.dispose(); return; }
      t += 0.016;

      // Process click on right side cells
      if (s.pendingClick && s.roundPhase === 'input') {
        s.raycaster.setFromCamera(s.pendingClick, camera);
        const rightMeshes = s.cells.filter(c => c.side === 'right').map(c => c.mesh);
        const hits = s.raycaster.intersectObjects(rightMeshes);
        if (hits.length > 0) {
          const hitMesh = hits[0].object as THREE.Mesh;
          const cell = s.cells.find(c => c.mesh === hitMesh && c.side === 'right');
          if (cell) {
            cell.tapped = !cell.tapped;
            const shouldBeTapped = s.rightTarget[cell.row][cell.col];
            const correct = cell.tapped === shouldBeTapped;

            (cell.mesh.material as THREE.MeshPhongMaterial).color.setHex(cell.tapped ? 0x8b5cf6 : 0x1a0a3a);
            (cell.mesh.material as THREE.MeshPhongMaterial).emissive.setHex(cell.tapped ? 0x4c1d95 : 0x050318);
            (cell.mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = cell.tapped ? 0.6 : 0.1;

            if (correct) { s.sig.correctTaps++; sfx.collect(); haptic([20]); }
            else { s.sig.wrongTaps++; sfx.click(); haptic([15]); }

            checkRound(scene);
          }
        }
        s.pendingClick = null;
      }

      // Mirror plane pulse
      if (s.mirrorPlane) {
        (s.mirrorPlane.material as THREE.MeshPhongMaterial).opacity = 0.5 + Math.sin(t * 3) * 0.2;
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
  }, [endGame, buildRound, checkRound]);

  useEffect(() => {
    const el = mountRef.current; if (!el) return;
    const onDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current; if (!s.renderer) return;
      const rect = s.renderer.domElement.getBoundingClientRect();
      s.pendingClick = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    };
    el.addEventListener('pointerdown', onDown);
    return () => el.removeEventListener('pointerdown', onDown);
  }, [phase]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    stateRef.current.renderer?.dispose();
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg,#050318 0%,#080528 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="See Your Reflection 🪞" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none', touchAction: 'none' }} />
      {phase === 'playing' && (
        <>
          <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />
          <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', color: 'rgba(139,92,246,0.7)', fontSize: 13, fontWeight: 700, pointerEvents: 'none', zIndex: 50 }}>
            👈 Left: pattern shown | Right: tap to mirror 👉
          </div>
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Rounds Done', value: `${finalSig.roundsCompleted}`, color: ACCENT },
            { label: 'Correct Taps', value: `${finalSig.correctTaps}`, color: '#4ade80' },
            { label: 'Wrong Taps', value: `${finalSig.wrongTaps}`, color: '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.roundsCompleted >= 5} />
      )}
      {phase === 'done' && finalSig && <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />}
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
