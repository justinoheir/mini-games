'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'shape-rotate';
const ACCENT = '#06b6d4';
const DURATION = 60;
const GAME_EMOJI = '🔷';
const GAME_TITLE = 'Shape Rotate';
const GAME_TAGLINE = 'Spin it in your mind. Match it.';

interface Signals {
  total: number;
  correct: number;
  wrong: number;
  avgReactionMs: number;
  totalMs: number;
  level: number;
  maxStreak: number;
  streakCurrent: number;
  score: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.total > 0 ? sig.correct / sig.total : 0;
  const avg = sig.total > 0 ? sig.totalMs / sig.total : 9999;
  if (acc >= 0.85 && avg < 1500) return 'Spatial Genius 🧠';
  if (sig.level >= 5) return 'Mental Rotator 🔷';
  if (acc >= 0.75) return 'Visual Thinker 👁️';
  if (avg < 2000) return 'Quick Visualizer ⚡';
  return 'Training Eye 🔮';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// Simple L-shaped, T-shaped, Z-shaped, S-shaped tetromino-style shapes
// Each shape is an array of [x, y] unit coords
const SHAPES = [
  [[0,0],[1,0],[1,1],[2,1]],  // S-shape
  [[0,1],[1,1],[1,0],[2,0]],  // Z-shape
  [[0,0],[0,1],[1,1],[2,1]],  // L-shape
  [[0,0],[1,0],[2,0],[2,1]],  // J-shape
  [[0,0],[1,0],[2,0],[1,1]],  // T-shape
  [[0,0],[1,0],[0,1],[1,1]],  // O-shape
];

function rotateShape(shape: number[][], angle: number): number[][] {
  const rad = angle * Math.PI / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  return shape.map(([x, y]) => [cos * x - sin * y, sin * x + cos * y]);
}

function normalizeShape(shape: number[][]): number[][] {
  const minX = Math.min(...shape.map(p => p[0]));
  const minY = Math.min(...shape.map(p => p[1]));
  return shape.map(([x, y]) => [x - minX, y - minY]);
}

function drawShape(ctx: CanvasRenderingContext2D, shape: number[][], cx: number, cy: number, cellSize: number, color: string, filled = true) {
  const norm = normalizeShape(shape);
  const maxX = Math.max(...norm.map(p => p[0]));
  const maxY = Math.max(...norm.map(p => p[1]));
  const offsetX = cx - (maxX + 1) * cellSize / 2;
  const offsetY = cy - (maxY + 1) * cellSize / 2;
  norm.forEach(([x, y]) => {
    const bx = offsetX + x * cellSize;
    const by = offsetY + y * cellSize;
    if (filled) {
      ctx.fillStyle = color + '88';
      ctx.fillRect(bx + 1, by + 1, cellSize - 2, cellSize - 2);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(bx + 1, by + 1, cellSize - 2, cellSize - 2);
  });
}

interface Question {
  shape: number[][];
  referenceAngle: number;
  options: Array<{ shape: number[][], angle: number, isCorrect: boolean }>;
}

function makeQuestion(level: number): Question {
  const baseShape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
  const refAngle = [0, 90, 180, 270][Math.floor(Math.random() * 4)];
  const refShape = normalizeShape(rotateShape(baseShape, refAngle));

  // Correct answer: same shape at different rotation
  const correctAngle = [0, 90, 180, 270].filter(a => a !== refAngle)[Math.floor(Math.random() * 3)];
  const correctShape = normalizeShape(rotateShape(baseShape, correctAngle));

  // Distractors: mirrored shapes or different shapes
  const wrongShapes = SHAPES
    .filter((_, i) => i !== SHAPES.indexOf(baseShape))
    .slice(0, level >= 3 ? 3 : 3)
    .map(s => normalizeShape(rotateShape(s, [0,90,180,270][Math.floor(Math.random()*4)])));

  const options = [
    { shape: correctShape, angle: correctAngle, isCorrect: true },
    { shape: wrongShapes[0] || normalizeShape(rotateShape(baseShape, 90)), angle: 0, isCorrect: false },
    { shape: wrongShapes[1] || normalizeShape(rotateShape(baseShape, 180)), angle: 0, isCorrect: false },
    { shape: wrongShapes[2] || normalizeShape(rotateShape(baseShape, 270)), angle: 0, isCorrect: false },
  ].sort(() => Math.random() - 0.5);

  return { shape: refShape, referenceAngle: refAngle, options };
}

interface GameState {
  running: boolean; timeLeft: number;
  sig: Signals; frame: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  question: Question | null;
  shownAt: number;
  feedback: number | null; // index of tapped option, null if waiting
  feedbackTimer: number;
  level: number;
}

export default function ShapeRotateGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { total: 0, correct: 0, wrong: 0, avgReactionMs: 0, totalMs: 0, level: 1, maxStreak: 0, streakCurrent: 0, score: 0 },
    frame: 0, accentColor: ACCENT, floats: [],
    question: null, shownAt: 0, feedback: null, feedbackTimer: 0, level: 1,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const nextQuestion = useCallback(() => {
    const s = stateRef.current;
    s.question = makeQuestion(s.level);
    s.shownAt = Date.now();
    s.feedback = null; s.feedbackTimer = 0;
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const pb = parseInt(localStorage.getItem('pb_' + GAME_ID) ?? '0');
    if (s.sig.score > pb) localStorage.setItem('pb_' + GAME_ID, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { total: 0, correct: 0, wrong: 0, avgReactionMs: 0, totalMs: 0, level: 1, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.frame = 0; s.floats = []; s.level = 1;
    nextQuestion();
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      s.frame++;

      if (s.feedbackTimer > 0) s.feedbackTimer--;

      // Background - abstract 3D space
      ctx.fillStyle = '#021218'; ctx.fillRect(0, 0, W, H);
      // Grid perspective lines
      ctx.strokeStyle = 'rgba(6,182,212,0.05)'; ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const x = (i / 7) * W;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(W / 2, H); ctx.stroke();
      }

      // Feedback flash
      if (s.feedback !== null && s.feedbackTimer > 0 && s.question) {
        const correct = s.question.options[s.feedback].isCorrect;
        ctx.fillStyle = correct ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)';
        ctx.fillRect(0, 0, W, H);
      }

      const q = s.question;
      if (!q) return;

      // Reference shape label
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('REFERENCE', W / 2, H * 0.1);

      // Draw reference shape (big, centered top)
      ctx.save();
      ctx.shadowBlur = 16; ctx.shadowColor = ACCENT;
      drawShape(ctx, q.shape, W / 2, H * 0.23, 22, ACCENT);
      ctx.restore();

      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Which rotation matches?', W / 2, H * 0.37);

      // Draw 4 options in 2x2 grid
      const optW = Math.min(W / 2 - 20, 130);
      const optH = Math.min(H * 0.22, 110);
      const gridX = (W - optW * 2 - 10) / 2;
      const gridY = H * 0.42;

      q.options.forEach((opt, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const bx = gridX + col * (optW + 10);
        const by = gridY + row * (optH + 10);
        const cx = bx + optW / 2, cy = by + optH / 2;

        let border = ACCENT;
        let bg = 'rgba(6,182,212,0.08)';
        if (s.feedback === i) {
          border = opt.isCorrect ? '#4ade80' : '#ef4444';
          bg = opt.isCorrect ? 'rgba(74,222,128,0.2)' : 'rgba(239,68,68,0.2)';
        } else if (s.feedback !== null && opt.isCorrect) {
          border = '#4ade80'; bg = 'rgba(74,222,128,0.1)';
        }

        ctx.save();
        ctx.fillStyle = bg; ctx.strokeStyle = border; ctx.lineWidth = 2;
        ctx.shadowBlur = 6; ctx.shadowColor = border;
        ctx.beginPath();
        (ctx as any).roundRect?.(bx, by, optW, optH, 8) ?? ctx.rect(bx, by, optW, optH);
        ctx.fill(); ctx.stroke();

        drawShape(ctx, opt.shape, cx, cy, 18, border);

        // Option label
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(String.fromCharCode(65 + i), bx + 12, by + 16);
        ctx.restore();
      });

      // Floats
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha;
        ctx.fillStyle = f.color; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.95;
      });

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, nextQuestion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.feedback !== null || !s.question) return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      const W = canvas.width, H = canvas.height;
      const optW = Math.min(W / 2 - 20, 130);
      const optH = Math.min(H * 0.22, 110);
      const gridX = (W - optW * 2 - 10) / 2;
      const gridY = H * 0.42;

