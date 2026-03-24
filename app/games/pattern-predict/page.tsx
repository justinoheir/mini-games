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

const GAME_ID = 'pattern-predict';
const ACCENT = '#14b8a6';
const DURATION = 45;
const GAME_EMOJI = '📈';
const GAME_TITLE = 'Pattern Predict';
const GAME_TAGLINE = "What comes next? You tell me.";

interface Signals {
  total: number;
  correct: number;
  wrong: number;
  avgReactionMs: number;
  totalMs: number;
  level: number;
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.total > 0 ? sig.correct / sig.total : 0;
  if (acc >= 0.9 && sig.level >= 5) return 'Pattern Oracle 🔮';
  if (sig.level >= 6) return 'Sequence Sage 📈';
  if (acc >= 0.8) return 'Logic Pro 💡';
  if (sig.avgReactionMs < 1500) return 'Quick Thinker ⚡';
  return 'Pattern Learner 🌱';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

type PatternType = 'arithmetic' | 'geometric' | 'alternating' | 'color' | 'shape';

interface Pattern {
  type: PatternType;
  sequence: string[];   // display labels
  answer: string;
  options: string[];    // 3 options including answer
  hint: string;         // e.g., "+3 each time"
}

const SHAPE_SEQS = [
  ['●', '■', '▲', '●', '■', '▲', '●', '■'],
  ['▲', '▲', '●', '▲', '▲', '●', '▲', '▲'],
  ['■', '●', '■', '■', '●', '■', '■', '●'],
];

const COLOR_NAMES = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣'];

function makePattern(level: number): Pattern {
  const types: PatternType[] = level >= 4
    ? ['arithmetic', 'geometric', 'alternating', 'color', 'shape']
    : level >= 2
      ? ['arithmetic', 'alternating', 'color']
      : ['arithmetic', 'alternating'];

  const type = types[Math.floor(Math.random() * types.length)];

  if (type === 'arithmetic') {
    const start = Math.floor(Math.random() * 5) + 1;
    const step = Math.floor(Math.random() * (level >= 3 ? 5 : 3)) + 2;
    const isAdd = Math.random() < 0.6;
    const vals = Array.from({ length: 5 }, (_, i) => isAdd ? start + i * step : start * Math.pow(2, i));
    const answer = String(isAdd ? vals[4] + step : vals[4] * 2);
    const wrong1 = String(parseInt(answer) + (Math.random() < 0.5 ? 1 : -1) * step);
    const wrong2 = String(parseInt(answer) + (Math.random() < 0.5 ? 2 : -2) * step);
    return {
      type, sequence: vals.slice(0, 4).map(String), answer,
      options: [answer, wrong1, wrong2].sort(() => Math.random() - 0.5),
      hint: isAdd ? `+${step} each` : '×2 each',
    };
  }

  if (type === 'alternating') {
    const a = Math.floor(Math.random() * 5) + 2;
    const b = Math.floor(Math.random() * 5) + 8;
    const seq = [a, b, a, b, a].map(String);
    const answer = String(b);
    const wrong1 = String(a + 1);
    const wrong2 = String(b + 2);
    return {
      type, sequence: seq.slice(0, 4), answer,
      options: [answer, wrong1, wrong2].sort(() => Math.random() - 0.5),
      hint: 'alternates A B A B...',
    };
  }

  if (type === 'color') {
    const colors = COLOR_NAMES.slice(0, 4);
    const period = Math.floor(Math.random() * 2) + 2;
    const seq = Array.from({ length: 5 }, (_, i) => colors[i % period]);
    const answer = seq[4];
    const options = [answer, ...colors.filter(c => c !== answer).slice(0, 2)].sort(() => Math.random() - 0.5);
    return { type, sequence: seq.slice(0, 4), answer, options, hint: `repeats every ${period}` };
  }

  if (type === 'shape') {
    const shapeSeq = SHAPE_SEQS[Math.floor(Math.random() * SHAPE_SEQS.length)];
    const period = shapeSeq.indexOf(shapeSeq[1]) === -1 ? 3 : shapeSeq.indexOf(shapeSeq[0], 1);
    const answer = shapeSeq[4];
    const wrongShapes = ['●', '■', '▲', '◆', '★'].filter(s => s !== answer).slice(0, 2);
    return {
      type, sequence: shapeSeq.slice(0, 4), answer,
      options: [answer, ...wrongShapes].sort(() => Math.random() - 0.5),
      hint: 'find the pattern',
    };
  }

  // geometric fallback
  const start = 2, ratio = 2;
  const vals = Array.from({ length: 5 }, (_, i) => start * Math.pow(ratio, i));
  const answer = String(vals[4] * ratio);
  return {
    type: 'geometric',
    sequence: vals.slice(0, 4).map(String),
    answer,
    options: [answer, String(parseInt(answer) + 2), String(parseInt(answer) - 4)].sort(() => Math.random() - 0.5),
    hint: `×${ratio} each`,
  };
}

interface GameState {
  running: boolean; timeLeft: number;
  sig: Signals; frame: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  pattern: Pattern | null;
  shownAt: number;
  feedback: number | null;
  feedbackTimer: number;
  level: number;
}

export default function PatternPredictGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { total: 0, correct: 0, wrong: 0, avgReactionMs: 0, totalMs: 0, level: 1, score: 0, maxStreak: 0, streakCurrent: 0 },
    frame: 0, accentColor: ACCENT, floats: [],
    pattern: null, shownAt: 0, feedback: null, feedbackTimer: 0, level: 1,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const nextPattern = useCallback(() => {
    const s = stateRef.current;
    s.pattern = makePattern(s.level);
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
    s.sig = { total: 0, correct: 0, wrong: 0, avgReactionMs: 0, totalMs: 0, level: 1, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.frame = 0; s.floats = []; s.level = 1;
    nextPattern();
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

      // Background - teal data
      ctx.fillStyle = '#030f0e'; ctx.fillRect(0, 0, W, H);
      // Data stream lines
      for (let i = 0; i < 6; i++) {
        const x = (i * 60 + s.frame * 0.3) % (W + 60) - 30;
        const alpha = 0.04 + Math.sin(i + s.frame * 0.02) * 0.02;
        ctx.strokeStyle = `rgba(20,184,166,${alpha})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }

      // Feedback flash
      if (s.feedback !== null && s.feedbackTimer > 0 && s.pattern) {
        const correct = s.pattern.options[s.feedback] === s.pattern.answer;
        ctx.fillStyle = correct ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)';
        ctx.fillRect(0, 0, W, H);
      }

      const p = s.pattern;
      if (!p) return;

      // Sequence display
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('What comes next?', W / 2, H * 0.12);

      // Draw sequence items
      const seqY = H * 0.28;
      const seqItems = [...p.sequence, '?'];
      const itemW = Math.min((W - 40) / seqItems.length, 60);
      const seqX = (W - itemW * seqItems.length) / 2;

      seqItems.forEach((item, i) => {
        const ix = seqX + i * itemW + itemW / 2;
        const isQuestion = i === seqItems.length - 1;

        ctx.save();
        ctx.fillStyle = isQuestion ? ACCENT + '22' : 'rgba(255,255,255,0.08)';
        ctx.strokeStyle = isQuestion ? ACCENT : 'rgba(255,255,255,0.2)';
        ctx.lineWidth = isQuestion ? 2 : 1;
        ctx.beginPath();
        (ctx as any).roundRect?.(ix - itemW * 0.42, seqY - 25, itemW * 0.85, 50, 6) ?? ctx.rect(ix - itemW * 0.42, seqY - 25, itemW * 0.85, 50);
        ctx.fill(); ctx.stroke();

        ctx.fillStyle = isQuestion ? ACCENT : '#ffffff';
        ctx.font = `bold ${Math.min(22, itemW * 0.45)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(item, ix, seqY + 8);
        ctx.restore();

        // Arrow between items
        if (i < seqItems.length - 1) {
          ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('›', ix + itemW * 0.5, seqY + 6);
        }
      });

      // Hint (subtle)
      ctx.fillStyle = 'rgba(20,184,166,0.5)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`Hint: ${p.hint}`, W / 2, H * 0.42);

      // 3 options
      const optW = Math.min((W - 50) / 3 - 5, 100);
      const optH = 56;
      const optY = H * 0.55;
      const optTotalW = optW * 3 + 10 * 2;
      const optX = (W - optTotalW) / 2;

      p.options.forEach((opt, i) => {
        const bx = optX + i * (optW + 10);
        const isSelected = s.feedback === i;
        const isCorrect = opt === p.answer;

        let bg = 'rgba(20,184,166,0.1)';
        let border = ACCENT;
        if (isSelected) {
          bg = isCorrect ? 'rgba(74,222,128,0.25)' : 'rgba(239,68,68,0.25)';
          border = isCorrect ? '#4ade80' : '#ef4444';
        } else if (s.feedback !== null && isCorrect) {
          bg = 'rgba(74,222,128,0.15)'; border = '#4ade80';
        }

        ctx.save();
        ctx.fillStyle = bg; ctx.strokeStyle = border; ctx.lineWidth = 2;
        ctx.shadowBlur = 6; ctx.shadowColor = border;
        ctx.beginPath();
        (ctx as any).roundRect?.(bx, optY, optW, optH, 8) ?? ctx.rect(bx, optY, optW, optH);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.min(24, optW * 0.35)}px sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(opt, bx + optW / 2, optY + optH / 2 + 9);
        ctx.restore();
      });

      // Reaction bar
      const elapsed = (Date.now() - s.shownAt) / 1000;
      const limit = Math.max(2.5, 6 - s.level * 0.4);
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(20, H * 0.48, W - 40, 4);
      const pct = Math.max(0, 1 - elapsed / limit);
      ctx.fillStyle = pct > 0.5 ? ACCENT : pct > 0.25 ? '#fbbf24' : '#ef4444';
      ctx.fillRect(20, H * 0.48, (W - 40) * pct, 4);

      if (elapsed > limit && s.feedback === null) {
        s.sig.total++; s.sig.wrong++; s.sig.streakCurrent = 0;
        sfx.collision(); hapticFail();
        s.feedback = -1; s.feedbackTimer = 15;
        setTimeout(() => { if (s.running) nextPattern(); }, 600);
      }

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
  }, [endGame, nextPattern]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.feedback !== null || !s.pattern) return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      const W = canvas.width, H = canvas.height;
      const optW = Math.min((W - 50) / 3 - 5, 100);
      const optH = 56, optY = H * 0.55;
      const optX = (W - (optW * 3 + 20)) / 2;

