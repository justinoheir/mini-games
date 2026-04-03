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

const GAME_ID  = 'snow-catch';
const ACCENT   = '#38bdf8';
const DURATION = 45;
const GAME_EMOJI   = '❄️';
const GAME_TITLE   = 'Snow Catch';
const GAME_TAGLINE = 'Tilt or swipe to catch snowflakes. Avoid icicles!';
const PB_KEY = 'pb_snow-catch';

interface Signals {
  snowflakesCaught: number; goldenCaught: number; iciclesHit: number;
  maxStreak: number; streakCurrent: number; score: number; blizzardBonus: number;
}

function getPersonality(sig: Signals): string {
  if (sig.iciclesHit === 0 && sig.snowflakesCaught >= 15) return '❄️ Blizzard Tamer';
  if (sig.goldenCaught >= 5) return '✨ Gold Rush';
  if (sig.maxStreak >= 8) return '🌨️ Streak Catcher';
  if (sig.snowflakesCaught >= 20) return '☃️ Snow Guardian';
  return '🌬️ Chilly Start';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';
type ItemType = 'snow' | 'golden' | 'icicle';

interface FallingItem {
  mesh: THREE.Mesh; type: ItemType; vy: number; id: number;
  light?: THREE.PointLight;
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  animId: number; frame: number;
  basketMesh: THREE.Group | null;
  basketX: number;
  items: FallingItem[];
  nextItemId: number;
  spawnTimer: number;
  spawnInterval: number;
  blizzardActive: boolean;
  blizzardTimer: number;
  tiltX: number; // device tilt or touch position
  particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }>;
  intervalId: ReturnType<typeof setInterval> | null;
  stopMusic: (() => void) | null;
  snowfield: THREE.Points | null;
  difficultyLevel: number;
}

