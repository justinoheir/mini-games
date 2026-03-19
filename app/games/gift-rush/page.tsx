'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
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
import { Gift, Trophy, Gem, Cookie, Trash2, Star, Snowflake } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY_ACCENT = CATEGORY_THEMES.holiday.primaryAccent;

// ─── SPEC CONSTANTS ──────────────────────────────────────────────────────────
const GAME_ID      = 'gift-rush';
const PB_KEY       = 'pb_gift-rush';
const ACCENT       = '#ef4444';
const DURATION     = 45;
const GAME_EMOJI   = '🎁';
const GAME_TITLE   = 'Gift Rush';
const GAME_TAGLINE = "Swipe left or right. Fast. Santa's watching.";
const SWIPE_THRESHOLD = 60;

// ─── ITEMS ───────────────────────────────────────────────────────────────────
// Icon types for each game item (no emojis in gameplay UI — using Lucide React icons)
type ItemIconType = 'gift' | 'trophy' | 'gem' | 'cookie' | 'trash' | 'star';

interface GameItem {
  id: string;
  iconType: ItemIconType;
  iconColor: string;
  correct: 'right' | 'left';
  points: number;
  label: string;
  rare: boolean;
}

const ITEMS: GameItem[] = [
  { id: 'gift_red',  iconType: 'gift',   iconColor: '#ef4444', correct: 'right', points: 1, label: 'Gift',         rare: false },
  { id: 'gift_gold', iconType: 'trophy', iconColor: '#facc15', correct: 'right', points: 2, label: 'Golden Gift',  rare: true  },
  { id: 'coal',      iconType: 'gem',    iconColor: '#6b7280', correct: 'left',  points: 1, label: 'Coal',         rare: false },
  { id: 'cookie',    iconType: 'cookie', iconColor: '#d97706', correct: 'right', points: 1, label: 'Cookie',       rare: false },
  { id: 'rotten',    iconType: 'trash',  iconColor: '#65a30d', correct: 'left',  points: 1, label: 'Rotten',       rare: false },
  { id: 'star',      iconType: 'star',   iconColor: '#facc15', correct: 'right', points: 3, label: 'Star',         rare: true  },
];

/** Render the correct Lucide icon for a game item */
function ItemIcon({ type, color, size = 72 }: { type: ItemIconType; color: string; size?: number }) {
  const props = { size, color, strokeWidth: 1.8 };
  switch (type) {
    case 'gift':   return <Gift   {...props} />;
    case 'trophy': return <Trophy {...props} />;
    case 'gem':    return <Gem    {...props} />;
    case 'cookie': return <Cookie {...props} />;
    case 'trash':  return <Trash2 {...props} />;
    case 'star':   return <Star   {...props} fill={color} />;
    default:       return <Gift   {...props} />;
  }
}

function pickItem(): GameItem {
  const rand = Math.random();
  if (rand < 0.07) return ITEMS[1]; // gift_gold (rare)
  if (rand < 0.14) return ITEMS[5]; // star (rare)
  const regular = [ITEMS[0], ITEMS[2], ITEMS[3], ITEMS[4]];
  return regular[Math.floor(Math.random() * regular.length)];
}

// ─── SPEED STAGES ────────────────────────────────────────────────────────────
function getIntervalMs(elapsedSeconds: number): number {
  if (elapsedSeconds >= 30) return 1000;
  if (elapsedSeconds >= 15) return 1400;
  return 1800;
}

// ─── SIGNALS ─────────────────────────────────────────────────────────────────
interface Signals {
  score: number;
  wrongSwipes: number;
  streakCurrent: number;
  maxStreak: number;
  decisionTimes: number[];
  specialItemsCaught: number;
}

// ─── PERSONALITY ─────────────────────────────────────────────────────────────
function getPersonality(sig: Signals): string {
  const avgDecision =
    sig.decisionTimes.length > 0
      ? sig.decisionTimes.reduce((a, b) => a + b, 0) / sig.decisionTimes.length
      : 9999;

  if (sig.score >= 30 && sig.wrongSwipes <= 2) return "Santa's MVP 🎅";
  if (sig.maxStreak >= 10)                      return 'The Elf 🧝';
  if (avgDecision < 600 && sig.score >= 20)     return 'Quick Sorter ⚡';
  if (sig.wrongSwipes === 0)                    return 'Coal Dodger 🪨';
  if (sig.score >= 20)                          return 'Gift Giver 🎁';
  return 'Still Learning 🌱';
}

