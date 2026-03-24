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

const GAME_ID = 'speed-sort';
const ACCENT = '#facc15';
const DURATION = 30;
const GAME_EMOJI = '⚡';
const GAME_TITLE = 'Speed Sort';
const GAME_TAGLINE = 'Left or right. Think fast.';

type Category = { name: string; color: string; icon: string };
type Item = { name: string; category: 0 | 1; emoji: string };

const ROUND_SETS: Array<{ left: Category; right: Category; items: Item[] }> = [
  {
    left: { name: 'FRUIT', color: '#4ade80', icon: '🍎' },
    right: { name: 'VEG', color: '#f97316', icon: '🥦' },
    items: [
      { name: 'Apple', emoji: '🍎', category: 0 }, { name: 'Broccoli', emoji: '🥦', category: 1 },
      { name: 'Banana', emoji: '🍌', category: 0 }, { name: 'Carrot', emoji: '🥕', category: 1 },
      { name: 'Grape', emoji: '🍇', category: 0 }, { name: 'Onion', emoji: '🧅', category: 1 },
      { name: 'Mango', emoji: '🥭', category: 0 }, { name: 'Spinach', emoji: '🥬', category: 1 },
      { name: 'Lemon', emoji: '🍋', category: 0 }, { name: 'Potato', emoji: '🥔', category: 1 },
    ],
  },
  {
    left: { name: 'HOT', color: '#ef4444', icon: '🔥' },
    right: { name: 'COLD', color: '#06b6d4', icon: '❄️' },
    items: [
      { name: 'Coffee', emoji: '☕', category: 0 }, { name: 'Ice Cream', emoji: '🍦', category: 1 },
      { name: 'Soup', emoji: '🍲', category: 0 }, { name: 'Soda', emoji: '🥤', category: 1 },
      { name: 'Tea', emoji: '🍵', category: 0 }, { name: 'Snowflake', emoji: '❄️', category: 1 },
      { name: 'Fire', emoji: '🔥', category: 0 }, { name: 'Popsicle', emoji: '🧊', category: 1 },
      { name: 'Oven', emoji: '🍳', category: 0 }, { name: 'Freezer', emoji: '🥶', category: 1 },
    ],
  },
  {
    left: { name: 'LAND', color: '#84cc16', icon: '🏔️' },
    right: { name: 'SEA', color: '#0ea5e9', icon: '🌊' },
    items: [
      { name: 'Eagle', emoji: '🦅', category: 0 }, { name: 'Shark', emoji: '🦈', category: 1 },
      { name: 'Bear', emoji: '🐻', category: 0 }, { name: 'Whale', emoji: '🐋', category: 1 },
      { name: 'Lion', emoji: '🦁', category: 0 }, { name: 'Dolphin', emoji: '🐬', category: 1 },
      { name: 'Wolf', emoji: '🐺', category: 0 }, { name: 'Crab', emoji: '🦀', category: 1 },
      { name: 'Deer', emoji: '🦌', category: 0 }, { name: 'Octopus', emoji: '🐙', category: 1 },
    ],
  },
];

interface Signals {
  totalItems: number; correct: number; wrong: number;
  maxStreak: number; streakCurrent: number; avgReactionMs: number; reactionSum: number; score: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.totalItems > 0 ? sig.correct / sig.totalItems : 0;
  const avgRx = sig.totalItems > 0 ? sig.reactionSum / sig.totalItems : 9999;
  if (acc >= 0.9 && avgRx < 700) return 'Lightning Sorter ⚡';
  if (acc >= 0.8 && sig.maxStreak >= 5) return 'Clean Sweep 🧹';
  if (avgRx < 600) return 'Hair Trigger 🎯';
  if (acc >= 0.7) return 'Reliable Classifier 📊';
  return 'Still Sorting 🤔';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  currentRound: number; currentItemIndex: number; itemShownAt: number;
  shuffledItems: Item[]; swipeStartX: number; swipeStartY: number; swiping: boolean;
  cardX: number; cardOpacity: number; animating: boolean; lastCorrect: boolean | null;
  accentColor: string; floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  scorePop: number;
}

