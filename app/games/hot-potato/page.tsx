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

const GAME_ID      = 'hot-potato';
const ACCENT       = '#f97316';
const DURATION     = 30;
const GAME_EMOJI   = '🥔';
const GAME_TITLE   = 'Hot Potato';
const GAME_TAGLINE = 'Tap the potato away before it burns you. It gets faster every 5 seconds!';

interface Signals {
  totalTaps: number;
  burnCount: number;
  maxSpeedLevel: number;
  avgReactionMs: number;
  reactionTimes: number[];
  score: number;
}

function getPersonality(sig: Signals): string {
  const avgR = sig.reactionTimes.length > 0
    ? sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length : 9999;
  if (sig.burnCount === 0 && sig.maxSpeedLevel >= 4)    return 'Ice Hands 🧊';
  if (avgR < 250 && sig.totalTaps >= 10)                return 'Lightning Reflexes ⚡';
  if (sig.maxSpeedLevel >= 5)                           return 'Speed Level 6 🔥';
  if (sig.burnCount >= 5)                               return 'Burn Ward Regular 🏥';
  return 'Warm-Handed 🥔';
}

interface Potato {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  heat: number;  // 0-1
  spawnTime: number;
  burnTimer: number;
  maxBurnTimer: number;
}

interface BurnEffect {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  potato: Potato | null;
  burnEffects: BurnEffect[];
  speedLevel: number;
  accentColor: string;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function spawnPotato(canvas: HTMLCanvasElement, speedLevel: number): Potato {
  const margin = 50;
  const x = margin + Math.random() * (canvas.width - margin * 2);
  const y = margin + Math.random() * (canvas.height - margin * 2);
  const baseSpeed = 2 + speedLevel * 0.7;
  const angle = Math.random() * Math.PI * 2;
  const maxBurnTimer = Math.max(60, 150 - speedLevel * 18);
  return {
    x, y,
    vx: Math.cos(angle) * baseSpeed,
    vy: Math.sin(angle) * baseSpeed,
    radius: 28,
    heat: 0,
    spawnTime: Date.now(),
    burnTimer: 0,
    maxBurnTimer,
  };
}

export default function HotPotatoGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef<GameState>({
    running: false,
    timeLeft: DURATION,
    sig: { totalTaps: 0, burnCount: 0, maxSpeedLevel: 1, avgReactionMs: 0, reactionTimes: [], score: 0 },
    potato: null,
    burnEffects: [],
    speedLevel: 1,
    accentColor: ACCENT,
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🥔');
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    if (s.sig.reactionTimes.length > 0) {
      s.sig.avgReactionMs = Math.round(s.sig.reactionTimes.reduce((a, b) => a + b, 0) / s.sig.reactionTimes.length);
    }
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    s.running = true;
    s.timeLeft = DURATION;
    s.sig = { totalTaps: 0, burnCount: 0, maxSpeedLevel: 1, avgReactionMs: 0, reactionTimes: [], score: 0 };
    s.speedLevel = 1;
    s.burnEffects = [];
    s.potato = spawnPotato(canvas, 1);
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      // Speed increases every 5 seconds
      s.speedLevel = 1 + Math.floor((DURATION - s.timeLeft) / 5);
      if (s.speedLevel > s.sig.maxSpeedLevel) s.sig.maxSpeedLevel = s.speedLevel;
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width;
      const H = canvas.height;

      // Background
      ctx.fillStyle = '#1a0800';
      ctx.fillRect(0, 0, W, H);

      // Subtle grid
      ctx.strokeStyle = 'rgba(249,115,22,0.05)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
      for (let gy = 0; gy < H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

      if (s.potato) {
        const p = s.potato;
        // Physics
        p.x += p.vx;
        p.y += p.vy;
        // Bounce
        if (p.x - p.radius < 0) { p.vx = Math.abs(p.vx); p.x = p.radius; }
        if (p.x + p.radius > W) { p.vx = -Math.abs(p.vx); p.x = W - p.radius; }
        if (p.y - p.radius < 0) { p.vy = Math.abs(p.vy); p.y = p.radius; }
        if (p.y + p.radius > H) { p.vy = -Math.abs(p.vy); p.y = H - p.radius; }

        // Heat buildup
        p.burnTimer++;
        p.heat = p.burnTimer / p.maxBurnTimer;

        if (p.burnTimer >= p.maxBurnTimer) {
          // BURN!
          s.sig.burnCount++;
          s.burnEffects.push({ x: p.x, y: p.y, radius: p.radius, alpha: 1 });
          sfx.fail();
          haptic([100, 50, 100]);
          s.potato = spawnPotato(canvas, s.speedLevel);
        } else {
          // Draw potato
          const heatR = Math.floor(200 + p.heat * 55);
          const heatG = Math.floor(120 - p.heat * 100);
          const heatB = Math.floor(30 - p.heat * 30);

          // Glow
          ctx.shadowBlur = 15 + p.heat * 25;
          ctx.shadowColor = `rgb(${heatR},${heatG},${heatB})`;

          // Body
          ctx.fillStyle = `rgb(${heatR},${heatG},${heatB})`;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.radius * 1.1, p.radius * 0.9, Math.atan2(p.vy, p.vx), 0, Math.PI * 2);
          ctx.fill();

          // Texture bumps
          ctx.fillStyle = `rgba(0,0,0,0.2)`;
          for (let i = 0; i < 4; i++) {
            const bx = p.x + (Math.cos(i * 1.5) * p.radius * 0.4);
            const by = p.y + (Math.sin(i * 1.5) * p.radius * 0.35);
            ctx.beginPath();
            ctx.arc(bx, by, 4, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.shadowBlur = 0;

          // Heat bar above potato
          const barW = p.radius * 2;
          const barX = p.x - p.radius;
          const barY = p.y - p.radius - 14;
          ctx.fillStyle = '#333';
          ctx.fillRect(barX, barY, barW, 8);
          ctx.fillStyle = `rgb(${heatR},${heatG},${heatB})`;
          ctx.fillRect(barX, barY, barW * p.heat, 8);
        }
      }

      // Burn effects
      s.burnEffects = s.burnEffects.filter(b => {
        b.alpha -= 0.03;
        b.radius += 2;
        if (b.alpha <= 0) return false;
        ctx.globalAlpha = b.alpha;
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(b.x + Math.cos(angle) * b.radius, b.y + Math.sin(angle) * b.radius, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        return true;
      });

      // Speed level indicator
      ctx.fillStyle = ACCENT;
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`SPEED LV.${s.speedLevel}`, W - 12, H - 16);
      ctx.textAlign = 'left';

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  const handleTap = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    if (!s.running || !s.potato) return;

    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);
    const p = s.potato;
    const dx = x - p.x, dy = y - p.y;

    if (Math.sqrt(dx * dx + dy * dy) <= p.radius + 15) {
      const reactionMs = Date.now() - p.spawnTime;
      s.sig.reactionTimes.push(reactionMs);
      s.sig.totalTaps++;
      s.sig.score++;
      setScoreDisplay(s.sig.score);

      // Fling away from tap
      const norm = Math.sqrt(dx * dx + dy * dy) || 1;
      const speed = 3 + s.speedLevel * 0.5;
      p.vx = -(dx / norm) * speed * 1.5;
      p.vy = -(dy / norm) * speed * 1.5;
      p.burnTimer = Math.max(0, p.burnTimer - p.maxBurnTimer * 0.4);
      p.heat = p.burnTimer / p.maxBurnTimer;

      sfx.collect();
      haptic([30]);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
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

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    setPlayerName(name); setPlayerAvatar(avatar);
    initAudio();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const buildInsights = (sig: Signals) => [
    { label: 'Taps',      value: `${sig.totalTaps}`,                                 color: ACCENT },
    { label: 'Burns',     value: `${sig.burnCount}`,                                 color: sig.burnCount === 0 ? '#4ade80' : '#ef4444' },
    { label: 'Max Speed', value: `Lv.${sig.maxSpeedLevel}`,                          color: ACCENT },
    { label: 'Avg React', value: sig.avgReactionMs > 0 ? `${sig.avgReactionMs}ms` : '-', color: 'var(--color-text)' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Touch the Potato" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Hot Potato game canvas" />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME',  value: timeLeft,      danger: timeLeft <= 10 },
              { label: 'SCORE', value: scoreDisplay },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.burnCount === 0} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, gameId, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>; gameId: string; sig: Signals; personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, gameId, { personality, score: sig.score, totalTaps: sig.totalTaps, burnCount: sig.burnCount, maxSpeedLevel: sig.maxSpeedLevel, avgReactionMs: sig.avgReactionMs }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
