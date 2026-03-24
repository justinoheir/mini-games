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

const GAME_ID      = 'marathon-pace';
const ACCENT       = '#22c55e';
const DURATION     = 60;
const GAME_EMOJI   = '🏃';
const GAME_TITLE   = 'Marathon Pace';
const GAME_TAGLINE = 'Tilt to control your pace — stay in the green zone or cramp out.';

interface Signals {
  timeInZone: number;
  crampEvents: number;
  lastPlaceEvents: number;
  maxConsecutiveInZone: number;
  score: number;
}

function getPersonality(sig: Signals): string {
  const ratio = sig.timeInZone / DURATION;
  if (ratio >= 0.8 && sig.crampEvents === 0)   return 'Kenyan Pace 🇰🇪';
  if (ratio >= 0.65 && sig.crampEvents <= 1)   return 'Steady Runner 🏃';
  if (sig.crampEvents >= 5)                     return 'Cramp Machine 😬';
  if (sig.lastPlaceEvents >= 5)                 return 'Couch to 5K 🛋️';
  return 'Finding the Rhythm 🎵';
}

interface Runner {
  x: number;
  legAngle: number;
  legSpeed: number;
  armAngle: number;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  pace: number;        // 0-1 where 0.4-0.65 is green zone
  tiltX: number;       // from accelerometer (-10 to 10)
  inZone: boolean;
  consecutiveTicks: number;
  runner: Runner;
  backgroundX: number;
  accentColor: string;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

const ZONE_MIN = 0.35;
const ZONE_MAX = 0.65;

export default function MarathonPaceGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef<GameState>({
    running: false,
    timeLeft: DURATION,
    sig: { timeInZone: 0, crampEvents: 0, lastPlaceEvents: 0, maxConsecutiveInZone: 0, score: 0 },
    pace: 0.5,
    tiltX: 0,
    inZone: false,
    consecutiveTicks: 0,
    runner: { x: 0, legAngle: 0, legSpeed: 0, armAngle: 0 },
    backgroundX: 0,
    accentColor: ACCENT,
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🏃');
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    // Remove motion listener
    window.removeEventListener('devicemotion', (s as unknown as { motionHandler?: EventListenerOrEventListenerObject }).motionHandler as EventListener);
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
    s.sig = { timeInZone: 0, crampEvents: 0, lastPlaceEvents: 0, maxConsecutiveInZone: 0, score: 0 };
    s.pace = 0.5;
    s.tiltX = 0;
    s.inZone = false;
    s.consecutiveTicks = 0;
    s.runner = { x: canvas.width * 0.35, legAngle: 0, legSpeed: 0.15, armAngle: 0 };
    s.backgroundX = 0;
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    // Motion handler
    const motionHandler = (e: DeviceMotionEvent) => {
      const grav = e.accelerationIncludingGravity;
      if (grav) {
        const tiltNorm = Math.max(-1, Math.min(1, (grav.x ?? 0) / 9));
        s.tiltX = tiltNorm;
      }
    };
    (s as unknown as Record<string, unknown>).motionHandler = motionHandler;
    window.addEventListener('devicemotion', motionHandler as EventListener);

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);

      if (s.inZone) {
        s.sig.timeInZone++;
        s.consecutiveTicks++;
        if (s.consecutiveTicks > s.sig.maxConsecutiveInZone) s.sig.maxConsecutiveInZone = s.consecutiveTicks;
        s.sig.score += 2;
        setScoreDisplay(s.sig.score);
        haptic([30]);
      } else if (s.pace > ZONE_MAX) {
        s.sig.crampEvents++;
      } else {
        s.sig.lastPlaceEvents++;
        s.consecutiveTicks = 0;
      }

      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width;
      const H = canvas.height;

      // Update pace from tilt
      const targetPace = 0.5 + s.tiltX * 0.45;
      s.pace += (targetPace - s.pace) * 0.04;
      s.pace = Math.max(0, Math.min(1, s.pace));
      s.inZone = s.pace >= ZONE_MIN && s.pace <= ZONE_MAX;

      // Runner animation
      const legSpeed = 0.06 + s.pace * 0.2;
      s.runner.legAngle += legSpeed;
      s.runner.armAngle = -s.runner.legAngle;
      s.backgroundX += s.pace * 4;

      // Background
      ctx.fillStyle = '#0a1f0a';
      ctx.fillRect(0, 0, W, H);

      // Scrolling track
      const trackY = H * 0.72;
      ctx.fillStyle = '#1a3a1a';
      ctx.fillRect(0, trackY, W, H * 0.28);

      // Lane lines
      ctx.strokeStyle = 'rgba(34,197,94,0.3)';
      ctx.lineWidth = 2;
      ctx.setLineDash([30, 20]);
      for (let i = 0; i < 3; i++) {
        const dashX = ((s.backgroundX * (1 + i * 0.3)) % 50) - 50;
        ctx.beginPath();
        ctx.moveTo(dashX, trackY + H * 0.09 * (i + 0.5));
        ctx.lineTo(W + 50, trackY + H * 0.09 * (i + 0.5));
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Background runners (silhouettes for context)
      const bgRunnerPositions = [0.25, 0.55, 0.75, 0.88];
      for (const rx of bgRunnerPositions) {
        const bx = (rx * W - (s.backgroundX * 0.5)) % W;
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#4ade80';
        ctx.beginPath();
        ctx.arc(bx, trackY - 10, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(bx - 3, trackY - 4, 6, 14);
        ctx.globalAlpha = 1;
      }

      // Main runner
      const rx = W * 0.35;
      const ry = trackY - 5;
      ctx.save();
      ctx.translate(rx, ry);

      // Body
      ctx.fillStyle = ACCENT;
      ctx.shadowBlur = 15;
      ctx.shadowColor = ACCENT;
      // Head
      ctx.beginPath(); ctx.arc(0, -28, 8, 0, Math.PI * 2); ctx.fill();
      // Torso
      ctx.fillRect(-5, -20, 10, 20);
      // Legs
      const legSwing = Math.sin(s.runner.legAngle) * 18;
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-8 + legSwing, 18); ctx.lineTo(-4 + legSwing, 32); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(8 - legSwing, 18); ctx.lineTo(4 - legSwing, 32); ctx.stroke();
      // Arms
      const armSwing = Math.sin(s.runner.armAngle) * 14;
      ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(-14 - armSwing, -4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(14 + armSwing, -4); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();

      // Pace meter (horizontal bar)
      const meterX = W * 0.1;
      const meterW = W * 0.8;
      const meterY = H * 0.88;
      const meterH = 20;

      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(meterX, meterY, meterW, meterH);

      // Green zone
      const gx1 = meterX + meterW * ZONE_MIN;
      const gx2 = meterX + meterW * ZONE_MAX;
      ctx.fillStyle = 'rgba(34,197,94,0.35)';
      ctx.fillRect(gx1, meterY, gx2 - gx1, meterH);
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 2;
      ctx.strokeRect(gx1, meterY, gx2 - gx1, meterH);

      // Needle
      const needleX = meterX + meterW * s.pace;
      const needleColor = s.inZone ? '#4ade80' : s.pace > ZONE_MAX ? '#ef4444' : '#f97316';
      ctx.fillStyle = needleColor;
      ctx.shadowBlur = 10; ctx.shadowColor = needleColor;
      ctx.fillRect(needleX - 3, meterY - 5, 6, meterH + 10);
      ctx.shadowBlur = 0;

      // Status
      ctx.fillStyle = s.inZone ? '#4ade80' : s.pace > ZONE_MAX ? '#ef4444' : '#f97316';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        s.inZone ? 'PERFECT PACE' : s.pace > ZONE_MAX ? 'TOO FAST — CRAMP!' : 'SPEED UP!',
        W / 2, H * 0.96
      );
      ctx.textAlign = 'left';

      // Tilt instruction
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('TILT PHONE TO ADJUST PACE', W / 2, H * 0.84);
      ctx.textAlign = 'left';

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  // Touch fallback for desktop testing
  const handlePointerMove = useCallback((e: PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || phase !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    stateRef.current.tiltX = (x - 0.5) * 2;
  }, [phase]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);
    canvas.addEventListener('pointermove', handlePointerMove as EventListener);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointermove', handlePointerMove as EventListener);
    };
  }, [phase, handlePointerMove]);

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

  const buildInsights = (sig: Signals) => {
    const ratio = Math.round((sig.timeInZone / DURATION) * 100);
    return [
      { label: 'In Zone',    value: `${ratio}%`,              color: ratio >= 70 ? '#4ade80' : '#facc15' },
      { label: 'Best Run',   value: `${sig.maxConsecutiveInZone}s`, color: ACCENT },
      { label: 'Cramps',     value: `${sig.crampEvents}`,     color: sig.crampEvents === 0 ? '#4ade80' : '#ef4444' },
      { label: 'Last Place', value: `${sig.lastPlaceEvents}×`, color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Hit the Track" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Marathon Pace game canvas" />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME',  value: timeLeft,      danger: timeLeft <= 10 },
              { label: 'SCORE', value: scoreDisplay },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.timeInZone >= 35} />
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
    postWebhook(theme, gameId, { personality, score: sig.score, timeInZone: sig.timeInZone, crampEvents: sig.crampEvents, lastPlaceEvents: sig.lastPlaceEvents, maxConsecutiveInZone: sig.maxConsecutiveInZone }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
