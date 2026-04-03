'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID  = 'cupid-shot';
const ACCENT   = '#f43f5e';
const DURATION = 45;
const GAME_EMOJI   = '💘';
const GAME_TITLE   = 'Cupid Shot';
const GAME_TAGLINE = 'Tap the heart when it aligns with the bullseye!';

interface Signals {
  totalShots: number; cupidHits: number; loveHits: number; misses: number;
  maxStreak: number; streakCurrent: number; score: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.totalShots > 0 ? (sig.cupidHits + sig.loveHits) / sig.totalShots : 0;
  if (sig.cupidHits >= 6) return "💘 Cupid's Ace";
  if (acc >= 0.7 && sig.maxStreak >= 5) return '💕 Romantic Precision';
  if (acc >= 0.6) return '❤️ Sure Shot';
  if (sig.maxStreak >= 4) return '🔥 On a Roll';
  return '💝 Hopeful';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface HeartTarget {
  id: number;
  mesh: THREE.Group;
  phase: number;
  speed: number;
  yPos: number;
  isGolden: boolean;
  flashTimer: number;
  reloadTimer: number;
}

const TIERS = [
  { maxDist: 0.5,       pts: 5, label: "CUPID'S ARROW 💘", color: '#fbbf24' },
  { maxDist: 1.0,       pts: 3, label: 'LOVE SHOT 💕',     color: '#f43f5e' },
  { maxDist: 1.8,       pts: 1, label: 'CLOSE ❤️',         color: '#fb7185' },
  { maxDist: Infinity,  pts: 0, label: 'MISSED 💔',        color: '#6b7280' },
];

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  animId: number; frame: number;
  targets: HeartTarget[];
  bullseye: THREE.Mesh | null;
  bullseyeX: number;
  nextId: number;
  intervalId: ReturnType<typeof setInterval> | null;
  stopMusic: (() => void) | null;
  particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }>;
  centerLight: THREE.PointLight | null;
  elapsed: number;
}

// Build a heart-shaped mesh using heart curve
function buildHeartMesh(color: number, size = 0.5): THREE.Group {
  const group = new THREE.Group();
  // Approximate heart with two overlapping spheres + triangle
  const sGeo = new THREE.SphereGeometry(size * 0.6, 16, 16);
  const sMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.1 });
  const s1 = new THREE.Mesh(sGeo, sMat);
  s1.position.set(-size * 0.35, size * 0.15, 0);
  const s2 = new THREE.Mesh(sGeo.clone(), sMat.clone());
  s2.position.set(size * 0.35, size * 0.15, 0);
  const cGeo = new THREE.ConeGeometry(size * 0.75, size * 1.2, 3);
  const cMesh = new THREE.Mesh(cGeo, sMat.clone());
  cMesh.rotation.z = Math.PI;
  cMesh.position.set(0, -size * 0.2, 0);
  group.add(s1, s2, cMesh);
  return group;
}

