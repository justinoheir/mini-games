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
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'balloon-pop';
const ACCENT = '#f43f5e';
const DURATION = 30;
const GAME_EMOJI = '🎈';
const GAME_TITLE = 'Balloon Pop';
const GAME_TAGLINE = 'Pinch to pop before they overflow!';

const BALLOON_HEX = [0xf43f5e, 0xf97316, 0xfbbf24, 0x4ade80, 0x06b6d4, 0xa855f7, 0xec4899];

interface BalloonObj {
  id: number; mesh: THREE.Mesh; r: number; maxR: number;
  growing: boolean; popping: boolean; popTimer: number; vy: number;
  worldX: number; worldY: number;
}
interface Signals {
  totalBalloons: number; popped: number; missed: number;
  earlyPops: number; perfectPops: number;
  maxStreak: number; streakCurrent: number; score: number;
}
function getPersonality(sig: Signals): string {
  if (sig.perfectPops >= 5 && sig.maxStreak >= 3) return 'Precision Popper 🎯';
  if (sig.popped >= 15) return 'Pop Maniac 🎈';
  if (sig.earlyPops > sig.popped / 2) return 'Trigger Happy 🚀';
  if (sig.maxStreak >= 4) return 'Combo King 👑';
  return 'Casual Popper 😊';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  balloons: BalloonObj[]; nextId: number; frame: number;
  particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }>;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

function BalloonPopInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { totalBalloons: 0, popped: 0, missed: 0, earlyPops: 0, perfectPops: 0, maxStreak: 0, streakCurrent: 0, score: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    balloons: [], nextId: 0, frame: 0, particles: [],
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

  const spawnBalloon = useCallback((scene: THREE.Scene, s: GS) => {
    const maxR = 0.4 + Math.random() * 0.5;
    const colorHex = BALLOON_HEX[Math.floor(Math.random() * BALLOON_HEX.length)];
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex, emissive: colorHex, emissiveIntensity: 0.3,
      roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.92,
    });
    const geo = new THREE.SphereGeometry(0.1, 16, 16);
    const mesh = new THREE.Mesh(geo, mat);
    const wx = (Math.random() - 0.5) * 8;
    mesh.position.set(wx, -5, (Math.random() - 0.5) * 2);
    scene.add(mesh);
    s.balloons.push({
      id: s.nextId++, mesh, r: 0.1, maxR,
      growing: true, popping: false, popTimer: 0,
      vy: 0.5 + Math.random() * 0.8, worldX: wx, worldY: -5,
    });
    s.sig.totalBalloons++;
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { totalBalloons: 0, popped: 0, missed: 0, earlyPops: 0, perfectPops: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.balloons = []; s.nextId = 0; s.particles = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1a0030);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 2, 10);
    camera.lookAt(0, 2, 0);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x442266, 3));
    const pLight = new THREE.PointLight(0xff44ff, 2, 30);
    pLight.position.set(0, 5, 5);
    scene.add(pLight);
    const pLight2 = new THREE.PointLight(0xff8800, 1.5, 25);
    pLight2.position.set(-5, 0, 5);
    scene.add(pLight2);

    // Confetti particles (static decoration)
    const cCount = 150;
    const cPos = new Float32Array(cCount * 3);
    const cColors = new Float32Array(cCount * 3);
    for (let i = 0; i < cCount; i++) {
      cPos[i * 3] = (Math.random() - 0.5) * 20;
      cPos[i * 3 + 1] = (Math.random()) * 15 - 5;
      cPos[i * 3 + 2] = (Math.random() - 0.5) * 5 - 3;
      const col = new THREE.Color(BALLOON_HEX[i % BALLOON_HEX.length]);
      cColors[i * 3] = col.r; cColors[i * 3 + 1] = col.g; cColors[i * 3 + 2] = col.b;
    }
    const cGeo = new THREE.BufferGeometry();
    cGeo.setAttribute('position', new THREE.BufferAttribute(cPos, 3));
    cGeo.setAttribute('color', new THREE.BufferAttribute(cColors, 3));
    scene.add(new THREE.Points(cGeo, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, opacity: 0.4 })));

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    s.resizeCleanup = () => window.removeEventListener('resize', handleResize);

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;
      const spawnRate = Math.max(20, 60 - s.frame * 0.3);
      if (s.frame % Math.floor(spawnRate) === 0) spawnBalloon(scene, s);

      // Update balloons
      for (let i = s.balloons.length - 1; i >= 0; i--) {
        const b = s.balloons[i];
        if (b.popping) {
          b.popTimer++;
          b.mesh.scale.setScalar(1 + b.popTimer * 0.15);
          const mat = b.mesh.material as THREE.MeshStandardMaterial;
          mat.opacity = Math.max(0, 1 - b.popTimer / 10);
          if (b.popTimer > 10) {
            scene.remove(b.mesh); b.mesh.geometry.dispose(); (b.mesh.material as THREE.Material).dispose();
            s.balloons.splice(i, 1);
          }
          continue;
        }
        b.mesh.position.y += b.vy * 0.03;
        b.worldY += b.vy * 0.03;

        // Grow balloon
        if (b.growing) {
          b.r = Math.min(b.r + 0.005, b.maxR);
          b.mesh.scale.setScalar(b.r / 0.1);
          if (b.r >= b.maxR) b.growing = false;
        }

        // Missed or too big
        if (b.mesh.position.y > 9 || (!b.growing && b.r >= b.maxR * 1.5)) {
          s.sig.missed++; s.sig.streakCurrent = 0;
          hapticFail();
          scene.remove(b.mesh); b.mesh.geometry.dispose(); (b.mesh.material as THREE.Material).dispose();
          s.balloons.splice(i, 1);
        }
      }

      // Pop particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.mesh.position.x += p.vx;
        p.mesh.position.y += p.vy;
        p.mesh.position.z += p.vz;
        p.vy -= 0.01;
        p.life--;
        const mat = p.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = p.life / 20;
        if (p.life <= 0) {
          scene.remove(p.mesh); p.mesh.geometry.dispose();
          s.particles.splice(i, 1);
        }
      }

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, spawnBalloon]);

  // Multi-touch pinch detection
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const rect = mount.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      activePointers.current.set(e.pointerId, { x, y });
      mount.setPointerCapture(e.pointerId);

      if (activePointers.current.size >= 2) {
        const pts = Array.from(activePointers.current.values());
        const s = stateRef.current;
        // Convert screen coords to world-space approx
        const W = mount.clientWidth, H = mount.clientHeight;
        for (const b of s.balloons) {
          if (b.popping) continue;
          const bScreenX = (b.mesh.position.x + 5) / 10;
          const bScreenY = 1 - (b.mesh.position.y - (-5)) / 14;
          let allOn = true;
          for (const pt of pts) {
            const dx = pt.x - bScreenX, dy = pt.y - bScreenY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0.15) { allOn = false; break; }
          }
          if (allOn) {
            b.popping = true; b.popTimer = 0;
            const fullness = b.r / b.maxR;
            const isPerfect = fullness >= 0.85;
            if (isPerfect) s.sig.perfectPops++; else s.sig.earlyPops++;
            s.sig.popped++; s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const pts2 = isPerfect ? 3 : 1;
            const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
            s.sig.score += pts2 * mult;
            setScoreDisplay(s.sig.score);
            sfx.collect(); hapticScore();
            if (s.sig.streakCurrent >= 3) { hapticCombo(s.sig.streakCurrent); sfx.success(); }
            // Spawn pop particles
            const scene = s.scene!;
            const col = (b.mesh.material as THREE.MeshStandardMaterial).color;
            for (let pi = 0; pi < 10; pi++) {
              const pm = new THREE.Mesh(
                new THREE.SphereGeometry(0.06, 4, 4),
                new THREE.MeshBasicMaterial({ color: col.clone(), transparent: true, opacity: 1 })
              );
              pm.position.copy(b.mesh.position);
              scene.add(pm);
              s.particles.push({ mesh: pm, vx: (Math.random() - 0.5) * 0.2, vy: Math.random() * 0.2, vz: (Math.random() - 0.5) * 0.2, life: 20 });
            }
            break;
          }
        }
      }
    };
    const onPointerUp = (e: PointerEvent) => { activePointers.current.delete(e.pointerId); };

    mount.addEventListener('pointerdown', onPointerDown);
    mount.addEventListener('pointerup', onPointerUp);
    mount.addEventListener('pointercancel', onPointerUp);
    return () => {
      mount.removeEventListener('pointerdown', onPointerDown);
      mount.removeEventListener('pointerup', onPointerUp);
      mount.removeEventListener('pointercancel', onPointerUp);
    };
  }, [phase]);

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
          description="Use two fingers to pinch-pop balloons at full size for bonus points!"
          ctaLabel="Pop it! 🎈" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        display: phase === 'playing' ? 'block' : 'none', touchAction: 'none',
      }} />
      {phase === 'playing' && (
        <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 5 },
          { label: 'SCORE', value: scoreDisplay },
        ]} />
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Popped', value: String(finalSig.popped), color: ACCENT },
            { label: 'Perfect Pops', value: String(finalSig.perfectPops), color: '#fbbf24' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' },
            { label: 'Missed', value: String(finalSig.missed), color: '#ef4444' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.popped >= 5} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const BalloonPop = dynamic(() => Promise.resolve({ default: BalloonPopInner }), { ssr: false });
export default BalloonPop;
