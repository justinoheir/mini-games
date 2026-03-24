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

const GAME_ID      = 'code-breaker';
const ACCENT       = '#06b6d4';
const DURATION     = 60;
const GAME_EMOJI   = '🔐';
const GAME_TITLE   = 'Code Breaker';
const GAME_TAGLINE = 'Memorize the code — then tap it back from memory. Codes get longer over time.';

interface Signals {
  codesCorrect: number;
  codesWrong: number;
  maxCodeLength: number;
  avgMemoryMs: number;
  longestStreak: number;
  streakCurrent: number;
  score: number;
}

function getPersonality(sig: Signals): string {
  if (sig.maxCodeLength >= 7 && sig.codesCorrect >= 8)  return 'Cipher Brain 🔐';
  if (sig.longestStreak >= 6)                            return 'Code Streak 🔥';
  if (sig.maxCodeLength >= 6)                            return 'Memory Master 🧠';
  if (sig.codesCorrect >= 5)                             return 'Pattern Recognizer 👁️';
  return 'Digital Rookie 🖥️';
}

type MemoryPhase = 'show' | 'hide' | 'input' | 'feedback';

interface CodeState {
  code: number[];
  userInput: number[];
  memoryPhase: MemoryPhase;
  showTimer: number;
  hideTimer: number;
  feedbackTimer: number;
  feedbackResult: 'correct' | 'wrong' | null;
  showStartTime: number;
  inputStartTime: number;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  codeState: CodeState;
  currentCodeLength: number;
  accentColor: string;
  glowPhase: number;
  memoryTimes: number[];
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

const SHOW_FRAMES  = 120;  // 2 seconds at 60fps
const FEEDBACK_FRAMES = 90;

function generateCode(length: number): number[] {
  const code: number[] = [];
  for (let i = 0; i < length; i++) code.push(Math.floor(Math.random() * 10));
  return code;
}

export default function CodeBreakerGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef<GameState>({
    running: false,
    timeLeft: DURATION,
    sig: { codesCorrect: 0, codesWrong: 0, maxCodeLength: 4, avgMemoryMs: 0, longestStreak: 0, streakCurrent: 0, score: 0 },
    codeState: {
      code: [], userInput: [], memoryPhase: 'show',
      showTimer: 0, hideTimer: 0, feedbackTimer: 0,
      feedbackResult: null, showStartTime: 0, inputStartTime: 0,
    },
    currentCodeLength: 4,
    accentColor: ACCENT,
    glowPhase: 0,
    memoryTimes: [],
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🔐');
  const [codePhaseDisplay, setCodePhaseDisplay] = useState<MemoryPhase>('show');
  const [userInputDisplay, setUserInputDisplay] = useState<number[]>([]);
  const [feedbackDisplay, setFeedbackDisplay]   = useState<'correct' | 'wrong' | null>(null);
  const [codeDisplay, setCodeDisplay]           = useState<number[]>([]);
  const [codeLengthDisplay, setCodeLengthDisplay] = useState(4);
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const startNextCode = useCallback(() => {
    const s = stateRef.current;
    const code = generateCode(s.currentCodeLength);
    s.codeState = {
      code,
      userInput: [],
      memoryPhase: 'show',
      showTimer: 0,
      hideTimer: 20, // brief pause before showing
      feedbackTimer: 0,
      feedbackResult: null,
      showStartTime: Date.now(),
      inputStartTime: 0,
    };
    setCodeDisplay([...code]);
    setUserInputDisplay([]);
    setCodePhaseDisplay('show');
    setFeedbackDisplay(null);
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    if (s.memoryTimes.length > 0) {
      s.sig.avgMemoryMs = Math.round(s.memoryTimes.reduce((a, b) => a + b, 0) / s.memoryTimes.length);
    }
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const handleDigitTap = useCallback((digit: number) => {
    const s = stateRef.current;
    if (!s.running || s.codeState.memoryPhase !== 'input') return;
    const cs = s.codeState;
    cs.userInput.push(digit);
    setUserInputDisplay([...cs.userInput]);
    haptic([20]);

    if (cs.userInput.length === cs.code.length) {
      const correct = cs.userInput.every((d, i) => d === cs.code[i]);
      const memTime = Date.now() - cs.inputStartTime;
      s.memoryTimes.push(memTime);

      if (correct) {
        s.sig.codesCorrect++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.longestStreak) s.sig.longestStreak = s.sig.streakCurrent;
        const pts = s.currentCodeLength + (s.sig.streakCurrent >= 3 ? 2 : 0);
        s.sig.score += pts;
        setScoreDisplay(s.sig.score);
        cs.feedbackResult = 'correct';
        setFeedbackDisplay('correct');
        sfx.collect();
        haptic([30, 20, 50]);
        // Increase code length every 3 correct
        if (s.sig.codesCorrect % 3 === 0) {
          s.currentCodeLength = Math.min(9, s.currentCodeLength + 1);
          setCodeLengthDisplay(s.currentCodeLength);
          if (s.currentCodeLength > s.sig.maxCodeLength) s.sig.maxCodeLength = s.currentCodeLength;
        }
      } else {
        s.sig.codesWrong++;
        s.sig.streakCurrent = 0;
        cs.feedbackResult = 'wrong';
        setFeedbackDisplay('wrong');
        sfx.collision();
        haptic([20, 30, 20]);
      }

      cs.memoryPhase = 'feedback';
      cs.feedbackTimer = FEEDBACK_FRAMES;
      setCodePhaseDisplay('feedback');
    }
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    s.running = true;
    s.timeLeft = DURATION;
    s.sig = { codesCorrect: 0, codesWrong: 0, maxCodeLength: 4, avgMemoryMs: 0, longestStreak: 0, streakCurrent: 0, score: 0 };
    s.currentCodeLength = 4;
    s.glowPhase = 0;
    s.memoryTimes = [];
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setCodeLengthDisplay(4);
    setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    startNextCode();

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width;
      const H = canvas.height;
      const cs = s.codeState;

      s.glowPhase += 0.04;

      // State machine for code display
      if (cs.memoryPhase === 'show') {
        cs.showTimer++;
        if (cs.showTimer >= SHOW_FRAMES) {
          cs.memoryPhase = 'hide';
          cs.inputStartTime = Date.now();
          setCodePhaseDisplay('hide');
          setTimeout(() => {
            if (s.running && cs.memoryPhase === 'hide') {
              cs.memoryPhase = 'input';
              setCodePhaseDisplay('input');
            }
          }, 300);
        }
      } else if (cs.memoryPhase === 'feedback') {
        cs.feedbackTimer--;
        if (cs.feedbackTimer <= 0) {
          startNextCode();
        }
      }

      // Background
      ctx.fillStyle = '#020d14';
      ctx.fillRect(0, 0, W, H);

      // Matrix-like background effect
      ctx.font = '10px monospace';
      ctx.fillStyle = 'rgba(6,182,212,0.04)';
      for (let i = 0; i < 20; i++) {
        const mx = Math.random() * W;
        const my = Math.random() * H;
        ctx.fillText(String(Math.floor(Math.random() * 10)), mx, my);
      }

      // Central display area
      const boxW = Math.min(W * 0.85, 320);
      const boxH = 100;
      const boxX = (W - boxW) / 2;
      const boxY = H * 0.25;

      ctx.fillStyle = '#0a1a24';
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.shadowBlur = cs.memoryPhase === 'show' ? 20 : 5;
      ctx.shadowColor = ACCENT;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 12);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Code display
      const cellW = boxW / Math.max(cs.code.length, 1);
      for (let i = 0; i < cs.code.length; i++) {
        const cx = boxX + cellW * i + cellW / 2;
        const cy = boxY + boxH / 2;

        ctx.textAlign = 'center';
        ctx.font = `bold ${Math.floor(boxH * 0.5)}px monospace`;

        if (cs.memoryPhase === 'show') {
          ctx.fillStyle = ACCENT;
          ctx.shadowBlur = 10; ctx.shadowColor = ACCENT;
          ctx.fillText(String(cs.code[i]), cx, cy + 12);
          ctx.shadowBlur = 0;
        } else if (cs.memoryPhase === 'input' || cs.memoryPhase === 'hide') {
          if (i < cs.userInput.length) {
            ctx.fillStyle = '#fff';
            ctx.fillText(String(cs.userInput[i]), cx, cy + 12);
          } else {
            ctx.fillStyle = '#1a3a4a';
            ctx.fillText('?', cx, cy + 12);
          }
        } else if (cs.memoryPhase === 'feedback') {
          const isCorrect = cs.userInput[i] === cs.code[i];
          ctx.fillStyle = isCorrect ? '#4ade80' : '#ef4444';
          ctx.fillText(String(cs.code[i]), cx, cy + 12);
          if (!isCorrect && cs.userInput[i] !== undefined) {
            ctx.fillStyle = '#ef4444';
            ctx.font = `12px monospace`;
            ctx.fillText(`(${cs.userInput[i]})`, cx, cy + boxH * 0.7);
          }
        }
        ctx.textAlign = 'left';
      }

      // Phase label
      ctx.fillStyle = ACCENT;
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      const phaseLabel = cs.memoryPhase === 'show' ? 'MEMORIZE!'
        : cs.memoryPhase === 'hide' ? '...'
        : cs.memoryPhase === 'input' ? 'ENTER THE CODE'
        : cs.feedbackResult === 'correct' ? '✓ CORRECT!' : '✗ WRONG';
      ctx.fillStyle = cs.memoryPhase === 'feedback'
        ? (cs.feedbackResult === 'correct' ? '#4ade80' : '#ef4444')
        : ACCENT;
      ctx.fillText(phaseLabel, W / 2, boxY - 14);

      // Code length indicator
      ctx.fillStyle = 'rgba(6,182,212,0.5)';
      ctx.font = '11px monospace';
      ctx.fillText(`CODE LENGTH: ${cs.code.length}`, W / 2, H * 0.82);
      ctx.textAlign = 'left';

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, startNextCode]);

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
    setPlayerName(name); setPlayerAvatar(avatar);
    initAudio();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
    setUserInputDisplay([]); setFeedbackDisplay(null); setCodeDisplay([]); setCodeLengthDisplay(4);
  }, []);

