/**
 * ══════════════════════════════════════════════════════════════════
 *  ETHER MINI-GAMES — COLOR WORD (Stroop Effect)
 *  The word says RED but is printed in BLUE.
 *  Tap the INK COLOR — not what the word says.
 *
 *  Signals: correctTaps, wrongTaps, avgReactionMs, maxStreak
 * ══════════════════════════════════════════════════════════════════
 */

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

// ── Constants ────────────────────────────────────────────────────────────────
const GAME_ID   = 'color-word';
const PB_KEY    = 'mg_pb_color-word';
const ACCENT    = '#f43f5e';
const DURATION  = 45;
const GAME_EMOJI   = '🎨';
const GAME_TITLE   = 'Color Word';
const GAME_TAGLINE = 'Tap the INK COLOR — not what the word says.';
const Q_TIMEOUT_MS = 3500;    // auto-advance with penalty if no tap

// ── Colors ────────────────────────────────────────────────────────────────────
const COLORS: { name: string; hex: string }[] = [
  { name: 'RED',    hex: '#ef4444' },
  { name: 'GREEN',  hex: '#22c55e' },
  { name: 'BLUE',   hex: '#3b82f6' },
  { name: 'YELLOW', hex: '#fbbf24' },
  { name: 'PINK',   hex: '#ec4899' },
  { name: 'ORANGE', hex: '#f97316' },
];
const N = COLORS.length;

// ── Signals ───────────────────────────────────────────────────────────────────
interface Signals {
  score: number;
  correctTaps: number;
  wrongTaps: number;
  avgReactionMs: number;
  maxStreak: number;
}

