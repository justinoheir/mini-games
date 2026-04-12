'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, playSuccess, playFail, playMusic, stopMusicFile, preloadGameAudio } from '@/lib/audio';
import { playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { createTiltController } from '@/lib/tilt';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { Orbit, Hand, Smartphone, Mic } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY_ACCENT = '#a855f7'; // game-native purple accent


// --- SPRITE CACHE -------------------------------------------------------------
const _spriteCache = new Map<string, HTMLImageElement>();
function _loadSprite(src: string): HTMLImageElement {
  if (_spriteCache.has(src)) return _spriteCache.get(src)!;
  const img = new Image();
  img.src = src;
  _spriteCache.set(src, img);
  return img;
}
if (typeof window !== 'undefined') {
  _loadSprite('/sprites/pulse-sphere/sphere.svg');
}

const GAME_ID = 'pulse-sphere';
const PB_KEY  = 'pb_pulse-sphere';

type GameState = 'start' | 'permissions' | 'countdown' | 'playing' | 'done';

interface BehaviorData {
  avgVolume: number;
  avgTilt: number;
  touchCount: number;
}

function getPersonality(v: number, m: number, t: number) {
  if (v >= m && v >= t && v > 55) return 'Verbal 🎙️';
  if (m >= v && m >= t && m > 55) return 'Kinetic 🏃';
  if (t >= v && t >= m && t > 55) return 'Tactile 👆';
  return 'Balanced ⚖️';
}

// ─── CSS Radar Chart ─────────────────────────────────────────────────────────
function RadarChart({ voice, movement, touch }: { voice: number; movement: number; touch: number }) {
  const cx = 100, cy = 100, R = 72;
  const angles = [-Math.PI / 2, -Math.PI / 2 + (2 * Math.PI) / 3, -Math.PI / 2 + (4 * Math.PI) / 3];
  const labels = ['Voice', 'Move', 'Touch'];
  const scores = [voice / 100, movement / 100, touch / 100];
  const guide = angles.map(a => ({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }));
  const data  = scores.map((s, i) => ({ x: cx + s * R * Math.cos(angles[i]), y: cy + s * R * Math.sin(angles[i]) }));
  const toStr = (pts: { x: number; y: number }[]) => pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 200 200" width={200} height={200} style={{ overflow: 'visible' }}>
      {guide.map((p, i) => <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#333" strokeWidth={1} />)}
      <polygon points={toStr(guide)} fill="none" stroke="#333" strokeWidth={1} />
      <polygon points={toStr(data)} fill="rgba(168,85,247,0.22)" stroke="#a855f7" strokeWidth={2} />
      {data.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4} fill="#a855f7" />)}
      {guide.map((p, i) => {
        const anchor = p.x < cx - 5 ? 'end' : p.x > cx + 5 ? 'start' : 'middle';
        const dy = p.y < cy - 5 ? -10 : 16;
        const dx = p.x < cx - 5 ? -8 : p.x > cx + 5 ? 8 : 0;
        return <text key={i} x={p.x + dx} y={p.y + dy} fontSize={10} fill="#888" textAnchor={anchor}>{labels[i]}</text>;
      })}
    </svg>
  );
}

