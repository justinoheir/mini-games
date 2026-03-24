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

const GAME_ID      = 'gravity-flip';
const ACCENT       = '#8b5cf6';
const DURATION     = 60;
const GAME_EMOJI   = '⬆️';
const GAME_TITLE   = 'Gravity Flip';
const GAME_TAGLINE = 'Tap to flip gravity and guide your ball through the corridor.';

interface Signals {
  flips: number;
  wallHits: number;
  obstaclesDodged: number;
  maxRunDistance: number;
  score: number;
}

function getPersonality(sig: Signals): string {
  if (sig.obstaclesDodged >= 20 && sig.wallHits <= 2)  return 'Gravity Lord ⬆️';
  if (sig.wallHits <= 3 && sig.flips >= 15)             return 'Smooth Flipper 🌀';
  if (sig.obstaclesDodged >= 15)                        return 'Obstacle Crusher 💪';
  if (sig.flips >= 25)                                  return 'Flip Maniac 🔄';
  return 'Learning to Float 🫧';
}

interface Obstacle {
  x: number;
  topH: number;   // height of top barrier
  botH: number;   // height of bottom barrier
  passed: boolean;
}

interface TrailPoint {
  x: number;
  y: number;
  alpha: number;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  ballY: number;
  ballVY: number;
  gravity: number;
  gravityDir: 1 | -1;
  scrollX: number;
  scrollSpeed: number;
  obstacles: Obstacle[];
  trail: TrailPoint[];
  corridorPad: number; // padding from top/bottom wall
  accentColor: string;
  dead: boolean;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

export default function GravityFlipGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef<GameState>({
    running: false,
    timeLeft: DURATION,
    sig: { flips: 0, wallHits: 0, obstaclesDodged: 0, maxRunDistance: 0, score: 0 },
    ballY: 0.5,
    ballVY: 0,
    gravity: 0.0015,
    gravityDir: 1,
    scrollX: 0,
    scrollSpeed: 2,
    obstacles: [],
    trail: [],
    corridorPad: 0.15,
    accentColor: ACCENT,
    dead: false,
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('⬆️');
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

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
    s.sig = { flips: 0, wallHits: 0, obstaclesDodged: 0, maxRunDistance: 0, score: 0 };
    s.ballY = 0.5;
    s.ballVY = 0;
    s.gravityDir = 1;
    s.scrollX = 0;
    s.scrollSpeed = 2;
    s.obstacles = [];
    s.trail = [];
    s.dead = false;
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      s.scrollSpeed = Math.min(4.5, 2 + (DURATION - s.timeLeft) * 0.05);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width;
      const H = canvas.height;

      // Physics
      const grav = s.gravity * s.gravityDir;
      s.ballVY += grav * H;
      s.ballY += s.ballVY / H;
      s.scrollX += s.scrollSpeed;

      const ballR = W * 0.03;
      const ballAbsY = s.ballY * H;
      const topWall = s.corridorPad * H;
      const botWall = (1 - s.corridorPad) * H;

      // Wall collision
      if (ballAbsY - ballR <= topWall || ballAbsY + ballR >= botWall) {
        s.sig.wallHits++;
        sfx.collision();
        haptic([20, 30, 20]);
        s.ballVY *= -0.3;
        s.ballY = ballAbsY - ballR <= topWall
          ? (topWall + ballR + 2) / H
          : (botWall - ballR - 2) / H;
      }

      // Spawn obstacles
      const lastObs = s.obstacles[s.obstacles.length - 1];
      if (!lastObs || s.scrollX - (lastObs.x + W) > W * 0.45) {
        const gap = 0.35;
        const topMax = 0.55 - gap;
        const topH = s.corridorPad + Math.random() * topMax;
        s.obstacles.push({ x: s.scrollX + W, topH, botH: 1 - topH - gap, passed: false });
      }

      // Check obstacle collisions & scoring
      s.obstacles = s.obstacles.filter(obs => {
        const obsScreenX = obs.x - s.scrollX;
        if (obsScreenX > W + 50) return false;

        const ballScreenX = W * 0.3;
        const inX = Math.abs(ballScreenX - obsScreenX) < ballR + W * 0.025;

        if (inX) {
          const topBarBot = obs.topH * H;
          const botBarTop = (1 - obs.botH) * H;
          if (ballAbsY - ballR < topBarBot || ballAbsY + ballR > botBarTop) {
            s.sig.wallHits++;
            sfx.collision();
            haptic([20, 30, 20]);
          }
        }

        if (!obs.passed && obsScreenX < W * 0.3 - ballR) {
          obs.passed = true;
          s.sig.obstaclesDodged++;
          s.sig.score++;
          setScoreDisplay(s.sig.score);
          sfx.collect();
          haptic([30]);
        }
        return obsScreenX > -60;
      });

      // Trail
      s.trail.push({ x: W * 0.3, y: ballAbsY, alpha: 0.8 });
      if (s.trail.length > 20) s.trail.shift();
      s.trail.forEach(t => { t.alpha -= 0.04; });

      // Background
      ctx.fillStyle = '#0a0014';
      ctx.fillRect(0, 0, W, H);

      // Walls
      ctx.fillStyle = '#2d1b69';
      ctx.fillRect(0, 0, W, topWall);
      ctx.fillRect(0, botWall, W, H - botWall);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8;
      ctx.shadowColor = ACCENT;
      ctx.beginPath(); ctx.moveTo(0, topWall); ctx.lineTo(W, topWall); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, botWall); ctx.lineTo(W, botWall); ctx.stroke();
      ctx.shadowBlur = 0;

      // Obstacles
      for (const obs of s.obstacles) {
        const obsX = obs.x - s.scrollX;
        ctx.fillStyle = '#5b21b6';
        ctx.shadowBlur = 12;
        ctx.shadowColor = ACCENT;
        ctx.fillRect(obsX - W * 0.025, topWall, W * 0.05, obs.topH * H - topWall);
        ctx.fillRect(obsX - W * 0.025, (1 - obs.botH) * H, W * 0.05, obs.botH * H - (H - botWall));
        ctx.shadowBlur = 0;
      }

      // Trail
      for (const t of s.trail) {
        ctx.globalAlpha = Math.max(0, t.alpha);
        ctx.fillStyle = ACCENT;
        ctx.beginPath();
        ctx.arc(t.x, t.y, ballR * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Ball
      ctx.shadowBlur = 20;
      ctx.shadowColor = ACCENT;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(W * 0.3, ballAbsY, ballR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(W * 0.3, ballAbsY, ballR * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Gravity direction indicator
      const arrowY = ballAbsY + (s.gravityDir > 0 ? ballR + 12 : -(ballR + 12));
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      if (s.gravityDir > 0) {
        ctx.moveTo(W * 0.3 - 8, arrowY - 6);
        ctx.lineTo(W * 0.3, arrowY + 6);
        ctx.lineTo(W * 0.3 + 8, arrowY - 6);
      } else {
        ctx.moveTo(W * 0.3 - 8, arrowY + 6);
        ctx.lineTo(W * 0.3, arrowY - 6);
        ctx.lineTo(W * 0.3 + 8, arrowY + 6);
      }
      ctx.fill();

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  const handleTap = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    s.gravityDir = s.gravityDir === 1 ? -1 : 1;
    s.ballVY *= 0.3;
    s.sig.flips++;
    sfx.click?.();
    haptic([20]);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      e.preventDefault();
      handleTap();
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
    setPlayerName(name);
    setPlayerAvatar(avatar);
    initAudio();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    setPhase('start');
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setFinalSig(null);
  }, []);

  const buildInsights = (sig: Signals) => [
    { label: 'Dodged',     value: `${sig.obstaclesDodged}`,  color: sig.obstaclesDodged >= 10 ? '#4ade80' : '#facc15' },
    { label: 'Flips',      value: `${sig.flips}`,            color: ACCENT },
    { label: 'Wall Hits',  value: `${sig.wallHits}`,         color: sig.wallHits <= 3 ? '#4ade80' : '#ef4444' },
    { label: 'Score',      value: `${sig.score}`,            color: 'var(--color-text)' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Flip It"
          accentColor={theme.colors.accent ?? ACCENT}
          onStart={handleStart}
        />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Gravity Flip game canvas" />
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
          didWin={finalSig.obstaclesDodged >= 15}
        />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}

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
      score: sig.score,
      flips: sig.flips,
      wallHits: sig.wallHits,
      obstaclesDodged: sig.obstaclesDodged,
    }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
