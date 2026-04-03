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

const GAME_ID = 'chain-reaction';
const ACCENT = '#fb7185';
const DURATION = 30;
const GAME_EMOJI = '💥';
const GAME_TITLE = 'Chain Reaction';
const GAME_TAGLINE = 'One tap. Maximum chaos.';

const CELL_HEX = [0xfb7185, 0xf43f5e, 0xef4444, 0xfbbf24, 0xf97316, 0xa855f7];

interface Cell3D { mesh: THREE.Mesh; active: boolean; exploding: boolean; explodeRadius: number; mass: number; x: number; y: number; z: number; }
interface Signals { totalTaps: number; maxChain: number; totalExploded: number; perfectRounds: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(sig: Signals): string {
  if (sig.maxChain >= 20 && sig.perfectRounds >= 2) return 'Nuclear Genius 💥';
  if (sig.maxChain >= 15) return 'Chain Master 🔗';
  if (sig.maxStreak >= 4) return 'Combo Starter 🚀';
  if (sig.totalExploded >= 50) return 'Demolisher 🧨';
  return 'Spark Plug ⚡';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  cells: Cell3D[]; exploding: boolean; chainCount: number;
  roundActive: boolean; roundResult: number; frame: number;
  shockwaves: Array<{ mesh: THREE.Mesh; r: number; maxR: number; life: number }>;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

const GRID_W = 5; const GRID_H = 5;
const CELL_SPACING = 1.3;

function buildGrid(scene: THREE.Scene): Cell3D[] {
  const cells: Cell3D[] = [];
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const mass = 1 + Math.floor(Math.random() * 3);
      const colorHex = CELL_HEX[Math.floor(Math.random() * CELL_HEX.length)];
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.35 + mass * 0.08, 16, 16),
        new THREE.MeshStandardMaterial({
          color: colorHex, emissive: colorHex, emissiveIntensity: 0.3,
          roughness: 0.3, metalness: 0.2
        })
      );
      const wx = (gx - (GRID_W - 1) / 2) * CELL_SPACING;
      const wy = (gy - (GRID_H - 1) / 2) * CELL_SPACING;
      const wz = (Math.random() - 0.5) * 0.5;
      mesh.position.set(wx, wy, wz);
      scene.add(mesh);
      cells.push({ mesh, active: true, exploding: false, explodeRadius: 0, mass, x: wx, y: wy, z: wz });
    }
  }
  return cells;
}