function PulseSphereInner() {
  // Haptics gate — respects ?haptics=off URL param (accessibility B-M3)
  // Declared first so all callbacks below can close over it correctly.
  const hapticsEnabled = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('haptics') !== 'off'
    : true;

  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const tiltControllerRef = useRef<ReturnType<typeof createTiltController> | null>(null);
  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    sphere: null as THREE.Mesh | null,
    particles: null as THREE.Points | null,
    particleBasePos: null as Float32Array | null,
    animId: 0, running: false,
    stream: null as MediaStream | null,
    analyser: null as AnalyserNode | null,
    audioCtx: null as AudioContext | null,
    timeLeft: 45, intervalId: null as ReturnType<typeof setInterval> | null,
    // Tracking
    volumeSamples: [] as number[],
    tiltMagnitudes: [] as number[],
    touchCount: 0,
    hue: 280,
    // Joystick
    joystickX: 0, joystickY: 0,
    lastShimmerTime: 0,
    lastWhooshTime: 0,
    // Mic fallback: simulated volume from taps
    fallbackVolume: 0,
    // ⚡ Pre-allocated analyser buffer — avoids new Uint8Array every rAF frame
    dataArray: null as Uint8Array<ArrayBuffer> | null,
  });
  const [gameState, setGameState] = useState<GameState>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft] = useState(45);
  const [behavior, setBehavior] = useState<BehaviorData | null>(null);
  const [joystickEnabled, setJoystickEnabled] = useState(false);
  const [joystickThumb, setJoystickThumb] = useState({ x: 0, y: 0 });
  const [micFallbackEnabled, setMicFallbackEnabled] = useState(false);
  const micFallbackRef = useRef(false);
  const [playerName, setPlayerName]   = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const { pops, triggerPop } = useScorePop();
  const playerSessionRef              = useRef<PlayerSession | null>(null);
  const [streak, setStreak]           = useState(0);
  const [nearMissMsg, setNearMissMsg] = useState(false);
  const [isNewBest, setIsNewBest]     = useState(false);
  const [liveActivity, setLiveActivity] = useState(0);
  const streakRef                     = useRef(0);
  const lastMilestoneRef              = useRef(0);
  const nearMissTimeoutRef            = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Verified: uses getByteFrequencyData, RMS formula correct, smoothingTimeConstant=0.3 ✓
  const getVolume = useCallback((): number => {
    const s = stateRef.current;
    if (micFallbackRef.current) {
      // Decay fallback volume over time (tap = burst, then fade)
      s.fallbackVolume = Math.max(0, s.fallbackVolume * 0.9);
      return s.fallbackVolume;
    }
    if (!s.analyser || !s.dataArray) return 0;
    // ⚡ Reuse pre-allocated buffer — no allocation per frame
    s.analyser.getByteFrequencyData(s.dataArray);
    const sumSq = s.dataArray.reduce((acc, v) => acc + v * v, 0);
    return Math.min(100, (Math.sqrt(sumSq / s.dataArray.length) / 128) * 100);
  }, []);

  const endGame = useCallback((capturedTheme: typeof theme) => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(()=>{/* ignore */});
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    (s as typeof s & { _resizeCleanup?: () => void })._resizeCleanup?.();
    tiltControllerRef.current?.stop();
    const avgVol = s.volumeSamples.length > 0 ? s.volumeSamples.reduce((a,b)=>a+b,0)/s.volumeSamples.length : 0;
    const avgTilt = s.tiltMagnitudes.length > 0 ? s.tiltMagnitudes.reduce((a,b)=>a+b,0)/s.tiltMagnitudes.length : 0;
    const voiceScore = Math.min(100, Math.round(avgVol));
    const moveScore = Math.min(100, Math.round(avgTilt * 100));
    const touchScore = Math.min(100, Math.round((s.touchCount / 30) * 100));
    const bData: BehaviorData = { avgVolume: voiceScore, avgTilt: moveScore, touchCount: touchScore };
    // PB tracking — use combined engagement score
    const engagementScore = Math.round((voiceScore + moveScore + touchScore) / 3);
    try {
      const prev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (engagementScore > prev) {
        localStorage.setItem(PB_KEY, String(engagementScore));
        setIsNewBest(true);
      }
    } catch { /* ignore */ }
    setBehavior(bData);
    setGameState('done');
    postWebhook(capturedTheme, 'pulse-sphere', { score: getPersonality(voiceScore, moveScore, touchScore), personality: getPersonality(voiceScore, moveScore, touchScore), signals: bData }, playerSessionRef.current);
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.volumeSamples = []; s.tiltMagnitudes = []; s.touchCount = 0;
    s.timeLeft = 45; s.running = true; s.hue = 280;
    s.joystickX = 0; s.joystickY = 0;
    streakRef.current = 0; lastMilestoneRef.current = 0;
    setStreak(0); setNearMissMsg(false); setIsNewBest(false);
    setTimeLeft(45); setLiveActivity(0); setGameState('playing');
    stopMusicRef.current = startMusic('ambient');
    playMusic(GAME_ID);
    const capturedTheme = theme;

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x060410);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 200);
    camera.position.set(0, 0, 6);
    // === POLISH: Enhanced rim + fill lighting ===
    const rimLightA = new THREE.PointLight(0x4466ff, 1.2, 20);
    rimLightA.position.set(-6, 5, 3);
    scene.add(rimLightA);
    const fillLightB = new THREE.PointLight(0xff6644, 0.8, 15);
    fillLightB.position.set(6, -3, 5);
    scene.add(fillLightB);
    // === END POLISH ===

    // Star field
    const starCount = 1200;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i*3]   = (Math.random()-0.5)*120;
      starPos[i*3+1] = (Math.random()-0.5)*120;
      starPos[i*3+2] = (Math.random()-0.5)*120;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.08 })));

    // Ambient + point lights
    scene.add(new THREE.AmbientLight(0x221133, 2));
    const pointLight = new THREE.PointLight(0xa855f7, 3, 20);
    pointLight.position.set(0, 0, 4);
    scene.add(pointLight);

    // Sphere
    const sphereGeo = new THREE.SphereGeometry(1, 32, 32);
    const sphereMat = new THREE.MeshPhongMaterial({ color: 0xa855f7, emissive: 0x3b0070, shininess: 80 });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    scene.add(sphere);
    s.sphere = sphere;

    // 200 orbiting particles
    const PARTICLE_COUNT = 200;
    const pPos = new Float32Array(PARTICLE_COUNT * 3);
    const basePos = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 1.8 + Math.random() * 0.6;
      basePos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
      basePos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
      basePos[i*3+2] = r * Math.cos(phi);
      pPos[i*3] = basePos[i*3]; pPos[i*3+1] = basePos[i*3+1]; pPos[i*3+2] = basePos[i*3+2];
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xa855f7, size: 0.06, transparent: true, opacity: 0.85 }));
    scene.add(particles);
    s.particles = particles;
    s.particleBasePos = basePos;

    s.renderer = renderer; s.scene = scene; s.camera = camera;

    // Resize handler
    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    // Store cleanup ref
    (s as typeof s & { _resizeCleanup?: () => void })._resizeCleanup = () => window.removeEventListener('resize', handleResize);

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      // ⚠️ sfx.tick() was firing every second for all 60s — constant metronome noise
      // that destroys the ambient atmosphere. Fixed: warning at 10s, tick only at ≤5s.
      if (s.timeLeft === 10) sfx.warning();
      else if (s.timeLeft <= 5 && s.timeLeft > 0) sfx.tick();
      // Sync streak to React state here (once/sec) instead of inside rAF loop
      setStreak(streakRef.current);
      // Live activity meter — rolling 5-second window for responsive HUD feedback
      const win5v = s.volumeSamples.slice(-5);
      const win5t = s.tiltMagnitudes.slice(-5);
      const recentVol  = win5v.length ? win5v.reduce((a, b) => a + b, 0) / win5v.length : 0;
      const recentTilt = win5t.length ? (win5t.reduce((a, b) => a + b, 0) / win5t.length) * 100 : 0;
      const elapsed    = 45 - s.timeLeft;
      const touchRate  = elapsed > 0 ? Math.min(100, (s.touchCount / elapsed) * 6) : 0;
      setLiveActivity(Math.min(100, Math.round((recentVol + Math.min(100, recentTilt) + touchRate) / 3)));
      if (s.timeLeft <= 0) {
        if (hapticsEnabled) hapticVictory();
        playVictoryFanfare();
        endGame(capturedTheme);
      }
      // Milestone score pops every 10s
      const survived = 45 - s.timeLeft;
      if (survived > 0 && survived % 10 === 0 && survived !== lastMilestoneRef.current) {
        lastMilestoneRef.current = survived;
        if (hapticsEnabled) hapticScore();
        playScoreHit('default', survived);
        triggerPop(`⚡ ${survived}s`, window.innerWidth / 2, 200);
      }
      // Near-miss: 1s before milestone
      const nextMilestone = Math.ceil(survived / 10) * 10;
      if (nextMilestone - survived === 1 && survived > 0 && survived !== lastMilestoneRef.current) {
        playNearMiss();
        setNearMissMsg(true);
        if (nearMissTimeoutRef.current) clearTimeout(nearMissTimeoutRef.current);
        nearMissTimeoutRef.current = setTimeout(() => setNearMissMsg(false), 1500);
      }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const vol = getVolume();
      s.volumeSamples.push(vol);

      // Tilt input: combine deviceorientation + joystick
      const tilt = tiltControllerRef.current?.getValues() ?? { x: 0, y: 0 };
      const inputX = tilt.x + s.joystickX;
      const inputY = tilt.y + s.joystickY;

      // Track tilt magnitude
      const tiltMag = Math.sqrt(inputX * inputX + inputY * inputY);
      s.tiltMagnitudes.push(tiltMag);

      // Whoosh on strong tilt
      if (tiltMag > 0.6) {
        const now = Date.now();
        if (now - s.lastWhooshTime > 600) { sfx.whoosh(); s.lastWhooshTime = now; }
      }

      // Streak: increment every 3s of high activity (vol > 30)
      // Note: setStreak is intentionally NOT called here — setState in rAF causes re-renders.
      // Streak level is computed here and synced to React state via the 1s setInterval below.
      if (vol > 30) {
        const newLevel = Math.floor((s.volumeSamples.filter(v => v > 30).length / 60) / 3);
        if (newLevel > streakRef.current) {
          streakRef.current = newLevel;
          if (hapticsEnabled) hapticScore();
          triggerPop(`🔥 x${newLevel}`, window.innerWidth / 2, 250);
        }
      }

      // Sphere scale from mic (0.8 → 2.5x)
      const targetScale = 0.8 + (vol / 100) * 1.7;
      if (sphere) {
        sphere.scale.setScalar(sphere.scale.x * 0.85 + targetScale * 0.15);
        // Rotation from tilt — 0.05 per frame per unit of tilt
        sphere.rotation.x += inputY * 0.05 + 0.005;
        sphere.rotation.y += inputX * 0.05 + 0.008;
        // ⚡ Mutate material colors in-place — avoids new THREE.Color() every frame
        const mat = sphere.material as THREE.MeshPhongMaterial;
        mat.color.setHSL(s.hue / 360, 0.75, 0.5);
        mat.emissive.copy(mat.color).multiplyScalar(0.3);
        pointLight.color.setHSL(s.hue / 360, 0.75, 0.5);
      }

      // Particles expand with volume
      if (particles && s.particleBasePos) {
        const expansion = 1 + (vol / 100) * 0.9;
        const pAttr = pGeo.attributes.position as THREE.BufferAttribute;
        const posArr = pAttr.array as Float32Array;
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          posArr[i*3]   = s.particleBasePos[i*3]   * expansion;
          posArr[i*3+1] = s.particleBasePos[i*3+1] * expansion;
          posArr[i*3+2] = s.particleBasePos[i*3+2] * expansion;
        }
        pAttr.needsUpdate = true;
        particles.rotation.y += 0.004;
        // ⚡ Mutate in-place — no allocation
        (particles.material as THREE.PointsMaterial).color.setHSL(s.hue / 360, 0.8, 0.65);
      }

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [getVolume, endGame, theme]);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); sfx.click(); preloadGameAudio(GAME_ID);
    setGameState('permissions');
    try {
      // Start tilt controller (handles iOS permission internally, must be from button click)
      const controller = createTiltController(() => {}, { sensitivity: 0.8, smoothing: 0.5, deadzone: 2, clamp: 28 });
      tiltControllerRef.current = controller;
      const tiltOk = await controller.start();
      if (!tiltOk) {
        setJoystickEnabled(true);
      } else {
        let got = false;
        const check = () => { got = true; };
        window.addEventListener('deviceorientation', check, { once: true });
        setTimeout(() => {
          window.removeEventListener('deviceorientation', check);
          if (!got) setJoystickEnabled(true);
        }, 1500);
      }

      // Mic permission
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        // Verified: getByteFrequencyData, smoothingTimeConstant=0.3
        analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);
        const s = stateRef.current;
        s.stream = stream; s.analyser = analyser; s.audioCtx = audioCtx;
        // Pre-allocate analyser read buffer once (reused every frame in getVolume)
        s.dataArray = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
      } catch {
        // Mic denied — enable tap-volume fallback (tapping the screen simulates voice input)
        micFallbackRef.current = true;
        setMicFallbackEnabled(true);
      }
      setGameState('countdown');
    } catch {
      tiltControllerRef.current?.stop();
      tiltControllerRef.current = null;
      setGameState('start');
    }
  }, []);

  const handlePlayAgain = useCallback(() => {
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    tiltControllerRef.current?.stop();
    tiltControllerRef.current = null;
    setJoystickEnabled(false);
    setJoystickThumb({ x: 0, y: 0 });
    setMicFallbackEnabled(false);
    micFallbackRef.current = false;
    stateRef.current.fallbackVolume = 0;
    setGameState('start');
  }, []);

  // Joystick touch handlers
  const handleJoystickTouch = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = touch.clientX - cx;
    const dy = touch.clientY - cy;
    const MAX_RADIUS = 60;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const nx = dist > 0 ? (dx / dist) * Math.min(1, dist / MAX_RADIUS) : 0;
    const ny = dist > 0 ? (dy / dist) * Math.min(1, dist / MAX_RADIUS) : 0;
    stateRef.current.joystickX = nx;
    stateRef.current.joystickY = ny;
    const clampedDist = Math.min(dist, MAX_RADIUS);
    setJoystickThumb({ x: dist > 0 ? (dx / dist) * clampedDist : 0, y: dist > 0 ? (dy / dist) * clampedDist : 0 });
  }, []);

  const handleJoystickEnd = useCallback(() => {
    stateRef.current.joystickX = 0;
    stateRef.current.joystickY = 0;
    setJoystickThumb({ x: 0, y: 0 });
  }, []);

  // Touch: hue shift + count (separate from joystick — handled on mount div)
  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    const onTouch = () => {
      const s = stateRef.current;
      if (!s.running) return;
      s.hue = (s.hue + 15) % 360;
      s.touchCount++;
      // Mic fallback: each tap injects a volume burst
      if (micFallbackRef.current) s.fallbackVolume = Math.min(100, s.fallbackVolume + 35);
      const now = Date.now();
      if (now - s.lastShimmerTime > 300) {
        sfx.shimmer(); if (hapticsEnabled) haptic([20]);
        s.lastShimmerTime = now;
      }
    };
    mount.addEventListener('touchstart', onTouch);
    return () => mount.removeEventListener('touchstart', onTouch);
  }, []);

  useEffect(() => () => {
    const s = stateRef.current;
    s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    // Clear near-miss timeout to prevent setState on unmounted component (P1 fix)
    if (nearMissTimeoutRef.current) clearTimeout(nearMissTimeoutRef.current);
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(()=>{/* ignore */});
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (stopMusicRef.current) stopMusicRef.current();
    stopMusicFile();
    (s as typeof s & { _resizeCleanup?: () => void })._resizeCleanup?.();
    tiltControllerRef.current?.stop();
  }, []);

  // Pulse Sphere native accent is purple — consistent with Three.js sphere colour.
  // White text on #a855f7 → 4.04:1 contrast (WCAG 2 AA pass for large/bold 20px text).
  // The brand theme green (#00ff88) fails WCAG AA at 1.34:1 with white text.
  const accent = '#a855f7';

  return (
    <>
      {gameState === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="pulse-sphere"
          steps={[
            { icon: <Hand size={64} color="#a855f7" strokeWidth={1.5} />, title: "Tap the sphere", body: "Tap the screen to shift the sphere's color and build your score." },
            { icon: <Smartphone size={64} color="#a855f7" strokeWidth={1.5} />, title: "Move your phone", body: "Tilt and rotate your device to spin the sphere in real time." },
            { icon: <Mic size={64} color="#a855f7" strokeWidth={1.5} />, title: "Use your voice", body: "Hum, sing, or breathe into the mic to pulse the sphere's size." },
          ]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title="Pulse Sphere" emoji="🔮" accentColor={accent} theme={theme}
      background="radial-gradient(ellipse at 50% 50%, rgba(168,85,247,0.10) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(168,85,247,0.06) 0%, transparent 40%), linear-gradient(180deg, #06040f 0%, #0a0618 35%, #0c0720 60%, #0a0618 85%, #06040f 100%)">
      <div ref={mountRef} style={{ width:'100%', height:'100%', display: gameState==='playing' ? 'block' : 'none', position:'relative', zIndex:1, touchAction:'none' }} />

      {gameState==='playing' && (
        <GameHUD
          items={[
            { label: 'ACTIVITY', value: `${liveActivity}%`, testId: 'activity' },
            { label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 10, isTime: true, testId: 'timer' },
          ]}
          accentColor={accent}
        />
      )}
      {/* Mic fallback hint */}
      {micFallbackEnabled && gameState === 'playing' && (
        <div style={{
          /* top: 148 positions hint below the GameHUD panel (HUD is at top:64, ~74px tall) */
          position: 'fixed', top: 148, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)',
          borderRadius: 20, padding: '6px 14px', zIndex: 50,
          color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 600,
          whiteSpace: 'nowrap', pointerEvents: 'none',
        }}>
          Tap screen to simulate voice
        </div>
      )}

      {/* Joystick overlay */}
      {joystickEnabled && gameState === 'playing' && (
        <div
          style={{
            position: 'fixed', bottom: 40, left: '50%', transform: 'translateX(-50%)',
            width: 140, height: 140, borderRadius: '50%',
            border: '3px solid rgba(168,85,247,0.3)',
            backgroundColor: 'rgba(168,85,247,0.06)',
            zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
            touchAction: 'none',
          }}
          onTouchStart={handleJoystickTouch}
          onTouchMove={handleJoystickTouch}
          onTouchEnd={handleJoystickEnd}
        >
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            backgroundColor: 'rgba(168,85,247,0.2)',
            border: '2px solid rgba(168,85,247,0.5)',
            transform: `translate(${joystickThumb.x}px, ${joystickThumb.y}px)`,
            transition: joystickThumb.x === 0 && joystickThumb.y === 0 ? 'transform 0.15s ease' : 'none',
            pointerEvents: 'none',
          }} />
        </div>
      )}
      {gameState==='countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}

      {gameState==='start' && (
        <GameStartScreen
          emoji="🔮"
          iconNode={<Orbit size={80} color={accent} strokeWidth={1.2} />}
          title="Pulse Sphere"
          description="Touch, move, and breathe to awaken the sphere. Your inputs shape it in real time."
          sensorNote="Uses mic, motion & touch"
          ctaLabel="Allow Access & Begin →"
          accentColor={accent}
          ctaTextColor="#fff"
          onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #001520 0%, #000d14 55%, #000508 100%)"
        />
      )}

      {gameState==='permissions' && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--color-text-secondary)' }}>Requesting access…</div>
      )}

      {gameState==='done' && behavior && (() => {
        const voiceScore = behavior.avgVolume;
        const moveScore = behavior.avgTilt;
        const touchScore = behavior.touchCount;
        const personality = getPersonality(voiceScore, moveScore, touchScore);
        return (
          <EndScreen
            gameId="pulse-sphere"
            title={personality}
            emoji="🔮"
            score={`${Math.round((voiceScore + moveScore + touchScore) / 3)}%`}
            personality={personality}
            insights={[
              { label: 'Voice engagement', value: `${voiceScore}%`, color: '#3b82f6' },
              { label: 'Movement engagement', value: `${moveScore}%`, color: '#00ff88' },
              { label: 'Touch engagement', value: `${touchScore}%`, color: '#a855f7' },
              { label: 'Overall activity', value: `${Math.round((voiceScore + moveScore + touchScore) / 3)}%`, color: '#facc15' },
            ]}
            accentColor={accent}
            onPlayAgain={handlePlayAgain}
          >
            <RadarChart voice={voiceScore} movement={moveScore} touch={touchScore} />
          </EndScreen>
        );
      })()}
      {gameState === 'playing' && (
        <>
          <ScorePopEffect pops={pops} accentColor={CATEGORY_ACCENT} />
          <StreakBadge streak={streak} accentColor={CATEGORY_ACCENT} />
          <AnimatePresence>
            {nearMissMsg && (
              <motion.div
                key="near-miss"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                style={{
                  position: 'fixed', top: '22%', left: '50%', transform: 'translateX(-50%)',
                  zIndex: 80, pointerEvents: 'none',
                  fontSize: 22, fontWeight: 800, color: '#fbbf24',
                  textShadow: '0 0 12px #fbbf2488',
                  whiteSpace: 'nowrap',
                }}
              >
                So close! 🎯
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* New best banner */}
      <AnimatePresence>
        {isNewBest && gameState === 'done' && (
          <motion.div
            key="new-best"
            initial={{ opacity: 0, y: -20, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, delay: 0.5 }}
            style={{
              position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)',
              zIndex: 90, pointerEvents: 'none',
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
              borderRadius: 20,
              padding: '8px 20px',
              fontSize: 20,
              fontWeight: 900,
              color: '#000',
              whiteSpace: 'nowrap',
              boxShadow: '0 4px 20px rgba(251,191,36,0.5)',
            }}
          >
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>
    </GameShell>
    </>
  );
}

import dynamic from 'next/dynamic';
const PulseSphere = dynamic(() => Promise.resolve({ default: PulseSphereInner }), { ssr: false });
export default PulseSphere;
