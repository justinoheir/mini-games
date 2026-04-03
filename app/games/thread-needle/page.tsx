'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { motion, AnimatePresence } from 'framer-motion';

const GAME_ID = 'thread-needle';
const ACCENT = '#f472b6';
const DURATION = 45;
const GAME_EMOJI = '🪡';
const GAME_TITLE = 'Thread Needle';
const GAME_TAGLINE = 'Guide the thread through the moving eye.';
const PB_KEY = 'mg_pb_thread-needle';

interface Signals { score: number; attempts: number; maxStreak: number; streakCurrent: number; nearMisses: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.score / sig.attempts : 0;
  if (acc >= 0.8 && sig.score >= 6) return 'Master Tailor 🧵';
  if (acc >= 0.6 && sig.score >= 4) return 'Steady Stitcher 🪡';
  if (sig.score >= 3) return 'Thread Wrangler 🧶';
  if (sig.nearMisses > sig.score * 2) return 'Almost Had It 😤';
  return 'Tangled Beginner 🤕';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function ThreadNeedleGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    sig: { score: 0, attempts: 0, maxStreak: 0, streakCurrent: 0, nearMisses: 0 } as Signals,
    needleOscPhase: 0, needleSpeed: 1.2,
    threadX: 0, threadY: -2, anchorX: 0, anchorY: -3.5,
    dragging: false, threaded: false, inEye: false,
    flashGreen: 0, flashRed: 0,
    lastNearMiss: 0,
    frame: 0,
    needleMesh: null as THREE.Group | null,
    threadLineMesh: null as THREE.Line | null,
    threadEndMesh: null as THREE.Mesh | null,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streakDisplay, setStreakDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [scorePop, setScorePop] = useState<string | null>(null);
  const [nearMsg, setNearMsg] = useState(false);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; if (!s.running) return;
    s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    sfx.gameOver(); haptic([100]);
    try { const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0', 10); if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score)); } catch { }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { score: 0, attempts: 0, maxStreak: 0, streakCurrent: 0, nearMisses: 0 };
    s.needleOscPhase = 0; s.needleSpeed = 1.2;
    s.threadX = 0; s.threadY = -2; s.anchorX = 0; s.anchorY = -3.5;
    s.dragging = false; s.threaded = false; s.inEye = false;
    setScoreDisplay(0); setStreakDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('minimal');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1a0010);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x1a0010, 15, 40);
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x220011, 2));
    const pLight = new THREE.PointLight(0xf472b6, 4, 20);
    pLight.position.set(0, 5, 3);
    scene.add(pLight);
    const sLight = new THREE.PointLight(0xe879f9, 2, 15);
    sLight.position.set(-4, 0, 5);
    scene.add(sLight);

    // Fabric texture background (grid lines)
    for (let i = -5; i <= 5; i++) {
      const hGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-6, i * 0.6, -1), new THREE.Vector3(6, i * 0.6, -1)]);
      scene.add(new THREE.Line(hGeo, new THREE.LineBasicMaterial({ color: 0xf472b6, transparent: true, opacity: 0.06 })));
    }

    // Needle group
    const needleGroup = new THREE.Group();
    scene.add(needleGroup);
    s.needleMesh = needleGroup;

    // Needle body (metallic silver)
    const needleBodyGeo = new THREE.CylinderGeometry(0.05, 0.02, 3, 8);
    const needleBodyMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.2, metalness: 0.9, emissive: 0x888888, emissiveIntensity: 0.1 });
    const needleBody = new THREE.Mesh(needleBodyGeo, needleBodyMat);
    needleBody.position.y = -0.5;
    needleGroup.add(needleBody);

    // Needle eye hole (highlighted ring)
    const eyeGeo = new THREE.TorusGeometry(0.18, 0.04, 8, 32);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xf472b6, emissive: 0xf472b6, emissiveIntensity: 0.8 });
    const eyeMesh = new THREE.Mesh(eyeGeo, eyeMat);
    eyeMesh.position.y = 1.0;
    needleGroup.add(eyeMesh);

    // Needle tip
    const tipGeo = new THREE.ConeGeometry(0.06, 0.4, 8);
    const tipMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.1, metalness: 1 });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.y = -2.1;
    needleGroup.add(tip);

    // Anchor (bobbin)
    const anchorGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.3, 16);
    const anchorMat = new THREE.MeshStandardMaterial({ color: 0xf472b6, emissive: 0xf472b6, emissiveIntensity: 0.5 });
    const anchor = new THREE.Mesh(anchorGeo, anchorMat);
    anchor.position.set(s.anchorX, s.anchorY, 0);
    scene.add(anchor);

    // Thread endpoint
    const threadEndGeo = new THREE.SphereGeometry(0.12, 12, 12);
    const threadEndMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf472b6, emissiveIntensity: 0.6 });
    const threadEnd = new THREE.Mesh(threadEndGeo, threadEndMat);
    threadEnd.position.set(s.threadX, s.threadY, 0);
    scene.add(threadEnd);
    s.threadEndMesh = threadEnd;

    // Thread line
    const threadPoints = [new THREE.Vector3(s.anchorX, s.anchorY, 0), new THREE.Vector3(s.threadX, s.threadY, 0)];
    const threadGeo = new THREE.BufferGeometry().setFromPoints(threadPoints);
    const threadLine = new THREE.Line(threadGeo, new THREE.LineBasicMaterial({ color: 0xf472b6, linewidth: 2 }));
    scene.add(threadLine);
    s.threadLineMesh = threadLine;

    // Glow sphere for success flash
    const flashGeo = new THREE.SphereGeometry(5, 16, 16);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0, side: THREE.BackSide });
    const flashSphere = new THREE.Mesh(flashGeo, flashMat);
    scene.add(flashSphere);

    const SWING = 3.5;

    const onDown = (e: PointerEvent) => {
      if (!s.running) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 12;
      const ny = -((e.clientY - rect.top) / rect.height - 0.5) * 9;
      const dist = Math.hypot(nx - s.threadX, ny - s.threadY);
      if (dist < 0.8) {
        s.dragging = true;
        s.sig.attempts++;
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!s.running || !s.dragging) return;
      const rect = renderer.domElement.getBoundingClientRect();
      s.threadX = ((e.clientX - rect.left) / rect.width - 0.5) * 12;
      s.threadY = -((e.clientY - rect.top) / rect.height - 0.5) * 9;
    };
    const onUp = () => {
      if (!s.dragging) return;
      s.dragging = false;
      if (!s.threaded) { s.sig.streakCurrent = 0; setStreakDisplay(0); }
      s.threadX = s.anchorX; s.threadY = s.anchorY;
      s.threaded = false;
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', onUp);

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) { sfx.warning(); haptic([50, 30, 50]); }
      else if (s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;
      const now = Date.now();

      // Oscillate needle
      s.needleOscPhase += 0.018 * s.needleSpeed;
      const needleX = Math.sin(s.needleOscPhase) * SWING;
      const needleY = 1.5;
      if (needleGroup) needleGroup.position.set(needleX, needleY, 0);

      // Eye position in world space
      const eyeX = needleX;
      const eyeY = needleY + 1.0;

      // Update thread line
      const pts = [
        new THREE.Vector3(s.anchorX, s.anchorY, 0),
        new THREE.Vector3((s.anchorX + s.threadX) / 2, (s.anchorY + s.threadY) / 2 - 0.3, 0.2),
        new THREE.Vector3(s.threadX, s.threadY, 0),
      ];
      if (threadLine && threadLine.geometry) {
        threadLine.geometry.setFromPoints(pts);
      }
      if (threadEnd) threadEnd.position.set(s.threadX, s.threadY, 0);

      // Check eye collision
      const dEye = Math.hypot(s.threadX - eyeX, s.threadY - eyeY);
      const inEyeNow = dEye < 0.2 && s.dragging;
      const nearEye = dEye < 0.5 && s.dragging;

      // Eye glow based on proximity
      (eyeMat as THREE.MeshStandardMaterial).emissiveIntensity = nearEye ? 2 : 0.8;
      (eyeMat as THREE.MeshStandardMaterial).color.setHex(nearEye ? 0x4ade80 : 0xf472b6);

      if (inEyeNow && !s.threaded && s.dragging) {
        s.threaded = true;
        s.sig.score++; s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        s.needleSpeed = Math.min(3.5, 1.2 + s.sig.score * 0.2);
        s.flashGreen = now + 300;
        setScoreDisplay(s.sig.score); setStreakDisplay(s.sig.streakCurrent);
        sfx.collect(); haptic([30]);
        const bonus = s.sig.streakCurrent >= 3 ? '+2 🔥' : '+1';
        setScorePop(bonus);
        setTimeout(() => setScorePop(null), 700);
      } else if (!inEyeNow && s.threaded) {
        s.threaded = false;
      }

      // Near miss
      if (s.dragging && !inEyeNow && nearEye) {
        if (now - s.lastNearMiss > 2000) {
          s.lastNearMiss = now; s.sig.nearMisses++;
          setNearMsg(true); setTimeout(() => setNearMsg(false), 1000);
        }
      }

      // Flash effects
      if (now < s.flashGreen) {
        const p = Math.max(0, 1 - (now - (s.flashGreen - 300)) / 300);
        flashMat.opacity = p * 0.15;
        flashMat.color.setHex(0x4ade80);
      } else {
        flashMat.opacity = 0;
      }

      // Pulse needle eye
      eyeMesh.rotation.y = s.frame * 0.03;

      // Light pulse
      pLight.intensity = 4 + Math.sin(s.frame * 0.05) * 0.8;

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => () => {
    const s = stateRef.current; s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (stopMusicRef.current) stopMusicRef.current();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    if (stateRef.current.renderer) { stateRef.current.renderer.dispose(); stateRef.current.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setPhase('start'); setScoreDisplay(0); setStreakDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent} background="linear-gradient(180deg,#1a0010 0%,#0d0008 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start Threading →" accentColor={accent} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <GameHUD accentColor={accent} items={[{ label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 10, testId: 'timer' }, { label: 'SCORE', value: scoreDisplay, testId: 'score' }, { label: 'STREAK', value: streakDisplay, testId: 'streak' }]} />}
      <AnimatePresence>
        {scorePop && <motion.div key="pop" initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1.3 }} exit={{ opacity: 0, y: -40 }} transition={{ duration: 0.5 }} style={{ position: 'fixed', top: '35%', left: '50%', transform: 'translateX(-50%)', zIndex: 80, pointerEvents: 'none', fontSize: 48, fontWeight: 900, color: '#4ade80', textShadow: '0 0 20px #4ade80' }}>{scorePop}</motion.div>}
      </AnimatePresence>
      <AnimatePresence>
        {nearMsg && <motion.div key="near" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} style={{ position: 'fixed', top: '22%', left: '50%', transform: 'translateX(-50%)', zIndex: 80, pointerEvents: 'none', fontSize: 22, fontWeight: 800, color: '#fbbf24', whiteSpace: 'nowrap' }}>Almost! 🪡</motion.div>}
      </AnimatePresence>
      {phase === 'done' && finalSig && <>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Threads Passed', value: String(finalSig.score), color: accent }, { label: 'Attempts', value: String(finalSig.attempts), color: '#94a3b8' }, { label: 'Best Streak', value: `${finalSig.maxStreak}x`, color: '#fbbf24' }, { label: 'Near Misses', value: String(finalSig.nearMisses), color: '#f97316' }]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 3} />
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      </>}
    </GameShell>
  );
}
