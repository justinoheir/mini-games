/**
 * ══════════════════════════════════════════════════════════════════
 *  CROWD ROAR — Ether Mini Game
 *  Roar loud. Hold it. Don't fade.
 *
 *  Sensor: Microphone (Web Audio API)
 *  Duration: 45s
 *  Signals: avgVolume, peakVolume, sustainedRoarTime, silenceEvents, roarBursts
 *  Personalities: Crowd King, Burst Machine, Steady Roar, Building Up
 * ══════════════════════════════════════════════════════════════════
 */

'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Mic } from 'lucide-react';
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
import { Particle, spawnBurst, updateAndDrawParticles } from '@/lib/particles';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY_ACCENT = CATEGORY_THEMES.sports.primaryAccent;

// ─── SPEC CONSTANTS ──────────────────────────────────────────────────────────

const GAME_ID      = 'crowd-roar';
const PB_KEY       = 'pb_crowd-roar';
const ACCENT       = '#ef4444';
const DURATION     = 45;
const GAME_EMOJI   = '📢';
const GAME_TITLE   = 'Crowd Roar';
const GAME_TAGLINE = "Roar loud. Hold it. Don't fade.";

const ROAR_THRESHOLD    = 0.6;   // volume level considered "roar"
const SILENCE_THRESHOLD = 0.2;   // below this is silence
const SILENCE_MS        = 500;   // ms below threshold = silence event
const CHALLENGE_MS      = 3000;  // challenge window duration

// ─── BEHAVIORAL SIGNALS ──────────────────────────────────────────────────────

interface Signals {
  avgVolume: number;           // computed at end: volumeSum / volumeCount
  peakVolume: number;          // max single volume reading
  sustainedRoarTime: number;   // ms above ROAR_THRESHOLD
  silenceEvents: number;       // times volume dropped below 0.2 for >500ms
  roarBursts: number;          // distinct loud bursts (threshold crossings)
  // internal tracking
  volumeSum: number;
  volumeCount: number;
  roarStartTime: number | null;
  score: number;
}

// ─── PERSONALITY CLASSIFICATION ──────────────────────────────────────────────

function getPersonality(sig: Signals): string {
  const avg = sig.volumeCount > 0 ? sig.volumeSum / sig.volumeCount : 0;

  if (avg > 0.75 && sig.sustainedRoarTime > 20000)  return 'Crowd King 👑';
  if (sig.roarBursts >= 8 && sig.peakVolume > 0.85) return 'Burst Machine 💥';
  if (avg > 0.55 && sig.silenceEvents <= 3)          return 'Steady Roar 🔥';
  return 'Building Up 🌊';
}

// ─── CROWD MEMBER ─────────────────────────────────────────────────────────────

interface CrowdMember {
  x: number;
  baseY: number;
  row: number;
  colFrac: number;        // 0-1 normalized column position (for wave stagger)
  excitementCurrent: number;
  excitementTarget: number;
  size: number;           // 0.7–1.3
  hue: number;            // color variation ±15
}

// ─── CHALLENGE ───────────────────────────────────────────────────────────────

interface Challenge {
  active: boolean;
  target: number;         // 0-1 volume target
  label: string;
  endTime: number;
  bonusAwarded: boolean;
  hit: boolean;
}

// ─── GAME STATE ───────────────────────────────────────────────────────────────

interface GameState {
  running: boolean;
  finaleActive: boolean;   // true during the 1.5s stadium explosion after timer ends
  timeLeft: number;
  sig: Signals;

  // mic
  smoothedVolume: number;

  // silence tracking
  silenceStartTime: number | null;
  inSilenceEvent: boolean;

  // burst tracking
  wasAboveThreshold: boolean;

  // crowd
  crowd: CrowdMember[];

  // particles
  particles: Particle[];

  // challenge
  challenge: Challenge;
  challenge15Triggered: boolean;
  challenge30Triggered: boolean;

  // bonus flash
  flashAlpha: number;

  // per-second score snapshot (for setScoreDisplay)
  scoreSnap: number;

  accentColor: string;
}

