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

const GAME_ID      = 'number-crunch';
const ACCENT       = '#3b82f6';
const DURATION     = 60;
const GAME_EMOJI   = '🔢';
const GAME_TITLE   = 'Number Crunch';
const GAME_TAGLINE = 'Solve the math problem. Tap the right answer — fast!';

type Op = '+' | '-' | '×' | '÷';

interface Problem { question: string; answer: number; choices: number[]; timeLimit: number; }
interface Signals {
  totalProblems: number;
  correct: number;
  wrong: number;
  maxStreak: number;
  streakCurrent: number;
  avgResponseMs: number;
  responseTimes: number[];
  score: number;
  difficultyReached: number;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  problem: Problem | null;
  problemStart: number;
  difficulty: number;
  answerFlash: { correct: boolean; idx: number } | null;
  flashTimer: number;
  accentColor: string;
  particles: Array<{x:number;y:number;vx:number;vy:number;alpha:number;color:string}>;
  questionAnim: number;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const acc = sig.totalProblems > 0 ? sig.correct / sig.totalProblems : 0;
  const avgMs = sig.avgResponseMs;
  if (acc >= 0.90 && avgMs < 2000) return 'Math Genius 🧮';
  if (acc >= 0.80) return 'Sharp Calculator 💡';
  if (sig.maxStreak >= 8) return 'Streak Machine ⚡';
  if (sig.difficultyReached >= 4) return 'Challenge Seeker 🎯';
  return 'Learning the Ropes 📚';
}

function generateProblem(difficulty: number): Problem {
  const ops: Op[] = difficulty >= 3 ? ['+','-','×','÷'] : difficulty >= 2 ? ['+','-','×'] : ['+','-'];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let a: number, b: number, answer: number, question: string;

  const maxN = 5 + difficulty * 5;
  a = Math.floor(Math.random() * maxN) + 1;
  b = Math.floor(Math.random() * maxN) + 1;

  switch (op) {
    case '+': answer = a + b; question = `${a} + ${b}`; break;
    case '-':
      if (b > a) [a, b] = [b, a];
      answer = a - b; question = `${a} − ${b}`; break;
    case '×':
      a = Math.floor(Math.random() * Math.min(maxN, 12)) + 1;
      b = Math.floor(Math.random() * Math.min(maxN, 12)) + 1;
      answer = a * b; question = `${a} × ${b}`; break;
    case '÷':
      b = Math.floor(Math.random() * 9) + 2;
      answer = Math.floor(Math.random() * 9) + 1;
      a = b * answer; question = `${a} ÷ ${b}`; break;
    default: answer = a + b; question = `${a} + ${b}`;
  }

  // Generate 3 wrong choices
  const wrongs = new Set<number>();
  while (wrongs.size < 3) {
    const offset = Math.floor(Math.random() * 5) + 1;
    const wrong = Math.random() > 0.5 ? answer + offset : Math.max(0, answer - offset);
    if (wrong !== answer) wrongs.add(wrong);
  }
  const choices = [...wrongs, answer].sort(() => Math.random() - 0.5);

  const timeLimit = Math.max(3, 8 - difficulty * 0.5);
  return { question, answer, choices, timeLimit };
}

