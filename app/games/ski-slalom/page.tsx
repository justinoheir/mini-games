/**
 * SKI SLALOM — 3D Version
 * Tilt to steer through 3D gates on a snowy slope.
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
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { createTiltController } from '@/lib/tilt';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';

const GAME_ID = 'ski-slalom';
const PB_KEY = 'pb_ski-slalom';
const ACCENT = '#38bdf8';
const DURATION = 45;
const GAME_EMOJI = '⛷️';
const GAME_TITLE = 'Ski Slalom';
const MAX_LIVES = 3;

function getStageParams(elapsed: number): { speed: number; spawnInterval: number; gapW: number } {
  if (elapsed < 12) return { speed: 0.12, spawnInterval: 140, gapW: 2.4 };
  if (elapsed < 26) return { speed: 0.18, spawnInterval: 110, gapW: 2.0 };
  return { speed: 0.28, spawnInterval: 85, gapW: 1.6 };
}

interface Gate3D { group: THREE.Group; gapCx: number; gapW: number; passed: boolean; hit: boolean; color: number; z: number; }
interface Signals { score: number; gatesPassed: number; gateMisses: number; collisions: number; maxStreak: number; streak: number; nearMisses: number; totalGates: number; }
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const acc = sig.totalGates > 0 ? sig.gatesPassed / sig.totalGates : 0;
  if (sig.collisions === 0 && sig.gatesPassed >= 18) return 'Slalom King 🏆';
  if (acc >= 0.85 && sig.maxStreak >= 8) return 'Precision Carver 🎯';
  if (sig.collisions <= 1 && sig.gatesPassed >= 15) return 'Clean Rider 🌟';
  if (sig.gatesPassed >= 20) return 'Speed Demon 💨';
  return 'Snow Rookie 🎿';
}

export default function SkiSlalomGame() {
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
    skierGroup: null as THREE.Group | null,
    skierX: 0,
    tiltX: 0, touchDir: 0,
    gates: [] as Gate3D[],
    nextGateId: 0, lastSpawnFrame: 0, gameStartTime: 0,
    snowParticles: null as THREE.Points | null,
    snowPos: null as Float32Array | null,
    trailPoints: [] as { pos: THREE.Vector3; mesh: THREE.Mesh }[],
    running: false, lives: MAX_LIVES, timeLeft: DURATION,
    sig: { score: 0, gatesPassed: 0, gateMisses: 0, collisions: 0, maxStreak: 0, streak: 0, nearMisses: 0, totalGates: 0 } as Signals,
    frame: 0,
    flashTimer: 0,
    pointerStart: null as { x: number; y: number } | null,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [streak, setStreak] = useState(0);
  const { pops, triggerPop } = useScorePop();
  const playerSessionRef = useRef<PlayerSession | null>(null);
  const prevScoreRef = useRef(0);

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
    stopMusicRef.current?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    tiltRef.current?.stop();
    sfx.gameOver(); hapticFail();
    try {
      const prev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (s.sig.gatesPassed > prev) { localStorage.setItem(PB_KEY, String(s.sig.gatesPassed)); setIsNewBest(true); }
    } catch { /* ignore */ }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    endCalledRef.current = false;
    s.running = true; s.lives = MAX_LIVES; s.timeLeft = DURATION;
    s.sig = { score: 0, gatesPassed: 0, gateMisses: 0, collisions: 0, maxStreak: 0, streak: 0, nearMisses: 0, totalGates: 0 };
    s.skierX = 0; s.gates = []; s.nextGateId = 0; s.lastSpawnFrame = 0;
    s.gameStartTime = Date.now(); s.frame = 0; s.flashTimer = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setStreak(0);
    stopMusicRef.current = startMusic('sports');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x041218);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xd4eef7, 25, 60);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 3, 6);
    camera.lookAt(0, 0, -5);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0xd4eef7, 3));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(5, 10, 5);
    scene.add(sun);
    const skierLight = new THREE.PointLight(0x38bdf8, 2, 8);
    skierLight.position.set(0, 2, 4);
    scene.add(skierLight);

    // Snow slope
    const slopeGeo = new THREE.PlaneGeometry(14, 80, 20, 80);
    const slopeMat = new THREE.MeshStandardMaterial({ color: 0xf0f8ff, roughness: 0.95 });
    const slope = new THREE.Mesh(slopeGeo, slopeMat);
    slope.rotation.x = -Math.PI / 2;
    slope.position.set(0, -0.3, -30);
    scene.add(slope);

    // Snow particles
    const snowCount = 200;
    const snowPos = new Float32Array(snowCount * 3);
    for (let i = 0; i < snowCount; i++) { snowPos[i*3] = (Math.random()-0.5)*12; snowPos[i*3+1] = Math.random()*8; snowPos[i*3+2] = (Math.random()-0.5)*30 - 10; }
    const snowGeo = new THREE.BufferGeometry(); snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
    const snowPts = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06, transparent: true, opacity: 0.8 }));
    scene.add(snowPts);
    s.snowParticles = snowPts; s.snowPos = snowPos;

    // Skier
    const skierGroup = new THREE.Group();
    const bodyGeo = new THREE.ConeGeometry(0.15, 0.5, 6);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 0.3 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.25;
    skierGroup.add(body);
    const headGeo = new THREE.SphereGeometry(0.12, 8, 8);
    const head = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xfde68a }));
    head.position.y = 0.62;
    skierGroup.add(head);
    // Skis
    const skiMat = new THREE.MeshStandardMaterial({ color: 0x1e40af });
    for (let si = -1; si <= 1; si += 2) {
      const ski = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.7), skiMat);
      ski.position.set(si * 0.12, -0.02, 0);
      skierGroup.add(ski);
    }
    skierGroup.position.set(0, -0.1, 2);
    scene.add(skierGroup);
    s.skierGroup = skierGroup;

    function spawnGate(params: ReturnType<typeof getStageParams>) {
      const gapCx = (Math.random() * 2 - 1) * 3; // -3 to 3 world X
      const gapW = params.gapW;
      const color = s.nextGateId % 2 === 0 ? 0xef4444 : 0x3b82f6;
      const group = new THREE.Group();
      const poleMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 });
      // Left pole
      const leftPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6), poleMat.clone());
      leftPole.position.set(gapCx - gapW / 2, 0.3, 0);
      group.add(leftPole);
      // Left flag
      const leftFlag = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.02), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 }));
      leftFlag.position.set(gapCx - gapW / 2 - 0.2, 0.9, 0);
      group.add(leftFlag);
      // Right pole (opposite color)
      const rColor = color === 0xef4444 ? 0x3b82f6 : 0xef4444;
      const rightPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6), new THREE.MeshStandardMaterial({ color: rColor, emissive: rColor, emissiveIntensity: 0.4 }));
      rightPole.position.set(gapCx + gapW / 2, 0.3, 0);
      group.add(rightPole);
      const rightFlag = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.02), new THREE.MeshStandardMaterial({ color: rColor, emissive: rColor, emissiveIntensity: 0.6 }));
      rightFlag.position.set(gapCx + gapW / 2 + 0.2, 0.9, 0);
      group.add(rightFlag);
      // Connecting wire
      const pts = [new THREE.Vector3(gapCx - gapW / 2, 1.0, 0), new THREE.Vector3(gapCx + gapW / 2, 1.0, 0)];
      const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 }));
      group.add(wire);
      group.position.set(0, -0.3, -40);
      scene.add(group);
      s.gates.push({ group, gapCx, gapW, passed: false, hit: false, color, z: -40 });
      s.sig.totalGates++;
      s.nextGateId++;
    }

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

    const SKIER_Z = 2;
    const SKIER_RADIUS = 0.3;

    const loop = () => {
      if (!s.running) return;
      s.frame++;
      const elapsed = (Date.now() - s.gameStartTime) / 1000;
      const params = getStageParams(elapsed);

      // Move skier
      let moveDir = touchRef.current ? s.touchDir * 1.2 : s.tiltX * 1.5;
      s.skierX = Math.max(-4.5, Math.min(4.5, s.skierX + moveDir * 0.03));
      skierGroup.position.x = s.skierX;
      skierGroup.rotation.z = -moveDir * 0.2;

      // Spawn gates
      if (s.frame - s.lastSpawnFrame >= params.spawnInterval) {
        s.lastSpawnFrame = s.frame;
        spawnGate(params);
      }

      // Snow particles
      if (s.snowPos) {
        for (let i = 0; i < 200; i++) {
          s.snowPos[i*3+2] += params.speed * 0.5;
          if (s.snowPos[i*3+2] > 8) s.snowPos[i*3+2] = -30;
        }
        (snowGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }

      // Process gates
      for (let gi = s.gates.length - 1; gi >= 0; gi--) {
        const gate = s.gates[gi];
        gate.z += params.speed;
        gate.group.position.z = gate.z;
        if (gate.z > 8) { scene.remove(gate.group); s.gates.splice(gi, 1); continue; }
        // Gate pass (z passes skier)
        if (!gate.passed && !gate.hit && gate.z > SKIER_Z - 0.2) {
          gate.passed = true;
          const inGap = Math.abs(s.skierX - gate.gapCx) < gate.gapW / 2 - SKIER_RADIUS * 0.5;
          if (inGap) {
            s.sig.gatesPassed++; s.sig.streak++;
            if (s.sig.streak > s.sig.maxStreak) s.sig.maxStreak = s.sig.streak;
            const pts = 1 + Math.floor(s.sig.streak / 3);
            s.sig.score += pts;
            sfx.collect(); hapticScore();
            setScoreDisplay(s.sig.gatesPassed); setStreak(s.sig.streak);
          } else {
            s.sig.gateMisses++; s.sig.streak = 0; setStreak(0);
            sfx.nearMiss(); haptic([20, 30, 20]);
          }
        }
        // Collision detection
        if (!gate.passed && !gate.hit) {
          const inGateZone = gate.z > SKIER_Z - 0.5 && gate.z < SKIER_Z + 0.5;
          if (inGateZone) {
            const hitLeft = s.skierX < gate.gapCx - gate.gapW / 2 + SKIER_RADIUS;
            const hitRight = s.skierX > gate.gapCx + gate.gapW / 2 - SKIER_RADIUS;
            if (hitLeft || hitRight) {
              gate.hit = true; s.lives--; s.sig.collisions++;
              s.sig.streak = 0; setStreak(0); s.flashTimer = 20;
              sfx.collision(); hapticFail();
              if (s.lives <= 0) setTimeout(() => endGame(), 400);
            }
          }
        }
      }

      // Flash on hit
      if (s.flashTimer > 0) {
        s.flashTimer--;
        renderer.setClearColor(new THREE.Color(1, 0.2, 0.2).lerp(new THREE.Color(0xc8e6f0), 1 - s.flashTimer / 20));
      } else {
        renderer.setClearColor(0x041218);
      }

      // Lives icons (skier light color)
      skierLight.color.setHex(s.lives === 3 ? 0x38bdf8 : s.lives === 2 ? 0xfbbf24 : 0xef4444);
      skierLight.position.set(s.skierX, 2, 4);

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    // Touch controls
    const onDown = (e: PointerEvent) => { stateRef.current.touchDir = e.clientX < window.innerWidth / 2 ? -1 : 1; };
    const onUp = () => { stateRef.current.touchDir = 0; };
    if (mountRef.current) {
      mountRef.current.addEventListener('pointerdown', onDown);
      mountRef.current.addEventListener('pointerup', onUp);
    }
    (s as any)._inputCleanup = () => { mountRef.current?.removeEventListener('pointerdown', onDown); mountRef.current?.removeEventListener('pointerup', onUp); };
  }, [endGame]);

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
    const ctrl = createTiltController(x => { stateRef.current.tiltX = x; }, { sensitivity: 1.1, smoothing: 0.38, deadzone: 2.5, clamp: 28 });
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
    const ctrl = createTiltController(x => { stateRef.current.tiltX = x; }, { sensitivity: 1.1, smoothing: 0.38, deadzone: 2.5, clamp: 28 });
    const granted = await ctrl.start();
    if (granted) { tiltRef.current = ctrl; touchRef.current = false; }
    else { ctrl.stop(); touchRef.current = true; }
    setPhase('countdown');
  }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #e0f2fe 0%, #f0f9ff 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Tilt to carve through 3D gates on a snow slope. Thread every gate!"
          ctaLabel="Hit the Slopes →" sensorNote="Tilt your phone to steer. Tap left/right as fallback."
          accentColor={accent} ctaTextColor="#fff" onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #0c2a4a 0%, #071928 60%, #020d15 100%)" />
      )}
      {phase === 'countdown' && <Countdown onComplete={() => { startLoop(); setPhase('playing'); }} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <>
          <GameHUD accentColor={accent} items={[
            { label: 'TIME', value: timeLeft, danger: timeLeft <= 5 },
            { label: 'GATES', value: scoreDisplay },
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
            score={String(finalSig.gatesPassed)} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Gates Cleared', value: `${finalSig.gatesPassed}`, color: '#4ade80' },
              { label: 'Crashes', value: `${finalSig.collisions}`, color: finalSig.collisions === 0 ? '#4ade80' : '#ef4444' },
              { label: 'Best Streak', value: `${finalSig.maxStreak}x`, color: accent },
              { label: 'Near Misses', value: `${finalSig.nearMisses}`, color: '#a78bfa' },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.gatesPassed >= 15} />
          <WebhookHelper theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

function WebhookHelper({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.gatesPassed, gatesPassed: sig.gatesPassed, collisions: sig.collisions, maxStreak: sig.maxStreak }, player); }, [theme, sig, personality, player]);
  return null;
}
