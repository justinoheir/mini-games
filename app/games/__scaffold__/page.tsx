/**
 * ══════════════════════════════════════════════════════════════════
 *  ETHER MINI-GAMES — CANONICAL SCAFFOLD
 *  This file is the reference implementation every new game is built from.
 *  DO NOT add to the game list. DO NOT deploy. READ + CLONE only.
 *
 *  Builder Agent: copy this file to app/games/[your-game-id]/page.tsx
 *  Replace every <<PLACEHOLDER>> with spec values.
 *  Follow every comment marked ⚠️ — they are rules, not suggestions.
 * ══════════════════════════════════════════════════════════════════
 *
 *  SCAFFOLD GAME: "Tap Drift" — touch-only, no permissions needed.
 *  A drifting target appears on screen. Tap it before it fades.
 *  Demonstrates every required pattern in the cleanest possible form.
 */

'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import PlayerNameInput from '@/components/PlayerNameInput';

// ─── SPEC CONSTANTS ──────────────────────────────────────────────────────────
// Replace these with values from your game spec.

const GAME_ID      = '__scaffold__';              // <<REPLACE: spec.id>>
const ACCENT       = '#00e5ff';                   // <<REPLACE: spec.accentColor>>
const DURATION     = 60;                          // <<REPLACE: spec.duration>>
const GAME_EMOJI   = '💧';                        // <<REPLACE: spec.emoji>>
const GAME_TITLE   = 'Tap Drift';                 // <<REPLACE: spec.title>>
const GAME_TAGLINE = 'Tap the target before it vanishes.'; // <<REPLACE: spec.tagline>>

// ─── BEHAVIORAL SIGNALS ──────────────────────────────────────────────────────
// ⚠️ Must track at least 3 signals. Mirror your spec.signals array exactly.

interface Signals {
  totalAttempts: number;   // <<REPLACE: signal 1 — count of targets that appeared>>
  hits: number;            // <<REPLACE: signal 2 — count of successful taps>>
  reactionTimes: number[]; // <<REPLACE: signal 3 — ms between target show and tap>>
  maxStreak: number;       // <<REPLACE: signal 4 (optional bonus)>>
  streakCurrent: number;
  score: number;
}

// ─── PERSONALITY CLASSIFICATION ──────────────────────────────────────────────
// ⚠️ Must be deterministic (no randomness). Mirror your spec.personalities array.
// ⚠️ Must always return a value (exhaustive conditions + fallback).

function getPersonality(sig: Signals): string {
  const acc = sig.totalAttempts > 0 ? sig.hits / sig.totalAttempts : 0;
  const avgReaction = sig.reactionTimes.length > 0
    ? sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length
    : 9999;

  // <<REPLACE: map your spec.personalities[].condition to code here>>
  if (acc >= 0.70 && avgReaction < 400)  return 'Sharp 🔪';       // spec type_a
  if (sig.totalAttempts >= 40)           return 'Tenacious 💪';   // spec type_b
  if (acc >= 0.60 && avgReaction >= 400) return 'Calculated 🧮';  // spec type_c
  return 'Casual 🌊';                                              // spec type_default (always last)
}

