'use client';
import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY_ACCENT = CATEGORY_THEMES.holiday.primaryAccent;

// ─── SPEC CONSTANTS ──────────────────────────────────────────────────────────

const GAME_ID      = 'love-note';
const PB_KEY       = 'pb_love-note';
const ACCENT       = '#ec4899';
const GAME_EMOJI   = '💌';
const GAME_TITLE   = 'Love Note';
const GAME_TAGLINE = 'Remember the sequence. Tap it back. From the heart.';
const GAME_BG      = '#0a0308';
const MAX_LIVES    = 3;

// ─── HEART DEFINITIONS ───────────────────────────────────────────────────────

type HeartId = 'red' | 'pink' | 'purple' | 'gold';

interface Heart {
  id: HeartId;
  emoji: string;
  color: string;
  glow: string;
  idleDelay: string;
}

const HEARTS: Heart[] = [
  { id: 'red',    emoji: '❤️',  color: '#ef4444', glow: 'rgba(239,68,68,0.7)',   idleDelay: '0s'   },
  { id: 'pink',   emoji: '🩷',  color: '#ec4899', glow: 'rgba(236,72,153,0.7)',  idleDelay: '0.5s' },
  { id: 'purple', emoji: '💜',  color: '#a855f7', glow: 'rgba(168,85,247,0.7)',  idleDelay: '1.0s' },
  { id: 'gold',   emoji: '💛',  color: '#f59e0b', glow: 'rgba(245,158,11,0.7)',  idleDelay: '1.5s' },
];

// Pre-computed petal layout — stable, never re-randomized per render
const PETALS = [
  { left: '5%',  size: '14px', duration: '11s', delay: '-2s'   },
  { left: '14%', size: '10px', duration: '9s',  delay: '-7s'   },
  { left: '23%', size: '16px', duration: '13s', delay: '-1s'   },
  { left: '35%', size: '12px', duration: '10s', delay: '-5s'   },
  { left: '47%', size: '14px', duration: '12s', delay: '-3.5s' },
  { left: '58%', size: '10px', duration: '8s',  delay: '-8s'   },
  { left: '67%', size: '16px', duration: '14s', delay: '-0.5s' },
  { left: '76%', size: '12px', duration: '9s',  delay: '-4s'   },
  { left: '85%', size: '14px', duration: '11s', delay: '-6s'   },
  { left: '93%', size: '10px', duration: '10s', delay: '-2.5s' },
];

// ─── SPEED PROGRESSION ───────────────────────────────────────────────────────

// ─── PER-HEART AUDIO ─────────────────────────────────────────────────────────
// Each heart has a distinct sound so players can learn the pattern by ear.
// Maps to a love-chord arpeggio approximation using available sfx:
//   red    → sfx.tick()    (low note — root, C)
//   pink   → sfx.collect() (warm note — major third, E)
//   purple → sfx.shimmer() (ethereal note — perfect fifth, G)
//   gold   → sfx.defuse()  (bright golden note — major seventh, B)
function playHeartSfx(id: HeartId): void {
  switch (id) {
    case 'red':    sfx.tick();    break;
    case 'pink':   sfx.collect(); break;
    case 'purple': sfx.shimmer(); break;
    case 'gold':   sfx.defuse();  break;
  }
}

function getShowSpeed(round: number): number {
  if (round >= 12) return 300;
  if (round >= 8)  return 400;
  if (round >= 5)  return 550;
  return 700;
}

function randomHeart(): HeartId {
  const ids: HeartId[] = ['red', 'pink', 'purple', 'gold'];
  return ids[Math.floor(Math.random() * 4)];
}

// ─── BEHAVIORAL SIGNALS ──────────────────────────────────────────────────────

interface Signals {
  sequenceLength: number;   // current sequence length at game end
  round: number;            // rounds played
  livesRemaining: number;   // lives left at end
  perfectRounds: number;    // rounds with all taps < 600ms
  longestSequence: number;  // longest sequence successfully completed
  wrongTaps: number;        // total wrong taps
  score: number;            // cumulative score
}

