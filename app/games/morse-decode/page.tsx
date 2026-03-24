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

const GAME_ID      = 'morse-decode';
const ACCENT       = '#facc15';
const DURATION     = 60;
const GAME_EMOJI   = '💡';
const GAME_TITLE   = 'Morse Decode';
const GAME_TAGLINE = 'Read the flashing code — tap the correct letter before the next flash.';

interface Signals {
  correctAnswers: number;
  wrongAnswers: number;
  avgDecodeTime: number;
  longestStreak: number;
  streakCurrent: number;
  score: number;
}

function getPersonality(sig: Signals): string {
  const acc = (sig.correctAnswers + sig.wrongAnswers) > 0
    ? sig.correctAnswers / (sig.correctAnswers + sig.wrongAnswers)
    : 0;
  if (acc >= 0.85 && sig.longestStreak >= 5)  return 'Telegraph Master 📟';
  if (sig.longestStreak >= 6)                  return 'Code Streak ⚡';
  if (acc >= 0.7)                              return 'Signal Reader 💡';
  if (sig.correctAnswers >= 5)                 return 'Dot Dash Learner 🔵';
  return 'Static Noise 📻';
}

const MORSE_TABLE: Record<string, string> = {
  'A': '.-',   'B': '-...', 'C': '-.-.', 'D': '-..',  'E': '.',
  'F': '..-.', 'G': '--.',  'H': '....', 'I': '..',   'J': '.---',
  'K': '-.-',  'L': '.-..', 'M': '--',   'N': '-.',   'O': '---',
  'P': '.--.', 'Q': '--.-', 'R': '.-.',  'S': '...',  'T': '-',
  'U': '..-',  'V': '...-', 'W': '.--',  'X': '-..-', 'Y': '-.--',
  'Z': '--..',
};

const LETTERS = Object.keys(MORSE_TABLE);

interface MorseQuestion {
  letter: string;
  code: string;
  options: string[];
}

interface FlashState {
  symbols: ('.' | '-')[];
  symbolIndex: number;
  flashOn: boolean;
  flashTimer: number;
  pauseTimer: number;
  phase: 'flashing' | 'pausing' | 'answering';
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  question: MorseQuestion | null;
  flash: FlashState;
  decodeTimes: number[];
  questionStartTime: number;
  accentColor: string;
  answered: boolean;
  answerFeedback: 'correct' | 'wrong' | null;
  feedbackTimer: number;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function generateQuestion(): MorseQuestion {
  const letter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
  const code = MORSE_TABLE[letter];
  const wrong = LETTERS
    .filter(l => l !== letter)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);
  const options = [...wrong, letter].sort(() => Math.random() - 0.5);
  return { letter, code, options };
}

