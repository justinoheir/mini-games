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

const GAME_ID = 'sound-garden';
const ACCENT = '#4ade80';
const DURATION = 60;
const GAME_EMOJI = '🌱';
const GAME_TITLE = 'Sound Garden';
const GRID_COLS = 4, GRID_ROWS = 4, CELL_COUNT = GRID_COLS * GRID_ROWS;

const CELL_COLORS_HEX = [
  0x4ade80, 0x22c55e, 0x86efac, 0xbbf7d0,
  0x34d399, 0x6ee7b7, 0xa7f3d0, 0xd1fae5,
  0x10b981, 0x059669, 0x047857, 0x065f46,
  0x2dd4bf, 0x5eead4, 0x99f6e4, 0xccfbf1,
];

interface Plant3D {
  stemMesh: THREE.Mesh; flowerMesh: THREE.Mesh; light: THREE.PointLight;
  growth: number; maxGrowth: number; lastTap: number; wilt: boolean; cellIdx: number;
}

interface Signals { totalTaps: number; plantsFullyGrown: number; wilted: number; score: number; maxStreak: number; streakCurrent: number; }
function getPersonality(sig: Signals): string {
  if (sig.plantsFullyGrown >= 12) return 'Master Gardener 🌺';
  if (sig.wilted === 0 && sig.plantsFullyGrown >= 6) return 'Green Thumb 🌿';
  if (sig.score >= 30) return 'Sprouting Well 🌱';
  return 'New Seedling 🌾';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

export default function SoundGardenGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    plants: [] as Plant3D[],
    groundMesh: null as THREE.Mesh | null,
    running: false, timeLeft: DURATION,
    sig: { totalTaps: 0, plantsFullyGrown: 0, wilted: 0, score: 0, maxStreak: 0, streakCurrent: 0 } as Signals,
    wiltTimer: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    const pb = parseInt(localStorage.getItem('pb_' + GAME_ID) ?? '0');
    if (s.sig.score > pb) localStorage.setItem('pb_' + GAME_ID, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalTaps: 0, plantsFullyGrown: 0, wilted: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.wiltTimer = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x061206);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x061206, 15, 35);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 4, 8);
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x0a1f0a, 3));
    const sunLight = new THREE.DirectionalLight(0x4ade80, 2);
    sunLight.position.set(3, 8, 5);
    scene.add(sunLight);

    // Garden ground (dark soil)
    const groundGeo = new THREE.PlaneGeometry(8, 8, 4, 4);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a0d00, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.3;
    scene.add(ground);
    s.groundMesh = ground;

    // Grid plot markers
    const plotMat = new THREE.MeshStandardMaterial({ color: 0x2d1a00, roughness: 0.95 });
    const spacing = 1.6;
    const offsetX = -(GRID_COLS - 1) * spacing / 2;
    const offsetZ = -(GRID_ROWS - 1) * spacing / 2;
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const x = offsetX + c * spacing;
        const z = offsetZ + r * spacing;
        const plotGeo = new THREE.BoxGeometry(1.3, 0.05, 1.3);
        const plot = new THREE.Mesh(plotGeo, plotMat);
        plot.position.set(x, -0.27, z);
        scene.add(plot);
      }
    }

    // Create plants for each cell
    const plants: Plant3D[] = [];
    for (let i = 0; i < CELL_COUNT; i++) {
      const r = Math.floor(i / GRID_COLS);
      const c = i % GRID_COLS;
      const x = offsetX + c * spacing;
      const z = offsetZ + r * spacing;
      const color = CELL_COLORS_HEX[i];
      const maxGrowth = 50 + Math.random() * 30;
      const stemMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.6 });
      const stemMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1, 6), stemMat);
      stemMesh.scale.y = 0.05;
      stemMesh.position.set(x, -0.25, z);
      scene.add(stemMesh);
      const flowerMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.4 });
      const flowerMesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 10), flowerMat);
      flowerMesh.scale.setScalar(0.05);
      flowerMesh.position.set(x, -0.2, z);
      flowerMesh.visible = false;
      scene.add(flowerMesh);
      const light = new THREE.PointLight(color, 0, 4);
      light.position.set(x, 0.5, z);
      scene.add(light);
      plants.push({ stemMesh, flowerMesh, light, growth: 0, maxGrowth, lastTap: Date.now(), wilt: false, cellIdx: i });
    }
    s.plants = plants;

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    (s as any)._cleanup = () => window.removeEventListener('resize', handleResize);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      s.wiltTimer++;
      // Wilt plants that haven't been watered in 5s
      const now = Date.now();
      s.plants.forEach(p => {
        if (!p.wilt && p.growth > 0 && now - p.lastTap > 5000 && p.growth < p.maxGrowth) {
          p.wilt = true; p.growth = Math.max(0, p.growth - 10);
          s.sig.wilted++; sfx.collision(); hapticFail();
        }
      });
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const t = Date.now() * 0.001;

      plants.forEach(p => {
        const pct = p.growth / p.maxGrowth;
        // Stem
        const stemH = Math.max(0.05, pct);
        p.stemMesh.scale.y = stemH;
        p.stemMesh.position.y = -0.3 + stemH * 0.5;
        const stemMat = p.stemMesh.material as THREE.MeshStandardMaterial;
        stemMat.color.setHex(p.wilt ? 0x7c5e42 : 0x22c55e);
        // Flower
        if (pct > 0.5) {
          p.flowerMesh.visible = true;
          const flowerScale = (pct - 0.5) * 2;
          p.flowerMesh.scale.setScalar(flowerScale * 0.3);
          p.flowerMesh.position.y = -0.3 + stemH + 0.18 * flowerScale;
          p.flowerMesh.rotation.y = t * (0.5 + p.cellIdx * 0.1);
        } else {
          p.flowerMesh.visible = false;
        }
        // Light
        p.light.intensity = pct * 1.5 * (p.wilt ? 0.2 : 1);
        // Wilted lean
        if (p.wilt) p.stemMesh.rotation.z = Math.sin(t + p.cellIdx) * 0.3;
        else p.stemMesh.rotation.z = 0;
      });

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    // Tap handler — raycast to detect which plant was tapped
    const onTap = (e: PointerEvent) => {
      const s2 = stateRef.current;
      if (!s2.running) return;
      const rect = mountRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const plantMeshes = [...plants.map(p => p.stemMesh), ...plants.map(p => p.flowerMesh)];
      const hits = raycaster.intersectObjects(plantMeshes);
      // Also check ground for taps near plants
      const groundHits = raycaster.intersectObject(ground);
      let tapIdx = -1;
      if (hits.length > 0) {
        const hitMesh = hits[0].object;
        tapIdx = plants.findIndex(p => p.stemMesh === hitMesh || p.flowerMesh === hitMesh);
      } else if (groundHits.length > 0) {
        const pt = groundHits[0].point;
        const spacing = 1.6;
        const offsetX = -(GRID_COLS - 1) * spacing / 2;
        const offsetZ = -(GRID_ROWS - 1) * spacing / 2;
        let bestDist = 0.9, bestIdx = -1;
        plants.forEach((p, i) => {
          const r = Math.floor(i / GRID_COLS);
          const c = i % GRID_COLS;
          const px2 = offsetX + c * spacing, pz = offsetZ + r * spacing;
          const d = Math.sqrt((pt.x - px2) ** 2 + (pt.z - pz) ** 2);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        });
        tapIdx = bestIdx;
      }
      if (tapIdx >= 0) {
        const p = plants[tapIdx];
        p.lastTap = Date.now(); p.wilt = false;
        p.growth = Math.min(p.maxGrowth, p.growth + 8);
        s2.sig.totalTaps++; s2.sig.streakCurrent++;
        if (s2.sig.streakCurrent > s2.sig.maxStreak) s2.sig.maxStreak = s2.sig.streakCurrent;
        if (p.growth >= p.maxGrowth && !p.wilt) { s2.sig.plantsFullyGrown++; }
        const pts = Math.round(p.growth / p.maxGrowth * 3) + (s2.sig.streakCurrent >= 5 ? 1 : 0);
        s2.sig.score += pts; setScoreDisplay(s2.sig.score);
        sfx.collect(); hapticScore();
      } else {
        s2.sig.streakCurrent = 0;
      }
    };
    if (mountRef.current) mountRef.current.addEventListener('pointerdown', onTap);
    (s as any)._tapCleanup = () => mountRef.current?.removeEventListener('pointerdown', onTap);
  }, [endGame]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    const s = stateRef.current;
    if (s.renderer) s.renderer.dispose();
    (s as any)._cleanup?.(); (s as any)._tapCleanup?.();
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #061206 0%, #020802 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="Tap 3D plants to water them and help them grow! Don't let them wilt."
          ctaLabel="Start Growing 🌱" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <GameHUD accentColor={accent} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
          { label: 'SCORE', value: scoreDisplay },
        ]} />
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Full Grown', value: String(finalSig.plantsFullyGrown), color: accent },
            { label: 'Wilted', value: String(finalSig.wilted), color: finalSig.wilted === 0 ? '#4ade80' : '#ef4444' },
            { label: 'Total Taps', value: String(finalSig.totalTaps), color: '#fbbf24' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.plantsFullyGrown >= 8} />
      )}
    </GameShell>
  );
}
