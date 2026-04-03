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

const GAME_ID = 'gravity-well';
const ACCENT = '#7c3aed';
const DURATION = 60;
const GAME_EMOJI = '🌌';
const GAME_TITLE = 'Gravity Well';
const GAME_TAGLINE = "Orbit the wells. Collect the stars. Don't get pulled in.";

interface Signals { goalsReached: number; deaths: number; maxSurvivalTime: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(sig: Signals): string {
  if (sig.deaths === 0 && sig.goalsReached >= 5) return 'Gravity Pilot 🌌';
  if (sig.goalsReached >= 8) return 'Space Navigator 🚀';
  if (sig.maxStreak >= 4) return 'Orbital Expert 💫';
  if (sig.goalsReached >= 3) return 'Getting the Pull 🌀';
  return 'Gravity Student 📚';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface Well3D { mesh: THREE.Mesh; rings: THREE.Mesh[]; light: THREE.PointLight; strength: number; r: number; color: number; }
interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  shipX: number; shipY: number; shipVX: number; shipVY: number;
  tiltX: number; tiltY: number; deathFlash: number;
  goalX: number; goalY: number; goalActive: boolean;
}

export default function GravityWell() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { goalsReached: 0, deaths: 0, maxSurvivalTime: 0, maxStreak: 0, streakCurrent: 0, score: 0 },
    shipX: 0, shipY: 0, shipVX: 0, shipVY: -0.01,
    tiltX: 0, tiltY: 0, deathFlash: 0,
    goalX: 3, goalY: 2, goalActive: true,
  });
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    ship: THREE.Mesh; shipLight: THREE.PointLight;
    goal: THREE.Mesh; goalLight: THREE.PointLight;
    wells: Well3D[]; trail: Array<{ mesh: THREE.Mesh; life: number }>;
    deathFlashMesh: THREE.Mesh; frame: number; animId: number;
  } | null>(null);

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const placeGoal = useCallback(() => {
    const s = stateRef.current;
    s.goalX = (Math.random() - 0.5) * 12;
    s.goalY = (Math.random() - 0.5) * 10;
    s.goalActive = true;
    const t = threeRef.current;
    if (t) t.goal.position.set(s.goalX, s.goalY, 0);
  }, []);

  const resetShip = useCallback(() => {
    const s = stateRef.current;
    s.shipX = 0; s.shipY = 0;
    s.shipVX = 0.03; s.shipVY = -0.01;
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { goalsReached: 0, deaths: 0, maxSurvivalTime: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    resetShip(); s.tiltX = 0; s.tiltY = 0; s.deathFlash = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x020208);
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020208);
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 0, 16);

    scene.add(new THREE.AmbientLight(0x110022, 1.5));

    // Stars
    const starCount = 600;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i*3] = (Math.random()-0.5)*60; starPos[i*3+1] = (Math.random()-0.5)*60; starPos[i*3+2] = (Math.random()-0.5)*20;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.08, transparent: true, opacity: 0.7 })));

    // Gravity wells
    const WELL_COLORS = [0x7c3aed, 0x4f46e5, 0x6d28d9];
    const WELL_DEFS = [{ x: -5, y: 2.5, s: 1600 }, { x: 3, y: -3, s: 1200 }, { x: 5, y: 2, s: 1400 }];
    const wells: Well3D[] = [];
    WELL_DEFS.forEach((wd, i) => {
      const color = WELL_COLORS[i % 3];
      const wMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, metalness: 0.3, roughness: 0.3 });
      const wMesh = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 16), wMat);
      wMesh.position.set(wd.x, wd.y, 0);
      scene.add(wMesh);

      // Rings
      const rings: THREE.Mesh[] = [];
      for (let r = 1; r <= 4; r++) {
        const rMesh = new THREE.Mesh(
          new THREE.TorusGeometry(r * 0.8, 0.02, 6, 32),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.15 - r * 0.025 })
        );
        rMesh.position.set(wd.x, wd.y, 0);
        scene.add(rMesh);
        rings.push(rMesh);
      }

      const wLight = new THREE.PointLight(color, 2.5, 8);
      wLight.position.set(wd.x, wd.y, 1);
      scene.add(wLight);
      wells.push({ mesh: wMesh, rings, light: wLight, strength: wd.s, r: 0.6, color });
    });

    // Goal (star)
    const goalMesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.4),
      new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.8, metalness: 0.3, roughness: 0.3 })
    );
    goalMesh.position.set(s.goalX, s.goalY, 0);
    scene.add(goalMesh);
    const goalLight = new THREE.PointLight(0xfbbf24, 3, 6);
    goalLight.position.set(s.goalX, s.goalY, 1);
    scene.add(goalLight);

    // Ship
    const shipGeo = new THREE.ConeGeometry(0.18, 0.55, 5);
    const shipMat = new THREE.MeshStandardMaterial({ color: 0xc4b5fd, emissive: ACCENT, emissiveIntensity: 0.4, metalness: 0.3, roughness: 0.4 });
    const ship = new THREE.Mesh(shipGeo, shipMat);
    scene.add(ship);
    const shipLight = new THREE.PointLight(ACCENT, 2, 5);
    scene.add(shipLight);

    // Death flash overlay
    const flashMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 30),
      new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    flashMesh.position.z = 5;
    scene.add(flashMesh);

    const trail: Array<{ mesh: THREE.Mesh; life: number }> = [];
    const obj = { renderer, scene, camera, ship, shipLight, goal: goalMesh, goalLight, wells, trail, deathFlashMesh: flashMesh, frame: 0, animId: 0 };
    threeRef.current = obj;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail?.(); endGame(); }
    }, 1000);

    const BOUNDS = 9;
    const handleMotion = (e: DeviceMotionEvent) => {
      s.tiltX = (e.accelerationIncludingGravity?.x ?? 0) * 0.25;
      s.tiltY = (e.accelerationIncludingGravity?.y ?? 0) * -0.25;
    };
    window.addEventListener('devicemotion', handleMotion);

    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      if (!s.running) return;
      obj.frame++;
      const t0 = obj.frame;

      // Apply tilt thrust
      s.shipVX += s.tiltX * 0.005;
      s.shipVY += s.tiltY * 0.005;

      // Gravity wells
      for (const w of wells) {
        const dx = w.mesh.position.x - s.shipX;
        const dy = w.mesh.position.y - s.shipY;
        const distSq = dx*dx + dy*dy;
        const dist = Math.sqrt(distSq);
        if (dist < w.r + 0.2) {
          // Absorbed
          s.sig.deaths++; s.sig.streakCurrent = 0;
          s.deathFlash = 25; hapticFail(); sfx.fail?.();
          resetShip();
        } else {
          const force = w.strength / (distSq * 5000);
          s.shipVX += (dx/dist) * force;
          s.shipVY += (dy/dist) * force;
        }
      }

      // Speed limit
      const speed = Math.sqrt(s.shipVX**2 + s.shipVY**2);
      if (speed > 0.12) { s.shipVX *= 0.12/speed; s.shipVY *= 0.12/speed; }

      s.shipX += s.shipVX; s.shipY += s.shipVY;
      // Wrap
      if (s.shipX < -BOUNDS) s.shipX = BOUNDS;
      if (s.shipX > BOUNDS) s.shipX = -BOUNDS;
      if (s.shipY < -BOUNDS) s.shipY = BOUNDS;
      if (s.shipY > BOUNDS) s.shipY = -BOUNDS;

      // Goal collection
      if (s.goalActive && Math.hypot(s.shipX - s.goalX, s.shipY - s.goalY) < 0.65) {
        s.sig.goalsReached++; s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
        s.sig.score += 5 * mult;
        setScoreDisplay(s.sig.score);
        sfx.success?.(); hapticScore();
        placeGoal();
      }

      // Ship orientation
      ship.position.set(s.shipX, s.shipY, 0);
      ship.rotation.z = Math.atan2(-s.shipVX, s.shipVY);
      shipLight.position.set(s.shipX, s.shipY, 1);

      // Trail
      const tMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 6, 6),
        new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.6 })
      );
      tMesh.position.set(s.shipX, s.shipY, 0);
      scene.add(tMesh);
      trail.push({ mesh: tMesh, life: 1.0 });
      if (trail.length > 20) {
        const old = trail.shift()!;
        scene.remove(old.mesh);
      }
      trail.forEach((tr, i) => {
        tr.life = i / trail.length;
        (tr.mesh.material as THREE.MeshBasicMaterial).opacity = tr.life * 0.5;
        tr.mesh.scale.setScalar(tr.life * 0.8 + 0.1);
      });

      // Goal pulse
      goalMesh.rotation.x += 0.02; goalMesh.rotation.y += 0.03;
      goalMesh.scale.setScalar(1 + Math.sin(t0 * 0.08) * 0.12);
      goalLight.intensity = 2.5 + Math.sin(t0 * 0.1) * 0.8;

      // Well rings spin
      wells.forEach(w => w.rings.forEach((r, ri) => { r.rotation.x += 0.008 * (ri+1); r.rotation.z += 0.005 * (ri+1); }));

      // Death flash
      if (s.deathFlash > 0) {
        (flashMesh.material as THREE.MeshBasicMaterial).opacity = s.deathFlash / 25 * 0.45;
        s.deathFlash--;
      } else {
        (flashMesh.material as THREE.MeshBasicMaterial).opacity = 0;
      }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [endGame, placeGoal, resetShip]);

  // Touch fallback for pointer movement
  useEffect(() => {
    const mount = mountRef.current; if (!mount || phase !== 'playing') return;
    const onMove = (e: PointerEvent) => {
      const s = stateRef.current; if (!s.running) return;
      const rect = mount.getBoundingClientRect();
      s.tiltX = ((e.clientX - rect.left) / rect.width - 0.5) * 10;
      s.tiltY = ((e.clientY - rect.top) / rect.height - 0.5) * -10;
    };
    mount.addEventListener('pointermove', onMove);
    return () => mount.removeEventListener('pointermove', onMove);
  }, [phase]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Move to steer your ship. Collect stars but avoid gravity wells!" ctaLabel="Launch! 🌌" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Stars Collected', value: String(finalSig.goalsReached), color: '#fbbf24' }, { label: 'Deaths', value: String(finalSig.deaths), color: '#ef4444' }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: ACCENT }, { label: 'Score', value: String(finalSig.score), color: 'var(--color-text)' }]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.goalsReached >= 5} />
      )}
    </GameShell>
  );
}