// ─── SNOWFLAKES (static layout, created once outside component) ──────────────
interface Snowflake {
  id: number;
  left: string;
  delay: string;
  duration: string;
  size: number;
  opacity: number;
}

const SNOWFLAKES: Snowflake[] = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  left: `${(i * 5.3 + Math.sin(i * 1.7) * 20 + 50) % 100}%`,
  delay: `${(i * 0.43) % 8}s`,
  duration: `${6 + (i * 0.37) % 8}s`,
  size: 10 + (i * 0.7) % 14,
  opacity: 0.3 + (i * 0.035) % 0.5,
}));

// ─── PHASE TYPES ─────────────────────────────────────────────────────────────
type GamePhase = 'start' | 'countdown' | 'playing' | 'done';
type CardPhase = 'entering' | 'idle' | 'exiting-right' | 'exiting-left';

// ─── COMPONENT ───────────────────────────────────────────────────────────────
export default function GiftRushGame() {
  const theme       = useBrandTheme();
  const stopMusicRef = useRef<(() => void) | null>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoAdvRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardSpawnRef = useRef<number>(0);
  const runningRef   = useRef(false);
  const elapsedRef   = useRef(0);
  const isDraggingRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  const sigRef = useRef<Signals>({
    score: 0,
    wrongSwipes: 0,
    streakCurrent: 0,
    maxStreak: 0,
    decisionTimes: [],
    specialItemsCaught: 0,
  });

  const [phase, setPhase]               = useState<GamePhase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streakDisplay, setStreakDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);

  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const { pops, triggerPop } = useScorePop();
  const [streak, setStreak] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const prevScoreRef = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const numScore = typeof scoreDisplay === 'number' ? scoreDisplay : 0;
    if (numScore > prevScoreRef.current) {
      triggerPop(`+${numScore - prevScoreRef.current}`, window.innerWidth / 2, 200);
      hapticScore();
      playScoreHit('default', numScore - prevScoreRef.current);
      setStreak(Math.floor(numScore / 5));
    }
    prevScoreRef.current = numScore;
  }, [scoreDisplay]); // triggerPop is stable
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  // Card render state
  const [currentCard, setCurrentCard]   = useState<GameItem | null>(null);
  const [cardPhase, setCardPhase]       = useState<CardPhase>('entering');
  const [cardDx, setCardDx]             = useState(0);
  const [feedback, setFeedback]         = useState<'correct' | 'wrong' | null>(null);
  const [scorePopKey, setScorePopKey]   = useState(0);
  const [scorePopText, setScorePopText] = useState('');
  const [milestoneKey, setMilestoneKey] = useState(0);
  const [milestoneLabel, setMilestoneLabel] = useState('');

  // ─── HELPERS ───────────────────────────────────────────────────────────────
  const clearAutoAdv = useCallback(() => {
    if (autoAdvRef.current) {
      clearTimeout(autoAdvRef.current);
      autoAdvRef.current = null;
    }
  }, []);

  // ─── SPAWN CARD ────────────────────────────────────────────────────────────
  const spawnCard = useCallback(() => {
    if (!runningRef.current) return;
    const item = pickItem();
    setCurrentCard(item);
    setCardPhase('entering');
    setCardDx(0);
    cardSpawnRef.current = Date.now();

    const intervalMs = getIntervalMs(elapsedRef.current);
    clearAutoAdv();
    autoAdvRef.current = setTimeout(() => {
      if (!runningRef.current) return;
      // Auto-miss: no score change, just advance
      sigRef.current.streakCurrent = 0;
      setStreakDisplay(0);
      setCardPhase('exiting-left');
      setTimeout(() => {
        if (runningRef.current) spawnCard();
      }, 320);
    }, intervalMs);
  }, [clearAutoAdv]);

  // ─── END GAME ──────────────────────────────────────────────────────────────
  const endGame = useCallback(() => {
    runningRef.current = false;
    clearAutoAdv();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    // Personal best tracking
    try {
      const _pbPrev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      const _pbVal = parseFloat(String(sigRef.current?.score ?? 0));
      if (!isNaN(_pbVal) && _pbVal > _pbPrev) {
        localStorage.setItem(PB_KEY, String(Math.round(_pbVal)));
        setIsNewBest(true);
      }
    } catch { /* ignore */ }


    setFinalSig({ ...sigRef.current });
    setPhase('done');
  }, [clearAutoAdv]);

  // ─── REGISTER SWIPE ────────────────────────────────────────────────────────
  const handleSwipe = useCallback((direction: 'right' | 'left', card: GameItem) => {
    if (!runningRef.current) return;
    clearAutoAdv();

    const decisionMs = Date.now() - cardSpawnRef.current;
    sigRef.current.decisionTimes.push(decisionMs);

    const isCorrect = direction === card.correct;

    if (isCorrect) {
      sigRef.current.score += card.points;
      sigRef.current.streakCurrent++;
      if (sigRef.current.streakCurrent > sigRef.current.maxStreak) {
        sigRef.current.maxStreak = sigRef.current.streakCurrent;
      }
      if (card.rare) sigRef.current.specialItemsCaught++;
      setScoreDisplay(sigRef.current.score);
      setStreakDisplay(sigRef.current.streakCurrent);
      setFeedback('correct');
      setScorePopText(`+${card.points}`);
      setScorePopKey((k) => k + 1);
      // Milestone visual at streak 5 and 10+
      const streak = sigRef.current.streakCurrent;
      if (streak === 5 || streak === 10 || (streak > 10 && streak % 5 === 0)) {
        setMilestoneLabel(streak >= 10 ? `🔥 ${streak} STREAK!` : `⭐ ${streak} STREAK!`);
        setMilestoneKey((k) => k + 1);
      }
      sfx.collect();
      // Shimmer on rare items only (avoid double-fire on every swipe)
      if (card.rare) sfx.shimmer();
      haptic([30]);
    } else {
      sigRef.current.score = Math.max(0, sigRef.current.score - 1);
      sigRef.current.wrongSwipes++;
      sigRef.current.streakCurrent = 0;
      setScoreDisplay(sigRef.current.score);
      setStreakDisplay(0);
      setFeedback('wrong');
      sfx.collision();
      haptic([80]);
    }

    setCardPhase(direction === 'right' ? 'exiting-right' : 'exiting-left');
    setTimeout(() => setFeedback(null), 400);
    setTimeout(() => {
      if (runningRef.current) spawnCard();
    }, 350);
  }, [clearAutoAdv, spawnCard]);

  // ─── POINTER EVENTS ────────────────────────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (cardPhase === 'exiting-right' || cardPhase === 'exiting-left') return;
    setCardPhase('idle');
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    isDraggingRef.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }, [cardPhase]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !pointerStartRef.current) return;
    const dx = e.clientX - pointerStartRef.current.x;
    setCardDx(dx);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !pointerStartRef.current) return;
    isDraggingRef.current = false;
    const dx = e.clientX - pointerStartRef.current.x;
    pointerStartRef.current = null;

    if (Math.abs(dx) >= SWIPE_THRESHOLD && currentCard) {
      handleSwipe(dx > 0 ? 'right' : 'left', currentCard);
    } else {
      // Snap back
      setCardDx(0);
      setCardPhase('idle');
      // Restart auto-advance with remaining time
      const elapsed = elapsedRef.current;
      const intervalMs = getIntervalMs(elapsed);
      const alreadyElapsed = Date.now() - cardSpawnRef.current;
      const remaining = Math.max(200, intervalMs - alreadyElapsed);
      clearAutoAdv();
      autoAdvRef.current = setTimeout(() => {
        if (!runningRef.current) return;
        sigRef.current.streakCurrent = 0;
        setStreakDisplay(0);
        setCardPhase('exiting-left');
        setTimeout(() => { if (runningRef.current) spawnCard(); }, 320);
      }, remaining);
    }
  }, [currentCard, handleSwipe, clearAutoAdv, spawnCard]);

  // After card enters, transition to idle (swipeable)
  useEffect(() => {
    if (cardPhase === 'entering') {
      const t = setTimeout(() => setCardPhase('idle'), 380);
      return () => clearTimeout(t);
    }
  }, [cardPhase]);

  // ─── START LOOP ────────────────────────────────────────────────────────────
  const startLoop = useCallback(() => {
    runningRef.current = true;
    elapsedRef.current = 0;
    sigRef.current = {
      score: 0,
      wrongSwipes: 0,
      streakCurrent: 0,
      maxStreak: 0,
      decisionTimes: [],
      specialItemsCaught: 0,
    };
    setScoreDisplay(0);
    setStreakDisplay(0);
    setTimeLeft(DURATION);
    setFeedback(null);
    setCurrentCard(null);
    setPhase('playing');

    stopMusicRef.current = startMusic('tense');

    timerRef.current = setInterval(() => {
      elapsedRef.current++;
      const tl = DURATION - elapsedRef.current;
      setTimeLeft(tl);
      // Speed stage transitions — spec: speedUpSound = success
      if (elapsedRef.current === 15 || elapsedRef.current === 30) {
        sfx.success();
        haptic([60, 30, 60]);
      }
      // Timer warning: last 10 seconds — tick + warning burst at 10s
      if (tl === 10) { sfx.warning(); haptic([50, 20, 50]); }
      else if (tl > 0 && tl < 10) { sfx.tick(); }
      if (tl <= 0) { sfx.success(); haptic([30, 50, 100]); endGame(); }
    }, 1000);

    spawnCard();
  }, [endGame, spawnCard]);

  // ─── PHASE TRANSITIONS ─────────────────────────────────────────────────────
  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    await initAudio();
    sfx.click();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => {
    startLoop();
  }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    setPhase('start');
    setScoreDisplay(0);
    setStreakDisplay(0);
    setTimeLeft(DURATION);
    setFinalSig(null);
    setCurrentCard(null);
  }, []);

  // ─── CLEANUP ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      runningRef.current = false;
      clearAutoAdv();
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, [clearAutoAdv]);

  // ─── CARD STYLE HELPERS ────────────────────────────────────────────────────
  const getCardTransform = (): string => {
    if (cardPhase === 'entering')       return 'translateX(110%)';
    if (cardPhase === 'exiting-right')  return 'translateX(150%) rotate(25deg)';
    if (cardPhase === 'exiting-left')   return 'translateX(-150%) rotate(-25deg)';
    // idle or dragging
    return `translateX(${cardDx}px) rotate(${cardDx * 0.07}deg)`;
  };

  const getCardTransition = (): string => {
    if (cardPhase === 'entering')      return 'transform 0.38s cubic-bezier(0.22, 1, 0.36, 1)';
    if (cardPhase === 'exiting-right') return 'transform 0.3s ease-in';
    if (cardPhase === 'exiting-left')  return 'transform 0.3s ease-in';
    if (isDraggingRef.current)         return 'none';
    return 'transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)';
  };

  // Swipe label hints while dragging
  const swipeRightOpacity = Math.min(1, Math.max(0, (cardDx - 20) / 40));
  const swipeLeftOpacity  = Math.min(1, Math.max(0, (-cardDx - 20) / 40));
  const isSwipeRight = cardDx > 20 && currentCard;
  const isSwipeLeft  = cardDx < -20 && currentCard;

  // ─── END SCREEN INSIGHTS ──────────────────────────────────────────────────
  const buildInsights = (sig: Signals) => {
    const avgDecision =
      sig.decisionTimes.length > 0
        ? Math.round(sig.decisionTimes.reduce((a, b) => a + b, 0) / sig.decisionTimes.length)
        : 0;
    return [
      { label: 'Gifts Sorted',  value: String(sig.score),                color: ACCENT },
      { label: 'Wrong Swipes',  value: String(sig.wrongSwipes),          color: sig.wrongSwipes === 0 ? '#4ade80' : '#ef4444' },
      { label: 'Best Streak',   value: `×${sig.maxStreak}`,              color: '#4ade80' },
      { label: 'Avg Decision',  value: avgDecision > 0 ? `${avgDecision}ms` : '—', color: '#facc15' },
    ];
  };

  // ─── RENDER ────────────────────────────────────────────────────────────────
  const accentColor = theme.colors.accent ?? ACCENT;

  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="gift-rush"
          steps={[{ icon: "🎁", title: "Catch the gifts", body: "Tap falling gifts before they hit the ground." }, { icon: "⭐", title: "Gold gifts = bonus", body: "Golden gifts are worth extra points — prioritize them." }, { icon: "💨", title: "Speed increases", body: "Gifts fall faster as time goes on. Keep up!" }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accentColor}>
      {/* Global CSS: snowfall + score pop animations */}
      <style>{`
        @keyframes gr-snowfall {
          0%   { transform: translateY(-24px) rotate(0deg); opacity: 0; }
          8%   { opacity: 1; }
          92%  { opacity: 0.6; }
          100% { transform: translateY(110vh) rotate(360deg); opacity: 0; }
        }
        @keyframes gr-scorepop {
          0%   { transform: translateY(0) scale(1);   opacity: 1; }
          100% { transform: translateY(-56px) scale(1.4); opacity: 0; }
        }
        @keyframes gr-hudpulse {
          0%, 100% { transform: scale(1); }
          50%       { transform: scale(1.2); }
        }
        @keyframes gr-milestone {
          0%   { transform: translateX(-50%) scale(0.6); opacity: 0; }
          20%  { transform: translateX(-50%) scale(1.15); opacity: 1; }
          70%  { transform: translateX(-50%) scale(1.0); opacity: 1; }
          100% { transform: translateX(-50%) scale(0.9); opacity: 0; }
        }
        @keyframes gr-shake {
          0%, 100% { transform: translateX(0); }
          20%       { transform: translateX(-6px); }
          60%       { transform: translateX(6px); }
        }
      `}</style>

      {/* ── Start Screen ──────────────────────────────────────────────────── */}
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Let's Sort! 🎁"
          accentColor={accentColor}
          ctaTextColor="#000"
          onStart={handleStart}
        />
      )}

      {/* ── Countdown ─────────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={accentColor} />
      )}

      {/* ── Playing ───────────────────────────────────────────────────────── */}
      {phase === 'playing' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            top: 56,
            background: '#0a0a1a',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Snowflake particles — Lucide Snowflake icons (no emoji) */}
          {SNOWFLAKES.map((flake) => (
            <div
              key={flake.id}
              style={{
                position: 'absolute',
                left: flake.left,
                top: '-30px',
                opacity: flake.opacity,
                animation: `gr-snowfall ${flake.duration} ${flake.delay} linear infinite`,
                pointerEvents: 'none',
                userSelect: 'none',
                zIndex: 1,
                color: 'rgba(180,220,255,0.9)',
              }}
            >
              <Snowflake size={flake.size} strokeWidth={1.5} />
            </div>
          ))}

          {/* Feedback flash overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                feedback === 'correct' ? 'rgba(74,222,128,0.18)'
                  : feedback === 'wrong' ? 'rgba(239,68,68,0.22)'
                  : 'transparent',
              pointerEvents: 'none',
              transition: 'background 0.12s',
              zIndex: 5,
              animation: feedback === 'wrong' ? 'gr-shake 0.3s ease' : 'none',
            }}
          />

          {/* HUD */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 }}>
            <GameHUD
              accentColor={accentColor}
              items={[
                { label: 'TIME',       value: timeLeft,      danger: timeLeft <= 10 },
                { label: 'GIFTS',      value: scoreDisplay },
                { label: 'STREAK',     value: streakDisplay },
              ]}
            />
          </div>

          {/* Score pop animation */}
          <div
            key={scorePopKey}
            style={{
              position: 'absolute',
              top: '38%',
              left: '50%',
              transform: 'translateX(-50%)',
              color: '#4ade80',
              fontSize: 28,
              fontWeight: 900,
              zIndex: 30,
              animation: scorePopKey > 0 ? 'gr-scorepop 0.5s ease-out forwards' : 'none',
              pointerEvents: 'none',
            }}
          >
            {scorePopText}
          </div>

          {/* Combo milestone overlay */}
          {milestoneKey > 0 && (
            <div
              key={milestoneKey}
              style={{
                position: 'absolute',
                top: '28%',
                left: '50%',
                transform: 'translateX(-50%)',
                color: '#facc15',
                fontSize: 22,
                fontWeight: 900,
                letterSpacing: '0.04em',
                zIndex: 35,
                textShadow: '0 0 16px rgba(250,204,21,0.8)',
                animation: 'gr-milestone 1.1s ease-out forwards',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {milestoneLabel}
            </div>
          )}

          {/* Conveyor belt stripe (decorative) */}
          <div
            style={{
              position: 'absolute',
              bottom: '22%',
              left: 0,
              right: 0,
              height: 10,
              background: 'repeating-linear-gradient(90deg, #ef4444 0px, #ef4444 22px, #fff 22px, #fff 44px)',
              opacity: 0.25,
              zIndex: 2,
            }}
          />

          {/* Direction arrows (background hints) */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: 0,
              right: 0,
              transform: 'translateY(-50%)',
              display: 'flex',
              justifyContent: 'space-between',
              padding: '0 24px',
              pointerEvents: 'none',
              zIndex: 3,
            }}
          >
            <span style={{ color: 'rgba(239,68,68,0.35)', fontSize: 36, fontWeight: 900 }}>←</span>
            <span style={{ color: 'rgba(74,222,128,0.35)', fontSize: 36, fontWeight: 900 }}>→</span>
          </div>

          {/* Card area */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
            }}
          >
            {currentCard && (
              <div
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                style={{
                  width: 200,
                  height: 250,
                  borderRadius: 22,
                  background: currentCard.rare
                    ? 'linear-gradient(145deg, #1a0f2e 0%, #2d1b4e 100%)'
                    : 'linear-gradient(145deg, #1a1a2e 0%, #16213e 100%)',
                  border: `2px solid ${currentCard.rare ? '#a855f7' : '#2a3a5e'}`,
                  boxShadow: currentCard.rare
                    ? '0 0 36px rgba(168,85,247,0.55), 0 12px 40px rgba(0,0,0,0.6)'
                    : '0 12px 40px rgba(0,0,0,0.6)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  cursor: 'grab',
                  touchAction: 'none',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  transform: getCardTransform(),
                  transition: getCardTransition(),
                  position: 'relative',
                  willChange: 'transform',
                }}
              >
                {/* Ribbon — vertical */}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 4,
                    height: '100%',
                    background: currentCard.rare ? '#a855f7' : accentColor,
                    opacity: 0.35,
                    borderRadius: 2,
                    pointerEvents: 'none',
                  }}
                />
                {/* Ribbon — horizontal */}
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: '44%',
                    width: '100%',
                    height: 4,
                    background: currentCard.rare ? '#a855f7' : accentColor,
                    opacity: 0.35,
                    borderRadius: 2,
                    pointerEvents: 'none',
                  }}
                />
                {/* Bow (circle at ribbon intersection) */}
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(44% - 10px)',
                    left: 'calc(50% - 10px)',
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: currentCard.rare ? '#a855f7' : accentColor,
                    opacity: 0.7,
                    pointerEvents: 'none',
                  }}
                />

                {/* Swipe right hint */}
                {isSwipeRight && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 14,
                      right: 14,
                      background: currentCard.correct === 'right' ? '#4ade80' : '#ef4444',
                      color: '#000',
                      fontWeight: 800,
                      fontSize: 11,
                      padding: '3px 10px',
                      borderRadius: 20,
                      opacity: swipeRightOpacity,
                      pointerEvents: 'none',
                    }}
                  >
                    {currentCard.correct === 'right' ? '✓ NICE!' : '✗ NAUGHTY!'}
                  </div>
                )}

                {/* Swipe left hint */}
                {isSwipeLeft && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 14,
                      left: 14,
                      background: currentCard.correct === 'left' ? '#4ade80' : '#ef4444',
                      color: currentCard.correct === 'left' ? '#000' : '#fff',
                      fontWeight: 800,
                      fontSize: 11,
                      padding: '3px 10px',
                      borderRadius: 20,
                      opacity: swipeLeftOpacity,
                      pointerEvents: 'none',
                    }}
                  >
                    {currentCard.correct === 'left' ? '✓ NAUGHTY!' : '✗ NICE!'}
                  </div>
                )}

                {/* Item icon — Lucide React (no emojis in gameplay UI) */}
                <div
                  style={{
                    lineHeight: 1,
                    zIndex: 1,
                    marginTop: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ItemIcon type={currentCard.iconType} color={currentCard.iconColor} size={72} />
                </div>

                {/* Item label */}
                <div
                  style={{
                    color: currentCard.rare ? '#c084fc' : 'rgba(255,255,255,0.85)',
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase' as const,
                    zIndex: 1,
                  }}
                >
                  {currentCard.label}
                </div>

                {/* Points badge for multi-point items */}
                {currentCard.points > 1 && (
                  <div
                    style={{
                      color: '#facc15',
                      fontSize: 12,
                      fontWeight: 800,
                      zIndex: 1,
                      background: 'rgba(250,204,21,0.12)',
                      border: '1px solid rgba(250,204,21,0.3)',
                      padding: '3px 12px',
                      borderRadius: 20,
                    }}
                  >
                    +{currentCard.points} pts
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom legend — Lucide icons (no emojis) */}
          <div
            style={{
              position: 'absolute',
              bottom: 20,
              left: 0,
              right: 0,
              display: 'flex',
              justifyContent: 'center',
              gap: 32,
              zIndex: 20,
              pointerEvents: 'none',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'rgba(239,68,68,0.75)', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em' }}>← NAUGHTY</span>
              <div style={{ display: 'flex', gap: 6, opacity: 0.6 }}>
                <Gem size={16} color="#6b7280" />
                <Trash2 size={16} color="#65a30d" />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'rgba(74,222,128,0.75)', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em' }}>NICE →</span>
              <div style={{ display: 'flex', gap: 6, opacity: 0.6 }}>
                <Gift size={16} color="#ef4444" />
                <Cookie size={16} color="#d97706" />
                <Star size={16} color="#facc15" fill="#facc15" />
              </div>
            </div>
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
      {phase === 'done' && finalSig && (
        <EndScreen
          gameId={GAME_ID}
          title={getPersonality(finalSig)}
          emoji={GAME_EMOJI}
          score={String(finalSig.score)}
          personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)}
          accentColor={accentColor}
          onPlayAgain={handlePlayAgain}
          didWin={finalSig.score >= 10}
        />
      )}

      {/* Webhook — fires once when done phase mounts */}
      {phase === 'done' && finalSig && (
        <WebhookEmitter
          theme={theme}
          gameId={GAME_ID}
          sig={finalSig}
          personality={getPersonality(finalSig)}
          player={playerSessionRef.current}
        />
      )}
      {phase === 'playing' && (
        <>
          <ScorePopEffect pops={pops} accentColor={CATEGORY_ACCENT} />
          <StreakBadge streak={streakDisplay} accentColor={CATEGORY_ACCENT} />
        </>
      )}
    </GameShell>
    </>
  );
}

// ─── WEBHOOK EMITTER ─────────────────────────────────────────────────────────
function WebhookEmitter({
  theme,
  gameId,
  sig,
  personality,
  player,
}: {
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

    const avgDecisionMs =
      sig.decisionTimes.length > 0
        ? Math.round(sig.decisionTimes.reduce((a, b) => a + b, 0) / sig.decisionTimes.length)
        : null;

    postWebhook(
      theme,
      gameId,
      {
        personality,
        score:               sig.score,
        wrongSwipes:         sig.wrongSwipes,
        streakCurrent:       sig.streakCurrent,
        maxStreak:           sig.maxStreak,
        avgDecisionMs,
        specialItemsCaught:  sig.specialItemsCaught,
      },
      player,
    );
  }, [theme, gameId, sig, personality, player]);

  return null;
}