      for (let i = 0; i < 3; i++) {
        const bx = optX + i * (optW + 10);
        if (px >= bx && px <= bx + optW && py >= optY && py <= optY + optH) {
          const ms = Date.now() - s.shownAt;
          s.sig.total++; s.sig.totalMs += ms;
          s.feedback = i; s.feedbackTimer = 16;

          if (s.pattern.options[i] === s.pattern.answer) {
            s.sig.correct++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const speedPts = ms < 1500 ? 3 : ms < 3000 ? 2 : 1;
            s.sig.score += speedPts; setScoreDisplay(s.sig.score);
            s.level = Math.min(8, 1 + Math.floor(s.sig.correct / 3));
            s.sig.level = s.level;
            sfx.collect(); hapticScore();
            if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
            s.floats.push({ x: W / 2, y: H * 0.5, text: `+${speedPts} ✓`, alpha: 1, vy: -2.5, color: '#fbbf24' });
          } else {
            s.sig.wrong++; s.sig.streakCurrent = 0;
            sfx.collision(); hapticFail();
          }
          setTimeout(() => { if (s.running) nextPattern(); }, 600);
          break;
        }
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase, nextPattern]);

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
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Find the pattern and predict what comes next!" ctaLabel="Predict! 📈" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Pattern Predict game canvas" />
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
