'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'pixel-paint';
const ACCENT = '#f472b6';
const DURATION = 30;
const GAME_EMOJI = '🎨';
const GAME_TITLE = 'Pixel Paint';
const GAME_TAGLINE = 'Speed-paint the pattern. Go!';

const GRID = 6; // 6x6 voxel grid (reduced from 8x8 for 3D clarity)
const PATTERNS = [
  [1,0,1,0,1,0, 0,1,0,1,0,1, 1,0,1,0,1,0, 0,1,0,1,0,1, 1,0,1,0,1,0, 0,1,0,1,0,1],
  [1,1,1,1,1,1, 1,0,0,0,0,1, 1,0,1,1,0,1, 1,0,1,1,0,1, 1,0,0,0,0,1, 1,1,1,1,1,1],
  [0,0,1,1,0,0, 0,1,0,0,1,0, 1,0,0,0,0,1, 1,0,0,0,0,1, 0,1,0,0,1,0, 0,0,1,1,0,0],
];
const PATTERN_COLS = [0xf472b6, 0x818cf8, 0x10b981];

interface Signals { totalPatterns: number; completed: number; perfectCompletions: number; accuracy: number; maxStreak: number; streakCurrent: number; score: number; totalCells: number; correctCells: number; }
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const acc = sig.totalCells > 0 ? sig.correctCells / sig.totalCells : 0;
  if (acc >= 0.95 && sig.perfectCompletions >= 2) return 'Pixel Artist 🎨';
  if (sig.completed >= 3) return 'Speed Painter ⚡';
  if (sig.maxStreak >= 3) return 'Combo Brush 🖌️';
  if (acc >= 0.7) return 'Getting the Hang 📐';
  return 'Rough Sketch 🖊️';
}

interface VoxelCell { mesh: THREE.Mesh; row: number; col: number; painted: boolean; }
interface TargetVoxel { mesh: THREE.Mesh; row: number; col: number; }

