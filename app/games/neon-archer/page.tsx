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

const GAME_ID      = 'neon-archer';
const ACCENT       = '#00ffcc';
const DURATION     = 60;
const GAME_EMOJI   = '🏹';
const GAME_TITLE   = 'Neon Archer';
const GAME_TAGLINE = 'Swipe to aim, release at the perfect moment to hit moving targets.';

interface Signals {
  totalShots: number;
  hits: number;
  perfectShots: number;   // hit within 100px of center
  maxStreak: number;
  streakCurrent: number;
  score: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.totalShots > 0 ? sig.hits / sig.totalShots : 0;
  if (sig.perfectShots >= 5 && acc >= 0.7)    return 'Sniper 🎯';
  if (sig.maxStreak >= 5)                       return 'Hot Streak 🔥';
  if (acc >= 0.6 && sig.totalShots >= 10)       return 'Steady Aim 🏹';
  if (sig.totalShots >= 15 && acc < 0.4)        return 'Wild Shot 💨';
  return 'Beginner Archer 🌱';
}

interface Target {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  ring: number; // 1 (outer) to 3 (bull)
}

interface Arrow {
  x: number;
  y: number;
  vx: number;
  vy: number;
  active: boolean;
  alpha: number;
}

interface AimState {
  active: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  targets: Target[];
  arrows: Arrow[];
  aim: AimState;
  accentColor: string;
  spawnTimer: number;
  difficultyLevel: number;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

export default function NeonArcherGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef<GameState>({
    running: false,
    timeLeft: DURATION,
    sig: { totalShots: 0, hits: 0, perfectShots: 0, maxStreak: 0, streakCurrent: 0, score: 0 },
    targets: [],
    arrows: [],
    aim: { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 },
    accentColor: ACCENT,
    spawnTimer: 0,
    difficultyLevel: 1,
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🏹');
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const spawnTarget = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const side = Math.floor(Math.random() * 4);
    let x = 0, y = 0, vx = 0, vy = 0;
    const speed = 1.5 + s.difficultyLevel * 0.4;
    if (side === 0) { x = -40; y = 80 + Math.random() * (canvas.height - 160); vx = speed; vy = (Math.random() - 0.5) * speed; }
    else if (side === 1) { x = canvas.width + 40; y = 80 + Math.random() * (canvas.height - 160); vx = -speed; vy = (Math.random() - 0.5) * speed; }
    else if (side === 2) { x = 40 + Math.random() * (canvas.width - 80); y = -40; vx = (Math.random() - 0.5) * speed; vy = speed; }
    else { x = 40 + Math.random() * (canvas.width - 80); y = canvas.height + 40; vx = (Math.random() - 0.5) * speed; vy = -speed; }
    s.targets.push({ x, y, vx, vy, radius: 28, ring: 3 });
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
    s.sig = { totalShots: 0, hits: 0, perfectShots: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.targets = [];
    s.arrows = [];
    s.aim = { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 };
    s.spawnTimer = 0;
    s.difficultyLevel = 1;
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      s.difficultyLevel = 1 + Math.floor((DURATION - s.timeLeft) / 15);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    spawnTarget();

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width;
      const H = canvas.height;

      ctx.fillStyle = '#030818';
      ctx.fillRect(0, 0, W, H);

      // Neon grid
      ctx.strokeStyle = 'rgba(0,255,204,0.04)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 50) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
      for (let gy = 0; gy < H; gy += 50) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

      s.spawnTimer++;
      const spawnInterval = Math.max(60, 120 - s.difficultyLevel * 15);
      if (s.spawnTimer >= spawnInterval) { s.spawnTimer = 0; spawnTarget(); }

      // Update & draw targets
      s.targets = s.targets.filter(t => {
        t.x += t.vx;
        t.y += t.vy;
        if (t.x < -80 || t.x > W + 80 || t.y < -80 || t.y > H + 80) return false;

        // Draw concentric rings
        const colors = ['rgba(0,255,204,0.2)', 'rgba(0,255,204,0.5)', '#00ffcc'];
        for (let r = 3; r >= 1; r--) {
          ctx.beginPath();
          ctx.arc(t.x, t.y, t.radius * r / 1.5, 0, Math.PI * 2);
          ctx.strokeStyle = colors[r - 1];
          ctx.lineWidth = 2;
          ctx.shadowBlur = 10;
          ctx.shadowColor = ACCENT;
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
        return true;
      });

      // Update & draw arrows
      s.arrows = s.arrows.filter(a => {
        if (!a.active) return false;
        a.x += a.vx;
        a.y += a.vy;
        a.alpha = Math.max(0, a.alpha - 0.01);
        if (a.alpha <= 0 || a.x < -50 || a.x > W + 50 || a.y < -50 || a.y > H + 50) return false;

        ctx.save();
        ctx.globalAlpha = a.alpha;
        ctx.strokeStyle = '#fffaaa';
        ctx.lineWidth = 3;
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#fffaaa';
        ctx.beginPath();
        ctx.moveTo(a.x - a.vx * 6, a.y - a.vy * 6);
        ctx.lineTo(a.x, a.y);
        ctx.stroke();
        ctx.restore();
        return true;
      });

      // Draw aim indicator
      if (s.aim.active) {
        const dx = s.aim.startX - s.aim.currentX;
        const dy = s.aim.startY - s.aim.currentY;
        const len = Math.min(Math.sqrt(dx * dx + dy * dy), 120);
        const angle = Math.atan2(dy, dx);

        // Trajectory dots
        ctx.save();
        const speed = len * 0.12;
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;
        for (let i = 1; i <= 8; i++) {
          const tx = s.aim.startX + vx * i * 0.5;
          const ty = s.aim.startY + vy * i * 0.5;
          ctx.globalAlpha = (1 - i / 10) * 0.8;
          ctx.fillStyle = ACCENT;
          ctx.beginPath();
          ctx.arc(tx, ty, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        // Bow icon at start
        ctx.save();
        ctx.translate(s.aim.startX, s.aim.startY);
        ctx.rotate(angle + Math.PI / 2);
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 12;
        ctx.shadowColor = ACCENT;
        ctx.beginPath();
        ctx.arc(0, 0, 20, -Math.PI * 0.6, Math.PI * 0.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -20);
        ctx.lineTo(0, 20);
        ctx.stroke();
        ctx.restore();
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnTarget]);

  const fireArrow = useCallback((fromX: number, fromY: number, toX: number, toY: number) => {
    const s = stateRef.current;
    if (!s.running) return;

    const dx = fromX - toX;
    const dy = fromY - toY;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 10) return;

    const speed = Math.min(len * 0.12, 18);
    const nx = dx / len;
    const ny = dy / len;
    const arrow: Arrow = { x: fromX, y: fromY, vx: nx * speed, vy: ny * speed, active: true, alpha: 1 };
    s.arrows.push(arrow);
    s.sig.totalShots++;

    // Check hits
    let hit = false;
    s.targets = s.targets.filter(t => {
      if (hit) return true;
      const ddx = arrow.x - t.x;
      const ddy = arrow.y - t.y;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dist <= t.radius * 2) {
        hit = true;
        s.sig.hits++;
        s.sig.streakCurrent++;
        if (dist <= t.radius * 0.8) s.sig.perfectShots++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const pts = s.sig.streakCurrent >= 3 ? 3 : dist <= t.radius * 0.8 ? 2 : 1;
        s.sig.score += pts;
        setScoreDisplay(s.sig.score);
        sfx.collect();
        haptic([30]);
        arrow.active = false;
        return false;
      }
      return true;
    });

    if (!hit) {
      s.sig.streakCurrent = 0;
      sfx.collision();
      haptic([20, 30, 20]);
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
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);
      const s = stateRef.current;
      s.aim = { active: true, startX: x, startY: y, currentX: x, currentY: y };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.aim.active) return;
      const rect = canvas.getBoundingClientRect();
      s.aim.currentX = (e.clientX - rect.left) * (canvas.width / rect.width);
      s.aim.currentY = (e.clientY - rect.top) * (canvas.height / rect.height);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.aim.active) return;
      const rect = canvas.getBoundingClientRect();
      const upX = (e.clientX - rect.left) * (canvas.width / rect.width);
      const upY = (e.clientY - rect.top) * (canvas.height / rect.height);
      fireArrow(s.aim.startX, s.aim.startY, upX, upY);
      s.aim.active = false;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [phase, fireArrow]);

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

  const buildInsights = (sig: Signals) => {
    const acc = sig.totalShots > 0 ? Math.round((sig.hits / sig.totalShots) * 100) : 0;
    return [
      { label: 'Accuracy',      value: `${acc}%`,             color: acc >= 70 ? '#4ade80' : acc >= 40 ? '#facc15' : '#ef4444' },
      { label: 'Perfect Shots', value: `${sig.perfectShots}`, color: ACCENT },
      { label: 'Best Streak',   value: `×${sig.maxStreak}`,   color: ACCENT },
      { label: 'Total Shots',   value: `${sig.totalShots}`,   color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Nock Arrow"
          accentColor={theme.colors.accent ?? ACCENT}
          onStart={handleStart}
        />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Neon Archer game canvas" />
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
          didWin={finalSig.hits >= 8}
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
    const acc = sig.totalShots > 0 ? sig.hits / sig.totalShots : 0;
    postWebhook(theme, gameId, {
      personality,
      score: sig.score,
      accuracy: parseFloat(acc.toFixed(3)),
      totalShots: sig.totalShots,
      hits: sig.hits,
      perfectShots: sig.perfectShots,
      maxStreak: sig.maxStreak,
    }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