// ─── PERSONALITY CLASSIFICATION ──────────────────────────────────────────────
// Deterministic: same inputs → same archetype. Always returns a value.

function getPersonality(sig: Signals): string {
  if (sig.longestSequence >= 12)                       return 'Love Poet 📝';
  if (sig.longestSequence >= 8 && sig.wrongTaps <= 1)  return 'Devoted ❤️‍🔥';
  if (sig.perfectRounds >= 5)                          return 'Sweet Talker 💬';
  if (sig.longestSequence >= 6)                        return 'Hopeful Romantic 🌹';
  return 'Short Love Note 💌';
}

// ─── PHASE TYPES ─────────────────────────────────────────────────────────────

type OuterPhase = 'start' | 'countdown' | 'playing' | 'done';
type GamePhase  = 'showing' | 'input' | 'wrong-pause' | 'round-complete';

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function LoveNoteGame() {
  const theme        = useBrandTheme();
  const stopMusicRef = useRef<(() => void) | null>(null);
  const timeoutRefs  = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ── Outer phase ────────────────────────────────────────────────────────────
  const [outerPhase,  setOuterPhase]  = useState<OuterPhase>('start');

  // ── Display state (drives re-renders) ──────────────────────────────────────
  const [gamePhase,   setGamePhase]   = useState<GamePhase>('showing');
  const [sequence,    setSequence]    = useState<HeartId[]>([]);
  const [showInstructions, setShowInstructions] = useState(true);
  const [lives,       setLives]       = useState(MAX_LIVES);
  const [round,       setRound]       = useState(1);
  const [activeHeart, setActiveHeart] = useState<HeartId | null>(null);
  const [wrongHeart,  setWrongHeart]  = useState<HeartId | null>(null);
  const [roundFlash,  setRoundFlash]  = useState(false);
  const [finalSig,    setFinalSig]    = useState<Signals | null>(null);

  // ── Mutable logic refs (no stale closures in callbacks) ────────────────────
  const sequenceRef     = useRef<HeartId[]>([]);
  const playerIndexRef  = useRef(0);
  const livesRef        = useRef(MAX_LIVES);
  const roundRef        = useRef(1);
  const gamePhasRef     = useRef<GamePhase>('showing');
  const tapTimesRef     = useRef<number[]>([]);
  const lastTapTimeRef  = useRef(0);
  const sigRef          = useRef<Signals>({
    sequenceLength: 1, round: 1, livesRemaining: MAX_LIVES,
    perfectRounds: 0, longestSequence: 0, wrongTaps: 0, score: 0,
  });

  // ── Player session ─────────────────────────────────────────────────────────
  const [playerName,   setPlayerName]   = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const { pops, triggerPop } = useScorePop();
  const [streak, setStreak] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const prevScoreRef = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const numScore = 0;
    if (numScore > prevScoreRef.current) {
      triggerPop(`+${numScore - prevScoreRef.current}`, window.innerWidth / 2, 200);
      hapticScore();
      playScoreHit('default', numScore - prevScoreRef.current);
      setStreak(Math.floor(numScore / 5));
    }
    prevScoreRef.current = numScore;
  }, [0]);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  // ─── TIMEOUT HELPERS ───────────────────────────────────────────────────────

  const clearAllTimeouts = useCallback(() => {
    timeoutRefs.current.forEach(clearTimeout);
    timeoutRefs.current = [];
  }, []);

  const addTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timeoutRefs.current.push(id);
  }, []);

  // ─── END GAME ──────────────────────────────────────────────────────────────

  const endGame = useCallback(() => {
    clearAllTimeouts();
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    // Personal best tracking
    try {
      const _pbPrev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      const _pbVal = parseFloat(String(0));
      if (!isNaN(_pbVal) && _pbVal > _pbPrev) {
        localStorage.setItem(PB_KEY, String(Math.round(_pbVal)));
        setIsNewBest(true);
      }
    } catch { /* ignore */ }


    setFinalSig({ ...sigRef.current });
    setOuterPhase('done');
  }, [clearAllTimeouts]);

  // ─── SHOW SEQUENCE ─────────────────────────────────────────────────────────
  // Lights up each heart in the sequence in order, then opens input phase.

  const showSequence = useCallback((seq: HeartId[]) => {
    clearAllTimeouts();
    setGamePhase('showing');
    gamePhasRef.current = 'showing';
    setActiveHeart(null);
    setWrongHeart(null);

    const speed       = getShowSpeed(roundRef.current);
    const litDuration = Math.round(speed * 0.55); // how long each heart stays lit

    seq.forEach((heartId, i) => {
      // Light up — each heart plays its distinct note (love chord arpeggio)
      addTimeout(() => {
        setActiveHeart(heartId);
        playHeartSfx(heartId);
        haptic([15]);
      }, 450 + i * speed);

      // Turn off
      addTimeout(() => {
        setActiveHeart(null);
      }, 450 + i * speed + litDuration);
    });

    // Transition to input phase after all hearts shown
    addTimeout(() => {
      setGamePhase('input');
      gamePhasRef.current = 'input';
      playerIndexRef.current = 0;
      tapTimesRef.current    = [];
      lastTapTimeRef.current = Date.now();
    }, 450 + seq.length * speed + 350);
  }, [clearAllTimeouts, addTimeout]);

  // ─── HANDLE HEART TAP ──────────────────────────────────────────────────────

  const handleHeartTap = useCallback((heartId: HeartId) => {
    if (gamePhasRef.current !== 'input') return;

    const seq      = sequenceRef.current;
    const idx      = playerIndexRef.current;
    const expected = seq[idx];
    const now      = Date.now();

    if (heartId === expected) {
      // ✅ Correct tap — play heart's distinct note (matches the sequence sound)
      playHeartSfx(heartId);
      haptic([20]);
      tapTimesRef.current.push(now - lastTapTimeRef.current);
      lastTapTimeRef.current = now;
      playerIndexRef.current++;

      if (playerIndexRef.current >= seq.length) {
        // 🎉 Round complete!
        setGamePhase('round-complete');
        gamePhasRef.current = 'round-complete';

        // Perfect round: all taps were fast (< 600ms between taps)
        const isPerfect =
          tapTimesRef.current.length > 0 &&
          tapTimesRef.current.every(t => t < 600);
        if (isPerfect) {
          sigRef.current.perfectRounds++;
          sigRef.current.score += 1; // bonus point
        }

        // Update longest sequence
        if (seq.length > sigRef.current.longestSequence) {
          sigRef.current.longestSequence = seq.length;
        }
        sigRef.current.score += seq.length;

        sfx.success();
        haptic([30, 40, 30]);
        setRoundFlash(true);

        // Advance to next round after brief celebration
        addTimeout(() => {
          setRoundFlash(false);
          const newRound = roundRef.current + 1;
          roundRef.current = newRound;
          setRound(newRound);

          const newSeq: HeartId[] = [...seq, randomHeart()];
          sequenceRef.current = newSeq;
          setSequence([...newSeq]);

          sigRef.current.round          = newRound;
          sigRef.current.sequenceLength = newSeq.length;

          showSequence(newSeq);
        }, 900);
      }

    } else {
      // ❌ Wrong tap
      sfx.collision();
      haptic([200]);

      setWrongHeart(heartId);
      sigRef.current.wrongTaps++;

      const newLives = livesRef.current - 1;
      livesRef.current              = newLives;
      sigRef.current.livesRemaining = newLives;
      setLives(newLives);
      setGamePhase('wrong-pause');
      gamePhasRef.current = 'wrong-pause';

      // Clear wrong heart highlight after animation
      addTimeout(() => setWrongHeart(null), 700);

      if (newLives <= 0) {
        // Update longest sequence on death
        if (seq.length > sigRef.current.longestSequence) {
          sigRef.current.longestSequence = seq.length;
        }
        sfx.fail();
        addTimeout(() => endGame(), 900);
      } else {
        // Re-show sequence after pause
        addTimeout(() => showSequence(seq), 1400);
      }
    }
  }, [addTimeout, showSequence, endGame]);

  // ─── START GAME ────────────────────────────────────────────────────────────

  const startGameLoop = useCallback(() => {
    const firstHeart      = randomHeart();
    const initialSeq: HeartId[] = [firstHeart];

    sequenceRef.current    = initialSeq;
    livesRef.current       = MAX_LIVES;
    roundRef.current       = 1;
    playerIndexRef.current = 0;
    tapTimesRef.current    = [];
    lastTapTimeRef.current = 0;
    sigRef.current = {
      sequenceLength: 1, round: 1, livesRemaining: MAX_LIVES,
      perfectRounds: 0, longestSequence: 0, wrongTaps: 0, score: 0,
    };

    setSequence(initialSeq);
    setLives(MAX_LIVES);
    setRound(1);
    setActiveHeart(null);
    setWrongHeart(null);
    setRoundFlash(false);
    setOuterPhase('playing');

    stopMusicRef.current = startMusic('calm');
    showSequence(initialSeq);
  }, [showSequence]);

  // ─── PHASE TRANSITIONS ────────────────────────────────────────────────────

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    await initAudio(); sfx.click();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setOuterPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => {
    startGameLoop();
  }, [startGameLoop]);

  const handlePlayAgain = useCallback(() => {
    setOuterPhase('start');
    setFinalSig(null);
  }, []);

  // ─── CLEANUP ON UNMOUNT ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      clearAllTimeouts();
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, [clearAllTimeouts]);

  // ─── END SCREEN INSIGHTS ─────────────────────────────────────────────────

  function buildInsights(sig: Signals) {
    return [
      {
        label: 'Note Length',
        value: `${sig.longestSequence} hearts`,
        color: sig.longestSequence >= 8 ? '#4ade80' : sig.longestSequence >= 5 ? '#facc15' : '#ef4444',
      },
      {
        label: 'Perfect Rounds',
        value: String(sig.perfectRounds),
        color: ACCENT,
      },
      {
        label: 'Wrong Taps',
        value: String(sig.wrongTaps),
        color: sig.wrongTaps <= 2 ? '#4ade80' : sig.wrongTaps <= 5 ? '#facc15' : '#ef4444',
      },
      {
        label: 'Rounds Survived',
        value: String(sig.round),
        color: 'var(--color-text)',
      },
    ];
  }

  // ─── HEART BUTTON STYLE ───────────────────────────────────────────────────

  function heartButtonStyle(heart: Heart): CSSProperties {
    const isActive = activeHeart === heart.id;
    const isWrong  = wrongHeart  === heart.id;
    const canTap   = gamePhase === 'input';

    return {
      width: 100,
      height: 100,
      borderRadius: '50%',
      border: `3px solid ${isWrong ? '#ef4444' : heart.color}`,
      background: isActive
        ? `radial-gradient(circle at 40% 35%, ${heart.color}ee 0%, ${heart.color}88 50%, ${heart.color}22 100%)`
        : isWrong
        ? 'radial-gradient(circle at 40% 35%, rgba(239,68,68,0.5) 0%, rgba(239,68,68,0.1) 100%)'
        : `radial-gradient(circle at 40% 35%, ${heart.color}44 0%, ${heart.color}11 100%)`,
      boxShadow: isActive
        ? `0 0 36px 14px ${heart.glow}, 0 0 80px 32px ${heart.glow.replace('0.7', '0.25')}, inset 0 0 20px ${heart.color}44`
        : isWrong
        ? '0 0 28px 12px rgba(239,68,68,0.55), inset 0 0 14px rgba(239,68,68,0.3)'
        : `0 0 12px 4px ${heart.glow.replace('0.7', '0.1')}`,
      fontSize: 44,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: canTap ? 'pointer' : 'default',
      transform: isActive ? 'scale(1.18)' : isWrong ? 'scale(0.88)' : 'scale(1)',
      transition: 'transform 0.13s ease-out, box-shadow 0.13s ease-out, background 0.13s ease-out, border-color 0.13s ease-out',
      animation: !isActive && !isWrong
        ? `heartIdle 2.4s ${heart.idleDelay} ease-in-out infinite`
        : 'none',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      touchAction: 'manipulation',
      outline: 'none',
      flexShrink: 0,
    };
  }

  // ─── PHASE STATUS LABEL ───────────────────────────────────────────────────

  function getPhaseLabel(): string {
    switch (gamePhase) {
      case 'showing':        return 'Watch closely... 👀';
      case 'input':          return 'Your turn! 💕';
      case 'round-complete': return 'Perfect! ✨';
      case 'wrong-pause':    return 'Oops! 💔';
    }
  }

  const accentColor = theme.colors.accent ?? ACCENT;

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accentColor}>
      {showInstructions && (
        <SwipeInstructions
          gameId="love-note"
          steps={[{ icon: "🎵", title: "Tap in rhythm", body: "Tap along with the falling music notes." }, { icon: "❤️", title: "Hit on the beat", body: "Perfect timing scores the most points." }, { icon: "🔥", title: "Build combos", body: "Consecutive perfect taps multiply your score." }]}
          onDone={() => setShowInstructions(false)}
        />
      )}

      {/* ── CSS Keyframes ─────────────────────────────────────────────────── */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes heartIdle {
          0%, 100% { transform: scale(1); }
          50%       { transform: scale(1.06); }
        }
        @keyframes petalDrift {
          0%   { transform: translateY(105vh) rotate(0deg);   opacity: 0;    }
          8%   { opacity: 0.6; }
          50%  { transform: translateY(50vh)  rotate(180deg) translateX(12px); opacity: 0.4; }
          92%  { opacity: 0.2; }
          100% { transform: translateY(-8vh)  rotate(360deg) translateX(-8px); opacity: 0; }
        }
        @keyframes roundGlow {
          0%   { background: #0a0308; }
          35%  { background: #1a0514; }
          100% { background: #0a0308; }
        }
      `}} />

      {/* ── Start Screen ──────────────────────────────────────────────────── */}
      {outerPhase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Play 💌"
          accentColor={accentColor}
          onStart={handleStart}
        />
      )}

      {/* ── Countdown ─────────────────────────────────────────────────────── */}
      {outerPhase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={accentColor} />
      )}

      {/* ── Playing ───────────────────────────────────────────────────────── */}
      {outerPhase === 'playing' && (
        <div
          data-game="love-note"
          style={{
            position: 'absolute',
            inset: 0,
            top: 56,
            background: GAME_BG,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            paddingTop: 80,   // clear the floating HUD
            paddingBottom: 24,
            overflow: 'hidden',
            animation: roundFlash ? 'roundGlow 0.7s ease-out' : 'none',
          }}
        >
          {/* ── Rose petals background ──────────────────────────────────── */}
          {PETALS.map((p, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: p.left,
                bottom: 0,
                fontSize: p.size,
                animation: `petalDrift ${p.duration} ${p.delay} ease-in-out infinite`,
                pointerEvents: 'none',
                zIndex: 0,
                willChange: 'transform',
              }}
            >
              🌸
            </div>
          ))}

          {/* ── HUD ─────────────────────────────────────────────────────── */}
          <GameHUD
            accentColor={accentColor}
            items={[
              { label: 'NOTE LENGTH 💌', value: sequence.length },
              { label: 'HEARTS ❤️',     value: lives },
              { label: 'ROUND',          value: round },
            ]}
          />

          {/* ── Lives ───────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 18, zIndex: 1 }}>
            {Array.from({ length: MAX_LIVES }).map((_, i) => (
              <span
                key={i}
                style={{
                  fontSize: 28,
                  display: 'inline-block',
                  transition: 'all 0.35s ease',
                  opacity: i < lives ? 1 : 0.22,
                  transform: i === lives ? 'scale(0.75) rotate(-10deg)' : 'scale(1)',
                  filter: i >= lives ? 'grayscale(1)' : 'none',
                }}
              >
                {i < lives ? '💗' : '🩶'}
              </span>
            ))}
          </div>

          {/* ── Phase status ────────────────────────────────────────────── */}
          <div style={{
            color: 'rgba(255,255,255,0.6)',
            fontSize: 14,
            letterSpacing: '0.05em',
            marginBottom: 6,
            zIndex: 1,
            minHeight: 20,
          }}>
            {getPhaseLabel()}
          </div>

          {/* ── Sequence length label ────────────────────────────────────── */}
          <div style={{
            color: accentColor,
            fontSize: 15,
            fontWeight: 700,
            marginBottom: 28,
            zIndex: 1,
            letterSpacing: '-0.2px',
          }}>
            Your love note is {sequence.length} heart{sequence.length !== 1 ? 's' : ''} long 💌
          </div>

          {/* ── 2×2 Heart grid ──────────────────────────────────────────── */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 24,
            zIndex: 1,
          }}>
            {HEARTS.map((heart) => (
              <button
                key={heart.id}
                onClick={() => handleHeartTap(heart.id)}
                disabled={gamePhase !== 'input'}
                style={heartButtonStyle(heart)}
                aria-label={`${heart.id} heart`}
              >
                {heart.emoji}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* New best banner */}
      <AnimatePresence>
        {isNewBest && (
          <motion.div
            key="new-best"
            initial={{ opacity: 0, y: -20, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, delay: 0.5 }}
            style={{
              position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)',
              zIndex: 90, pointerEvents: 'none',
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
              borderRadius: 20, padding: '8px 20px', fontSize: 20,
              fontWeight: 900, color: '#000', whiteSpace: 'nowrap',
              boxShadow: '0 4px 20px rgba(251,191,36,0.5)',
            }}
          >
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>



      {/* ── End Screen ────────────────────────────────────────────────────── */}
      {outerPhase === 'done' && finalSig && (
        <EndScreen
          gameId={GAME_ID}
          title={`Love Note: ${finalSig.longestSequence} hearts 💌`}
          emoji={GAME_EMOJI}
          score={String(finalSig.longestSequence)}
          personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)}
          accentColor={accentColor}
          onPlayAgain={handlePlayAgain}
          didWin={finalSig.longestSequence >= 6}
        />
      )}

      {/* ── Webhook (fires exactly once on mount) ─────────────────────────── */}
      {outerPhase === 'done' && finalSig && (
        <WebhookEmitter
          theme={theme}
          sig={finalSig}
          personality={getPersonality(finalSig)}
          player={playerSessionRef.current}
        />
      )}

      {outerPhase === 'playing' && (
        <>
          <ScorePopEffect pops={pops} accentColor={CATEGORY_ACCENT} />
          <StreakBadge streak={streak} accentColor={CATEGORY_ACCENT} />
        </>
      )}
    </GameShell>
  );
}

// ─── WEBHOOK EMITTER ─────────────────────────────────────────────────────────
// Isolated component so postWebhook fires exactly once on mount.

function WebhookEmitter({ theme, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>;
  sig: Signals;
  personality: string;
  player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    postWebhook(theme, GAME_ID, {
      personality,
      score:           sig.longestSequence,
      longestSequence: sig.longestSequence,
      sequenceLength:  sig.sequenceLength,
      round:           sig.round,
      livesRemaining:  sig.livesRemaining,
      perfectRounds:   sig.perfectRounds,
      wrongTaps:       sig.wrongTaps,
    }, player);
  }, [theme, sig, personality, player]);
  return null;
}
