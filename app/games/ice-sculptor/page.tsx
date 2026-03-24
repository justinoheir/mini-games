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

const GAME_ID      = 'ice-sculptor';
const ACCENT       = '#93c5fd';
const DURATION     = 45;
const GAME_EMOJI   = '🧊';
const GAME_TITLE   = 'Ice Sculptor';
const GAME_TAGLINE = 'Tap rapidly to chip away ice and reveal the hidden shape.';

interface Signals {
  totalTaps: number;
  tapsPerSecond: number;
  maxTapBurst: number;    // max taps in any 2s window
  percentRevealed: number;
  streakCurrent: number;
  maxStreak: number;
  score: number;
}

function getPersonality(sig: Signals): string {
  if (sig.percentRevealed >= 90 && sig.tapsPerSecond >= 5)  return 'Master Sculptor 🗿';
  if (sig.maxTapBurst >= 15)                                 return 'Furious Chipper ⚡';
  if (sig.percentRevealed >= 75)                             return 'Detail Artist 🖌️';
  if (sig.tapsPerSecond >= 4)                                return 'Speed Tapper 🔨';
  return 'Block of Potential 🧊';
}

interface IceCell {
  revealed: boolean;
  alpha: number;  // 1 = full ice, 0 = fully revealed
  crackLevel: number;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  grid: IceCell[][];
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  hiddenShape: boolean[][];  // which cells are "the shape"
  accentColor: string;
  burstWindow: number[];
  lastTapTime: number;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

const SHAPE_PATTERNS = [
  // Star shape (simplified)
  (r: number, c: number, rows: number, cols: number) => {
    const cx = cols / 2, cy = rows / 2;
    const dx = c - cx, dy = r - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    const points = 5;
    const outer = Math.min(cols, rows) * 0.38;
    const inner = outer * 0.4;
    const sector = (2 * Math.PI) / points;
    const normalizedAngle = ((angle % sector) + sector) % sector;
    const threshold = inner + (outer - inner) * (1 - Math.abs(normalizedAngle / sector - 0.5) * 2);
    return dist <= threshold;
  },
  // Diamond
  (r: number, c: number, rows: number, cols: number) => {
    const cx = cols / 2, cy = rows / 2;
    return Math.abs(c - cx) / (cols * 0.35) + Math.abs(r - cy) / (rows * 0.35) <= 1;
  },
  // Heart approximation
  (r: number, c: number, rows: number, cols: number) => {
    const x = (c - cols / 2) / (cols * 0.3);
    const y = -(r - rows * 0.55) / (rows * 0.3);
    return (x * x + y * y - 1) ** 3 - x * x * y * y * y <= 0;
  },
];

export default function IceSculptorGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef<GameState>({
    running: false,
    timeLeft: DURATION,
    sig: { totalTaps: 0, tapsPerSecond: 0, maxTapBurst: 0, percentRevealed: 0, streakCurrent: 0, maxStreak: 0, score: 0 },
    grid: [],
    cols: 16,
    rows: 20,
    cellW: 0,
    cellH: 0,
    hiddenShape: [],
    accentColor: ACCENT,
    burstWindow: [],
    lastTapTime: 0,
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🧊');
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const initGrid = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const cols = 14;
    const rows = 18;
    s.cols = cols;
    s.rows = rows;
    s.cellW = canvas.width / cols;
    s.cellH = (canvas.height - 60) / rows;

    const patternFn = SHAPE_PATTERNS[Math.floor(Math.random() * SHAPE_PATTERNS.length)];
    s.hiddenShape = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => patternFn(r, c, rows, cols))
    );

