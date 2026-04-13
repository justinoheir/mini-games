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

const ACCENT = '#22c55e';
const GAME_ID = 'penalty-kick';
const PB_KEY = 'pb_penalty-kick';
const MAX_SHOTS = 10;

interface Signals { shots: number; goals: number; cornerShots: number; powerSum: number; curveShots: number; score: number; }
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const total = sig.shots || 1;
  const cornerRate = sig.cornerShots / total;
  const powerAvg = sig.powerSum / total;
  if (cornerRate > 0.6 && powerAvg >= 50 && powerAvg <= 80) return '🎯 Composed Finisher';
  if (powerAvg > 80) return '💥 Power Shooter';
  if (sig.goals / total >= 0.8) return '⚽ Clinical';
  return '⚽ Striker';
}

function PenaltyKickInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const ballRef = useRef<THREE.Mesh | null>(null);
  const keeperRef = useRef<THREE.Group | null>(null);
  const accentLightRef = useRef<THREE.PointLight | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  const { pops, triggerPop } = useScorePop();

  const stateRef = useRef({
    running: false, streak: 0,
    sig: { shots: 0, goals: 0, cornerShots: 0, powerSum: 0, curveShots: 0, score: 0 } as Signals,
    // Shot state
    phase: 'aim' as 'aim' | 'shooting' | 'result',
    // Aim: swipe direction
    swipeStartX: 0, swipeStartY: 0, swipeStartTime: 0, isSwiping: false,
    // Ball animation
    ballTargetX: 0, ballTargetY: 0, ballT: 0, ballSpeed: 0,
    // Keeper
    keeperDir: 0, // -1, 0, 1
    shotResult: '' as '' | 'GOAL!' | 'SAVED!' | 'MISS!',
    resultTimer: 0,
    power: 50,
    // Charge
    charging: false, chargeStart: 0,
    accentColor: ACCENT,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [shotsDisplay, setShotsDisplay] = useState(0);
  const [goalsDisplay, setGoalsDisplay] = useState(0);
  const [streak, setStreak] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [shotMsg, setShotMsg] = useState('');

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    playVictoryFanfare(); hapticVictory();
    try {
      const prev = parseInt(localStorage.getItem(PB_KEY) ?? '0');
      if (s.sig.goals > prev) { localStorage.setItem(PB_KEY, String(s.sig.goals)); setIsNewBest(true); }
    } catch { /**/ }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const shoot = useCallback((targetX: number, targetY: number, power: number) => {
    const s = stateRef.current;
    if (s.phase !== 'aim' || !s.running) return;
    s.phase = 'shooting';
    s.sig.shots++; s.sig.powerSum += power;
    setShotsDisplay(s.sig.shots);
    // Corner detection
    if (Math.abs(targetX) > 1.5) s.sig.cornerShots++;
    // Random keeper dive
    const keeperChoice = Math.random() < 0.5 ? (targetX < 0 ? -1 : 1) : 0;
    s.keeperDir = keeperChoice;
    s.ballTargetX = targetX; s.ballTargetY = targetY; s.ballT = 0; s.ballSpeed = 0.03 * (power / 50);
    sfx.collect(); hapticScore();
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true;
    s.sig = { shots: 0, goals: 0, cornerShots: 0, powerSum: 0, curveShots: 0, score: 0 };
    s.phase = 'aim'; s.resultTimer = 0;
    setShotsDisplay(0); setGoalsDisplay(0); setPhase('playing');
    stopMusicRef.current = startMusic('sports');

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1a0a);
    scene.fog = new THREE.Fog(0x0a1a0a, 20, 50);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 2, 9);
    camera.lookAt(0, 2, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    scene.add(new THREE.AmbientLight(0x1a2a1a, 2));
    scene.add(Object.assign(new THREE.DirectionalLight(0xffffff, 0.8), { position: new THREE.Vector3(5, 10, 5), castShadow: true }));
    const aLight = new THREE.PointLight(0x22c55e, 40, 20);
    aLight.position.set(0, 4, 5);
    scene.add(aLight);
    accentLightRef.current = aLight;

    // Pitch (ground)
    const pitchGeo = new THREE.PlaneGeometry(20, 30);
    const pitchMat = new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.9 });
    const pitch = new THREE.Mesh(pitchGeo, pitchMat);
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.y = -0.5;
    pitch.receiveShadow = true;
    scene.add(pitch);
    // Penalty spot
    const spotGeo = new THREE.CircleGeometry(0.15, 16);
    const spotMesh = new THREE.Mesh(spotGeo, new THREE.MeshStandardMaterial({ color: 0xffffff }));
    spotMesh.rotation.x = -Math.PI / 2;
    spotMesh.position.set(0, -0.49, 5);
    scene.add(spotMesh);

    // Goal frame
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x555555, roughness: 0.2, metalness: 0.8 });
    const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 4, 8);
    const crossGeo = new THREE.CylinderGeometry(0.06, 0.06, 4.12, 8);
    const leftPost = new THREE.Mesh(postGeo, postMat);
    leftPost.position.set(-2, 1.5, -2);
    scene.add(leftPost);
    const rightPost = new THREE.Mesh(postGeo, postMat);
    rightPost.position.set(2, 1.5, -2);
    scene.add(rightPost);
    const crossbar = new THREE.Mesh(crossGeo, postMat);
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.set(0, 3.5, -2);
    scene.add(crossbar);
    // Net (simple mesh)
    const netGeo = new THREE.PlaneGeometry(4, 3.5);
    const netMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, transparent: true, opacity: 0.15, side: THREE.DoubleSide, wireframe: true });
    const net = new THREE.Mesh(netGeo, netMat);
    net.position.set(0, 1.75, -2.5);
    scene.add(net);

    // Ball
    const ballGeo = new THREE.SphereGeometry(0.22, 24, 24);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const ball = new THREE.Mesh(ballGeo, ballMat);
    ball.position.set(0, -0.28, 5);
    ball.castShadow = true;
    scene.add(ball);
    ballRef.current = ball;

    // Keeper
    const keeperGroup = new THREE.Group();
    const torsoGeo = new THREE.BoxGeometry(0.6, 0.8, 0.25);
    const keeperMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5 });
    keeperGroup.add(new THREE.Mesh(torsoGeo, keeperMat));
    const headGeo = new THREE.SphereGeometry(0.2, 12, 12);
    const head = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xfbbf24 }));
    head.position.y = 0.6;
    keeperGroup.add(head);
    keeperGroup.position.set(0, 1.5, -2.1);
    scene.add(keeperGroup);
    keeperRef.current = keeperGroup;

    // Input: swipe to aim & shoot
    const onDown = (e: PointerEvent) => {
      if (!s.running || s.phase !== 'aim') return;
      s.isSwiping = true; s.swipeStartX = e.clientX; s.swipeStartY = e.clientY;
      s.swipeStartTime = Date.now(); s.charging = true; s.chargeStart = Date.now();
    };
    const onUp = (e: PointerEvent) => {
      if (!s.running || !s.isSwiping || s.phase !== 'aim') return;
      s.isSwiping = false; s.charging = false;
      const holdMs = Date.now() - s.chargeStart;
      const power = Math.min(100, 20 + holdMs / 30);
      const dx = e.clientX - s.swipeStartX;
      const dy = e.clientY - s.swipeStartY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 15) return;
      const normX = dx / Math.max(1, dist);
      const normY = dy / Math.max(1, dist);
      // Map screen swipe to goal target
      const targetX = normX * 2.5;
      const targetY = 2.5 - Math.abs(normY) * 1.5;
      shoot(targetX, targetY, power);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    let t = 0;
    const BALL_START = new THREE.Vector3(0, -0.28, 5);
    const loop = () => {
      if (!s.running) return;
      animRef.current = requestAnimationFrame(loop);
      t += 0.015;

      if (s.phase === 'shooting') {
        s.ballT = Math.min(1, s.ballT + s.ballSpeed);
        // Animate ball toward target
        const tx = s.ballTargetX, ty = s.ballTargetY, tz = -2;
        if (ball) {
          ball.position.x = BALL_START.x + (tx - BALL_START.x) * s.ballT;
          ball.position.y = BALL_START.y + (ty - BALL_START.y) * s.ballT + Math.sin(s.ballT * Math.PI) * 1.2;
          ball.position.z = BALL_START.z + (tz - BALL_START.z) * s.ballT;
          ball.rotation.x += 0.15; ball.rotation.z += 0.1;
        }
        // Keeper dive
        if (keeperGroup) {
          const diveTarget = s.keeperDir * 1.8;
          keeperGroup.position.x += (diveTarget - keeperGroup.position.x) * 0.12;
          keeperGroup.rotation.z += (s.keeperDir * -0.3 - keeperGroup.rotation.z) * 0.1;
        }
        if (s.ballT >= 1) {
          // Determine result
          const goalW = 2.0, goalH = 3.0;
          const inGoal = Math.abs(tx) <= goalW && ty >= 0.3 && ty <= goalH;
          const keeperBlocked = inGoal && Math.sign(tx) === s.keeperDir && Math.abs(tx) > 0.8 && Math.random() < 0.45;
          let result: 'GOAL!' | 'SAVED!' | 'MISS!';
          if (!inGoal) result = 'MISS!';
          else if (keeperBlocked) result = 'SAVED!';
          else result = 'GOAL!';
          s.shotResult = result; s.phase = 'result'; s.resultTimer = 90;
          setShotMsg(result);
          if (result === 'GOAL!') {
            s.sig.goals++; s.sig.score += 10; setGoalsDisplay(s.sig.goals);
            playScoreHit('default', 10); hapticVictory();
            triggerPop('⚽ GOAL!', window.innerWidth / 2, window.innerHeight * 0.4);
          } else { playNearMiss(); hapticFail(); }
          if (accentLightRef.current) accentLightRef.current.color.set(result === 'GOAL!' ? 0x4ade80 : 0xef4444);
        }
      } else if (s.phase === 'result') {
        s.resultTimer--;
        if (s.resultTimer <= 0) {
          setShotMsg('');
          if (s.sig.shots >= MAX_SHOTS) { endGame(); return; }
          // Reset
          s.phase = 'aim';
          if (ball) ball.position.copy(BALL_START);
          if (keeperGroup) { keeperGroup.position.x = 0; keeperGroup.rotation.z = 0; }
          if (accentLightRef.current) accentLightRef.current.color.set(0x22c55e);
        }
      } else {
        // Idle aim: subtle ball bobble
        if (ball) ball.position.y = -0.28 + Math.sin(t * 2) * 0.02;
        if (keeperGroup) keeperGroup.position.x = Math.sin(t * 0.8) * 0.5;
      }

      if (accentLightRef.current) accentLightRef.current.intensity = 30 + Math.sin(t * 3) * 10;
      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
    };
  }, [endGame, shoot, triggerPop]);

  useEffect(() => {
    const onResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      const W = window.innerWidth, H = window.innerHeight;
      cameraRef.current.aspect = W / H; cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(W, H);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(animRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
      if (rendererRef.current && mountRef.current) {
        try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
        rendererRef.current.dispose();
      }
    };
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    stateRef.current.running = false;
    cancelAnimationFrame(animRef.current);
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (rendererRef.current && mountRef.current) {
      try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
      rendererRef.current.dispose(); rendererRef.current = null;
    }
    setShotsDisplay(0); setGoalsDisplay(0); setFinalSig(null); setShotMsg(''); setIsNewBest(false);
    setPhase('countdown');
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  const sig = stateRef.current.sig;
  return (
    <GameShell title="Penalty Kick" emoji="⚽" accentColor={accent}
      background="radial-gradient(ellipse at 50% 80%, rgba(34,197,94,0.12) 0%, transparent 60%), linear-gradient(180deg, #030d03 0%, #0a1a0a 50%, #030d03 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji="⚽" title="Penalty Kick" description="Swipe to aim and shoot. Score before you run out of shots!"
          ctaLabel="Take a Shot →" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} role="application" aria-label="Game area - tap to play" style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <>
              <GameHUD accentColor={accent} items={[
                { label: 'SHOTS', value: `${shotsDisplay}/${MAX_SHOTS}`, testId: 'timer' },
                { label: 'GOALS', value: goalsDisplay, testId: 'score' },
              ]} />
              {shotMsg && (
                <div style={{ position: 'absolute', top: '35%', left: '50%', transform: 'translateX(-50%)',
                  fontSize: 'clamp(32px,10vw,64px)', fontWeight: 900, pointerEvents: 'none', zIndex: 10,
                  color: shotMsg === 'GOAL!' ? '#4ade80' : '#ef4444',
                  textShadow: `0 0 40px ${shotMsg === 'GOAL!' ? '#4ade80' : '#ef4444'}` }}>
                  {shotMsg}
                </div>
              )}
              <div style={{ position: 'absolute', bottom: '8%', left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.4)', fontSize: 13, pointerEvents: 'none' }}>
                Hold & swipe to aim · Release to shoot
              </div>
              <ScorePopEffect pops={pops} accentColor={accent} />
            </>
          )}
        </>
      )}
      <AnimatePresence>
        {isNewBest && phase === 'done' && (
          <motion.div key="nb" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)', zIndex: 90,
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', borderRadius: 20, padding: '8px 20px',
              fontSize: 20, fontWeight: 900, color: '#000', whiteSpace: 'nowrap' }}>
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji="⚽"
            score={`${finalSig.goals}/${MAX_SHOTS}`} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Goals', value: `${finalSig.goals}/${finalSig.shots}`, color: finalSig.goals >= 7 ? '#4ade80' : '#facc15' },
              { label: 'Corner Shots', value: String(finalSig.cornerShots), color: accent },
              { label: 'Avg Power', value: finalSig.shots > 0 ? `${Math.round(finalSig.powerSum/finalSig.shots)}%` : '—', color: '#fbbf24' },
              { label: 'Score', value: String(finalSig.score), color: accent },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.goals >= 6} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, goals: sig.goals, shots: sig.shots }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const PenaltyKick = dynamic(() => Promise.resolve({ default: PenaltyKickInner }), { ssr: false });
export default PenaltyKick;
