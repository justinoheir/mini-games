/**
 * ══════════════════════════════════════════════════════════════════
 *  ETHER MINI-GAMES — TYPE SPEED
 *  A word appears. Tap the letters in order on the on-screen keyboard.
 *  Speed and accuracy build your score.
 *
 *  Signals: wordsCompleted, totalLetters, wrongTaps, avgWordMs
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
const GAME_ID   = 'type-speed';
const PB_KEY    = 'mg_pb_type-speed';
const ACCENT    = '#34d399';
const DURATION  = 45;
const GAME_EMOJI   = '⌨️';
const GAME_TITLE   = 'Type Speed';
const GAME_TAGLINE = 'Tap the letters in order as fast as you can.';

// ── Word bank ─────────────────────────────────────────────────────────────────
const WORDS = [
  'BLAZE', 'SHARP', 'QUICK', 'FROST', 'STORM',
  'FLASH', 'DRIVE', 'SPARK', 'LIGHT', 'POWER',
  'BRAVE', 'CRAFT', 'BOUND', 'CLIMB', 'DREAM',
  'ELITE', 'FOCUS', 'GRASP', 'HASTE', 'IGNITE',
  'JUMP', 'KEEN', 'LEAN', 'MOVE', 'NEXT',
  'OPEN', 'PUSH', 'RUSH', 'SWIFT', 'THINK',
];

// QWERTY layout rows
const KEY_ROWS = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['Z','X','C','V','B','N','M','⌫'],
];

// ── Signals ───────────────────────────────────────────────────────────────────
interface Signals {
  score: number;
  wordsCompleted: number;
  totalLetters: number;
  wrongTaps: number;
  avgWordMs: number;
}

function getPersonality(sig: Signals): string {
  const total = sig.totalLetters + sig.wrongTaps;
  const acc   = total > 0 ? sig.totalLetters / total : 0;
  if (sig.wordsCompleted >= 10 && acc >= 0.90) return 'Speed Typist ⌨️';
  if (sig.wordsCompleted >= 7  && acc >= 0.80) return 'Fast Fingers 🤙';
  if (sig.wordsCompleted >= 5)                 return 'Rapid Tapper ⚡';
  return 'Finding the Rhythm 🌊';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ── Helpers ───────────────────────────────────────────────────────────────────
function pickWord(prev: string): string {
  const pool = WORDS.filter(w => w !== prev);
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function TypeSpeedGame() {
  const theme        = useBrandTheme();
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const sigRef       = useRef<Signals>({ score: 0, wordsCompleted: 0, totalLetters: 0, wrongTaps: 0, avgWordMs: 0 });
  const wordTimesRef = useRef<number[]>([]);
  const wordStartRef = useRef(0);
  const letterIdxRef = useRef(0);

  const [phase, setPhase]           = useState<Phase>('start');
  const [timeLeft, setTimeLeft]     = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]     = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest]   = useState(false);

  const [currentWord, setCurrentWord] = useState('');
  const [letterIdx, setLetterIdx]   = useState(0);
  const [keyFlash, setKeyFlash]     = useState<{ key: string; type: 'hit' | 'miss' } | null>(null);
  const [wordFlash, setWordFlash]   = useState<'correct' | null>(null);
  const [streak, setStreak]         = useState(0);
  const streakRef = useRef(0);

  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nextWord = useCallback((prev = '') => {
    const w = pickWord(prev);
    setCurrentWord(w);
    setLetterIdx(0);
    letterIdxRef.current = 0;
    wordStartRef.current = Date.now();
  }, []);

  const endGame = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.success(); haptic([100]);
    const avg = wordTimesRef.current.length > 0
      ? Math.round(wordTimesRef.current.reduce((a, b) => a + b, 0) / wordTimesRef.current.length) : 0;
    sigRef.current.avgWordMs = avg;
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0', 10);
      if (sigRef.current.score > pb) { localStorage.setItem(PB_KEY, String(sigRef.current.score)); setIsNewBest(true); }
    } catch { /* ignore */ }
    setFinalSig({ ...sigRef.current });
    setPhase('done');
  }, []);

  const startGame = useCallback(() => {
    sigRef.current = { score: 0, wordsCompleted: 0, totalLetters: 0, wrongTaps: 0, avgWordMs: 0 };
    streakRef.current = 0; wordTimesRef.current = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setStreak(0);
    setPhase('playing');
    stopMusicRef.current = startMusic('minimal');
    nextWord('');

    let t = DURATION;
    timerRef.current = setInterval(() => {
      t--;
      setTimeLeft(t);
      if (t === 10) sfx.warning();
      if (t > 0 && t < 10) sfx.tick();
      if (t <= 0) endGame();
    }, 1000);
  }, [endGame, nextWord]);

  const handleKey = useCallback((key: string) => {
    if (flashTimer.current) { clearTimeout(flashTimer.current); flashTimer.current = null; }

    if (key === '⌫') {
      // Backspace: move back one letter (no penalty)
      if (letterIdxRef.current > 0) {
        letterIdxRef.current--;
        setLetterIdx(letterIdxRef.current);
        setKeyFlash({ key, type: 'hit' });
        flashTimer.current = setTimeout(() => setKeyFlash(null), 150);
      }
      return;
    }

    const word = currentWord;
    const idx  = letterIdxRef.current;
    if (idx >= word.length) return;

    const expected = word[idx];
    if (key === expected) {
      letterIdxRef.current++;
      setLetterIdx(letterIdxRef.current);
      setKeyFlash({ key, type: 'hit' });
      sigRef.current.totalLetters++;
      sfx.click(); haptic([30]);

      if (letterIdxRef.current >= word.length) {
        // Word complete!
        const wordMs = Date.now() - wordStartRef.current;
        wordTimesRef.current.push(wordMs);
        sigRef.current.wordsCompleted++;
        streakRef.current++;
        if (streakRef.current > (sigRef.current as unknown as { maxStreak?: number }).maxStreak ?? 0) {
          // no maxStreak in Signals, track via streak
        }
        const speedBonus = wordMs < 2500 ? 15 : wordMs < 4000 ? 8 : 0;
        const pts = word.length * 4 + speedBonus + (streakRef.current >= 3 ? 10 : 0);
        sigRef.current.score += pts;
        setScoreDisplay(sigRef.current.score);
        setStreak(streakRef.current);
        setWordFlash('correct');
        sfx.collect(); haptic([30, 50, 30]);
        setTimeout(() => { setWordFlash(null); nextWord(word); }, 300);
      }
    } else {
      setKeyFlash({ key, type: 'miss' });
      sigRef.current.wrongTaps++;
      streakRef.current = 0; setStreak(0);
      sigRef.current.score = Math.max(0, sigRef.current.score - 2);
      setScoreDisplay(sigRef.current.score);
      sfx.nearMiss(); haptic([20, 30, 20]);
    }

    flashTimer.current = setTimeout(() => setKeyFlash(null), 150);
  }, [currentWord, nextWord]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startGame(); }, [startGame]);
  const handlePlayAgain = useCallback(() => {
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false);
    setCurrentWord(''); setLetterIdx(0); setStreak(0); setWordFlash(null); setKeyFlash(null);
    setPhase('countdown');
  }, []);

  const buildInsights = useCallback((sig: Signals) => {
    const total = sig.totalLetters + sig.wrongTaps;
    const acc   = total > 0 ? Math.round(sig.totalLetters / total * 100) : 0;
    const ac    = theme.colors.accent ?? ACCENT;
    return [
      { label: 'Words Done',  value: String(sig.wordsCompleted), color: sig.wordsCompleted >= 8 ? '#4ade80' : ac },
      { label: 'Accuracy',    value: `${acc}%`, color: acc >= 90 ? '#4ade80' : acc >= 75 ? '#facc15' : '#ef4444' },
      { label: 'Letters Typed',value: String(sig.totalLetters), color: ac },
      { label: 'Avg Word',    value: sig.avgWordMs > 0 ? `${(sig.avgWordMs / 1000).toFixed(1)}s` : '—', color: ac },
    ];
  }, [theme]);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 0%, rgba(52,211,153,0.12) 0%, transparent 55%), linear-gradient(180deg, #030d09 0%, #020a06 60%, #010503 100%)">
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

          {/* Word display */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 12, padding: '0 16px' }}>

            {/* Streak */}
            {streak >= 3 && (
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fbbf24',
                textShadow: '0 0 10px #fbbf2488', letterSpacing: '0.05em' }}>
                ×{streak} STREAK!
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}
              aria-live="polite" aria-label={`Current word: ${currentWord}`}>
              {currentWord.split('').map((letter, i) => (
                <div key={i} style={{
                  width: 38, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 8, border: '2px solid',
                  borderColor: i < letterIdx ? '#4ade80' :
                               i === letterIdx ? accent : 'rgba(255,255,255,0.15)',
                  background: i < letterIdx ? 'rgba(74,222,128,0.15)' :
                              i === letterIdx
                                ? `${accent}22`
                                : 'rgba(255,255,255,0.04)',
                  fontSize: 22, fontWeight: 800, color:
                    i < letterIdx ? '#4ade80' :
                    i === letterIdx ? accent : 'rgba(255,255,255,0.3)',
                  transition: 'all 120ms',
                  transform: i === letterIdx && wordFlash !== 'correct'
                    ? 'scale(1.1)' : 'scale(1)',
                  boxShadow: i === letterIdx ? `0 0 12px ${accent}66` : 'none',
                }}>
                  {letter}
                </div>
              ))}
            </div>

            {/* Word complete flash */}
            {wordFlash === 'correct' && (
              <div style={{ fontSize: 18, fontWeight: 800, color: '#4ade80',
                textShadow: '0 0 16px #4ade8088', letterSpacing: '0.06em' }}>
                ✓ NICE!
              </div>
            )}
          </div>

          {/* QWERTY keyboard */}
          <div style={{ width: '100%', maxWidth: 460, padding: '0 6px 16px', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {KEY_ROWS.map((row, ri) => (
              <div key={ri} style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>
                {row.map(key => {
                  const isFlash = keyFlash?.key === key;
                  const isNext  = currentWord[letterIdx] === key;
                  const isBackspace = key === '⌫';
                  return (
                    <button
                      key={key}
                      onClick={() => handleKey(key)}
                      aria-label={key === '⌫' ? 'backspace' : key}
                      style={{
                        width: isBackspace ? 50 : 32,
                        height: 44,
                        borderRadius: 7,
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: isBackspace ? 16 : 14,
                        fontWeight: 700,
                        background: isFlash
                          ? (keyFlash?.type === 'hit' ? accent : '#ef4444')
                          : isNext
                            ? `${accent}22`
                            : 'rgba(255,255,255,0.09)',
                        color: isFlash
                          ? '#fff'
                          : isNext ? accent : 'rgba(255,255,255,0.75)',
                        boxShadow: isNext ? `0 0 8px ${accent}55` : 'none',
                        border: `1px solid ${isNext ? accent : 'rgba(255,255,255,0.1)'}`,
                        transition: 'background 100ms, transform 80ms',
                        transform: isFlash ? 'scale(0.92)' : 'scale(1)',
                        WebkitTapHighlightColor: 'transparent',
                      } as React.CSSProperties}>
                      {key}
                    </button>
                  );
                })}
              </div>
            ))}
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
            onPlayAgain={handlePlayAgain} didWin={finalSig.wordsCompleted >= 5} />
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