// ─── GAME STATE ───────────────────────────────────────────────────────────────
// ⚠️ All mutable game state lives in stateRef. Never call setState inside rAF.
// ⚠️ Only set React state (setX) for HUD values that need re-render.

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  // <<REPLACE: add your game's physics/animation state here>>
  targetX: number;
  targetY: number;
  targetRadius: number;
  targetAlpha: number;       // 1.0 → 0.0 as it fades
  targetSpawnTime: number;   // Date.now() when target appeared
  targetActive: boolean;
  speedMultiplier: number;
  driftVX: number;
  driftVY: number;
  accentColor: string;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function ScaffoldGame() {   // <<REPLACE: function name matches title>>
  const theme       = useBrandTheme();
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const animRef     = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  // ⚠️ All game state in one ref — never in useState (causes stale closures in rAF)
  const stateRef = useRef<GameState>({
    running:        false,
    timeLeft:       DURATION,
    sig: { totalAttempts: 0, hits: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0, score: 0 },
    targetX:        0,
    targetY:        0,
    targetRadius:   40,
    targetAlpha:    1,
    targetSpawnTime: 0,
    targetActive:   false,
    speedMultiplier: 1,
    driftVX:        0,
    driftVY:        0,
    accentColor:    ACCENT,
  });

  // Only these values drive re-renders — keep minimal
  const [phase, setPhase]             = useState<Phase>('start');
  const [timeLeft, setTimeLeft]       = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]       = useState<Signals | null>(null);

  // ⚠️ Per-game player session — captured on the start screen
  const [playerName, setPlayerName]   = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const playerSessionRef              = useRef<PlayerSession | null>(null);

  // Sync brand theme accent into state (so rAF loop picks it up without stale closure)
  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  // ─── SPAWN TARGET ──────────────────────────────────────────────────────────
  // <<REPLACE: your game's equivalent of "spawn new game object">>

  const spawnTarget = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const margin = 60;
    s.targetX = margin + Math.random() * (canvas.width  - margin * 2);
    s.targetY = margin + Math.random() * (canvas.height - margin * 2);
    s.targetRadius  = 36 + Math.random() * 20;
    s.targetAlpha   = 1;
    s.targetActive  = true;
    s.targetSpawnTime = Date.now();
    s.driftVX = (Math.random() - 0.5) * 1.5 * s.speedMultiplier;
    s.driftVY = (Math.random() - 0.5) * 1.5 * s.speedMultiplier;
    s.sig.totalAttempts++;
  }, []);

  // ─── END GAME ──────────────────────────────────────────────────────────────
  // ⚠️ Always cancel rAF and clear interval before setting phase='done'.

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  // ─── GAME LOOP ─────────────────────────────────────────────────────────────
  // ⚠️ Use requestAnimationFrame only — never setInterval for animation.
  // ⚠️ Always check s.running at top of loop.

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    // Reset state
    s.running = true;
    s.timeLeft = DURATION;
    s.sig = { totalAttempts: 0, hits: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0, score: 0 };
    s.speedMultiplier = 1;
    s.targetActive = false;
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('drive'); // <<REPLACE: spec.audio.music>>

    // ⚠️ Use setInterval for the 1-second countdown only — never for animation
    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    spawnTarget();

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width;
      const H = canvas.height;

      // ── Background ─────────────────────────────────────────────────────────
      // <<REPLACE: your game's background. Keep it atmospheric.>>
      ctx.fillStyle = '#060610';
      ctx.fillRect(0, 0, W, H);

      // Optional: subtle grid
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
      for (let gy = 0; gy < H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

      // ── Game Objects ───────────────────────────────────────────────────────
      // <<REPLACE: your game's rendering logic>>

      if (s.targetActive) {
        // Drift
        s.targetX += s.driftVX;
        s.targetY += s.driftVY;

        // Bounce off walls
        if (s.targetX - s.targetRadius < 0 || s.targetX + s.targetRadius > W) s.driftVX *= -1;
        if (s.targetY - s.targetRadius < 0 || s.targetY + s.targetRadius > H) s.driftVY *= -1;

        // Fade out over 2.5 seconds
        const age = (Date.now() - s.targetSpawnTime) / 2500;
        s.targetAlpha = Math.max(0, 1 - age);

        if (s.targetAlpha <= 0) {
          // Missed
          s.targetActive = false;
          s.sig.streakCurrent = 0;
          sfx.collision(); // <<REPLACE: spec.audio.missSound>>
          haptic([40]);
          setTimeout(() => { if (s.running) spawnTarget(); }, 300);
        }

        // Draw target
        ctx.save();
        ctx.globalAlpha = s.targetAlpha;
        // Outer glow
        ctx.shadowBlur  = 24;
        ctx.shadowColor = s.accentColor;
        // Ring
        ctx.strokeStyle = s.accentColor;
        ctx.lineWidth   = 3;
        ctx.beginPath();
        ctx.arc(s.targetX, s.targetY, s.targetRadius, 0, Math.PI * 2);
        ctx.stroke();
        // Fill
        ctx.fillStyle = `${s.accentColor}22`;
        ctx.fill();
        // Inner dot
        ctx.shadowBlur = 0;
        ctx.fillStyle  = s.accentColor;
        ctx.beginPath();
        ctx.arc(s.targetX, s.targetY, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnTarget]);

  // ─── TOUCH / POINTER INPUT ─────────────────────────────────────────────────
  // ⚠️ Register on canvas, not window. Remove on cleanup.
  // <<REPLACE: adapt to your game's input mechanics>>

  const handleTap = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    if (!s.running || !s.targetActive) return;

    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.width  / rect.width);
    const y = (clientY - rect.top)  * (canvas.height / rect.height);
    const dx = x - s.targetX;
    const dy = y - s.targetY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= s.targetRadius + 12) {
      // HIT
      const reactionMs = Date.now() - s.targetSpawnTime;
      s.sig.hits++;
      s.sig.reactionTimes.push(reactionMs);
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;

      const pts = s.sig.streakCurrent >= 3 ? 2 : 1; // combo bonus
      s.sig.score += pts;
      s.speedMultiplier = Math.min(2.5, 1 + s.sig.hits * 0.04);
      setScoreDisplay(s.sig.score);

      sfx.collect(); // <<REPLACE: spec.audio.hitSound>>
      haptic([30]);

      s.targetActive = false;
      setTimeout(() => { if (s.running) spawnTarget(); }, 200);
    } else {
      // MISS TAP
      s.sig.streakCurrent = 0;
    }
  }, [spawnTarget]);

  // ─── CANVAS SETUP & RESIZE ────────────────────────────────────────────────
  // ⚠️ Canvas must fill the GameShell area. Must handle resize.

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
      if (phase !== 'playing') return; // only process during play
      handleTap(e.clientX, e.clientY);
    };
    canvas.addEventListener('pointerdown', onPointerDown);

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase, handleTap]);

  // ─── CLEANUP ON UNMOUNT ───────────────────────────────────────────────────
  // ⚠️ Must cancel ALL async work to prevent memory leaks.

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []);

  // ─── PHASE TRANSITIONS ────────────────────────────────────────────────────

  const handleStart = useCallback(() => {
    initAudio();
    // Save player session for this game — persists name for pre-fill next time
    playerSessionRef.current = savePlayerSession(GAME_ID, playerName, playerAvatar);
    setPhase('countdown');
  }, [playerName, playerAvatar]);

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
  // <<REPLACE: match spec.endScreenInsights. Always use finalSig, never stateRef.>>

  const buildInsights = (sig: Signals) => {
    const acc = sig.totalAttempts > 0 ? Math.round((sig.hits / sig.totalAttempts) * 100) : 0;
    const avgRx = sig.reactionTimes.length > 0
      ? Math.round(sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length)
      : 0;

    return [
      { label: 'Accuracy',     value: `${acc}%`,      color: acc >= 70 ? '#4ade80' : acc >= 40 ? '#facc15' : '#ef4444' },
      { label: 'Avg Reaction', value: `${avgRx}ms`,   color: ACCENT },
      { label: 'Best Streak',  value: `×${sig.maxStreak}`, color: ACCENT },
      { label: 'Targets Hit',  value: `${sig.hits}`,  color: 'var(--color-text)' },
    ];
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────
  // ⚠️ Always render inside GameShell.
  // ⚠️ data-testid attributes on back button and end screen — required for QA.

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {/* ── Start Screen ──────────────────────────────────────────────────── */}
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Start"  // <<REPLACE: if sensor needs permission, use "Allow Motion" etc.>>
          accentColor={theme.colors.accent ?? ACCENT}
          onStart={handleStart}
        >
          {/* ⚠️ Per-game name capture — required in every game */}
          <PlayerNameInput
            accentColor={theme.colors.accent ?? ACCENT}
            onReady={(name, avatar) => { setPlayerName(name); setPlayerAvatar(avatar); }}
          />
        </GameStartScreen>
      )}

      {/* ── Countdown ─────────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}

      {/* ── Playing ───────────────────────────────────────────────────────── */}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          {/* ⚠️ Canvas must have full-bleed absolute positioning */}
          <canvas
            ref={canvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
          />
          {/* ⚠️ HUD sits above canvas — timer + score always visible */}
          {phase === 'playing' && (
            <GameHUD
              accentColor={theme.colors.accent ?? ACCENT}
              items={[
                { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
                { label: 'SCORE', value: scoreDisplay },
              ]}
            />
          )}
        </>
      )}

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
          didWin={finalSig.hits >= 10}
          // ⚠️ After rendering, fire webhook (best-effort, never blocks)
        />
      )}

      {/* ⚠️ Webhook — fire after done phase renders */}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}

// ─── WEBHOOK EMITTER ─────────────────────────────────────────────────────────
// Isolated component so postWebhook fires exactly once on mount.
// <<REPLACE: add any additional spec-specific fields to the payload>>

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
    const acc = sig.totalAttempts > 0 ? sig.hits / sig.totalAttempts : 0;
    const avgReaction = sig.reactionTimes.length > 0
      ? Math.round(sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length)
      : null;
    postWebhook(theme, gameId, {
      personality,
      score:          sig.score,
      accuracy:       parseFloat(acc.toFixed(3)),
      totalAttempts:  sig.totalAttempts,
      hits:           sig.hits,
      avgReactionMs:  avgReaction,
      maxStreak:      sig.maxStreak,
      // <<REPLACE: add your spec.signals here as flat key-value pairs>>
    }, player);
  }, [theme, gameId, sig, personality]);
  return null;
}
