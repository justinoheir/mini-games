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

const GAME_ID      = 'pulse-jump';
const ACCENT       = '#a855f7';
const DURATION     = 60;
const GAME_EMOJI   = '💫';
const GAME_TITLE   = 'Pulse Jump';
const GAME_TAGLINE = 'Tap in rhythm with the beat. Miss the pulse — fall!';

const BPM = 90;
const BEAT_MS = (60 / BPM) * 1000;

interface Obstacle { x: number; width: number; height: number; passed: boolean; }

interface Signals {
  totalBeats: number;
  beatsHit: number;
  beatsMissed: number;
  maxStreak: number;
  streakCurrent: number;
  score: number;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  charY: number;
  charVY: number;
  isGrounded: boolean;
  obstacles: Obstacle[];
  beatPhase: number;  // 0..1 within a beat cycle
  lastBeatTime: number;
  nextBeatTime: number;
  beatWindow: boolean;
  gameSpeed: number;
  groundY: number;
  accentColor: string;
  particles: Array<{x:number;y:number;vx:number;vy:number;alpha:number;color:string}>;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const acc = sig.totalBeats > 0 ? sig.beatsHit / sig.totalBeats : 0;
  if (acc >= 0.85 && sig.maxStreak >= 10) return 'Rhythm God 🎵';
  if (acc >= 0.70) return 'Beat Keeper 🥁';
  if (sig.maxStreak >= 8) return 'Streak Surfer 🌊';
  if (sig.beatsHit >= 20) return 'Persistent Hopper 🐇';
  return 'Off-Beat Explorer 🎲';
}

