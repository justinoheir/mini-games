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

const GAME_ID      = 'firework-launch';
const ACCENT       = '#f59e0b';
const DURATION     = 45;
const GAME_EMOJI   = '🎆';
const GAME_TITLE   = 'Firework Launch';
const GAME_TAGLINE = 'Swipe up to launch. Tap at the peak to explode!';
const FIREWORK_COLORS = [0xef4444, 0xf59e0b, 0x22c55e, 0x3b82f6, 0xa855f7, 0xec4899, 0xffffff];

interface Signals { score: number; perfectDetonations: number; totalLaunched: number; maxStreak: number; streakCurrent: number; combos: number; }
function getPersonality(sig: Signals): string {
  if (sig.perfectDetonations >= 6 && sig.streakCurrent >= 4) return 'Pyrotechnist 🎆';
  if (sig.maxStreak >= 5) return 'Sky Painter ✨';
  if (sig.perfectDetonations >= 4) return 'Precision Igniter 🎇';
  if (sig.totalLaunched >= 15) return 'Crowd Pleaser 🥳';
  return 'Happy New Year! 🎉';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
type RocketPhase = 'idle' | 'rising' | 'peaked' | 'exploded';

interface Rocket3D {
  mesh: THREE.Mesh; trail: THREE.Points;
  vx: number; vy: number; phase: RocketPhase;
  peakY: number; launchTime: number;
  color: number; trailPositions: Float32Array;
  trailIdx: number;
}

interface Explosion3D {
  particles: THREE.Points; positions: Float32Array; velocities: Float32Array;
  born: number; color: number;
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  rocketPhase: RocketPhase;
  swipeStartY: number; swipeActive: boolean;
}

function FireworkLaunchGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, perfectDetonations: 0, totalLaunched: 0, maxStreak: 0, streakCurrent: 0, combos: 0 },
    rocketPhase: 'idle', swipeStartY: 0, swipeActive: false,
  });
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    rockets: Rocket3D[]; explosions: Explosion3D[];
    stars: THREE.Points; animId: number;
    autoDetonateRef: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const t = threeRef.current;
    if (t) { if (t.autoDetonateRef) clearTimeout(t.autoDetonateRef); cancelAnimationFrame(t.animId); t.renderer.dispose(); }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const explodeRocket = useCallback((rocket: Rocket3D, perfect: boolean) => {
    const t = threeRef.current; if (!t) return;
    const s = stateRef.current;
    const { scene } = t;

    // Create explosion particle system
    const PARTICLE_COUNT = perfect ? 80 : 50;
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const vel = new Float32Array(PARTICLE_COUNT * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const spd = 0.04 + Math.random() * (perfect ? 0.12 : 0.07);
      pos[i*3] = rocket.mesh.position.x;
      pos[i*3+1] = rocket.mesh.position.y;
      pos[i*3+2] = rocket.mesh.position.z;
      vel[i*3]   = Math.sin(phi) * Math.cos(theta) * spd;
      vel[i*3+1] = Math.sin(phi) * Math.sin(theta) * spd + (perfect ? 0.02 : 0);
      vel[i*3+2] = Math.cos(phi) * spd;
    }
    const mat = new THREE.PointsMaterial({ color: rocket.color, size: perfect ? 0.18 : 0.12, transparent: true, opacity: 1.0 });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    t.explosions.push({ particles: pts, positions: pos, velocities: vel, born: Date.now(), color: rocket.color });

    // Flash light
    const fl = new THREE.PointLight(rocket.color, perfect ? 8 : 5, 12);
    fl.position.copy(rocket.mesh.position);
    scene.add(fl);
    setTimeout(() => scene.remove(fl), 300);

    // Score
    const peakRatio = Math.min(1, (rocket.mesh.position.y + 4) / 8);
    const isPerfect = perfect || peakRatio >= 0.82;
    if (isPerfect) {
      s.sig.perfectDetonations++;
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const pts2 = 5 * (s.sig.streakCurrent >= 3 ? 2 : 1);
      s.sig.score += pts2;
      sfx.success?.(); hapticScore();
    } else {
      s.sig.score += 2;
      s.sig.streakCurrent = 0;
      sfx.collect?.();
    }
    setScoreDisplay(s.sig.score);

    // Remove rocket
    scene.remove(rocket.mesh);
    scene.remove(rocket.trail);
    const idx = t.rockets.indexOf(rocket);
    if (idx >= 0) t.rockets.splice(idx, 1);
    s.rocketPhase = 'idle';
  }, []);

  const launchRocket = useCallback((targetX: number) => {
    const t = threeRef.current; if (!t) return;
    const s = stateRef.current;
    if (s.rocketPhase !== 'idle') return;
    s.rocketPhase = 'rising';
    s.sig.totalLaunched++;

    const color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
    const rocketGeo = new THREE.CylinderGeometry(0.05, 0.12, 0.5, 8);
    const rocketMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 });
    const mesh = new THREE.Mesh(rocketGeo, rocketMat);
    mesh.position.set(targetX * 4, -4, 0);
    t.scene.add(mesh);

    const TRAIL_MAX = 30;
    const trailPos = new Float32Array(TRAIL_MAX * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    const trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({ color, size: 0.06, transparent: true, opacity: 0.7 }));
    t.scene.add(trail);

    const peakY = 2 + Math.random() * 3.5;
    const rocket: Rocket3D = {
      mesh, trail, trailPositions: trailPos, trailIdx: 0,
      vx: (Math.random() - 0.5) * 0.03, vy: 0.1 + Math.random() * 0.04,
      phase: 'rising', peakY, launchTime: Date.now(), color,
    };
    t.rockets.push(rocket);
    sfx.click?.(); haptic([20]);

    // Auto-detonate after 2s if not tapped
    t.autoDetonateRef = setTimeout(() => {
      if (rocket.phase === 'rising' || rocket.phase === 'peaked') {
        rocket.phase = 'exploded';
        explodeRocket(rocket, false);
      }
    }, 2000);
  }, [explodeRocket]);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, perfectDetonations: 0, totalLaunched: 0, maxStreak: 0, streakCurrent: 0, combos: 0 };
    s.rocketPhase = 'idle';
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x03010a);
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03010a);
    const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 100);
    camera.position.set(0, 0, 12);
    // === POLISH: Enhanced rim + fill lighting ===
    const rimLightA = new THREE.PointLight(0x4466ff, 1.2, 20);
    rimLightA.position.set(-6, 5, 3);
    scene.add(rimLightA);
    const fillLightB = new THREE.PointLight(0xff6644, 0.8, 15);
    fillLightB.position.set(6, -3, 5);
    scene.add(fillLightB);
    // === END POLISH ===

    scene.add(new THREE.AmbientLight(0x110022, 1.5));

    // Stars
    const starCount = 800;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i*3] = (Math.random()-0.5)*40; starPos[i*3+1] = (Math.random()-0.5)*30; starPos[i*3+2] = (Math.random()-0.5)*20;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06, transparent: true, opacity: 0.8 }));
    scene.add(stars);

    // City skyline silhouette
    const skylineGeo = new THREE.BoxGeometry(20, 2.5, 0.5);
    const skylineMat = new THREE.MeshBasicMaterial({ color: 0x080010 });
    for (let i = -5; i <= 5; i++) {
      const bGeo = new THREE.BoxGeometry(0.6 + Math.random() * 0.8, 1.5 + Math.random() * 3, 0.3);
      const b = new THREE.Mesh(bGeo, skylineMat);
      b.position.set(i * 1.8 + (Math.random()-0.5)*0.5, -4 + Math.random()*0.5, -2);
      scene.add(b);
    }

    const obj = { renderer, scene, camera, rockets: [] as Rocket3D[], explosions: [] as Explosion3D[], stars, animId: 0, autoDetonateRef: null };
    threeRef.current = obj;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.success?.(); haptic([100, 50, 100]); endGame(); }
    }, 1000);

    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      if (!s.running) return;
      const now = Date.now();

      // Update rockets
      for (const rocket of obj.rockets) {
        if (rocket.phase !== 'rising') continue;
        rocket.mesh.position.x += rocket.vx;
        rocket.mesh.position.y += rocket.vy;
        rocket.vy -= 0.0015; // slight deceleration

        // Update trail
        const ti = rocket.trailIdx % 30;
        rocket.trailPositions[ti*3] = rocket.mesh.position.x;
        rocket.trailPositions[ti*3+1] = rocket.mesh.position.y;
        rocket.trailPositions[ti*3+2] = rocket.mesh.position.z;
        rocket.trail.geometry.attributes.position.needsUpdate = true;
        rocket.trailIdx++;

        if (rocket.vy <= 0.005 || rocket.mesh.position.y >= rocket.peakY) {
          rocket.phase = 'peaked';
          (rocket.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.5;
        }
      }

      // Update explosions
      for (let i = obj.explosions.length - 1; i >= 0; i--) {
        const exp = obj.explosions[i];
        const age = (now - exp.born) / 800;
        if (age >= 1) {
          scene.remove(exp.particles); obj.explosions.splice(i, 1); continue;
        }
        const pos = exp.positions; const vel = exp.velocities;
        const count = pos.length / 3;
        for (let j = 0; j < count; j++) {
          pos[j*3]   += vel[j*3];
          pos[j*3+1] += vel[j*3+1] - 0.002;
          pos[j*3+2] += vel[j*3+2];
          vel[j*3] *= 0.97; vel[j*3+1] *= 0.97; vel[j*3+2] *= 0.97;
        }
        exp.particles.geometry.attributes.position.needsUpdate = true;
        (exp.particles.material as THREE.PointsMaterial).opacity = 1 - age * 0.8;
        (exp.particles.material as THREE.PointsMaterial).size = 0.15 + age * 0.1;
      }

      // Twinkle stars
      const starMat = stars.material as THREE.PointsMaterial;
      starMat.opacity = 0.6 + Math.sin(now * 0.001) * 0.2;

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
  }, [endGame]);

  useEffect(() => {
    const mount = mountRef.current; if (!mount || phase !== 'playing') return;
    let swipeStartY = 0, swipeStartX = 0, swiping = false;
    const onDown = (e: PointerEvent) => { swipeStartY = e.clientY; swipeStartX = e.clientX; swiping = true; };
    const onUp = (e: PointerEvent) => {
      if (!swiping) return; swiping = false;
      const s = stateRef.current; if (!s.running) return;
      const dy = swipeStartY - e.clientY;
      const rect = mount.getBoundingClientRect();
      const ndcX = (swipeStartX - rect.left) / rect.width * 2 - 1;
      if (dy > 30 && s.rocketPhase === 'idle') {
        launchRocket(ndcX);
      } else if (s.rocketPhase === 'rising' || s.rocketPhase === 'peaked') {
        const t = threeRef.current;
        if (t && t.rockets.length > 0) {
          const rocket = t.rockets[0];
          if (rocket.phase === 'rising' || rocket.phase === 'peaked') {
            if (t.autoDetonateRef) clearTimeout(t.autoDetonateRef);
            const wasPeaked = rocket.phase === 'peaked'; rocket.phase = 'exploded'; explodeRocket(rocket, wasPeaked);
          }
        }
      }
    };
    mount.addEventListener('pointerdown', onDown);
    mount.addEventListener('pointerup', onUp);
    return () => { mount.removeEventListener('pointerdown', onDown); mount.removeEventListener('pointerup', onUp); };
  }, [phase, launchRocket, explodeRocket]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    const t = threeRef.current;
    if (t) { if (t.autoDetonateRef) clearTimeout(t.autoDetonateRef); cancelAnimationFrame(t.animId); t.renderer.dispose(); }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Light it Up! 🎆" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Perfect Blasts', value: String(finalSig.perfectDetonations), color: '#fbbf24' }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: ACCENT }, { label: 'Launched', value: String(finalSig.totalLaunched), color: '#06b6d4' }, { label: 'Score', value: String(finalSig.score), color: 'var(--color-text)' }]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.perfectDetonations >= 5} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, gameId, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>; gameId: string; sig: Signals; personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, gameId, { personality, score: sig.score, perfectDetonations: sig.perfectDetonations, totalLaunched: sig.totalLaunched, maxStreak: sig.maxStreak }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const FireworkLaunchGame = dynamic(() => Promise.resolve({ default: FireworkLaunchGameInner }), { ssr: false });
export default FireworkLaunchGame;
