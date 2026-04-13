'use client';
/**
 * SPIRAL THROW — 3D Version
 * 3D football field. Tilt to aim, tap to throw at receiver's route.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, increaseMusicTempo } from '@/lib/audio';
import { playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { createTiltController } from '@/lib/tilt';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';

const GAME_ID = 'spiral-throw';
const PB_KEY = 'pb_spiral-throw';
const ACCENT = '#b45309';
const DURATION = 45;
const GAME_EMOJI = '🏈';
const GAME_TITLE = 'Spiral Throw';

type Route = 'curl' | 'out' | 'post' | 'go';
interface Signals { attempts: number; completions: number; interceptions: number; score: number; leadPasses: number; deepThrows: number; fastDecisions: number; catchStreak: number; streakMax: number; }
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const total = sig.attempts || 1;
  const compRate = sig.completions / total;
  const leadRate = sig.leadPasses / total;
  if (compRate > 0.7 && leadRate > 0.65) return '🔭 Visionary';
  if (Math.min(1.0, sig.deepThrows / total) > 0.5) return '🚀 Trailblazer';
  if (sig.streakMax >= 4) return '🔥 Energizer';
  return '🧭 Explorer';
}

const ROUTES: Route[] = ['curl', 'out', 'post', 'go'];

function makeRoutePoints(route: Route): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  switch (route) {
    case 'go': for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector3(0, 0, -i * 1.5)); break;
    case 'curl':
      for (let i = 0; i <= 4; i++) pts.push(new THREE.Vector3(0, 0, -i * 1.2));
      for (let i = 0; i <= 3; i++) pts.push(new THREE.Vector3(i * 0.7, 0, -4.8));
      break;
    case 'out':
      for (let i = 0; i <= 4; i++) pts.push(new THREE.Vector3(0, 0, -i * 1.2));
      for (let i = 0; i <= 4; i++) pts.push(new THREE.Vector3(i * 1.0, 0, -4.8 - i * 0.3));
      break;
    case 'post':
      for (let i = 0; i <= 4; i++) pts.push(new THREE.Vector3(0, 0, -i * 1.2));
      for (let i = 0; i <= 4; i++) pts.push(new THREE.Vector3(i * 0.8, 0, -4.8 - i * 0.8));
      break;
  }
  return pts;
}

function SpiralThrowGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const tiltRef = useRef<ReturnType<typeof createTiltController> | null>(null);
  const touchRef = useRef(false);
  const endCalledRef = useRef(false);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    ballMesh: null as THREE.Mesh | null,
    receiverMesh: null as THREE.Mesh | null,
    receiverGroup: null as THREE.Group | null,
    routeLine: null as THREE.Line | null,
    ballLight: null as THREE.PointLight | null,
    fieldGroup: null as THREE.Group | null,
    running: false, timeLeft: DURATION,
    sig: { attempts: 0, completions: 0, interceptions: 0, score: 0, leadPasses: 0, deepThrows: 0, fastDecisions: 0, catchStreak: 0, streakMax: 0 } as Signals,
    route: 'go' as Route,
    routePoints: [] as THREE.Vector3[],
    receiverT: 0, receiverSpeed: 0.015,
    ballInFlight: false, ballPos: new THREE.Vector3(), ballVel: new THREE.Vector3(),
    tiltX: 0, targetAimX: 0,
    routePhase: 'run' as 'run' | 'wait',
    decisionTimer: 0,
    throwWindowStart: 0,
    flashTimer: 0, flashColor: 0xffffff,
    gameStartMs: 0,
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
    if (endCalledRef.current) return;
    endCalledRef.current = true;
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    stopMusicRef.current?.(); tiltRef.current?.stop();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    playVictoryFanfare(); hapticVictory();
    try { const pb = parseInt(localStorage.getItem(PB_KEY) || '0', 10); if (s.sig.score > pb) { localStorage.setItem(PB_KEY, String(s.sig.score)); setIsNewBest(true); } } catch { /* ignore */ }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startNewPlay = useCallback(() => {
    const s = stateRef.current;
    s.route = ROUTES[Math.floor(Math.random() * ROUTES.length)];
    s.routePoints = makeRoutePoints(s.route);
    s.receiverT = 0; s.receiverSpeed = 0.01 + s.sig.completions * 0.001;
    s.ballInFlight = false; s.routePhase = 'run';
    s.decisionTimer = 0; s.throwWindowStart = 0;
    if (s.receiverGroup) s.receiverGroup.position.set(0, 0.5, -1);
    if (s.ballMesh) { s.ballMesh.position.set(0, 0.3, 3); s.ballMesh.visible = true; }
    // Update route line
    if (s.scene) {
      if (s.routeLine) s.scene.remove(s.routeLine);
      const routeGeo = new THREE.BufferGeometry().setFromPoints(s.routePoints.map(p => p.clone().add(new THREE.Vector3(0, 0.5, -1))));
      const routeLine = new THREE.Line(routeGeo, new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.5 }));
      s.scene.add(routeLine);
      s.routeLine = routeLine;
    }
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    endCalledRef.current = false;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { attempts: 0, completions: 0, interceptions: 0, score: 0, leadPasses: 0, deepThrows: 0, fastDecisions: 0, catchStreak: 0, streakMax: 0 };
    s.tiltX = 0; s.targetAimX = 0;
    s.gameStartMs = Date.now();
    setScoreDisplay(0); setTimeLeft(DURATION); setStreak(0);
    stopMusicRef.current = startMusic('sports');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a1a0a);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a1a0a, 20, 50);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 3, 7);
    camera.lookAt(0, 0, -3);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x0a1a0a, 4));
    const stadiumLight = new THREE.PointLight(0xffffff, 3, 40);
    stadiumLight.position.set(0, 12, 0);
    scene.add(stadiumLight);
    const endZoneLight = new THREE.PointLight(0xb45309, 2, 20);
    endZoneLight.position.set(0, 6, -15);
    scene.add(endZoneLight);
    const ballLight = new THREE.PointLight(0xfbbf24, 0, 8);
    scene.add(ballLight);
    s.ballLight = ballLight;

    // Football field
    const fieldGroup = new THREE.Group();
    const fieldGeo = new THREE.PlaneGeometry(10, 40);
    const fieldMat = new THREE.MeshStandardMaterial({ color: 0x1a4d1a, roughness: 0.9 });
    const field = new THREE.Mesh(fieldGeo, fieldMat);
    field.rotation.x = -Math.PI / 2;
    field.position.set(0, 0, -15);
    fieldGroup.add(field);
    // Yard lines
    for (let yl = 0; yl <= 5; yl++) {
      const yardLine = new THREE.Mesh(new THREE.PlaneGeometry(10, 0.08), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 }));
      yardLine.rotation.x = -Math.PI / 2;
      yardLine.position.set(0, 0.01, -yl * 6 - 3);
      fieldGroup.add(yardLine);
    }
    // End zone
    const endZone = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), new THREE.MeshStandardMaterial({ color: 0x2d3a0a, roughness: 0.9 }));
    endZone.rotation.x = -Math.PI / 2;
    endZone.position.set(0, 0.01, -32);
    fieldGroup.add(endZone);
    // Goal posts
    const postMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.4 });
    const postGroup = new THREE.Group();
    { const _post1 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 6), postMat); _post1.position.set(0, 3, -35); postGroup.add(_post1); }
    { const _bar1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 6), postMat); _bar1.position.set(-1.25, 6, -35); _bar1.rotation.set(0, 0, Math.PI/2); postGroup.add(_bar1); }
    { const _bar2 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 6), postMat); _bar2.position.set(1.25, 6, -35); _bar2.rotation.set(0, 0, Math.PI/2); postGroup.add(_bar2); }
    fieldGroup.add(postGroup);
    scene.add(fieldGroup);
    s.fieldGroup = fieldGroup;

    // Ball
    const ballGeo = new THREE.SphereGeometry(0.2, 12, 8);
    ballGeo.scale(0.7, 1, 0.7);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.6 });
    const ballMesh = new THREE.Mesh(ballGeo, ballMat);
    ballMesh.position.set(0, 0.3, 3);
    scene.add(ballMesh);
    s.ballMesh = ballMesh;

    // Receiver
    const receiverGroup = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.7, 8), new THREE.MeshStandardMaterial({ color: 0xb45309 }));
    body.position.y = 0.35;
    receiverGroup.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshStandardMaterial({ color: 0xfde68a }));
    head.position.y = 0.9;
    receiverGroup.add(head);
    receiverGroup.position.set(0, 0, -1);
    scene.add(receiverGroup);
    s.receiverGroup = receiverGroup;
    s.receiverMesh = body;

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    (s as any)._cleanup = () => window.removeEventListener('resize', handleResize);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      sfx.tick();
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    startNewPlay();

    const GRAVITY = -0.012;

    const loop = () => {
      if (!s.running) return;
      const t = Date.now() * 0.001;

      // Move receiver along route
      if (!s.ballInFlight && s.routePhase === 'run') {
        s.receiverT = Math.min(1, s.receiverT + s.receiverSpeed);
        if (s.routePoints.length >= 2) {
          const idx = Math.floor(s.receiverT * (s.routePoints.length - 1));
          const nextIdx = Math.min(s.routePoints.length - 1, idx + 1);
          const alpha = s.receiverT * (s.routePoints.length - 1) - idx;
          const pos = s.routePoints[idx].clone().lerp(s.routePoints[nextIdx], alpha).add(new THREE.Vector3(0, 0.5, -1));
          receiverGroup.position.lerp(pos, 0.15);
          if (s.receiverT >= 1) { s.routePhase = 'wait'; }
        }
      }

      // Ball flight
      if (s.ballInFlight) {
        s.ballPos.add(s.ballVel);
        s.ballVel.y += GRAVITY;
        ballMesh.position.copy(s.ballPos);
        ballMesh.rotation.x += 0.15;
        ballLight.position.copy(s.ballPos);
        ballLight.intensity = 3;
        // Check catch
        const distToReceiver = s.ballPos.distanceTo(receiverGroup.position);
        if (distToReceiver < 0.8) {
          // Caught!
          const throwDist = Math.abs(s.ballPos.z - 3);
          s.sig.completions++; s.sig.catchStreak++;
          if (s.sig.catchStreak > s.sig.streakMax) s.sig.streakMax = s.sig.catchStreak;
          if (throwDist > 8) s.sig.deepThrows++;
          const pts = 2 + Math.floor(s.sig.catchStreak / 3);
          s.sig.score += pts; setScoreDisplay(s.sig.score); setStreak(s.sig.catchStreak);
          sfx.success(); hapticScore();
          s.flashTimer = 20; s.flashColor = 0x22c55e;
          s.ballInFlight = false;
          setTimeout(() => startNewPlay(), 600);
        }
        // Miss
        if (s.ballPos.y < -1 || s.ballPos.z < -40) {
          s.ballInFlight = false; s.sig.interceptions++; s.sig.catchStreak = 0; setStreak(0);
          sfx.collision(); hapticFail();
          s.flashTimer = 20; s.flashColor = 0xef4444;
          ballLight.intensity = 0;
          ballMesh.visible = false;
          setTimeout(() => startNewPlay(), 600);
        }
      } else {
        ballMesh.rotation.z = Math.sin(t * 2) * 0.1;
      }

      // Aim indicator
      s.targetAimX += (s.tiltX * 3 - s.targetAimX) * 0.1;

      // Flash effect
      if (s.flashTimer > 0) {
        s.flashTimer--;
        renderer.setClearColor(new THREE.Color(s.flashColor).lerp(new THREE.Color(0x0a1a0a), 1 - s.flashTimer / 20));
      } else {
        renderer.setClearColor(0x0a1a0a);
      }

      // Receiver glow when in throw window
      const recMat = body.material as THREE.MeshStandardMaterial;
      const inWindow = !s.ballInFlight && (s.routePhase === 'wait' || s.receiverT > 0.6);
      recMat.emissive.setHex(inWindow ? 0xfbbf24 : 0x000000);
      recMat.emissiveIntensity = inWindow ? 0.5 + Math.sin(t * 4) * 0.2 : 0;

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    // Throw on tap
    const onTap = (e: PointerEvent) => {
      const s2 = stateRef.current;
      if (!s2.running || s2.ballInFlight) return;
      s2.sig.attempts++;
      const aimX = (e.clientX / window.innerWidth - 0.5) * 6;
      const receiverPos = receiverGroup.position.clone();
      const ballStart = new THREE.Vector3(0, 0.5, 3);
      const dir = receiverPos.clone().sub(ballStart);
      const lead = dir.clone().normalize().multiplyScalar(dir.length() * 0.3);
      const aimOffset = new THREE.Vector3(aimX * 0.3, 0, 0);
      const target = receiverPos.clone().add(lead).add(aimOffset);
      const travelFrames = 25 + Math.abs(target.z - ballStart.z) * 1.5;
      const vel = target.clone().sub(ballStart).divideScalar(travelFrames);
      vel.y = Math.max(0.08, -GRAVITY * travelFrames / 2 + 0.05);
      s2.ballPos.copy(ballStart);
      s2.ballVel.copy(vel);
      s2.ballInFlight = true;
      ballMesh.visible = true;
      const elapsed = Date.now() - s2.gameStartMs;
      if (elapsed < 2000) s2.sig.fastDecisions++;
      const isLead = target.z < receiverPos.z;
      if (isLead) s2.sig.leadPasses++;
      sfx.collect(); haptic([30]);
    };
    if (mountRef.current) mountRef.current.addEventListener('pointerdown', onTap);
    (s as any)._inputCleanup = () => mountRef.current?.removeEventListener('pointerdown', onTap);
  }, [endGame, startNewPlay]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    stopMusicRef.current?.(); tiltRef.current?.stop();
    const s = stateRef.current;
    if (s.renderer) s.renderer.dispose();
    (s as any)._cleanup?.(); (s as any)._inputCleanup?.();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio();
    const ctrl = createTiltController(x => { stateRef.current.tiltX = x; }, { sensitivity: 1.0, smoothing: 0.4, deadzone: 2, clamp: 20 });
    const granted = await ctrl.start();
    if (granted) { tiltRef.current = ctrl; touchRef.current = false; }
    else { ctrl.stop(); touchRef.current = true; }
    setPhase('countdown');
  }, []);

  const handlePlayAgain = useCallback(async () => {
    tiltRef.current?.stop(); tiltRef.current = null;
    endCalledRef.current = false;
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false); setStreak(0);
    prevScoreRef.current = 0;
    setPhase('countdown');
  }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #0a1a0a 0%, #050f05 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="Watch the receiver run their route, then tap to throw! Time it right."
          ctaLabel="Hike! 🏈" sensorNote="Tilt to adjust aim. Tap to throw."
          accentColor={accent} ctaTextColor="#fff" onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={() => { startLoop(); setPhase('playing'); }} accentColor={accent} />}
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
              { label: 'Completions', value: `${finalSig.completions}/${finalSig.attempts}`, color: '#4ade80' },
              { label: 'Best Streak', value: `${finalSig.streakMax}x`, color: accent },
              { label: 'Deep Throws', value: String(finalSig.deepThrows), color: '#fbbf24' },
              { label: 'Lead Passes', value: String(finalSig.leadPasses), color: '#06b6d4' },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.completions >= 8} />
          <WebhookHelper theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

function WebhookHelper({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score, completions: sig.completions, attempts: sig.attempts }, player); }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const SpiralThrowGame = dynamic(() => Promise.resolve({ default: SpiralThrowGameInner }), { ssr: false });
export default SpiralThrowGame;