      for (let i = 0; i < 4; i++) {
        const col = i % 2, row = Math.floor(i / 2);
        const bx = gridX + col * (optW + 10);
        const by = gridY + row * (optH + 10);
        if (px >= bx && px <= bx + optW && py >= by && py <= by + optH) {
          const ms = Date.now() - s.shownAt;
          s.sig.total++; s.sig.totalMs += ms;
          s.feedback = i; s.feedbackTimer = 18;

          if (s.question.options[i].isCorrect) {
            s.sig.correct++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const speedPts = ms < 1500 ? 3 : ms < 2500 ? 2 : 1;
            s.sig.score += speedPts; setScoreDisplay(s.sig.score);
            s.level = Math.min(6, 1 + Math.floor(s.sig.correct / 4));
            s.sig.level = s.level;
            sfx.collect(); hapticScore();
            if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
            s.floats.push({ x: W / 2, y: H * 0.35, text: `+${speedPts}${ms < 1500 ? ' ⚡' : ''}`, alpha: 1, vy: -2.5, color: '#fbbf24' });
          } else {
            s.sig.wrong++; s.sig.streakCurrent = 0;
            sfx.collision(); hapticFail();
          }
          setTimeout(() => { if (s.running) nextQuestion(); }, 600);
          break;
        }
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase, nextQuestion]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Mentally rotate the shape and tap its matching version!" ctaLabel="Rotate! 🔷" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Shape Rotate game canvas" />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Accuracy', value: `${finalSig.total > 0 ? Math.round(finalSig.correct / finalSig.total * 100) : 0}%`, color: ACCENT },
            { label: 'Avg Speed', value: `${finalSig.total > 0 ? Math.round(finalSig.totalMs / finalSig.total) : 0}ms`, color: '#fbbf24' },
            { label: 'Level Reached', value: String(finalSig.level), color: '#4ade80' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.correct >= 10} />
      )}
    </GameShell>
  );
}
