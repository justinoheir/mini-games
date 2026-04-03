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

const GAME_ID = 'odd-one-out';
const ACCENT = '#f97316';
const DURATION = 45;
const GAME_EMOJI = '🔍';
const GAME_TITLE = 'Odd One Out';
const GAME_TAGLINE = "Spot what doesn't belong. Quick!";

interface Signals {
  total: number; correct: number; wrong: number;
  avgReactionMs: number; totalMs: number; hardestLevel: number;
  score: number; maxStreak: number; streakCurrent: number;
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const acc = sig.total > 0 ? sig.correct / sig.total : 0;
  const avg = sig.total > 0 ? sig.totalMs / sig.total : 9999;
  if (acc >= 0.9 && avg < 800) return 'Pattern Master 🔍';
  if (sig.hardestLevel >= 5) return 'Detail Detective 🕵️';
  if (acc >= 0.8) return 'Sharp Observer 👁️';
  if (avg < 1000) return 'Fast Finder ⚡';
  return 'Training Vision 🔮';
}

const COLORS_HEX = [0x3b82f6, 0xef4444, 0x22c55e, 0xeab308, 0xa855f7, 0xf97316];
const GEOMETRIES = ['sphere', 'box', 'cone', 'octahedron', 'torus'];

function makeGeometry(type: string): THREE.BufferGeometry {
  switch (type) {
    case 'box': return new THREE.BoxGeometry(0.7, 0.7, 0.7);
    case 'cone': return new THREE.ConeGeometry(0.4, 0.8, 8);
    case 'octahedron': return new THREE.OctahedronGeometry(0.45);
    case 'torus': return new THREE.TorusGeometry(0.3, 0.12, 8, 16);
    default: return new THREE.SphereGeometry(0.4, 16, 16);
  }
}

interface PuzzleItem { geoType: string; color: number; scale: number; rotation: number; isOdd: boolean; }

function generatePuzzle(level: number): PuzzleItem[] {
  const GRID = 9; // 3x3
  const diffType = ['color', 'shape', 'size', 'rotation'][Math.min(level - 1, 3)];
  const baseGeo = GEOMETRIES[Math.floor(Math.random() * GEOMETRIES.length)];
  const baseColor = COLORS_HEX[Math.floor(Math.random() * COLORS_HEX.length)];
  const oddIdx = Math.floor(Math.random() * GRID);
  const items: PuzzleItem[] = [];
  for (let i = 0; i < GRID; i++) {
    const isOdd = i === oddIdx;
    let geoType = baseGeo, color = baseColor, scale = 1, rotation = 0;
    if (isOdd) {
      if (diffType === 'color') {
        const others = COLORS_HEX.filter(c => c !== baseColor);
        color = others[Math.floor(Math.random() * others.length)];
      } else if (diffType === 'shape') {
        const others = GEOMETRIES.filter(g => g !== baseGeo);
        geoType = others[Math.floor(Math.random() * others.length)];
      } else if (diffType === 'size') {
        scale = 1.7;
      } else {
        rotation = Math.PI / 3;
      }
    }
    items.push({ geoType, color, scale, rotation, isOdd });
  }
  return items;
}

