/**
 * ══════════════════════════════════════════════════════════════════
 *  COLOR CASCADE — Ether Mini-Game
 *  Match the falling color drops to the target color.
 *  Speed increases over time. Every 10s the target color changes.
 *
 *  Signals tracked: correctTaps, wrongTaps, reactionTimes, accuracy, maxStreak
 *  Archetypes: Chromatic Hawk 🦅 | Speed Demon 🔥 | Deliberate Eye 🔭 | Casual Tapper 🌊
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
import { type Particle, spawnBurst, updateAndDrawParticles } from '@/lib/particles';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';

const CATEGORY_ACCENT = CATEGORY_THEMES.cognitive.primaryAccent;

// ─── SPEC CONSTANTS ──────────────────────────────────────────────────────────

const GAME_ID      = 'color-cascade';
const PB_KEY       = 'pb_color-cascade';
const ACCENT       = '#f43f5e';
const DURATION     = 45;
const GAME_EMOJI   = '🌈';
const GAME_TITLE   = 'Color Cascade';
const GAME_TAGLINE = 'Match the color. Match the speed.';

// ─── COLOR PALETTE ────────────────────────────────────────────────────────────

const COLORS = [
  { name: 'red',    hex: '#ef4444', label: 'RED'    },
  { name: 'blue',   hex: '#3b82f6', label: 'BLUE'   },
  { name: 'green',  hex: '#22c55e', label: 'GREEN'  },
  { name: 'yellow', hex: '#eab308', label: 'YELLOW' },
  { name: 'purple', hex: '#a855f7', label: 'PURPLE' },
];

const DROP_RADIUS = 28;
// TOP_AREA accounts for 56px GameShell top bar + ~65px GameHUD pill + 14px breathing room
// Canvas target display is drawn from ~145-218px so it's fully visible below the HUD
const TOP_AREA    = 235; // px reserved for target color display (shifted below top bar + HUD)

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface Drop {
  id: number;
  x: number;
  colorIndex: number;
  startTime: number;    // Date.now() when spawned
  fallDuration: number; // ms to traverse the play area
  radius: number;
  tapped: boolean;
  missed: boolean;      // has already been counted as a miss
  hitAlpha: number;     // 1 → 0 for hit-ring animation
  hitY: number;         // y-position captured at moment of tap
}

interface Signals {
  correctTaps: number;
  wrongTaps: number;
  reactionTimes: number[]; // ms from drop spawn to tap
  accuracy: number;        // computed on end
  maxStreak: number;
  score: number;
  streakCurrent: number;
}

// ─── PERSONALITY CLASSIFICATION ──────────────────────────────────────────────

function getPersonality(sig: Signals): string {
  const total  = sig.correctTaps + sig.wrongTaps;
  const acc    = total > 0 ? sig.correctTaps / total : 0;
  const avgRx  = sig.reactionTimes.length > 0
    ? sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length
    : 9999;

  if (acc > 0.80 && avgRx < 600)               return 'Chromatic Hawk 🦅';
  if (sig.correctTaps > 25 && acc < 0.70)      return 'Speed Demon 🔥';
  if (acc > 0.75 && avgRx >= 600)              return 'Deliberate Eye 🔭';
  return 'Casual Tapper 🌊'; // fallback — always last
}

// ─── GAME STATE ───────────────────────────────────────────────────────────────

interface GameState {
  running: boolean;
  timeLeft: number;
  elapsedSeconds: number;
  drops: Drop[];
  nextDropId: number;
  targetColorIndex: number;
  lastColorSection: number; // tracks which 10-second block we're in
  flashAlpha: number;       // 0–1 for color-change flash overlay
  missFlashAlpha: number;   // 0–1 for red flash on wrong tap
  comboFlashAlpha: number;  // 0–1 for accent flash on combo milestone
  lastSpawnTime: number;    // timestamp of last drop spawn
  particles: Particle[];    // tap burst particles (correct hits)
  sig: Signals;
  accentColor: string;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function ColorCascadeGame() {
  const theme         = useBrandTheme();
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const animRef       = useRef(0);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef  = useRef<(() => void) | null>(null);

  const stateRef = useRef<GameState>({
    running:          false,
    timeLeft:         DURATION,
    elapsedSeconds:   0,
    drops:            [],
    nextDropId:       0,
    targetColorIndex: 0,
    lastColorSection: 0,
    flashAlpha:       0,
    missFlashAlpha:   0,
    comboFlashAlpha:  0,
    lastSpawnTime:    0,
    sig: {
      correctTaps: 0, wrongTaps: 0, reactionTimes: [],
      accuracy: 0, maxStreak: 0, score: 0, streakCurrent: 0,
    },
    accentColor: ACCENT,
    particles: [],
  });

  const [phase, setPhase]               = useState<Phase>('start');
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
      hapticScore();
      playScoreHit('default', numScore - prevScoreRef.current);
      setStreak(Math.floor(numScore / 5));
    }
    prevScoreRef.current = numScore;
  }, [scoreDisplay]); // triggerPop is stable
  const playerSessionRef                = useRef<PlayerSession | null>(null);


  // Sync brand theme accent into mutable state so rAF loop sees it
  useEffect(() => {
    stateRef.current.accentColor = theme.colors.accent ?? ACCENT;
  }, [theme]);

  // ─── END GAME ──────────────────────────────────────────────────────────────

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const total = s.sig.correctTaps + s.sig.wrongTaps;
    s.sig.accuracy = total > 0 ? parseFloat((s.sig.correctTaps / total).toFixed(3)) : 0;
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

  // ─── SPAWN DROP ────────────────────────────────────────────────────────────

  const spawnDrop = useCallback((canvas: HTMLCanvasElement, s: GameState) => {
    // Fall duration decreases across 3 speed stages
    const fallDuration = s.elapsedSeconds < 15 ? 2500
                       : s.elapsedSeconds < 30 ? 1800
                       : 1200;
    const margin     = DROP_RADIUS + 10;
    const x          = margin + Math.random() * (canvas.width - margin * 2);
    const colorIndex = Math.floor(Math.random() * COLORS.length);

    s.drops.push({
      id:           s.nextDropId++,
      x,
      colorIndex,
      startTime:    Date.now(),
      fallDuration,
      radius:       DROP_RADIUS,
      tapped:       false,
      missed:       false,
      hitAlpha:     0,
      hitY:         0,
    });
    s.lastSpawnTime = Date.now();
  }, []);

  // ─── GAME LOOP ─────────────────────────────────────────────────────────────

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    // ── Reset state ──
    s.running          = true;
    s.timeLeft         = DURATION;
    s.elapsedSeconds   = 0;
    s.drops            = [];
    s.nextDropId       = 0;
    s.targetColorIndex = Math.floor(Math.random() * COLORS.length);
    s.lastColorSection = 0;
    s.flashAlpha       = 0;
    s.missFlashAlpha   = 0;
    s.comboFlashAlpha  = 0;
    s.lastSpawnTime    = 0;
    s.particles        = [];
    s.sig = {
      correctTaps: 0, wrongTaps: 0, reactionTimes: [],
      accuracy: 0, maxStreak: 0, score: 0, streakCurrent: 0,
    };
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    // ⚠️ setInterval ONLY for 1-second timer countdown
    timerRef.current = setInterval(() => {
      s.timeLeft--;
      s.elapsedSeconds++;
      setTimeLeft(s.timeLeft);

      // Tick urgency cue — final 5 seconds only (not every second, to avoid metronome distraction)
      if (s.timeLeft <= 5 && s.timeLeft > 0) sfx.tick();

      // Timer warning at 10s remaining — fires once, distinct urgent sound
      if (s.timeLeft === 10) sfx.warning();

      // Change target color every 10 seconds
      const colorSection = Math.floor(s.elapsedSeconds / 10);
      if (colorSection !== s.lastColorSection) {
        s.lastColorSection = colorSection;
        // Pick a different color from current
        let newIndex: number;
        do { newIndex = Math.floor(Math.random() * COLORS.length); }
        while (newIndex === s.targetColorIndex);
        s.targetColorIndex = newIndex;
        s.flashAlpha = 1.0;
        sfx.shimmer(); // audio cue for target color change
      }

      if (s.timeLeft <= 0) {
        sfx.success(); // game completion — not a failure, use success sound (spec: endSound: "success")
        haptic([300]);
        endGame();
      }
    }, 1000);

    // Spawn first drop
    spawnDrop(canvas, s);

    // FPS tracking for test instrumentation
    let fpsFrameCount = 0;
    let fpsWindowStart = performance.now();
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__raf_fps = 0;
    }

    // ── rAF loop ──────────────────────────────────────────────────────────────
    const loop = (rafTs: number) => {
      if (!s.running) return;

      // Track FPS in a 1-second rolling window (exposed for test 7.2)
      fpsFrameCount++;
      const fpsElapsed = rafTs - fpsWindowStart;
      if (fpsElapsed >= 1000) {
        if (typeof window !== 'undefined') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__raf_fps = Math.round(fpsFrameCount * 1000 / fpsElapsed);
        }
        fpsFrameCount = 0;
        fpsWindowStart = rafTs;
      }

      const W   = canvas.width;
      const H   = canvas.height;
      const now = Date.now();

      // ── Background ──────────────────────────────────────────────────────────
      ctx.fillStyle = '#08090f';
      ctx.fillRect(0, 0, W, H);

      // Ambient glow tinted toward target color
      const targetHex = COLORS[s.targetColorIndex].hex;
      const ambGrad   = ctx.createRadialGradient(W / 2, H, 0, W / 2, H, H * 0.55);
      ambGrad.addColorStop(0, targetHex + '18');
      ambGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = ambGrad;
      ctx.fillRect(0, 0, W, H);

      // ── Target color display (drawn BELOW GameShell top bar 0-56px and HUD 64-125px) ─────
      // Positions: label y=150, swatch y=188, name y=222 — all below HUD bottom (~130px)
      ctx.fillStyle    = 'rgba(255,255,255,0.45)';
      ctx.font         = '600 18px monospace';
      ctx.textAlign    = 'center';
      ctx.letterSpacing = '0.06em';
      ctx.fillText('MATCH', W / 2, 156);
      ctx.letterSpacing = '0px';

      // Pulsing color swatch
      const pulse   = 1 + 0.08 * Math.sin(now / 280);
      const swatchR = 22 * pulse;
      ctx.save();
      ctx.shadowBlur  = 22;
      ctx.shadowColor = targetHex;
      ctx.fillStyle   = targetHex;
      ctx.beginPath();
      ctx.arc(W / 2, 188, swatchR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = targetHex;
      ctx.font      = 'bold 22px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(COLORS[s.targetColorIndex].label, W / 2, 228);

      // Separator line
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(0, TOP_AREA);
      ctx.lineTo(W, TOP_AREA);
      ctx.stroke();

      // ── Color-change flash overlay ──────────────────────────────────────────
      if (s.flashAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = s.flashAlpha * 0.30;
        ctx.fillStyle   = targetHex;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        s.flashAlpha = Math.max(0, s.flashAlpha - 0.04);
      }

      // ── Tap burst particles (correct hit — from lib/particles.ts) ───────────
      updateAndDrawParticles(ctx, s.particles);

      // ── Miss flash overlay (red — wrong tap) ────────────────────────────────
      if (s.missFlashAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = s.missFlashAlpha * 0.35;
        ctx.fillStyle   = '#ef4444';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        s.missFlashAlpha = Math.max(0, s.missFlashAlpha - 0.14);
      }

      // ── Combo flash overlay (accent — streak milestone) ─────────────────────
      if (s.comboFlashAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = s.comboFlashAlpha * 0.25;
        ctx.fillStyle   = s.accentColor;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        s.comboFlashAlpha = Math.max(0, s.comboFlashAlpha - 0.10);
      }

      // ── Spawn logic ─────────────────────────────────────────────────────────
      // Stage 1: 1 drop, Stage 2: 2 drops, Stage 3: 3 drops (frantic)
      const maxDrops   = s.elapsedSeconds < 15 ? 1 : s.elapsedSeconds < 30 ? 2 : 3;
      const spawnDelay = s.elapsedSeconds < 15 ? 600 : s.elapsedSeconds < 30 ? 450 : 300;
      const activeCount = s.drops.filter(d => !d.tapped && !d.missed).length;
      if (activeCount < maxDrops && now - s.lastSpawnTime > spawnDelay) {
        spawnDrop(canvas, s);
      }

      // ── Update & draw drops ──────────────────────────────────────────────────
      const toRemove: number[] = [];

      for (const drop of s.drops) {
        const elapsed_ms = now - drop.startTime;
        const progress   = elapsed_ms / drop.fallDuration;

        if (drop.tapped) {
          // Expanding ring hit animation
          drop.hitAlpha = Math.max(0, drop.hitAlpha - 0.055);
          if (drop.hitAlpha <= 0) { toRemove.push(drop.id); continue; }

          const expandR = drop.radius * (1 + (1 - drop.hitAlpha) * 1.2);
          ctx.save();
          ctx.globalAlpha = drop.hitAlpha;
          ctx.shadowBlur  = 12;
          ctx.shadowColor = COLORS[drop.colorIndex].hex;
          ctx.strokeStyle = COLORS[drop.colorIndex].hex;
          ctx.lineWidth   = 2.5;
          ctx.beginPath();
          ctx.arc(drop.x, drop.hitY, expandR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
          continue;
        }

        if (progress >= 1) {
          // Drop reached bottom — count as miss only once
          if (!drop.missed) {
            drop.missed = true;
            if (drop.colorIndex === s.targetColorIndex) {
              // Missed a correct drop: reset streak (no point deduction per spec)
              s.sig.streakCurrent = 0;
              sfx.collision();
            }
          }
          toRemove.push(drop.id);
          continue;
        }

        // ── Falling drop ──────────────────────────────────────────────────────
        const y       = TOP_AREA + drop.radius + (H - TOP_AREA - drop.radius * 2) * progress;
        const wobble  = Math.sin(now / 200 + drop.id) * 2; // slight side wobble
        const dropHex = COLORS[drop.colorIndex].hex;

        ctx.save();
        ctx.shadowBlur  = 16;
        ctx.shadowColor = dropHex;

        // Outer soft halo
        ctx.globalAlpha = 0.25;
        ctx.fillStyle   = dropHex;
        ctx.beginPath();
        ctx.arc(drop.x + wobble, y, drop.radius, 0, Math.PI * 2);
        ctx.fill();

        // Inner solid core
        ctx.globalAlpha = 1;
        ctx.fillStyle   = dropHex;
        ctx.beginPath();
        ctx.arc(drop.x + wobble, y, drop.radius * 0.6, 0, Math.PI * 2);
        ctx.fill();

        // Specular highlight
        ctx.shadowBlur  = 0;
        ctx.globalAlpha = 0.30;
        ctx.fillStyle   = '#ffffff';
        ctx.beginPath();
        ctx.arc(
          drop.x + wobble - drop.radius * 0.2,
          y - drop.radius * 0.22,
          drop.radius * 0.18,
          0, Math.PI * 2
        );
        ctx.fill();
        ctx.restore();
      }

      // Prune finished drops
      if (toRemove.length > 0) {
        s.drops = s.drops.filter(d => !toRemove.includes(d.id));
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnDrop]);

  // ─── TAP INPUT ─────────────────────────────────────────────────────────────

  const handleTap = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    if (!s.running) return;

    const rect = canvas.getBoundingClientRect();
    const x    = (clientX - rect.left) * (canvas.width  / rect.width);
    const y    = (clientY - rect.top)  * (canvas.height / rect.height);
    const H    = canvas.height;
    const now  = Date.now();

    // Find closest untapped drop within tap radius
    let bestDrop: Drop | null = null;
    let bestDropY             = 0;
    let bestDist              = Infinity;

    for (const drop of s.drops) {
      if (drop.tapped || drop.missed) continue;
      const progress = Math.min(1, (now - drop.startTime) / drop.fallDuration);
      const dropY    = TOP_AREA + drop.radius + (H - TOP_AREA - drop.radius * 2) * progress;
      const wobble   = Math.sin(now / 200 + drop.id) * 2;
      const dx       = x - (drop.x + wobble);
      const dy       = y - dropY;
      const dist     = Math.sqrt(dx * dx + dy * dy);
      if (dist <= drop.radius + 12 && dist < bestDist) {
        bestDist  = dist;
        bestDrop  = drop;
        bestDropY = dropY;
      }
    }

    if (bestDrop !== null) {
      bestDrop.tapped  = true;
      bestDrop.hitAlpha = 1;
      bestDrop.hitY    = bestDropY;

      if (bestDrop.colorIndex === s.targetColorIndex) {
        // ✅ CORRECT TAP
        const reactionMs = now - bestDrop.startTime;
        s.sig.correctTaps++;
        s.sig.reactionTimes.push(reactionMs);
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;

        // Combo multiplier: ×1.5 at streak 5, ×2 at streak 10
        const multiplier = s.sig.streakCurrent >= 10 ? 2 : s.sig.streakCurrent >= 5 ? 1.5 : 1;
        const pts        = Math.round(3 * multiplier);
        s.sig.score     += pts;
        setScoreDisplay(s.sig.score);
        sfx.collect();
        haptic([20]);
        // Particle burst at tap point (correct hit) — spec requires lib/particles.ts
        const tapHex = COLORS[bestDrop.colorIndex].hex;
        spawnBurst(s.particles, x, bestDropY, tapHex, 12, 5);
        // Escalating audio + visual on combo milestones
        if (s.sig.streakCurrent === 5)  { setTimeout(() => sfx.success(), 100); s.comboFlashAlpha = 1.0; }  // ×1.5 milestone
        if (s.sig.streakCurrent === 10) { setTimeout(() => sfx.powerOn(), 100); s.comboFlashAlpha = 1.0; }  // ×2.0 milestone
      } else {
        // ❌ WRONG COLOR
        s.sig.wrongTaps++;
        s.sig.streakCurrent = 0;
        s.sig.score         = Math.max(0, s.sig.score - 1);
        setScoreDisplay(s.sig.score);
        sfx.collision();
        haptic([80]);
        s.missFlashAlpha = 1.0; // Red flash feedback
      }
    }
    // Tapping empty space: no penalty
  }, []);

  // ─── CANVAS SETUP & RESIZE ────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
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

  // ─── CLEANUP ON UNMOUNT ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []);

  // ─── PHASE TRANSITIONS ────────────────────────────────────────────────────

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio();
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

  // ─── END SCREEN INSIGHTS ─────────────────────────────────────────────────

  const buildInsights = (sig: Signals) => {
    const total  = sig.correctTaps + sig.wrongTaps;
    const acc    = total > 0 ? Math.round((sig.correctTaps / total) * 100) : 0;
    const avgRx  = sig.reactionTimes.length > 0
      ? Math.round(sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length)
      : 0;
    const accent = theme.colors.accent ?? ACCENT;

    return [
      {
        label: 'Accuracy',
        value: `${acc}%`,
        color: acc >= 80 ? '#4ade80' : acc >= 50 ? '#facc15' : '#ef4444',
      },
      {
        label: 'Avg Reaction',
        value: avgRx > 0 ? `${avgRx}ms` : '—',
        color: accent,
      },
      {
        label: 'Best Streak',
        value: `×${sig.maxStreak}`,
        color: accent,
      },
      {
        label: 'Correct Hits',
        value: `${sig.correctTaps}`,
        color: sig.correctTaps > 20 ? '#4ade80' : sig.correctTaps >= 10 ? '#facc15' : '#ef4444',
      },
    ];
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>

      {/* ── Start Screen ────────────────────────────────────────────────────── */}
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Start"
          accentColor={theme.colors.accent ?? ACCENT}
          onStart={handleStart}
        />
      )}

      {/* ── Countdown ───────────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}

      {/* ── Playing (canvas always mounted during countdown + playing) ─────── */}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          {/* ⚠️ Full-bleed canvas, touchAction none for pointer events */}
          <canvas
            ref={canvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
          />
          {/* HUD sits above canvas */}
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



      {/* ── End Screen ──────────────────────────────────────────────────────── */}
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
          didWin={finalSig.correctTaps >= 10}
        />
      )}

      {/* ⚠️ Webhook — fire exactly once on done mount */}
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
    const avgReaction = sig.reactionTimes.length > 0
      ? Math.round(sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length)
      : null;
    postWebhook(theme, gameId, {
      personality,
      score:         sig.score,
      correctTaps:   sig.correctTaps,
      wrongTaps:     sig.wrongTaps,
      accuracy:      sig.accuracy,
      avgReactionMs: avgReaction,
      maxStreak:     sig.maxStreak,
      reactionTimes: sig.reactionTimes,
    }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
