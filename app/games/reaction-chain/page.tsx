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
import { Particle, spawnBurst, updateAndDrawParticles } from '@/lib/particles';
import { ShakeState, triggerShake, applyShake } from '@/lib/screenShake';

// ─── SPEC CONSTANTS ───────────────────────────────────────────────────────────

const GAME_ID      = 'reaction-chain';
const ACCENT       = '#facc15';
const DURATION     = 45;
const GAME_EMOJI   = '⚡';
const GAME_TITLE   = 'Reaction Chain';
const GAME_TAGLINE = 'Tap fast. Keep the chain alive.';
const NODE_RADIUS  = 44;
const EDGE_MARGIN  = 70;

// ─── HELPERS (outside component — pure, no stale closures) ────────────────────

/** Returns the node expiry window in ms based on elapsed game seconds. */
function getWindowMs(elapsed: number): number {
  if (elapsed < 15) return 800;
  if (elapsed < 30) return 600;
  return 400;
}

// ─── BEHAVIORAL SIGNALS ───────────────────────────────────────────────────────

interface Signals {
  reactionTimes: number[]; // ms between node appearing and player tapping it
  longestChain:  number;   // longest unbroken tap chain
  chainBreaks:   number;   // number of times the chain was broken
  totalNodes:    number;   // total nodes that appeared
  tappedNodes:   number;   // nodes successfully tapped
  currentChain:  number;   // running chain counter (resets on miss)
  score:         number;   // cumulative score (chain pts + reaction bonuses)
}

// ─── PERSONALITY CLASSIFICATION ───────────────────────────────────────────────

function getPersonality(sig: Signals): string {
  const avgRT =
    sig.reactionTimes.length > 0
      ? sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length
      : 9999;

  if (avgRT < 350 && sig.longestChain >= 15) return 'Lightning Reflex ⚡';
  if (sig.longestChain >= 20 && sig.chainBreaks <= 2) return 'Chain Keeper 🔗';
  if (sig.tappedNodes > 30 && sig.chainBreaks > 5) return 'Sprinter 🏃';
  return 'Steady Reactor 🌊';
}

// ─── GAME STATE ───────────────────────────────────────────────────────────────

interface GameState {
  running:              boolean;
  timeLeft:             number;
  sig:                  Signals;
  nodeX:                number;
  nodeY:                number;
  nodeSpawnTime:        number;
  nodeAlive:            boolean;
  nodeWindowMs:         number;
  chainBreakFlash:      number;   // 0..1 — fades out red overlay after a miss
  accentColor:          string;
  lastChainDisplayed:   number;   // change guard — avoids redundant setScoreDisplay calls
  particles:            Particle[];
  shake:                ShakeState;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function ReactionChain() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const respawnRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stateRef = useRef<GameState>({
    running:              false,
    timeLeft:             DURATION,
    sig: {
      reactionTimes:  [],
      longestChain:   0,
      chainBreaks:    0,
      totalNodes:     0,
      tappedNodes:    0,
      currentChain:   0,
      score:          0,
    },
    nodeX:                0,
    nodeY:                0,
    nodeSpawnTime:        0,
    nodeAlive:            false,
    nodeWindowMs:         800,
    chainBreakFlash:      0,
    accentColor:          ACCENT,
    lastChainDisplayed:   0,
    particles:            [],
    shake:                { intensity: 0, duration: 0 },
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const playerSessionRef                = useRef<PlayerSession | null>(null);



  // Sync brand accent into game state so rAF loop gets fresh value without stale closure
  useEffect(() => {
    stateRef.current.accentColor = theme.colors.accent ?? ACCENT;
  }, [theme]);

  // ─── SPAWN NODE ─────────────────────────────────────────────────────────────

  const spawnNode = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s       = stateRef.current;
    const elapsed = DURATION - s.timeLeft;
    s.nodeWindowMs  = getWindowMs(elapsed);
    s.nodeX         = EDGE_MARGIN + Math.random() * (canvas.width  - EDGE_MARGIN * 2);
    s.nodeY         = EDGE_MARGIN + Math.random() * (canvas.height - EDGE_MARGIN * 2);
    s.nodeSpawnTime = Date.now();
    s.nodeAlive     = true;
    s.sig.totalNodes++;
  }, []);

