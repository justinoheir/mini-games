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

const GAME_ID = 'odd-one-out';
const ACCENT = '#f97316';
const DURATION = 45;
const GAME_EMOJI = '🔍';
const GAME_TITLE = 'Odd One Out';
const GAME_TAGLINE = "Spot what doesn't belong. Quick!";

interface Signals {
  total: number;
  correct: number;
  wrong: number;
  avgReactionMs: number;
  totalMs: number;
  hardestLevel: number;
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.total > 0 ? sig.correct / sig.total : 0;
  const avg = sig.total > 0 ? sig.totalMs / sig.total : 9999;
  if (acc >= 0.9 && avg < 800) return 'Pattern Master 🔍';
  if (sig.hardestLevel >= 5) return 'Detail Detective 🕵️';
  if (acc >= 0.8) return 'Sharp Observer 👁️';
  if (avg < 1000) return 'Fast Finder ⚡';
  return 'Training Vision 🔮';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// Each puzzle: grid of items where one is different
// Difference types: color, shape, size, rotation, count

type DiffType = 'color' | 'shape' | 'rotation' | 'size';

interface Item {
  x: number; y: number;
  shape: string; // 'circle' | 'square' | 'triangle' | 'diamond'
  color: string;
  size: number;
  rotation: number;
  isOdd: boolean;
}

const SHAPES = ['circle', 'square', 'triangle', 'diamond'];
const COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#a855f7', '#f97316'];

function makePuzzle(W: number, H: number, level: number): { items: Item[], diffType: DiffType } {
  const count = 4 + Math.min(level * 2, 12);
  const oddIdx = Math.floor(Math.random() * count);
  const diffTypes: DiffType[] = ['color', 'shape', 'rotation', 'size'];
  const diffType = diffTypes[Math.floor(Math.random() * (level >= 3 ? 4 : 2))];

  const baseShape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
  const baseColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  const baseSize = 22;
  const baseRotation = 0;

  const margin = 45;
  const gridCols = Math.ceil(Math.sqrt(count));
  const cellW = (W - margin * 2) / gridCols;
  const rows = Math.ceil(count / gridCols);
  const cellH = Math.min((H * 0.65 - 60) / rows, cellW);

  const items: Item[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % gridCols;
    const row = Math.floor(i / gridCols);
    const x = margin + cellW * col + cellW / 2;
    const y = H * 0.3 + cellH * row + cellH / 2;

    let shape = baseShape, color = baseColor, size = baseSize, rotation = baseRotation;
    if (i === oddIdx) {
      if (diffType === 'color') {
        color = COLORS.filter(c => c !== baseColor)[Math.floor(Math.random() * 5)];
      } else if (diffType === 'shape') {
        shape = SHAPES.filter(s => s !== baseShape)[Math.floor(Math.random() * 3)];
      } else if (diffType === 'rotation') {
        rotation = 45 + Math.floor(Math.random() * 3) * 30;
      } else if (diffType === 'size') {
        size = baseSize * 1.8;
      }
    }
    items.push({ x, y, shape, color, size, rotation, isOdd: i === oddIdx });
  }
  return { items, diffType };
}

function drawItem(ctx: CanvasRenderingContext2D, item: Item) {
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.rotate(item.rotation * Math.PI / 180);
  ctx.fillStyle = item.color + '44';
  ctx.strokeStyle = item.color;
  ctx.lineWidth = 2;

  if (item.shape === 'circle') {
    ctx.beginPath(); ctx.arc(0, 0, item.size, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else if (item.shape === 'square') {
    ctx.fillRect(-item.size, -item.size, item.size * 2, item.size * 2);
    ctx.strokeRect(-item.size, -item.size, item.size * 2, item.size * 2);
  } else if (item.shape === 'triangle') {
    ctx.beginPath(); ctx.moveTo(0, -item.size); ctx.lineTo(item.size, item.size); ctx.lineTo(-item.size, item.size); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (item.shape === 'diamond') {
    ctx.beginPath(); ctx.moveTo(0, -item.size); ctx.lineTo(item.size, 0); ctx.lineTo(0, item.size); ctx.lineTo(-item.size, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

interface GameState {
  running: boolean; timeLeft: number;
  sig: Signals; frame: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  items: Item[];
  diffType: DiffType;
  shownAt: number;
  feedback: boolean | null;
  feedbackTimer: number;
  level: number;
  selectedIdx: number;
}

export default function OddOneOutGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { total: 0, correct: 0, wrong: 0, avgReactionMs: 0, totalMs: 0, hardestLevel: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    frame: 0, accentColor: ACCENT, floats: [],
    items: [], diffType: 'color', shownAt: 0, feedback: null, feedbackTimer: 0, level: 1, selectedIdx: -1,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const nextPuzzle = useCallback(() => {
    const s = stateRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const p = makePuzzle(canvas.width, canvas.height, s.level);
    s.items = p.items;
    s.diffType = p.diffType;
    s.shownAt = Date.now();
    s.feedback = null; s.feedbackTimer = 0; s.selectedIdx = -1;
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
    s.sig = { total: 0, correct: 0, wrong: 0, avgReactionMs: 0, totalMs: 0, hardestLevel: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.frame = 0; s.floats = []; s.level = 1;
    nextPuzzle();
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

      // Background - warm dark
      ctx.fillStyle = '#0f0803'; ctx.fillRect(0, 0, W, H);
      // Subtle pattern
      for (let i = 0; i < 20; i++) {
        ctx.fillStyle = `rgba(249,115,22,0.03)`;
        ctx.beginPath(); ctx.arc((i * 61 + s.frame * 0.1) % W, (i * 37 + s.frame * 0.08) % (H * 0.25), 6, 0, Math.PI * 2); ctx.fill();
      }

      // Feedback flash
      if (s.feedback !== null && s.feedbackTimer > 0) {
        ctx.fillStyle = s.feedback ? 'rgba(74,222,128,0.12)' : 'rgba(239,68,68,0.12)';
        ctx.fillRect(0, 0, W, H);
      }

      // Diff type hint
      const diffLabels: Record<DiffType, string> = {
        color: 'Find the different COLOR', shape: 'Find the different SHAPE',
        rotation: 'Find the rotated one', size: 'Find the different SIZE',
      };
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(diffLabels[s.diffType], W / 2, H * 0.15);

      // Timer bar (per question: 5 seconds)
      const elapsed = (Date.now() - s.shownAt) / 1000;
      const limit = Math.max(2, 5 - s.level * 0.3);
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(20, H * 0.2, W - 40, 5);
      const pct = Math.max(0, 1 - elapsed / limit);
      ctx.fillStyle = pct > 0.5 ? '#4ade80' : pct > 0.25 ? '#fbbf24' : '#ef4444';
      ctx.fillRect(20, H * 0.2, (W - 40) * pct, 5);

      // Auto-fail
      if (elapsed > limit && s.feedback === null) {
        s.sig.total++; s.sig.wrong++;
        s.sig.streakCurrent = 0; s.feedback = false; s.feedbackTimer = 15;
        sfx.collision(); hapticFail();
        setTimeout(() => { if (s.running) nextPuzzle(); }, 600);
      }

      // Draw items
      s.items.forEach((item, i) => {
        ctx.save();
        if (s.selectedIdx === i) {
          ctx.shadowBlur = 20; ctx.shadowColor = item.isOdd ? '#4ade80' : '#ef4444';
        }
        drawItem(ctx, item);
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
  }, [endGame, nextPuzzle]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.feedback !== null) return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);

      let hitIdx = -1;
      s.items.forEach((item, i) => {
        if (Math.hypot(px - item.x, py - item.y) < item.size + 15) hitIdx = i;
      });

      if (hitIdx < 0) return;
      const ms = Date.now() - s.shownAt;
      s.sig.total++; s.sig.totalMs += ms;
      s.selectedIdx = hitIdx;

      if (s.items[hitIdx].isOdd) {
        s.sig.correct++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const speedPts = ms < 800 ? 3 : ms < 1500 ? 2 : 1;
        s.sig.score += speedPts; setScoreDisplay(s.sig.score);
        if (s.level > s.sig.hardestLevel) s.sig.hardestLevel = s.level;
        s.level = Math.min(7, 1 + Math.floor(s.sig.correct / 4));
        sfx.collect(); hapticScore();
        if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
        s.floats.push({ x: s.items[hitIdx].x, y: s.items[hitIdx].y - 30, text: `+${speedPts} ✓`, alpha: 1, vy: -2.5, color: '#4ade80' });
        s.feedback = true; s.feedbackTimer = 15;
      } else {
        s.sig.wrong++; s.sig.streakCurrent = 0;
        sfx.collision(); hapticFail();
        s.feedback = false; s.feedbackTimer = 15;
        s.floats.push({ x: px, y: py - 20, text: 'WRONG!', alpha: 1, vy: -2, color: '#ef4444' });
      }
      setTimeout(() => { if (s.running) nextPuzzle(); }, 550);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase, nextPuzzle]);

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
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Spot the item that doesn't belong in each grid!" ctaLabel="Spot it! 🔍" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Odd One Out game canvas" />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Accuracy', value: `${finalSig.total > 0 ? Math.round(finalSig.correct / finalSig.total * 100) : 0}%`, color: ACCENT },
            { label: 'Avg Speed', value: `${finalSig.total > 0 ? Math.round(finalSig.totalMs / finalSig.total) : 0}ms`, color: '#fbbf24' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' },
            { label: 'Hardest Level', value: String(finalSig.hardestLevel), color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.correct >= 10} />
      )}
    </GameShell>
  );
}