export default function MorseDecodeGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef<GameState>({
    running: false,
    timeLeft: DURATION,
    sig: { correctAnswers: 0, wrongAnswers: 0, avgDecodeTime: 0, longestStreak: 0, streakCurrent: 0, score: 0 },
    question: null,
    flash: { symbols: [], symbolIndex: 0, flashOn: false, flashTimer: 0, pauseTimer: 0, phase: 'flashing' },
    decodeTimes: [],
    questionStartTime: 0,
    accentColor: ACCENT,
    answered: false,
    answerFeedback: null,
    feedbackTimer: 0,
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('💡');
  const [options, setOptions]           = useState<string[]>([]);
  const [feedback, setFeedback]         = useState<'correct' | 'wrong' | null>(null);
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const nextQuestion = useCallback(() => {
    const s = stateRef.current;
    const q = generateQuestion();
    s.question = q;
    s.answered = false;
    s.answerFeedback = null;
    s.questionStartTime = Date.now();
    s.flash = {
      symbols: q.code.split('') as ('.' | '-')[],
      symbolIndex: 0,
      flashOn: false,
      flashTimer: 0,
      pauseTimer: 30,
      phase: 'pausing',
    };
    setOptions([...q.options]);
    setFeedback(null);
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    if (s.decodeTimes.length > 0) {
      s.sig.avgDecodeTime = Math.round(s.decodeTimes.reduce((a, b) => a + b, 0) / s.decodeTimes.length);
    }
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const handleAnswer = useCallback((letter: string) => {
    const s = stateRef.current;
    if (!s.running || s.answered || s.flash.phase !== 'answering') return;

    s.answered = true;
    const correct = letter === s.question?.letter;
    const dt = Date.now() - s.questionStartTime;
    s.decodeTimes.push(dt);

    if (correct) {
      s.sig.correctAnswers++;
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.longestStreak) s.sig.longestStreak = s.sig.streakCurrent;
      s.sig.score += s.sig.streakCurrent >= 3 ? 3 : 2;
      setScoreDisplay(s.sig.score);
      s.answerFeedback = 'correct';
      setFeedback('correct');
      sfx.collect();
      haptic([30]);
    } else {
      s.sig.wrongAnswers++;
      s.sig.streakCurrent = 0;
      s.sig.score = Math.max(0, s.sig.score - 1);
      setScoreDisplay(s.sig.score);
      s.answerFeedback = 'wrong';
      setFeedback('wrong');
      sfx.collision();
      haptic([20, 30, 20]);
    }
    s.feedbackTimer = 60;
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    s.running = true;
    s.timeLeft = DURATION;
    s.sig = { correctAnswers: 0, wrongAnswers: 0, avgDecodeTime: 0, longestStreak: 0, streakCurrent: 0, score: 0 };
    s.decodeTimes = [];
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    nextQuestion();

    const DOT_FRAMES  = 12;
    const DASH_FRAMES = 30;
    const GAP_FRAMES  = 10;

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width;
      const H = canvas.height;

      // Flash state machine
      const f = s.flash;
      if (f.phase === 'pausing') {
        f.pauseTimer--;
        if (f.pauseTimer <= 0) {
          f.phase = 'flashing';
          f.flashOn = false;
          f.flashTimer = 0;
        }
      } else if (f.phase === 'flashing') {
        f.flashTimer++;
        const sym = f.symbols[f.symbolIndex];
        const onFrames  = sym === '.' ? DOT_FRAMES : DASH_FRAMES;

        if (!f.flashOn && f.flashTimer >= GAP_FRAMES) {
          f.flashOn = true;
          f.flashTimer = 0;
        } else if (f.flashOn && f.flashTimer >= onFrames) {
          f.flashOn = false;
          f.flashTimer = 0;
          f.symbolIndex++;
          if (f.symbolIndex >= f.symbols.length) {
            f.phase = 'answering';
            f.flashOn = false;
            s.questionStartTime = Date.now();
          }
        }
      } else if (f.phase === 'answering' && s.answered) {
        s.feedbackTimer--;
        if (s.feedbackTimer <= 0) {
          nextQuestion();
        }
      }

      // Background
      ctx.fillStyle = '#0d0a00';
      ctx.fillRect(0, 0, W, H);

      // Large light bulb / signal light
      const bulbR = Math.min(W, H) * 0.2;
      const bulbX = W / 2;
      const bulbY = H * 0.38;
      const isFlashing = f.flashOn && f.phase === 'flashing';
      const isAnswering = f.phase === 'answering';

      // Glow halo
      if (isFlashing) {
        const g = ctx.createRadialGradient(bulbX, bulbY, bulbR * 0.3, bulbX, bulbY, bulbR * 2.5);
        g.addColorStop(0, `rgba(250,204,21,0.5)`);
        g.addColorStop(1, 'rgba(250,204,21,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bulbX, bulbY, bulbR * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Bulb
      ctx.beginPath();
      ctx.arc(bulbX, bulbY, bulbR, 0, Math.PI * 2);
      ctx.fillStyle = isFlashing ? ACCENT : isAnswering ? '#3d3000' : '#1a1400';
      ctx.shadowBlur = isFlashing ? 40 : 5;
      ctx.shadowColor = ACCENT;
      ctx.fill();
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Symbol progress indicators
      const symSpacing = 24;
      const totalW = f.symbols.length * symSpacing;
      const startX = W / 2 - totalW / 2;
      for (let i = 0; i < f.symbols.length; i++) {
        const sx = startX + i * symSpacing + 12;
        const sy = H * 0.62;
        const shown = i < f.symbolIndex || (i === f.symbolIndex && f.flashOn);
        ctx.fillStyle = shown ? ACCENT : '#333';
        if (f.symbols[i] === '.') {
          ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillRect(sx - 12, sy - 4, 24, 8);
        }
      }

      // Phase indicator
      ctx.fillStyle = ACCENT;
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      if (f.phase === 'answering' && !s.answered) {
        ctx.fillText('WHAT IS THE LETTER?', W / 2, H * 0.72);
      } else if (f.phase === 'pausing') {
        ctx.fillText('GET READY...', W / 2, H * 0.72);
      } else {
        ctx.fillText('WATCH THE SIGNAL', W / 2, H * 0.72);
      }
      ctx.textAlign = 'left';

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
    return () => { window.removeEventListener('resize', resize); };
  }, [phase]);

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
    setOptions([]);
    setFeedback(null);
  }, []);

  const buildInsights = (sig: Signals) => {
    const total = sig.correctAnswers + sig.wrongAnswers;
    const acc = total > 0 ? Math.round((sig.correctAnswers / total) * 100) : 0;
    return [
      { label: 'Accuracy',     value: `${acc}%`,             color: acc >= 70 ? '#4ade80' : '#facc15' },
      { label: 'Best Streak',  value: `×${sig.longestStreak}`, color: ACCENT },
      { label: 'Avg Speed',    value: `${sig.avgDecodeTime}ms`, color: ACCENT },
      { label: 'Decoded',      value: `${sig.correctAnswers}`, color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Learn the Code"
          accentColor={theme.colors.accent ?? ACCENT}
          onStart={handleStart}
        />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '70%', touchAction: 'none' }} role="img" aria-label="Morse Decode game canvas" />
          {phase === 'playing' && (
            <>
              <GameHUD
                accentColor={theme.colors.accent ?? ACCENT}
                items={[
                  { label: 'TIME',  value: timeLeft,      danger: timeLeft <= 10 },
                  { label: 'SCORE', value: scoreDisplay },
                ]}
              />
              {/* Answer buttons */}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, height: '30%',
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: 12,
                background: '#0d0a00',
              }}>
                {options.map(opt => {
                  const isCorrect = stateRef.current.question?.letter === opt;
                  const fb = feedback;
                  let bg = '#1a1400';
                  if (fb === 'correct' && isCorrect) bg = '#166534';
                  if (fb === 'wrong') {
                    if (stateRef.current.answered && isCorrect) bg = '#166534';
                    else if (opt === (stateRef.current.flash.phase === 'answering' ? opt : '')) bg = '#7f1d1d';
                  }
                  return (
                    <button
                      key={opt}
                      aria-label={`Answer ${opt}`}
                      onClick={() => handleAnswer(opt)}
                      style={{
                        background: bg,
                        border: `2px solid ${ACCENT}`,
                        borderRadius: 12,
                        color: ACCENT,
                        fontSize: 28,
                        fontWeight: 'bold',
                        fontFamily: 'monospace',
                        cursor: 'pointer',
                        minHeight: 56,
                      }}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </>
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
          didWin={finalSig.correctAnswers >= 10}
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
      correctAnswers: sig.correctAnswers,
      wrongAnswers: sig.wrongAnswers,
      avgDecodeTime: sig.avgDecodeTime,
      longestStreak: sig.longestStreak,
    }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
