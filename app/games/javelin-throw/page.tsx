'use client';
/**
 * JAVELIN THROW — 3D stadium with physics arc throw.
 * Swipe up-right with power and angle for max distance.
 */
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
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';

const GAME_ID = 'javelin-throw';
const PB_KEY = 'pb_javelin-throw';
const ACCENT = '#a78bfa';
const DURATION = 30;
const GAME_EMOJI = '🥇';
const GAME_TITLE = 'Javelin Throw';
const GAME_TAGLINE = 'Swipe up with power and angle for max distance.';

const GRAVITY = 9.8;
const PIXELS_PER_M = 0.8;

interface Signals {
  score: number; bestThrow: number; throws: number;
  goodThrows: number; optimalThrows: number; maxStreak: number; streak: number;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  if (sig.bestThrow >= 70) return 'Olympic Champion 🥇';
  if (sig.bestThrow >= 55 && sig.optimalThrows >= 3) return 'Technical Master 🎯';
  if (sig.bestThrow >= 50) return 'Power Thrower ⚡';
  if (sig.optimalThrows >= 4) return 'Angle Expert 📐';
  if (sig.goodThrows >= 4) return 'Consistent Athlete 💪';
  return 'Javelin Rookie 🏃';
}

export default function JavelinThrowGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  const endCalledRef = useRef(false);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { score: 0, bestThrow: 0, throws: 0, goodThrows: 0, optimalThrows: 0, maxStreak: 0, streak: 0 } as Signals,
    javelin: null as THREE.Group | null,
    javelinActive: false, javelinLanded: false,
    jVx: 0, jVy: 0, jVz: 0,
    jPos: new THREE.Vector3(-8, 1, 0),
    landMarkers: [] as THREE.Mesh[],
    particles: [] as { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }[],
    pointerStart: null as { x: number; y: number; time: number } | null,
    isCharging: false, aimVector: null as { x: number; y: number } | null,
    prevBest: 0, screenFlash: 0,
    scene: null as THREE.Scene | null,
    renderer: null as THREE.WebGLRenderer | null,
    camera: null as THREE.PerspectiveCamera | null,
    groundY: -2.5,
    throwOriginX: -8,
    aimArrow: null as THREE.Line | null,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [throwMsg, setThrowMsg] = useState<{ text: string; color: string } | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const { pops, triggerPop } = useScorePop();
  const prevScoreRef = useRef(0);
  const msgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (scoreDisplay > prevScoreRef.current)
      triggerPop(`+${scoreDisplay - prevScoreRef.current}`, window.innerWidth / 2, 200);
    prevScoreRef.current = scoreDisplay;
  }, [scoreDisplay, triggerPop]);

  const endGame = useCallback(() => {
    if (endCalledRef.current) return;
    endCalledRef.current = true;
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    stopMusicRef.current?.(); stopMusicRef.current = null;
    sfx.gameOver();
    try {
      const prev = parseFloat(localStorage.getItem(PB_KEY) || '0');
      if (s.sig.bestThrow > prev) { localStorage.setItem(PB_KEY, String(s.sig.bestThrow)); setIsNewBest(true); }
    } catch { /**/ }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    if (!mountRef.current) return;
    const s = stateRef.current;
    endCalledRef.current = false;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, bestThrow: 0, throws: 0, goodThrows: 0, optimalThrows: 0, maxStreak: 0, streak: 0 };
    s.javelinActive = false; s.javelinLanded = false;
    s.landMarkers = []; s.particles = []; s.screenFlash = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('sports');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0f172a);
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0f172a, 30, 80);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 200);
    camera.position.set(0, 2, 12);
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    // Lights
    scene.add(new THREE.AmbientLight(0x1e1b4b, 4));
    const sunLight = new THREE.DirectionalLight(0xffd700, 2);
    sunLight.position.set(10, 20, 5);
    scene.add(sunLight);
    const purpleLight = new THREE.PointLight(0xa78bfa, 3, 30);
    purpleLight.position.set(-5, 5, 5);
    scene.add(purpleLight);

    // Ground / field
    const groundGeo = new THREE.PlaneGeometry(100, 40);
    const groundMat = new THREE.MeshPhongMaterial({ color: 0x166534 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = s.groundY;
    scene.add(ground);

    // Field lines
    for (let i = 0; i < 15; i++) {
      const lineGeo = new THREE.PlaneGeometry(0.05, 40);
      const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 });
      const lineMesh = new THREE.Mesh(lineGeo, lineMat);
      lineMesh.rotation.x = -Math.PI / 2;
      lineMesh.position.set(-8 + i * 5, s.groundY + 0.01, 0);
      scene.add(lineMesh);

      // Distance labels as small markers
      if (i > 0) {
        const markerGeo = new THREE.BoxGeometry(0.08, 0.2, 0.05);
        const markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
        const marker = new THREE.Mesh(markerGeo, markerMat);
        marker.position.set(-8 + i * 5, s.groundY + 0.1, 0);
        scene.add(marker);
      }
    }

    // Stadium stands (simplified)
    for (let side = -1; side <= 1; side += 2) {
      const standGeo = new THREE.BoxGeometry(80, 8, 3);
      const standMat = new THREE.MeshPhongMaterial({ color: 0x1e1b4b, emissive: 0x0f0e2a });
      const stand = new THREE.Mesh(standGeo, standMat);
      stand.position.set(0, s.groundY + 2, side * 22);
      scene.add(stand);
    }

    // Athlete (simplified stick figure)
    const athleteGroup = new THREE.Group();
    // Head
    const headGeo = new THREE.SphereGeometry(0.25, 12, 12);
    const athleteMat = new THREE.MeshPhongMaterial({ color: 0xa78bfa, emissive: 0x4c1d95 });
    athleteGroup.add(new THREE.Mesh(headGeo, athleteMat));
    // Body
    const bodyGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.8);
    const bodyMesh = new THREE.Mesh(bodyGeo, athleteMat);
    bodyMesh.position.y = -0.65;
    athleteGroup.add(bodyMesh);
    // Legs
    for (let side = -1; side <= 1; side += 2) {
      const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.7);
      const leg = new THREE.Mesh(legGeo, athleteMat);
      leg.position.set(side * 0.15, -1.2, 0);
      athleteGroup.add(leg);
    }
    athleteGroup.position.set(s.throwOriginX, s.groundY + 1.5, 0);
    scene.add(athleteGroup);

    // Javelin
    const javelinGroup = new THREE.Group();
    const shaftGeo = new THREE.CylinderGeometry(0.04, 0.04, 3.5);
    const shaftMat = new THREE.MeshPhongMaterial({ color: 0xa78bfa, emissive: 0x4c1d95, shininess: 120 });
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.rotation.z = Math.PI / 2;
    javelinGroup.add(shaft);
    // Tip
    const tipGeo = new THREE.ConeGeometry(0.07, 0.5, 8);
    const tipMat = new THREE.MeshPhongMaterial({ color: 0xfde68a, emissive: 0x78350f });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.x = 2;
    tip.rotation.z = Math.PI / 2;
    javelinGroup.add(tip);
    javelinGroup.position.copy(s.jPos);
    scene.add(javelinGroup);
    s.javelin = javelinGroup;
    s.jPos.set(s.throwOriginX, s.groundY + 1.5, 0);
    javelinGroup.position.copy(s.jPos);

    // Aim arrow line
    const aimGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const aimMat = new THREE.LineDashedMaterial({ color: 0xa78bfa, dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0.6 });
    const aimArrow = new THREE.Line(aimGeo, aimMat);
    aimArrow.computeLineDistances();
    scene.add(aimArrow);
    s.aimArrow = aimArrow;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      sfx.tick();
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    let t = 0;
    const loop = () => {
      if (!s.running) { renderer.dispose(); return; }
      t += 0.016;

      // Animate athlete legs
      const legAngle = Math.sin(t * 4) * 0.3;
      if (athleteGroup.children.length >= 3) {
        (athleteGroup.children[2] as THREE.Mesh).rotation.z = legAngle;
        if (athleteGroup.children[3]) (athleteGroup.children[3] as THREE.Mesh).rotation.z = -legAngle;
      }

      if (s.javelinActive && s.javelin) {
        // Physics
        s.jVy -= GRAVITY * 0.016;
        s.jPos.x += s.jVx * 0.016;
        s.jPos.y += s.jVy * 0.016;
        s.javelin.position.copy(s.jPos);

        // Javelin rotates to face velocity direction
        const speed = Math.sqrt(s.jVx ** 2 + s.jVy ** 2);
        if (speed > 0.3) {
          s.javelin.rotation.z = -Math.atan2(s.jVy, s.jVx);
        }

        // Landing
        if (s.jPos.y <= s.groundY + 0.1) {
          s.jPos.y = s.groundY + 0.1;
          s.javelinActive = false; s.javelinLanded = true;

          const distM = Math.max(0, (s.jPos.x - s.throwOriginX) * PIXELS_PER_M);
          const launchAngleDeg = Math.abs(Math.atan2(-s.jVy, s.jVx) * 180 / Math.PI);
          const isOptimal = launchAngleDeg >= 33 && launchAngleDeg <= 52;
          if (isOptimal) s.sig.optimalThrows++;
          if (distM >= 30) s.sig.goodThrows++;

          s.sig.throws++;
          if (distM > s.sig.bestThrow) {
            s.sig.streak++; if (s.sig.streak > s.sig.maxStreak) s.sig.maxStreak = s.sig.streak;
            s.sig.bestThrow = distM;
            hapticVictory(); sfx.collect(); s.screenFlash = 0.8;
          } else {
            s.sig.streak = 0; sfx.nearMiss(); haptic([20, 30, 20]);
          }

          const pts = Math.round(distM * 0.8);
          s.sig.score += pts;
          setScoreDisplay(s.sig.score);

          // Land marker
          const markerGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.5);
          const markerMat = new THREE.MeshPhongMaterial({ color: 0xfbbf24, emissive: 0x78350f });
          const markerMesh = new THREE.Mesh(markerGeo, markerMat);
          markerMesh.position.set(s.jPos.x, s.groundY + 0.25, 0);
          scene.add(markerMesh);
          s.landMarkers.push(markerMesh);
          if (s.landMarkers.length > 6) { scene.remove(s.landMarkers.shift()!); }

          // Particles
          for (let p = 0; p < 10; p++) {
            const pGeo = new THREE.SphereGeometry(0.07, 6, 6);
            const pMat = new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 1 });
            const pm = new THREE.Mesh(pGeo, pMat);
            pm.position.copy(s.jPos);
            scene.add(pm);
            s.particles.push({ mesh: pm, vx: (Math.random() - 0.5) * 0.15, vy: Math.random() * 0.1, vz: (Math.random() - 0.5) * 0.1, life: 1 });
          }

          const msg = distM >= 60 ? `🌟 ${distM.toFixed(0)}m — INCREDIBLE!` :
            distM >= 45 ? `🎯 ${distM.toFixed(0)}m — Great!` :
              distM >= 30 ? `💪 ${distM.toFixed(0)}m — Nice!` : `${distM.toFixed(0)}m`;
          const color = distM >= 60 ? '#fde68a' : distM >= 45 ? '#86efac' : '#7dd3fc';
          setThrowMsg({ text: msg, color });
          if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
          msgTimerRef.current = setTimeout(() => {
            setThrowMsg(null);
            if (s.running && s.javelin) {
              s.javelinLanded = false;
              s.jPos.set(s.throwOriginX, s.groundY + 1.5, 0);
              s.javelin.position.copy(s.jPos);
              s.javelin.rotation.z = -0.7;
            }
          }, 1400);
        }
      }

      // Update aim arrow
      if (s.aimVector && s.aimArrow && !s.javelinActive) {
        const len = Math.sqrt(s.aimVector.x ** 2 + s.aimVector.y ** 2);
        if (len > 10) {
          const nx = s.aimVector.x / len, ny = -s.aimVector.y / len;
          const pts2 = [s.jPos.clone(), new THREE.Vector3(s.jPos.x + nx * 3, s.jPos.y + ny * 3, 0)];
          s.aimArrow.geometry.setFromPoints(pts2);
          s.aimArrow.computeLineDistances();
          (s.aimArrow.material as THREE.LineDashedMaterial).opacity = 0.6;
        }
      } else if (s.aimArrow) {
        (s.aimArrow.material as THREE.LineDashedMaterial).opacity = 0;
      }

      // Update particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.vy -= 0.004; p.life -= 0.03;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life;
        if (p.life <= 0) { scene.remove(p.mesh); s.particles.splice(i, 1); }
      }

      // Screen flash
      if (s.screenFlash > 0) {
        purpleLight.intensity = 3 + s.screenFlash * 5;
        s.screenFlash -= 0.04;
      } else {
        purpleLight.intensity = 3;
      }

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      s.running = false;
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [endGame, triggerPop]);

  useEffect(() => {
    const el = mountRef.current; if (!el) return;
    const onDown = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running || s.javelinActive) return;
      s.pointerStart = { x: e.clientX, y: e.clientY, time: Date.now() };
      s.isCharging = true;
    };
    const onMove = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.pointerStart) return;
      s.aimVector = { x: e.clientX - s.pointerStart.x, y: e.clientY - s.pointerStart.y };
    };
    const onUp = (e: PointerEvent) => {
      const s = stateRef.current;
      s.isCharging = false;
      if (!s.running || !s.pointerStart || s.javelinActive) { s.pointerStart = null; s.aimVector = null; return; }
      const dx = e.clientX - s.pointerStart.x;
      const dy = e.clientY - s.pointerStart.y;
      const dt = Math.max(1, Date.now() - s.pointerStart.time);
      s.pointerStart = null; s.aimVector = null;
      const dist2d = Math.sqrt(dx * dx + dy * dy);
      if (dist2d < 25) return;
      const speedPx = dist2d / (dt / 1000);
      const power = Math.min(speedPx / 80, 18);
      const nx = dx / dist2d, ny = dy / dist2d;
      // Convert screen swipe to 3D velocity (screen up = y+, screen right = x+)
      s.jVx = nx * power * 0.5;
      s.jVy = -ny * power * 0.5;  // invert screen Y
      s.jVz = 0;
      s.javelinActive = true; s.javelinLanded = false;
      hapticScore();
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    stopMusicRef.current?.();
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    stateRef.current.renderer?.dispose();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    endCalledRef.current = false;
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false);
    prevScoreRef.current = 0; setPhase('countdown');
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg,#0f172a 0%,#1e1b4b 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Step up to Throw →" sensorNote="Swipe up-right on screen to throw"
          accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%,#1e1040 0%,#0f0828 60%,#05030f 100%)" />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none', touchAction: 'none' }} />
      {phase === 'playing' && (
        <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 5, testId: 'timer' },
          { label: 'SCORE', value: scoreDisplay, testId: 'score' },
        ]} />
      )}
      <AnimatePresence>
        {throwMsg && phase === 'playing' && (
          <motion.div key="tmsg" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -30 }}
            style={{ position: 'fixed', top: '24%', left: '50%', transform: 'translateX(-50%)', zIndex: 80, pointerEvents: 'none', fontSize: 22, fontWeight: 900, color: throwMsg.color, textShadow: `0 0 16px ${throwMsg.color}aa`, whiteSpace: 'nowrap' }}>
            {throwMsg.text}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isNewBest && phase === 'done' && (
          <motion.div key="nb" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)', zIndex: 90, background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', borderRadius: 20, padding: '8px 20px', fontSize: 20, fontWeight: 900, color: '#000', whiteSpace: 'nowrap' }}>
            🏆 New Record!
          </motion.div>
        )}
      </AnimatePresence>
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={`${finalSig.bestThrow.toFixed(1)}m`} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Best Throw', value: `${finalSig.bestThrow.toFixed(1)}m`, color: '#fbbf24' },
            { label: 'Good Throws', value: `${finalSig.goodThrows}`, color: '#4ade80' },
            { label: 'Optimal Angle', value: `${finalSig.optimalThrows}x`, color: theme.colors.accent ?? ACCENT },
            { label: 'Total Throws', value: `${finalSig.throws}`, color: '#94a3b8' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.bestThrow >= 40} />
      )}
      {phase === 'done' && finalSig && <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />}
      {phase === 'playing' && <ScorePopEffect pops={pops} accentColor={theme.colors.accent ?? ACCENT} />}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, bestThrow: sig.bestThrow, throws: sig.throws, optimalThrows: sig.optimalThrows }, player);
  }, [theme, sig, personality, player]);
  return null;
}
