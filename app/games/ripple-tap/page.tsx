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

const GAME_ID = 'ripple-tap';
const ACCENT = '#06b6d4';
const DURATION = 30;
const GAME_EMOJI = '💧';
const GAME_TITLE = 'Ripple Tap';

interface Ripple3D {
  id: number; x: number; y: number; r: number; maxR: number; growing: boolean;
  spawnTime: number; color: number; alpha: number; tapped: boolean;
  rings: THREE.Mesh[]; indicator: THREE.Mesh;
}

interface Signals {
  totalRipples: number; perfect: number; early: number; late: number;
  maxStreak: number; streakCurrent: number; score: number;
}

function getPersonality(sig: Signals): string {
  const perf = sig.totalRipples > 0 ? sig.perfect / sig.totalRipples : 0;
  if (perf >= 0.7 && sig.maxStreak >= 4) return 'Zen Master 🧘';
  if (sig.perfect >= 10) return 'Perfect Timing ⏱️';
  if (sig.maxStreak >= 5) return 'On the Wave 🌊';
  if (perf >= 0.4) return 'Getting There 📈';
  return 'Learning the Flow 💧';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

const RIPPLE_COLORS_HEX = [0x06b6d4, 0x3b82f6, 0x8b5cf6, 0xec4899, 0x10b981];

export default function RippleTap() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    running: false, timeLeft: DURATION,
    sig: { totalRipples: 0, perfect: 0, early: 0, late: 0, maxStreak: 0, streakCurrent: 0, score: 0 } as Signals,
    ripples: [] as Ripple3D[],
    nextId: 0, spawnFrame: 0, frame: 0,
    floatMeshes: [] as { mesh: THREE.Mesh; vy: number; life: number }[],
    waterPlane: null as THREE.Mesh | null,
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
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, []);

  const spawnRipple3D = useCallback((scene: THREE.Scene) => {
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;
    // Convert screen to world coords (approximate for 3D plane at z=0)
    const margin = 80;
    const sx = margin + Math.random() * (W - margin * 2);
    const sy = margin + Math.random() * (H - margin * 2);
    // Map to world space (camera at z=6, fov 65, plane at z=0)
    const aspect = W / H;
    const halfH = Math.tan((65 / 2) * Math.PI / 180) * 6;
    const halfW = halfH * aspect;
    const wx = ((sx / W) * 2 - 1) * halfW;
    const wy = -((sy / H) * 2 - 1) * halfH;
    const maxR = 0.8 + Math.random() * 1.0;
    const colorHex = RIPPLE_COLORS_HEX[Math.floor(Math.random() * RIPPLE_COLORS_HEX.length)];
    const rings: THREE.Mesh[] = [];
    for (let ring = 0; ring < 3; ring++) {
      const geo = new THREE.TorusGeometry(0.1, 0.03 - ring * 0.008, 8, 32);
      const mat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 0.6, transparent: true, opacity: 1 - ring * 0.25 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(wx, wy, 0);
      scene.add(m);
      rings.push(m);
    }
    // Center indicator dot
    const indGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const indMat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 0.8, transparent: true, opacity: 0 });
    const ind = new THREE.Mesh(indGeo, indMat);
    ind.position.set(wx, wy, 0.1);
    scene.add(ind);

    s.ripples.push({ id: s.nextId++, x: sx, y: sy, r: 0.1, maxR, growing: true,
      spawnTime: Date.now(), color: colorHex, alpha: 1, tapped: false, rings, indicator: ind });
    s.sig.totalRipples++;
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalRipples: 0, perfect: 0, early: 0, late: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.ripples = []; s.nextId = 0; s.frame = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000d1a);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 6);
    // === POLISH: Enhanced rim + fill lighting ===
    const rimLightA = new THREE.PointLight(0x4466ff, 1.2, 20);
    rimLightA.position.set(-6, 5, 3);
    scene.add(rimLightA);
    const fillLightB = new THREE.PointLight(0xff6644, 0.8, 15);
    fillLightB.position.set(6, -3, 5);
    scene.add(fillLightB);
    // === END POLISH ===
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x001a26, 3));
    const ptLight = new THREE.PointLight(0x06b6d4, 2, 20);
    ptLight.position.set(0, 3, 4);
    scene.add(ptLight);

    // Underwater caustic grid
    const gridHelper = new THREE.GridHelper(20, 20, 0x06b6d430, 0x06b6d415);
    gridHelper.rotation.x = Math.PI / 2;
    scene.add(gridHelper);

    // Water shimmer plane
    const waterGeo = new THREE.PlaneGeometry(20, 20, 32, 32);
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x001a26, transparent: true, opacity: 0.7, wireframe: false });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.z = -0.2;
    scene.add(water);
    s.waterPlane = water;

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    (s as any)._cleanup = () => window.removeEventListener('resize', handleResize);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    spawnRipple3D(scene);

    const growSpeed = 0.012, shrinkSpeed = 0.01;

    const loop = () => {
      if (!s.running) return;
      s.frame++;
      const t = Date.now() * 0.001;

      // Water shimmer
      const wpos = (waterGeo.attributes.position as THREE.BufferAttribute).array as Float32Array;
      for (let i = 0; i < wpos.length; i += 3) {
        const xi = wpos[i], yi = wpos[i + 1];
        wpos[i + 2] = Math.sin(xi * 1.5 + t * 0.8) * 0.04 + Math.cos(yi * 1.2 + t * 0.6) * 0.04 - 0.2;
      }
      (waterGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

      // Spawn
      if (s.frame % 40 === 0 && s.ripples.filter(r => !r.tapped).length < 5) spawnRipple3D(scene);

      // Update ripples
      for (let ri = s.ripples.length - 1; ri >= 0; ri--) {
        const r = s.ripples[ri];
        if (r.tapped) {
          r.alpha *= 0.85;
          r.rings.forEach(ring => { (ring.material as THREE.MeshStandardMaterial).opacity *= 0.85; });
          (r.indicator.material as THREE.MeshStandardMaterial).opacity *= 0.85;
          if (r.alpha < 0.01) {
            r.rings.forEach(ring => scene.remove(ring));
            scene.remove(r.indicator);
            s.ripples.splice(ri, 1);
          }
          continue;
        }
        if (r.growing) {
          r.r += growSpeed;
          if (r.r >= r.maxR) r.growing = false;
        } else {
          r.r -= shrinkSpeed;
          if (r.r <= 0.1) {
            s.sig.streakCurrent = 0;
            hapticFail();
            s.sig.late++;
            r.rings.forEach(ring => scene.remove(ring));
            scene.remove(r.indicator);
            s.ripples.splice(ri, 1);
            continue;
          }
        }
        // Scale rings
        const pct = r.r / r.maxR;
        r.rings.forEach((ring, i) => {
          ring.scale.setScalar(r.r * (1 - i * 0.1) / 0.1);
          const mat = ring.material as THREE.MeshStandardMaterial;
          mat.opacity = r.alpha * (1 - i * 0.25);
          if (pct >= 0.85) mat.emissiveIntensity = 1.0 + Math.sin(t * 10) * 0.3;
          else mat.emissiveIntensity = 0.5;
        });
        // Center dot visible at peak
        const indMat = r.indicator.material as THREE.MeshStandardMaterial;
        indMat.opacity = Math.abs(pct - 1) < 0.15 ? 0.8 : 0;
      }

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    const onTap = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running) return;
      const px = e.clientX, py = e.clientY;
      for (const r of s.ripples) {
        if (r.tapped) continue;
        const dist = Math.sqrt((px - r.x) ** 2 + (py - r.y) ** 2);
        const pxMaxR = r.maxR * (window.innerHeight / (2 * Math.tan((65 / 2) * Math.PI / 180) * 6));
        if (dist <= pxMaxR * 1.5 + 30) {
          r.tapped = true;
          const phasePct = r.r / r.maxR;
          const isPerfect = phasePct >= 0.85 && phasePct <= 1.0;
          const isEarly = phasePct < 0.5;
          if (isPerfect) {
            s.sig.perfect++; s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
            s.sig.score += 3 * mult; setScoreDisplay(s.sig.score);
            sfx.success(); hapticScore();
            if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
          } else if (!isEarly) {
            s.sig.streakCurrent++; s.sig.score++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            setScoreDisplay(s.sig.score); sfx.collect(); hapticScore();
          } else {
            s.sig.early++; s.sig.streakCurrent = 0;
            sfx.collision(); hapticFail();
          }
          break;
        }
      }
    };
    if (mountRef.current) mountRef.current.addEventListener('pointerdown', onTap);
    (s as any)._tapCleanup = () => mountRef.current?.removeEventListener('pointerdown', onTap);
  }, [endGame, spawnRipple3D]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    const s = stateRef.current;
    if (s.renderer) s.renderer.dispose();
    (s as any)._cleanup?.(); (s as any)._tapCleanup?.();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #000d1a 0%, #00050d 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="Tap the ripple at its peak — not too early, not too late!"
          ctaLabel="Tap the Wave 💧" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <GameHUD accentColor={accent} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 5 },
          { label: 'SCORE', value: scoreDisplay },
        ]} />
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Perfect Taps', value: String(finalSig.perfect), color: accent },
            { label: 'Too Early', value: String(finalSig.early), color: '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
            { label: 'Total Taps', value: String(finalSig.totalRipples), color: '#a855f7' },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.perfect >= 5} />
      )}
    </GameShell>
  );
}
