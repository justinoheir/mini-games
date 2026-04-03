/**
 * STEADY HAND — 3D Version
 * A 3D cursor orb must be held on a target ring. Phone motion drives the orb.
 */
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';

const GAME_ID = 'steady-hand';
const PB_KEY = 'pb_steady-hand';
const ACCENT = '#22c55e';
const DURATION = 30;
const GAME_EMOJI = '🎯';
const GAME_TITLE = 'Steady Hand';
const GAME_TAGLINE = 'Hold perfectly still. We dare you.';
const TARGET_RADIUS_3D = 0.25;
const MOTION_SENSITIVITY = 0.06;
const CURSOR_DAMPING = 0.88;
const ACC_SMOOTH = 0.20;

interface Signals { score: number; onTargetMs: number; maxStreakMs: number; totalMotion: number; vibrations: number; stability: number; }
function getPersonality(sig: Signals): string {
  const pct = sig.onTargetMs / (DURATION * 1000);
  if (pct >= 0.7 && sig.stability >= 0.8) return 'Sniper Mind 🎯';
  if (pct >= 0.6) return 'Iron Wrist 🤝';
  if (sig.maxStreakMs > 8000) return 'Stillness Pro ⚡';
  if (pct >= 0.3) return 'Getting Steadier 📈';
  return 'The Shaky One 🫨';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

export default function SteadyHandGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    cursorMesh: null as THREE.Mesh | null,
    cursorLight: null as THREE.PointLight | null,
    targetRing: null as THREE.Mesh | null,
    targetLight: null as THREE.PointLight | null,
    trailMeshes: [] as THREE.Mesh[],
    interferenceRings: [] as { mesh: THREE.Mesh; speed: number; phase: number }[],
    running: false, timeLeft: DURATION,
    sig: { score: 0, onTargetMs: 0, maxStreakMs: 0, totalMotion: 0, vibrations: 0, stability: 0 } as Signals,
    cursorX: 0, cursorY: 0,
    velX: 0, velY: 0,
    accX: 0, accY: 0, accZ: 0,
    smoothAccX: 0, smoothAccY: 0,
    onTarget: false, streakStart: 0, currentStreakMs: 0,
    onTargetTotalMs: 0,
    deviceMotionGranted: false,
    scoreTimer: 0, scoreInterval: 80,
    interferenceTimer: 0,
    totalFrames: 0, onTargetFrames: 0,
    particles: [] as { mesh: THREE.Mesh; vx: number; vy: number; life: number }[],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [streak, setStreak] = useState(0);
  const { pops, triggerPop } = useScorePop();
  const prevScoreRef = useRef(0);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => {
    if (scoreDisplay > prevScoreRef.current) triggerPop(`+${scoreDisplay - prevScoreRef.current}`, window.innerWidth / 2, 200);
    prevScoreRef.current = scoreDisplay;
  }, [scoreDisplay, triggerPop]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    stopMusicRef.current?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    playVictoryFanfare(); hapticVictory();
    const stability = s.totalFrames > 0 ? s.onTargetFrames / s.totalFrames : 0;
    s.sig.onTargetMs = s.onTargetTotalMs;
    s.sig.stability = stability;
    try { const pb = parseInt(localStorage.getItem(PB_KEY) || '0', 10); if (s.sig.score > pb) { localStorage.setItem(PB_KEY, String(s.sig.score)); setIsNewBest(true); } } catch { /* ignore */ }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(async () => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, onTargetMs: 0, maxStreakMs: 0, totalMotion: 0, vibrations: 0, stability: 0 };
    s.cursorX = 0; s.cursorY = 0; s.velX = 0; s.velY = 0;
    s.smoothAccX = 0; s.smoothAccY = 0;
    s.onTarget = false; s.streakStart = 0; s.currentStreakMs = 0; s.onTargetTotalMs = 0;
    s.scoreTimer = 0; s.totalFrames = 0; s.onTargetFrames = 0;
    s.particles = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setStreak(0); setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a0a);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 6);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x0a0a0a, 2));
    const ambLight = new THREE.PointLight(0x22c55e, 1.5, 20);
    ambLight.position.set(0, 4, 3);
    scene.add(ambLight);
    const targetLight = new THREE.PointLight(0x22c55e, 2, 8);
    scene.add(targetLight);
    s.targetLight = targetLight;
    const cursorLight = new THREE.PointLight(0xfbbf24, 3, 5);
    scene.add(cursorLight);
    s.cursorLight = cursorLight;

    // Stars
    const sp = new Float32Array(500*3);
    for (let i=0;i<500;i++){sp[i*3]=(Math.random()-.5)*60;sp[i*3+1]=(Math.random()-.5)*60;sp[i*3+2]=(Math.random()-.5)*60;}
    const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(sp,3));
    scene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0xffffff,size:0.04})));

    // Target ring
    const targetGeo = new THREE.TorusGeometry(TARGET_RADIUS_3D, 0.05, 8, 32);
    const targetMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 0.8 });
    const targetRing = new THREE.Mesh(targetGeo, targetMat);
    scene.add(targetRing);
    s.targetRing = targetRing;
    targetLight.position.set(0, 0, 0.5);

    // Inner dot target
    const dotGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const dotMat = new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x4ade80, emissiveIntensity: 1 });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    scene.add(dot);

    // Interference decorative rings
    const interferenceRings: { mesh: THREE.Mesh; speed: number; phase: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const rGeo = new THREE.TorusGeometry(0.6 + i * 0.4, 0.02, 6, 24);
      const rMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, transparent: true, opacity: 0.15 - i * 0.02 });
      const r = new THREE.Mesh(rGeo, rMat);
      scene.add(r);
      interferenceRings.push({ mesh: r, speed: 0.3 + i * 0.15, phase: i * Math.PI / 2 });
    }
    s.interferenceRings = interferenceRings;

    // Cursor sphere
    const cursorGeo = new THREE.SphereGeometry(0.12, 12, 12);
    const cursorMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.8, roughness: 0.2 });
    const cursorMesh = new THREE.Mesh(cursorGeo, cursorMat);
    scene.add(cursorMesh);
    s.cursorMesh = cursorMesh;

    // Setup DeviceMotion
    const setupMotion = async () => {
      if (typeof DeviceMotionEvent !== 'undefined' && 'requestPermission' in DeviceMotionEvent) {
        try { const p = await (DeviceMotionEvent as any).requestPermission(); if (p !== 'granted') return; } catch { return; }
      }
      const onMotion = (e: DeviceMotionEvent) => {
        const s2 = stateRef.current;
        if (!s2.running) return;
        const ax = e.accelerationIncludingGravity?.x ?? 0;
        const ay = e.accelerationIncludingGravity?.y ?? 0;
        s2.accX = ax; s2.accY = ay;
      };
      window.addEventListener('devicemotion', onMotion);
      s.deviceMotionGranted = true;
      (s as any)._motionCleanup = () => window.removeEventListener('devicemotion', onMotion);
    };
    await setupMotion();

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    (s as any)._cleanup = () => window.removeEventListener('resize', handleResize);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 10 && s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    // Target position changes over time
    const targetPositions = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.5, 0.3, 0),
      new THREE.Vector3(-0.3, 0.5, 0),
      new THREE.Vector3(0.2, -0.4, 0),
      new THREE.Vector3(-0.4, -0.2, 0),
    ];
    let targetIdx = 0, targetTransitionMs = 0;

    const loop = () => {
      if (!s.running) return;
      const now = Date.now();
      const t = now * 0.001;
      s.totalFrames++;

      // Smooth accelerometer
      s.smoothAccX += (s.accX - s.smoothAccX) * ACC_SMOOTH;
      s.smoothAccY += (s.accY - s.smoothAccY) * ACC_SMOOTH;

      // Apply acceleration to velocity
      if (s.deviceMotionGranted) {
        s.velX += s.smoothAccX * MOTION_SENSITIVITY * 0.1;
        s.velY += -s.smoothAccY * MOTION_SENSITIVITY * 0.1;
      } else {
        // Mouse/touch fallback — slight random drift
        s.velX += (Math.random() - 0.5) * 0.002;
        s.velY += (Math.random() - 0.5) * 0.002;
      }
      s.velX *= CURSOR_DAMPING;
      s.velY *= CURSOR_DAMPING;
      s.cursorX += s.velX;
      s.cursorY += s.velY;
      // Clamp
      s.cursorX = Math.max(-3, Math.min(3, s.cursorX));
      s.cursorY = Math.max(-3, Math.min(3, s.cursorY));

      // Target moves periodically
      targetTransitionMs += 16;
      if (targetTransitionMs > 5000) {
        targetTransitionMs = 0;
        targetIdx = (targetIdx + 1) % targetPositions.length;
      }
      const targetPos = targetPositions[targetIdx];
      targetRing.position.lerp(targetPos, 0.02);
      dot.position.copy(targetRing.position);
      targetLight.position.set(targetRing.position.x, targetRing.position.y, 0.5);

      // Cursor position
      cursorMesh.position.set(s.cursorX, s.cursorY, 0.2);
      cursorLight.position.set(s.cursorX, s.cursorY, 0.8);

      // Check on target
      const dist = cursorMesh.position.distanceTo(targetRing.position);
      s.onTarget = dist < TARGET_RADIUS_3D + 0.05;
      s.onTargetFrames += s.onTarget ? 1 : 0;

      // Visual feedback
      const tMat = targetRing.material as THREE.MeshStandardMaterial;
      const cMat = cursorMesh.material as THREE.MeshStandardMaterial;
      if (s.onTarget) {
        s.onTargetTotalMs += 16;
        s.scoreTimer += 16;
        if (s.scoreTimer >= s.scoreInterval) {
          s.scoreTimer = 0;
          s.sig.score += 1; setScoreDisplay(s.sig.score);
        }
        tMat.emissive.setHex(0xfbbf24); tMat.emissiveIntensity = 1.2;
        cMat.emissive.setHex(0x22c55e); cMat.emissiveIntensity = 1.2;
        targetLight.color.setHex(0xfbbf24); targetLight.intensity = 3;
        cursorLight.color.setHex(0x22c55e);
        if (!s.streakStart) s.streakStart = now;
        s.currentStreakMs = now - s.streakStart;
        if (s.currentStreakMs > s.sig.maxStreakMs) s.sig.maxStreakMs = s.currentStreakMs;
        hapticScore(); sfx.tick();
      } else {
        tMat.emissive.setHex(0x22c55e); tMat.emissiveIntensity = 0.8 + Math.sin(t * 3) * 0.2;
        cMat.emissive.setHex(dist < 0.8 ? 0xfbbf24 : 0xef4444);
        cMat.emissiveIntensity = 0.4;
        targetLight.color.setHex(0x22c55e); targetLight.intensity = 1.5;
        cursorLight.color.setHex(0xfbbf24);
        s.streakStart = 0; s.currentStreakMs = 0;
      }
      setStreak(Math.round(s.currentStreakMs / 1000));

      // Interference rings wobble
      interferenceRings.forEach(r => {
        r.phase += r.speed * 0.016;
        r.mesh.rotation.x = Math.sin(r.phase) * 0.3;
        r.mesh.rotation.y = Math.cos(r.phase * 0.7) * 0.3;
        r.mesh.position.copy(targetRing.position);
      });

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    // Touch fallback — drag cursor
    const onPointerMove = (e: PointerEvent) => {
      const s2 = stateRef.current;
      if (!s2.running || s2.deviceMotionGranted) return;
      const ndcX = (e.clientX / window.innerWidth) * 2 - 1;
      const ndcY = -((e.clientY / window.innerHeight) * 2 - 1);
      s2.velX += (ndcX * 3 - s2.cursorX) * 0.04;
      s2.velY += (ndcY * 2 - s2.cursorY) * 0.04;
    };
    if (mountRef.current) mountRef.current.addEventListener('pointermove', onPointerMove);
    (s as any)._inputCleanup = () => mountRef.current?.removeEventListener('pointermove', onPointerMove);
  }, [endGame]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    stopMusicRef.current?.();
    const s = stateRef.current;
    if (s.renderer) s.renderer.dispose();
    (s as any)._cleanup?.(); (s as any)._inputCleanup?.(); (s as any)._motionCleanup?.();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);

  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false); setStreak(0); prevScoreRef.current = 0; }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #0a0a0a 0%, #050505 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Hold Steady 🎯" sensorNote="Uses phone accelerometer. Hold your phone flat and still."
          accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={() => startLoop()} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <>
          <GameHUD accentColor={accent} items={[
            { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
            { label: 'SCORE', value: scoreDisplay },
          ]} />
          <ScorePopEffect pops={pops} accentColor={accent} />
          <StreakBadge streak={streak} accentColor={accent} />
        </>
      )}
      <AnimatePresence>
        {isNewBest && phase === 'done' && (
          <motion.div key="nb" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)', zIndex: 90, background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', borderRadius: 20, padding: '8px 20px', fontSize: 20, fontWeight: 900, color: '#000', whiteSpace: 'nowrap' }}>
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={[
              { label: 'On Target', value: `${Math.round(finalSig.onTargetMs / (DURATION * 10))}%`, color: accent },
              { label: 'Best Hold', value: `${(finalSig.maxStreakMs / 1000).toFixed(1)}s`, color: '#fbbf24' },
              { label: 'Stability', value: `${Math.round(finalSig.stability * 100)}%`, color: '#06b6d4' },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.onTargetMs > DURATION * 400} />
          <WebhookHelper theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

function WebhookHelper({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score, onTargetMs: sig.onTargetMs, stability: sig.stability }, player); }, [theme, sig, personality, player]);
  return null;
}