export default function NumberCrunchGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const problemTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalProblems: 0, correct: 0, wrong: 0, maxStreak: 0, streakCurrent: 0,
           avgResponseMs: 0, responseTimes: [], score: 0, difficultyReached: 1 },
    problem: null, problemStart: 0, difficulty: 1,
    answerFlash: null, flashTimer: 0, accentColor: ACCENT,
    particles: [], questionAnim: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [currentProblem, setCurrentProblem] = useState<Problem | null>(null);
  const [answerFeedback, setAnswerFeedback] = useState<{ idx: number; correct: boolean } | null>(null);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🔢');
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const nextProblem = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    if (problemTimerRef.current) { clearTimeout(problemTimerRef.current); problemTimerRef.current = null; }
    s.problem = generateProblem(s.difficulty);
    s.problemStart = Date.now();
    s.sig.totalProblems++;
    s.answerFlash = null; s.flashTimer = 0;
    s.questionAnim = 0;
    setCurrentProblem({ ...s.problem });
    setAnswerFeedback(null);
    // Auto-wrong if timeout
    problemTimerRef.current = setTimeout(() => {
      const st = stateRef.current;
      if (!st.running || !st.problem) return;
      st.sig.wrong++;
      st.sig.streakCurrent = 0;
      sfx.fail(); haptic([20, 30, 20]);
      setAnswerFeedback({ idx: -1, correct: false });
      setTimeout(() => { if (st.running) nextProblem(); }, 400);
    }, (s.problem.timeLimit) * 1000);
  }, []);

  const handleAnswer = useCallback((idx: number) => {
    const s = stateRef.current;
    if (!s.running || !s.problem) return;
    if (problemTimerRef.current) { clearTimeout(problemTimerRef.current); problemTimerRef.current = null; }

    const responseMs = Date.now() - s.problemStart;
    s.sig.responseTimes.push(responseMs);
    const chosen = s.problem.choices[idx];
    const isCorrect = chosen === s.problem.answer;

    if (isCorrect) {
      s.sig.correct++;
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      // Speed bonus
      const speedBonus = responseMs < 1500 ? 3 : responseMs < 3000 ? 2 : 1;
      const comboBonus = s.sig.streakCurrent >= 5 ? 2 : 1;
      s.sig.score += speedBonus * comboBonus;
      // Difficulty scaling
      if (s.sig.correct % 5 === 0) {
        s.difficulty = Math.min(5, s.difficulty + 1);
        if (s.difficulty > s.sig.difficultyReached) s.sig.difficultyReached = s.difficulty;
      }
      setScoreDisplay(s.sig.score);
      sfx.collect(); haptic([30]);
    } else {
      s.sig.wrong++;
      s.sig.streakCurrent = 0;
      if (s.difficulty > 1) s.difficulty = Math.max(1, s.difficulty - 1);
      sfx.fail(); haptic([20, 30, 20]);
    }

    setAnswerFeedback({ idx, correct: isCorrect });
    setTimeout(() => { if (s.running) nextProblem(); }, isCorrect ? 300 : 600);
  }, [nextProblem]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (problemTimerRef.current) { clearTimeout(problemTimerRef.current); problemTimerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    s.sig.avgResponseMs = s.sig.responseTimes.length > 0
      ? Math.round(s.sig.responseTimes.reduce((a, b) => a + b, 0) / s.sig.responseTimes.length) : 0;
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
    s.sig = { totalProblems: 0, correct: 0, wrong: 0, maxStreak: 0, streakCurrent: 0,
              avgResponseMs: 0, responseTimes: [], score: 0, difficultyReached: 1 };
    s.difficulty = 1; s.problem = null; s.questionAnim = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setCurrentProblem(null); setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    setTimeout(() => { if (s.running) nextProblem(); }, 500);

    // Light background animation loop
    const loop = () => {
      if (!s.running) return;
      const W = canvas.width; const H = canvas.height;
      s.questionAnim++;

      ctx.fillStyle = '#0f1b35';
      ctx.fillRect(0, 0, W, H);

      // Grid bg
      ctx.strokeStyle = `${ACCENT}11`;
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

      // Difficulty indicator
      ctx.fillStyle = ACCENT + '44';
      ctx.fillRect(0, H - 4, W * (s.difficulty / 5), 4);

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, nextProblem]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (problemTimerRef.current) clearTimeout(problemTimerRef.current);
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
    setCurrentProblem(null); setAnswerFeedback(null);
  }, []);

  const buildInsights = (sig: Signals) => {
    const acc = sig.totalProblems > 0 ? Math.round((sig.correct / sig.totalProblems) * 100) : 0;
    return [
      { label: 'Accuracy',      value: `${acc}%`,           color: acc >= 80 ? '#4ade80' : acc >= 50 ? '#facc15' : '#ef4444' },
      { label: 'Avg Speed',     value: `${sig.avgResponseMs}ms`, color: ACCENT },
      { label: 'Best Streak',   value: `×${sig.maxStreak}`,   color: ACCENT },
      { label: 'Max Difficulty',value: `Level ${sig.difficultyReached}`, color: 'var(--color-text)' },
    ];
  };

  const CHOICE_COLORS = ['#ef4444', '#f97316', '#22c55e', '#3b82f6'];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start Crunching" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} role="img" aria-label="Number crunch math game"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
          {phase === 'playing' && (
            <>
              <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
                { label: 'TIME', value: timeLeft, danger: timeLeft <= 5 },
                { label: 'SCORE', value: scoreDisplay },
              ]} />
              {currentProblem && (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
                }}>
                  <div style={{ fontSize: '48px', fontWeight: 'bold', color: '#fff',
                    textShadow: `0 0 20px ${ACCENT}`, marginBottom: '8px' }}>
                    {currentProblem.question}
                  </div>
                  <div style={{ fontSize: '14px', color: ACCENT, marginBottom: '32px' }}>
                    = ?
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px',
                    width: '80%', maxWidth: '300px', pointerEvents: 'all' }}>
                    {currentProblem.choices.map((choice, i) => {
                      const feedback = answerFeedback;
                      const isSelected = feedback?.idx === i;
                      const isCorrectChoice = choice === currentProblem.answer && feedback !== null;
                      const bg = feedback
                        ? isSelected
                          ? feedback.correct ? '#4ade80' : '#ef4444'
                          : isCorrectChoice ? '#4ade8044' : '#1e293b'
                        : '#1e293b';
                      return (
                        <button
                          key={i}
                          aria-label={`Answer ${choice}`}
                          onClick={() => handleAnswer(i)}
                          disabled={feedback !== null}
                          style={{
                            backgroundColor: bg,
                            border: `2px solid ${CHOICE_COLORS[i]}`,
                            borderRadius: '12px', padding: '16px 8px',
                            fontSize: '28px', fontWeight: 'bold', color: '#fff',
                            cursor: feedback ? 'default' : 'pointer',
                            minHeight: '64px',
                            transition: 'background-color 0.15s',
                          }}
                        >
                          {choice}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain} didWin={finalSig.correct >= 10} />
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
    const acc = sig.totalProblems > 0 ? sig.correct / sig.totalProblems : 0;
    postWebhook(theme, gameId, { personality, score: sig.score, accuracy: parseFloat(acc.toFixed(3)),
      avgResponseMs: sig.avgResponseMs, maxStreak: sig.maxStreak,
      difficultyReached: sig.difficultyReached, totalProblems: sig.totalProblems }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
