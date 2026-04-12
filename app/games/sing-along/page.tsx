'use client';
/**
 * SING ALONG — 3D Version
 * A 3D pitch ball follows a melody path. Hum to track it.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Mic } from 'lucide-react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, playVictoryFanfare } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';

const GAME_ID = 'sing-along';
const PB_KEY = 'mg_pb_sing-along';
const ACCENT = '#34d399';
const DURATION = 45;
const GAME_EMOJI = '🎤';
const GAME_TITLE = 'Sing Along';
const FREQ_MIN = 100, FREQ_MAX = 580;
const HIT_CENTS = 60, PRECISION_CENTS = 25;

const MELODY: { freq: number; durationMs: number }[] = [
  { freq: 261.63, durationMs: 2000 }, { freq: 293.66, durationMs: 1500 }, { freq: 329.63, durationMs: 1500 },
  { freq: 349.23, durationMs: 2000 }, { freq: 392.00, durationMs: 2500 }, { freq: 349.23, durationMs: 1500 },
  { freq: 329.63, durationMs: 1500 }, { freq: 293.66, durationMs: 2000 }, { freq: 261.63, durationMs: 3000 },
  { freq: 329.63, durationMs: 1500 }, { freq: 392.00, durationMs: 2000 }, { freq: 440.00, durationMs: 2000 },
  { freq: 392.00, durationMs: 1500 }, { freq: 349.23, durationMs: 1500 }, { freq: 329.63, durationMs: 2500 },
];

interface Signals { score: number; onTargetMs: number; precisionMs: number; maxStreak: number; streak: number; }

function getPersonality(sig: Signals): string {
  const pct = sig.onTargetMs / (DURATION * 1000);
  if (pct >= 0.75 && sig.precisionMs > sig.onTargetMs * 0.5) return 'Pitch Perfect 🎵';
  if (pct >= 0.6) return 'Melody Maker 🎶';
  if (sig.maxStreak >= 30) return 'Steady Singer 🎤';
  if (pct >= 0.3) return 'Finding the Note 🎼';
  return 'Still Warming Up 🌡️';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function autoCorrelate(buf: Float32Array, sampleRate: number): number {
  const SIZE = buf.length;
  const MAX_SAMPLES = Math.floor(SIZE / 2);
  let best_offset = -1, best_correlation = 0;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;
  let last_correlation = 1;
  for (let offset = 0; offset < MAX_SAMPLES; offset++) {
    let correlation = 0;
    for (let i = 0; i < MAX_SAMPLES; i++) correlation += Math.abs((buf[i]) - (buf[i + offset]));
    correlation = 1 - (correlation / MAX_SAMPLES);
    if (correlation > 0.9 && correlation > last_correlation) { best_correlation = correlation; best_offset = offset; }
    last_correlation = correlation;
  }
  if (best_offset === -1) return -1;
  return sampleRate / best_offset;
}

function freqToY(freq: number, H: number): number {
  const logMin = Math.log2(FREQ_MIN), logMax = Math.log2(FREQ_MAX);
  const logF = Math.log2(Math.max(FREQ_MIN, Math.min(FREQ_MAX, freq)));
  return ((logF - logMin) / (logMax - logMin)) * 2 - 1; // -1 to 1 world Y
}

function SingAlongGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    targetBall: null as THREE.Mesh | null,
    pitchBall: null as THREE.Mesh | null,
    targetLight: null as THREE.PointLight | null,
    pitchLight: null as THREE.PointLight | null,
    trailPoints: [] as THREE.Mesh[],
    melodyPath: null as THREE.Line | null,
    running: false, timeLeft: DURATION,
    sig: { score: 0, onTargetMs: 0, precisionMs: 0, maxStreak: 0, streak: 0 } as Signals,
    analyser: null as AnalyserNode | null,
    audioCtx: null as AudioContext | null,
    micStream: null as MediaStream | null,
    pitchBuf: null as Float32Array | null,
    currentPitch: -1,
    targetFreq: MELODY[0].freq,
    melodyStartMs: 0,
    gameStartMs: 0,
    isOnTarget: false,
    isPrecision: false,
    scoreTimer: 0,
    scoreInterval: 80,
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
    if (s.micStream) s.micStream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {});
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    hapticVictory(); playVictoryFanfare();
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (s.sig.score > pb) { localStorage.setItem(PB_KEY, String(s.sig.score)); setIsNewBest(true); }
    } catch { /* ignore */ }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const startLoop = useCallback(async () => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, onTargetMs: 0, precisionMs: 0, maxStreak: 0, streak: 0 };
    s.currentPitch = -1; s.isOnTarget = false; s.isPrecision = false;
    s.melodyStartMs = Date.now(); s.gameStartMs = Date.now();
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x010a08);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 7);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x0a1f18, 3));
    const ambLight = new THREE.PointLight(0x34d399, 1.5, 20);
    ambLight.position.set(0, 3, 4);
    scene.add(ambLight);
    const targetLight = new THREE.PointLight(0x34d399, 2, 8);
    scene.add(targetLight);
    s.targetLight = targetLight;
    const pitchLight = new THREE.PointLight(0xfbbf24, 0, 6);
    scene.add(pitchLight);
    s.pitchLight = pitchLight;

    // Stars
    const sp = new Float32Array(400 * 3);
    for (let i = 0; i < 400; i++) { sp[i*3] = (Math.random()-0.5)*40; sp[i*3+1] = (Math.random()-0.5)*40; sp[i*3+2] = (Math.random()-0.5)*40; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.04 })));

    // Pre-compute melody path in world space
    const pathPts: THREE.Vector3[] = [];
    let t = 0;
    MELODY.forEach(seg => {
      const y = freqToY(seg.freq, H) * 2.5;
      const x1 = -5 + (t / (DURATION * 1000)) * 10;
      const x2 = -5 + ((t + seg.durationMs) / (DURATION * 1000)) * 10;
      pathPts.push(new THREE.Vector3(x1, y, 0), new THREE.Vector3(x2, y, 0));
      t += seg.durationMs;
    });
    const pathGeo = new THREE.BufferGeometry().setFromPoints(pathPts);
    const pathLine = new THREE.Line(pathGeo, new THREE.LineBasicMaterial({ color: 0x34d399, opacity: 0.5, transparent: true }));
    scene.add(pathLine);
    s.melodyPath = pathLine;

    // Target ball
    const targetBallGeo = new THREE.SphereGeometry(0.18, 16, 16);
    const targetBallMat = new THREE.MeshStandardMaterial({ color: 0x34d399, emissive: 0x34d399, emissiveIntensity: 0.8 });
    const targetBall = new THREE.Mesh(targetBallGeo, targetBallMat);
    scene.add(targetBall);
    s.targetBall = targetBall;

    // Pitch ball (player)
    const pitchBallGeo = new THREE.SphereGeometry(0.14, 12, 12);
    const pitchBallMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0x000000, emissiveIntensity: 0 });
    const pitchBall = new THREE.Mesh(pitchBallGeo, pitchBallMat);
    pitchBall.position.set(-5, 0, 0.3);
    scene.add(pitchBall);
    s.pitchBall = pitchBall;

    // Setup mic for pitch detection
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.micStream = stream;
      const audioCtx = new AudioContext();
      s.audioCtx = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      s.analyser = analyser;
      s.pitchBuf = new Float32Array(analyser.fftSize);
    } catch { /* no mic */ }

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

    const loop = () => {
      if (!s.running) return;
      const now = Date.now();
      const elapsed = now - s.gameStartMs;
      const t2 = elapsed * 0.001;

      // Detect pitch
      if (s.analyser && s.pitchBuf) {
        s.analyser.getFloatTimeDomainData(s.pitchBuf as Float32Array<ArrayBuffer>);
        s.currentPitch = autoCorrelate(s.pitchBuf, s.audioCtx?.sampleRate ?? 44100);
      }

      // Determine target frequency from melody
      let melodyElapsed = elapsed, cumTime = 0, targetFreq = MELODY[0].freq;
      for (const seg of MELODY) {
        cumTime += seg.durationMs;
        if (melodyElapsed < cumTime) { targetFreq = seg.freq; break; }
      }
      s.targetFreq = targetFreq;

      // Target ball position
      const targetX = -5 + (elapsed / (DURATION * 1000)) * 10;
      const targetY = freqToY(targetFreq, window.innerHeight) * 2.5;
      targetBall.position.set(targetX, targetY, 0);
      targetLight.position.copy(targetBall.position).add(new THREE.Vector3(0, 0, 1));

      // Pitch ball position
      if (s.currentPitch > 0 && s.currentPitch >= FREQ_MIN && s.currentPitch <= FREQ_MAX) {
        const pitchY = freqToY(s.currentPitch, window.innerHeight) * 2.5;
        pitchBall.position.lerp(new THREE.Vector3(targetX, pitchY, 0.3), 0.3);
        pitchBall.visible = true;
        // Check accuracy
        const centsOff = 1200 * Math.abs(Math.log2(s.currentPitch / targetFreq));
        s.isOnTarget = centsOff <= HIT_CENTS;
        s.isPrecision = centsOff <= PRECISION_CENTS;
        if (s.isOnTarget) {
          s.sig.onTargetMs += 16;
          s.sig.streak++; if (s.sig.streak > s.sig.maxStreak) s.sig.maxStreak = s.sig.streak;
          s.scoreTimer += 16;
          if (s.scoreTimer >= s.scoreInterval) {
            s.scoreTimer = 0;
            const pts = s.isPrecision ? 3 : 1;
            s.sig.score += pts;
            if (s.isPrecision) s.sig.precisionMs += 16;
            setScoreDisplay(s.sig.score); setStreak(s.sig.streak);
          }
        } else {
          s.sig.streak = 0; s.scoreTimer = 0;
        }
      } else {
        pitchBall.position.lerp(new THREE.Vector3(targetX - 0.3, targetY, 0.3), 0.05);
        s.isOnTarget = false; s.sig.streak = 0;
      }

      // Visual state
      const targetMat = targetBall.material as THREE.MeshStandardMaterial;
      targetMat.emissive.setHex(s.isOnTarget ? 0xfbbf24 : 0x34d399);
      targetMat.emissiveIntensity = 0.8 + Math.sin(t2 * 6) * 0.2;
      targetLight.color.setHex(s.isOnTarget ? 0xfbbf24 : 0x34d399);
      targetLight.intensity = s.isOnTarget ? 3 : 1.5;

      const pitchMat = pitchBall.material as THREE.MeshStandardMaterial;
      pitchMat.color.setHex(s.isPrecision ? 0x34d399 : s.isOnTarget ? 0xfbbf24 : 0xef4444);
      pitchMat.emissive.setHex(s.isOnTarget ? pitchMat.color.getHex() : 0x000000);
      pitchMat.emissiveIntensity = s.isOnTarget ? 0.6 : 0;
      pitchLight.position.copy(pitchBall.position);
      pitchLight.intensity = s.isOnTarget ? 2 : 0;
      pitchLight.color.setHex(s.isPrecision ? 0x34d399 : 0xfbbf24);

      // Path scrolls left  
      pathLine.position.x = 0;

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    stopMusicRef.current?.();
    const s = stateRef.current;
    if (s.micStream) s.micStream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {});
    if (s.renderer) s.renderer.dispose();
    (s as any)._cleanup?.();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false); setStreak(0); prevScoreRef.current = 0; }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} iconNode={<Mic size={80} color={accent} strokeWidth={1.5} />}
          title={GAME_TITLE} description="Follow the melody line with your voice. Hum to stay on target!"
          ctaLabel="Allow Mic & Sing 🎤" sensorNote="Uses microphone for pitch detection"
          accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
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
              { label: 'Precision', value: `${Math.round(finalSig.precisionMs / (DURATION * 10))}%`, color: '#a855f7' },
              { label: 'Best Streak', value: `${finalSig.maxStreak}`, color: '#fbbf24' },
              { label: 'Score', value: String(finalSig.score), color: accent },
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
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score, onTargetMs: sig.onTargetMs }, player); }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const SingAlongGame = dynamic(() => Promise.resolve({ default: SingAlongGameInner }), { ssr: false });
export default SingAlongGame;
