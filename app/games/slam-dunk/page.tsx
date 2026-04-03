'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticImpact } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'slam-dunk';
const ACCENT = '#f97316';
const DURATION = 45;
const GAME_EMOJI = '🏀';
const GAME_TITLE = 'Slam Dunk';
const GAME_TAGLINE = 'Two fingers. One moment. Go!';

interface Signals { totalAttempts: number; dunks: number; almostDunks: number; perfectTiming: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.totalAttempts > 0 ? sig.dunks / sig.totalAttempts : 0;
  if (acc >= 0.85 && sig.perfectTiming >= 3) return 'Dunk King 👑';
  if (sig.dunks >= 10) return 'Slam Legend 🏆';
  if (sig.maxStreak >= 5) return 'On a Roll 🔥';
  if (acc >= 0.5) return 'Decent Dunker 🏀';
  return 'Air Ball ❌';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

export default function SlamDunk() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    ball: null as THREE.Mesh | null,
    hoop: null as THREE.Mesh | null,
    hoopLight: null as THREE.PointLight | null,
    ballLight: null as THREE.PointLight | null,
    running: false, timeLeft: DURATION,
    sig: { totalAttempts: 0, dunks: 0, almostDunks: 0, perfectTiming: 0, maxStreak: 0, streakCurrent: 0, score: 0 } as Signals,
    ballX: 0, ballY: 0, ballZ: 0,
    ballVX: 0, ballVY: 0, ballVZ: 0,
    ballInFlight: false,
    chargeLevel: 0, charging: false, chargeStart: 0,
    pointerCount: 0, dunkWindow: false, dunkWindowTimer: 0,
    onGround: true, groundY: -1.5,
    shakeX: 0,
    particles: [] as { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }[],
    floats: [] as { text: string; mesh: THREE.Mesh; life: number; vy: number }[],
    frame: 0,
    hoopX: 0, hoopY: 1.8, hoopZ: -3,
    dunkFlash: 0,
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