type Phase = 'start' | 'permission' | 'countdown' | 'playing' | 'done';

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function CrowdRoarGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const finaleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mic audio refs
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const analyserRef  = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const stateRef = useRef<GameState>({
    running: false,
    finaleActive: false,
    timeLeft: DURATION,
    sig: {
      avgVolume: 0,
      peakVolume: 0,
      sustainedRoarTime: 0,
      silenceEvents: 0,
      roarBursts: 0,
      volumeSum: 0,
      volumeCount: 0,
      roarStartTime: null,
      score: 0,
    },
    smoothedVolume: 0,
    silenceStartTime: null,
    inSilenceEvent: false,
    wasAboveThreshold: false,
    crowd: [],
    particles: [],
    challenge: { active: false, target: 0.8, label: 'Hit 80%!', endTime: 0, bonusAwarded: false, hit: false },
    challenge15Triggered: false,
    challenge30Triggered: false,
    flashAlpha: 0,
    scoreSnap: 0,
    accentColor: ACCENT,
  });

  const [phase, setPhase]             = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft]       = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]       = useState<Signals | null>(null);
  const [permError, setPermError]     = useState('');

  const [playerName, setPlayerName]   = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const { pops, triggerPop } = useScorePop();
  const [streak, setStreak] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const prevScoreRef = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const numScore = typeof scoreDisplay === 'number' ? scoreDisplay : 0;
    if (numScore > prevScoreRef.current) {
      triggerPop(`+${numScore - prevScoreRef.current}`, window.innerWidth / 2, 200);
      hapticScore();
      playScoreHit('default', numScore - prevScoreRef.current);
      setStreak(Math.floor(numScore / 5));
    }
    prevScoreRef.current = numScore;
  }, [scoreDisplay]); // triggerPop is stable
  const playerSessionRef              = useRef<PlayerSession | null>(null);

  // Sync theme accent color into state
  useEffect(() => {
    stateRef.current.accentColor = theme.colors.accent ?? ACCENT;
  }, [theme]);

  // ─── CROWD INIT ──────────────────────────────────────────────────────────

  const initCrowd = useCallback((W: number, H: number) => {
    const crowd: CrowdMember[] = [];
    const rows   = 5;
    const cols   = 10;
    const meterW = 72;  // power meter + margin
    const areaW  = W - meterW;
    const areaBottom = H - 60;
    const rowSpan    = H * 0.52;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const colFrac = col / (cols - 1);
        const colWidth = areaW / cols;
        const jitterX = (Math.random() - 0.5) * colWidth * 0.35;
        const jitterY = (Math.random() - 0.5) * 8;
        crowd.push({
          x: meterW + (col + 0.5) * colWidth + jitterX,
          baseY: areaBottom - (row / (rows - 1)) * rowSpan + jitterY,
          row,
          colFrac,
          excitementCurrent: 0,
          excitementTarget: 0,
          size: 0.75 + Math.random() * 0.5,
          hue: (Math.random() - 0.5) * 30,
        });
      }
    }
    stateRef.current.crowd = crowd;
  }, []);

  // ─── END GAME ────────────────────────────────────────────────────────────

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    s.finaleActive = true;

    // Finalize sustained roar time
    if (s.sig.roarStartTime !== null) {
      s.sig.sustainedRoarTime += Date.now() - s.sig.roarStartTime;
      s.sig.roarStartTime = null;
    }
    // Compute avg volume
    s.sig.avgVolume = s.sig.volumeCount > 0
      ? parseFloat((s.sig.volumeSum / s.sig.volumeCount).toFixed(3))
      : 0;
    // Peak bonus
    if (s.sig.peakVolume > 0.9) s.sig.score += 50;
    // Silence penalty
    s.sig.score = Math.max(0, s.sig.score - s.sig.silenceEvents * 20);
    s.sig.score = Math.round(s.sig.score);

    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }

    sfx.success();
    hapticVictory();
    playVictoryFanfare();

    // Trigger stadium explosion: all crowd members go max excitement
    for (const m of s.crowd) {
      m.excitementTarget = 1.0;
    }
    s.flashAlpha = 0.6;

    // After 1.5s of stadium finale, close mic and show end screen
    finaleTimeoutRef.current = setTimeout(() => {
      s.finaleActive = false;
      cancelAnimationFrame(animRef.current);

      if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
      if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
      analyserRef.current = null;
      dataArrayRef.current = null;
    // Personal best tracking
    try {
      const _pbPrev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      const _pbVal = parseFloat(String(s.sig?.score ?? 0));
      if (!isNaN(_pbVal) && _pbVal > _pbPrev) {
        localStorage.setItem(PB_KEY, String(Math.round(_pbVal)));
        setIsNewBest(true);
      }
    } catch { /* ignore */ }



      setFinalSig({ ...s.sig });
      setPhase('done');
    }, 1500);
  }, []);

  // ─── GET MIC VOLUME ──────────────────────────────────────────────────────

  const getMicVolume = useCallback((): number => {
    const analyser = analyserRef.current;
    const dataArr  = dataArrayRef.current;
    if (!analyser || !dataArr) return 0;
    analyser.getByteFrequencyData(dataArr);
    let sum = 0;
    const len = dataArr.length;
    for (let i = 0; i < len; i++) {
      sum += dataArr[i] * dataArr[i];
    }
    return Math.min(1, Math.sqrt(sum / len) / 128);
  }, []);

  // ─── GAME LOOP ───────────────────────────────────────────────────────────

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    // ── FIX: Size canvas to viewport before any drawing ─────────────────
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    const ctx2 = canvas.getContext('2d');
    if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Re-init crowd for current canvas size
    initCrowd(canvas.offsetWidth, canvas.offsetHeight);

    // ── FIX: Add resize listener here (canvas wasn't mounted during useEffect)
    const onResize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      const ctx2 = canvas.getContext('2d');
      if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (stateRef.current.running || stateRef.current.finaleActive) {
        initCrowd(canvas.offsetWidth, canvas.offsetHeight);
      }
    };
    window.addEventListener('resize', onResize);
    // Store cleanup reference on canvas for use in cleanup effect
    (canvas as HTMLCanvasElement & { _roarResizeCleanup?: () => void })._roarResizeCleanup = () =>
      window.removeEventListener('resize', onResize);

    // Reset state
    s.running = true;
    s.finaleActive = false;
    s.timeLeft = DURATION;
    s.sig = {
      avgVolume: 0,
      peakVolume: 0,
      sustainedRoarTime: 0,
      silenceEvents: 0,
      roarBursts: 0,
      volumeSum: 0,
      volumeCount: 0,
      roarStartTime: null,
      score: 0,
    };
    s.smoothedVolume = 0;
    s.silenceStartTime = null;
    s.inSilenceEvent = false;
    s.wasAboveThreshold = false;
    s.challenge = { active: false, target: 0.8, label: 'Hit 80%!', endTime: 0, bonusAwarded: false, hit: false };
    s.challenge15Triggered = false;
    s.challenge30Triggered = false;
    s.particles = [];
    s.flashAlpha = 0;
    s.scoreSnap = 0;

    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');

    // ── FIX: Start crowd ambient music for sonic identity ────────────────
    stopMusicRef.current = startMusic('pulse');

    // 1-second countdown interval
    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);

      // Update score display once per second
      setScoreDisplay(Math.round(s.sig.score));
      s.scoreSnap = Math.round(s.sig.score);

      // ── FIX: Per-second tick audio ──────────────────────────────────
      if (s.timeLeft === 10) {
        sfx.warning();   // distinct warning at 10s mark
      } else if (s.timeLeft > 0 && s.timeLeft < 10) {
        sfx.tick();      // faster tick for last 9 seconds
      } else if (s.timeLeft > 10) {
        sfx.tick();      // standard tick each second
      }

      // Trigger challenges
      if (s.timeLeft === 30 && !s.challenge15Triggered) {
        s.challenge15Triggered = true;
        s.challenge = {
          active: true,
          target: 0.7,
          label: 'Hit 70%!',
          endTime: Date.now() + CHALLENGE_MS,
          bonusAwarded: false,
          hit: false,
        };
      }
      if (s.timeLeft === 15 && !s.challenge30Triggered) {
        s.challenge30Triggered = true;
        s.challenge = {
          active: true,
          target: 0.8,
          label: 'Hit 80%!',
          endTime: Date.now() + CHALLENGE_MS,
          bonusAwarded: false,
          hit: false,
        };
      }

      if (s.timeLeft <= 0) {
        // ── FIX: Remove sfx.fail() — timer expiry is normal game completion
        haptic([300]);
        endGame();
      }
    }, 1000);

    const loop = () => {
      // ── FIX: Allow loop to continue during finale for stadium explosion ─
      if (!s.running && !s.finaleActive) return;
      const W   = canvas.offsetWidth;
      const H   = canvas.offsetHeight;
      const now = Date.now();

      // ── During finale: skip game logic, just render the crowd explosion ─
      if (!s.running && s.finaleActive) {
        // Flash decay
        s.flashAlpha = Math.max(0, s.flashAlpha - 0.018);

        // Crowd lerps to max excitement
        for (const m of s.crowd) {
          m.excitementCurrent = m.excitementCurrent * 0.85 + 1.0 * 0.15;
        }

        // Spawn celebration particles
        if (s.particles.length < 150) {
          const idx = Math.floor(Math.random() * s.crowd.length);
          const m = s.crowd[idx];
          if (m) {
            spawnBurst(s.particles, m.x, m.baseY - 20, s.accentColor, 6, 4);
          }
        }

        // Render finale frame (simplified)
        ctx.imageSmoothingEnabled = true;
        ctx.fillStyle = '#08090f';
        ctx.fillRect(0, 0, W, H);

        if (s.flashAlpha > 0) {
          ctx.fillStyle = `rgba(239, 68, 68, ${s.flashAlpha * 0.4})`;
          ctx.fillRect(0, 0, W, H);
        }

        // Render crowd at max excitement
        for (const m of s.crowd) {
          const exc    = m.excitementCurrent;
          const t      = now * 0.001;
          const swayX  = exc * 6 * Math.sin(t * 3 + m.colFrac * 6);
          const bobY   = exc * 12 * Math.abs(Math.sin(t * 3.5 + m.row * 1.1));
          const bodyH  = (12 + exc * 18) * m.size;
          const headR  = (5 + exc * 2) * m.size;
          const alpha  = 0.35 + exc * 0.65;

          ctx.fillStyle = `rgba(239, 68, 68, ${alpha})`;
          ctx.shadowBlur  = 10 + exc * 12;
          ctx.shadowColor = s.accentColor;

          const cx = m.x + swayX;
          const cy = m.baseY - bobY;

          ctx.beginPath();
          ctx.ellipse(cx, cy, bodyH * 0.28, bodyH * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.beginPath();
          ctx.arc(cx, cy - bodyH * 0.5 - headR * 0.9, headR, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        updateAndDrawParticles(ctx, s.particles);

        animRef.current = requestAnimationFrame(loop);
        return;
      }

      // ── Mic volume ──────────────────────────────────────────────────────
      const rawVol = getMicVolume();
      // Lerp smoothing factor 0.2 per spec
      s.smoothedVolume = s.smoothedVolume * 0.8 + rawVol * 0.2;
      const vol = s.smoothedVolume;

      // ── Update signals ──────────────────────────────────────────────────
      s.sig.volumeSum += vol;
      s.sig.volumeCount++;
      if (vol > s.sig.peakVolume) s.sig.peakVolume = vol;

      // Sustained roar time tracking
      if (vol >= ROAR_THRESHOLD) {
        if (s.sig.roarStartTime === null) s.sig.roarStartTime = now;
      } else {
        if (s.sig.roarStartTime !== null) {
          s.sig.sustainedRoarTime += now - s.sig.roarStartTime;
          s.sig.roarStartTime = null;
        }
      }

      // Roar burst detection (with hysteresis)
      if (vol >= ROAR_THRESHOLD && !s.wasAboveThreshold) {
        s.sig.roarBursts++;
        s.wasAboveThreshold = true;
      } else if (vol < ROAR_THRESHOLD - 0.08) {
        s.wasAboveThreshold = false;
      }

      // Silence event tracking
      if (vol < SILENCE_THRESHOLD) {
        if (s.silenceStartTime === null) {
          s.silenceStartTime = now;
          s.inSilenceEvent = false;
        } else if (!s.inSilenceEvent && (now - s.silenceStartTime) >= SILENCE_MS) {
          s.inSilenceEvent = true;
          s.sig.silenceEvents++;
          sfx.collision();  // spec.audio.missSound
          haptic([40]);
        }
      } else {
        s.silenceStartTime = null;
        s.inSilenceEvent = false;
      }

      // ── Score accumulation ──────────────────────────────────────────────
      // Per frame above roar threshold: +volume * 10 / 60 (per spec, per-frame)
      if (vol >= ROAR_THRESHOLD) {
        s.sig.score += vol * (10 / 60);
      }

      // ── Challenge check ─────────────────────────────────────────────────
      if (s.challenge.active) {
        if (now >= s.challenge.endTime) {
          s.challenge.active = false;
        } else if (!s.challenge.bonusAwarded && vol >= s.challenge.target) {
          s.challenge.bonusAwarded = true;
          s.challenge.hit = true;
          s.sig.score += 50;
          sfx.collect();  // spec.audio.hitSound
          haptic([30, 20, 30]);
          s.flashAlpha = 0.55;
        }
      }

      // ── Update crowd excitement ─────────────────────────────────────────
      for (const m of s.crowd) {
        // Wave stagger: front rows react faster than back rows
        const stagger = m.colFrac * 0.12 + (m.row / 4) * 0.08;
        const target  = Math.max(0, Math.min(1, vol - stagger * 0.15));
        m.excitementTarget  = target;
        m.excitementCurrent = m.excitementCurrent * 0.88 + m.excitementTarget * 0.12;
      }

      // ── Spawn particles at peak volume ──────────────────────────────────
      if (vol >= ROAR_THRESHOLD && s.particles.length < 120) {
        const particleRate = vol * 0.35;
        if (Math.random() < particleRate) {
          // Pick a random excited crowd member
          const idx = Math.floor(Math.random() * s.crowd.length);
          const m   = s.crowd[idx];
          if (m) {
            const hue   = 0 + m.hue;
            const color = `hsl(${hue}, 100%, ${55 + vol * 30}%)`;
            spawnBurst(s.particles, m.x, m.baseY - 20, color, 4, 3);
          }
        }
      }

      // ── Flash decay ─────────────────────────────────────────────────────
      s.flashAlpha = Math.max(0, s.flashAlpha - 0.025);

      // ── RENDER ──────────────────────────────────────────────────────────

      ctx.imageSmoothingEnabled = true;

      // Background
      ctx.fillStyle = '#08090f';
      ctx.fillRect(0, 0, W, H);

      // ── Edge glow (scales with volume) ──────────────────────────────────
      if (vol > 0.05) {
        const glowA = Math.floor(vol * 160).toString(16).padStart(2, '0');
        const accent = s.accentColor;

        // Bottom glow (stadium floor)
        const bottomGrad = ctx.createLinearGradient(0, H * 0.6, 0, H);
        bottomGrad.addColorStop(0, 'transparent');
        bottomGrad.addColorStop(1, `${accent}${glowA}`);
        ctx.fillStyle = bottomGrad;
        ctx.fillRect(0, H * 0.6, W, H * 0.4);

        // Side glows
        if (vol > 0.3) {
          const sideA = Math.floor(vol * 80).toString(16).padStart(2, '0');
          const leftGrad = ctx.createLinearGradient(0, 0, W * 0.25, 0);
          leftGrad.addColorStop(0, `${accent}${sideA}`);
          leftGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = leftGrad;
          ctx.fillRect(0, 0, W * 0.25, H);

          const rightGrad = ctx.createLinearGradient(W, 0, W * 0.75, 0);
          rightGrad.addColorStop(0, `${accent}${sideA}`);
          rightGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = rightGrad;
          ctx.fillRect(W * 0.75, 0, W * 0.25, H);
        }

        // Top glow at very loud volumes (full stadium effect)
        if (vol > 0.75) {
          const topA = Math.floor((vol - 0.75) * 4 * 60).toString(16).padStart(2, '0');
          const topGrad = ctx.createLinearGradient(0, 0, 0, H * 0.3);
          topGrad.addColorStop(0, `${accent}${topA}`);
          topGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = topGrad;
          ctx.fillRect(0, 0, W, H * 0.3);
        }
      }

      // ── Bonus flash overlay ──────────────────────────────────────────────
      if (s.flashAlpha > 0) {
        ctx.fillStyle = `rgba(239, 68, 68, ${s.flashAlpha * 0.28})`;
        ctx.fillRect(0, 0, W, H);
      }

      // ── Stadium floor / stage ────────────────────────────────────────────
      const stageY  = H - 48;
      const stageGrad = ctx.createLinearGradient(0, stageY - 30, 0, H);
      stageGrad.addColorStop(0, 'rgba(239,68,68,0.12)');
      stageGrad.addColorStop(1, 'rgba(239,68,68,0.04)');
      ctx.fillStyle = stageGrad;
      ctx.fillRect(72, stageY - 30, W - 72, 78);

      // Stage line
      ctx.strokeStyle = `rgba(239,68,68,${0.15 + vol * 0.4})`;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(72, stageY);
      ctx.lineTo(W, stageY);
      ctx.stroke();

      // ── Crowd members ────────────────────────────────────────────────────
      for (const m of s.crowd) {
        const exc    = m.excitementCurrent;
        const t      = now * 0.001;
        const swayX  = exc * 4 * Math.sin(t * 2.2 + m.colFrac * 6);
        const bobY   = exc * 8 * Math.abs(Math.sin(t * 2.8 + m.row * 1.1));
        const bodyH  = (12 + exc * 18) * m.size;
        const headR  = (5 + exc * 2) * m.size;

        // Color: dark gray when seated → red when excited
        let r = 50, g = 45, b = 52;
        if (exc > 0.3) {
          const t2 = (exc - 0.3) / 0.7;
          r = Math.round(50 + t2 * 189);  // 50→239
          g = Math.round(45 - t2 * 22);   // 45→23 (approx ef4444)
          b = Math.round(52 - t2 * 16);   // 52→36 (approx ef4444)
        }
        const alpha = 0.35 + exc * 0.65;
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;

        // Glow shadow when excited
        if (exc > 0.6) {
          ctx.shadowBlur  = 6 + exc * 8;
          ctx.shadowColor = s.accentColor;
        } else {
          ctx.shadowBlur = 0;
        }

        const cx = m.x + swayX;
        const cy = m.baseY - bobY;

        // Body
        ctx.beginPath();
        ctx.ellipse(cx, cy, bodyH * 0.28, bodyH * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();

        // Head
        ctx.beginPath();
        ctx.arc(cx, cy - bodyH * 0.5 - headR * 0.9, headR, 0, Math.PI * 2);
        ctx.fill();

        // Arms (when excitement > 0.3)
        if (exc > 0.3) {
          const armBlend = Math.min(1, (exc - 0.3) / 0.7);
          // Arm angle: 0 = horizontal, -PI/2 = straight up
          const armAngle = -Math.PI * 0.15 - armBlend * Math.PI * 0.45;
          const armLen   = bodyH * 0.55;

          ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
          ctx.lineWidth   = 2 * m.size;
          ctx.lineCap     = 'round';
          ctx.shadowBlur  = exc > 0.6 ? 4 : 0;

          // Left arm
          const lx1 = cx - bodyH * 0.22;
          const ly1 = cy - bodyH * 0.15;
          ctx.beginPath();
          ctx.moveTo(lx1, ly1);
          ctx.lineTo(lx1 + Math.cos(Math.PI + armAngle) * armLen, ly1 + Math.sin(Math.PI + armAngle) * armLen);
          ctx.stroke();

          // Right arm
          const rx1 = cx + bodyH * 0.22;
          ctx.beginPath();
          ctx.moveTo(rx1, ly1);
          ctx.lineTo(rx1 + Math.cos(-armAngle) * armLen, ly1 + Math.sin(-armAngle) * armLen);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }

      // ── Particles ────────────────────────────────────────────────────────
      updateAndDrawParticles(ctx, s.particles);

      // ── Power Meter (left side) ──────────────────────────────────────────
      const mX  = 12;
      const mW  = 44;
      const mH  = H * 0.72;
      const mY  = (H - mH) * 0.5;
      const accent = s.accentColor;

      // Meter track background
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.roundRect(mX, mY, mW, mH, 8);
      ctx.fill();
      ctx.stroke();

      // Fill from bottom based on smoothed volume
      const fillH = mH * s.smoothedVolume;
      const fillY = mY + mH - fillH;
      if (fillH > 2) {
        ctx.shadowBlur  = vol > ROAR_THRESHOLD ? 16 : 6;
        ctx.shadowColor = accent;
        const fillGrad = ctx.createLinearGradient(0, fillY, 0, mY + mH);
        fillGrad.addColorStop(0, accent);
        fillGrad.addColorStop(1, `${accent}55`);
        ctx.fillStyle = fillGrad;
        ctx.beginPath();
        ctx.roundRect(mX + 2, fillY, mW - 4, fillH, [0, 0, 6, 6]);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Threshold marker (dashed line at 60%)
      const threshY = mY + mH * (1 - ROAR_THRESHOLD);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth   = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(mX - 2, threshY);
      ctx.lineTo(mX + mW + 2, threshY);
      ctx.stroke();
      ctx.setLineDash([]);

      // "PWR" label above meter
      ctx.fillStyle   = 'rgba(255,255,255,0.45)';
      ctx.font        = '700 11px "Space Grotesk", sans-serif';
      ctx.textAlign   = 'center';
      ctx.fillText('PWR', mX + mW * 0.5, mY - 8);

      // Volume % inside meter (when at least moderate volume)
      if (vol > 0.1) {
        const pct = Math.round(vol * 100);
        ctx.fillStyle = vol >= ROAR_THRESHOLD ? '#ffffff' : 'rgba(255,255,255,0.5)';
        ctx.font      = `700 ${pct >= 100 ? 10 : 11}px "Space Grotesk", sans-serif`;
        ctx.fillText(`${pct}%`, mX + mW * 0.5, fillY - 6);
      }
      ctx.textAlign = 'left';

      // ── Challenge overlay ────────────────────────────────────────────────
      if (s.challenge.active) {
        const remain  = (s.challenge.endTime - now) / CHALLENGE_MS;
        const barProg = Math.min(1, vol / s.challenge.target);
        const cX = W * 0.5 + 36;  // shift right to clear power meter
        const cY = H * 0.22;

        // Background card
        ctx.fillStyle   = 'rgba(8, 9, 15, 0.88)';
        ctx.strokeStyle = s.challenge.hit ? '#4ade80' : accent;
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.roundRect(cX - 110, cY - 44, 220, 88, 14);
        ctx.fill();
        ctx.stroke();

        // Timer shrink effect (card border fades as time runs out)
        ctx.strokeStyle = `rgba(239, 68, 68, ${remain * 0.3})`;
        ctx.lineWidth   = remain * 8;
        ctx.beginPath();
        ctx.roundRect(cX - 110, cY - 44, 220, 88, 14);
        ctx.stroke();

        // "ROAR CHALLENGE" header
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font      = '700 11px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.letterSpacing = '0.12em';
        ctx.fillText('ROAR CHALLENGE', cX, cY - 22);
        ctx.letterSpacing = '0';

        // Target label or success
        ctx.fillStyle = s.challenge.hit ? '#4ade80' : '#ffffff';
        ctx.font      = '800 20px "Space Grotesk", sans-serif';
        ctx.fillText(s.challenge.hit ? '+50 BONUS!' : s.challenge.label, cX, cY + 6);

        // Progress bar
        const bW = 180;
        const bH = 5;
        const bX = cX - bW * 0.5;
        const bY = cY + 20;

        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.beginPath();
        ctx.roundRect(bX, bY, bW, bH, 2);
        ctx.fill();

        if (barProg > 0) {
          ctx.shadowBlur  = 6;
          ctx.shadowColor = accent;
          ctx.fillStyle   = s.challenge.hit ? '#4ade80' : accent;
          ctx.beginPath();
          ctx.roundRect(bX, bY, bW * barProg, bH, 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        ctx.textAlign = 'left';
      }

      // ── Silence warning ─────────────────────────────────────────────────
      if (s.silenceStartTime !== null && !s.inSilenceEvent) {
        const silP = Math.min(1, (now - s.silenceStartTime) / SILENCE_MS);
        if (silP > 0.4) {
          ctx.globalAlpha = silP * 0.7;
          ctx.fillStyle   = '#ef4444';
          ctx.font        = `800 ${Math.round(22 + silP * 10)}px "Space Grotesk", sans-serif`;
          ctx.textAlign   = 'center';
          ctx.fillText('STAY LOUD!', W * 0.5 + 36, H * 0.15);
          ctx.textAlign  = 'left';
          ctx.globalAlpha = 1;
        }
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, initCrowd, getMicVolume]);

  // ─── CANVAS SETUP & RESIZE ───────────────────────────────────────────────
  // Note: resize listener is added inside startLoop since the canvas isn't
  // mounted until phase='countdown'. This effect only runs for the initial case.

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      const ctx2 = canvas.getContext('2d');
      if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (stateRef.current.running) {
        initCrowd(canvas.offsetWidth, canvas.offsetHeight);
      }
    };
    resize();
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
    };
  }, [initCrowd, phase]);  // ← FIX: re-run when phase changes so canvas is sized when it mounts

  // ─── CLEANUP ON UNMOUNT ──────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (finaleTimeoutRef.current) clearTimeout(finaleTimeoutRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
      if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t => t.stop());
      // Clean up any resize listener attached by startLoop
      const canvas = canvasRef.current;
      if (canvas) {
        const typed = canvas as HTMLCanvasElement & { _roarResizeCleanup?: () => void };
        if (typed._roarResizeCleanup) typed._roarResizeCleanup();
      }
    };
  }, []);

  // ─── PHASE TRANSITIONS ───────────────────────────────────────────────────

  const handleStart = useCallback((name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    initAudio();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('permission');
  }, []);

  const handlePermission = useCallback(async () => {
    setPermError('');
    // Test shortcut: skip mic acquisition when audio is disabled (e.g. Playwright)
    if ((window as unknown as Record<string,unknown>).__DISABLE_AUDIO) { setPhase('countdown'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      setPhase('countdown');
    } catch {
      setPermError('Microphone access denied. Please allow mic access and try again.');
    }
  }, []);

  const handleCountdownDone = useCallback(() => {
    startLoop();
  }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    // Cancel any pending finale timeout
    if (finaleTimeoutRef.current) { clearTimeout(finaleTimeoutRef.current); finaleTimeoutRef.current = null; }
    // Close mic on play-again (will be re-requested)
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    analyserRef.current  = null;
    dataArrayRef.current = null;

    setPhase('start');
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setFinalSig(null);
    setPermError('');
  }, []);

  // ─── END SCREEN INSIGHTS ────────────────────────────────────────────────

  const buildInsights = (sig: Signals) => {
    const peakPct  = Math.round(sig.peakVolume * 100);
    const avgPct   = Math.round(sig.avgVolume  * 100);
    const roarSec  = Math.round(sig.sustainedRoarTime / 1000);

    return [
      {
        label: 'Max Power',
        value: `${peakPct}%`,
        color: peakPct >= 80 ? '#4ade80' : peakPct >= 50 ? '#facc15' : '#ef4444',
      },
      {
        label: 'Avg Volume',
        value: `${avgPct}%`,
        color: avgPct >= 60 ? '#4ade80' : avgPct >= 40 ? '#facc15' : '#ef4444',
      },
      {
        label: 'Roar Time',
        value: `${roarSec}s`,
        color: roarSec > 20 ? '#4ade80' : roarSec >= 10 ? '#facc15' : '#ef4444',
      },
      {
        label: 'Silent Moments',
        value: `${sig.silenceEvents}`,
        color: sig.silenceEvents === 0 ? '#4ade80' : sig.silenceEvents <= 2 ? '#facc15' : '#ef4444',
      },
    ];
  };

  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="crowd-roar"
          steps={[{ icon: "📣", title: "Make noise", body: "Shout, clap, or cheer into your mic." }, { icon: "🔊", title: "Hit the meter", body: "Fill the volume meter to energize the crowd." }, { icon: "🏟️", title: "Keep it up", body: "Don't let the crowd go quiet — sustain the roar!" }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>

      {/* ── Start Screen ───────────────────────────────────────────────────── */}
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          sensorNote="🎤 Microphone — roar into your phone"
          ctaLabel="Allow Mic & Start"
          accentColor={theme.colors.accent ?? ACCENT}
          onStart={handleStart}
        />
      )}

      {/* ── Permission Screen ──────────────────────────────────────────────── */}
      {phase === 'permission' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#08090f',
            padding: '32px 24px',
            gap: 24,
            paddingTop: 72,
          }}
        >
          {/* Mic icon */}
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: '50%',
              background: `rgba(239, 68, 68, 0.12)`,
              border: `2px solid ${theme.colors.accent ?? ACCENT}44`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Mic size={48} color={theme.colors.accent ?? ACCENT} />
          </div>

          {/* Copy */}
          <div style={{ textAlign: 'center', maxWidth: 300 }}>
            <div
              style={{
                fontSize: 28,
                fontWeight: 800,
                color: '#ffffff',
                marginBottom: 12,
                fontFamily: "'Space Grotesk', sans-serif",
                letterSpacing: '-0.02em',
              }}
            >
              Mic Access Needed
            </div>
            <div
              style={{
                fontSize: 16,
                color: 'rgba(255,255,255,0.6)',
                lineHeight: 1.6,
                fontFamily: "'Space Grotesk', sans-serif",
              }}
            >
              Crowd Roar measures how loud you can roar. Your mic data stays on your device and is never stored.
            </div>
          </div>

          {/* Error */}
          {permError && (
            <div
              style={{
                color: '#ef4444',
                fontSize: 14,
                textAlign: 'center',
                maxWidth: 280,
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.2)',
                padding: '12px 16px',
                borderRadius: 10,
                fontFamily: "'Space Grotesk', sans-serif",
                lineHeight: 1.5,
              }}
            >
              {permError}
            </div>
          )}

          {/* Allow button */}
          <button
            onClick={() => { void handlePermission(); }}
            style={{
              background: theme.colors.accent ?? ACCENT,
              color: '#000000',
              border: 'none',
              borderRadius: 14,
              padding: '0 48px',
              height: 56,
              fontSize: 18,
              fontWeight: 800,
              cursor: 'pointer',
              fontFamily: "'Space Grotesk', sans-serif",
              minWidth: 240,
              letterSpacing: '-0.01em',
            }}
          >
            Allow &amp; Start
          </button>

          {/* Back */}
          <button
            onClick={() => setPhase('start')}
            style={{
              background: 'transparent',
              color: 'rgba(255,255,255,0.45)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 10,
              padding: '10px 24px',
              fontSize: 15,
              cursor: 'pointer',
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            Back
          </button>
        </div>
      )}

      {/* ── Countdown ─────────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}

      {/* ── Playing ───────────────────────────────────────────────────────── */}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              touchAction: 'none',
            }}
          />
          {phase === 'playing' && (
            <GameHUD
              accentColor={theme.colors.accent ?? ACCENT}
              items={[
                { label: 'TIME',  value: timeLeft,     danger: timeLeft <= 10 },
                { label: 'POWER', value: scoreDisplay },
              ]}
            />
          )}
        </>
      )}
      {/* New best banner */}
      <AnimatePresence>
        {isNewBest && (
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
              borderRadius: 20, padding: '8px 20px', fontSize: 20,
              fontWeight: 900, color: '#000', whiteSpace: 'nowrap',
              boxShadow: '0 4px 20px rgba(251,191,36,0.5)',
            }}
          >
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>



      {/* ── End Screen ────────────────────────────────────────────────────── */}
      {phase === 'done' && finalSig && (
        <EndScreen
          gameId={GAME_ID}
          title={getPersonality(finalSig)}
          emoji={GAME_EMOJI}
          score={String(finalSig.score)}
          personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)}
          accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain}
          didWin={finalSig.peakVolume >= ROAR_THRESHOLD}
        />
      )}

      {/* ── Webhook ───────────────────────────────────────────────────────── */}
      {phase === 'done' && finalSig && (
        <WebhookEmitter
          theme={theme}
          gameId={GAME_ID}
          sig={finalSig}
          personality={getPersonality(finalSig)}
          player={playerSessionRef.current}
        />
      )}
      {phase === 'playing' && (
        <>
          <ScorePopEffect pops={pops} accentColor={CATEGORY_ACCENT} />
          <StreakBadge streak={streak} accentColor={CATEGORY_ACCENT} />
        </>
      )}
    </GameShell>
    </>
  );
}

// ─── WEBHOOK EMITTER ─────────────────────────────────────────────────────────

function WebhookEmitter({ theme, gameId, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>;
  gameId: string;
  sig: Signals;
  personality: string;
  player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    postWebhook(theme, gameId, {
      personality,
      score:             sig.score,
      avgVolume:         sig.avgVolume,
      peakVolume:        parseFloat(sig.peakVolume.toFixed(3)),
      sustainedRoarTime: sig.sustainedRoarTime,
      silenceEvents:     sig.silenceEvents,
      roarBursts:        sig.roarBursts,
    }, player);
  }, [theme, gameId, sig, personality]);
  return null;
}