export default function PulseJumpGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const beatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalBeats: 0, beatsHit: 0, beatsMissed: 0, maxStreak: 0, streakCurrent: 0, score: 0 },
    charY: 0, charVY: 0, isGrounded: true,
    obstacles: [], beatPhase: 0, lastBeatTime: 0,
    nextBeatTime: 0, beatWindow: false,
    gameSpeed: 3, groundY: 0, accentColor: ACCENT, particles: [],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [beatPulse, setBeatPulse] = useState(false);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('💫');
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const doJump = useCallback(() => {
    const s = stateRef.current;
    if (!s.running || !s.isGrounded) return;
    const now = Date.now();
    const timeToBeat = Math.abs(now - s.nextBeatTime);
    const onBeat = timeToBeat < 200;

    s.charVY = -14;
    s.isGrounded = false;

    if (onBeat) {
      s.sig.beatsHit++;
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const pts = s.sig.streakCurrent >= 3 ? 2 : 1;
      s.sig.score += pts;
      setScoreDisplay(s.sig.score);
      sfx.collect();
      haptic([30]);
      // Spawn particles
      const canvas = canvasRef.current;
      if (canvas) {
        for (let i = 0; i < 8; i++) {
          s.particles.push({ x: 60, y: s.groundY - 30, vx: (Math.random()-0.5)*4, vy: -2-Math.random()*3,
            alpha: 1, color: ACCENT });
        }
      }
    } else {
      s.sig.beatsMissed++;
      s.sig.streakCurrent = 0;
      sfx.collision();
      haptic([20, 30, 20]);
    }
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (beatRef.current) { clearInterval(beatRef.current); beatRef.current = null; }
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

    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalBeats: 0, beatsHit: 0, beatsMissed: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.charY = 0; s.charVY = 0; s.isGrounded = true;
    s.obstacles = []; s.gameSpeed = 3; s.particles = [];
    s.groundY = canvas.height - 60;
    s.nextBeatTime = Date.now() + BEAT_MS;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    // Beat metronome
    beatRef.current = setInterval(() => {
      if (!s.running) return;
      s.sig.totalBeats++;
      s.nextBeatTime = Date.now() + BEAT_MS;
      setBeatPulse(p => !p);
      // Spawn obstacle occasionally
      if (Math.random() < 0.4) {
        s.obstacles.push({ x: canvas.width + 20, width: 18 + Math.random() * 20,
          height: 30 + Math.random() * 40, passed: false });
      }
      s.gameSpeed = Math.min(8, 3 + s.sig.totalBeats * 0.05);
    }, BEAT_MS);

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const GRAVITY = 0.6;
    const loop = () => {
      if (!s.running) return;
      const W = canvas.width; const H = canvas.height;
      s.groundY = H - 60;

      ctx.fillStyle = '#0d0d1a';
      ctx.fillRect(0, 0, W, H);

      // Stars bg
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      for (let i = 0; i < 30; i++) {
        const sx = (i * 137 + s.sig.score * 2) % W;
        const sy = (i * 79) % (H - 80);
        ctx.fillRect(sx, sy, 1, 1);
      }

      // Beat pulse ring
      const beatFrac = Math.max(0, 1 - (Date.now() - (s.nextBeatTime - BEAT_MS)) / (BEAT_MS * 0.3));
      if (beatFrac > 0) {
        ctx.save();
        ctx.globalAlpha = beatFrac * 0.3;
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(60, s.groundY - 25, 35 + (1 - beatFrac) * 20, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Ground
      ctx.fillStyle = '#1e1b4b';
      ctx.fillRect(0, s.groundY, W, H - s.groundY);
      ctx.fillStyle = ACCENT + '44';
      ctx.fillRect(0, s.groundY, W, 2);

      // Physics
      if (!s.isGrounded) {
        s.charVY += GRAVITY;
        s.charY += s.charVY;
        if (s.charY >= 0) { s.charY = 0; s.charVY = 0; s.isGrounded = true; }
      }
      const charScreenY = s.groundY - 25 + s.charY;

      // Obstacles
      s.obstacles = s.obstacles.filter(o => o.x > -50);
      for (const obs of s.obstacles) {
        obs.x -= s.gameSpeed;
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        const ox = obs.x; const oy = s.groundY - obs.height;
        ctx.fillRect(ox, oy, obs.width, obs.height);
        // Collision
        if (!obs.passed && Math.abs(ox - 60) < obs.width / 2 + 12 && charScreenY + 25 > oy) {
          obs.passed = true;
          s.sig.streakCurrent = 0;
          sfx.fail();
          haptic([20, 30, 20]);
        }
        if (obs.x + obs.width < 60 && !obs.passed) obs.passed = true;
      }

      // Particles
      s.particles = s.particles.filter(p => p.alpha > 0.05);
      for (const p of s.particles) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.alpha -= 0.03;
        ctx.save(); ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      // Character
      ctx.save();
      ctx.shadowBlur = 20; ctx.shadowColor = ACCENT;
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(60, charScreenY, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('💫', 60, charScreenY);
      ctx.restore();

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);
    const onPointerDown = () => { if (phase === 'playing') doJump(); };
    canvas.addEventListener('pointerdown', onPointerDown);
    return () => { window.removeEventListener('resize', resize); canvas.removeEventListener('pointerdown', onPointerDown); };
  }, [phase, doJump]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (beatRef.current) clearInterval(beatRef.current);
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
    const acc = sig.totalBeats > 0 ? Math.round((sig.beatsHit / sig.totalBeats) * 100) : 0;
    return [
      { label: 'Beat Accuracy', value: `${acc}%`, color: acc >= 70 ? '#4ade80' : acc >= 40 ? '#facc15' : '#ef4444' },
      { label: 'Best Streak',   value: `×${sig.maxStreak}`, color: ACCENT },
      { label: 'Beats Hit',     value: `${sig.beatsHit}`, color: ACCENT },
      { label: 'Missed',        value: `${sig.beatsMissed}`, color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Feel the Beat" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} role="img" aria-label="Pulse jump rhythm game"
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
          onPlayAgain={handlePlayAgain} didWin={finalSig.beatsHit >= 15} />
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
    const acc = sig.totalBeats > 0 ? sig.beatsHit / sig.totalBeats : 0;
    postWebhook(theme, gameId, { personality, score: sig.score, beatAccuracy: parseFloat(acc.toFixed(3)),
      beatsHit: sig.beatsHit, beatsMissed: sig.beatsMissed, maxStreak: sig.maxStreak }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
