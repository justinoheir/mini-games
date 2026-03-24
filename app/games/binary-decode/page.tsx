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

const GAME_ID = 'binary-decode';
const ACCENT = '#22c55e';
const DURATION = 45;
const GAME_EMOJI = '💻';
const GAME_TITLE = 'Binary Decode';
const GAME_TAGLINE = 'Flip the bits. Find the number.';

interface Signals {
  total: number;
  correct: number;
  wrong: number;
  maxBits: number;
  avgReactionMs: number;
  totalMs: number;
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.total > 0 ? sig.correct / sig.total : 0;
  if (acc >= 0.9 && sig.maxBits >= 7) return 'Binary Wizard 🧙';
  if (sig.maxBits >= 8) return 'Bit Flipper 💻';
  if (acc >= 0.8) return 'Code Decoder ⚡';
  if (sig.avgReactionMs < 1500) return 'Quick Reader 📟';
  return 'Learning Bits 🔢';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function makeBinaryQuestion(bits: number): { binary: string; value: number; options: number[] } {
  const maxVal = Math.pow(2, bits) - 1;
  const value = Math.floor(Math.random() * (maxVal - 1)) + 1;
  const binary = value.toString(2).padStart(bits, '0');
  const options = new Set([value]);
  while (options.size < 4) {
    const offset = Math.floor(Math.random() * 7) - 3;
    const candidate = value + offset;
    if (candidate >= 0 && candidate <= maxVal && candidate !== value) options.add(candidate);
  }
  return { binary, value, options: [...options].sort(() => Math.random() - 0.5) };
}

interface Question {
  binary: string;
  value: number;
  options: number[];
  bits: number;
}

interface GameState {
  running: boolean; timeLeft: number;
  sig: Signals; frame: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  question: Question | null;
  shownAt: number;
  feedback: number | null;
  feedbackTimer: number;
  bits: number;
}

export default function BinaryDecodeGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { total: 0, correct: 0, wrong: 0, maxBits: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    frame: 0, accentColor: ACCENT, floats: [],
    question: null, shownAt: 0, feedback: null, feedbackTimer: 0, bits: 4,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const nextQuestion = useCallback(() => {
    const s = stateRef.current;
    const q = makeBinaryQuestion(s.bits);
    s.question = { ...q, bits: s.bits };
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
    s.sig = { total: 0, correct: 0, wrong: 0, maxBits: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.frame = 0; s.floats = []; s.bits = 4;
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

      // Background - terminal green
      ctx.fillStyle = '#030f05'; ctx.fillRect(0, 0, W, H);
      // Matrix rain effect (subtle)
      for (let col = 0; col < 8; col++) {
        const x = (col * W / 8) + (W / 16);
        const char = Math.random() < 0.01 ? (Math.random() < 0.5 ? '0' : '1') : '';
        if (char) {
          const y = (s.frame * 2 + col * 50) % H;
          ctx.fillStyle = 'rgba(34,197,94,0.12)'; ctx.font = '12px monospace'; ctx.textAlign = 'center';
          ctx.fillText(char, x, y);
        }
      }

      if (s.feedback !== null && s.feedbackTimer > 0 && s.question) {
        const correct = s.question.options[s.feedback] === s.question.value;
        ctx.fillStyle = correct ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)';
        ctx.fillRect(0, 0, W, H);
      }

      const q = s.question;
      if (!q) return;

      // Power-of-2 labels
      ctx.fillStyle = 'rgba(34,197,94,0.5)'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
      const bitSpacing = Math.min(W / (q.bits + 2), 50);
      const bitsStartX = W / 2 - (q.bits - 1) * bitSpacing / 2;
      for (let i = 0; i < q.bits; i++) {
        const pow = q.bits - 1 - i;
        ctx.fillText(`2^${pow}`, bitsStartX + i * bitSpacing, H * 0.25);
        ctx.fillText(`(${Math.pow(2, pow)})`, bitsStartX + i * bitSpacing, H * 0.3);
      }

      // Binary display with individual bit boxes
      for (let i = 0; i < q.bits; i++) {
        const bit = q.binary[i];
        const bx = bitsStartX + i * bitSpacing - 18;
        const by = H * 0.35;
        const isOne = bit === '1';

        ctx.save();
        ctx.shadowBlur = isOne ? 16 : 4;
        ctx.shadowColor = isOne ? ACCENT : '#334155';
        ctx.fillStyle = isOne ? ACCENT + '22' : '#0f2020';
        ctx.strokeStyle = isOne ? ACCENT : '#334155';
        ctx.lineWidth = 2;
        ctx.beginPath();
        (ctx as any).roundRect?.(bx, by, 36, 44, 6) ?? ctx.rect(bx, by, 36, 44);
        ctx.fill(); ctx.stroke();

        ctx.fillStyle = isOne ? ACCENT : '#64748b';
        ctx.font = `bold 28px monospace`; ctx.textAlign = 'center';
        ctx.fillText(bit, bx + 18, by + 33);
        ctx.restore();
      }

      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('= ?  (decimal)', W / 2, H * 0.52);

      // 4 options
      const optW = Math.min((W - 50) / 2 - 5, 120);
      const optH = 52;
      const optGridX = (W - (optW * 2 + 10)) / 2;
      const optGridY = H * 0.57;

      q.options.forEach((opt, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const bx = optGridX + col * (optW + 10);
        const by = optGridY + row * (optH + 10);
        const isSelected = s.feedback === i;
        const isCorrect = opt === q.value;

        let bg = 'rgba(34,197,94,0.08)';
        let border = ACCENT;
        if (isSelected) {
          bg = isCorrect ? 'rgba(74,222,128,0.3)' : 'rgba(239,68,68,0.3)';
          border = isCorrect ? '#4ade80' : '#ef4444';
        } else if (s.feedback !== null && isCorrect) {
          border = '#4ade80'; bg = 'rgba(74,222,128,0.15)';
        }

        ctx.save();
        ctx.fillStyle = bg; ctx.strokeStyle = border; ctx.lineWidth = 2;
        ctx.shadowBlur = 8; ctx.shadowColor = border;
        ctx.beginPath(); (ctx as any).roundRect?.(bx, by, optW, optH, 8) ?? ctx.rect(bx, by, optW, optH);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.font = `bold ${Math.min(26, optW * 0.25)}px monospace`; ctx.textAlign = 'center';
        ctx.fillText(String(opt), bx + optW / 2, by + optH / 2 + 9);
        ctx.restore();
      });

      // Timer bar
      const elapsed = (Date.now() - s.shownAt) / 1000;
      const limit = Math.max(2, 5 - (s.bits - 4) * 0.4);
      const pct = Math.max(0, 1 - elapsed / limit);
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(20, H * 0.505, W - 40, 4);
      ctx.fillStyle = pct > 0.5 ? ACCENT : pct > 0.25 ? '#fbbf24' : '#ef4444';
      ctx.fillRect(20, H * 0.505, (W - 40) * pct, 4);

      if (elapsed > limit && s.feedback === null) {
        s.sig.total++; s.sig.wrong++; s.sig.streakCurrent = 0;
        sfx.collision(); hapticFail();
        s.feedback = -1; s.feedbackTimer = 15;
        setTimeout(() => { if (s.running) nextQuestion(); }, 600);
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
      const optW = Math.min((W - 50) / 2 - 5, 120);
      const optH = 52;
      const optGridX = (W - (optW * 2 + 10)) / 2;
      const optGridY = H * 0.57;

      for (let i = 0; i < 4; i++) {
        const col = i % 2, row = Math.floor(i / 2);
        const bx = optGridX + col * (optW + 10);
        const by = optGridY + row * (optH + 10);
        if (px >= bx && px <= bx + optW && py >= by && py <= by + optH) {
          const ms = Date.now() - s.shownAt;
          s.sig.total++; s.sig.totalMs += ms;
          s.feedback = i; s.feedbackTimer = 15;

          if (s.question.options[i] === s.question.value) {
            s.sig.correct++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const speedPts = ms < 1200 ? 3 : ms < 2500 ? 2 : 1;
            s.sig.score += speedPts + (s.bits - 4); setScoreDisplay(s.sig.score);
            if (s.bits > s.sig.maxBits) s.sig.maxBits = s.bits;
            s.bits = Math.min(8, 4 + Math.floor(s.sig.correct / 3));
            sfx.collect(); hapticScore();
            if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
            s.floats.push({ x: W / 2, y: H * 0.54, text: `+${speedPts + (s.bits - 4)} ✓`, alpha: 1, vy: -2.5, color: '#fbbf24' });
          } else {
            s.sig.wrong++; s.sig.streakCurrent = 0;
            sfx.collision(); hapticFail();
            s.floats.push({ x: W / 2, y: H * 0.54, text: `= ${s.question.value}`, alpha: 1, vy: -2, color: '#ef4444' });
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
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Read the binary number and tap its decimal value!" ctaLabel="Decode! 💻" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Binary Decode game canvas" />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Accuracy', value: `${finalSig.total > 0 ? Math.round(finalSig.correct / finalSig.total * 100) : 0}%`, color: ACCENT },
            { label: 'Max Bits', value: `${finalSig.maxBits}-bit`, color: '#fbbf24' },
            { label: 'Avg Speed', value: `${finalSig.total > 0 ? Math.round(finalSig.totalMs / finalSig.total) : 0}ms`, color: '#4ade80' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.correct >= 10} />
      )}
    </GameShell>
  );
}
