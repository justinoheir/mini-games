/**
 * ROWING RHYTHM — 3D Version
 * Swipe L/R to row. 3D river with animated boat.
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
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';

const GAME_ID = 'rowing-rhythm';
const PB_KEY = 'pb_rowing-rhythm';
const ACCENT = '#0ea5e9';
const DURATION = 30;
const GAME_EMOJI = '🚣';
const GAME_TITLE = 'Rowing Rhythm';
const GAME_TAGLINE = 'Alternate L + R strokes. Find the rhythm.';
const IDEAL_INTERVAL_MS = 700;
const RHYTHM_TOLERANCE = 250;

type StrokeSide = 'left' | 'right' | 'none';
type StrokeQuality = 'perfect' | 'good' | 'miss';

interface Signals {
  score: number; strokes: number; perfectStrokes: number; goodStrokes: number;
  missedStrokes: number; maxStreak: number; streak: number; distanceM: number;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const total = sig.strokes;
  if (total === 0) return 'Dock Sitter 🛥️';
  const perfRate = total > 0 ? sig.perfectStrokes / total : 0;
  if (perfRate >= 0.7 && sig.maxStreak >= 8) return 'Olympic Rower 🥇';
  if (perfRate >= 0.5) return 'Rhythm Machine 🎵';
  if (sig.strokes >= 30) return 'Power Stroke 💪';
  return 'Learning the Catch 🚣';
}

export default function RowingRhythmGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const endCalledRef = useRef(false);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    boatGroup: null as THREE.Group | null,
    oarLeft: null as THREE.Mesh | null,
    oarRight: null as THREE.Mesh | null,
    waterGroup: null as THREE.Group | null,
    wakeParticles: [] as { mesh: THREE.Mesh; vx: number; vz: number; life: number }[],
    running: false, timeLeft: DURATION,
    sig: { score: 0, strokes: 0, perfectStrokes: 0, goodStrokes: 0, missedStrokes: 0, maxStreak: 0, streak: 0, distanceM: 0 } as Signals,
    lastSide: 'none' as StrokeSide,
    lastStrokeTime: 0,
    strokeIntervals: [] as number[],
    boatSpeed: 0, boatSpeedTarget: 1,
    waterOffset: 0,
    oarAnim: { side: 'none' as StrokeSide, phase: 0, quality: 'good' as StrokeQuality },
    strokeFlash: 0,
    pointerStart: null as { x: number; y: number; time: number } | null,
    beatInterval: IDEAL_INTERVAL_MS,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [strokeMsg, setStrokeMsg] = useState<{ text: string; color: string } | null>(null);
  const [sidePrompt, setSidePrompt] = useState<StrokeSide>('left');
  const [isNewBest, setIsNewBest] = useState(false);
  const [streak, setStreak] = useState(0);
  const { pops, triggerPop } = useScorePop();
  const playerSessionRef = useRef<PlayerSession | null>(null);
  const msgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevScoreRef = useRef(0);

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
    stopMusicRef.current?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    try {
      const prev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (s.sig.score > prev) { localStorage.setItem(PB_KEY, String(s.sig.score)); setIsNewBest(true); }
    } catch { /* ignore */ }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const handleStroke = useCallback((side: 'left' | 'right') => {
    const s = stateRef.current;
    if (!s.running) return;
    const now = Date.now();
    const expectedSide = s.lastSide === 'left' ? 'right' : 'left';
    if (s.lastSide !== 'none' && side !== expectedSide) {
      s.sig.missedStrokes++; s.sig.streak = 0; setStreak(0);
      s.boatSpeedTarget = Math.max(0.5, s.boatSpeedTarget - 0.3);
      sfx.nearMiss(); hapticFail();
      setStrokeMsg({ text: '❌ Wrong side!', color: '#fca5a5' });
      if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
      msgTimerRef.current = setTimeout(() => setStrokeMsg(null), 900);
      return;
    }
    let quality: StrokeQuality = 'good', points = 1;
    if (s.lastStrokeTime > 0) {
      const interval = now - s.lastStrokeTime;
      s.strokeIntervals.push(interval);
      if (s.strokeIntervals.length > 8) s.strokeIntervals.shift();
      const diff = Math.abs(interval - IDEAL_INTERVAL_MS);
      if (diff <= 100) { quality = 'perfect'; points = 3; s.sig.perfectStrokes++; }
      else { quality = 'good'; points = diff <= RHYTHM_TOLERANCE ? 2 : 1; s.sig.goodStrokes++; }
    } else { s.sig.goodStrokes++; }
    s.sig.strokes++; s.sig.streak++;
    if (s.sig.streak > s.sig.maxStreak) s.sig.maxStreak = s.sig.streak;
    const bonusMult = 1 + Math.floor(s.sig.streak / 5) * 0.5;
    s.sig.score += Math.round(points * bonusMult);
    s.sig.distanceM += quality === 'perfect' ? 18 : 12;
    s.lastSide = side; s.lastStrokeTime = now;
    s.boatSpeedTarget = Math.min(8, s.boatSpeedTarget + (quality === 'perfect' ? 1.2 : 0.7));
    s.oarAnim = { side, phase: 0, quality };
    s.strokeFlash = quality === 'perfect' ? 8 : 4;
    // Wake particles
    if (s.scene) {
      for (let i = 0; i < 6; i++) {
        const geo = new THREE.SphereGeometry(0.06, 4, 4);
        const mat = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.7 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(side === 'left' ? -0.5 : 0.5, -0.3, 0.5 + Math.random() * 0.3);
        s.scene.add(mesh);
        s.wakeParticles.push({ mesh, vx: (side === 'left' ? -1 : 1) * (0.02 + Math.random() * 0.03), vz: 0.04 + Math.random() * 0.04, life: 25 });
      }
    }
    hapticScore();
    setStrokeMsg({ text: quality === 'perfect' ? '🌊 Perfect Catch!' : side === 'left' ? '← Pull!' : 'Pull! →', color: quality === 'perfect' ? '#34d399' : '#7dd3fc' });
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    msgTimerRef.current = setTimeout(() => setStrokeMsg(null), 700);
    setScoreDisplay(s.sig.score); setStreak(s.sig.streak);
    setSidePrompt(side === 'left' ? 'right' : 'left');
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    endCalledRef.current = false;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, strokes: 0, perfectStrokes: 0, goodStrokes: 0, missedStrokes: 0, maxStreak: 0, streak: 0, distanceM: 0 };
    s.lastSide = 'none'; s.lastStrokeTime = 0; s.strokeIntervals = [];
    s.boatSpeed = 0; s.boatSpeedTarget = 1; s.waterOffset = 0; s.wakeParticles = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setStreak(0); setSidePrompt('left');
    stopMusicRef.current = startMusic('sports');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a2a3e);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x082030, 15, 35);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 2.5, 5);
    camera.lookAt(0, 0, -2);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x0a2a3e, 4));
    const sun = new THREE.DirectionalLight(0x7dd3fc, 2);
    sun.position.set(3, 8, 5);
    scene.add(sun);
    const pointLight = new THREE.PointLight(0x0ea5e9, 3, 15);
    pointLight.position.set(0, 3, 0);
    scene.add(pointLight);

    // River banks
    const bankMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.9 });
    const leftBank = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 40), bankMat);
    leftBank.position.set(-4.5, -0.35, -10);
    scene.add(leftBank);
    const rightBank = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 40), bankMat);
    rightBank.position.set(4.5, -0.35, -10);
    scene.add(rightBank);

    // Water plane (scrolling)
    const waterGeo = new THREE.PlaneGeometry(7, 60, 20, 60);
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x0c4a6e, transparent: true, opacity: 0.85, roughness: 0.1, metalness: 0.2 });
    const waterPlane = new THREE.Mesh(waterGeo, waterMat);
    waterPlane.rotation.x = -Math.PI / 2;
    waterPlane.position.y = -0.3;
    waterPlane.position.z = -10;
    scene.add(waterPlane);
    s.waterGroup = new THREE.Group();
    s.waterGroup.add(waterPlane);
    scene.add(s.waterGroup);

    // Boat
    const boatGroup = new THREE.Group();
    const hullGeo = new THREE.BoxGeometry(1.2, 0.2, 2.5);
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.5, metalness: 0.4 });
    const hull = new THREE.Mesh(hullGeo, hullMat);
    boatGroup.add(hull);
    // Rower
    const rowerBody = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, 0.25), new THREE.MeshStandardMaterial({ color: 0x0ea5e9 }));
    rowerBody.position.y = 0.35;
    boatGroup.add(rowerBody);
    const rowerHead = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshStandardMaterial({ color: 0xfde68a }));
    rowerHead.position.y = 0.72;
    boatGroup.add(rowerHead);
    // Oars
    const oarMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8 });
    const oarGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.8, 6);
    const oarLeft = new THREE.Mesh(oarGeo, oarMat.clone());
    oarLeft.position.set(-0.7, 0.1, 0);
    oarLeft.rotation.z = Math.PI / 2.5;
    boatGroup.add(oarLeft);
    s.oarLeft = oarLeft;
    const oarRight = new THREE.Mesh(oarGeo, oarMat.clone());
    oarRight.position.set(0.7, 0.1, 0);
    oarRight.rotation.z = -Math.PI / 2.5;
    boatGroup.add(oarRight);
    s.oarRight = oarRight;
    boatGroup.position.set(0, 0.1, 0);
    scene.add(boatGroup);
    s.boatGroup = boatGroup;

    // Lane markers
    for (let i = 0; i < 8; i++) {
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 0.8),
        new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 })
      );
      marker.position.set(0, -0.2, -i * 5);
      scene.add(marker);
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

    const loop = () => {
      if (!s.running) return;
      const t = Date.now() * 0.001;
      s.boatSpeed += (s.boatSpeedTarget - s.boatSpeed) * 0.08;
      s.boatSpeedTarget = Math.max(0.5, s.boatSpeedTarget - 0.012);
      s.waterOffset += s.boatSpeed * 0.005;

      // Boat bob
      boatGroup.position.y = 0.1 + Math.sin(t * 2) * 0.04;
      boatGroup.rotation.z = Math.sin(t * 1.5) * 0.02;

      // Oar animation
      if (s.oarAnim.phase < 1) {
        s.oarAnim.phase = Math.min(1, s.oarAnim.phase + 0.06);
        const oarPhase = Math.sin(s.oarAnim.phase * Math.PI);
        const isLeft = s.oarAnim.side === 'left';
        const oar = isLeft ? oarLeft : oarRight;
        const dir = isLeft ? 1 : -1;
        oar.rotation.z = dir * (Math.PI / 2.5 - oarPhase * 0.5);
        const mat = oar.material as THREE.MeshStandardMaterial;
        mat.color.setHex(s.oarAnim.quality === 'perfect' ? 0x34d399 : 0x94a3b8);
        mat.emissive.setHex(s.oarAnim.quality === 'perfect' ? 0x34d399 : 0x000000);
        mat.emissiveIntensity = oarPhase * 0.5;
      }

      // Water scroll (move water plane back)
      waterPlane.position.z = -10 + (s.waterOffset % 1) * 3;

      // Water waves
      const wpos = (waterGeo.attributes.position as THREE.BufferAttribute).array as Float32Array;
      for (let i = 0; i < wpos.length / 3; i++) {
        const xi = wpos[i * 3], zi = wpos[i * 3 + 2];
        wpos[i * 3 + 1] = Math.sin(xi * 2 + t * 1.5 + s.waterOffset * 3) * 0.06 + Math.cos(zi * 1.5 + t) * 0.04;
      }
      (waterGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      waterGeo.computeVertexNormals();

      // Wake particles
      for (let i = s.wakeParticles.length - 1; i >= 0; i--) {
        const wp = s.wakeParticles[i];
        wp.mesh.position.x += wp.vx;
        wp.mesh.position.z += wp.vz;
        wp.life--;
        (wp.mesh.material as THREE.MeshStandardMaterial).opacity = wp.life / 25 * 0.7;
        if (wp.life <= 0) { scene.remove(wp.mesh); s.wakeParticles.splice(i, 1); }
      }

      // Stroke flash
      if (s.strokeFlash > 0) {
        s.strokeFlash--;
        pointLight.intensity = 3 + s.strokeFlash;
        pointLight.color.setHex(s.strokeFlash > 4 ? 0x34d399 : 0x0ea5e9);
      } else {
        pointLight.intensity = 2;
        pointLight.color.setHex(0x0ea5e9);
      }

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    // Swipe detection
    const onPointerDown = (e: PointerEvent) => { stateRef.current.pointerStart = { x: e.clientX, y: e.clientY, time: Date.now() }; };
    const onPointerUp = (e: PointerEvent) => {
      const s2 = stateRef.current;
      if (!s2.pointerStart || !s2.running) { s2.pointerStart = null; return; }
      const dx = e.clientX - s2.pointerStart.x;
      const dy = e.clientY - s2.pointerStart.y;
      const dt = Date.now() - s2.pointerStart.time;
      s2.pointerStart = null;
      if (Math.abs(dx) > 30 && Math.abs(dx) / Math.max(1, Math.abs(dy)) > 1.5 && dt < 600) {
        handleStroke(dx < 0 ? 'left' : 'right');
      }
    };
    if (mountRef.current) {
      mountRef.current.addEventListener('pointerdown', onPointerDown);
      mountRef.current.addEventListener('pointerup', onPointerUp);
    }
    (s as any)._inputCleanup = () => {
      mountRef.current?.removeEventListener('pointerdown', onPointerDown);
      mountRef.current?.removeEventListener('pointerup', onPointerUp);
    };
  }, [endGame, handleStroke]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    stopMusicRef.current?.();
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    const s = stateRef.current;
    if (s.renderer) s.renderer.dispose();
    (s as any)._cleanup?.(); (s as any)._inputCleanup?.();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
  }, []);

  const handlePlayAgain = useCallback(() => {
    endCalledRef.current = false;
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false); setStreak(0);
    prevScoreRef.current = 0;
    setPhase('countdown');
  }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #0c4a6e 0%, #082f49 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Row! →" sensorNote="Swipe LEFT then RIGHT alternating to row."
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
            { label: 'SCORE', value: scoreDisplay },
          ]} />
          <div style={{ position: 'fixed', top: '13%', left: '50%', transform: 'translateX(-50%)', zIndex: 50, pointerEvents: 'none', fontSize: 13, color: 'rgba(255,255,255,0.5)', letterSpacing: 2, textTransform: 'uppercase' }}>
            {sidePrompt === 'left' ? '← Swipe Left' : 'Swipe Right →'}
          </div>
        </>
      )}
      <AnimatePresence>
        {strokeMsg && phase === 'playing' && (
          <motion.div key="smsg" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            style={{ position: 'fixed', top: '30%', left: '50%', transform: 'translateX(-50%)', zIndex: 80, pointerEvents: 'none', fontSize: 24, fontWeight: 900, color: strokeMsg.color, whiteSpace: 'nowrap' }}>
            {strokeMsg.text}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isNewBest && phase === 'done' && (
          <motion.div key="nb" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)', zIndex: 90, background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', borderRadius: 20, padding: '8px 20px', fontSize: 20, fontWeight: 900, color: '#000', whiteSpace: 'nowrap' }}>
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>
      {phase === 'playing' && <ScorePopEffect pops={pops} accentColor={accent} />}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Distance', value: `${finalSig.distanceM}m`, color: accent },
            { label: 'Perfect Strokes', value: `${finalSig.perfectStrokes}`, color: '#34d399' },
            { label: 'Total Strokes', value: `${finalSig.strokes}`, color: accent },
            { label: 'Best Streak', value: `${finalSig.maxStreak}x`, color: '#fde68a' },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.strokes >= 15}
        />
      )}
      {phase === 'done' && finalSig && (() => {
        const s = stateRef.current;
        postWebhook(theme, GAME_ID, { personality: getPersonality(finalSig), score: finalSig.score, strokes: finalSig.strokes, distanceM: finalSig.distanceM }, playerSessionRef.current);
        return null;
      })()}
    </GameShell>
  );
}
