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
import { createTiltController } from '@/lib/tilt';

const GAME_ID = 'balance-beam';
const PB_KEY = 'pb_balance-beam';
const ACCENT = '#f59e0b';
const DURATION = 60;
const GAME_EMOJI = '⚖️';
const GAME_TITLE = 'Balance Beam';
const GAME_TAGLINE = 'Keep the ball on the beam. Stay still.';

const BALL_RADIUS = 0.22;
const BEAM_HALF = 4.0;
const GRAVITY_SCALE = 0.04;
const FRICTION = 0.94;
const MAX_BEAM_ANGLE = 25 * (Math.PI / 180);
const DANGER_FRAC = 0.75;
const SAFE_FRAC = 0.50;

interface Signals {
  timeOnBeam: number; falls: number; microAdjustmentRate: number;
  avgTiltDeviation: number; recoveries: number; score: number;
  microAdjustCount: number; tiltDeviationSum: number; tiltSampleCount: number;
}
function getPersonality(sig: Signals): string {
  const beamSecs = sig.timeOnBeam / 1000;
  if (beamSecs > 45 && sig.falls <= 1 && sig.avgTiltDeviation < 6) return 'Zen Master 🧘';
  if (sig.microAdjustmentRate > 5 && sig.falls <= 3) return 'Micromanager 🎛️';
  if (sig.falls >= 3 && sig.recoveries >= 2) return 'Bold Corrector ⚡';
  if (sig.falls >= 2 && sig.recoveries >= 1) return 'Learning Curve 📈';
  return 'Steady 🏔️';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  beam: THREE.Mesh | null; ball: THREE.Mesh | null;
  beamAngle: number; ballX: number; ballVX: number;
  fallAnimating: boolean; fallBall: THREE.Mesh | null;
  fallVX: number; fallVY: number;
  touchLeftHeld: boolean; touchRightHeld: boolean;
  touchTiltValue: number; usingTouchFallback: boolean;
  streakMs: number; ballInDangerZone: boolean; prevBeamAngle: number;
  gameElapsedMs: number; lastFrameTime: number;
  windParticles: Array<{ mesh: THREE.Mesh; vx: number; life: number }>;
  nextWindTime: number;
  stopMusic: (() => void) | null;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

export default function BalanceBeamGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const tiltCtrlRef = useRef<ReturnType<typeof createTiltController> | null>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { timeOnBeam: 0, falls: 0, microAdjustmentRate: 0, avgTiltDeviation: 0, recoveries: 0, score: 0, microAdjustCount: 0, tiltDeviationSum: 0, tiltSampleCount: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    beam: null, ball: null, beamAngle: 0, ballX: 0, ballVX: 0,
    fallAnimating: false, fallBall: null, fallVX: 0, fallVY: 0,
    touchLeftHeld: false, touchRightHeld: false, touchTiltValue: 0, usingTouchFallback: false,
    streakMs: 0, ballInDangerZone: false, prevBeamAngle: 0,
    gameElapsedMs: 0, lastFrameTime: 0,
    windParticles: [], nextWindTime: 14000,
    stopMusic: null, intervalId: null, resizeCleanup: null,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (s.stopMusic) { s.stopMusic(); s.stopMusic = null; }
    s.resizeCleanup?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    tiltCtrlRef.current?.stop();
    if (s.sig.tiltSampleCount > 0) s.sig.avgTiltDeviation = s.sig.tiltDeviationSum / s.sig.tiltSampleCount;
    s.sig.microAdjustmentRate = s.gameElapsedMs > 0 ? s.sig.microAdjustCount / (s.gameElapsedMs / 1000) : 0;
    haptic([30, 50, 30, 50, 100]); sfx.success();
    try {
      const prev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      const val = Math.floor(s.sig.score);
      if (val > prev) { localStorage.setItem(PB_KEY, String(val)); setIsNewBest(true); }
    } catch { /* */ }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = DURATION;
    s.beamAngle = 0; s.ballX = 0; s.ballVX = 0; s.fallAnimating = false;
    s.streakMs = 0; s.ballInDangerZone = false;
    s.gameElapsedMs = 0; s.lastFrameTime = performance.now();
    s.nextWindTime = 14000 + Math.random() * 6000;
    s.windParticles = [];
    s.sig = { timeOnBeam: 0, falls: 0, microAdjustmentRate: 0, avgTiltDeviation: 0, recoveries: 0, score: 0, microAdjustCount: 0, tiltDeviationSum: 0, tiltSampleCount: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0f1a3a);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 2, 10);
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x334488, 2.5));
    const keyLight = new THREE.DirectionalLight(0xf59e0b, 2);
    keyLight.position.set(3, 5, 5);
    scene.add(keyLight);
    const fillLight = new THREE.PointLight(0x2244aa, 1.5, 30);
    fillLight.position.set(-5, 3, 3);
    scene.add(fillLight);

    // Stars
    const starPos = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 60;
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 30;
      starPos[i * 3 + 2] = -20 - Math.random() * 20;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xaaccff, size: 0.06, transparent: true, opacity: 0.7 })));

    // Platform base
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.5, 3, 8),
      new THREE.MeshStandardMaterial({ color: 0x334466, roughness: 0.8 })
    );
    platform.position.set(0, -2.5, 0);
    scene.add(platform);

    // Beam
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(BEAM_HALF * 2, 0.2, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.4, roughness: 0.4, emissive: 0xf59e0b, emissiveIntensity: 0.1 })
    );
    beam.position.set(0, 0, 0);
    scene.add(beam);
    s.beam = beam;

    // Ball
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0.05 })
    );
    scene.add(ball);
    s.ball = ball;

    // Fall ball (hidden)
    const fallBall = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS * 0.85, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xaaaaaa, transparent: true, opacity: 1 })
    );
    fallBall.visible = false;
    scene.add(fallBall);
    s.fallBall = fallBall;

    s.stopMusic = startMusic('calm');

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    s.resizeCleanup = () => window.removeEventListener('resize', handleResize);

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--; setTimeLeft(s.timeLeft);
      setScoreDisplay(Math.floor(s.sig.score));
      if (s.timeLeft > 0 && s.timeLeft <= 10) sfx.warning();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const loop = (timestamp: number) => {
      if (!s.running) return;
      const deltaMs = Math.min(timestamp - s.lastFrameTime, 50);
      s.lastFrameTime = timestamp;
      s.gameElapsedMs += deltaMs;

      // Touch tilt
      if (s.usingTouchFallback) {
        const target = s.touchLeftHeld ? -0.7 : s.touchRightHeld ? 0.7 : 0;
        s.touchTiltValue += (target - s.touchTiltValue) * 0.08;
        s.beamAngle = s.touchTiltValue * MAX_BEAM_ANGLE;
      }

      // Micro-adjust tracking
      const angleChange = Math.abs(s.beamAngle - s.prevBeamAngle);
      if (angleChange > 0.001 && angleChange < 3 * (Math.PI / 180)) s.sig.microAdjustCount++;
      s.prevBeamAngle = s.beamAngle;

      // Tilt deviation
      const tiltDeg = Math.abs(s.beamAngle) * (180 / Math.PI);
      s.sig.tiltDeviationSum += tiltDeg; s.sig.tiltSampleCount++;

      if (!s.fallAnimating) {
        const acc = Math.sin(s.beamAngle) * GRAVITY_SCALE;
        s.ballVX += acc; s.ballVX *= FRICTION; s.ballX += s.ballVX;

        // Wind gust
        if (s.gameElapsedMs >= s.nextWindTime) {
          const dir = Math.random() > 0.5 ? 1 : -1;
          s.ballVX += dir * (2 + Math.random() * 2);
          s.nextWindTime = s.gameElapsedMs + 12000 + Math.random() * 8000;
          sfx.whoosh();
          // Wind particles
          for (let i = 0; i < 6; i++) {
            const wp = new THREE.Mesh(
              new THREE.SphereGeometry(0.05, 4, 4),
              new THREE.MeshBasicMaterial({ color: 0xaaccff, transparent: true, opacity: 0.7 })
            );
            wp.position.set(dir > 0 ? -8 : 8, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 0.5);
            scene.add(wp);
            s.windParticles.push({ mesh: wp, vx: dir * (0.15 + Math.random() * 0.1), life: 30 });
          }
        }

        const ballFrac = Math.abs(s.ballX) / BEAM_HALF;
        if (ballFrac > DANGER_FRAC && !s.ballInDangerZone) {
          s.ballInDangerZone = true; sfx.nearMiss?.();
        } else if (ballFrac < SAFE_FRAC && s.ballInDangerZone) {
          s.ballInDangerZone = false; s.sig.recoveries++;
          s.sig.score += 10; sfx.collect(); haptic([15]);
        }

        if (Math.abs(s.ballX) > BEAM_HALF) {
          // Fall
          const bsx = s.ballX > 0 ? 4 : -4;
          s.fallAnimating = true;
          s.fallBall!.position.set(bsx, 0, 0);
          s.fallBall!.visible = true;
          s.fallVX = s.ballVX * 0.4;
          s.fallVY = 0.05;
          s.ballX = 0; s.ballVX = 0; s.sig.falls++; s.streakMs = 0; s.ballInDangerZone = false;
          sfx.collision(); haptic([200]);
          if (s.ball) s.ball.visible = false;
          setTimeout(() => {
            if (!stateRef.current.running) return;
            stateRef.current.fallAnimating = false;
            stateRef.current.ballX = 0; stateRef.current.ballVX = 0;
            if (stateRef.current.ball) stateRef.current.ball.visible = true;
            if (stateRef.current.fallBall) stateRef.current.fallBall.visible = false;
          }, 600);
        } else {
          const mult = s.streakMs >= 40000 ? 2.0 : s.streakMs >= 20000 ? 1.5 : 1.0;
          s.sig.timeOnBeam += deltaMs;
          s.sig.score += (deltaMs / 100) * mult;
          s.streakMs += deltaMs;
        }
      } else if (s.fallBall) {
        s.fallVY += 0.05;
        s.fallBall.position.y -= s.fallVY;
        s.fallBall.position.x += s.fallVX;
        const mat = s.fallBall.material as THREE.MeshStandardMaterial;
        mat.opacity = Math.max(0, 1 - (s.fallBall.position.y + 5) / -10);
      }

      // Update beam rotation
      if (s.beam) {
        s.beam.rotation.z = -s.beamAngle;
        const dangerColor = s.ballInDangerZone ? 0xff3300 : 0xf59e0b;
        (s.beam.material as THREE.MeshStandardMaterial).emissive.setHex(dangerColor);
        (s.beam.material as THREE.MeshStandardMaterial).emissiveIntensity = s.ballInDangerZone ? 0.3 : 0.1;
      }

      // Update ball position on beam
      if (s.ball && !s.fallAnimating) {
        const cosA = Math.cos(-s.beamAngle);
        const sinA = Math.sin(-s.beamAngle);
        const localY = BALL_RADIUS + 0.1;
        s.ball.position.x = s.ballX * cosA - localY * sinA;
        s.ball.position.y = s.ballX * sinA + localY * cosA;
        s.ball.rotation.x += s.ballVX * 0.1;
      }

      // Wind particles
      for (let i = s.windParticles.length - 1; i >= 0; i--) {
        const wp = s.windParticles[i];
        wp.mesh.position.x += wp.vx;
        wp.life--;
        (wp.mesh.material as THREE.MeshBasicMaterial).opacity = wp.life / 30;
        if (wp.life <= 0 || Math.abs(wp.mesh.position.x) > 10) {
          scene.remove(wp.mesh); wp.mesh.geometry.dispose();
          s.windParticles.splice(i, 1);
        }
      }

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const onPointerDown = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running || !s.usingTouchFallback) return;
      const rect = mount.getBoundingClientRect();
      if ((e.clientX - rect.left) < rect.width / 2) {
        s.touchLeftHeld = true; s.touchRightHeld = false;
      } else {
        s.touchRightHeld = true; s.touchLeftHeld = false;
      }
    };
    const onPointerUp = () => {
      stateRef.current.touchLeftHeld = false;
      stateRef.current.touchRightHeld = false;
    };
    mount.addEventListener('pointerdown', onPointerDown);
    mount.addEventListener('pointerup', onPointerUp);
    mount.addEventListener('pointercancel', onPointerUp);
    return () => {
      mount.removeEventListener('pointerdown', onPointerDown);
      mount.removeEventListener('pointerup', onPointerUp);
      mount.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  useEffect(() => () => {
    const s = stateRef.current;
    s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.stopMusic) s.stopMusic();
    tiltCtrlRef.current?.stop();
    s.resizeCleanup?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio();
    (async () => {
      const controller = createTiltController(
        (x) => { if (!stateRef.current.usingTouchFallback) stateRef.current.beamAngle = x * MAX_BEAM_ANGLE; },
        { sensitivity: 1.0, smoothing: 0.5, clamp: 30 }
      );
      const granted = await controller.start();
      tiltCtrlRef.current = controller;
      stateRef.current.usingTouchFallback = !granted;
      setPhase('countdown');
    })();
  }, []);

  const handlePlayAgain = useCallback(() => {
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false);
    setPhase('countdown');
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Allow Motion" accentColor={theme.colors.accent ?? ACCENT}
          sensorNote="Tilt to balance · touch if motion denied"
          onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        display: phase === 'playing' ? 'block' : 'none', touchAction: 'none',
      }} />
      {phase === 'playing' && (
        <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 10, testId: 'timer' },
          { label: 'BALANCE', value: scoreDisplay, testId: 'score' },
        ]} />
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(Math.floor(finalSig.score))} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Balance Time', value: `${Math.round(finalSig.timeOnBeam / 1000)}s`, color: finalSig.timeOnBeam > 50000 ? '#4ade80' : '#facc15' },
            { label: 'Falls', value: `${finalSig.falls}`, color: finalSig.falls === 0 ? '#4ade80' : finalSig.falls <= 2 ? '#facc15' : '#ef4444' },
            { label: 'Recoveries', value: `${finalSig.recoveries}`, color: ACCENT },
            { label: 'Stability', value: `${Math.round(finalSig.avgTiltDeviation * 10) / 10}°`, color: finalSig.avgTiltDeviation < 5 ? '#4ade80' : '#facc15' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.falls <= 2} />
      )}
    </GameShell>
  );
}