export default function PixelPaint() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerCellsRef = useRef<VoxelCell[]>([]);
  const targetCellsRef = useRef<TargetVoxel[]>([]);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { totalPatterns: 0, completed: 0, perfectCompletions: 0, accuracy: 0, maxStreak: 0, streakCurrent: 0, score: 0, totalCells: 0, correctCells: 0 } as Signals,
    pattern: [] as number[], playerGrid: [] as number[], patternIndex: 0, accentColor: ACCENT,
    painting: false, completionEffect: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    hapticVictory();
    try { const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0'); if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score)); } catch { /**/ }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const checkCompletion = useCallback(() => {
    const s = stateRef.current;
    let correct = 0;
    for (let i = 0; i < s.pattern.length; i++) { if (s.playerGrid[i] === s.pattern[i]) correct++; }
    const acc = correct / s.pattern.length;
    s.sig.totalCells += s.pattern.length;
    s.sig.correctCells += correct;
    if (acc >= 0.95) {
      s.sig.completed++;
      const isPerfect = acc === 1;
      if (isPerfect) s.sig.perfectCompletions++;
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
      const pts = (isPerfect ? 5 : 3) * mult;
      s.sig.score += pts; setScoreDisplay(s.sig.score);
      s.completionEffect = 60;
      sfx.success(); hapticScore();
      setTimeout(() => { if (s.running) loadPattern(); }, 600);
    }
  }, []);

  const loadPattern = useCallback(() => {
    const s = stateRef.current;
    s.patternIndex = (s.patternIndex + 1) % PATTERNS.length;
    s.pattern = [...PATTERNS[s.patternIndex]];
    s.playerGrid = new Array(GRID * GRID).fill(0);
    s.sig.totalPatterns++;
    const col = PATTERN_COLS[s.patternIndex % PATTERN_COLS.length];
    // Update target voxels
    targetCellsRef.current.forEach((tv) => {
      const val = s.pattern[tv.row * GRID + tv.col];
      const mat = tv.mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(val ? col : 0x1a0a22);
      mat.emissive.set(val ? new THREE.Color(col).multiplyScalar(0.3) : new THREE.Color(0x000000));
      tv.mesh.visible = true;
    });
    // Reset player voxels
    playerCellsRef.current.forEach(pv => {
      pv.painted = false;
      const mat = pv.mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(0x1a0a22);
      mat.emissive.set(0x000000);
      pv.mesh.scale.y = 0.1;
    });
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;

    // Guard: check WebGL support before attempting renderer creation
    try {
      const testCanvas = document.createElement('canvas');
      const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
      if (!gl) {
        alert('WebGL is not supported on this device. Please try a different browser.');
        return;
      }
    } catch { /* ignore */ }

    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.patternIndex = -1;
    s.sig = { totalPatterns: 0, completed: 0, perfectCompletions: 0, accuracy: 0, maxStreak: 0, streakCurrent: 0, score: 0, totalCells: 0, correctCells: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f0a14);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 60);
    camera.position.set(0, 7, 12);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Use antialias only on non-mobile or high-end devices to avoid WebGL crashes
    const isMobileDev = /Android|iPhone|iPad/i.test(navigator.userAgent);
    const renderer = new THREE.WebGLRenderer({ antialias: !isMobileDev, powerPreference: 'default' });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x1a0a2e, 3));
    const pLight = new THREE.PointLight(0xf472b6, 60, 25);
    pLight.position.set(0, 8, 8);
    scene.add(pLight);
    scene.add(Object.assign(new THREE.PointLight(0x818cf8, 40, 20), { position: new THREE.Vector3(-5, 4, 5) }));

    // Stars
    const sg = new THREE.BufferGeometry();
    const sp = new Float32Array(400);
    for (let i = 0; i < 400; i += 3) { sp[i] = (Math.random()-0.5)*50; sp[i+1] = (Math.random()-0.5)*50; sp[i+2] = -10 - Math.random()*10; }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07 })));

    const spacing = 1.15;
    const offset = (GRID - 1) * spacing / 2;
    const voxGeo = new THREE.BoxGeometry(1.0, 0.8, 1.0);

    // Target grid (top, tilted back)
    targetCellsRef.current = [];
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x1a0a22, roughness: 0.4, metalness: 0.5 });
      const mesh = new THREE.Mesh(voxGeo, mat);
      mesh.position.set(c * spacing - offset, 0.4, r * spacing - offset - GRID * spacing - 0.5);
      mesh.receiveShadow = true;
      scene.add(mesh);
      targetCellsRef.current.push({ mesh, row: r, col: c });
    }

    // Player grid (front, tiltable)
    playerCellsRef.current = [];
    const playerPlane = new THREE.Group();
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x1a0a22, roughness: 0.4, metalness: 0.5 });
      const mesh = new THREE.Mesh(voxGeo, mat);
      mesh.position.set(c * spacing - offset, 0.4, r * spacing - offset + 1.0);
      mesh.scale.y = 0.1;
      mesh.castShadow = true;
      mesh.userData = { row: r, col: c, idx: r * GRID + c };
      scene.add(mesh);
      playerCellsRef.current.push({ mesh, row: r, col: c, painted: false });
    }

    // Ground
    const groundGeo = new THREE.PlaneGeometry(20, 20);
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ color: 0x08041a, roughness: 0.9 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Raycaster for painting
    const raycaster = new THREE.Raycaster();
    const playerMeshes = playerCellsRef.current.map(pv => pv.mesh);
    const onPointer = (e: PointerEvent) => {
      if (!s.running || !s.painting) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(((e.clientX - rect.left)/rect.width)*2-1, -((e.clientY - rect.top)/rect.height)*2+1);
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(playerMeshes);
      if (!hits.length) return;
      const { row, col, idx } = hits[0].object.userData as { row: number; col: number; idx: number };
      const pv = playerCellsRef.current.find(p => p.row === row && p.col === col);
      if (pv && !pv.painted) {
        pv.painted = true;
        s.playerGrid[idx] = 1;
        const col2 = PATTERN_COLS[s.patternIndex % PATTERN_COLS.length];
        const mat = pv.mesh.material as THREE.MeshStandardMaterial;
        mat.color.set(col2); mat.emissive.set(new THREE.Color(col2).multiplyScalar(0.3));
        pv.mesh.scale.y = 1;
        checkCompletion();
      }
    };
    renderer.domElement.addEventListener('pointerdown', (e) => { s.painting = true; onPointer(e); });
    renderer.domElement.addEventListener('pointermove', onPointer);
    renderer.domElement.addEventListener('pointerup', () => { s.painting = false; });

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft === 5) sfx.warning();
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    loadPattern();

    let t = 0;
    const loop = () => {
      if (!s.running) return;
      animRef.current = requestAnimationFrame(loop);
      t += 0.01;
      if (s.completionEffect > 0) {
        s.completionEffect--;
        pLight.intensity = 60 + (s.completionEffect / 60) * 100;
      }
      playerCellsRef.current.forEach((pv, i) => {
        if (pv.painted) pv.mesh.position.y = 0.4 + Math.sin(t * 2 + i * 0.3) * 0.04;
      });
      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, loadPattern, checkCompletion]);

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
      if (rendererRef.current && mountRef.current) {
        try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
        rendererRef.current.dispose();
      }
    };
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    stateRef.current.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (rendererRef.current && mountRef.current) {
      try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
      rendererRef.current.dispose(); rendererRef.current = null;
    }
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
    setPhase('countdown');
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 30%, rgba(244,114,182,0.1) 0%, transparent 60%), linear-gradient(180deg, #0f0a14 0%, #080610 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Paint! 🎨" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <>
              <GameHUD accentColor={accent} items={[
                { label: 'TIME', value: timeLeft, danger: timeLeft <= 5, testId: 'timer' },
                { label: 'SCORE', value: scoreDisplay, testId: 'score' },
              ]} />
              <div style={{ position: 'absolute', top: '13%', left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.4)', fontSize: 12, pointerEvents: 'none' }}>TARGET (back) · PAINT (front)</div>
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Patterns Done', value: String(finalSig.completed), color: ACCENT },
            { label: 'Perfect', value: String(finalSig.perfectCompletions), color: '#fbbf24' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' },
            { label: 'Accuracy', value: `${finalSig.totalCells > 0 ? Math.round(finalSig.correctCells/finalSig.totalCells*100) : 0}%`, color: '#06b6d4' },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.completed >= 2} />
      )}
    </GameShell>
  );
}
