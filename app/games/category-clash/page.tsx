'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo, hapticWarning } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'category-clash';
const ACCENT = '#a78bfa';
const DURATION = 30;
const GAME_EMOJI = '📦';
const GAME_TITLE = 'Category Clash';
const GAME_TAGLINE = 'Sort fast. But the rules keep changing!';

interface Signals {
  total: number;
  correct: number;
  wrong: number;
  correctAfterSwitch: number;  // correct answers right after category switch
  switchCount: number;
  avgReactionMs: number;
  totalMs: number;
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.total > 0 ? sig.correct / sig.total : 0;
  if (acc >= 0.85 && sig.switchCount >= 4) return 'Adaptive Ace 🧠';
  if (sig.correctAfterSwitch >= 6) return 'Switch Expert 🔀';
  if (acc >= 0.8) return 'Fast Sorter 📦';
  if (sig.avgReactionMs < 500) return 'Lightning Sort ⚡';
  return 'Still Sorting 🤔';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// Category pairs that can switch
const CATEGORY_PAIRS = [
  {
    left: 'ANIMAL', right: 'PLANT',
    leftItems: ['Cat', 'Dog', 'Fish', 'Bird', 'Frog', 'Bear', 'Wolf', 'Deer'],
    rightItems: ['Rose', 'Tree', 'Fern', 'Moss', 'Vine', 'Lily', 'Cactus', 'Tulip'],
  },
  {
    left: 'FRUIT', right: 'VEGGIE',
    leftItems: ['Apple', 'Grape', 'Mango', 'Plum', 'Pear', 'Kiwi', 'Lemon', 'Berry'],
    rightItems: ['Onion', 'Carrot', 'Potato', 'Pea', 'Kale', 'Beet', 'Corn', 'Leek'],
  },
  {
    left: 'FAST', right: 'SLOW',
    leftItems: ['Car', 'Jet', 'Bolt', 'Rocket', 'Cheetah', 'Train', 'Arrow', 'Laser'],
    rightItems: ['Turtle', 'Snail', 'Sloth', 'Glacier', 'Slug', 'Walk', 'Drift', 'Crawl'],
  },
  {
    left: 'HOT', right: 'COLD',
    leftItems: ['Lava', 'Fire', 'Sun', 'Sauna', 'Pepper', 'Forge', 'Grill', 'Steam'],
    rightItems: ['Ice', 'Snow', 'Frost', 'Arctic', 'Blizzard', 'Tundra', 'Freeze', 'Glacier'],
  },
];

interface FallingItem {
  word: string;
  isLeft: boolean;  // belongs to left category
  x: number;
  y: number;
  vy: number;
  alpha: number;
}

interface GameState {
  running: boolean; timeLeft: number;
  sig: Signals; frame: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  currentPair: typeof CATEGORY_PAIRS[0];
  currentItem: FallingItem | null;
  pairIdx: number;
  itemsHandled: number;
  nextSwitchIn: number;   // items until next switch
  switchFlash: number;    // frames showing switch animation
  shownAt: number;
}

export default function CategoryClashGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { total: 0, correct: 0, wrong: 0, correctAfterSwitch: 0, switchCount: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    frame: 0, accentColor: ACCENT, floats: [],
    currentPair: CATEGORY_PAIRS[0], currentItem: null,
    pairIdx: 0, itemsHandled: 0, nextSwitchIn: 5, switchFlash: 0, shownAt: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  const isAfterSwitch = useRef(false);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const spawnItem = useCallback((W: number) => {
    const s = stateRef.current;
    const pair = s.currentPair;
    const isLeft = Math.random() < 0.5;
    const items = isLeft ? pair.leftItems : pair.rightItems;
    const word = items[Math.floor(Math.random() * items.length)];
    s.currentItem = {
      word, isLeft,
      x: W / 2, y: 100,
      vy: 1.5 + s.sig.total * 0.04,
      alpha: 1,
    };
    s.shownAt = Date.now();
  }, []);

  const switchCategories = useCallback((W: number) => {
    const s = stateRef.current;
    s.pairIdx = (s.pairIdx + 1) % CATEGORY_PAIRS.length;
    s.currentPair = CATEGORY_PAIRS[s.pairIdx];
    s.nextSwitchIn = 4 + Math.floor(Math.random() * 4);
    s.switchFlash = 60;
    s.sig.switchCount++;
    isAfterSwitch.current = true;
    hapticWarning();
    const canvas = canvasRef.current;
    if (canvas) {
      s.floats.push({ x: W / 2, y: canvas.height * 0.3, text: '⚡ SWITCH!', alpha: 1, vy: -2.5, color: '#fbbf24' });
    }
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
    const W = canvas.width, H = canvas.height;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { total: 0, correct: 0, wrong: 0, correctAfterSwitch: 0, switchCount: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.frame = 0; s.floats = []; s.pairIdx = 0; s.currentPair = CATEGORY_PAIRS[0];
    s.itemsHandled = 0; s.nextSwitchIn = 5; s.switchFlash = 0;
    spawnItem(W);
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);
      s.frame++;

      if (s.switchFlash > 0) s.switchFlash--;

      // Background
      ctx.fillStyle = '#0a0414'; ctx.fillRect(0, 0, W, H);
      // Switch flash overlay
      if (s.switchFlash > 0) {
        ctx.fillStyle = `rgba(167,139,250,${(s.switchFlash / 60) * 0.2})`;
        ctx.fillRect(0, 0, W, H);
      }

      // Left bucket
      const bucketW = W * 0.36, bucketH = 70;
      const leftBucketX = 10, rightBucketX = W - bucketW - 10;
      const bucketY = H - bucketH - 20;

      ctx.save();
      ctx.fillStyle = 'rgba(59,130,246,0.2)'; ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2;
      ctx.beginPath(); (ctx as any).roundRect?.(leftBucketX, bucketY, bucketW, bucketH, 8) ?? ctx.rect(leftBucketX, bucketY, bucketW, bucketH);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.font = `bold ${Math.min(14, bucketW * 0.13)}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(s.currentPair.left, leftBucketX + bucketW / 2, bucketY + bucketH / 2 + 6);
      ctx.restore();

      // Right bucket
      ctx.save();
      ctx.fillStyle = 'rgba(239,68,68,0.2)'; ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
      ctx.beginPath(); (ctx as any).roundRect?.(rightBucketX, bucketY, bucketW, bucketH, 8) ?? ctx.rect(rightBucketX, bucketY, bucketW, bucketH);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.font = `bold ${Math.min(14, bucketW * 0.13)}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(s.currentPair.right, rightBucketX + bucketW / 2, bucketY + bucketH / 2 + 6);
      ctx.restore();

      // Swipe arrows hint
      ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = '18px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('⬅ swipe  swipe ➡', W / 2, bucketY - 15);

      // Falling item
      if (s.currentItem) {
        const item = s.currentItem;
        item.y += item.vy;

        // Drop zone timeout
        if (item.y > H - 100) {
          // Missed! Auto-fail
          s.sig.total++; s.sig.wrong++;
          s.sig.streakCurrent = 0;
          sfx.collision(); hapticFail();
          s.floats.push({ x: W / 2, y: H * 0.5, text: 'TOO SLOW!', alpha: 1, vy: -3, color: '#ef4444' });
          s.itemsHandled++;
          s.nextSwitchIn--;
          if (s.nextSwitchIn <= 0) switchCategories(W);
          spawnItem(W);
        }

        // Draw item card
        const cardW = Math.min(160, W * 0.4), cardH = 52;
        const cx = item.x, cy = item.y;

        ctx.save();
        ctx.shadowBlur = 16; ctx.shadowColor = ACCENT;
        ctx.fillStyle = 'rgba(167,139,250,0.15)'; ctx.strokeStyle = ACCENT; ctx.lineWidth = 2.5;
        ctx.beginPath(); (ctx as any).roundRect?.(cx - cardW / 2, cy - cardH / 2, cardW, cardH, 10) ?? ctx.rect(cx - cardW / 2, cy - cardH / 2, cardW, cardH);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.font = `bold ${Math.min(20, cardW * 0.14)}px sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(item.word, cx, cy + 7);
        ctx.restore();
      }

      // Progress bar (items until switch)
      const switchProgress = 1 - (s.nextSwitchIn / 5);
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(20, 30, W - 40, 6);
      ctx.fillStyle = switchProgress > 0.7 ? '#ef4444' : ACCENT;
      ctx.fillRect(20, 30, (W - 40) * switchProgress, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText('SWITCH ↑', W - 20, 26);

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
  }, [endGame, spawnItem, switchCategories]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    let pointerStartX = 0, pointerStartY = 0, pointerStartTime = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      pointerStartX = e.clientX; pointerStartY = e.clientY; pointerStartTime = Date.now();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.currentItem) return;
      const dx = e.clientX - pointerStartX;
      const dt = Date.now() - pointerStartTime;

      if (Math.abs(dx) < 20 && dt > 300) return; // not a swipe
      if (Math.abs(dx) < 15) return;

      const playerSaysLeft = dx < 0;
      const ms = Date.now() - s.shownAt;
      s.sig.total++; s.sig.totalMs += ms;

      const isCorrect = (playerSaysLeft && s.currentItem.isLeft) || (!playerSaysLeft && !s.currentItem.isLeft);

      if (isCorrect) {
        s.sig.correct++;
        if (isAfterSwitch.current) { s.sig.correctAfterSwitch++; isAfterSwitch.current = false; }
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const speedPts = ms < 400 ? 3 : ms < 800 ? 2 : 1;
        s.sig.score += speedPts; setScoreDisplay(s.sig.score);
        sfx.collect(); hapticScore();
        if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
        s.floats.push({ x: canvas.width / 2, y: canvas.height * 0.55, text: `+${speedPts} ✓`, alpha: 1, vy: -2.5, color: '#fbbf24' });
      } else {
        s.sig.wrong++; s.sig.streakCurrent = 0;
        isAfterSwitch.current = false;
        sfx.collision(); hapticFail();
        s.floats.push({ x: canvas.width / 2, y: canvas.height * 0.55, text: 'WRONG SIDE!', alpha: 1, vy: -2, color: '#ef4444' });
      }

      s.itemsHandled++;
      s.nextSwitchIn--;
      if (s.nextSwitchIn <= 0) switchCategories(canvas.width);
      spawnItem(canvas.width);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [phase, spawnItem, switchCategories]);

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
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Swipe LEFT or RIGHT to sort items. But the categories change!" ctaLabel="Sort! 📦" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Category Clash sorting game canvas" />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Accuracy', value: `${finalSig.total > 0 ? Math.round(finalSig.correct / finalSig.total * 100) : 0}%`, color: ACCENT },
            { label: 'Switches', value: String(finalSig.switchCount), color: '#fbbf24' },
            { label: 'Post-Switch', value: String(finalSig.correctAfterSwitch), color: '#4ade80' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.correct >= 15} />
      )}
    </GameShell>
  );
}