export default function SpeedSort() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalItems: 0, correct: 0, wrong: 0, maxStreak: 0, streakCurrent: 0, avgReactionMs: 0, reactionSum: 0, score: 0 },
    currentRound: 0, currentItemIndex: 0, itemShownAt: 0, shuffledItems: [],
    swipeStartX: 0, swipeStartY: 0, swiping: false,
    cardX: 0, cardOpacity: 1, animating: false, lastCorrect: null,
    accentColor: ACCENT, floats: [], scorePop: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, []);

  const nextItem = useCallback(() => {
    const s = stateRef.current;
    s.currentItemIndex++;
    if (s.currentItemIndex >= s.shuffledItems.length) {
      s.currentRound = (s.currentRound + 1) % ROUND_SETS.length;
      const set = ROUND_SETS[s.currentRound];
      s.shuffledItems = [...set.items].sort(() => Math.random() - 0.5);
      s.currentItemIndex = 0;
    }
    s.cardX = 0; s.cardOpacity = 1; s.animating = false;
    s.itemShownAt = Date.now();
  }, []);

  const handleSort = useCallback((direction: 'left' | 'right') => {
    const s = stateRef.current;
    if (s.animating || !s.running) return;
    const roundSet = ROUND_SETS[s.currentRound];
    const item = s.shuffledItems[s.currentItemIndex];
    const expectedCategory = direction === 'left' ? 0 : 1;
    const isCorrect = item.category === expectedCategory;
    const reactionMs = Date.now() - s.itemShownAt;

    s.sig.totalItems++;
    s.sig.reactionSum += reactionMs;
    s.lastCorrect = isCorrect;
    s.animating = true;

    if (isCorrect) {
      s.sig.correct++;
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
      s.sig.score += mult;
      s.scorePop = Date.now() + 300;
      setScoreDisplay(s.sig.score);
      sfx.collect();
      hapticScore();
      if (s.sig.streakCurrent >= 3) { hapticCombo(s.sig.streakCurrent); sfx.success(); }
    } else {
      s.sig.wrong++;
      s.sig.streakCurrent = 0;
      sfx.collision();
      hapticFail();
    }

    // Animate card off screen
    const targetX = direction === 'left' ? -400 : 400;
    const startCardX = s.cardX;
    const startTime = Date.now();
    const animDuration = 250;
    const animateCard = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(1, elapsed / animDuration);
      s.cardX = startCardX + (targetX - startCardX) * t;
      s.cardOpacity = 1 - t;
      if (t < 1) requestAnimationFrame(animateCard);
      else nextItem();
    };
    requestAnimationFrame(animateCard);
  }, [nextItem]);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalItems: 0, correct: 0, wrong: 0, maxStreak: 0, streakCurrent: 0, avgReactionMs: 0, reactionSum: 0, score: 0 };
    s.currentRound = 0;
    const set = ROUND_SETS[0];
    s.shuffledItems = [...set.items].sort(() => Math.random() - 0.5);
    s.currentItemIndex = 0; s.cardX = 0; s.cardOpacity = 1; s.animating = false;
    s.floats = []; s.scorePop = 0; s.itemShownAt = Date.now();
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);

      const roundSet = ROUND_SETS[s.currentRound];
      const item = s.shuffledItems[s.currentItemIndex];

      // Background
      ctx.fillStyle = '#0f0f18';
      ctx.fillRect(0, 0, W, H);

      // Category zones
      const zoneW = W * 0.35;
      const zoneH = H * 0.5;
      const zoneY = (H - zoneH) / 2;

      // Left zone
      ctx.fillStyle = roundSet.left.color + '18';
      ctx.fillRect(0, zoneY, zoneW, zoneH);
      ctx.save();
      ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = roundSet.left.color;
      ctx.fillText(roundSet.left.icon, zoneW / 2, zoneY + zoneH / 2 - 10);
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(roundSet.left.name, zoneW / 2, zoneY + zoneH / 2 + 20);
      ctx.restore();

      // Right zone
      ctx.fillStyle = roundSet.right.color + '18';
      ctx.fillRect(W - zoneW, zoneY, zoneW, zoneH);
      ctx.save();
      ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = roundSet.right.color;
      ctx.fillText(roundSet.right.icon, W - zoneW / 2, zoneY + zoneH / 2 - 10);
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(roundSet.right.name, W - zoneW / 2, zoneY + zoneH / 2 + 20);
      ctx.restore();

      // Divider arrows
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('◀', 50, H * 0.5);
      ctx.fillText('▶', W - 50, H * 0.5);
      ctx.restore();

      // Item card
      if (item) {
        const cardW = 160, cardH = 180;
        const cardX = W / 2 - cardW / 2 + s.cardX;
        const cardY = H / 2 - cardH / 2;
        const tilt = s.cardX / 400 * 0.3;

        ctx.save();
        ctx.globalAlpha = s.cardOpacity;
        ctx.translate(cardX + cardW / 2, cardY + cardH / 2);
        ctx.rotate(tilt);

        const bgColor = s.lastCorrect === null ? '#1e1e2e' : s.lastCorrect ? '#1e3020' : '#301e1e';
        ctx.fillStyle = bgColor;
        ctx.shadowBlur = 20; ctx.shadowColor = s.cardX > 0 ? roundSet.right.color : s.cardX < 0 ? roundSet.left.color : ACCENT;
        ctx.beginPath();
        (ctx as any).roundRect?.(-cardW / 2, -cardH / 2, cardW, cardH, 16) ?? ctx.rect(-cardW / 2, -cardH / 2, cardW, cardH);
        ctx.fill();

        ctx.font = '72px sans-serif'; ctx.textAlign = 'center'; ctx.shadowBlur = 0;
        ctx.fillText(item.emoji, 0, 20);
        ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = '#ffffff';
        ctx.fillText(item.name, 0, 65);

        ctx.restore();
      }

      // Score pop
      if (s.scorePop > Date.now()) {
        const t = (s.scorePop - Date.now()) / 300;
        ctx.save(); ctx.globalAlpha = t;
        ctx.font = `bold ${Math.round(40 * (1 + (1 - t) * 0.3))}px sans-serif`;
        ctx.fillStyle = '#facc15'; ctx.textAlign = 'center';
        ctx.fillText(`${s.sig.score}`, W / 2, 80); ctx.restore();
      }

      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha;
        ctx.fillStyle = f.color; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.95;
      });

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, nextItem]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      const rect = canvas.getBoundingClientRect();
      s.swipeStartX = (e.clientX - rect.left) * (canvas.width / rect.width);
      s.swipeStartY = (e.clientY - rect.top) * (canvas.height / rect.height);
      s.swiping = true;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.swiping) return;
      s.swiping = false;
      const rect = canvas.getBoundingClientRect();
      const endX = (e.clientX - rect.left) * (canvas.width / rect.width);
      const dx = endX - s.swipeStartX;
      if (Math.abs(dx) > 40) handleSort(dx < 0 ? 'left' : 'right');
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [phase, handleSort]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Swipe LEFT or RIGHT to sort items into categories. Be fast and accurate!"
          ctaLabel="Sort It! ⚡" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
            role="img" aria-label="Speed sorting game canvas" />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME', value: timeLeft, danger: timeLeft <= 5 },
              { label: 'SCORE', value: scoreDisplay },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Accuracy', value: `${finalSig.totalItems > 0 ? Math.round(finalSig.correct / finalSig.totalItems * 100) : 0}%`, color: ACCENT },
            { label: 'Correct', value: String(finalSig.correct), color: '#4ade80' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
            { label: 'Avg Speed', value: `${finalSig.totalItems > 0 ? Math.round(finalSig.reactionSum / finalSig.totalItems) : 0}ms`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.correct >= 10} />
      )}
    </GameShell>
  );
}