function getPersonality(sig: Signals): string {
  const total = sig.correctTaps + sig.wrongTaps;
  const acc   = total > 0 ? sig.correctTaps / total : 0;
  if (acc >= 0.90 && sig.correctTaps >= 15) return 'Stroop Master 🎯';
  if (acc >= 0.80 && sig.correctTaps >= 10) return 'Color Analyst 🔬';
  if (sig.avgReactionMs < 1200)             return 'Fast Reflex ⚡';
  return 'Mind Over Words 🌊';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ── Question type ──────────────────────────────────────────────────────────────
interface Question {
  wordIdx: number;   // index into COLORS — what the word SAYS
  inkIdx:  number;   // index into COLORS — actual ink color (correct answer)
  spawnMs: number;   // Date.now() when shown
}
function genQuestion(prevInkIdx: number): Question {
  const inkIdx  = (prevInkIdx + 1 + Math.floor(Math.random() * (N - 1))) % N;
  let wordIdx: number;
  do { wordIdx = Math.floor(Math.random() * N); } while (wordIdx === inkIdx);
  return { wordIdx, inkIdx, spawnMs: Date.now() };
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function ColorWordGame() {
  const theme        = useBrandTheme();
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const qTimerRef    = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const sigRef    = useRef<Signals>({ score: 0, correctTaps: 0, wrongTaps: 0, avgReactionMs: 0, maxStreak: 0 });
  const streakRef = useRef(0);
  const rxTimes   = useRef<number[]>([]);
  const prevInk   = useRef(-1);

  const [phase, setPhase]           = useState<Phase>('start');
  const [timeLeft, setTimeLeft]     = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]     = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest]   = useState(false);
  const [question, setQuestion]     = useState<Question | null>(null);
  const [feedback, setFeedback]     = useState<'correct' | 'wrong' | 'timeout' | null>(null);
  const [streak, setStreak]         = useState(0);

  const advanceQuestion = useCallback(() => {
    if (qTimerRef.current) { clearTimeout(qTimerRef.current); qTimerRef.current = null; }
    const q = genQuestion(prevInk.current);
    prevInk.current = q.inkIdx;
    setQuestion(q);
    setFeedback(null);
    // Auto-timeout
    qTimerRef.current = setTimeout(() => {
      setFeedback('timeout');
      sigRef.current.wrongTaps++;
      sigRef.current.score = Math.max(0, sigRef.current.score - 3);
      streakRef.current = 0;
      setStreakAndScore();
      setTimeout(advanceQuestion, 500);
    }, Q_TIMEOUT_MS);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setStreakAndScore = useCallback(() => {
    setStreak(streakRef.current);
    setScoreDisplay(sigRef.current.score);
  }, []);

  const endGame = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (qTimerRef.current) { clearTimeout(qTimerRef.current); qTimerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.success(); haptic([100]);

    const avg = rxTimes.current.length > 0
      ? Math.round(rxTimes.current.reduce((a, b) => a + b, 0) / rxTimes.current.length) : 0;
    sigRef.current.avgReactionMs = avg;

    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0', 10);
      if (sigRef.current.score > pb) { localStorage.setItem(PB_KEY, String(sigRef.current.score)); setIsNewBest(true); }
    } catch { /* ignore */ }

    setFinalSig({ ...sigRef.current });
    setPhase('done');
  }, []);

  const startGame = useCallback(() => {
    sigRef.current  = { score: 0, correctTaps: 0, wrongTaps: 0, avgReactionMs: 0, maxStreak: 0 };
    streakRef.current = 0; rxTimes.current = []; prevInk.current = -1;
    setScoreDisplay(0); setTimeLeft(DURATION); setStreak(0);
    setPhase('playing');
    stopMusicRef.current = startMusic('minimal');

    let t = DURATION;
    timerRef.current = setInterval(() => {
      t--;
      setTimeLeft(t);
      if (t === 10) sfx.warning();
      if (t > 0 && t < 10) sfx.tick();
      if (t <= 0) endGame();
    }, 1000);

    setTimeout(advanceQuestion, 300);
  }, [endGame, advanceQuestion]);

  const handleColorTap = useCallback((colorIdx: number) => {
    if (!question || feedback !== null) return;
    if (qTimerRef.current) { clearTimeout(qTimerRef.current); qTimerRef.current = null; }

    const correct = colorIdx === question.inkIdx;
    const rxMs    = Date.now() - question.spawnMs;

    if (correct) {
      rxTimes.current.push(rxMs);
      streakRef.current++;
      if (streakRef.current > sigRef.current.maxStreak) sigRef.current.maxStreak = streakRef.current;
      const pts = 10 + (streakRef.current >= 3 ? 5 : 0) + (rxMs < 1000 ? 5 : 0);
      sigRef.current.score += pts;
      sigRef.current.correctTaps++;
      setFeedback('correct');
      sfx.collect(); haptic([30]);
    } else {
      streakRef.current = 0;
      sigRef.current.score = Math.max(0, sigRef.current.score - 5);
      sigRef.current.wrongTaps++;
      setFeedback('wrong');
      sfx.collision(); haptic([20, 30, 20]);
    }
    setStreakAndScore();
    setTimeout(advanceQuestion, correct ? 280 : 420);
  }, [question, feedback, advanceQuestion, setStreakAndScore]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (qTimerRef.current) clearTimeout(qTimerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startGame(); }, [startGame]);
  const handlePlayAgain = useCallback(() => {
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
    setIsNewBest(false); setQuestion(null); setFeedback(null); setStreak(0);
    setPhase('countdown');
  }, []);

  const buildInsights = useCallback((sig: Signals) => {
    const total = sig.correctTaps + sig.wrongTaps;
    const acc   = total > 0 ? Math.round(sig.correctTaps / total * 100) : 0;
    const ac    = theme.colors.accent ?? ACCENT;
    return [
      { label: 'Correct',     value: String(sig.correctTaps), color: sig.correctTaps >= 15 ? '#4ade80' : ac },
      { label: 'Accuracy',    value: `${acc}%`, color: acc >= 85 ? '#4ade80' : acc >= 65 ? '#facc15' : '#ef4444' },
      { label: 'Best Streak', value: `×${sig.maxStreak}`, color: sig.maxStreak >= 5 ? '#4ade80' : ac },
      { label: 'Avg Speed',   value: sig.avgReactionMs > 0 ? `${(sig.avgReactionMs / 1000).toFixed(1)}s` : '—', color: ac },
    ];
  }, [theme]);

  const accent = theme.colors.accent ?? ACCENT;
  const inkColor = question ? COLORS[question.inkIdx].hex : accent;
  const bgFeedback = feedback === 'correct' ? 'rgba(34,197,94,0.08)' :
                     feedback === 'wrong'   ? 'rgba(239,68,68,0.08)' : 'transparent';

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 0%, rgba(244,63,94,0.12) 0%, transparent 55%), linear-gradient(180deg, #0d0408 0%, #08020a 60%, #030105 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}

      {phase === 'playing' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', background: bgFeedback, transition: 'background 200ms' }}>
          <GameHUD accentColor={accent} items={[
            { label: 'TIME',  value: timeLeft,     danger: timeLeft <= 10, testId: 'timer' },
            { label: 'SCORE', value: scoreDisplay, testId: 'score' },
          ]} />

          {/* Instruction */}
          <div style={{ marginTop: 110, fontSize: 13, fontWeight: 600, letterSpacing: '0.12em',
            color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase' }}>
            TAP THE INK COLOR
          </div>

          {/* The Stroop Word */}
          {question && (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 16, width: '100%', padding: '0 24px',
            }}>
              <div
                aria-live="polite"
                style={{
                  fontSize: 'clamp(52px, 14vw, 88px)',
                  fontWeight: 900,
                  letterSpacing: '0.04em',
                  color: inkColor,
                  textShadow: `0 0 40px ${inkColor}88, 0 0 80px ${inkColor}44`,
                  userSelect: 'none',
                  transition: 'color 120ms',
                  transform: feedback === 'wrong' ? 'translateX(-5px)' : 'none',
                }}>
                {COLORS[question.wordIdx].name}
              </div>

              {/* Streak */}
              {streak >= 3 && (
                <div style={{ fontSize: 16, fontWeight: 700, color: '#fbbf24',
                  textShadow: '0 0 12px #fbbf2488' }}>
                  ×{streak} STREAK!
                </div>
              )}

              {/* Timeout bar */}
              <div style={{ width: '100%', height: 4, borderRadius: 2,
                background: 'rgba(255,255,255,0.1)', overflow: 'hidden', marginTop: 8 }}>
                <div style={{
                  height: '100%', borderRadius: 2, background: inkColor,
                  animation: `colorWordTimer ${Q_TIMEOUT_MS}ms linear forwards`,
                }} />
              </div>

              {/* Color buttons 2×3 grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 10, width: '100%', maxWidth: 360, marginTop: 12 }}>
                {COLORS.map((c, i) => (
                  <button key={c.name} onClick={() => handleColorTap(i)}
                    aria-label={`Tap ${c.name}`}
                    style={{
                      height: 54, borderRadius: 12, border: 'none', cursor: 'pointer',
                      background: c.hex,
                      opacity: feedback === 'correct' && i === question.inkIdx ? 1 :
                               feedback === 'wrong'   && i === question.inkIdx ? 0.4 : 1,
                      boxShadow: feedback === 'correct' && i === question.inkIdx
                        ? `0 0 20px ${c.hex}, 0 0 40px ${c.hex}66` : 'none',
                      transform: feedback === 'correct' && i === question.inkIdx ? 'scale(1.06)' : 'scale(1)',
                      transition: 'transform 150ms, box-shadow 150ms',
                      fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.08em',
                      textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                    }}>
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {isNewBest && phase === 'done' && (
        <div style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)',
          zIndex: 90, background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', borderRadius: 20,
          padding: '8px 20px', fontSize: 20, fontWeight: 900, color: '#000',
          whiteSpace: 'nowrap', boxShadow: '0 4px 20px rgba(251,191,36,0.5)' }}>🏆 New Best!</div>
      )}

      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={buildInsights(finalSig)} accentColor={accent}
            onPlayAgain={handlePlayAgain} didWin={finalSig.correctTaps >= 10} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}

      <style>{`
        @keyframes colorWordTimer {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score }, player);
  }, [theme, sig, personality, player]);
  return null;
}