export default function ChainReactionGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { totalTaps: 0, maxChain: 0, totalExploded: 0, perfectRounds: 0, maxStreak: 0, streakCurrent: 0, score: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    cells: [], exploding: false, chainCount: 0, roundActive: false, roundResult: 0, frame: 0,
    shockwaves: [],
    intervalId: null, resizeCleanup: null,
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
    s.resizeCleanup?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done'); hapticVictory();
  }, []);

  const resetRound = useCallback((scene: THREE.Scene, s: GS) => {
    // Remove old cells
    s.cells.forEach(c => { scene.remove(c.mesh); c.mesh.geometry.dispose(); (c.mesh.material as THREE.Material).dispose(); });
    s.cells = buildGrid(scene);
    s.exploding = false; s.chainCount = 0; s.roundActive = false; s.roundResult = 0;
  }, []);

  const explodeCell = useCallback((cell: Cell3D, s: GS, scene: THREE.Scene, depth: number) => {
    if (!cell.active || cell.exploding) return;
    cell.exploding = true;
    cell.active = false;
    s.chainCount++;
    s.sig.totalExploded++;

    // Spawn shockwave
    const sw = new THREE.Mesh(
      new THREE.TorusGeometry(0.1, 0.05, 6, 20),
      new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.8 })
    );
    sw.position.copy(cell.mesh.position);
    scene.add(sw);
    s.shockwaves.push({ mesh: sw, r: 0.1, maxR: 0.5 + cell.mass * 0.3, life: 20 });

    // After animation, propagate to nearby cells
    setTimeout(() => {
      if (!s.running) return;
      const range = 0.9 + cell.mass * 0.3;
      for (const other of s.cells) {
        if (!other.active || other.exploding) continue;
        const dx = other.x - cell.x, dy = other.y - cell.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < range) {
          setTimeout(() => explodeCell(other, s, scene, depth + 1), 80);
        }
      }
    }, 150);
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { totalTaps: 0, maxChain: 0, totalExploded: 0, perfectRounds: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.shockwaves = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a1a);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a1a, 0.03);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 9);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x221111, 2.5));
    const pinkLight = new THREE.PointLight(0xfb7185, 2, 20);
    pinkLight.position.set(0, 3, 4);
    scene.add(pinkLight);
    const purpleLight = new THREE.PointLight(0xa855f7, 1.5, 15);
    purpleLight.position.set(-4, -2, 3);
    scene.add(purpleLight);

    // Grid background glow
    const bgGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshBasicMaterial({ color: 0x110018, transparent: true, opacity: 0.8 })
    );
    bgGlow.position.z = -1;
    scene.add(bgGlow);

    // Grid lines
    for (let i = 0; i <= GRID_W; i++) {
      const vLine = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, GRID_H * CELL_SPACING + 0.5, 0.02),
        new THREE.MeshBasicMaterial({ color: 0x332255, transparent: true, opacity: 0.4 })
      );
      vLine.position.set((i - GRID_W / 2) * CELL_SPACING, 0, -0.5);
      scene.add(vLine);
    }
    for (let i = 0; i <= GRID_H; i++) {
      const hLine = new THREE.Mesh(
        new THREE.BoxGeometry(GRID_W * CELL_SPACING + 0.5, 0.02, 0.02),
        new THREE.MeshBasicMaterial({ color: 0x332255, transparent: true, opacity: 0.4 })
      );
      hLine.position.set(0, (i - GRID_H / 2) * CELL_SPACING, -0.5);
      scene.add(hLine);
    }

    // Star particles
    const sPos = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) {
      sPos[i * 3] = (Math.random() - 0.5) * 20;
      sPos[i * 3 + 1] = (Math.random() - 0.5) * 12;
      sPos[i * 3 + 2] = -8 - Math.random() * 8;
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0xaa88ff, size: 0.05, transparent: true, opacity: 0.4 })));

    s.cells = buildGrid(scene);

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    s.resizeCleanup = () => window.removeEventListener('resize', handleResize);

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--; setTimeLeft(s.timeLeft);
      // Check if round done
      if (s.roundActive && s.cells.every(c => !c.active)) {
        const chainCount = s.chainCount;
        if (chainCount > s.sig.maxChain) s.sig.maxChain = chainCount;
        const isPerfect = chainCount >= GRID_W * GRID_H * 0.8;
        if (isPerfect) s.sig.perfectRounds++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const pts = chainCount * 2;
        s.sig.score += pts; setScoreDisplay(s.sig.score);
        sfx.success?.();
        setTimeout(() => { if (s.running && s.scene) resetRound(s.scene, s); }, 1000);
      }
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Animate cells
      s.cells.forEach((c, i) => {
        if (!c.active && !c.exploding) {
          c.mesh.visible = false;
          return;
        }
        if (c.exploding) {
          c.explodeRadius = Math.min(c.explodeRadius + 0.05, 1.5);
          c.mesh.scale.setScalar(1 + c.explodeRadius);
          const mat = c.mesh.material as THREE.MeshStandardMaterial;
          mat.opacity = Math.max(0, 1 - c.explodeRadius / 1.5);
          mat.transparent = true;
          mat.emissiveIntensity = 1.5;
          if (c.explodeRadius >= 1.5) {
            c.mesh.visible = false;
            c.exploding = false;
          }
        } else {
          // Idle pulse
          c.mesh.rotation.y += 0.01;
          c.mesh.position.y = c.y + Math.sin(Date.now() * 0.002 + i * 0.3) * 0.05;
          const mat = c.mesh.material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = 0.2 + Math.sin(Date.now() * 0.004 + i) * 0.1;
        }
      });

      // Shockwaves
      for (let i = s.shockwaves.length - 1; i >= 0; i--) {
        const sw = s.shockwaves[i];
        sw.r += (sw.maxR - sw.r) * 0.2;
        sw.mesh.scale.setScalar(sw.r / 0.1);
        sw.life--;
        (sw.mesh.material as THREE.MeshBasicMaterial).opacity = sw.life / 20 * 0.8;
        if (sw.life <= 0) { scene.remove(sw.mesh); s.shockwaves.splice(i, 1); }
      }

      // Camera subtle drift
      camera.position.x = Math.sin(Date.now() * 0.0003) * 0.3;

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, resetRound, explodeCell]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.exploding || s.roundActive || !s.camera) return;
      const rect = mount.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(nx, ny), s.camera);
      const activeMeshes = s.cells.filter(c => c.active).map(c => c.mesh);
      const hits = raycaster.intersectObjects(activeMeshes);
      if (hits.length > 0) {
        const hitCell = s.cells.find(c => c.mesh === hits[0].object);
        if (hitCell && hitCell.active) {
          s.roundActive = true;
          s.sig.totalTaps++;
          s.chainCount = 0;
          sfx.collect?.(); hapticScore?.();
          if (s.scene) explodeCell(hitCell, s, s.scene, 0);
        }
      }
    };
    mount.addEventListener('pointerdown', onPointerDown);
    return () => mount.removeEventListener('pointerdown', onPointerDown);
  }, [phase, explodeCell]);

  useEffect(() => () => {
    const s = stateRef.current;
    s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    s.resizeCleanup?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="Tap the biggest cluster to start the chain! Max chain = max points."
          ctaLabel="Explode! 💥" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        display: phase === 'playing' ? 'block' : 'none', touchAction: 'none',
      }} />
      {phase === 'playing' && (
        <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
          { label: 'SCORE', value: scoreDisplay },
        ]} />
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Max Chain', value: String(finalSig.maxChain), color: ACCENT },
            { label: 'Total Exploded', value: String(finalSig.totalExploded), color: '#fbbf24' },
            { label: 'Perfect Rounds', value: String(finalSig.perfectRounds), color: '#4ade80' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.maxChain >= 10} />
      )}
    </GameShell>
  );
}
