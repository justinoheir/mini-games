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

const GAME_ID      = 'frog-leap';
const ACCENT       = '#22c55e';
const DURATION     = 45;
const GAME_EMOJI   = '🐸';
const GAME_TITLE   = 'Frog Leap';
const GAME_TAGLINE = 'Tap left/right to leap to lily pads. Miss = splash!';

interface LilyPad { x: number; y: number; width: number; id: number; sinking: boolean; sinkTimer: number; }

interface Signals {
  totalLeaps: number;
  successfulLeaps: number;
  splashes: number;
  maxStreak: number;
  score: number;
  streakCurrent: number;
  longestReach: number;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  frogX: number;
  frogY: number;
  frogVX: number;
  frogVY: number;
  frogOnPad: boolean;
  currentPadId: number;
  pads: LilyPad[];
  leaping: boolean;
  leapTarget: { x: number; y: number } | null;
  gameSpeed: number;
  padWidth: number;
  accentColor: string;
  splashParticles: Array<{x:number;y:number;vx:number;vy:number;alpha:number}>;
  ripples: Array<{x:number;y:number;r:number;alpha:number}>;
  nextPadId: number;
  riverY: number;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const acc = sig.totalLeaps > 0 ? sig.successfulLeaps / sig.totalLeaps : 0;
  if (acc >= 0.85 && sig.maxStreak >= 10) return 'Lily King 👑';
  if (acc >= 0.75) return 'Sure-Footed Leaper 🎯';
  if (sig.maxStreak >= 8) return 'Streak Hopper 🏃';
  if (sig.successfulLeaps >= 15) return 'Distance Jumper 🦘';
  return 'Splash Artist 💦';
}

