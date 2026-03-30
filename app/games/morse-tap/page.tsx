/**
 * ══════════════════════════════════════════════════════════════════
 *  ETHER MINI-GAMES — MORSE TAP
 *  A letter is shown. Tap dots (●) and dashes (—) to spell it in
 *  Morse code before the timer runs out.
 *
 *  Signals: lettersCompleted, wrongSubmits, avgMs, maxStreak
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
const GAME_ID   = 'morse-tap';
const PB_KEY    = 'mg_pb_morse-tap';
const ACCENT    = '#fbbf24';
const DURATION  = 60;
const GAME_EMOJI   = '📡';
const GAME_TITLE   = 'Morse Tap';
const GAME_TAGLINE = 'Tap dots and dashes to spell the letter in Morse code.';
const PER_LETTER_MS = 5000; // auto-fail if not submitted in time

// ── Morse code alphabet ────────────────────────────────────────────────────────
const MORSE: Record<string, string> = {
  A: '.-',   B: '-...', C: '-.-.', D: '-..', E: '.',
  F: '..-.', G: '--.',  H: '....', I: '..',  J: '.---',
  K: '-.-',  L: '.-..', M: '--',   N: '-.',  O: '---',
  P: '.--.', Q: '--.-', R: '.-.',  S: '...', T: '-',
  U: '..-',  V: '...-', W: '.--',  X: '-..-',Y: '-.--',
  Z: '--..',
};

// Easy letters first (short codes), harder later
const EASY_LETTERS   = ['E', 'T', 'I', 'A', 'N', 'M', 'S', 'U', 'R', 'O'];
const MEDIUM_LETTERS = ['D', 'K', 'G', 'W', 'H', 'B', 'C', 'F', 'L', 'P'];
const HARD_LETTERS   = ['Q', 'X', 'Y', 'Z', 'J', 'V'];

// ── Signals ───────────────────────────────────────────────────────────────────
interface Signals {
  score: number;
  lettersCompleted: number;
  wrongSubmits: number;
  avgMs: number;
  maxStreak: number;
}

function getPersonality(sig: Signals): string {
  const total = sig.lettersCompleted + sig.wrongSubmits;
  const acc   = total > 0 ? sig.lettersCompleted / total : 0;
  if (sig.lettersCompleted >= 15 && acc >= 0.85) return 'Morse Master 📡';
  if (sig.lettersCompleted >= 10 && acc >= 0.75) return 'Radio Operator 📻';
  if (sig.lettersCompleted >= 6)                 return 'Dot Dasher ⚡';
  return 'Learning the Code 🌊';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ── Letter picking ────────────────────────────────────────────────────────────
function pickLetter(round: number, prev: string): string {
  const pool = round < 5 ? EASY_LETTERS :
               round < 10 ? [...EASY_LETTERS, ...MEDIUM_LETTERS] :
               [...EASY_LETTERS, ...MEDIUM_LETTERS, ...HARD_LETTERS];
  const filtered = pool.filter(l => l !== prev);
  return filtered[Math.floor(Math.random() * filtered.length)];
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function MorseTapGame() {
  const theme        = useBrandTheme();
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const letterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const sigRef    = useRef<Signals>({ score: 0, lettersCompleted: 0, wrongSubmits: 0, avgMs: 0, maxStreak: 0 });
  const streakRef = useRef(0);
  const msTimesRef = useRef<number[]>([]);
  const letterStartRef = useRef(0);
  const roundRef  = useRef(1);

  const [phase, setPhase]           = useState<Phase>('start');
  const [timeLeft, setTimeLeft]     = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]     = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest]   = useState(false);

  const [currentLetter, setCurrentLetter] = useState('');
  const [currentInput, setCurrentInput]   = useState('');
  const [streak, setStreak]         = useState(0);
  const [feedback, setFeedback]     = useState<'correct' | 'wrong' | 'timeout' | null>(null);
  const [letterTimeLeft, setLetterTimeLeft] = useState(1.0);
  const letterTimeRef = useRef(1.0);
  const prevLetterRef = useRef('');

  const clearLetterTimer = useCallback(() => {
    if (letterTimerRef.current) { clearTimeout(letterTimerRef.current); letterTimerRef.current = null; }
  }, []);

  const nextLetter = useCallback((prevLetter = '') => {
    clearLetterTimer();
    const l = pickLetter(roundRef.current, prevLetter);
    prevLetterRef.current = l;
    setCurrentLetter(l);
    setCurrentInput('');
    setFeedback(null);
    letterStartRef.current = Date.now();
    letterTimeRef.current = 1.0;

    // Animate per-letter countdown (smooth progress bar via rAF-like setInterval)
    const startTs = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - startTs;
      const frac = 1 - elapsed / PER_LETTER_MS;
      letterTimeRef.current = Math.max(0, frac);
      setLetterTimeLeft(Math.max(0, frac));
      if (frac <= 0) clearInterval(tick);
    }, 50);

    // Auto-timeout
    letterTimerRef.current = setTimeout(() => {
      clearInterval(tick);
      setFeedback('timeout');
      sigRef.current.wrongSubmits++;
      sigRef.current.score = Math.max(0, sigRef.current.score - 5);
      streakRef.current = 0; setStreak(0);
      sfx.collision(); haptic([20, 30, 20]);
      setTimeout(() => { nextLetter(l); roundRef.current++; }, 600);
    }, PER_LETTER_MS);
  }, [clearLetterTimer]);

  const handleInput = useCallback((symbol: '.' | '-') => {
    const expected = MORSE[currentLetter] ?? '';
    const newInput = currentInput + symbol;

    // Check if prefix is still valid
    if (!expected.startsWith(newInput)) {
      // Invalid sequence
      setFeedback('wrong');
      sigRef.current.wrongSubmits++;
      sigRef.current.score = Math.max(0, sigRef.current.score - 3);
      streakRef.current = 0; setStreak(0);
      sfx.nearMiss(); haptic([20, 30, 20]);
      setTimeout(() => { setCurrentInput(''); setFeedback(null); }, 300);
      return;
    }

    setCurrentInput(newInput);
    sfx.click(); haptic([30]);

    if (newInput === expected) {
      // Complete!
      clearLetterTimer();
      const ms = Date.now() - letterStartRef.current;
      msTimesRef.current.push(ms);
      sigRef.current.lettersCompleted++;
      streakRef.current++;
      if (streakRef.current > sigRef.current.maxStreak) sigRef.current.maxStreak = streakRef.current;
      const speedBonus = ms < 2000 ? 10 : ms < 3500 ? 5 : 0;
      const pts = expected.length * 5 + speedBonus + (streakRef.current >= 3 ? 8 : 0);
      sigRef.current.score += pts;
      setScoreDisplay(sigRef.current.score);
      setStreak(streakRef.current);
      setFeedback('correct');
      sfx.collect(); haptic([30, 50, 30]);
      setTimeout(() => { roundRef.current++; nextLetter(currentLetter); }, 400);
    }
  }, [currentInput, currentLetter, clearLetterTimer, nextLetter]);

  const handleBackspace = useCallback(() => {
    if (currentInput.length > 0) {
      setCurrentInput(prev => prev.slice(0, -1));
      sfx.click();
    }
  }, [currentInput]);

  const endGame = useCallback(() => {
    clearLetterTimer();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.success(); haptic([100]);
    const avg = msTimesRef.current.length > 0
      ? Math.round(msTimesRef.current.reduce((a, b) => a + b, 0) / msTimesRef.current.length) : 0;
    sigRef.current.avgMs = avg;
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0', 10);
      if (sigRef.current.score > pb) { localStorage.setItem(PB_KEY, String(sigRef.current.score)); setIsNewBest(true); }
    } catch { /* ignore */ }
    setFinalSig({ ...sigRef.current });
    setPhase('done');
  }, [clearLetterTimer]);

  const startGame = useCallback(() => {
    sigRef.current = { score: 0, lettersCompleted: 0, wrongSubmits: 0, avgMs: 0, maxStreak: 0 };
    streakRef.current = 0; msTimesRef.current = []; roundRef.current = 1;
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

    setTimeout(() => nextLetter(''), 300);
  }, [endGame, nextLetter]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    clearLetterTimer();
  }, [clearLetterTimer]);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startGame(); }, [startGame]);
  const handlePlayAgain = useCallback(() => {
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false);
    setCurrentLetter(''); setCurrentInput(''); setStreak(0); setFeedback(null);
    setPhase('countdown');
  }, []);

  const buildInsights = useCallback((sig: Signals) => {
    const total = sig.lettersCompleted + sig.wrongSubmits;
    const acc   = total > 0 ? Math.round(sig.lettersCompleted / total * 100) : 0;
    const ac    = theme.colors.accent ?? ACCENT;
    return [
      { label: 'Letters Done',  value: String(sig.lettersCompleted), color: sig.lettersCompleted >= 10 ? '#4ade80' : ac },
      { label: 'Accuracy',      value: `${acc}%`, color: acc >= 85 ? '#4ade80' : acc >= 65 ? '#facc15' : '#ef4444' },
      { label: 'Best Streak',   value: `×${sig.maxStreak}`, color: sig.maxStreak >= 4 ? '#4ade80' : ac },
      { label: 'Avg Speed',     value: sig.avgMs > 0 ? `${(sig.avgMs / 1000).toFixed(1)}s` : '—', color: ac },
    ];
  }, [theme]);

  const accent  = theme.colors.accent ?? ACCENT;
  const morseCurrent = MORSE[currentLetter] ?? '';

  // Render the current input as symbols
  const inputSymbols = currentInput.split('');
  const expectedSymbols = morseCurrent.split('');

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 0%, rgba(251,191,36,0.12) 0%, transparent 55%), linear-gradient(180deg, #0d0a02 0%, #080700 60%, #040300 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}

      {phase === 'playing' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <GameHUD accentColor={accent} items={[
            { label: 'TIME',  value: timeLeft,     danger: timeLeft <= 10, testId: 'timer' },
            { label: 'SCORE', value: scoreDisplay, testId: 'score' },
          ]} />

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 20, padding: '0 20px', width: '100%' }}>

            {/* Streak */}
            {streak >= 3 && (
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fbbf24',
                textShadow: '0 0 10px #fbbf2488', letterSpacing: '0.05em' }}>
                ×{streak} STREAK!
              </div>
            )}

            {/* Letter */}
            <div style={{
              fontSize: 'clamp(72px, 20vw, 108px)', fontWeight: 900,
              color: feedback === 'correct' ? '#4ade80' : feedback === 'wrong' ? '#ef4444' : accent,
              textShadow: `0 0 40px ${feedback === 'correct' ? '#4ade8088' : feedback === 'wrong' ? '#ef444488' : `${accent}88`}`,
              transition: 'color 150ms, text-shadow 150ms',
              lineHeight: 1,
            }}>
              {currentLetter || '?'}
            </div>

            {/* Morse hint */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {morseCurrent.split('').map((sym, i) => (
                <div key={i} style={{
                  fontSize: 22, fontWeight: 700,
                  color: i < currentInput.length
                    ? (feedback === 'wrong' ? '#ef4444' : '#4ade80')
                    : 'rgba(255,255,255,0.2)',
                  transition: 'color 100ms',
                }}>
                  {sym === '.' ? '●' : '—'}
                </div>
              ))}
            </div>

            {/* Per-letter timer bar */}
            <div style={{ width: '100%', maxWidth: 320, height: 4, borderRadius: 2,
              background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${letterTimeLeft * 100}%`,
                background: letterTimeLeft > 0.4 ? accent : letterTimeLeft > 0.2 ? '#facc15' : '#ef4444',
                transition: 'width 50ms linear, background 200ms',
              }} />
            </div>

            {/* Current input display */}
            <div style={{ display: 'flex', gap: 6, minHeight: 40, alignItems: 'center' }} aria-live="polite">
              {inputSymbols.map((sym, i) => (
                <div key={i} style={{
                  width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 8, background: feedback === 'wrong'
                    ? 'rgba(239,68,68,0.25)' : `${accent}22`,
                  border: `2px solid ${feedback === 'wrong' ? '#ef4444' : accent}`,
                  fontSize: 18, fontWeight: 800, color: feedback === 'wrong' ? '#ef4444' : accent,
                }}>
                  {sym === '.' ? '●' : '—'}
                </div>
              ))}
              {inputSymbols.length < expectedSymbols.length && (
                <div style={{ width: 36, height: 36, borderRadius: 8,
                  border: '2px dashed rgba(255,255,255,0.2)' }} />
              )}
            </div>

            {/* DOT / DASH / BACKSPACE buttons */}
            <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
              <button onClick={() => handleInput('.')} aria-label="Dot"
                style={{
                  width: 80, height: 64, borderRadius: 14, cursor: 'pointer',
                  background: `${accent}22`, border: `2px solid ${accent}`,
                  color: accent, fontSize: 26, fontWeight: 900,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  WebkitTapHighlightColor: 'transparent',
                  transition: 'transform 80ms, background 100ms',
                  boxShadow: `0 0 12px ${accent}44`,
                } as React.CSSProperties}>
                ●
              </button>
              <button onClick={() => handleInput('-')} aria-label="Dash"
                style={{
                  width: 80, height: 64, borderRadius: 14, cursor: 'pointer',
                  background: `${accent}22`, border: `2px solid ${accent}`,
                  color: accent, fontSize: 22, fontWeight: 900, letterSpacing: '-2px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  WebkitTapHighlightColor: 'transparent',
                  transition: 'transform 80ms, background 100ms',
                  boxShadow: `0 0 12px ${accent}44`,
                } as React.CSSProperties}>
                —
              </button>
              <button onClick={handleBackspace} aria-label="Backspace"
                style={{
                  width: 60, height: 64, borderRadius: 14, cursor: 'pointer',
                  background: 'rgba(255,255,255,0.06)', border: '2px solid rgba(255,255,255,0.15)',
                  color: 'rgba(255,255,255,0.55)', fontSize: 18,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  WebkitTapHighlightColor: 'transparent',
                } as React.CSSProperties}>
                ⌫
              </button>
            </div>

            {/* Feedback text */}
            {feedback === 'correct' && (
              <div style={{ fontSize: 16, fontWeight: 800, color: '#4ade80' }}>✓ CORRECT!</div>
            )}
            {feedback === 'timeout' && (
              <div style={{ fontSize: 14, fontWeight: 700, color: '#ef4444' }}>⏱ TIME'S UP — was {morseCurrent}</div>
            )}

            {/* Quick reference */}
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.06em',
              textAlign: 'center', marginTop: -8 }}>
              E=● T=— I=●● A=●— N=—● M=—— S=●●●
            </div>
          </div>
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
            onPlayAgain={handlePlayAgain} didWin={finalSig.lettersCompleted >= 8} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
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

