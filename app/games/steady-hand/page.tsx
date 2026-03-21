/**
 * ══════════════════════════════════════════════════════════════════
 *  STEADY HAND — V2
 *  Sensor: DeviceMotion (accelerometer) | Fallback: touch
 *  Duration: 30s | Accent: #22c55e
 * ══════════════════════════════════════════════════════════════════
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
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
import { Sun, Moon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY_ACCENT = CATEGORY_THEMES.cognitive.primaryAccent;

// ─── SPEC CONSTANTS ──────────────────────────────────────────────────────────

const GAME_ID      = 'steady-hand';
const PB_KEY       = 'pb_steady-hand';

// Haptics toggle — respect ?haptics=off URL param (accessibility: B-M3)
function getHapticsEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return new URLSearchParams(window.location.search).get('haptics') !== 'off';
}
const ACCENT       = '#22c55e';
const DURATION     = 30;
const GAME_EMOJI   = '🎯';
const GAME_TITLE   = 'Steady Hand';
const GAME_TAGLINE = 'Hold perfectly still. We dare you.';

// V2 physics constants
const TARGET_RADIUS       = 8;       // px — requires real stillness
const MOTION_SENSITIVITY  = 3.2;     // px per m/s² per frame
const CURSOR_DAMPING      = 0.88;    // velocity decay per frame
const ACC_SMOOTH          = 0.20;    // accelerometer EMA factor

// Interference schedule (seconds from game start, randomized ±0.5s at runtime)
const INTERFERENCE_BASE = [
  { at: 6,  pattern: [80, 50, 80] as number[],          label: 'distraction' },
  { at: 9,  pattern: [150, 80, 150, 80, 150] as number[], label: 'strong' },
  { at: 13, pattern: [80, 50, 80] as number[],          label: 'distraction' },
  { at: 16, pattern: [200, 100, 200] as number[],       label: 'big jolt' },
  { at: 19, pattern: [80, 50, 80] as number[],          label: 'distraction' },
  { at: 22, pattern: [150, 80, 150, 80, 150] as number[], label: 'strong' },
  { at: 25, pattern: [80, 50, 80] as number[],          label: 'distraction' },
] as const;

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface Signals {
  timeOnTarget:         number;   // % of game time within target radius
  avgDeviation:         number;   // mean pixel distance from center
  tremorScore:          number;   // 0–100 variance of recent samples
  streakCurrent:        number;   // current consecutive on-target seconds
  maxStreak:            number;   // best streak in seconds
  interferenceSurvived: number;   // pulses survived without breaking
  totalSamples:         number;   // total motion samples collected
  score:                number;   // composite (for end screen)
  // Internal tracking
  onTargetFrames:    number;
  totalFrames:       number;
  deviationSum:      number;
  recentDeviations:  number[];
  interferenceCount: number;
}

interface InterferenceEvent {
  triggerMs:    number;
  warningMs:    number;
  pattern:      number[];
  label:        string;
  fired:        boolean;
  survived:     boolean;
  warningShown: boolean;
}

interface GameState {
  running:          boolean;
  timeLeft:         number;
  gameStartTime:    number;
  sig:              Signals;
  // Cursor
  cursorX:          number;
  cursorY:          number;
  cursorVX:         number;
  cursorVY:         number;
  // Accelerometer smoothed
  smoothedAccX:     number;
  smoothedAccY:     number;
  // Per-second streak tracking
  secondOnTarget:   number;
  secondTotal:      number;
  // Interference
  interferenceEvents: InterferenceEvent[];
  warningActive:    boolean;
  warningStartMs:   number;
  // Touch fallback
  usingTouchFallback: boolean;
  touchActive:      boolean;
  touchStartX:      number;
  touchStartY:      number;
  touchCurrentX:    number;
  touchCurrentY:    number;
  // Animation
  pulsePhase:       number;
  streakFlashAt:    number;
  // Theme (read by rAF, updated via ref)
  accentColor:      string;
  isDark:           boolean;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ─── PERSONALITY CLASSIFICATION ──────────────────────────────────────────────

function getPersonality(sig: Signals): string {
  const tot = sig.timeOnTarget;
  const ts  = sig.tremorScore;
  const sur = sig.interferenceSurvived;
  const str = sig.maxStreak;
  if (tot >= 90 && ts < 10)         return 'Surgeon 🔬';          // Pinpoint precision, minimal tremor
  if (tot >= 75 && ts < 25)         return 'Steady as a Rock 🪨'; // High accuracy, low tremor
  if (sur >= 4 && tot >= 60)        return 'Iron Nerve 🧠';       // Survived interference, solid accuracy
  if (tot >= 60 && str >= 8)        return 'Focused 🎯';          // Good accuracy with long clean runs
  if (tot >= 40)                    return 'Getting There 🌱';    // On the way
  return 'Shaky But Brave 😅';                                    // Fallback — tried hard
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function buildInterferenceEvents(): InterferenceEvent[] {
  return INTERFERENCE_BASE.map(ev => {
    const offset = (Math.random() - 0.5) * 1000;
    const triggerMs = ev.at * 1000 + offset;
    return {
      triggerMs,
      warningMs: triggerMs - 300,
      pattern: [...ev.pattern],
      label: ev.label,
      fired: false,
      survived: false,
      warningShown: false,
    };
  });
}

function deviationColor(d: number): string {
  if (d <= TARGET_RADIUS)      return '#4ade80';
  if (d <= TARGET_RADIUS * 4)  return '#facc15';
  return '#ef4444';
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function SteadyHandGame() {
  const theme       = useBrandTheme();
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const animRef     = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const motionRef   = useRef<((e: DeviceMotionEvent) => void) | null>(null);
  const fallbackCheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hapticsEnabled = useRef(getHapticsEnabled());

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION, gameStartTime: 0,
    sig: {
      timeOnTarget: 0, avgDeviation: 0, tremorScore: 0,
      streakCurrent: 0, maxStreak: 0, interferenceSurvived: 0,
      totalSamples: 0, score: 0,
      onTargetFrames: 0, totalFrames: 0, deviationSum: 0,
      recentDeviations: [], interferenceCount: 0,
    },
    cursorX: 0, cursorY: 0, cursorVX: 0, cursorVY: 0,
    smoothedAccX: 0, smoothedAccY: 0,
    secondOnTarget: 0, secondTotal: 0,
    interferenceEvents: [],
    warningActive: false, warningStartMs: 0,
    usingTouchFallback: false, touchActive: false,
    touchStartX: 0, touchStartY: 0, touchCurrentX: 0, touchCurrentY: 0,
    pulsePhase: 0, streakFlashAt: 0,
    accentColor: ACCENT, isDark: true,
  });

  // React state — only these drive re-renders
  const [phase, setPhase]               = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);  // on-target %
  const [streakDisplay, setStreakDisplay] = useState(0); // current streak
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);
  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const { pops, triggerPop } = useScorePop();
  const prevScoreRef = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const numScore = typeof scoreDisplay === 'number' ? scoreDisplay : 0;
    if (numScore > prevScoreRef.current) {
      triggerPop(`+${numScore - prevScoreRef.current}`, window.innerWidth / 2, 200);
    }
    prevScoreRef.current = numScore;
  }, [scoreDisplay]); // triggerPop is stable
  const playerSessionRef                = useRef<PlayerSession | null>(null);
  const [scorePop, setScorePop]         = useState<string | null>(null);
  const [nearMissMsg, setNearMissMsg]   = useState(false);
  const [isNewBest, setIsNewBest]       = useState(false);
  const nearMissTimeoutRef              = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Local dark/light theme (game-specific, stored in localStorage)
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return true;
    return (localStorage.getItem('mg_theme') ?? 'dark') !== 'light';
  });

  // Sync refs used by rAF loop
  useEffect(() => {
    stateRef.current.accentColor = theme.colors.accent ?? ACCENT;
  }, [theme]);

  useEffect(() => {
    stateRef.current.isDark = isDark;
  }, [isDark]);

  // ─── THEME TOGGLE ────────────────────────────────────────────────────────

  const toggleTheme = useCallback(() => {
    setIsDark(prev => {
      const next = !prev;
      localStorage.setItem('mg_theme', next ? 'dark' : 'light');
      return next;
    });
  }, []);

  // ─── MOTION LISTENER ─────────────────────────────────────────────────────

  const setupMotionListener = useCallback(() => {
    const handler = (e: DeviceMotionEvent) => {
      const s = stateRef.current;
      if (!s.running) return;
      const raw = e.accelerationIncludingGravity;
      if (!raw) return;
      const rawX = raw.x ?? 0;
      const rawY = raw.y ?? 0;
      s.smoothedAccX = s.smoothedAccX * (1 - ACC_SMOOTH) + rawX * ACC_SMOOTH;
      s.smoothedAccY = s.smoothedAccY * (1 - ACC_SMOOTH) + rawY * ACC_SMOOTH;
    };
    motionRef.current = handler;
    window.addEventListener('devicemotion', handler);
  }, []);

  const removeMotionListener = useCallback(() => {
    if (motionRef.current) {
      window.removeEventListener('devicemotion', motionRef.current);
      motionRef.current = null;
    }
  }, []);

  // ─── END GAME ────────────────────────────────────────────────────────────

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    removeMotionListener();

    // Finalize signals
    const sig = s.sig;
    sig.timeOnTarget = sig.totalFrames > 0
      ? Math.round((sig.onTargetFrames / sig.totalFrames) * 100)
      : 0;
    sig.avgDeviation = sig.totalSamples > 0
      ? Math.round(sig.deviationSum / sig.totalSamples)
      : 0;
    sig.interferenceSurvived = s.interferenceEvents.filter(e => e.fired && e.survived).length;
    sig.interferenceCount    = s.interferenceEvents.filter(e => e.fired).length;
    sig.score = Math.round(
      sig.timeOnTarget * 0.6 +
      sig.maxStreak * 3 +
      sig.interferenceSurvived * 6
    );

    // End-game audio: success if ≥60% on-target, else nearMiss
    if (sig.timeOnTarget >= 60) {
      sfx.success();
      hapticVictory();
      playVictoryFanfare();
    } else {
      sfx.nearMiss();
      hapticFail();
    }

    // Personal best tracking
    try {
      const prev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (sig.score > prev) {
        localStorage.setItem(PB_KEY, String(sig.score));
        setIsNewBest(true);
      }
    } catch { /* ignore */ }

    setFinalSig({ ...sig });
    setPhase('done');
  }, [removeMotionListener]);

  // ─── GAME LOOP ───────────────────────────────────────────────────────────

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    ctx.imageSmoothingEnabled = true;

    // Reset all state
    s.running = true;
    s.timeLeft = DURATION;
    s.gameStartTime = Date.now();
    s.sig = {
      timeOnTarget: 0, avgDeviation: 0, tremorScore: 0,
      streakCurrent: 0, maxStreak: 0, interferenceSurvived: 0,
      totalSamples: 0, score: 0,
      onTargetFrames: 0, totalFrames: 0, deviationSum: 0,
      recentDeviations: [], interferenceCount: 0,
    };
    s.cursorX = 0; s.cursorY = 0; s.cursorVX = 0; s.cursorVY = 0;
    s.smoothedAccX = 0; s.smoothedAccY = 0;
    s.secondOnTarget = 0; s.secondTotal = 0;
    s.interferenceEvents = buildInterferenceEvents();
    s.warningActive = false; s.warningStartMs = 0;
    s.pulsePhase = 0; s.streakFlashAt = 0;
    s.touchActive = false;

    setScoreDisplay(0);
    setStreakDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('minimal');

    // 1-second tick for streak + HUD update
    timerRef.current = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      // Timer audio: warning at 10s, tick every second
      if (s.timeLeft === 10) {
        sfx.warning();
        if (hapticsEnabled.current) haptic([50, 30, 50]);
      } else {
        sfx.tick();
      }

      // Per-second on-target check for streak
      if (s.secondTotal > 0) {
        const pct = s.secondOnTarget / s.secondTotal;
        if (pct >= 0.75) {
          s.sig.streakCurrent++;
          if (s.sig.streakCurrent > s.sig.maxStreak) {
            s.sig.maxStreak = s.sig.streakCurrent;
            s.streakFlashAt = Date.now();
            sfx.collect();
            hapticScore();
            playScoreHit('default', 10);
            setScorePop(`🔥 ${s.sig.streakCurrent}s`);
            setTimeout(() => setScorePop(null), 1500);
          }
          // Near-miss: streak within 10% of next milestone (every 5s)
          const nextMilestone = Math.ceil(s.sig.streakCurrent / 5) * 5;
          const distTo = nextMilestone - s.sig.streakCurrent;
          if (distTo === 1 && s.sig.streakCurrent > 0) {
            playNearMiss();
            setNearMissMsg(true);
            if (nearMissTimeoutRef.current) clearTimeout(nearMissTimeoutRef.current);
            nearMissTimeoutRef.current = setTimeout(() => setNearMissMsg(false), 1500);
          }
        } else {
          s.sig.streakCurrent = 0;
        }
        setStreakDisplay(s.sig.streakCurrent);
      }
      s.secondOnTarget = 0;
      s.secondTotal = 0;

      // Update score display (on-target %)
      const pct = s.sig.totalFrames > 0
        ? Math.round((s.sig.onTargetFrames / s.sig.totalFrames) * 100)
        : 0;
      setScoreDisplay(pct);

      if (s.timeLeft <= 0) {
        if (hapticsEnabled.current) haptic([100, 50, 100]);
        endGame();
      }
    }, 1000);

    // ── rAF loop ────────────────────────────────────────────────────────────
    const loop = (timestamp: number) => {
      if (!s.running) return;
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      const cx = W / 2;
      const cy = H / 2;
      const elapsed = Date.now() - s.gameStartTime;

      // ── Cursor position update ──────────────────────────────────────────
      if (!s.usingTouchFallback) {
        // Motion-based: accelerometer → velocity → position
        s.cursorVX += s.smoothedAccX * MOTION_SENSITIVITY;
        s.cursorVY -= s.smoothedAccY * MOTION_SENSITIVITY; // invert Y axis
        s.cursorVX *= CURSOR_DAMPING;
        s.cursorVY *= CURSOR_DAMPING;
      } else if (s.touchActive) {
        // Touch fallback: finger offset from initial touch = cursor position
        const rect = canvas.getBoundingClientRect();
        const scaleX = W / rect.width;
        const scaleY = H / rect.height;
        const targetX = (s.touchCurrentX - s.touchStartX) * scaleX;
        const targetY = (s.touchCurrentY - s.touchStartY) * scaleY;
        // Spring toward target position
        s.cursorVX = (targetX - s.cursorX) * 0.18;
        s.cursorVY = (targetY - s.cursorY) * 0.18;
      } else {
        // No active input: dampen toward center
        s.cursorVX *= CURSOR_DAMPING;
        s.cursorVY *= CURSOR_DAMPING;
      }

      s.cursorX += s.cursorVX;
      s.cursorY += s.cursorVY;

      // Clamp to canvas bounds
      const maxOff = Math.min(W, H) * 0.45;
      const dist = Math.sqrt(s.cursorX * s.cursorX + s.cursorY * s.cursorY);
      if (dist > maxOff) {
        const scale = maxOff / dist;
        s.cursorX *= scale;
        s.cursorY *= scale;
        s.cursorVX *= 0.2;
        s.cursorVY *= 0.2;
      }

      // ── Track signals ───────────────────────────────────────────────────
      const deviation = Math.sqrt(s.cursorX * s.cursorX + s.cursorY * s.cursorY);
      const onTarget  = deviation <= TARGET_RADIUS;

      s.sig.totalFrames++;
      s.sig.totalSamples++;
      s.sig.deviationSum += deviation;
      s.secondTotal++;
      if (onTarget) { s.sig.onTargetFrames++; s.secondOnTarget++; }

      // Rolling 2s tremor window (120 samples @ 60fps)
      s.sig.recentDeviations.push(deviation);
      if (s.sig.recentDeviations.length > 120) s.sig.recentDeviations.shift();
      if (s.sig.recentDeviations.length > 0) {
        const samples = s.sig.recentDeviations;
        const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
        const variance = samples.reduce((acc, v) => acc + (v - mean) ** 2, 0) / samples.length;
        s.sig.tremorScore = Math.min(100, Math.round(variance / 2.5));
      }

      // ── Interference events ─────────────────────────────────────────────
      for (const ev of s.interferenceEvents) {
        if (!ev.warningShown && elapsed >= ev.warningMs) {
          ev.warningShown = true;
          s.warningActive = true;
          s.warningStartMs = elapsed;
          // Shimmer rising cue telegraphs incoming interference pulse (distinct from timer warning)
          sfx.shimmer();
        }
        if (!ev.fired && elapsed >= ev.triggerMs) {
          ev.fired = true;
          ev.survived = deviation <= TARGET_RADIUS * 4; // survived if not fully broken
          if (hapticsEnabled.current) haptic(ev.pattern);
          sfx.nearMiss();
        }
      }
      if (s.warningActive && elapsed - s.warningStartMs > 300) {
        s.warningActive = false;
      }

      // Pulse phase for ring animation
      s.pulsePhase = (s.pulsePhase + 0.045) % (Math.PI * 2);

      // ── RENDER ─────────────────────────────────────────────────────────
      const dark   = s.isDark;
      const accent = s.accentColor;
      const bg     = dark ? '#08090f' : '#f0f4f8';
      const gridC  = dark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.04)';
      const textC  = dark ? '#ffffff' : '#0d1117';
      const textC2 = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)';

      // Background — rich teal/dark gradient in dark mode
      if (dark) {
        const shBg = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.65, Math.max(W, H) * 0.9);
        shBg.addColorStop(0,   '#001510');
        shBg.addColorStop(0.55, '#000d08');
        shBg.addColorStop(1,   '#000503');
        ctx.fillStyle = shBg;
      } else {
        ctx.fillStyle = bg;
      }
      ctx.fillRect(0, 0, W, H);

      // Vignette (dark mode only)
      if (dark) {
        const shVig = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.25, W * 0.5, H * 0.5, H * 0.85);
        shVig.addColorStop(0, 'rgba(0,0,0,0)');
        shVig.addColorStop(1, 'rgba(0,0,0,0.45)');
        ctx.fillStyle = shVig;
        ctx.fillRect(0, 0, W, H);
      }

      // Grid
      ctx.strokeStyle = gridC;
      ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 40) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
      }
      for (let gy = 0; gy < H; gy += 40) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }

      // ── Target zone (canvas center) ─────────────────────────────────────

      // Outer tolerance dashed ring
      ctx.save();
      ctx.strokeStyle = `${accent}33`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, 40, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Warning ring expansion
      if (s.warningActive) {
        const wAge = Math.min(1, (elapsed - s.warningStartMs) / 300);
        const wR   = 16 + wAge * 50;
        ctx.save();
        ctx.globalAlpha  = (1 - wAge) * 0.9;
        ctx.strokeStyle  = '#ef4444';
        ctx.lineWidth    = 3;
        ctx.shadowBlur   = 30;
        ctx.shadowColor  = '#ef4444';
        ctx.beginPath();
        ctx.arc(cx, cy, wR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        // Screen edge flash
        ctx.save();
        ctx.globalAlpha = (1 - wAge) * 0.25;
        const edgeGrad = ctx.createRadialGradient(cx, cy, W * 0.25, cx, cy, W * 0.85);
        edgeGrad.addColorStop(0, 'transparent');
        edgeGrad.addColorStop(1, '#ef4444');
        ctx.fillStyle = edgeGrad;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }

      // Pulsing main ring
      const ringR = TARGET_RADIUS + 5 + 2 * Math.sin(s.pulsePhase);
      ctx.save();
      ctx.shadowBlur  = s.warningActive ? 30 : 16;
      ctx.shadowColor = s.warningActive ? '#ef4444' : accent;
      ctx.strokeStyle = s.warningActive ? '#ef4444' : accent;
      ctx.lineWidth   = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Inner perfect-zone fill
      ctx.save();
      ctx.fillStyle = onTarget ? `${accent}44` : `${accent}18`;
      ctx.beginPath();
      ctx.arc(cx, cy, TARGET_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Center dot
      ctx.save();
      ctx.fillStyle = accent;
      ctx.shadowBlur  = 6;
      ctx.shadowColor = accent;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // ── Crosshair cursor ────────────────────────────────────────────────
      const curAbsX  = cx + s.cursorX;
      const curAbsY  = cy + s.cursorY;
      const curColor = deviationColor(deviation);
      const crossLen = 14;
      const crossGap = 4;

      ctx.save();
      ctx.strokeStyle = curColor;
      ctx.lineWidth   = 2;
      ctx.shadowBlur  = 10;
      ctx.shadowColor = curColor;
      // Horizontal arms (with gap in center)
      ctx.beginPath(); ctx.moveTo(curAbsX - crossLen, curAbsY); ctx.lineTo(curAbsX - crossGap, curAbsY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(curAbsX + crossGap, curAbsY); ctx.lineTo(curAbsX + crossLen, curAbsY); ctx.stroke();
      // Vertical arms
      ctx.beginPath(); ctx.moveTo(curAbsX, curAbsY - crossLen); ctx.lineTo(curAbsX, curAbsY - crossGap); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(curAbsX, curAbsY + crossGap); ctx.lineTo(curAbsX, curAbsY + crossLen); ctx.stroke();
      // Center dot
      ctx.fillStyle = curColor;
      ctx.beginPath();
      ctx.arc(curAbsX, curAbsY, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // ── Deviation bar (below HUD area, ~100px from top) ─────────────────
      const barY     = 108;
      const barH     = 6;
      const barX     = 24;
      const barW     = W - 48;
      const devFill  = Math.min(1, deviation / 80);

      ctx.save();
      ctx.fillStyle = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW, barH, 3);
      ctx.fill();
      if (devFill > 0) {
        const barGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
        barGrad.addColorStop(0,   '#4ade80');
        barGrad.addColorStop(0.4, '#facc15');
        barGrad.addColorStop(1,   '#ef4444');
        ctx.fillStyle = barGrad;
        ctx.beginPath();
        ctx.roundRect(barX, barY, barW * devFill, barH, 3);
        ctx.fill();
      }
      // DEVIATION label
      ctx.fillStyle = textC2;
      ctx.font = '600 13px "Space Grotesk", sans-serif';
      ctx.letterSpacing = '0.08em';
      ctx.textAlign = 'left';
      ctx.fillText('DEVIATION', barX, barY - 5);
      ctx.restore();

      // ── Streak & Tremor (canvas-drawn, below deviation bar) ─────────────
      const metricsY = 134;
      const streakFlashAge = s.streakFlashAt > 0 ? (Date.now() - s.streakFlashAt) / 400 : 1;
      const streakScale = streakFlashAge < 1 ? 1 + 0.25 * Math.sin(Math.PI * streakFlashAge) : 1;

      ctx.save();
      ctx.textAlign = 'left';
      ctx.fillStyle = textC2;
      ctx.font = '600 13px "Space Grotesk", sans-serif';
      ctx.fillText('STREAK', barX, metricsY + 2);

      ctx.save();
      ctx.translate(barX + 70, metricsY - 2);
      ctx.scale(streakScale, streakScale);
      ctx.fillStyle = s.sig.streakCurrent > 0 ? accent : textC;
      ctx.font = `700 28px "Space Grotesk", sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(String(s.sig.streakCurrent), 0, 0);
      ctx.restore();

      // Tremor
      const tremorX = W - barX - 88;
      ctx.textAlign = 'left';
      ctx.fillStyle = textC2;
      ctx.font = '600 13px "Space Grotesk", sans-serif';
      ctx.fillText('TREMOR', tremorX, metricsY + 2);
      const tremorColor = s.sig.tremorScore < 20 ? accent : s.sig.tremorScore < 50 ? '#facc15' : '#ef4444';
      ctx.fillStyle = tremorColor;
      ctx.font = '700 28px "Space Grotesk", sans-serif';
      ctx.fillText(String(s.sig.tremorScore), tremorX + 65, metricsY - 2);
      ctx.restore();

      // ── Touch fallback hint ─────────────────────────────────────────────
      if (s.usingTouchFallback && !s.touchActive) {
        ctx.save();
        ctx.fillStyle = textC2;
        ctx.font = '600 16px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Touch & hold — keep your finger still', cx, cy + 80);
        ctx.restore();
      }

      // ── On-target flash ─────────────────────────────────────────────────
      if (onTarget) {
        ctx.save();
        ctx.globalAlpha = 0.06;
        ctx.fillStyle = accent;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }

      void timestamp;
      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  // ─── CANVAS SETUP & TOUCH FALLBACK LISTENERS ─────────────────────────────

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
    };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running || !s.usingTouchFallback) return;
      s.touchActive    = true;
      s.touchStartX    = e.clientX;
      s.touchStartY    = e.clientY;
      s.touchCurrentX  = e.clientX;
      s.touchCurrentY  = e.clientY;
      // Reset cursor to center when new touch starts
      s.cursorX = 0; s.cursorY = 0;
    };
    const onPointerMove = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running || !s.usingTouchFallback || !s.touchActive) return;
      s.touchCurrentX = e.clientX;
      s.touchCurrentY = e.clientY;
    };
    const onPointerUp = () => {
      stateRef.current.touchActive = false;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  // ─── CLEANUP ON UNMOUNT ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
      if (motionRef.current) window.removeEventListener('devicemotion', motionRef.current);
      if (fallbackCheckRef.current) clearTimeout(fallbackCheckRef.current);
    };
  }, []);

  // ─── PHASE TRANSITIONS ───────────────────────────────────────────────────

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    initAudio();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);

    // Request motion permission (iOS Safari requires explicit permission)
    const DM = DeviceMotionEvent as typeof DeviceMotionEvent & {
      requestPermission?: () => Promise<PermissionState>;
    };
    if (typeof DM.requestPermission === 'function') {
      try {
        const perm = await DM.requestPermission();
        if (perm === 'granted') {
          setupMotionListener();
        } else {
          stateRef.current.usingTouchFallback = true;
          setUsingFallback(true);
        }
      } catch {
        stateRef.current.usingTouchFallback = true;
        setUsingFallback(true);
      }
    } else {
      // Android / desktop — start listener, detect if events actually fire
      setupMotionListener();
      // If no motion events within 1.5s of game start, switch to touch fallback
      fallbackCheckRef.current = setTimeout(() => {
        const s = stateRef.current;
        if (s.running && s.smoothedAccX === 0 && s.smoothedAccY === 0 && !s.usingTouchFallback) {
          s.usingTouchFallback = true;
          setUsingFallback(true);
        }
      }, 1500);
    }

    setPhase('countdown');
  }, [setupMotionListener]);

  const handleCountdownDone = useCallback(() => {
    startLoop();
  }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    setPhase('start');
    setScoreDisplay(0);
    setStreakDisplay(0);
    setTimeLeft(DURATION);
    setFinalSig(null);
    setUsingFallback(false);
    stateRef.current.usingTouchFallback = false;
    stateRef.current.smoothedAccX = 0;
    stateRef.current.smoothedAccY = 0;
  
    setIsNewBest(false);
    prevScoreRef.current = 0;
  }, []);

  // ─── END SCREEN INSIGHTS ─────────────────────────────────────────────────

  const buildInsights = useCallback((sig: Signals) => {
    const totColor = sig.timeOnTarget >= 80 ? '#4ade80'
      : sig.timeOnTarget >= 60 ? '#facc15' : '#ef4444';
    const devColor = sig.avgDeviation <= 10 ? '#4ade80'
      : sig.avgDeviation <= 20 ? '#facc15' : '#ef4444';
    const strColor = sig.maxStreak >= 10 ? '#4ade80'
      : sig.maxStreak >= 5 ? '#facc15' : '#ef4444';
    const surColor = sig.interferenceSurvived >= 4 ? '#4ade80'
      : sig.interferenceSurvived >= 2 ? '#facc15' : '#ef4444';
    const total = sig.interferenceCount;
    return [
      { label: 'Time on Target',       value: `${sig.timeOnTarget}%`,              color: totColor },
      { label: 'Avg Deviation',         value: `${sig.avgDeviation}px`,             color: devColor },
      { label: 'Max Streak',            value: `${sig.maxStreak}s`,                 color: strColor },
      { label: 'Interference Survived', value: `${sig.interferenceSurvived} / ${total}`, color: surColor },
    ];
  }, []);

  // ─── COMPUTED ────────────────────────────────────────────────────────────

  const accent = theme.colors.accent ?? ACCENT;

  // Colors driven by isDark (for start/end screen backgrounds)
  const bgColor   = isDark ? '#08090f' : '#f0f4f8';
  const textColor = isDark ? '#ffffff' : '#0d1117';

  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="steady-hand"
          steps={[{ icon: "✋", title: "Hold still", body: "Keep your device as still as possible." }, { icon: "⏱️", title: "Steady wins", body: "The less you move, the higher you score." }, { icon: "🏆", title: "Beat your best", body: "Try to beat your personal steadiness record." }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>

      {/* ── Start Screen ──────────────────────────────────────────────────── */}
      {phase === 'start' && (
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            background: bgColor,
            transition: 'background 0.3s ease',
            // Override the global --color-bg CSS var so GameStartScreen picks up the local theme
            ['--color-bg' as string]: bgColor,
            ['--color-text' as string]: textColor,
            ['--color-text-secondary' as string]: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)',
          } as React.CSSProperties}
        >
          {/* Theme toggle — below top bar (top bar height=56, zIndex=300) */}
          <button
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              position: 'absolute',
              top: 64,
              right: 16,
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              borderRadius: 22,
              border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}`,
              background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
              color: textColor,
              cursor: 'pointer',
            }}
          >
            {isDark
              ? <Sun size={20} color={textColor} />
              : <Moon size={20} color={textColor} />
            }
          </button>

          <GameStartScreen
            emoji={GAME_EMOJI}
            title={GAME_TITLE}
            description={GAME_TAGLINE}
            ctaLabel="Start →"
            sensorNote="Uses motion sensor — hold still to score"
            accentColor={accent}
            onStart={handleStart}
            gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #001510 0%, #000d08 55%, #000603 100%)"
          >
            {usingFallback && (
              <p style={{
                margin: '8px 0 0',
                fontSize: 13,
                color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)',
                textAlign: 'center',
                lineHeight: 1.5,
              }}>
                No motion sensor detected — touch mode active
              </p>
            )}
          </GameStartScreen>
        </div>
      )}

      {/* ── Countdown ─────────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={accent} />
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
              accentColor={accent}
              items={[
                { label: 'TIME',      value: timeLeft,      danger: timeLeft <= 10, testId: 'timer' },
                { label: 'STREAK', value: streakDisplay, testId: 'streak' },
                { label: 'ON TARGET', value: `${scoreDisplay}%`, testId: 'score' },
              ]}
            />
          )}
        </>
      )}

      {/* Score pop overlay */}
      {scorePop && (
        <div style={{
          position: 'fixed', top: '30%', left: '50%', transform: 'translateX(-50%)',
          zIndex: 80, pointerEvents: 'none',
          animation: 'scorePop 1.5s ease-out forwards',
          fontSize: 44, fontWeight: 900, color: accent,
          textShadow: `0 0 20px ${accent}88`,
          whiteSpace: 'nowrap',
        }}>
          {scorePop}
        </div>
      )}

      {/* Near-miss message */}
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

      {/* New best banner */}
      <AnimatePresence>
        {isNewBest && phase === 'done' && (
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

      {/* ── End Screen ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {phase === 'done' && finalSig && (
          <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ height: '100%' }}>
            <EndScreen
              gameId={GAME_ID}
              title={getPersonality(finalSig)}
              emoji={GAME_EMOJI}
              score={String(finalSig.score)}
              personality={getPersonality(finalSig)}
              insights={buildInsights(finalSig)}
              accentColor={accent}
              onPlayAgain={handlePlayAgain}
              didWin={finalSig.timeOnTarget >= 60}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes scorePop {
          0%   { opacity: 0; transform: translateX(-50%) scale(0.6); }
          15%  { opacity: 1; transform: translateX(-50%) scale(1.5); }
          60%  { opacity: 1; transform: translateX(-50%) scale(1.2); }
          100% { opacity: 0; transform: translateX(-50%) scale(0.9) translateY(-40px); }
        }
      `}</style>

      {/* ── Webhook ───────────────────────────────────────────────────────── */}
      {phase === 'done' && finalSig && (
        <WebhookEmitter
          theme={theme}
          sig={finalSig}
          personality={getPersonality(finalSig)}
          player={playerSessionRef.current}
        />
      )}

      {phase === 'playing' && (
        <>
          <ScorePopEffect pops={pops} accentColor={CATEGORY_ACCENT} />
          <StreakBadge streak={streakDisplay} accentColor={CATEGORY_ACCENT} />
        </>
      )}
    </GameShell>
    </>
  );
}

// ─── WEBHOOK EMITTER ─────────────────────────────────────────────────────────

function WebhookEmitter({ theme, sig, personality, player }: {
  theme:       ReturnType<typeof useBrandTheme>;
  sig:         Signals;
  personality: string;
  player:      PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    postWebhook(theme, GAME_ID, {
      personality,
      score:                sig.score,
      timeOnTarget:         sig.timeOnTarget,
      avgDeviation:         sig.avgDeviation,
      tremorScore:          sig.tremorScore,
      streakCurrent:        sig.streakCurrent,
      maxStreak:            sig.maxStreak,
      interferenceSurvived: sig.interferenceSurvived,
      totalSamples:         sig.totalSamples,
    }, player);
  }, [theme, sig, personality, player]);
  return null;
}