export default function SnowCatchGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { snowflakesCaught: 0, goldenCaught: 0, iciclesHit: 0, maxStreak: 0, streakCurrent: 0, score: 0, blizzardBonus: 0 },
    renderer: null, scene: null, camera: null, animId: 0, frame: 0,
    basketMesh: null, basketX: 0, items: [], nextItemId: 0,
    spawnTimer: 0, spawnInterval: 60, blizzardActive: false, blizzardTimer: 0,
    tiltX: 0, particles: [], intervalId: null, stopMusic: null, snowfield: null, difficultyLevel: 1,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  const touchXRef = useRef<number | null>(null);
  const tiltCleanupRef = useRef<(() => void) | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (s.stopMusic) { s.stopMusic(); s.stopMusic = null; }
    tiltCleanupRef.current?.();
    try {
      const prev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (s.sig.score > prev) localStorage.setItem(PB_KEY, String(s.sig.score));
    } catch { /* ignore */ }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, []);

  const spawnItem = useCallback((scene: THREE.Scene, s: GS) => {
    const roll = s.blizzardActive ? Math.random() : Math.random();
    let type: ItemType = 'snow';
    if (roll < 0.1) type = 'golden';
    else if (roll < 0.25) type = 'icicle';

    const color = type === 'golden' ? 0xfbbf24 : type === 'icicle' ? 0x93c5fd : 0xffffff;
    let geo: THREE.BufferGeometry;
    if (type === 'icicle') {
      geo = new THREE.ConeGeometry(0.12, 0.6, 6);
    } else if (type === 'golden') {
      geo = new THREE.OctahedronGeometry(0.2);
    } else {
      geo = new THREE.DodecahedronGeometry(0.15, 0);
    }
    const mat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: type === 'golden' ? 0.8 : 0.3,
      roughness: 0.2, metalness: type === 'icicle' ? 0.6 : 0.1,
      transparent: true, opacity: 0.9,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((Math.random() - 0.5) * 8, 7, (Math.random() - 0.5) * 2);
    if (type === 'icicle') mesh.rotation.z = Math.PI;
    scene.add(mesh);

    let light: THREE.PointLight | undefined;
    if (type === 'golden') {
      light = new THREE.PointLight(0xfbbf24, 2, 3);
      light.position.copy(mesh.position);
      scene.add(light);
    }

    const vy = -(0.04 + Math.random() * 0.02 + s.difficultyLevel * 0.008 + (s.blizzardActive ? 0.025 : 0));
    s.items.push({ mesh, type, vy, id: s.nextItemId++, light });
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = mount.clientWidth || window.innerWidth;
    const H = mount.clientHeight || window.innerHeight;

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { snowflakesCaught: 0, goldenCaught: 0, iciclesHit: 0, maxStreak: 0, streakCurrent: 0, score: 0, blizzardBonus: 0 };
    s.items = []; s.nextItemId = 0; s.spawnTimer = 0; s.spawnInterval = 60;
    s.blizzardActive = false; s.blizzardTimer = 0; s.difficultyLevel = 1; s.particles = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a1628);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a1628, 10, 20);
    s.scene = scene;

    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 30);
    camera.position.set(0, 3, 12);
    camera.lookAt(0, 2, 0);
    s.camera = camera;

    // Lighting
    scene.add(new THREE.AmbientLight(0x223344, 2.5));
    const moonLight = new THREE.DirectionalLight(0x88aaff, 1.5);
    moonLight.position.set(-5, 10, 5);
    scene.add(moonLight);
    const rimLight = new THREE.PointLight(0x38bdf8, 1.5, 15);
    rimLight.position.set(0, 8, 3);
    scene.add(rimLight);
    const fillLight = new THREE.PointLight(0x60a5fa, 0.8, 12);
    fillLight.position.set(5, 3, 8);
    scene.add(fillLight);

    // Ground (snow)
    const groundGeo = new THREE.PlaneGeometry(20, 10);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xddefff, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -3;
    scene.add(ground);

    // Trees (background)
    for (let i = 0; i < 8; i++) {
      const treeGeo = new THREE.ConeGeometry(0.5 + Math.random() * 0.3, 2 + Math.random() * 1, 6);
      const treeMat = new THREE.MeshStandardMaterial({ color: 0x0a3d1a, roughness: 0.9 });
      const tree = new THREE.Mesh(treeGeo, treeMat);
      tree.position.set(-9 + i * 2.5, -2.5, -4 + Math.random() * 2);
      scene.add(tree);
      // Snow on tree
      const snowGeo = new THREE.ConeGeometry(0.3, 0.6, 6);
      const snowMat = new THREE.MeshStandardMaterial({ color: 0xeeffff });
      const snowCap = new THREE.Mesh(snowGeo, snowMat);
      snowCap.position.copy(tree.position);
      snowCap.position.y += 0.8;
      scene.add(snowCap);
    }

    // Basket
    const basket = new THREE.Group();
    const basketBodyGeo = new THREE.CylinderGeometry(0.7, 0.5, 0.6, 12, 1, true);
    const basketMat = new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.8, side: THREE.DoubleSide });
    basket.add(new THREE.Mesh(basketBodyGeo, basketMat));
    const rimGeo = new THREE.TorusGeometry(0.7, 0.05, 8, 20);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xb45309, metalness: 0.3 });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.y = 0.3;
    basket.add(rim);
    basket.position.set(0, -2.5, 0);
    scene.add(basket);
    s.basketMesh = basket;
    s.basketX = 0;

    // Snowfield particles background
    const snowCount = 150;
    const snowGeo = new THREE.BufferGeometry();
    const snowPos = new Float32Array(snowCount * 3);
    for (let i = 0; i < snowCount; i++) {
      snowPos[i * 3] = (Math.random() - 0.5) * 14;
      snowPos[i * 3 + 1] = (Math.random() - 0.5) * 12 + 2;
      snowPos[i * 3 + 2] = (Math.random() - 0.5) * 6 - 2;
    }
    snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
    const snowPoints = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0.5 }));
    scene.add(snowPoints);
    s.snowfield = snowPoints;

    // Device tilt (DeviceOrientation)
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (!s.running) return;
      const gamma = e.gamma ?? 0;
      s.tiltX = Math.max(-1, Math.min(1, gamma / 30));
    };
    window.addEventListener('deviceorientation', onOrientation);
    tiltCleanupRef.current = () => window.removeEventListener('deviceorientation', onOrientation);

    // Resize
    const onResize = () => {
      const W2 = mount.clientWidth || window.innerWidth;
      const H2 = mount.clientHeight || window.innerHeight;
      renderer.setSize(W2, H2);
      camera.aspect = W2 / H2;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    const prevCleanup = tiltCleanupRef.current;
    tiltCleanupRef.current = () => { prevCleanup?.(); window.removeEventListener('resize', onResize); };

    s.stopMusic = startMusic('winter' as import('@/lib/audio').MusicPattern);
    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      s.difficultyLevel = 1 + Math.floor((DURATION - s.timeLeft) / 10);
      s.spawnInterval = Math.max(25, 60 - s.difficultyLevel * 8);
      // Blizzard at 22s elapsed
      const elapsed = DURATION - s.timeLeft;
      if (elapsed === 22 && !s.blizzardActive) {
        s.blizzardActive = true; s.blizzardTimer = 5;
        sfx.collect(); haptic([30, 50, 30]);
      }
      if (s.blizzardTimer > 0) { s.blizzardTimer--; if (s.blizzardTimer === 0) s.blizzardActive = false; }
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Move basket
      if (touchXRef.current !== null) {
        const frac = (touchXRef.current / (W)) * 2 - 1;
        s.basketX = frac * 3.8;
        s.tiltX = frac;
      } else {
        s.basketX = s.tiltX * 3.8;
      }
      if (s.basketMesh) {
        s.basketMesh.position.x += (s.basketX - s.basketMesh.position.x) * 0.2;
        s.basketMesh.rotation.z = s.tiltX * 0.15;
      }

      // Spawn items
      s.spawnTimer++;
      if (s.spawnTimer >= s.spawnInterval) {
        s.spawnTimer = 0;
        spawnItem(scene, s);
        if (s.blizzardActive) spawnItem(scene, s);
      }

      // Snowfield drift
      if (s.snowfield) {
        s.snowfield.position.y -= 0.008;
        if (s.snowfield.position.y < -6) s.snowfield.position.y = 0;
      }

      // Update items
      s.items = s.items.filter(item => {
        item.mesh.position.y += item.vy;
        item.mesh.rotation.y += 0.03;
        item.mesh.rotation.x += 0.02;
        if (item.light) item.light.position.copy(item.mesh.position);

        // Check basket collision
        const bx = s.basketMesh ? s.basketMesh.position.x : 0;
        const dx = Math.abs(item.mesh.position.x - bx);
        const dy = Math.abs(item.mesh.position.y - (-2.5));
        if (dx < 0.8 && dy < 0.6) {
          if (item.type === 'icicle') {
            s.sig.iciclesHit++; s.sig.streakCurrent = 0;
            sfx.collision(); hapticFail();
            s.sig.score = Math.max(0, s.sig.score - 2);
          } else {
            const pts = item.type === 'golden' ? 3 : 1;
            if (item.type === 'golden') s.sig.goldenCaught++;
            else s.sig.snowflakesCaught++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            s.sig.score += pts * (s.blizzardActive ? 2 : 1);
            setScoreDisplay(s.sig.score);
            sfx.collect(); hapticScore();
            // Burst
            for (let pi = 0; pi < 6; pi++) {
              const pGeo = new THREE.SphereGeometry(0.05, 6, 6);
              const pMat = new THREE.MeshStandardMaterial({ color: item.type === 'golden' ? 0xfbbf24 : 0x38bdf8, emissive: item.type === 'golden' ? 0xfbbf24 : 0x38bdf8, emissiveIntensity: 1, transparent: true, opacity: 1 });
              const pMesh = new THREE.Mesh(pGeo, pMat);
              pMesh.position.copy(item.mesh.position);
              scene.add(pMesh);
              const angle = (pi / 6) * Math.PI * 2;
              s.particles.push({ mesh: pMesh, vx: Math.cos(angle) * 0.1, vy: 0.1, vz: 0, life: 20 });
            }
          }
          if (item.light) scene.remove(item.light);
          scene.remove(item.mesh);
          item.mesh.geometry.dispose();
          (item.mesh.material as THREE.Material).dispose();
          return false;
        }

        // Off screen
        if (item.mesh.position.y < -4) {
          if (item.type !== 'icicle') {
            s.sig.streakCurrent = 0;
          }
          if (item.light) scene.remove(item.light);
          scene.remove(item.mesh);
          return false;
        }
        return true;
      });

      // Particles
      s.particles = s.particles.filter(p => {
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.vy -= 0.005; p.life--;
        (p.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, p.life / 20);
        if (p.life <= 0) { scene.remove(p.mesh); return false; }
        return true;
      });

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, spawnItem]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const onMove = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      touchXRef.current = e.clientX;
    };
    const onUp = () => { touchXRef.current = null; };
    mount.addEventListener('pointermove', onMove);
    mount.addEventListener('pointerup', onUp);
    mount.addEventListener('pointercancel', onUp);
    return () => {
      mount.removeEventListener('pointermove', onMove);
      mount.removeEventListener('pointerup', onUp);
      mount.removeEventListener('pointercancel', onUp);
    };
  }, [phase]);

  useEffect(() => () => {
    const s = stateRef.current;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.stopMusic) s.stopMusic();
    if (s.renderer) s.renderer.dispose();
    tiltCleanupRef.current?.();
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const buildInsights = (sig: Signals) => [
    { label: 'Snowflakes', value: String(sig.snowflakesCaught), color: ACCENT },
    { label: 'Golden', value: `✨${sig.goldenCaught}`, color: '#fbbf24' },
    { label: 'Icicles Hit', value: String(sig.iciclesHit), color: sig.iciclesHit === 0 ? '#4ade80' : '#ef4444' },
    { label: 'Best Streak', value: `×${sig.maxStreak}`, color: ACCENT },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Let it Snow!" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
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
            onPlayAgain={handlePlayAgain} didWin={finalSig.snowflakesCaught >= 10} />
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
    postWebhook(theme, GAME_ID, { personality, score: sig.score, snowflakesCaught: sig.snowflakesCaught, goldenCaught: sig.goldenCaught, iciclesHit: sig.iciclesHit }, player);
  }, [theme, sig, personality, player]);
  return null;
}