  // ─── END GAME ───────────────────────────────────────────────────────────────

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current)   { clearInterval(timerRef.current);  timerRef.current  = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (respawnRef.current) { clearTimeout(respawnRef.current); respawnRef.current = null; }
    // Finalize longest chain in case a chain was still live at time-up
    if (s.sig.currentChain > s.sig.longestChain) s.sig.longestChain = s.sig.currentChain;
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

    // Reset mutable state
    s.running        = true;
    s.timeLeft       = DURATION;
    s.sig            = {
      reactionTimes: [],
      longestChain:  0,
      chainBreaks:   0,
      totalNodes:    0,
      tappedNodes:   0,
      currentChain:  0,
      score:         0,
    };
    s.nodeAlive           = false;
    s.chainBreakFlash     = 0;
    s.lastChainDisplayed  = 0;
    s.particles           = [];
    s.shake               = { intensity: 0, duration: 0 };

    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    // ⚠️ setInterval ONLY for 1-second countdown — never for animation
    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      // Warning at 10s, urgency ticks at ≤5s
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 5 && s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) {
        // Spec endSound = "success" — the game always completes, never globally fails
        sfx.success();
        haptic([30, 50, 30, 50, 100]);
        endGame();
      }
    }, 1000);

    spawnNode();

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width;
      const H = canvas.height;

      // ── Background ──────────────────────────────────────────────────────────
      ctx.fillStyle = '#08090f';
      ctx.fillRect(0, 0, W, H);

      // ── Chain-break red flash overlay ───────────────────────────────────────
      if (s.chainBreakFlash > 0) {
        ctx.fillStyle = `rgba(239, 68, 68, ${s.chainBreakFlash * 0.18})`;
        ctx.fillRect(0, 0, W, H);
        s.chainBreakFlash = Math.max(0, s.chainBreakFlash - 0.035);
      }

      // ── Screen shake offset for node + particles (background stays fixed) ───
      ctx.save();
      if (s.shake.duration > 0) applyShake(ctx, s.shake);

      // ── Node ────────────────────────────────────────────────────────────────
      if (s.nodeAlive) {
        const age      = Date.now() - s.nodeSpawnTime;
        const progress = Math.min(1, age / s.nodeWindowMs); // 0 = fresh, 1 = expired

        if (progress >= 1) {
          // Node expired — break the chain
          s.nodeAlive = false;
          if (s.sig.currentChain > s.sig.longestChain) s.sig.longestChain = s.sig.currentChain;
          s.sig.currentChain  = 0;
          s.sig.chainBreaks++;
          s.chainBreakFlash   = 1;
          s.lastChainDisplayed = 0;
          triggerShake(s.shake, 5, 8);
          sfx.collision();
          haptic([80]);
          // Post-miss pause before next node (≤ 500ms — within rules)
          // setScoreDisplay here (outside rAF hot-path) to avoid React setState in animation frame
          respawnRef.current = setTimeout(() => {
            if (s.running) { setScoreDisplay(0); spawnNode(); }
          }, 500);
        } else {
          const alpha         = 1 - progress * 0.55;
          const currentRadius = NODE_RADIUS * (1 - progress * 0.28);
          const accentCol     = s.accentColor;
          const chainGlow     = Math.min(48, 18 + s.sig.currentChain * 2);

          ctx.save();
          ctx.globalAlpha = alpha;

          // Timer arc — shrinks clockwise as window runs out
          const arcRadius = currentRadius + 18;
          ctx.shadowBlur  = 0;
          ctx.strokeStyle = `${accentCol}55`;
          ctx.lineWidth   = 3;
          ctx.lineCap     = 'round';
          ctx.beginPath();
          ctx.arc(s.nodeX, s.nodeY, arcRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - progress));
          ctx.stroke();

          // Glow
          ctx.shadowBlur  = chainGlow;
          ctx.shadowColor = accentCol;

          // Node fill + stroke
          ctx.fillStyle   = `${accentCol}28`;
          ctx.strokeStyle = accentCol;
          ctx.lineWidth   = 3;
          ctx.beginPath();
          ctx.arc(s.nodeX, s.nodeY, currentRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Inner bright dot
          ctx.shadowBlur = 0;
          ctx.fillStyle  = accentCol;
          ctx.beginPath();
          ctx.arc(s.nodeX, s.nodeY, Math.max(3, 8 - progress * 4), 0, Math.PI * 2);
          ctx.fill();

          ctx.restore();
        }
      }

      // ── Tap particles ────────────────────────────────────────────────────────
      updateAndDrawParticles(ctx, s.particles);

      ctx.restore(); // end shake transform

      // ── Watermark chain count (grows with chain, very subtle) ───────────────
      if (s.sig.currentChain > 0) {
        ctx.save();
        ctx.globalAlpha  = Math.min(0.12, 0.04 + s.sig.currentChain * 0.006);
        ctx.fillStyle    = s.accentColor;
        ctx.font         = `bold ${Math.min(140, 48 + s.sig.currentChain * 4)}px system-ui`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`×${s.sig.currentChain}`, W / 2, H * 0.7);
        ctx.restore();
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnNode]);

  // ─── POINTER INPUT ──────────────────────────────────────────────────────────

  const handleTap = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const s = stateRef.current;
      if (!s.running || !s.nodeAlive) return;

      const rect = canvas.getBoundingClientRect();
      const x    = (clientX - rect.left) * (canvas.width  / rect.width);
      const y    = (clientY - rect.top)  * (canvas.height / rect.height);
      const dx   = x - s.nodeX;
      const dy   = y - s.nodeY;

      if (Math.sqrt(dx * dx + dy * dy) > NODE_RADIUS + 14) return;

      const reactionMs = Date.now() - s.nodeSpawnTime;
      s.sig.tappedNodes++;
      s.sig.reactionTimes.push(reactionMs);
      s.sig.currentChain++;
      if (s.sig.currentChain > s.sig.longestChain) s.sig.longestChain = s.sig.currentChain;

      // +1 per tap, +5 bonus if reaction under 300ms
      s.sig.score += 1 + (reactionMs < 300 ? 5 : 0);

      // Particle burst at tap position
      spawnBurst(s.particles, x, y, s.accentColor, 14, 5);

      if (s.lastChainDisplayed !== s.sig.currentChain) {
        s.lastChainDisplayed = s.sig.currentChain;
        setScoreDisplay(s.sig.currentChain);
      }
      sfx.collect();
      haptic([20]);

      s.nodeAlive = false;
      // Immediate spawn after hit
      spawnNode();
    },
    [spawnNode],
  );

  // ─── CANVAS SETUP & RESIZE ──────────────────────────────────────────────────

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

  // ─── CLEANUP ON UNMOUNT ─────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current)   clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
      if (respawnRef.current) clearTimeout(respawnRef.current);
    };
  }, []);

  // ─── PHASE TRANSITIONS ──────────────────────────────────────────────────────

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

  // ─── END SCREEN INSIGHTS ────────────────────────────────────────────────────

  const buildInsights = useCallback(
    (sig: Signals) => {
      const avgRT =
        sig.reactionTimes.length > 0
          ? Math.round(sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length)
          : 0;
      const accuracy =
        sig.totalNodes > 0 ? Math.round((sig.tappedNodes / sig.totalNodes) * 100) : 0;
      const accentCol = theme.colors.accent ?? ACCENT;

      return [
        {
          label: 'Longest Chain',
          value: `${sig.longestChain}`,
          color:
            sig.longestChain >= 20 ? '#4ade80' : sig.longestChain >= 10 ? '#facc15' : '#ef4444',
        },
        {
          label: 'Avg Reaction',
          value: avgRT > 0 ? `${avgRT}ms` : '—',
          color:
            avgRT > 0 && avgRT < 350 ? '#4ade80' : avgRT > 0 && avgRT <= 550 ? '#facc15' : '#ef4444',
        },
        {
          label: 'Chain Breaks',
          value: `${sig.chainBreaks}`,
          color:
            sig.chainBreaks <= 2 ? '#4ade80' : sig.chainBreaks <= 5 ? '#facc15' : '#ef4444',
        },
        {
          label: 'Nodes Hit',
          value: `${accuracy}%`,
          color: accentCol,
        },
      ];
    },
    [theme],
  );

  // ─── RENDER ─────────────────────────────────────────────────────────────────

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {/* ── Start Screen ──────────────────────────────────────────────────── */}
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
                { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
                { label: 'CHAIN', value: scoreDisplay },
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
          score={String(finalSig.longestChain)}
          personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)}
          accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain}
          didWin={finalSig.longestChain >= 10}
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
    const avgReaction =
      sig.reactionTimes.length > 0
        ? Math.round(sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length)
        : null;
    postWebhook(theme, gameId, {
      personality,
      score:         sig.score,
      longestChain:  sig.longestChain,
      chainBreaks:   sig.chainBreaks,
      totalNodes:    sig.totalNodes,
      tappedNodes:   sig.tappedNodes,
      reactionTimes: sig.reactionTimes,
      avgReactionMs: avgReaction,
    }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
