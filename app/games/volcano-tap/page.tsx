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

const GAME_ID      = 'volcano-tap';
const ACCENT       = '#ef4444';
const DURATION     = 45;
const GAME_EMOJI   = '🌋';
const GAME_TITLE   = 'Volcano Tap';
const GAME_TAGLINE = 'Tap rising lava bubbles before they overflow. Miss three — eruption!';

interface Signals {
  bubblesPopped: number;
  missed: number;
  maxStreak: number;
  streakCurrent: number;
  fastestPop: number;  // ms
  score: number;
}

function getPersonality(sig: Signals): string {
  if (sig.missed === 0 && sig.bubblesPopped >= 15)    return 'Volcano Tamer 🌋';
  if (sig.maxStreak >= 10)                             return 'Lava Legend ⚡';
  if (sig.bubblesPopped >= 20)                         return 'Bubble Blaster 💥';
  if (sig.missed >= 3)                                 return 'Eruption Survivor 😤';
  return 'Magma Rookie 🔴';
}

interface Bubble {
  id: number;
  x: number;
  y: number;
  targetY: number;
  radius: number;
  spawnTime: number;
  speed: number;
  popping: boolean;
  popAlpha: number;
  heat: number; // 0-1, higher = closer to overflow
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  bubbles: Bubble[];
  missCount: number;
  spawnInterval: number;
  spawnTimer: number;
  bubbleIdCounter: number;
  lavaLevel: number;      // 0 (calm) to 1 (erupting)
  eruptionPhase: number;
  accentColor: string;
  difficultyLevel: number;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';
const MAX_MISSES = 3;

export default function VolcanoTapGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef<GameState>({
    running: false,
    timeLeft: DURATION,
    sig: { bubblesPopped: 0, missed: 0, maxStreak: 0, streakCurrent: 0, fastestPop: 9999, score: 0 },
    bubbles: [],
    missCount: 0,
    spawnInterval: 90,
    spawnTimer: 0,
    bubbleIdCounter: 0,
    lavaLevel: 0.2,
    eruptionPhase: 0,
    accentColor: ACCENT,
    difficultyLevel: 1,
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [missDisplay, setMissDisplay]   = useState(0);
  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🌋');
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const triggerEruption = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.fail();
    haptic([100, 50, 100, 50, 200]);
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
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
    s.sig = { bubblesPopped: 0, missed: 0, maxStreak: 0, streakCurrent: 0, fastestPop: 9999, score: 0 };
    s.bubbles = [];
    s.missCount = 0;
    s.spawnInterval = 90;
    s.spawnTimer = 0;
    s.bubbleIdCounter = 0;
    s.lavaLevel = 0.2;
    s.eruptionPhase = 0;
    s.difficultyLevel = 1;
    setScoreDisplay(0);
    setMissDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      s.difficultyLevel = 1 + Math.floor((DURATION - s.timeLeft) / 10);
      s.spawnInterval = Math.max(35, 90 - s.difficultyLevel * 12);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width;
      const H = canvas.height;

      s.spawnTimer++;
      if (s.spawnTimer >= s.spawnInterval) {
        s.spawnTimer = 0;
        const r = 18 + Math.random() * 18;
        const spawnX = r + Math.random() * (W - r * 2);
        const baseY = H * 0.82;
        const speed = 0.6 + Math.random() * 0.8 + s.difficultyLevel * 0.2;
        s.bubbles.push({
          id: s.bubbleIdCounter++,
          x: spawnX,
          y: baseY,
          targetY: baseY - (80 + Math.random() * 80),
          radius: r,
          spawnTime: Date.now(),
          speed,
          popping: false,
          popAlpha: 1,
          heat: 0,
        });
      }

      // Background — volcanic sky
      ctx.fillStyle = '#1a0500';
      ctx.fillRect(0, 0, W, H);

      // Lava flow at bottom
      const lavaTop = H * 0.82;
      for (let lx = 0; lx < W; lx += 4) {
        const wave = Math.sin(lx * 0.05 + Date.now() * 0.003) * 6;
        const r = 200 + Math.floor(Math.random() * 30);
        ctx.fillStyle = `rgb(${r},${Math.floor(r * 0.3)},0)`;
        ctx.fillRect(lx, lavaTop + wave, 4, H);
      }

      // Volcano silhouette
      ctx.fillStyle = '#0d0200';
      ctx.beginPath();
      ctx.moveTo(0, H);
      ctx.lineTo(W * 0.1, lavaTop + 10);
      ctx.lineTo(W * 0.3, H * 0.5);
      ctx.lineTo(W * 0.5, H * 0.35);
      ctx.lineTo(W * 0.7, H * 0.5);
      ctx.lineTo(W * 0.9, lavaTop + 10);
      ctx.lineTo(W, H);
      ctx.fill();

      // Update & draw bubbles
      s.bubbles = s.bubbles.filter(b => {
        if (b.popping) {
          b.popAlpha -= 0.08;
          if (b.popAlpha <= 0) return false;
          ctx.globalAlpha = b.popAlpha;
          for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const dist = (1 - b.popAlpha) * b.radius * 2;
            ctx.beginPath();
            ctx.arc(b.x + Math.cos(angle) * dist, b.y + Math.sin(angle) * dist, b.radius * 0.3 * b.popAlpha, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(239,68,68,${b.popAlpha})`;
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          return true;
        }

        b.y -= b.speed;
        b.heat = Math.max(0, Math.min(1, 1 - (b.y - b.targetY) / (lavaTop - b.targetY)));

        // Check if bubble overflowed (reached targetY)
        if (b.y <= b.targetY) {
          s.sig.missed++;
          s.missCount++;
          setMissDisplay(s.missCount);
          s.sig.streakCurrent = 0;
          sfx.collision();
          haptic([20, 30, 20]);
          if (s.missCount >= MAX_MISSES) {
            setTimeout(() => triggerEruption(), 100);
          }
          return false;
        }

        // Draw bubble
        const heatColor = `rgba(239,${Math.floor(100 - b.heat * 70)},${Math.floor(100 - b.heat * 100)},`;
        ctx.shadowBlur = 12 + b.heat * 20;
        ctx.shadowColor = ACCENT;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.strokeStyle = `${heatColor}0.9)`;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = `${heatColor}0.3)`;
        ctx.fill();
        // Inner glow dot
        ctx.beginPath();
        ctx.arc(b.x - b.radius * 0.3, b.y - b.radius * 0.3, b.radius * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,220,200,0.5)`;
        ctx.fill();
        ctx.shadowBlur = 0;

        return true;
      });

      // Miss indicators
      for (let m = 0; m < MAX_MISSES; m++) {
        const mx = 16 + m * 32;
        const my = H - 24;
        ctx.beginPath();
        ctx.arc(mx, my, 10, 0, Math.PI * 2);
        ctx.fillStyle = m < s.missCount ? ACCENT : '#333';
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, triggerEruption]);

  const handleTap = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    if (!s.running) return;

    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);

    for (const b of s.bubbles) {
      if (b.popping) continue;
      const dx = x - b.x, dy = y - b.y;
      if (Math.sqrt(dx * dx + dy * dy) <= b.radius + 10) {
        b.popping = true;
        const elapsed = Date.now() - b.spawnTime;
        if (elapsed < s.sig.fastestPop) s.sig.fastestPop = elapsed;
        s.sig.bubblesPopped++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const pts = s.sig.streakCurrent >= 3 ? 2 : 1;
        s.sig.score += pts;
        setScoreDisplay(s.sig.score);
        sfx.collect();
        haptic([30]);
        break;
      }
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
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setMissDisplay(0);
  }, []);

  const buildInsights = (sig: Signals) => [
    { label: 'Popped',      value: `${sig.bubblesPopped}`,   color: ACCENT },
    { label: 'Best Streak', value: `×${sig.maxStreak}`,      color: ACCENT },
    { label: 'Missed',      value: `${sig.missed}`,          color: sig.missed === 0 ? '#4ade80' : '#ef4444' },
    { label: 'Fastest',     value: sig.fastestPop < 9000 ? `${sig.fastestPop}ms` : '-', color: 'var(--color-text)' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Enter the Crater" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Volcano Tap game canvas" />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME',  value: timeLeft,      danger: timeLeft <= 10 },
              { label: 'SCORE', value: scoreDisplay },
              { label: 'MISS',  value: missDisplay,   danger: missDisplay >= 2 },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.missed < MAX_MISSES} />
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
    postWebhook(theme, gameId, { personality, score: sig.score, bubblesPopped: sig.bubblesPopped, missed: sig.missed, maxStreak: sig.maxStreak }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