export default function OddOneOutGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { total: 0, correct: 0, wrong: 0, avgReactionMs: 0, totalMs: 0, hardestLevel: 1, score: 0, maxStreak: 0, streakCurrent: 0 } as Signals,
    level: 1, puzzleStart: 0, answered: false, puzzle: [] as PuzzleItem[],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);

  useEffect(() => { /* accent sync */ }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    hapticVictory();
    if (s.sig.total > 0) s.sig.avgReactionMs = s.sig.totalMs / s.sig.total;
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const buildPuzzle = useCallback(() => {
    const s = stateRef.current;
    const scene = sceneRef.current; if (!scene) return;
    // Remove old meshes
    meshesRef.current.forEach(m => scene.remove(m));
    meshesRef.current = [];
    const puzzle = generatePuzzle(s.level);
    s.puzzle = puzzle;
    s.puzzleStart = Date.now();
    s.answered = false;
    // 3x3 grid layout
    const spacing = 2.2;
    const offset = spacing;
    puzzle.forEach((item, i) => {
      const col = i % 3 - 1;
      const row = Math.floor(i / 3) - 1;
      const geo = makeGeometry(item.geoType);
      const mat = new THREE.MeshStandardMaterial({ color: item.color, emissive: new THREE.Color(item.color).multiplyScalar(0.15), roughness: 0.4, metalness: 0.5 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(col * spacing, -row * spacing, 0);
      mesh.scale.setScalar(item.scale);
      mesh.rotation.z = item.rotation;
      mesh.userData = { isOdd: item.isOdd, idx: i };
      scene.add(mesh);
      meshesRef.current.push(mesh);
    });
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.level = 1;
    s.sig = { total: 0, correct: 0, wrong: 0, avgReactionMs: 0, totalMs: 0, hardestLevel: 1, score: 0, maxStreak: 0, streakCurrent: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a1a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 10);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x334, 2));
    const pl = new THREE.PointLight(0xf97316, 60, 30);
    pl.position.set(3, 3, 8);
    scene.add(pl);
    const pl2 = new THREE.PointLight(0x6366f1, 40, 20);
    pl2.position.set(-3, -2, 6);
    scene.add(pl2);

    // Subtle particle field
    const starGeo = new THREE.BufferGeometry();
    const sp = new Float32Array(600);
    for (let i = 0; i < 600; i += 3) { sp[i] = (Math.random()-0.5)*40; sp[i+1] = (Math.random()-0.5)*40; sp[i+2] = (Math.random()-0.5)*10-8; }
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06 })));

    buildPuzzle();

    const raycaster = new THREE.Raycaster();
    const onTap = (e: PointerEvent) => {
      if (!s.running || s.answered) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(meshesRef.current);
      if (!hits.length) return;
      const obj = hits[0].object as THREE.Mesh;
      const { isOdd } = obj.userData as { isOdd: boolean };
      s.answered = true;
      const rt = Date.now() - s.puzzleStart;
      s.sig.total++; s.sig.totalMs += rt;
      if (isOdd) {
        s.sig.correct++; s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const pts = Math.max(1, 3 - Math.floor(rt / 1000));
        s.sig.score += pts; setScoreDisplay(s.sig.score);
        (obj.material as THREE.MeshStandardMaterial).emissive.set(0x4ade80);
        (obj.material as THREE.MeshStandardMaterial).emissiveIntensity = 2;
        sfx.collect(); hapticScore();
        s.level = Math.min(6, s.level + 1);
        if (s.level > s.sig.hardestLevel) s.sig.hardestLevel = s.level;
      } else {
        s.sig.wrong++; s.sig.streakCurrent = 0;
        (obj.material as THREE.MeshStandardMaterial).emissive.set(0xef4444);
        (obj.material as THREE.MeshStandardMaterial).emissiveIntensity = 2;
        sfx.collision(); hapticFail();
        s.sig.score = Math.max(0, s.sig.score - 1); setScoreDisplay(s.sig.score);
      }
      setTimeout(() => { if (s.running) buildPuzzle(); }, 600);
    };
    renderer.domElement.addEventListener('pointerdown', onTap);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    let t = 0;
    const loop = () => {
      if (!s.running) return;
      animRef.current = requestAnimationFrame(loop);
      t += 0.01;
      meshesRef.current.forEach((m, i) => { m.rotation.y += 0.012; m.position.y += Math.sin(t + i) * 0.003; });
      pl.position.x = Math.sin(t * 0.5) * 4;
      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => { renderer.domElement.removeEventListener('pointerdown', onTap); };
  }, [endGame, buildPuzzle]);

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
      background="radial-gradient(ellipse at 50% 30%, rgba(249,115,22,0.1) 0%, transparent 60%), linear-gradient(180deg, #0a0a1a 0%, #050510 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Find It!" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={accent} items={[
              { label: 'TIME', value: timeLeft, danger: timeLeft <= 10, testId: 'timer' },
              { label: 'SCORE', value: scoreDisplay, testId: 'score' },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Correct', value: `${finalSig.correct}/${finalSig.total}`, color: '#4ade80' },
            { label: 'Avg Speed', value: finalSig.total > 0 ? `${Math.round(finalSig.totalMs/finalSig.total)}ms` : '—', color: accent },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
            { label: 'Hardest Level', value: `Lv ${finalSig.hardestLevel}`, color: accent },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.correct >= 8} />
      )}
    </GameShell>
  );
}
