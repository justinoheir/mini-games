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
import { createTiltController } from '@/lib/tilt';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID     = 'harvest-catch';
const ACCENT      = '#d97706';
const DURATION    = 45;
const GAME_EMOJI  = '🍁';
const GAME_TITLE  = 'Harvest Catch';
const GAME_TAGLINE = 'Catch the harvest! Dodge the bad stuff.';

interface Signals { score: number; turkeyCaught: number; negativeItemsCaught: number; maxStreak: number; streakCurrent: number; }
function getPersonality(sig: Signals): string {
  if (sig.score >= 40 && sig.negativeItemsCaught === 0) return 'Harvest Champion 🏆';
  if (sig.turkeyCaught >= 8) return 'Head of the Table 🦃';
  if (sig.negativeItemsCaught >= 5) return 'Picky Eater 🤢';
  if (sig.score >= 20) return 'Grateful Guest 🙏';
  return 'Still Loading Plate 🍽️';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

const ITEM_DEFS = [
  { id: 'turkey', pts: 3, color: 0xb45309, good: true, r: 0.35 },
  { id: 'corn', pts: 1, color: 0xfbbf24, good: true, r: 0.28 },
  { id: 'pie', pts: 2, color: 0xef4444, good: true, r: 0.3 },
  { id: 'leaf', pts: 1, color: 0xf97316, good: true, r: 0.22 },
  { id: 'brussels', pts: -1, color: 0x16a34a, good: false, r: 0.24 },
  { id: 'fruitcake', pts: -2, color: 0x78350f, good: false, r: 0.3 },
];

interface FallingItem3D {
  mesh: THREE.Mesh; light: THREE.PointLight;
  x: number; y: number; z: number;
  vx: number; vy: number;
  points: number; good: boolean; id: number;
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  basketX: number; tiltX: number; frame: number; spawnTimer: number;
  items: FallingItem3D[]; nextId: number;
}

export default function HarvestCatch() {
  const theme        = useBrandTheme();
  const mountRef     = useRef<HTMLDivElement>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const tiltRef      = useRef<ReturnType<typeof createTiltController> | null>(null);
  const touchRef     = useRef<number | null>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, turkeyCaught: 0, negativeItemsCaught: 0, maxStreak: 0, streakCurrent: 0 },
    basketX: 0, tiltX: 0, frame: 0, spawnTimer: 0, items: [], nextId: 0,
  });
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    basket: THREE.Group; basketLight: THREE.PointLight;
    particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number; color: number }>;
    animId: number;
  } | null>(null);

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (tiltRef.current) { tiltRef.current.stop(); tiltRef.current = null; }
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const spawnItem = useCallback((scene: THREE.Scene): FallingItem3D => {
    const s = stateRef.current;
    const def = ITEM_DEFS[Math.floor(Math.random() * ITEM_DEFS.length)];
    const geo = def.id === 'turkey' ? new THREE.BoxGeometry(def.r*2, def.r*1.5, def.r*2) : new THREE.SphereGeometry(def.r, 12, 10);
    const mat = new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: def.good ? 0.2 : 0.1, roughness: 0.5, metalness: 0.2 });
    const mesh = new THREE.Mesh(geo, mat);
    const x = (Math.random() - 0.5) * 7;
    mesh.position.set(x, 7, 0);
    scene.add(mesh);
    const light = new THREE.PointLight(def.color, def.good ? 0.8 : 0.4, 2);
    light.position.set(x, 7, 0);
    scene.add(light);
    const spd = 0.04 + Math.random() * 0.02;
    return { mesh, light, x, y: 7, z: 0, vx: (Math.random()-0.5)*0.02, vy: -spd, points: def.pts, good: def.good, id: s.nextId++ };
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, turkeyCaught: 0, negativeItemsCaught: 0, maxStreak: 0, streakCurrent: 0 };
    s.basketX = 0; s.tiltX = 0; s.frame = 0; s.spawnTimer = 0; s.items = []; s.nextId = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('calm');

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1a0d00);
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a0d00);
    scene.fog = new THREE.Fog(0x1a0d00, 15, 30);
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 12);

    scene.add(new THREE.AmbientLight(0xfff0cc, 0.5));
    const sunLight = new THREE.DirectionalLight(0xffd580, 1.0);
    sunLight.position.set(5, 10, 5);
    scene.add(sunLight);
    const basketLight = new THREE.PointLight(ACCENT, 2, 5);
    scene.add(basketLight);

    // Stars/embers in background
    const starPos = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) { starPos[i*3] = (Math.random()-0.5)*20; starPos[i*3+1] = (Math.random()-0.5)*15; starPos[i*3+2] = -5 - Math.random()*10; }
    const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xf97316, size: 0.04, transparent: true, opacity: 0.25 })));

    // Basket
    const basketGroup = new THREE.Group();
    const basketGeo = new THREE.CylinderGeometry(0.9, 0.7, 0.8, 12);
    const basketMat = new THREE.MeshStandardMaterial({ color: 0x7c3a1a, roughness: 0.8, metalness: 0.1 });
    const basketBody = new THREE.Mesh(basketGeo, basketMat);
    basketGroup.add(basketBody);
    // Basket rim
    const rimGeo = new THREE.TorusGeometry(0.92, 0.07, 8, 24);
    const rim = new THREE.Mesh(rimGeo, new THREE.MeshStandardMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.4, metalness: 0.5 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.4;
    basketGroup.add(rim);
    basketGroup.position.set(0, -4.5, 0);
    scene.add(basketGroup);

    const particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number; color: number }> = [];
    const obj = { renderer, scene, camera, basket: basketGroup, basketLight, particles, animId: 0 };
    threeRef.current = obj;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.success?.(); endGame(); }
    }, 1000);

    // Tilt controller
    const tiltCtrl = createTiltController((x) => { s.tiltX = x; }, { sensitivity: 0.8, clamp: 25, smoothing: 0.45 });
    tiltCtrl.start(); tiltRef.current = tiltCtrl;

    const BASKET_HALF = 0.9, BOUNDS = 4.5, CATCH_Y = -4.0, ITEM_GONE_Y = -6;
    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      if (!s.running) return;
      s.frame++;

      // Move basket
      if (touchRef.current !== null) {
        s.basketX = touchRef.current;
      } else {
        s.basketX += s.tiltX * 0.06;
      }
      s.basketX = Math.max(-BOUNDS, Math.min(BOUNDS, s.basketX));
      basketGroup.position.x = s.basketX;
      basketLight.position.set(s.basketX, -3.5, 1);

      // Spawn items
      s.spawnTimer++;
      const spawnInterval = Math.max(40, 80 - s.sig.turkeyCaught * 2);
      if (s.spawnTimer >= spawnInterval) {
        s.spawnTimer = 0;
        s.items.push(spawnItem(scene));
      }

      // Update items
      for (let i = s.items.length - 1; i >= 0; i--) {
        const item = s.items[i];
        item.y += item.vy;
        item.x += item.vx;
        item.mesh.position.set(item.x, item.y, item.z);
        item.light.position.set(item.x, item.y, 1);
        item.mesh.rotation.x += 0.02; item.mesh.rotation.z += 0.015;

        // Catch check
        if (item.y <= CATCH_Y && item.y >= CATCH_Y - 0.5 && Math.abs(item.x - s.basketX) <= BASKET_HALF + 0.2) {
          // Caught!
          if (item.good) {
            s.sig.score += item.points;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            if (item.mesh.geometry instanceof THREE.BoxGeometry) s.sig.turkeyCaught++;
            setScoreDisplay(s.sig.score);
            sfx.collect?.(); hapticScore();
            // Particles
            for (let p = 0; p < 6; p++) {
              const pGeo = new THREE.SphereGeometry(0.06, 6, 6);
              const pMesh = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9 }));
              pMesh.position.set(item.x, CATCH_Y, 0);
              scene.add(pMesh);
              const angle = (p / 6) * Math.PI * 2;
              particles.push({ mesh: pMesh, vx: Math.cos(angle)*0.06, vy: Math.abs(Math.sin(angle))*0.08+0.04, vz: 0, life: 1, color: ACCENT });
            }
          } else {
            s.sig.score += item.points;
            s.sig.negativeItemsCaught++;
            s.sig.streakCurrent = 0;
            setScoreDisplay(s.sig.score);
            sfx.fail?.(); hapticFail();
          }
          scene.remove(item.mesh); scene.remove(item.light);
          s.items.splice(i, 1); continue;
        }
        if (item.y <= ITEM_GONE_Y) { scene.remove(item.mesh); scene.remove(item.light); s.items.splice(i, 1); }
      }

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.vy -= 0.004; p.life -= 0.04;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, p.life);
        if (p.life <= 0) { scene.remove(p.mesh); particles.splice(i, 1); }
      }

      // Basket sway
      basketGroup.rotation.z = Math.sin(s.frame * 0.04) * 0.04;
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
  }, [endGame, spawnItem]);

  useEffect(() => {
    const mount = mountRef.current; if (!mount || phase !== 'playing') return;
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const rect = mount.getBoundingClientRect();
      const tx = (e.touches[0].clientX - rect.left) / rect.width * 9 - 4.5;
      touchRef.current = tx;
    };
    const onTouchEnd = () => { touchRef.current = null; };
    mount.addEventListener('touchmove', onTouchMove, { passive: false });
    mount.addEventListener('touchend', onTouchEnd);
    return () => { mount.removeEventListener('touchmove', onTouchMove); mount.removeEventListener('touchend', onTouchEnd); };
  }, [phase]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    if (tiltRef.current) tiltRef.current.stop();
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);
  const buildInsights = (sig: Signals) => [
    { label: 'Score', value: String(sig.score), color: ACCENT },
    { label: 'Turkeys', value: String(sig.turkeyCaught), color: '#b45309' },
    { label: 'Bad Caught', value: String(sig.negativeItemsCaught), color: sig.negativeItemsCaught === 0 ? '#4ade80' : '#ef4444' },
    { label: 'Best Streak', value: `×${sig.maxStreak}`, color: '#fbbf24' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Allow Motion & Play" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} sensorNote="Tilt your phone to steer the basket" />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'HARVEST 🍁', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 20} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, turkeyCaught: sig.turkeyCaught, negativeItemsCaught: sig.negativeItemsCaught, maxStreak: sig.maxStreak }, player);
  }, [theme, sig, personality, player]);
  return null;
}