  const buildInsights = (sig: Signals) => {
    const total = sig.codesCorrect + sig.codesWrong;
    const acc = total > 0 ? Math.round((sig.codesCorrect / total) * 100) : 0;
    return [
      { label: 'Accuracy',    value: `${acc}%`,              color: acc >= 70 ? '#4ade80' : '#facc15' },
      { label: 'Max Length',  value: `${sig.maxCodeLength} digits`, color: ACCENT },
      { label: 'Best Streak', value: `×${sig.longestStreak}`, color: ACCENT },
      { label: 'Cracked',     value: `${sig.codesCorrect}`,  color: 'var(--color-text)' },
    ];
  };

  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Crack the Code" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '63%', touchAction: 'none' }} role="img" aria-label="Code Breaker game canvas" />
          {phase === 'playing' && (
            <>
              <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
                { label: 'TIME',  value: timeLeft,      danger: timeLeft <= 10 },
                { label: 'SCORE', value: scoreDisplay },
              ]} />
              {/* Number pad */}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, height: '37%',
                display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, padding: 10,
                background: '#020d14',
              }}>
                {digits.map(d => (
                  <button
                    key={d}
                    aria-label={`Digit ${d}`}
                    onClick={() => handleDigitTap(d)}
                    disabled={codePhaseDisplay !== 'input'}
                    style={{
                      background: codePhaseDisplay === 'input' ? '#0a1a24' : '#050d14',
                      border: `2px solid ${codePhaseDisplay === 'input' ? ACCENT : '#1a3a4a'}`,
                      borderRadius: 8,
                      color: codePhaseDisplay === 'input' ? ACCENT : '#1a3a4a',
                      fontSize: 22,
                      fontWeight: 'bold',
                      fontFamily: 'monospace',
                      cursor: codePhaseDisplay === 'input' ? 'pointer' : 'default',
                      minHeight: 44,
                      transition: 'all 0.15s',
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.codesCorrect >= 8} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
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
    postWebhook(theme, gameId, { personality, score: sig.score, codesCorrect: sig.codesCorrect, codesWrong: sig.codesWrong, maxCodeLength: sig.maxCodeLength, longestStreak: sig.longestStreak, avgMemoryMs: sig.avgMemoryMs }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
