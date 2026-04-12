'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic } from '@/lib/audio';
import { hapticScore, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID  = 'pitch-match';
const ACCENT   = '#a855f7';
const DURATION = 45;
const GAME_EMOJI   = '🎵';
const GAME_TITLE   = 'Pitch Match';
const GAME_TAGLINE = 'Hum or sing to match the target frequency!';

const TARGET_NOTES = [196.00, 261.63, 329.63, 440.00, 392.00, 220.00, 293.66, 523.25];
const FREQ_MIN = 90; const FREQ_MAX = 620;
const HIT_CENTS = 50; const PRECISION_CENTS = 20;

function freqToCents(freq: number, ref: number): number {
  return 1200 * Math.log2(freq / ref);
}

function autoCorrelate(buf: Float32Array, sampleRate: number): number {
  const SIZE = buf.length;
  const rmsThreshold = 0.01;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < rmsThreshold) return -1;
  let r1 = 0; let r2 = SIZE - 1; const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) { if (Math.abs(buf[i]) < thres) { r1 = i; break; } }
  for (let i = 1; i < SIZE / 2; i++) { if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; } }
  const sliced = buf.slice(r1, r2);
  const c = new Float32Array(sliced.length * 2);
  for (let i = 0; i < sliced.length; i++) for (let j = 0; j < sliced.length; j++) c[i + j] += sliced[i] * sliced[j];
  const d = c.slice(sliced.length);
  let maxval = -1; let maxpos = -1;
  for (let i = 1; i < d.length; i++) { if (d[i] > d[i - 1] && d[i] > d[i + 1] && d[i] > maxval) { maxval = d[i]; maxpos = i; } }
  if (maxpos < 0) return -1;
  let T0 = maxpos;
  const x1 = d[T0 - 1]; const x2 = d[T0]; const x3 = d[T0 + 1];
  const a = (x1 + x3 - 2 * x2) / 2; const b = (x3 - x1) / 2;
  if (a) T0 = T0 - b / (2 * a);
  return sampleRate / T0;
}

interface Signals {
  notesHit: number; precisionHits: number; missedNotes: number;
  avgPitchDeviation: number; longestHold: number; score: number;
  maxStreak: number; streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  if (sig.precisionHits >= 5 && sig.avgPitchDeviation < 15) return '🎤 Perfect Pitch';
  if (sig.notesHit >= 6) return '🎵 Melody Master';
  if (sig.longestHold > 2000) return '🎶 Sustained Singer';
  if (sig.notesHit >= 3) return '🎼 On Key';
  return '🎤 Finding the Tune';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface WaveBar {
  mesh: THREE.Mesh; baseY: number; targetScaleY: number;
}

interface NoteOrb {
  mesh: THREE.Mesh; targetY: number; light: THREE.PointLight;
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.OrthographicCamera | null;
  animId: number; frame: number;
  // Audio
  audioCtx: AudioContext | null;
  analyser: AnalyserNode | null;
  micStream: MediaStream | null;
  pitchBuffer: Float32Array | null;
  lastDetect: number;
  // Game state
  currentFreq: number;
  noteIndex: number;
  noteStartMs: number;
  holdMs: number;
  noteHoldMs: number;
  // 3D refs
  waveBars: WaveBar[];
  noteOrb: NoteOrb | null;
  targetOrb: THREE.Mesh | null;
  freqLine: THREE.Mesh | null;
  targetLine: THREE.Mesh | null;
  particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }>;
  intervalId: ReturnType<typeof setInterval> | null;
  viewH: number; viewW: number;
}

function PitchMatchGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { notesHit: 0, precisionHits: 0, missedNotes: 0, avgPitchDeviation: 0, longestHold: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    renderer: null, scene: null, camera: null, animId: 0, frame: 0,
    audioCtx: null, analyser: null, micStream: null, pitchBuffer: null, lastDetect: 0,
    currentFreq: 0, noteIndex: 0, noteStartMs: 0, holdMs: 0, noteHoldMs: 0,
    waveBars: [], noteOrb: null, targetOrb: null, freqLine: null, targetLine: null,
    particles: [], intervalId: null, viewH: 0, viewW: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [micError, setMicError] = useState('');
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (s.analyser) { s.analyser.disconnect(); }
    if (s.micStream) { s.micStream.getTracks().forEach(t => t.stop()); s.micStream = null; }
    if (s.audioCtx) { s.audioCtx.close().catch(() => {}); s.audioCtx = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, []);

  const startLoop = useCallback(async () => {
    const mount = mountRef.current;
    if (!mount) return;

    // Request microphone
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      setMicError('Microphone access denied. Please allow mic and retry.');
      setPhase('start');
      return;
    }

    const s = stateRef.current;
    const W = mount.clientWidth || window.innerWidth;
    const H = mount.clientHeight || window.innerHeight;

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { notesHit: 0, precisionHits: 0, missedNotes: 0, avgPitchDeviation: 0, longestHold: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.noteIndex = 0; s.noteStartMs = Date.now(); s.holdMs = 0; s.noteHoldMs = 0; s.particles = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    // Audio setup
    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    s.audioCtx = audioCtx; s.analyser = analyser; s.micStream = stream;
    s.pitchBuffer = new Float32Array(analyser.fftSize);

    // Three.js setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x080010);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;

    const vw = W / 2; const vh = H / 2;
    const camera = new THREE.OrthographicCamera(-vw, vw, vh, -vh, 0.1, 100);
    camera.position.z = 10;
    s.camera = camera;
    s.viewW = W; s.viewH = H;

    // Lighting
    scene.add(new THREE.AmbientLight(0x221133, 3));
    const mainLight = new THREE.PointLight(0xa855f7, 3, 30);
    mainLight.position.set(0, 0, 5);
    scene.add(mainLight);
    const rimLight = new THREE.PointLight(0x7c3aed, 1.5, 20);
    rimLight.position.set(-vw * 0.5, 0, 5);
    scene.add(rimLight);

    // Frequency wave bars (equalizer-style)
    const BAR_COUNT = 32;
    const barW = W / BAR_COUNT * 0.7;
    const waveBars: WaveBar[] = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      const barGeo = new THREE.BoxGeometry(barW, 1, 10);
      const barMat = new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0xa855f7, emissiveIntensity: 0.3, transparent: true, opacity: 0.6 });
      const bar = new THREE.Mesh(barGeo, barMat);
      const bx = -vw + (i + 0.5) * (W / BAR_COUNT);
      bar.position.set(bx, -vh * 0.2, 0);
      scene.add(bar);
      waveBars.push({ mesh: bar, baseY: -vh * 0.2, targetScaleY: 1 });
    }
    s.waveBars = waveBars;

    // Frequency range indicator (vertical axis)
    // Target frequency line (horizontal)
    const targetLineGeo = new THREE.PlaneGeometry(W, 3);
    const targetLineMat = new THREE.MeshBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
    const targetLine = new THREE.Mesh(targetLineGeo, targetLineMat);
    scene.add(targetLine);
    s.targetLine = targetLine;

    // Current freq indicator
    const freqLineGeo = new THREE.PlaneGeometry(W, 4);
    const freqLineMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const freqLine = new THREE.Mesh(freqLineGeo, freqLineMat);
    scene.add(freqLine);
    s.freqLine = freqLine;

    // Note target orb
    const targetOrbGeo = new THREE.SphereGeometry(20, 16, 16);
    const targetOrbMat = new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0xa855f7, emissiveIntensity: 0.8, transparent: true, opacity: 0.9 });
    const targetOrb = new THREE.Mesh(targetOrbGeo, targetOrbMat);
    scene.add(targetOrb);
    s.targetOrb = targetOrb;

    // Current pitch orb
    const orbGeo = new THREE.SphereGeometry(15, 16, 16);
    const orbMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 1, transparent: true, opacity: 0 });
    const orbMesh = new THREE.Mesh(orbGeo, orbMat);
    scene.add(orbMesh);
    const orbLight = new THREE.PointLight(0xfbbf24, 0, 8);
    orbLight.position.set(0, 0, 1);
    scene.add(orbLight);
    s.noteOrb = { mesh: orbMesh, targetY: 0, light: orbLight };

    const freqToY = (freq: number): number => {
      if (freq <= 0) return -vh;
      const normalized = (freq - FREQ_MIN) / (FREQ_MAX - FREQ_MIN);
      return (normalized - 0.5) * vh * 1.4;
    };

    const onResize = () => {
      const W2 = mount.clientWidth || window.innerWidth;
      const H2 = mount.clientHeight || window.innerHeight;
      renderer.setSize(W2, H2);
      (camera as THREE.OrthographicCamera).left = -W2 / 2;
      (camera as THREE.OrthographicCamera).right = W2 / 2;
      (camera as THREE.OrthographicCamera).top = H2 / 2;
      (camera as THREE.OrthographicCamera).bottom = -H2 / 2;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    (s as unknown as { _resizeCleanup: () => void })._resizeCleanup = () => window.removeEventListener('resize', onResize);

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const NOTE_DURATION_MS = (DURATION * 1000) / TARGET_NOTES.length;

    const loop = (ts: number) => {
      if (!s.running) return;
      s.frame++;

      const targetFreq = TARGET_NOTES[s.noteIndex] ?? TARGET_NOTES[TARGET_NOTES.length - 1];
      const elapsed = Date.now() - s.noteStartMs;
      if (elapsed >= NOTE_DURATION_MS) {
        if (s.noteHoldMs < 500) { s.sig.missedNotes++; s.sig.streakCurrent = 0; sfx.collision(); }
        s.noteIndex = (s.noteIndex + 1) % TARGET_NOTES.length;
        s.noteStartMs = Date.now(); s.noteHoldMs = 0;
      }

      // Detect pitch
      if (s.analyser && s.pitchBuffer && ts - s.lastDetect > 50) {
        s.lastDetect = ts;
        s.analyser.getFloatTimeDomainData(s.pitchBuffer as Float32Array<ArrayBuffer>);
        const freq = autoCorrelate(s.pitchBuffer, s.audioCtx!.sampleRate);
        s.currentFreq = freq > 0 ? freq : 0;

        if (freq > 0 && targetFreq > 0) {
          const cents = Math.abs(freqToCents(freq, targetFreq));
          if (cents < HIT_CENTS) {
            s.noteHoldMs += 50;
            s.holdMs += 50;
            s.sig.score += cents < PRECISION_CENTS ? 2 : 1;
            if (s.noteHoldMs === 50) {
              s.sig.notesHit++;
              if (cents < PRECISION_CENTS) s.sig.precisionHits++;
              s.sig.streakCurrent++;
              if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
              hapticScore();
            }
            setScoreDisplay(s.sig.score);
          }
          if (s.holdMs > s.sig.longestHold) s.sig.longestHold = s.holdMs;
        } else { s.holdMs = 0; }
      }

      const tY = freqToY(targetFreq);
      const cY = freqToY(s.currentFreq);

      // Update target line
      if (s.targetLine) {
        s.targetLine.position.y = tY;
        (s.targetLine.material as THREE.MeshBasicMaterial).opacity = 0.3 + Math.sin(s.frame * 0.08) * 0.1;
      }

      // Update target orb
      if (s.targetOrb) {
        s.targetOrb.position.set(-vw * 0.4, tY, 0);
        s.targetOrb.rotation.y += 0.02;
        const isPrecise = s.currentFreq > 0 && Math.abs(freqToCents(s.currentFreq, targetFreq)) < PRECISION_CENTS;
        (s.targetOrb.material as THREE.MeshStandardMaterial).emissiveIntensity = isPrecise ? 1.5 : 0.6 + Math.sin(s.frame * 0.1) * 0.2;
      }

      // Update current freq orb
      if (s.noteOrb) {
        s.noteOrb.targetY = cY;
        s.noteOrb.mesh.position.y += (s.noteOrb.targetY - s.noteOrb.mesh.position.y) * 0.2;
        s.noteOrb.mesh.position.x = vw * 0.4;
        const hasFreq = s.currentFreq > 0;
        (s.noteOrb.mesh.material as THREE.MeshStandardMaterial).opacity = hasFreq ? 0.9 : 0;
        s.noteOrb.light.intensity = hasFreq ? 2 : 0;
        s.noteOrb.light.position.copy(s.noteOrb.mesh.position);
        if (hasFreq) {
          const cents = Math.abs(freqToCents(s.currentFreq, targetFreq));
          const onTarget = cents < HIT_CENTS;
          (s.noteOrb.mesh.material as THREE.MeshStandardMaterial).color.setHex(onTarget ? (cents < PRECISION_CENTS ? 0x4ade80 : 0xfbbf24) : 0xf87171);
        }
      }

      // Current freq horizontal line
      if (s.freqLine) {
        s.freqLine.position.y = s.noteOrb ? s.noteOrb.mesh.position.y : -vh;
        (s.freqLine.material as THREE.MeshBasicMaterial).opacity = s.currentFreq > 0 ? 0.6 : 0;
      }

      // Equalizer bars - driven by audio frequency data
      if (s.analyser) {
        const freqData = new Uint8Array(s.analyser.frequencyBinCount);
        s.analyser.getByteFrequencyData(freqData as Uint8Array<ArrayBuffer>);
        const step = Math.floor(freqData.length / BAR_COUNT);
        s.waveBars.forEach((bar, i) => {
          const val = freqData[i * step] / 255;
          bar.targetScaleY = 1 + val * vh * 0.8;
          bar.mesh.scale.y += (bar.targetScaleY - bar.mesh.scale.y) * 0.25;
          bar.mesh.position.y = bar.baseY + bar.mesh.scale.y * 0.5 - 0.5;
          const mat = bar.mesh.material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = 0.1 + val * 0.9;
          mat.opacity = 0.3 + val * 0.5;
        });
      }

      // Particles
      s.particles = s.particles.filter(p => {
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.life--;
        (p.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, p.life / 20);
        if (p.life <= 0) { scene.remove(p.mesh); return false; }
        return true;
      });

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => () => {
    const s = stateRef.current;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.analyser) s.analyser.disconnect();
    if (s.micStream) s.micStream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {});
    if (s.renderer) s.renderer.dispose();
    (s as unknown as { _resizeCleanup?: () => void })._resizeCleanup?.();
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setMicError(''); }, []);

  const buildInsights = (sig: Signals) => [
    { label: 'Notes Hit', value: String(sig.notesHit), color: ACCENT },
    { label: 'Precision', value: String(sig.precisionHits), color: '#4ade80' },
    { label: 'Longest Hold', value: `${(sig.longestHold / 1000).toFixed(1)}s`, color: '#fbbf24' },
    { label: 'Best Streak', value: `×${sig.maxStreak}`, color: ACCENT },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description={micError || GAME_TAGLINE}
          ctaLabel="Allow Mic 🎤" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
              { label: 'SCORE', value: scoreDisplay },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT}
            onPlayAgain={handlePlayAgain} didWin={finalSig.notesHit >= 5} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

const BAR_COUNT = 32;

function WebhookEmitter({ theme, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, notesHit: sig.notesHit }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const PitchMatchGame = dynamic(() => Promise.resolve({ default: PitchMatchGameInner }), { ssr: false });
export default PitchMatchGame;
