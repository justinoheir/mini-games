/**
 * ══════════════════════════════════════════════════════════════════
 *  SHADOW TAP
 *  Tap the silhouette before it vanishes.
 *  Sensor: touch | Duration: 45s | Category: skill
 * ══════════════════════════════════════════════════════════════════
 */

'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic } from '@/lib/audio';
import { playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';
import { Eye } from 'lucide-react';

const CATEGORY_ACCENT = CATEGORY_THEMES.cognitive.primaryAccent;

// ─── SPEC CONSTANTS ───────────────────────────────────────────────────────────
const GAME_ID      = 'shadow-tap';
const PB_KEY       = 'pb_shadow-tap';
const ACCENT       = '#64748b';
const DURATION     = 45;
const GAME_EMOJI   = '👁️';
const GAME_TITLE   = 'Shadow Tap';
const GAME_TAGLINE = 'Tap what you see. Before it\'s gone.';

// Shape color — dark silhouette against near-black background
const SHAPE_COLOR  = '#1e293b';
const BG_COLOR     = '#08090f';
const SHAPE_MARGIN = 80; // px from edge

// ─── SHAPE TYPES ──────────────────────────────────────────────────────────────
type ShapeType = 'circle' | 'triangle' | 'diamond';
const SHAPE_TYPES: ShapeType[] = ['circle', 'triangle', 'diamond'];

// ─── BEHAVIORAL SIGNALS ──────────────────────────────────────────────────────
interface Signals {
  hitsOnFirst:        number;   // hits under 350ms (intuitive/gut response)
  misses:             number;   // shapes that disappeared before tapped
  flashReactionTimes: number[]; // ms from flash appear to tap
  wrongAreaTaps:      number;   // taps outside any shape
  hits:               number;   // total successful taps
  streak:             number;   // current consecutive hits
  maxStreak:          number;
  score:              number;
}

// ─── PERSONALITY CLASSIFICATION ──────────────────────────────────────────────
function getPersonality(sig: Signals): string {
  const totalVisible = sig.hits + sig.misses;
  const accuracyBySpeed = totalVisible > 0 ? sig.hits / totalVisible : 0;
  const avgReaction = sig.flashReactionTimes.length > 0
    ? sig.flashReactionTimes.reduce((a, b) => a + b, 0) / sig.flashReactionTimes.length
    : 9999;

  // Gut Reader: primarily intuitive, trusts first instinct
  if (sig.hitsOnFirst > 20 && avgReaction < 400) return 'Gut Reader 👁️';
  // Sharp Processor: high accuracy, processes fast
  if (accuracyBySpeed > 0.80 && sig.misses < 5) return 'Sharp Processor 🔬';
  // Overthinker: hesitates too long, shadow disappears
  if (avgReaction > 600 && sig.misses > 8) return 'Overthinker 🌀';
  // Fallback — balanced instinct and processing
  return 'The Hunter 🌊';
}

// ─── GAME STATE ───────────────────────────────────────────────────────────────
type ShapePhase = 'visible' | 'dark';

interface GameState {
  running:          boolean;
  timeLeft:         number;
  sig:              Signals;
  // Shape state
  shapeType:        ShapeType;
  shapeX:           number;
  shapeY:           number;
  shapeSize:        number;      // radius (circle) or half-span (triangle/diamond)
  shapePhase:       ShapePhase;  // 'visible' | 'dark'
  shapeSpawnTime:   number;      // Date.now() when shape appeared
  shapeWindowMs:    number;      // how long it stays visible
  darkStartTime:    number;      // when darkness began
  darkDurationMs:   number;      // how long to stay dark
  // Hit flash effect
  hitFlashX:        number;
  hitFlashY:        number;
  hitFlashTime:     number;      // timestamp of last hit (0 = none)
  hitFlashSize:     number;
  // Reaction tier label (INSTANT / SHARP / GOOD)
  reactionTierLabel: string;
  reactionTierTime:  number;     // timestamp of last tier label (0 = none)
  // Miss flash effect (red burst on miss/wrong tap)
  missFlashX:       number;
  missFlashY:       number;
  missFlashTime:    number;      // 0 = inactive
  // Combo flash (visual + audio at streak milestones)
  comboFlashTime:   number;
  comboMultiplier:  number;
  accentColor:      string;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function randomShapeType(): ShapeType {
  return SHAPE_TYPES[Math.floor(Math.random() * SHAPE_TYPES.length)];
}

function randomDarkDuration(): number {
  return 400 + Math.random() * 400; // 400–800ms
}

function getShapeWindowMs(elapsedMs: number): number {
  // Linearly interpolate: 950ms at 0s → 550ms at 45s
  // Casual player floor: 550ms (achievable at 500ms reaction with 50ms buffer)
  // Ramp is gradual — 400ms reduction over full 45s duration, no sudden spikes
  return Math.max(550, 950 - (elapsedMs / 45000) * 400);
}

// Draw a shape on the canvas
function drawShape(
  ctx: CanvasRenderingContext2D,
  type: ShapeType,
  x: number,
  y: number,
  size: number,
  color: string,
  glowColor?: string,
  glowAlpha?: number,
): void {
  ctx.save();
  if (glowColor && glowAlpha && glowAlpha > 0) {
    ctx.shadowBlur = 32;
    ctx.shadowColor = glowColor;
    ctx.globalAlpha = glowAlpha;
  }
  ctx.fillStyle = color;
  ctx.beginPath();

  switch (type) {
    case 'circle':
      ctx.arc(x, y, size, 0, Math.PI * 2);
      break;
    case 'triangle': {
      const h = size * 1.5;
      ctx.moveTo(x, y - h);
      ctx.lineTo(x + size * 1.1, y + h * 0.6);
      ctx.lineTo(x - size * 1.1, y + h * 0.6);
      ctx.closePath();
      break;
    }
    case 'diamond': {
      const d = size * 1.3;
      ctx.moveTo(x, y - d);
      ctx.lineTo(x + d * 0.75, y);
      ctx.lineTo(x, y + d);
      ctx.lineTo(x - d * 0.75, y);
      ctx.closePath();
      break;
    }
  }

  ctx.fill();
  ctx.restore();
}

// Check if a point is inside a shape
function isInsideShape(
  px: number,
  py: number,
  type: ShapeType,
  sx: number,
  sy: number,
  size: number,
): boolean {
  switch (type) {
    case 'circle': {
      const dx = px - sx;
      const dy = py - sy;
      return dx * dx + dy * dy <= (size + 16) * (size + 16);
    }
    case 'triangle': {
      // Bounding-box approximation for hit detection
      const h = size * 1.5;
      const halfW = size * 1.1 + 16;
      return (
        py >= sy - h - 16 &&
        py <= sy + h * 0.6 + 16 &&
        px >= sx - halfW &&
        px <= sx + halfW
      );
    }
    case 'diamond': {
      // Diamond hit = Manhattan distance check
      const d = size * 1.3 + 16;
      return Math.abs(px - sx) / (d * 0.75) + Math.abs(py - sy) / d <= 1;
    }
  }
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function ShadowTapGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef<GameState>({
    running:         false,
    timeLeft:        DURATION,
    sig: {
      hitsOnFirst: 0, misses: 0, flashReactionTimes: [], wrongAreaTaps: 0,
      hits: 0, streak: 0, maxStreak: 0, score: 0,
    },
    shapeType:       'circle',
    shapeX:          0,
    shapeY:          0,
    shapeSize:       36,
    shapePhase:      'dark',
    shapeSpawnTime:  0,
    shapeWindowMs:   900,
    darkStartTime:   0,
    darkDurationMs:  600,
    hitFlashX:       0,
    hitFlashY:       0,
    hitFlashTime:    0,
    hitFlashSize:    0,
    reactionTierLabel: '',
    reactionTierTime:  0,
    missFlashX:      0,
    missFlashY:      0,
    missFlashTime:   0,
    comboFlashTime:  0,
    comboMultiplier: 0,
    accentColor:     ACCENT,
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [playerName, setPlayerName]     = useState('');
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
      // Note: hapticScore() is called directly in handleTap for precise sync — not duplicated here
      playScoreHit('cognitive', numScore - prevScoreRef.current);
      setStreak(stateRef.current.sig.streak);
    }
    prevScoreRef.current = numScore;
  }, [scoreDisplay]); // triggerPop is stable

  const playerSessionRef                = useRef<PlayerSession | null>(null);

  // Sync brand theme accent into mutable state ref
  useEffect(() => {
    stateRef.current.accentColor = theme.colors.accent ?? ACCENT;
  }, [theme]);

  // ─── SPAWN SHAPE ────────────────────────────────────────────────────────────
  const spawnShape = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const elapsed = (DURATION - s.timeLeft) * 1000;
    s.shapeType       = randomShapeType();
    s.shapeX          = SHAPE_MARGIN + Math.random() * (canvas.offsetWidth  - SHAPE_MARGIN * 2);
    s.shapeY          = SHAPE_MARGIN + Math.random() * (canvas.offsetHeight - SHAPE_MARGIN * 2);
    s.shapeSize       = 28 + Math.random() * 16; // 28–44px
    s.shapeWindowMs   = getShapeWindowMs(elapsed);
    s.shapeSpawnTime  = Date.now();
    s.shapePhase      = 'visible';
  }, []);

  // ─── END GAME ───────────────────────────────────────────────────────────────
  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    hapticVictory();
    playVictoryFanfare();
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
  }, []);

  // ─── GAME LOOP ──────────────────────────────────────────────────────────────
  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    // Reset state
    s.running = true;
    s.timeLeft = DURATION;
    s.sig = {
      hitsOnFirst: 0, misses: 0, flashReactionTimes: [], wrongAreaTaps: 0,
      hits: 0, streak: 0, maxStreak: 0, score: 0,
    };
    s.shapePhase     = 'dark';
    s.darkStartTime  = Date.now();
    s.darkDurationMs = randomDarkDuration();
    s.hitFlashTime      = 0;
    s.missFlashTime     = 0;
    s.comboFlashTime    = 0;
    s.comboMultiplier   = 0;
    s.reactionTierLabel = '';
    s.reactionTierTime  = 0;
    setScoreDisplay(0);
    setTimeLeft(DURATION);

    // 1-second countdown timer only
    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      // Timer warning: tick every second for last 10 seconds
      if (s.timeLeft <= 10 && s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) { endGame(); }
    }, 1000);

    // No background music — spec.audio.music = "none"

    const loop = () => {
      if (!s.running) return;
      const now  = Date.now();
      const W    = canvas.offsetWidth;
      const H    = canvas.offsetHeight;

      // ── Background ──────────────────────────────────────────────────────────
      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, 0, W, H);

      // ── Miss flash effect (red burst at miss/wrong-tap position) ────────────
      if (s.missFlashTime > 0) {
        const mAge = now - s.missFlashTime;
        const mDur = 320;
        if (mAge < mDur) {
          const alpha = (1 - mAge / mDur) * 0.6;
          const expand = mAge / mDur;
          const r = 36 * (1.0 + expand * 2.0);
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.shadowBlur  = 28;
          ctx.shadowColor = '#ef4444';
          ctx.fillStyle   = '#ef4444';
          ctx.beginPath();
          ctx.arc(s.missFlashX, s.missFlashY, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          s.missFlashTime = 0;
        }
      }

      // ── Shape state machine ─────────────────────────────────────────────────
      if (s.shapePhase === 'dark') {
        if (now - s.darkStartTime >= s.darkDurationMs) {
          spawnShape();
        }
      } else {
        // shapePhase === 'visible'
        const age = now - s.shapeSpawnTime;
        if (age >= s.shapeWindowMs) {
          // Shape timed out — it's a miss
          s.sig.misses++;
          s.sig.streak = 0;
          sfx.collision();
          haptic([40]);
          // Trigger red miss flash at shape position
          s.missFlashX    = s.shapeX;
          s.missFlashY    = s.shapeY;
          s.missFlashTime = now;
          s.shapePhase    = 'dark';
          s.darkStartTime  = now;
          s.darkDurationMs = randomDarkDuration();
        } else {
          // Draw silhouette with accent-colored glow for visibility (shadow aesthetic)
          drawShape(ctx, s.shapeType, s.shapeX, s.shapeY, s.shapeSize, SHAPE_COLOR, s.accentColor, 1.0);
        }
      }

      // ── Combo flash text overlay ────────────────────────────────────────────
      if (s.comboFlashTime > 0) {
        const cAge = now - s.comboFlashTime;
        const cDur = 700;
        if (cAge < cDur) {
          const alpha = cAge < 150 ? cAge / 150 : Math.max(0, 1 - (cAge - 150) / 550);
          const yOff  = -50 - (cAge / cDur) * 20; // floats upward
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle   = s.accentColor;
          ctx.shadowBlur  = 14;
          ctx.shadowColor = s.accentColor;
          ctx.font        = 'bold 26px "Space Grotesk", system-ui, sans-serif';
          ctx.textAlign   = 'center';
          ctx.fillText(`×${s.comboMultiplier} STREAK`, s.hitFlashX, s.hitFlashY + yOff);
          ctx.restore();
        } else {
          s.comboFlashTime = 0;
        }
      }

      // ── Hit flash effect ────────────────────────────────────────────────────
      if (s.hitFlashTime > 0) {
        const flashAge = now - s.hitFlashTime;
        const flashDuration = 220;
        if (flashAge < flashDuration) {
          const alpha = 1 - flashAge / flashDuration;
          const expand = flashAge / flashDuration;
          const r = s.hitFlashSize * (1.2 + expand * 1.5);
          ctx.save();
          ctx.globalAlpha = alpha * 0.7;
          ctx.shadowBlur  = 40;
          ctx.shadowColor = s.accentColor;
          ctx.fillStyle   = s.accentColor;
          ctx.beginPath();
          ctx.arc(s.hitFlashX, s.hitFlashY, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          s.hitFlashTime = 0;
        }
      }

      // ── Reaction tier label (INSTANT / SHARP / GOOD) ─────────────────────
      if (s.reactionTierTime > 0) {
        const rtAge = now - s.reactionTierTime;
        const rtDur = 600;
        if (rtAge < rtDur) {
          const alpha = rtAge < 100 ? rtAge / 100 : Math.max(0, 1 - (rtAge - 100) / 500);
          const yOff  = -30 - (rtAge / rtDur) * 40; // floats upward
          const color = s.reactionTierLabel === 'INSTANT' ? '#4ade80' :
                        s.reactionTierLabel === 'SHARP'   ? s.accentColor : '#facc15';
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle   = color;
          ctx.shadowBlur  = 12;
          ctx.shadowColor = color;
          ctx.font        = 'bold 18px "Space Grotesk", system-ui, sans-serif';
          ctx.textAlign   = 'center';
          ctx.letterSpacing = '2px';
          ctx.fillText(s.reactionTierLabel, s.hitFlashX, s.hitFlashY + yOff - s.hitFlashSize - 8);
          ctx.restore();
        } else {
          s.reactionTierTime = 0;
        }
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    setPhase('playing');
    // ⚠️ Spec: audio.music = "none" — silence between flashes IS the core mechanic.
    // Do NOT start any background music here; it destroys the tension of the dark intervals.
  }, [endGame, spawnShape]);

  // ─── TAP / POINTER INPUT ────────────────────────────────────────────────────
  const handleTap = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    if (!s.running) return;

    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.offsetWidth  / rect.width);
    const y = (clientY - rect.top)  * (canvas.offsetHeight / rect.height);

    if (s.shapePhase === 'visible') {
      const hit = isInsideShape(x, y, s.shapeType, s.shapeX, s.shapeY, s.shapeSize);
      if (hit) {
        const reactionMs = Date.now() - s.shapeSpawnTime;
        s.sig.hits++;
        s.sig.flashReactionTimes.push(reactionMs);
        if (reactionMs < 350) s.sig.hitsOnFirst++;
        s.sig.streak++;
        if (s.sig.streak > s.sig.maxStreak) s.sig.maxStreak = s.sig.streak;

        // Score by reaction speed
        let pts = 0;
        if (reactionMs < 200)       pts = 10;
        else if (reactionMs < 400)  pts = 5;
        else                         pts = 2;

        // Reaction tier label for display
        s.reactionTierLabel = reactionMs < 200 ? 'INSTANT' : reactionMs < 400 ? 'SHARP' : 'GOOD';
        s.reactionTierTime  = Date.now();

        // Streak bonus: +15 on every 5th consecutive hit
        if (s.sig.streak > 0 && s.sig.streak % 5 === 0) {
          pts += 15;
          // Combo visual + audio milestone
          sfx.shimmer();
          s.comboFlashTime  = Date.now();
          s.comboMultiplier = s.sig.streak / 5;
        }

        s.sig.score += pts;
        setScoreDisplay(s.sig.score);

        // Hit flash
        s.hitFlashX    = s.shapeX;
        s.hitFlashY    = s.shapeY;
        s.hitFlashSize = s.shapeSize;
        s.hitFlashTime = Date.now();

        sfx.collect();
        hapticScore();  // single satisfying haptic pattern (replaces haptic([30]) + useEffect hapticScore)

        // Start darkness phase immediately
        s.shapePhase    = 'dark';
        s.darkStartTime  = Date.now();
        s.darkDurationMs = randomDarkDuration();
      } else {
        // Tapped outside shape while visible = wrong-area tap (behavioral signal only, no score penalty)
        s.sig.wrongAreaTaps++;
        s.sig.streak = 0;
        // No score penalty — wrong taps are tracked as a behavioral signal, not punished
        // Red miss flash at tap position
        s.missFlashX    = x;
        s.missFlashY    = y;
        s.missFlashTime = Date.now();
        sfx.nearMiss();   // subtle negative cue for false positive
        haptic([40]);
      }
    } else {
      // Tapped during darkness = wrong-area tap (behavioral signal only, no score penalty)
      s.sig.wrongAreaTaps++;
      s.sig.streak = 0;
      // No score penalty — casual players shouldn't be punished for tapping in darkness
      // Red miss flash at tap position
      s.missFlashX    = x;
      s.missFlashY    = y;
      s.missFlashTime = Date.now();
      sfx.nearMiss();   // subtle negative cue for false positive
      haptic([40]);
    }
  }, []);

  // ─── CANVAS SETUP & RESIZE ──────────────────────────────────────────────────
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
      if (phase !== 'playing') return;
      handleTap(e.clientX, e.clientY);
    };
    canvas.addEventListener('pointerdown', onPointerDown);

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase, handleTap]);

  // ─── CLEANUP ON UNMOUNT ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []);

  // ─── PHASE TRANSITIONS ───────────────────────────────────────────────────────
  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio();
    sfx.click();
    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => {
    startLoop();
  }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    setPhase('start');
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setFinalSig(null);
  }, []);

  // ─── END SCREEN INSIGHTS ─────────────────────────────────────────────────────
  const buildInsights = (sig: Signals) => {
    const totalVisible = sig.hits + sig.misses;
    const accuracyPct  = totalVisible > 0 ? Math.round((sig.hits / totalVisible) * 100) : 0;
    const avgReaction  = sig.flashReactionTimes.length > 0
      ? Math.round(sig.flashReactionTimes.reduce((a, b) => a + b, 0) / sig.flashReactionTimes.length)
      : 0;

    const reactionColor =
      avgReaction < 350  ? '#4ade80' :
      avgReaction <= 600 ? '#facc15' :
                           '#ef4444';

    const accuracyColor =
      accuracyPct >= 75 ? '#4ade80' :
      accuracyPct >= 50 ? '#facc15' :
                          '#ef4444';

    const falseTapColor =
      sig.wrongAreaTaps <= 3 ? '#4ade80' :
      sig.wrongAreaTaps <= 7 ? '#facc15' :
                               '#ef4444';

    return [
      {
        label: 'Avg Reaction',
        value: avgReaction > 0 ? `${avgReaction}ms` : '—',
        color: reactionColor,
      },
      {
        label: 'Accuracy',
        value: `${accuracyPct}%`,
        color: accuracyColor,
      },
      {
        label: 'Gut Reads',
        value: `${sig.hitsOnFirst}`,
        color: theme.colors.accent ?? ACCENT,
      },
      {
        label: 'False Taps',
        value: `${sig.wrongAreaTaps}`,
        color: falseTapColor,
      },
    ];
  };

  // ─── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="shadow-tap"
          steps={[{ icon: "👁️", title: "Watch the shadow", body: "A shape will flash briefly, then vanish into the dark." }, { icon: "👆", title: "Tap it fast", body: "When the silhouette appears, tap it before it disappears." }, { icon: "⚡", title: "Build streaks", body: "Hit 5 in a row for a streak bonus. Speed earns more points." }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>

      {/* ── Start Screen ──────────────────────────────────────────────────── */}
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          iconNode={<Eye size={80} color={theme.colors.accent ?? ACCENT} strokeWidth={1.5} />}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Start"
          accentColor={theme.colors.accent ?? ACCENT}
          onStart={handleStart}
        />
      )}

      {/* ── Countdown ─────────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}

      {/* ── Playing (canvas + HUD) ────────────────────────────────────────── */}
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
                { label: 'TIME',  value: timeLeft,      danger: timeLeft <= 10 },
                { label: 'SCORE', value: scoreDisplay },
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
          didWin={finalSig.hits >= 8}
        />
      )}

      {/* ── Webhook (fires once on completion) ───────────────────────────── */}
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
function WebhookEmitter({
  theme,
  gameId,
  sig,
  personality,
  player,
}: {
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

    const totalVisible  = sig.hits + sig.misses;
    const accuracyBySpeed = totalVisible > 0 ? parseFloat((sig.hits / totalVisible).toFixed(3)) : 0;
    const avgReactionMs = sig.flashReactionTimes.length > 0
      ? Math.round(sig.flashReactionTimes.reduce((a, b) => a + b, 0) / sig.flashReactionTimes.length)
      : null;

    postWebhook(theme, gameId, {
      personality,
      score:            sig.score,
      hitsOnFirst:      sig.hitsOnFirst,
      misses:           sig.misses,
      flashReactionTimes: sig.flashReactionTimes,
      accuracyBySpeed,
      wrongAreaTaps:    sig.wrongAreaTaps,
      avgReactionMs,
      hits:             sig.hits,
      maxStreak:        sig.maxStreak,
    }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}