export default function CupidShotGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { totalShots: 0, cupidHits: 0, loveHits: 0, misses: 0, maxStreak: 0, streakCurrent: 0, score: 0 },
    renderer: null, scene: null, camera: null, animId: 0, frame: 0,
    targets: [], bullseye: null, bullseyeX: 0, nextId: 0,
    intervalId: null, stopMusic: null, particles: [], centerLight: null, elapsed: 0,
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
    if (s.stopMusic) { s.stopMusic(); s.stopMusic = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, []);

  const spawnTarget = useCallback((scene: THREE.Scene, s: GS, forceGolden = false) => {
    const isGolden = forceGolden || (s.sig.cupidHits + s.sig.loveHits > 8 && Math.random() < 0.25);
    const color = isGolden ? 0xfbbf24 : 0xf43f5e;
    const mesh = buildHeartMesh(color, 0.45);
    const yPos = -1.5 + Math.random() * 3;
    mesh.position.set(-5, yPos, 0);
    scene.add(mesh);
    const totalTargets = s.targets.length + 1;
    const speed = Math.min(0.06, 0.025 + totalTargets * 0.008 + s.elapsed * 0.0003);
    s.targets.push({ id: s.nextId++, mesh, phase: Math.random() * Math.PI * 2, speed, yPos, isGolden, flashTimer: 0, reloadTimer: 0 });
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = mount.clientWidth || window.innerWidth;
    const H = mount.clientHeight || window.innerHeight;

    s.running = true; s.timeLeft = DURATION; s.frame = 0; s.elapsed = 0;
    s.sig = { totalShots: 0, cupidHits: 0, loveHits: 0, misses: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.targets = []; s.nextId = 0; s.particles = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0d0014);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0d0014, 10, 20);
    s.scene = scene;

    const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 30);
    camera.position.set(0, 0, 12);
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    // Lighting
    scene.add(new THREE.AmbientLight(0x441133, 2.5));
    const centerLight = new THREE.PointLight(0xff4488, 3, 15);
    centerLight.position.set(0, 0, 4);
    scene.add(centerLight);
    s.centerLight = centerLight;
    const rimLight = new THREE.PointLight(0xffaacc, 1.2, 20);
    rimLight.position.set(-5, 5, 3);
    scene.add(rimLight);

    // Bullseye target rings
    const bullseyeGroup = new THREE.Group();
    const rings = [3.5, 2.5, 1.5, 0.7];
    const ringColors = [0x331122, 0x661133, 0xcc2255, 0xf43f5e];
    rings.forEach((r, i) => {
      const geo = new THREE.TorusGeometry(r, 0.06, 8, 40);
      const mat = new THREE.MeshStandardMaterial({ color: ringColors[i], emissive: ringColors[i], emissiveIntensity: i === rings.length - 1 ? 0.8 : 0.2 });
      bullseyeGroup.add(new THREE.Mesh(geo, mat));
    });
    // Center dot
    const dotGeo = new THREE.SphereGeometry(0.2, 12, 12);
    const dotMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 1 });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    bullseyeGroup.add(dot);
    bullseyeGroup.position.set(0, 0, -1);
    scene.add(bullseyeGroup);
    s.bullseye = dot;
    s.bullseyeX = 0;

    // Stars background
    const starCount = 200;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 20;
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 12;
      starPos[i * 3 + 2] = (Math.random() - 0.5) * 8 - 3;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffaacc, size: 0.04, transparent: true, opacity: 0.6 })));

    const onResize = () => {
      const W2 = mount.clientWidth || window.innerWidth;
      const H2 = mount.clientHeight || window.innerHeight;
      renderer.setSize(W2, H2);
      camera.aspect = W2 / H2;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    (s as unknown as { _resizeCleanup: () => void })._resizeCleanup = () => window.removeEventListener('resize', onResize);

    s.stopMusic = startMusic('chill' as import('@/lib/audio').MusicPattern);
    s.intervalId = setInterval(() => {
      s.timeLeft--; s.elapsed++; setTimeLeft(s.timeLeft);
      // Spawn extra hearts over time
      if (s.scene && s.elapsed === 15 && s.targets.length < 2) spawnTarget(s.scene, s);
      if (s.scene && s.elapsed === 30 && s.targets.length < 3) spawnTarget(s.scene, s);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    spawnTarget(scene, s);

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Center light pulse
      if (s.centerLight) s.centerLight.intensity = 2.5 + Math.sin(s.frame * 0.08) * 0.8;

      // Move targets
      s.targets.forEach(t => {
        t.phase += t.speed;
        const x = Math.sin(t.phase) * 4.5;
        t.mesh.position.set(x, t.yPos + Math.cos(t.phase * 0.7) * 0.3, 0);
        t.mesh.rotation.z = Math.sin(t.phase * 0.5) * 0.2;
        t.mesh.scale.setScalar(0.9 + Math.sin(s.frame * 0.1 + t.id) * 0.05);
        if (t.flashTimer > 0) {
          t.flashTimer--;
          t.mesh.children.forEach(c => {
            (c as THREE.Mesh).material && ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity > 0 &&
            (((c as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 1.5 - t.flashTimer * 0.05);
          });
        }
      });

      // Particles
      s.particles = s.particles.filter(p => {
        p.mesh.position.x += p.vx;
        p.mesh.position.y += p.vy;
        p.mesh.position.z += p.vz;
        p.vy -= 0.004;
        p.life--;
        (p.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, p.life / 25);
        if (p.life <= 0) { scene.remove(p.mesh); return false; }
        return true;
      });

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, spawnTarget]);

  const handleTap = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    s.sig.totalShots++;

    let bestTarget: HeartTarget | null = null;
    let bestDist = Infinity;
    s.targets.forEach(t => {
      if (t.reloadTimer > 0) return;
      const dx = t.mesh.position.x - 0;
      const dy = t.mesh.position.y - 0;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) { bestDist = dist; bestTarget = t; }
    });

    const tier = TIERS.find(tr => bestDist <= tr.maxDist) || TIERS[TIERS.length - 1];
    if (tier.pts > 0 && bestTarget) {
      const bt = bestTarget as HeartTarget;
      bt.flashTimer = 20;
      bt.reloadTimer = 30;
      if (tier.pts === 5) s.sig.cupidHits++;
      else if (tier.pts >= 3) s.sig.loveHits++;
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      s.sig.score += tier.pts; setScoreDisplay(s.sig.score);
      sfx.success(); hapticScore();
      // Burst
      if (s.scene) {
        for (let i = 0; i < 10; i++) {
          const pGeo = new THREE.SphereGeometry(0.06, 6, 6);
          const pMat = new THREE.MeshStandardMaterial({ color: 0xf43f5e, emissive: 0xf43f5e, emissiveIntensity: 1.5, transparent: true, opacity: 1 });
          const pMesh = new THREE.Mesh(pGeo, pMat);
          pMesh.position.copy(bt.mesh.position);
          s.scene.add(pMesh);
          const angle = (i / 10) * Math.PI * 2;
          s.particles.push({ mesh: pMesh, vx: Math.cos(angle) * 0.1, vy: 0.12 + Math.random() * 0.08, vz: 0, life: 25 });
        }
      }
    } else {
      s.sig.misses++; s.sig.streakCurrent = 0;
      sfx.collision(); hapticFail();
    }
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      e.preventDefault();
      handleTap();
    };
    mount.addEventListener('pointerdown', onPointerDown);
    return () => mount.removeEventListener('pointerdown', onPointerDown);
  }, [phase, handleTap]);

  useEffect(() => () => {
    const s = stateRef.current;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.stopMusic) s.stopMusic();
    if (s.renderer) s.renderer.dispose();
    (s as unknown as { _resizeCleanup?: () => void })._resizeCleanup?.();
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const buildInsights = (sig: Signals) => {
    const acc = sig.totalShots > 0 ? Math.round((sig.cupidHits + sig.loveHits) / sig.totalShots * 100) : 0;
    return [
      { label: 'Accuracy', value: `${acc}%`, color: acc >= 60 ? '#4ade80' : '#facc15' },
      { label: "Cupid's Arrows", value: String(sig.cupidHits), color: '#fbbf24' },
      { label: 'Love Shots', value: String(sig.loveHits), color: ACCENT },
      { label: 'Best Streak', value: `×${sig.maxStreak}`, color: ACCENT },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Shoot for Love!" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
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
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT}
            onPlayAgain={handlePlayAgain} didWin={finalSig.cupidHits >= 3} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, cupidHits: sig.cupidHits }, player);
  }, [theme, sig, personality, player]);
  return null;
}
