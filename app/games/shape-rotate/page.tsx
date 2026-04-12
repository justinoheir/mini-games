'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'shape-rotate';
const ACCENT = '#06b6d4';
const DURATION = 60;
const GAME_EMOJI = '🔷';
const GAME_TITLE = 'Shape Rotate';
const GAME_TAGLINE = 'Spin it in your mind. Match it.';

interface Signals {
  total: number; correct: number; wrong: number;
  avgReactionMs: number; totalMs: number; level: number;
  maxStreak: number; streakCurrent: number; score: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.total > 0 ? sig.correct / sig.total : 0;
  const avg = sig.total > 0 ? sig.totalMs / sig.total : 9999;
  if (acc >= 0.85 && avg < 1500) return 'Spatial Genius 🧠';
  if (sig.level >= 5) return 'Mental Rotator 🔷';
  if (acc >= 0.75) return 'Visual Thinker 👁️';
  if (avg < 2000) return 'Quick Visualizer ⚡';
  return 'Training Eye 🔮';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// Tetromino-style unit coords
const SHAPES = [
  [[0,0],[1,0],[1,1],[2,1]],
  [[0,1],[1,1],[1,0],[2,0]],
  [[0,0],[0,1],[1,1],[2,1]],
  [[0,0],[1,0],[2,0],[2,1]],
  [[0,0],[1,0],[2,0],[1,1]],
  [[0,0],[1,0],[0,1],[1,1]],
] as number[][][];

function rotateShape(shape: number[][], angle: number): number[][] {
  const rad = angle * Math.PI / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  return shape.map(([x, y]) => [cos * x - sin * y, sin * x + cos * y]);
}

function normalizeShape(shape: number[][]): number[][] {
  const minX = Math.min(...shape.map(p => p[0]));
  const minY = Math.min(...shape.map(p => p[1]));
  return shape.map(([x, y]) => [x - minX, y - minY]);
}

interface Question {
  shape: number[][];
  options: Array<{ shape: number[][], isCorrect: boolean }>;
}

function makeQuestion(level: number): Question {
  const baseShape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
  const refAngle = [0, 90, 180, 270][Math.floor(Math.random() * 4)];
  const refShape = normalizeShape(rotateShape(baseShape, refAngle));
  const correctAngle = [0, 90, 180, 270].filter(a => a !== refAngle)[Math.floor(Math.random() * 3)];
  const correctShape = normalizeShape(rotateShape(baseShape, correctAngle));
  const wrongShapes = SHAPES
    .filter((_, i) => i !== SHAPES.indexOf(baseShape))
    .slice(0, level >= 3 ? 3 : 3)
    .map(s => normalizeShape(rotateShape(s, [0,90,180,270][Math.floor(Math.random()*4)])));
  const options = [
    { shape: correctShape, isCorrect: true },
    { shape: wrongShapes[0] || normalizeShape(rotateShape(baseShape, 90)), isCorrect: false },
    { shape: wrongShapes[1] || normalizeShape(rotateShape(baseShape, 180)), isCorrect: false },
    { shape: wrongShapes[2] || normalizeShape(rotateShape(baseShape, 270)), isCorrect: false },
  ].sort(() => Math.random() - 0.5);
  return { shape: refShape, options };
}

// Build a 3D mesh group from shape coords
function buildShapeMesh(shape: number[][], color: number, cellSize: number): THREE.Group {
  const norm = normalizeShape(shape);
  const maxX = Math.max(...norm.map(p => p[0]));
  const maxY = Math.max(...norm.map(p => p[1]));
  const group = new THREE.Group();
  norm.forEach(([x, y]) => {
    const geo = new THREE.BoxGeometry(cellSize * 0.88, cellSize * 0.88, cellSize * 0.35);
    const mat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.3,
      roughness: 0.4, metalness: 0.3,
      transparent: true, opacity: 0.95,
    });
    const cube = new THREE.Mesh(geo, mat);
    cube.position.set(
      (x - maxX / 2) * cellSize,
      -(y - maxY / 2) * cellSize,
      0
    );
    group.add(cube);
  });
  return group;
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.OrthographicCamera | null;
  animId: number;
  frame: number;
  question: Question | null;
  shownAt: number;
  feedback: number | null;
  feedbackTimer: number;
  level: number;
  refGroup: THREE.Group | null;
  optionGroups: THREE.Group[];
  optionBorders: THREE.Mesh[];
  floatMeshes: Array<{ mesh: THREE.Mesh; vy: number; life: number }>;
  intervalId: ReturnType<typeof setInterval> | null;
  // Layout coords in world space
  optionRects: Array<{ x: number; y: number; w: number; h: number }>;
  viewW: number; viewH: number;
}

function ShapeRotateGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { total: 0, correct: 0, wrong: 0, avgReactionMs: 0, totalMs: 0, level: 1, maxStreak: 0, streakCurrent: 0, score: 0 },
    renderer: null, scene: null, camera: null, animId: 0, frame: 0,
    question: null, shownAt: 0, feedback: null, feedbackTimer: 0, level: 1,
    refGroup: null, optionGroups: [], optionBorders: [], floatMeshes: [],
    intervalId: null, optionRects: [], viewW: 0, viewH: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    const pb = parseInt(localStorage.getItem('pb_' + GAME_ID) ?? '0');
    if (s.sig.score > pb) localStorage.setItem('pb_' + GAME_ID, String(s.sig.score));
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, []);

  const buildQuestion = useCallback(() => {
    const s = stateRef.current;
    if (!s.scene || !s.camera) return;
    const scene = s.scene;
    // Remove old groups
    if (s.refGroup) { scene.remove(s.refGroup); }
    s.optionGroups.forEach(g => scene.remove(g));
    s.optionBorders.forEach(m => scene.remove(m));
    s.optionGroups = []; s.optionBorders = []; s.optionRects = [];

    const q = s.question;
    if (!q) return;

    const VW = s.viewW; const VH = s.viewH;
    const cellRef = Math.min(VW, VH) * 0.055;
    const cellOpt = Math.min(VW, VH) * 0.04;

    // Reference shape — top center
    const refGroup = buildShapeMesh(q.shape, 0x06b6d4, cellRef);
    refGroup.position.set(0, VH * 0.26, 0);
    scene.add(refGroup);
    s.refGroup = refGroup;

    // 4 option boxes in 2x2 grid
    const optW = VW * 0.38; const optH = VH * 0.2;
    const gapX = VW * 0.06; const gapY = VH * 0.04;
    const gridLeft = -VW * 0.42; const gridTop = VH * 0.04;

    const optColors = [0x06b6d4, 0x0ea5e9, 0x38bdf8, 0x7dd3fc];

    q.options.forEach((opt, i) => {
      const col = i % 2; const row = Math.floor(i / 2);
      const bx = gridLeft + col * (optW + gapX);
      const by = gridTop - row * (optH + gapY);
      const cx = bx + optW / 2; const cy = by - optH / 2;

      // Background plane
      const bgGeo = new THREE.PlaneGeometry(optW, optH);
      const bgMat = new THREE.MeshBasicMaterial({
        color: 0x06b6d4, transparent: true, opacity: 0.08, side: THREE.DoubleSide,
      });
      const bgMesh = new THREE.Mesh(bgGeo, bgMat);
      bgMesh.position.set(cx, cy, -0.1);
      scene.add(bgMesh);
      s.optionBorders.push(bgMesh);

      // Border line
      const borderGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(optW, optH));
      const borderMat = new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.6 });
      const border = new THREE.LineSegments(borderGeo, borderMat);
      border.position.set(cx, cy, -0.05);
      scene.add(border);
      s.optionBorders.push(border as unknown as THREE.Mesh);

      // Shape mesh
      const optGroup = buildShapeMesh(opt.shape, optColors[i], cellOpt);
      optGroup.position.set(cx, cy, 0);
      scene.add(optGroup);
      s.optionGroups.push(optGroup);

      // Store hit rect in world coords
      s.optionRects.push({ x: bx, y: by - optH, w: optW, h: optH });
    });
  }, []);

  const nextQuestion = useCallback(() => {
    const s = stateRef.current;
    s.question = makeQuestion(s.level);
    s.shownAt = Date.now();
    s.feedback = null; s.feedbackTimer = 0;
    buildQuestion();
  }, [buildQuestion]);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = mount.clientWidth || window.innerWidth;
    const H = mount.clientHeight || window.innerHeight;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { total: 0, correct: 0, wrong: 0, avgReactionMs: 0, totalMs: 0, level: 1, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.frame = 0; s.floatMeshes = []; s.level = 1;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x021218);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;

    // Orthographic camera for 2D-like layout
    const aspect = W / H;
    const vh = H / 2; const vw = W / 2;
    const camera = new THREE.OrthographicCamera(-vw, vw, vh, -vh, 0.1, 100);
    camera.position.z = 10;
    s.camera = camera;
    s.viewW = W; s.viewH = H;

    // Lighting
    scene.add(new THREE.AmbientLight(0x112244, 3));
    const keyLight = new THREE.DirectionalLight(0x06b6d4, 1.5);
    keyLight.position.set(3, 5, 5);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x0ea5e9, 1.5, 30);
    rimLight.position.set(-5, 3, 3);
    scene.add(rimLight);
    const fillLight = new THREE.PointLight(0x7dd3fc, 0.8, 25);
    fillLight.position.set(5, -3, 5);
    scene.add(fillLight);

    // Background grid lines
    const gridMat = new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.04 });
    for (let i = -8; i <= 8; i++) {
      const vg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(i * vw / 8, -vh, -1), new THREE.Vector3(i * vw / 8, vh, -1)]);
      scene.add(new THREE.Line(vg, gridMat));
      const hg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-vw, i * vh / 8, -1), new THREE.Vector3(vw, i * vh / 8, -1)]);
      scene.add(new THREE.Line(hg, gridMat));
    }

    // Reference label plane (visual only — we render text via canvas texture)
    const makeTextSprite = (text: string, color = '#ffffff', size = 28) => {
      const canvas2 = document.createElement('canvas');
      canvas2.width = 512; canvas2.height = 64;
      const ctx2 = canvas2.getContext('2d')!;
      ctx2.fillStyle = 'transparent';
      ctx2.clearRect(0, 0, 512, 64);
      ctx2.fillStyle = color;
      ctx2.font = `${size}px sans-serif`;
      ctx2.textAlign = 'center';
      ctx2.fillText(text, 256, 44);
      const tex = new THREE.CanvasTexture(canvas2);
      const sg = new THREE.PlaneGeometry(W * 0.4, 40);
      const sm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
      return new THREE.Mesh(sg, sm);
    };

    const refLabel = makeTextSprite('REFERENCE', '#06b6d4', 24);
    refLabel.position.set(0, H * 0.38, 0);
    scene.add(refLabel);

    const matchLabel = makeTextSprite('Which rotation matches?', 'rgba(255,255,255,0.5)', 20);
    matchLabel.position.set(0, H * 0.08, 0);
    scene.add(matchLabel);

    const onResize = () => {
      const W2 = mount.clientWidth || window.innerWidth;
      const H2 = mount.clientHeight || window.innerHeight;
      renderer.setSize(W2, H2);
      (camera as THREE.OrthographicCamera).left = -W2 / 2;
      (camera as THREE.OrthographicCamera).right = W2 / 2;
      (camera as THREE.OrthographicCamera).top = H2 / 2;
      (camera as THREE.OrthographicCamera).bottom = -H2 / 2;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    (s as unknown as { _resizeCleanup: () => void })._resizeCleanup = () => window.removeEventListener('resize', onResize);

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    nextQuestion();

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Animate ref shape rotation
      if (s.refGroup) s.refGroup.rotation.y = Math.sin(s.frame * 0.02) * 0.3;

      // Animate option shapes subtle hover
      s.optionGroups.forEach((g, i) => {
        g.rotation.y = Math.sin(s.frame * 0.015 + i * 1.2) * 0.2;
        if (s.feedback === i) {
          const isCorrect = s.question?.options[i].isCorrect;
          const target = isCorrect ? 0x4ade80 : 0xef4444;
          g.children.forEach(c => {
            (c as THREE.Mesh).material && ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).color.setHex(target);
          });
        }
      });

      // Float text meshes
      s.floatMeshes = s.floatMeshes.filter(f => {
        f.mesh.position.y += f.vy;
        f.life--;
        (f.mesh.material as THREE.MeshBasicMaterial).opacity = f.life / 40;
        if (f.life <= 0) { scene.remove(f.mesh); return false; }
        return true;
      });

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, nextQuestion]);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleTap = useCallback((clientX: number, clientY: number) => {
    const s = stateRef.current;
    if (!s.running || s.feedback !== null || !s.question || !s.renderer || !s.camera) return;
    const rect = s.renderer.domElement.getBoundingClientRect();
    // Convert to world coords
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), s.camera);

    for (let i = 0; i < s.optionGroups.length; i++) {
      const hits = raycaster.intersectObjects(s.optionGroups[i].children, true);
      if (hits.length > 0) {
        const ms = Date.now() - s.shownAt;
        s.sig.total++; s.sig.totalMs += ms;
        s.feedback = i; s.feedbackTimer = 20;

        if (s.question.options[i].isCorrect) {
          s.sig.correct++;
          s.sig.streakCurrent++;
          if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
          const speedPts = ms < 1500 ? 3 : ms < 2500 ? 2 : 1;
          s.sig.score += speedPts; setScoreDisplay(s.sig.score);
          s.level = Math.min(6, 1 + Math.floor(s.sig.correct / 4));
          s.sig.level = s.level;
          sfx.collect(); hapticScore();
          if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
        } else {
          s.sig.wrong++; s.sig.streakCurrent = 0;
          sfx.collision(); hapticFail();
        }
        setTimeout(() => { if (s.running) nextQuestion(); }, 600);
        break;
      }
    }
  }, [nextQuestion]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      handleTap(e.clientX, e.clientY);
    };
    mount.addEventListener('pointerdown', onPointerDown);
    return () => mount.removeEventListener('pointerdown', onPointerDown);
  }, [phase, handleTap]);

  useEffect(() => () => {
    const s = stateRef.current;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.renderer) s.renderer.dispose();
    (s as unknown as { _resizeCleanup?: () => void })._resizeCleanup?.();
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="Mentally rotate the shape and tap its matching version!"
          ctaLabel="Rotate! 🔷" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
              { label: 'SCORE', value: scoreDisplay },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Accuracy', value: `${finalSig.total > 0 ? Math.round(finalSig.correct / finalSig.total * 100) : 0}%`, color: ACCENT },
            { label: 'Avg Speed', value: `${finalSig.total > 0 ? Math.round(finalSig.totalMs / finalSig.total) : 0}ms`, color: '#fbbf24' },
            { label: 'Level Reached', value: String(finalSig.level), color: '#4ade80' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.correct >= 10} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const ShapeRotateGame = dynamic(() => Promise.resolve({ default: ShapeRotateGameInner }), { ssr: false });
export default ShapeRotateGame;