  const attemptDunk = useCallback(() => {
    const s = stateRef.current;
    if (!s.running || s.ballInFlight) return;
    s.sig.totalAttempts++;
    s.chargeLevel = Math.min(1, (Date.now() - s.chargeStart) / 600);
    const power = 0.12 + s.chargeLevel * 0.15;
    // Launch toward hoop
    const dx = s.hoopX - s.ballX;
    const dz = s.hoopZ - s.ballZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    s.ballVX = (dx / dist) * power * 2.5;
    s.ballVZ = (dz / dist) * power * 2.5;
    s.ballVY = power * 4;
    s.ballInFlight = true;
    s.charging = false;
    sfx.collect();
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalAttempts: 0, dunks: 0, almostDunks: 0, perfectTiming: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.ballX = 0; s.ballY = s.groundY; s.ballZ = 2;
    s.ballInFlight = false; s.charging = false; s.frame = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a1a);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 2, 7);
    camera.lookAt(0, 1, 0);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x0a0a1a, 3));
    const courtLight = new THREE.PointLight(0xf97316, 2, 20);
    courtLight.position.set(0, 8, 0);
    scene.add(courtLight);
    const hoopLight = new THREE.PointLight(0xf97316, 3, 8);
    hoopLight.position.set(0, 3, -3);
    scene.add(hoopLight);
    s.hoopLight = hoopLight;
    const ballLight = new THREE.PointLight(0xfbbf24, 2, 5);
    scene.add(ballLight);
    s.ballLight = ballLight;

    // Court floor
    const courtGeo = new THREE.PlaneGeometry(10, 16);
    const courtMat = new THREE.MeshStandardMaterial({ color: 0x7c2d0a, roughness: 0.6 });
    const court = new THREE.Mesh(courtGeo, courtMat);
    court.rotation.x = -Math.PI / 2;
    court.position.y = s.groundY - 0.05;
    scene.add(court);
    // Court lines
    const lineGeo = new THREE.PlaneGeometry(9.8, 0.04);
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
    for (let lz = -6; lz <= 6; lz += 3) {
      const line = new THREE.Mesh(lineGeo, lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, s.groundY - 0.04, lz);
      scene.add(line);
    }

    // Backboard
    const backboard = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 0.1), new THREE.MeshStandardMaterial({ color: 0xf0f0f0, transparent: true, opacity: 0.8 }));
    backboard.position.set(s.hoopX, s.hoopY + 0.5, s.hoopZ - 0.2);
    scene.add(backboard);
    // Hoop
    const hoopGeo = new THREE.TorusGeometry(0.45, 0.04, 8, 24);
    const hoopMat = new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0xf97316, emissiveIntensity: 0.4 });
    const hoop = new THREE.Mesh(hoopGeo, hoopMat);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.set(s.hoopX, s.hoopY, s.hoopZ);
    scene.add(hoop);
    s.hoop = hoop;
    // Pole
    scene.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, s.hoopY - s.groundY + 1), new THREE.MeshStandardMaterial({ color: 0x888888 })));
    const pole = scene.children[scene.children.length - 1] as THREE.Mesh;
    pole.position.set(s.hoopX, s.groundY + (s.hoopY - s.groundY) / 2, s.hoopZ - 0.6);

    // Ball
    const ballGeo = new THREE.SphereGeometry(0.22, 16, 16);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.6, metalness: 0.1, emissive: 0xf97316, emissiveIntensity: 0.2 });
    const ball = new THREE.Mesh(ballGeo, ballMat);
    ball.position.set(s.ballX, s.ballY, s.ballZ);
    scene.add(ball);
    s.ball = ball;

    // Charge ring on ground
    const chargeRingGeo = new THREE.TorusGeometry(0.4, 0.03, 6, 24);
    const chargeRingMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0, transparent: true, opacity: 0 });
    const chargeRing = new THREE.Mesh(chargeRingGeo, chargeRingMat);
    chargeRing.rotation.x = Math.PI / 2;
    chargeRing.position.set(0, s.groundY + 0.05, 2);
    scene.add(chargeRing);

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    (s as any)._cleanup = () => window.removeEventListener('resize', handleResize);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 10 && s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const GRAVITY = -0.018;

    const loop = () => {
      if (!s.running) return;
      const t = Date.now() * 0.001;
      s.frame++;

      // Ball physics
      if (s.ballInFlight) {
        s.ballX += s.ballVX;
        s.ballY += s.ballVY;
        s.ballZ += s.ballVZ;
        s.ballVY += GRAVITY;
        ball.position.set(s.ballX, s.ballY, s.ballZ);
        ball.rotation.x += s.ballVX * 0.3;
        ball.rotation.z -= s.ballVZ * 0.3;
        // Check hoop
        const dx = s.ballX - s.hoopX;
        const dy = s.ballY - s.hoopY;
        const dz = s.ballZ - s.hoopZ;
        const dist3D = Math.sqrt(dx*dx + dz*dz);
        if (dy > -0.15 && dy < 0.3 && dist3D < 0.4) {
          // Dunk!
          const isPerfect = dist3D < 0.15;
          s.sig.dunks++; s.sig.streakCurrent++;
          if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
          if (isPerfect) s.sig.perfectTiming++;
          const pts = isPerfect ? 3 : 1 + Math.min(2, Math.floor(s.sig.streakCurrent / 3));
          s.sig.score += pts; setScoreDisplay(s.sig.score);
          sfx.success(); hapticScore();
          s.dunkFlash = 20;
          hoopMat.emissiveIntensity = 2;
          // Reset ball
          s.ballInFlight = false;
          s.ballX = (Math.random() - 0.5) * 3;
          s.ballY = s.groundY; s.ballZ = 1.5 + Math.random();
          ball.position.set(s.ballX, s.ballY, s.ballZ);
        }
        // Bounce off ground
        if (s.ballY <= s.groundY) {
          s.ballY = s.groundY; s.ballVY *= -0.5; s.ballVX *= 0.85; s.ballVZ *= 0.85;
          if (Math.abs(s.ballVY) < 0.02) { s.ballInFlight = false; sfx.collision(); hapticFail(); s.sig.streakCurrent = 0; }
        }
        // Out of bounds
        if (s.ballZ < -6 || Math.abs(s.ballX) > 5.5) {
          s.ballInFlight = false; s.sig.streakCurrent = 0;
          s.ballX = 0; s.ballY = s.groundY; s.ballZ = 2;
          ball.position.set(s.ballX, s.ballY, s.ballZ);
        }
      } else {
        // Idle bob
        ball.position.y = s.groundY + Math.sin(t * 3) * 0.05;
        // Charge ring
        if (s.charging) {
          const charge = Math.min(1, (Date.now() - s.chargeStart) / 600);
          chargeRingMat.opacity = charge * 0.8;
          chargeRingMat.emissiveIntensity = charge * 1.5;
          chargeRing.scale.setScalar(1 + charge * 0.5);
        } else {
          chargeRingMat.opacity = 0;
        }
        chargeRing.position.set(s.ballX, s.groundY + 0.05, s.ballZ);
      }

      // Hoop & ball lights
      ballLight.position.set(ball.position.x, ball.position.y + 0.5, ball.position.z);
      if (s.dunkFlash > 0) {
        s.dunkFlash--;
        hoopLight.intensity = 5 + s.dunkFlash * 0.3;
        hoopMat.emissiveIntensity = s.dunkFlash * 0.1;
      } else {
        hoopLight.intensity = 1.5 + Math.sin(t * 2) * 0.3;
        hoopMat.emissiveIntensity = 0.3;
      }

      // Hoop pulse
      hoop.rotation.z = Math.sin(t * 0.5) * 0.02;

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    // Input: hold = charge, release = shoot
    const onDown = (e: PointerEvent) => {
      const s2 = stateRef.current;
      if (!s2.running || s2.ballInFlight) return;
      s2.charging = true; s2.chargeStart = Date.now(); s2.pointerCount++;
    };
    const onUp = () => {
      const s2 = stateRef.current;
      if (!s2.running || !s2.charging) return;
      s2.pointerCount = Math.max(0, s2.pointerCount - 1);
      if (s2.pointerCount === 0) attemptDunk();
    };
    if (mountRef.current) {
      mountRef.current.addEventListener('pointerdown', onDown);
      mountRef.current.addEventListener('pointerup', onUp);
    }
    (s as any)._inputCleanup = () => { mountRef.current?.removeEventListener('pointerdown', onDown); mountRef.current?.removeEventListener('pointerup', onUp); };
  }, [endGame, attemptDunk]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    const s = stateRef.current;
    if (s.renderer) s.renderer.dispose();
    (s as any)._cleanup?.(); (s as any)._inputCleanup?.();
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #0a0a1a 0%, #0a0500 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Hold to charge your shot, release to dunk! Aim for the 3D hoop."
          ctaLabel="Dunk It! 🏀" accentColor={accent} onStart={handleStart} />
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
            { label: 'Dunks', value: String(finalSig.dunks), color: accent },
            { label: 'Attempts', value: String(finalSig.totalAttempts), color: '#fbbf24' },
            { label: 'Perfects', value: String(finalSig.perfectTiming), color: '#4ade80' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.dunks >= 5} />
      )}
    </GameShell>
  );
}