    s.grid = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ revealed: false, alpha: 1, crackLevel: 0 }))
    );
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    // Calculate final percent revealed
    const totalCells = s.cols * s.rows;
    const revealed = s.grid.flat().filter(c => c.revealed).length;
    s.sig.percentRevealed = Math.round((revealed / totalCells) * 100);
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
    s.sig = { totalTaps: 0, tapsPerSecond: 0, maxTapBurst: 0, percentRevealed: 0, streakCurrent: 0, maxStreak: 0, score: 0 };
    s.burstWindow = [];
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');
    initGrid();
    stopMusicRef.current = startMusic('pulse');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      // Update TPS
      s.sig.tapsPerSecond = parseFloat((s.sig.totalTaps / Math.max(1, DURATION - s.timeLeft)).toFixed(1));
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width;
      const H = canvas.height;

      ctx.fillStyle = '#0a1628';
      ctx.fillRect(0, 0, W, H);

      // Draw revealed shape cells first
      for (let r = 0; r < s.rows; r++) {
        for (let c = 0; c < s.cols; c++) {
          const cell = s.grid[r]?.[c];
          if (!cell) continue;
          const x = c * s.cellW;
          const y = 60 + r * s.cellH;

          if (cell.revealed && s.hiddenShape[r]?.[c]) {
            // Glowing shape
            ctx.fillStyle = `rgba(147,197,253,0.3)`;
            ctx.fillRect(x, y, s.cellW, s.cellH);
            ctx.strokeStyle = '#93c5fd';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(x, y, s.cellW, s.cellH);
          } else if (!cell.revealed) {
            // Ice block
            const iceAlpha = cell.alpha;
            ctx.globalAlpha = iceAlpha;
            const iceBase = `rgba(180, 220, 255, ${0.7 * iceAlpha})`;
            ctx.fillStyle = iceBase;
            ctx.fillRect(x, y, s.cellW - 1, s.cellH - 1);

            // Crack lines
            if (cell.crackLevel >= 1) {
              ctx.strokeStyle = 'rgba(255,255,255,0.6)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(x + s.cellW * 0.2, y + s.cellH * 0.3);
              ctx.lineTo(x + s.cellW * 0.7, y + s.cellH * 0.8);
              ctx.stroke();
            }
            if (cell.crackLevel >= 2) {
              ctx.beginPath();
              ctx.moveTo(x + s.cellW * 0.6, y + s.cellH * 0.1);
              ctx.lineTo(x + s.cellW * 0.2, y + s.cellH * 0.7);
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }
        }
      }

      // Smooth reveal animation
      for (let r = 0; r < s.rows; r++) {
        for (let c = 0; c < s.cols; c++) {
          const cell = s.grid[r]?.[c];
          if (cell && !cell.revealed && cell.alpha < 1) {
            cell.alpha -= 0.05;
            if (cell.alpha <= 0) {
              cell.alpha = 0;
              cell.revealed = true;
            }
          }
        }
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, initGrid]);

  const handleTap = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    if (!s.running) return;

    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height) - 60;
    const col = Math.floor(x / s.cellW);
    const row = Math.floor(y / s.cellH);

    if (row < 0 || row >= s.rows || col < 0 || col >= s.cols) return;
    const cell = s.grid[row]?.[col];
    if (!cell || cell.revealed) return;

    cell.crackLevel++;
    s.sig.totalTaps++;

    // Track burst
    const now = Date.now();
    s.burstWindow = s.burstWindow.filter(t => now - t < 2000);
    s.burstWindow.push(now);
    if (s.burstWindow.length > s.sig.maxTapBurst) s.sig.maxTapBurst = s.burstWindow.length;

    if (cell.crackLevel >= 3) {
      cell.alpha = 0.9; // start fade
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const pts = s.hiddenShape[row]?.[col] ? 2 : 1;
      s.sig.score += pts;
      setScoreDisplay(s.sig.score);
      sfx.collect();
      haptic([30]);
    } else {
      s.sig.streakCurrent = 0;
      sfx.collision();
      haptic([20]);
    }

    s.lastTapTime = now;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = canvas.offsetWidth;
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
    { label: 'Revealed',    value: `${sig.percentRevealed}%`, color: sig.percentRevealed >= 75 ? '#4ade80' : '#facc15' },
    { label: 'Taps/sec',   value: `${sig.tapsPerSecond}`,    color: ACCENT },
    { label: 'Max Burst',  value: `${sig.maxTapBurst} taps`, color: ACCENT },
    { label: 'Total Taps', value: `${sig.totalTaps}`,        color: 'var(--color-text)' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Grab Chisel"
          accentColor={theme.colors.accent ?? ACCENT}
          onStart={handleStart}
        />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Ice Sculptor game canvas" />
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
          didWin={finalSig.percentRevealed >= 70}
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
      tapsPerSecond: sig.tapsPerSecond,
      maxTapBurst: sig.maxTapBurst,
      percentRevealed: sig.percentRevealed,
      totalTaps: sig.totalTaps,
    }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
