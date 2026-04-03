'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticImpact, hapticCelebration } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'bowling-curve';
const ACCENT = '#7c3aed';
const DURATION = 45;
const GAME_EMOJI = '🎳';
const GAME_TITLE = 'Bowling Curve';
const GAME_TAGLINE = 'Hook it. Hit the pocket.';

interface Pin3D { mesh: THREE.Mesh; knocked: boolean; vx: number; vy: number; }
interface Signals { frames: number; strikes: number; spares: number; totalPins: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(sig: Signals): string {
  if (sig.strikes >= 4 && sig.maxStreak >= 3) return 'Perfect Game Pro 🎳';
  if (sig.strikes >= 3) return 'Strike King 👑';
  if (sig.maxStreak >= 4) return 'Pocket Finder 🎯';
  return 'Lane Learner 🌀';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  ball: THREE.Mesh | null; pins: Pin3D[];
  ballActive: boolean; ballX: number; ballZ: number;
  ballVX: number; ballVZ: number; ballSpin: number;
  swipeStartX: number; swipeStartY: number; swiping: boolean;
  settleTimer: number; frame: number;
  particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }>;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

function makePins(scene: THREE.Scene): Pin3D[] {
  const pins: Pin3D[] = [];
  const rows = 4;
  const gap = 0.7;
  for (let r = 0; r < rows; r++) {
    const count = r + 1;
    const startX = -(count - 1) * gap / 2;
    for (let c = 0; c < count; c++) {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.18, 0.7, 10),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.1, emissive: 0xaaaaff, emissiveIntensity: 0.05 })
      );
      mesh.position.set(startX + c * gap, 0.35, -8 + r * gap * 0.6);
      scene.add(mesh);
      pins.push({ mesh, knocked: false, vx: 0, vy: 0 });
    }
  }
  return pins;
}