export default function FrogLeapGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalLeaps: 0, successfulLeaps: 0, splashes: 0, maxStreak: 0, score: 0, streakCurrent: 0, longestReach: 0 },
    frogX: 0, frogY: 0, frogVX: 0, frogVY: 0, frogOnPad: true,
    currentPadId: 0, pads: [], leaping: false, leapTarget: null,
    gameSpeed: 1, padWidth: 60, accentColor: ACCENT,
    splashParticles: [], ripples: [], nextPadId: 0, riverY: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🐸');
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const spawnPad = useCallback((W: number, H: number, afterX: number): LilyPad => {
    const s = stateRef.current;
    const gap = 55 + Math.random() * 40;
    const x = afterX + gap;
    const y = H * 0.5 + (Math.random() - 0.5) * H * 0.25;
    const width = Math.max(25, s.padWidth);
    return { x, y, width, id: s.nextPadId++, sinking: false, sinkTimer: 0 };
  }, []);

  const doLeap = useCallback((direction: 'left' | 'right') => {
    const s = stateRef.current;
    if (!s.running || s.leaping) return;

    // Find nearest pad in that direction
    const candidates = s.pads.filter(p => {
      if (p.id === s.currentPadId) return false;
      if (direction === 'right' && p.x > s.frogX) return true;
      if (direction === 'left' && p.x < s.frogX) return true;
      return false;
    });

    if (candidates.length === 0) return;
    const target = candidates.reduce((best, c) => {
      return Math.abs(c.x - s.frogX) < Math.abs(best.x - s.frogX) ? c : best;
    });

    s.sig.totalLeaps++;
    s.leaping = true;
    s.leapTarget = { x: target.x, y: target.y };
    s.frogVX = (target.x - s.frogX) * 0.08;
    s.frogVY = -8;
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

    const W = canvas.width; const H = canvas.height;
    s.riverY = H * 0.35;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalLeaps: 0, successfulLeaps: 0, splashes: 0, maxStreak: 0, score: 0, streakCurrent: 0, longestReach: 0 };
    s.leaping = false; s.leapTarget = null; s.gameSpeed = 1; s.padWidth = 60;
    s.splashParticles = []; s.ripples = []; s.nextPadId = 0;

    // Build initial pads
    s.pads = [{ x: W * 0.3, y: H * 0.5, width: 60, id: s.nextPadId++, sinking: false, sinkTimer: 0 }];
    for (let i = 0; i < 4; i++) {
      s.pads.push(spawnPad(W, H, s.pads[s.pads.length - 1].x));
    }
    s.frogX = s.pads[0].x; s.frogY = s.pads[0].y - 15;
    s.currentPadId = s.pads[0].id; s.frogOnPad = true;

    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('chill');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      s.padWidth = Math.max(20, 60 - (DURATION - s.timeLeft) * 0.7);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const GRAVITY = 0.5;
    const loop = () => {
      if (!s.running) return;
      const W = canvas.width; const H = canvas.height;

      // River background
      ctx.fillStyle = '#0c3547';
      ctx.fillRect(0, 0, W, H);
      // Sky
      ctx.fillStyle = '#0d4f2e';
      ctx.fillRect(0, 0, W, H * 0.3);
      // Water shimmer
      ctx.fillStyle = 'rgba(6,182,212,0.08)';
      for (let i = 0; i < 8; i++) {
        const wx = (i * 137 + Date.now() * 0.02) % W;
        ctx.fillRect(wx, H * 0.3, 60, 3);
      }

      // Scroll pads left
      for (const pad of s.pads) pad.x -= s.gameSpeed;
      if (s.frogOnPad) s.frogX -= s.gameSpeed;

      // Spawn new pads on right
      const lastPad = s.pads[s.pads.length - 1];
      if (lastPad && lastPad.x < W) {
        s.pads.push(spawnPad(W, H, lastPad.x));
        s.gameSpeed = Math.min(3.5, 1 + s.sig.successfulLeaps * 0.05);
      }
      s.pads = s.pads.filter(p => p.x > -100);

      // Sinking pads
      for (const pad of s.pads) {
        if (pad.sinking) {
          pad.sinkTimer++;
          pad.y += 0.5;
          if (pad.sinkTimer > 60) {
            s.pads = s.pads.filter(p => p.id !== pad.id);
          }
        }
      }

      // Draw pads
      for (const pad of s.pads) {
        const alpha = pad.sinking ? Math.max(0, 1 - pad.sinkTimer / 60) : 1;
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.fillStyle = '#16a34a';
        ctx.shadowBlur = 8; ctx.shadowColor = '#4ade80';
        ctx.beginPath();
        ctx.ellipse(pad.x, pad.y, pad.width / 2, pad.width / 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      // Physics when leaping
      if (s.leaping) {
        s.frogVY += GRAVITY;
        s.frogX += s.frogVX;
        s.frogY += s.frogVY;

        // Check if landed on pad
        let landed = false;
        for (const pad of s.pads) {
          if (s.frogVY > 0 && Math.abs(s.frogX - pad.x) < pad.width / 2 + 5
              && Math.abs(s.frogY - pad.y) < 20) {
            s.frogX = pad.x; s.frogY = pad.y - 15;
            s.frogVX = 0; s.frogVY = 0;
            s.leaping = false; s.frogOnPad = true;
            s.currentPadId = pad.id;
            s.sig.successfulLeaps++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const pts = s.sig.streakCurrent >= 3 ? 2 : 1;
            s.sig.score += pts;
            setScoreDisplay(s.sig.score);
            sfx.collect(); haptic([30]);
            // Sink pad after a while
            setTimeout(() => { pad.sinking = true; }, 800);
            landed = true; break;
          }
        }

        // Fell into river
        if (!landed && s.frogY > H * 0.75) {
          s.leaping = false; s.frogOnPad = false;
          s.sig.splashes++;
          s.sig.streakCurrent = 0;
          sfx.fail(); haptic([20, 30, 20]);
          // Splash particles
          for (let i = 0; i < 12; i++) {
            s.splashParticles.push({ x: s.frogX, y: s.frogY,
              vx: (Math.random()-0.5)*4, vy: -2-Math.random()*3, alpha: 1 });
          }
          s.ripples.push({ x: s.frogX, y: s.frogY, r: 5, alpha: 0.8 });
          // Respawn on nearest pad
          const nearest = s.pads.filter(p => !p.sinking).reduce((best, c) =>
            c.x > 50 && c.x < W - 50 && Math.abs(c.x - W/2) < Math.abs(best.x - W/2) ? c : best, s.pads[0] ?? { x: W/2, y: H*0.5, width: 60, id: -1, sinking: false, sinkTimer: 0 });
          if (nearest) {
            setTimeout(() => {
              if (!s.running) return;
              s.frogX = nearest.x; s.frogY = nearest.y - 15;
              s.frogOnPad = true; s.currentPadId = nearest.id;
            }, 600);
          }
        }
      }

      // Splash particles
      s.splashParticles = s.splashParticles.filter(p => p.alpha > 0.05);
      for (const p of s.splashParticles) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.alpha -= 0.04;
        ctx.save(); ctx.globalAlpha = p.alpha;
        ctx.fillStyle = '#7dd3fc';
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      // Ripples
      s.ripples = s.ripples.filter(r => r.alpha > 0.05);
      for (const r of s.ripples) {
        r.r += 2; r.alpha -= 0.03;
        ctx.save(); ctx.globalAlpha = r.alpha;
        ctx.strokeStyle = '#7dd3fc'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }

      // Draw frog
      if (s.frogOnPad || s.leaping) {
        ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('🐸', s.frogX, s.frogY + 8);
      }

      // Streak display
      if (s.sig.streakCurrent >= 3) {
        ctx.fillStyle = ACCENT;
        ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`×${s.sig.streakCurrent} STREAK!`, W / 2, H * 0.15);
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnPad]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const dir = x < rect.width / 2 ? 'left' : 'right';
      doLeap(dir);
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    return () => { window.removeEventListener('resize', resize); canvas.removeEventListener('pointerdown', onPointerDown); };
  }, [phase, doLeap]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    setPlayerName(name); setPlayerAvatar(avatar);
    initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const buildInsights = (sig: Signals) => {
    const acc = sig.totalLeaps > 0 ? Math.round((sig.successfulLeaps / sig.totalLeaps) * 100) : 0;
    return [
      { label: 'Landing Rate',  value: `${acc}%`,              color: acc >= 75 ? '#4ade80' : '#facc15' },
      { label: 'Best Streak',   value: `×${sig.maxStreak}`,     color: ACCENT },
      { label: 'Leaps Made',    value: `${sig.successfulLeaps}`, color: ACCENT },
      { label: 'Splashes',      value: `${sig.splashes}`,        color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Hop In" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} role="img" aria-label="Frog leap river game"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME', value: timeLeft, danger: timeLeft <= 5 },
              { label: 'SCORE', value: scoreDisplay },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain} didWin={finalSig.successfulLeaps >= 10} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig}
          personality={getPersonality(finalSig)} player={playerSessionRef.current} />
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
    const acc = sig.totalLeaps > 0 ? sig.successfulLeaps / sig.totalLeaps : 0;
    postWebhook(theme, gameId, { personality, score: sig.score, landingRate: parseFloat(acc.toFixed(3)),
      successfulLeaps: sig.successfulLeaps, splashes: sig.splashes, maxStreak: sig.maxStreak }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
