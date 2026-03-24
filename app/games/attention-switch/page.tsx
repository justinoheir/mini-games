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

const GAME_ID = 'attention-switch';
const ACCENT = '#f59e0b';
const DURATION = 45;
const GAME_EMOJI = '⚡';
const GAME_TITLE = 'Attention Switch';
const GAME_TAGLINE = 'Two streams. One focus. Switch fast.';

interface Signals {
  total: number;
  correct: number;
  wrong: number;
  switchCount: number;        // how many times the cue changed side
  switchAccuracy: number;     // accuracy on switch trials
  switchCorrect: number;
  repeatAccuracy: number;     // accuracy on repeat (same side) trials
  repeatCorrect: number;
  repeatTotal: number;
  avgReactionMs: number;
  totalMs: number;
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const overall = sig.total > 0 ? sig.correct / sig.total : 0;
  const switchAcc = sig.switchCount > 0 ? sig.switchCorrect / sig.switchCount : 0;
  if (overall >= 0.88 && switchAcc >= 0.8) return 'Dual-Stream Pro ⚡';
  if (sig.switchCount >= 8 && switchAcc >= 0.75) return 'Switch Master 🔀';
  if (overall >= 0.8) return 'Focused Mind 🎯';
  if (sig.avgReactionMs < 600) return 'Fast Reactor ⚡';
  return 'Dual Tasking 🧠';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

const LEFT_SHAPES = ['●', '■', '▲', '◆'];
const RIGHT_NUMBERS = ['2', '4', '6', '8'];
const ODD_NUMBERS = ['1', '3', '5', '7'];

interface Trial {
  cue: 'LEFT' | 'RIGHT';   // which side to attend to
  leftSymbol: string;       // shape in left zone
  rightNumber: string;      // number in right zone
  correctAnswer: 'left' | 'right'; // which side player should tap
  // For LEFT cue: tap left (any shape is correct) or based on some rule
  // For RIGHT cue: tap right if number is EVEN, tap left if number is ODD
  isSwitch: boolean;        // was this a switch from previous cue?
}

interface GameState {
  running: boolean; timeLeft: number;
  sig: Signals; frame: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  trial: Trial | null;
  prevCue: 'LEFT' | 'RIGHT' | null;
  shownAt: number;
  feedback: 'correct' | 'wrong' | null;
  feedbackTimer: number;
  cueFlash: number;
  level: number;
}

function makeTrial(prevCue: 'LEFT' | 'RIGHT' | null, level: number): Trial {
  const cue: 'LEFT' | 'RIGHT' = Math.random() < 0.5 ? 'LEFT' : 'RIGHT';
  const isSwitch = prevCue !== null && cue !== prevCue;
  const leftSymbol = LEFT_SHAPES[Math.floor(Math.random() * LEFT_SHAPES.length)];
  const rightNumber = Math.random() < 0.5
    ? RIGHT_NUMBERS[Math.floor(Math.random() * RIGHT_NUMBERS.length)]  // even
    : ODD_NUMBERS[Math.floor(Math.random() * ODD_NUMBERS.length)];     // odd

  let correctAnswer: 'left' | 'right';
  if (cue === 'LEFT') {
    // Tap the left zone (shape present)
    correctAnswer = 'left';
  } else {
    // Tap right zone if EVEN, left if ODD
    const isEven = parseInt(rightNumber) % 2 === 0;
    correctAnswer = isEven ? 'right' : 'left';
  }

  return { cue, leftSymbol, rightNumber, correctAnswer, isSwitch };
}

export default function AttentionSwitchGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { total: 0, correct: 0, wrong: 0, switchCount: 0, switchAccuracy: 0, switchCorrect: 0, repeatAccuracy: 0, repeatCorrect: 0, repeatTotal: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    frame: 0, accentColor: ACCENT, floats: [],
    trial: null, prevCue: null, shownAt: 0,
    feedback: null, feedbackTimer: 0, cueFlash: 0, level: 1,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const nextTrial = useCallback(() => {
    const s = stateRef.current;
    const t = makeTrial(s.prevCue, s.level);
    if (s.trial) s.prevCue = s.trial.cue;
    s.trial = t;
    s.shownAt = Date.now();
    s.feedback = null; s.feedbackTimer = 0;
    if (t.isSwitch) s.cueFlash = 12;
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
    s.sig = { total: 0, correct: 0, wrong: 0, switchCount: 0, switchAccuracy: 0, switchCorrect: 0, repeatAccuracy: 0, repeatCorrect: 0, repeatTotal: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.frame = 0; s.floats = []; s.prevCue = null; s.level = 1;
    nextTrial();
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
      if (s.cueFlash > 0) s.cueFlash--;

      // Background - split dual attention
      ctx.fillStyle = '#07060f'; ctx.fillRect(0, 0, W, H);
      // Left zone background
      ctx.fillStyle = 'rgba(59,130,246,0.06)'; ctx.fillRect(0, 0, W / 2, H);
      // Right zone background
      ctx.fillStyle = 'rgba(245,158,11,0.06)'; ctx.fillRect(W / 2, 0, W / 2, H);
      // Divider
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
      ctx.setLineDash([]);

      if (s.feedback !== null && s.feedbackTimer > 0) {
        ctx.fillStyle = s.feedback === 'correct' ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)';
        ctx.fillRect(0, 0, W, H);
      }

      const t = s.trial;
      if (!t) return;

      // CUE indicator
      const cueText = t.cue === 'LEFT' ? '← SHAPES' : 'NUMBERS →';
      const cueX = t.cue === 'LEFT' ? W * 0.25 : W * 0.75;
      ctx.save();
      ctx.shadowBlur = s.cueFlash > 0 ? 24 : 12;
      ctx.shadowColor = ACCENT;
      ctx.fillStyle = ACCENT;
      ctx.font = `bold ${Math.min(16, W * 0.04)}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(t.cue === 'LEFT' ? '▼ ATTEND' : 'ATTEND ▼', cueX, H * 0.12);
      ctx.restore();

      // Task rule reminder
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      if (t.cue === 'LEFT') ctx.fillText('Tap the SHAPE side', W / 4, H * 0.18);
      else ctx.fillText('EVEN→right  ODD→left', W * 3 / 4, H * 0.18);

      // Left zone content
      ctx.save();
      ctx.shadowBlur = t.cue === 'LEFT' ? 20 : 6;
      ctx.shadowColor = '#3b82f6';
      ctx.fillStyle = t.cue === 'LEFT' ? '#3b82f6' : 'rgba(59,130,246,0.4)';
      ctx.font = `bold ${Math.min(64, W * 0.16)}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(t.leftSymbol, W / 4, H * 0.52);
      ctx.restore();

      // Right zone content
      const isEven = parseInt(t.rightNumber) % 2 === 0;
      ctx.save();
      ctx.shadowBlur = t.cue === 'RIGHT' ? 20 : 6;
      ctx.shadowColor = ACCENT;
      ctx.fillStyle = t.cue === 'RIGHT' ? ACCENT : 'rgba(245,158,11,0.4)';
      ctx.font = `bold ${Math.min(64, W * 0.16)}px monospace`; ctx.textAlign = 'center';
      ctx.fillText(t.rightNumber, W * 3 / 4, H * 0.52);
      // Even/odd indicator (subtle)
      ctx.fillStyle = t.cue === 'RIGHT' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)';
      ctx.font = '11px sans-serif';
      ctx.fillText(isEven ? 'EVEN' : 'ODD', W * 3 / 4, H * 0.6);
      ctx.restore();

      // Tap zone labels at bottom
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('TAP', W / 4, H - 20);
      ctx.fillText('TAP', W * 3 / 4, H - 20);

      // Timer bar
      const elapsed = (Date.now() - s.shownAt) / 1000;
      const limit = Math.max(1.5, 4 - s.level * 0.2);
      const pct = Math.max(0, 1 - elapsed / limit);
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(20, H * 0.73, W - 40, 4);
      ctx.fillStyle = pct > 0.5 ? ACCENT : pct > 0.25 ? '#fbbf24' : '#ef4444';
      ctx.fillRect(20, H * 0.73, (W - 40) * pct, 4);

      // Timeout
      if (elapsed > limit && s.feedback === null) {
        s.sig.total++; s.sig.wrong++; s.sig.streakCurrent = 0;
        sfx.collision(); hapticFail();
        s.feedback = 'wrong'; s.feedbackTimer = 12;
        setTimeout(() => { if (s.running) nextTrial(); }, 450);
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
  }, [endGame, nextTrial]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.feedback !== null || !s.trial) return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const W = canvas.width, H = canvas.height;
      const isLeft = px < W / 2;
      const playerAnswer: 'left' | 'right' = isLeft ? 'left' : 'right';
      const ms = Date.now() - s.shownAt;

      s.sig.total++; s.sig.totalMs += ms;
      const t = s.trial;
      const isSwitch = t.isSwitch;

      if (isSwitch) s.sig.switchCount++;
      else { s.sig.repeatTotal++; }

      if (playerAnswer === t.correctAnswer) {
        s.sig.correct++;
        if (isSwitch) s.sig.switchCorrect++;
        else s.sig.repeatCorrect++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const speedPts = ms < 600 ? 3 : ms < 1200 ? 2 : 1;
        s.sig.score += speedPts; setScoreDisplay(s.sig.score);
        s.level = Math.min(6, 1 + Math.floor(s.sig.correct / 5));
        sfx.collect(); hapticScore();
        if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
        s.floats.push({ x: isLeft ? W / 4 : W * 3 / 4, y: H * 0.65, text: `+${speedPts}`, alpha: 1, vy: -2.5, color: '#fbbf24' });
        s.feedback = 'correct'; s.feedbackTimer = 10;
      } else {
        s.sig.wrong++; s.sig.streakCurrent = 0;
        sfx.collision(); hapticFail();
        s.feedback = 'wrong'; s.feedbackTimer = 12;
        s.floats.push({ x: W / 2, y: H * 0.65, text: 'WRONG!', alpha: 1, vy: -2, color: '#ef4444' });
      }
      setTimeout(() => { if (s.running) nextTrial(); }, 400);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase, nextTrial]);

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
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Left=shapes, Right=even numbers. The cue tells you which to attend!" ctaLabel="Focus! ⚡" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Attention Switch game canvas" />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Accuracy', value: `${finalSig.total > 0 ? Math.round(finalSig.correct / finalSig.total * 100) : 0}%`, color: ACCENT },
            { label: 'Switches', value: String(finalSig.switchCount), color: '#fbbf24' },
            { label: 'Switch Acc', value: `${finalSig.switchCount > 0 ? Math.round(finalSig.switchCorrect / finalSig.switchCount * 100) : 0}%`, color: '#4ade80' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.correct >= 15} />
      )}
    </GameShell>
  );
}
