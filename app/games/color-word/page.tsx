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

const GAME_ID = 'color-word';
const ACCENT = '#f43f5e';
const DURATION = 30;
const GAME_EMOJI = '🎨';
const GAME_TITLE = 'Color Word';
const GAME_TAGLINE = 'Ignore the meaning. Trust your eyes.';

interface Signals {
  total: number;
  correct: number;
  wrong: number;
  congruent: number;      // word matches ink color (easier)
  incongruent: number;    // word doesn't match (harder — Stroop effect)
  incongruentCorrect: number;
  avgReactionMs: number;
  totalMs: number;
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.total > 0 ? sig.correct / sig.total : 0;
  const incongruent = sig.incongruent > 0 ? sig.incongruentCorrect / sig.incongruent : 0;
  if (acc >= 0.9 && incongruent >= 0.85) return 'Stroop Master 🧠';
  if (incongruent >= 0.75) return 'Interference Proof 🛡️';
  if (acc >= 0.8) return 'Color Reader 🎨';
  if (sig.avgReactionMs < 600) return 'Fast Fingers ⚡';
  return 'Still Processing 🤔';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

const COLORS = [
  { name: 'RED', hex: '#ef4444' },
  { name: 'BLUE', hex: '#3b82f6' },
  { name: 'GREEN', hex: '#22c55e' },
  { name: 'YELLOW', hex: '#eab308' },
];

interface Question {
  word: string;       // The word written (e.g., "RED")
  inkColor: string;   // The ink hex color (e.g., "#3b82f6" = blue)
  inkName: string;    // What the ink color IS (e.g., "BLUE")
  isCongruent: boolean;
}

function makeQuestion(): Question {
  const word = COLORS[Math.floor(Math.random() * COLORS.length)];
  const isCongruent = Math.random() < 0.3; // 30% congruent
  const ink = isCongruent ? word : COLORS.filter(c => c.name !== word.name)[Math.floor(Math.random() * 3)];
  return { word: word.name, inkColor: ink.hex, inkName: ink.name, isCongruent };
}

interface GameState {
  running: boolean; timeLeft: number;
  sig: Signals; frame: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  question: Question | null;
  shownAt: number;
  feedback: 'correct' | 'wrong' | null;
  feedbackTimer: number;
  level: number;
}

export default function ColorWordGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { total: 0, correct: 0, wrong: 0, congruent: 0, incongruent: 0, incongruentCorrect: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
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
    s.question = makeQuestion();
    s.shownAt = Date.now();
    s.feedback = null;
    s.feedbackTimer = 0;
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
    s.sig = { total: 0, correct: 0, wrong: 0, congruent: 0, incongruent: 0, incongruentCorrect: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
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

      // Background
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#1a0810'); bg.addColorStop(1, '#0a0508');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      if (s.feedbackTimer > 0) s.feedbackTimer--;

      // Feedback flash
      if (s.feedback && s.feedbackTimer > 0) {
        const a = (s.feedbackTimer / 12) * 0.25;
        ctx.fillStyle = s.feedback === 'correct' ? `rgba(74,222,128,${a})` : `rgba(239,68,68,${a})`;
        ctx.fillRect(0, 0, W, H);
      }

      const q = s.question;
      if (!q) return;

      // Instruction
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Tap the INK COLOR of the word below:', W / 2, H * 0.12);

      // Main word (drawn in its ink color)
      ctx.save();
      ctx.shadowBlur = 20; ctx.shadowColor = q.inkColor;
      ctx.fillStyle = q.inkColor;
      ctx.font = `bold ${Math.min(72, W * 0.18)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(q.word, W / 2, H * 0.35);
      ctx.restore();

      // Color buttons
      const btnW = Math.min((W - 40) / 2 - 10, 140);
      const btnH = 56;
      const cols = 2, rows = 2;
      const gridW = cols * (btnW + 10) - 10;
      const gridX = (W - gridW) / 2;
      const gridY = H * 0.5;

      COLORS.forEach((color, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const bx = gridX + col * (btnW + 10);
        const by = gridY + row * (btnH + 10);

        const isCorrectColor = color.hex === q.inkColor;
        const isSelected = s.feedback !== null && isCorrectColor;

        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowColor = color.hex;
        ctx.fillStyle = isSelected
          ? (s.feedback === 'correct' ? color.hex : '#7f1d1d')
          : color.hex + '33';
        ctx.strokeStyle = color.hex;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        (ctx as any).roundRect?.(bx, by, btnW, btnH, 10) ?? ctx.rect(bx, by, btnW, btnH);
        ctx.fill(); ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.min(22, W * 0.055)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(color.name, bx + btnW / 2, by + btnH / 2 + 8);
        ctx.restore();
      });

      // Reaction time hint
      const elapsed = (Date.now() - s.shownAt) / 1000;
      const timeLimit = 3;
      const remaining = Math.max(0, timeLimit - elapsed);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(20, H * 0.43, (W - 40) * (remaining / timeLimit), 4);

      // Auto-fail if too slow
      if (elapsed > timeLimit && s.feedback === null) {
        s.sig.total++; s.sig.wrong++;
        if (!q.isCongruent) s.sig.incongruent++;
        s.sig.streakCurrent = 0;
        s.feedback = 'wrong'; s.feedbackTimer = 12;
        sfx.collision(); hapticFail();
        setTimeout(() => { if (s.running) nextQuestion(); }, 500);
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

      const btnW = Math.min((W - 40) / 2 - 10, 140);
      const btnH = 56;
      const gridW = 2 * (btnW + 10) - 10;
      const gridX = (W - gridW) / 2;
      const gridY = H * 0.5;

      for (let i = 0; i < COLORS.length; i++) {
        const col = i % 2, row = Math.floor(i / 2);
        const bx = gridX + col * (btnW + 10);
        const by = gridY + row * (btnH + 10);
        if (px >= bx && px <= bx + btnW && py >= by && py <= by + btnH) {
          const chosen = COLORS[i];
          const ms = Date.now() - s.shownAt;
          s.sig.total++;
          s.sig.totalMs += ms;
          const q = s.question!;

          if (!q.isCongruent) s.sig.incongruent++;
          else s.sig.congruent++;

          if (chosen.hex === q.inkColor) {
            // Correct! Tap the ink color
            s.sig.correct++;
            if (!q.isCongruent) s.sig.incongruentCorrect++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const speedBonus = ms < 600 ? 2 : ms < 1200 ? 1 : 0;
            const stroopBonus = !q.isCongruent ? 1 : 0;
            const pts = 1 + speedBonus + stroopBonus;
            s.sig.score += pts; setScoreDisplay(s.sig.score);
            s.feedback = 'correct'; s.feedbackTimer = 12;
            sfx.collect(); hapticScore();
            if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
            const label = pts >= 3 ? `+${pts} ⚡ FAST!` : pts === 2 ? `+${pts} 🎨` : '+1';
            s.floats.push({ x: W / 2, y: H * 0.45, text: label, alpha: 1, vy: -2.5, color: '#fbbf24' });
          } else {
            s.sig.wrong++; s.sig.streakCurrent = 0;
            s.feedback = 'wrong'; s.feedbackTimer = 12;
            sfx.collision(); hapticFail();
            s.floats.push({ x: W / 2, y: H * 0.45, text: `${q.inkName}!`, alpha: 1, vy: -2, color: '#ef4444' });
          }
          setTimeout(() => { if (s.running) nextQuestion(); }, 450);
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
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Tap the color of the INK — not what the word says!" ctaLabel="Focus! 🎨" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Color Word Stroop game canvas" />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Accuracy', value: `${finalSig.total > 0 ? Math.round(finalSig.correct / finalSig.total * 100) : 0}%`, color: ACCENT },
            { label: 'Stroop %', value: `${finalSig.incongruent > 0 ? Math.round(finalSig.incongruentCorrect / finalSig.incongruent * 100) : 0}%`, color: '#fbbf24' },
            { label: 'Avg Speed', value: `${finalSig.total > 0 ? Math.round(finalSig.totalMs / finalSig.total) : 0}ms`, color: '#4ade80' },
            { label: 'Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.correct >= 15} />
      )}
    </GameShell>
  );
}