export default function BowlingCurveGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { frames: 0, strikes: 0, spares: 0, totalPins: 0, maxStreak: 0, streakCurrent: 0, score: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    ball: null, pins: [], ballActive: false,
    ballX: 0, ballZ: 3, ballVX: 0, ballVZ: 0, ballSpin: 0,
    swipeStartX: 0, swipeStartY: 0, swiping: false,
    settleTimer: 0, frame: 0, particles: [],
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

  const resetPins = useCallback((scene: THREE.Scene, s: GS) => {
    s.pins.forEach(p => scene.remove(p.mesh));
    s.pins = makePins(scene);
    s.ballX = 0; s.ballZ = 3; s.ballVX = 0; s.ballVZ = 0; s.ballActive = false;
    if (s.ball) s.ball.position.set(0, 0.2, 3);
    s.settleTimer = 0;
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { frames: 0, strikes: 0, spares: 0, totalPins: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.particles = [];
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
    camera.position.set(0, 3, 9);
    camera.lookAt(0, 0, -3);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x223366, 2));
    const spotLight = new THREE.SpotLight(0xffffff, 3, 30, Math.PI / 4, 0.3);
    spotLight.position.set(0, 8, 0);
    spotLight.target.position.set(0, 0, -5);
    scene.add(spotLight); scene.add(spotLight.target);
    const purpleLight = new THREE.PointLight(0x7c3aed, 1.5, 20);
    purpleLight.position.set(-3, 3, 3);
    scene.add(purpleLight);

    // Lane
    const lane = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, 0.1, 18),
      new THREE.MeshStandardMaterial({ color: 0xcc9944, roughness: 0.7, metalness: 0.1 })
    );
    lane.position.set(0, -0.05, -3);
    scene.add(lane);

    // Lane arrows
    [0, -1, -2].forEach((dz) => {
      const arrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.08, 0.2, 6),
        new THREE.MeshBasicMaterial({ color: 0xcc3300 })
      );
      arrow.rotation.z = Math.PI;
      arrow.position.set(0, 0.05, dz);
      scene.add(arrow);
    });

    // Side gutters
    [-1.4, 1.4].forEach(x => {
      const gutter = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.05, 18),
        new THREE.MeshStandardMaterial({ color: 0x553311, roughness: 0.9 })
      );
      gutter.position.set(x, -0.08, -3);
      scene.add(gutter);
    });

    // Stars
    const sPos = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) {
      sPos[i * 3] = (Math.random() - 0.5) * 30;
      sPos[i * 3 + 1] = Math.random() * 10 + 2;
      sPos[i * 3 + 2] = -15 - Math.random() * 10;
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0x8888ff, size: 0.06 })));

    // Ball
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x7c3aed, emissive: 0x7c3aed, emissiveIntensity: 0.3, roughness: 0.3, metalness: 0.4 })
    );
    ball.position.set(0, 0.2, 3);
    scene.add(ball);
    s.ball = ball;

    s.pins = makePins(scene);
    s.ballX = 0; s.ballZ = 3; s.ballActive = false;

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

      if (s.ballActive && s.ball) {
        s.ballVZ -= 0.12;
        s.ballX += s.ballVX + s.ballSpin * 0.02;
        s.ballZ += s.ballVZ;
        s.ball.position.set(s.ballX, 0.2, s.ballZ);
        s.ball.rotation.x -= 0.1;
        s.ball.rotation.z += s.ballSpin * 0.05;

        // Ball gutter check
        if (Math.abs(s.ballX) > 1.2) {
          s.ballActive = false;
          sfx.collision(); hapticFail();
          s.sig.frames++;
          setTimeout(() => { if (s.running && s.scene) resetPins(s.scene, s); }, 1500);
        }

        // Pin collision
        for (const pin of s.pins) {
          if (pin.knocked) continue;
          const dx = s.ball.position.x - pin.mesh.position.x;
          const dz = s.ball.position.z - pin.mesh.position.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist < 0.45) {
            pin.knocked = true;
            pin.vx = (s.ballVX + s.ballSpin * 0.1) * 0.5 + dx * 0.3;
            pin.vy = 0.08;
            s.sig.totalPins++;
            sfx.collect(); hapticImpact?.();
            // Spawn debris
            for (let pi = 0; pi < 5; pi++) {
              const pm = new THREE.Mesh(
                new THREE.SphereGeometry(0.05, 4, 4),
                new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 })
              );
              pm.position.copy(pin.mesh.position);
              scene.add(pm);
              s.particles.push({ mesh: pm, vx: (Math.random() - 0.5) * 0.1, vy: 0.05 + Math.random() * 0.08, vz: (Math.random() - 0.5) * 0.1, life: 25 });
            }
          }
        }

        // Ball past pins
        if (s.ballZ < -12) {
          s.ballActive = false;
          const knockedCount = s.pins.filter(p => p.knocked).length;
          const isStrike = knockedCount === 10;
          if (isStrike) {
            s.sig.strikes++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            s.sig.score += 30;
            sfx.success(); hapticCelebration?.();
          } else {
            s.sig.streakCurrent = 0;
            s.sig.score += knockedCount;
          }
          s.sig.frames++;
          setScoreDisplay(s.sig.score);
          setTimeout(() => { if (s.running && s.scene) resetPins(s.scene, s); }, 1800);
        }
      }

      // Animate knocked pins
      s.pins.forEach(pin => {
        if (!pin.knocked) return;
        pin.mesh.rotation.z += pin.vx * 0.3;
        pin.mesh.position.x += pin.vx;
        pin.mesh.position.z += pin.vy;
        pin.vy -= 0.003;
        if (pin.mesh.position.y > -2) pin.mesh.position.y -= 0.02;
      });

      // Particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.mesh.position.x += p.vx;
        p.mesh.position.y += p.vy;
        p.mesh.position.z += p.vz;
        p.vy -= 0.005;
        p.life--;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life / 25;
        if (p.life <= 0) { scene.remove(p.mesh); s.particles.splice(i, 1); }
      }

      // Ball idle pulse
      if (!s.ballActive && s.ball) {
        (s.ball.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + Math.sin(Date.now() * 0.004) * 0.1;
      }

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, resetPins]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.ballActive) return;
      const rect = mount.getBoundingClientRect();
      s.swipeStartX = e.clientX - rect.left;
      s.swipeStartY = e.clientY - rect.top;
      s.swiping = true;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.swiping) return;
      s.swiping = false;
      const rect = mount.getBoundingClientRect();
      const dx = (e.clientX - rect.left) - s.swipeStartX;
      const dy = (e.clientY - rect.top) - s.swipeStartY;
      if (Math.abs(dy) > 30 && dy < 0) {
        // Swipe up to throw
        s.ballVX = (dx / rect.width) * 0.3;
        s.ballVZ = -0.15;
        s.ballSpin = dx / rect.width;
        s.ballActive = true;
        sfx.click(); hapticImpact?.();
      }
    };
    mount.addEventListener('pointerdown', onPointerDown);
    mount.addEventListener('pointerup', onPointerUp);
    return () => {
      mount.removeEventListener('pointerdown', onPointerDown);
      mount.removeEventListener('pointerup', onPointerUp);
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
          description="Swipe up to throw the ball. Swipe left/right to curve. Hit the pocket!"
          ctaLabel="Bowl! 🎳" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
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
            { label: 'Strikes', value: String(finalSig.strikes), color: '#fbbf24' },
            { label: 'Pins Knocked', value: String(finalSig.totalPins), color: ACCENT },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' },
            { label: 'Frames', value: String(finalSig.frames), color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.strikes >= 2} />
      )}
    </GameShell>
  );
}
