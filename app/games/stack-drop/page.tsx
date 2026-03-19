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
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY_ACCENT = CATEGORY_THEMES.cognitive.primaryAccent;

const GAME_ID      = 'stack-drop';
const PB_KEY       = 'pb_stack-drop';
const ACCENT       = '#f97316';
const DURATION     = 60;
const GAME_EMOJI   = '🧱';
const GAME_TITLE   = 'Stack Drop';
const GAME_TAGLINE = 'Drop it. Stack it. Don\'t tip it.';

const BLOCK_HEIGHT    = 28;
const INITIAL_WIDTH   = 0.78;  // fraction of canvas width
const MIN_WIDTH_FRAC  = 0.20;  // below 20% of original = "too narrow", reset to top block width
const PERFECT_PX      = 10;    // overlap within this = perfect drop
const MISS_PAUSE_MS   = 1000;  // pause slider for 1s on complete miss (per spec)

interface Block {
  x: number;       // left edge
  width: number;
  y: number;       // top edge in canvas coords
  color: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  color: string;
  alpha: number;
  life: number;    // remaining life 1→0
}

interface Signals {
  blocksDropped: number;
  perfectDrops: number;
  overhangs: number[];
  maxHeight: number;
  earlyDrops: number;
  lateDrops: number;
  score: number;
}

function getPersonality(sig: Signals): string {
  const total = sig.blocksDropped;
  if (sig.perfectDrops >= 8 && sig.maxHeight >= 10) return 'The Architect 🏛️';
  if (total >= 20 && sig.maxHeight >= 8)             return 'Speed Stacker ⚡';
  if (sig.perfectDrops >= 6 && total < 15)           return 'Perfectionist 🎯';
  return 'Bold Builder 🌊';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function blockColor(index: number, accent: string): string {
  const shades = [accent, accent + 'cc', accent + 'aa', accent + '88', accent + 'ff'];
  return shades[index % shades.length];
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  // Slider
  sliderX: number;
  sliderDir: number;       // 1 = right, -1 = left
  sliderSpeed: number;
  sliderWidth: number;
  // Stack
  stack: Block[];
  cameraY: number;         // canvas offset — camera follows stack height
  accentColor: string;
  // miss shake feedback
  missActive: boolean;
  missStartTs: number;
  // pause slider on miss (spec: 1s pause)
  missUntilTs: number;
  // overhang particle debris
  particles: Particle[];
}

export default function StackDropGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef     = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { blocksDropped: 0, perfectDrops: 0, overhangs: [], maxHeight: 0, earlyDrops: 0, lateDrops: 0, score: 0 },
    sliderX: 0, sliderDir: 1, sliderSpeed: 3.5, sliderWidth: 0,
    stack: [], cameraY: 0, accentColor: ACCENT,
    // miss shake feedback
    missActive: false, missStartTs: 0,
    // pause + particles
    missUntilTs: 0, particles: [],
  });
  const phaseRef     = useRef<Phase>('start');

  const [phase, setPhase]             = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft]       = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  // ⚡ heightDisplay tracks actual block count — HUD label is 'HEIGHT', not 'SCORE'
  const [heightDisplay, setHeightDisplay] = useState(0);
  const [finalSig, setFinalSig]       = useState<Signals | null>(null);
  const [playerName, setPlayerName]   = useState('');
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
  const playerSessionRef              = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  // ─── INIT STACK ──────────────────────────────────────────────────────────

  const initStack = useCallback((canvas: HTMLCanvasElement) => {
    const s = stateRef.current;
    const baseWidth = canvas.width * INITIAL_WIDTH;
    const baseX = (canvas.width - baseWidth) / 2;
    const baseY = canvas.height - BLOCK_HEIGHT - 20; // near bottom

    s.stack = [{
      x: baseX,
      width: baseWidth,
      y: baseY,
      color: s.accentColor,
    }];
    s.sliderWidth  = baseWidth;
    s.sliderX      = baseX;
    s.sliderDir    = 1;
    s.sliderSpeed  = 3.5;
    s.cameraY      = 0;
    s.missUntilTs  = 0;
    s.particles    = [];
    s.sig          = { blocksDropped: 0, perfectDrops: 0, overhangs: [], maxHeight: 0, earlyDrops: 0, lateDrops: 0, score: 0 };
  }, []);

  // ─── DROP BLOCK ──────────────────────────────────────────────────────────

  const dropBlock = useCallback(() => {
    const s = stateRef.current;
    if (!s.running || s.stack.length === 0) return;

    const top = s.stack[s.stack.length - 1];
    const slLeft  = s.sliderX;
    const slRight = s.sliderX + s.sliderWidth;
    const topLeft  = top.x;
    const topRight = top.x + top.width;

    // Overlap
    const overlapLeft  = Math.max(slLeft, topLeft);
    const overlapRight = Math.min(slRight, topRight);
    const overlap = overlapRight - overlapLeft;

    s.sig.blocksDropped++;

    const canvas = canvasRef.current;
    const W = canvas?.width ?? 300;
    const originalWidth = W * INITIAL_WIDTH;

    const handleMiss = () => {
      sfx.collision();
      haptic([60]);
      s.sliderWidth  = top.width;
      s.sliderX      = W / 2 - s.sliderWidth / 2;
      s.sig.score    = Math.max(0, s.sig.score - 5);
      setScoreDisplay(s.sig.score);
      // Arm shake animation
      s.missActive   = true;
      s.missStartTs  = 0;
      // Pause slider for 1 second (spec requirement)
      s.missUntilTs  = performance.now() + MISS_PAUSE_MS;
    };

    if (overlap <= 0) {
      // Completely missed
      handleMiss();
      return;
    }

    // ⚡ "Too narrow" check — if trimmed overlap < 20% of original width, treat as miss
    if (overlap < originalWidth * MIN_WIDTH_FRAC) {
      handleMiss();
      return;
    }

    const overhang = Math.abs((slLeft + s.sliderWidth / 2) - (topLeft + top.width / 2));
    s.sig.overhangs.push(Math.round(overhang));

    const isPerfect = overhang <= PERFECT_PX;
    if (isPerfect) {
      s.sig.perfectDrops++;
      s.sig.score += 20;
      haptic([20, 10, 20]);
    } else {
      s.sig.score += 10;
      haptic([30]);
    }

    // Determine if slider was "early" or "late" relative to center
    const slCenter  = slLeft + s.sliderWidth / 2;
    const topCenter = topLeft + top.width / 2;
    if (slCenter < topCenter) s.sig.earlyDrops++;
    else if (slCenter > topCenter) s.sig.lateDrops++;

    // ⚡ Spawn particle debris for the trimmed overhang (left and/or right side)
    if (!isPerfect) {
      const spawnDebris = (fromX: number, toX: number, blockY: number) => {
        const segW = Math.abs(toX - fromX);
        if (segW < 2) return;
        const numP = Math.min(8, Math.max(2, Math.round(segW / 12)));
        for (let pi = 0; pi < numP; pi++) {
          const px = fromX + Math.random() * segW;
          const pw = 4 + Math.random() * 8;
          const ph = 4 + Math.random() * (BLOCK_HEIGHT * 0.6);
          s.particles.push({
            x: px, y: blockY,
            vx: (Math.random() - 0.5) * 2.5,
            vy: 1.5 + Math.random() * 3,
            w: pw, h: ph,
            color: s.accentColor,
            alpha: 0.85,
            life: 1,
          });
        }
      };
      // Left overhang trim
      if (slLeft < overlapLeft) spawnDebris(slLeft, overlapLeft, top.y - BLOCK_HEIGHT);
      // Right overhang trim
      if (slRight > overlapRight) spawnDebris(overlapRight, slRight, top.y - BLOCK_HEIGHT);
    }

    // New block placed at overlap position, one row above top
    const newY = top.y - BLOCK_HEIGHT;
    const newBlock: Block = {
      x: overlapLeft,
      width: overlap,
      y: newY,
      color: blockColor(s.stack.length, s.accentColor),
    };
    s.stack.push(newBlock);

    const height = s.stack.length - 1; // base doesn't count
    if (height > s.sig.maxHeight) s.sig.maxHeight = height;
    setScoreDisplay(s.sig.score);

    // Camera: scroll up if stack is getting tall
    if (canvas) {
      const stackTopInCanvas = newY - s.cameraY;
      if (stackTopInCanvas < canvas.height * 0.35) {
        s.cameraY -= (canvas.height * 0.35 - stackTopInCanvas);
      }
    }

    // Next slider: width = overlap (trimmed), center near top block
    s.sliderWidth = isPerfect ? top.width : overlap; // perfect keeps full width
    s.sliderX     = overlapLeft; // start from overlap position
    // Increase speed over time
    s.sliderSpeed = 3.5 + s.sig.blocksDropped * 0.12;

    // ⚡ Update height display with actual block count (not points)
    setHeightDisplay(s.sig.maxHeight);
    // Both perfect and hit play collect; sfx.collect() is spec hitSound
    sfx.collect();
  }, []);

  // ─── GAME LOOP ───────────────────────────────────────────────────────────

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;

    initStack(canvas);
    s.running  = true;
    s.timeLeft = DURATION;
    setPhase('playing');
    phaseRef.current = 'playing';
    stopMusicRef.current = startMusic('drive');

    // Timer
    timerRef.current = setInterval(() => {
      const st = stateRef.current;
      st.timeLeft = Math.max(0, st.timeLeft - 1);
      setTimeLeft(st.timeLeft);
      // Urgency cue at ≤5s
      if (st.timeLeft <= 5 && st.timeLeft > 0) sfx.tick();
      if (st.timeLeft <= 0) {
        st.running = false;
        clearInterval(timerRef.current!);
        cancelAnimationFrame(animRef.current);
        stopMusicRef.current?.();
        // ⚡ End sound + celebratory haptic
        sfx.success();
    hapticVictory();
    playVictoryFanfare();
    // Personal best tracking
    try {
      const _pbPrev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      const _pbVal = parseFloat(String(st.sig?.maxHeight ?? 0));
      if (!isNaN(_pbVal) && _pbVal > _pbPrev) {
        localStorage.setItem(PB_KEY, String(Math.round(_pbVal)));
        setIsNewBest(true);
      }
    } catch { /* ignore */ }


        setFinalSig({ ...st.sig });
        setPhase('done');
        phaseRef.current = 'done';
      }
    }, 1000);

    let lastTime = 0;
    function loop(ts: number) {
      if (!s.running) return;
      const dt = Math.min(ts - lastTime, 50);
      lastTime = ts;

      const cvs = canvasRef.current;
      if (!cvs) { animRef.current = requestAnimationFrame(loop); return; }
      const ctx = cvs.getContext('2d');
      if (!ctx) { animRef.current = requestAnimationFrame(loop); return; }
      // use cvs for dimensions below

      const W = cvs.width;
      const H = cvs.height;

      // Move slider
      s.sliderX += s.sliderDir * s.sliderSpeed * (dt / 16.67);
      if (s.sliderX + s.sliderWidth >= W) {
        s.sliderX  = W - s.sliderWidth;
        s.sliderDir = -1;
      } else if (s.sliderX <= 0) {
        s.sliderX  = 0;
        s.sliderDir = 1;
      }

      // Clear
      ctx.fillStyle = '#08090f';
      ctx.fillRect(0, 0, W, H);

      // Camera transform
      ctx.save();
      ctx.translate(0, -s.cameraY);

      // Draw stack blocks
      for (let i = 0; i < s.stack.length; i++) {
        const b = s.stack[i];
        const isPerfect = i > 0 && s.sig.overhangs[i - 1] <= PERFECT_PX;
        ctx.fillStyle = b.color;
        ctx.beginPath();
        const r = 6;
        ctx.moveTo(b.x + r, b.y);
        ctx.lineTo(b.x + b.width - r, b.y);
        ctx.quadraticCurveTo(b.x + b.width, b.y, b.x + b.width, b.y + r);
        ctx.lineTo(b.x + b.width, b.y + BLOCK_HEIGHT - r);
        ctx.quadraticCurveTo(b.x + b.width, b.y + BLOCK_HEIGHT, b.x + b.width - r, b.y + BLOCK_HEIGHT);
        ctx.lineTo(b.x + r, b.y + BLOCK_HEIGHT);
        ctx.quadraticCurveTo(b.x, b.y + BLOCK_HEIGHT, b.x, b.y + BLOCK_HEIGHT - r);
        ctx.lineTo(b.x, b.y + r);
        ctx.quadraticCurveTo(b.x, b.y, b.x + r, b.y);
        ctx.closePath();
        ctx.fill();
        if (isPerfect) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth   = 1.5;
          ctx.stroke();
        }
      }

      // Draw slider block
      if (s.stack.length > 0) {
        const top  = s.stack[s.stack.length - 1];
        const slY  = top.y - BLOCK_HEIGHT;
        ctx.fillStyle = s.accentColor;
        ctx.globalAlpha = 0.85 + 0.15 * Math.sin(ts / 180);
        const r2 = 6;
        ctx.beginPath();
        ctx.moveTo(s.sliderX + r2, slY);
        ctx.lineTo(s.sliderX + s.sliderWidth - r2, slY);
        ctx.quadraticCurveTo(s.sliderX + s.sliderWidth, slY, s.sliderX + s.sliderWidth, slY + r2);
        ctx.lineTo(s.sliderX + s.sliderWidth, slY + BLOCK_HEIGHT - r2);
        ctx.quadraticCurveTo(s.sliderX + s.sliderWidth, slY + BLOCK_HEIGHT, s.sliderX + s.sliderWidth - r2, slY + BLOCK_HEIGHT);
        ctx.lineTo(s.sliderX + r2, slY + BLOCK_HEIGHT);
        ctx.quadraticCurveTo(s.sliderX, slY + BLOCK_HEIGHT, s.sliderX, slY + BLOCK_HEIGHT - r2);
        ctx.lineTo(s.sliderX, slY + r2);
        ctx.quadraticCurveTo(s.sliderX, slY, s.sliderX + r2, slY);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.restore();

      // ⚡ Miss shake + MISS! text flash (600ms)
      if (s.missActive) {
        if (s.missStartTs === 0) s.missStartTs = ts;
        const elapsed = ts - s.missStartTs;
        if (elapsed < 600) {
          // Shake: oscillate canvas translate
          const shakeX = Math.sin(elapsed * 0.08) * 7 * (1 - elapsed / 600);
          ctx.save();
          ctx.translate(shakeX, 0);
          ctx.font         = 'bold 32px sans-serif';
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'middle';
          const alpha = Math.max(0, 1 - elapsed / 600);
          ctx.globalAlpha = alpha;
          ctx.fillStyle   = '#ef4444';
          ctx.fillText('MISS!', W / 2, H / 2);
          ctx.globalAlpha = 1;
          ctx.restore();
        } else {
          s.missActive   = false;
          s.missStartTs  = 0;
        }
      }

      animRef.current = requestAnimationFrame(loop);
    }

    animRef.current = requestAnimationFrame(loop);
  }, [initStack]);

  // ─── CANVAS SETUP ────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = () => {
      if (phaseRef.current !== 'playing') return;
      dropBlock();
    };
    canvas.addEventListener('pointerdown', onPointerDown);

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [dropBlock]);

  // ─── CLEANUP ─────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []);

  // ─── PHASE HANDLERS ──────────────────────────────────────────────────────

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    await initAudio(); sfx.click();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
    phaseRef.current = 'countdown';
  }, []);

  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    setPhase('start');
    phaseRef.current = 'start';
    setScoreDisplay(0);
    setHeightDisplay(0);
    setTimeLeft(DURATION);
    setFinalSig(null);
  }, []);

  // ─── INSIGHTS ────────────────────────────────────────────────────────────

  const buildInsights = (sig: Signals) => {
    const avgOverhang = sig.overhangs.length > 0
      ? Math.round(sig.overhangs.reduce((a, b) => a + b, 0) / sig.overhangs.length)
      : 0;
    return [
      { label: 'Max Height', value: `${sig.maxHeight} blocks`, color: sig.maxHeight >= 12 ? '#4ade80' : sig.maxHeight >= 7 ? '#facc15' : '#ef4444' },
      { label: 'Perfect Drops', value: `${sig.perfectDrops}`, color: sig.perfectDrops >= 8 ? '#4ade80' : sig.perfectDrops >= 4 ? '#facc15' : '#ef4444' },
      { label: 'Avg Overhang', value: `${avgOverhang}px`, color: avgOverhang < 15 ? '#4ade80' : avgOverhang < 30 ? '#facc15' : '#ef4444' },
      { label: 'Blocks Stacked', value: `${sig.blocksDropped}`, color: theme.colors.accent ?? ACCENT },
    ];
  };

  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="stack-drop"
          steps={[{ icon: "👆", title: "Tap to drop", body: "Tap the screen to drop the block onto the stack." }, { icon: "⬜", title: "Stack perfectly", body: "Align blocks precisely — overhanging parts fall off." }, { icon: "🏆", title: "Stack higher", body: "How tall can you build before it falls?" }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Drop In"
          accentColor={theme.colors.accent ?? ACCENT}
          onStart={handleStart}
        />
      )}

      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}

      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas
            ref={canvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
          />
          {phase === 'playing' && (
            <GameHUD
              accentColor={theme.colors.accent ?? ACCENT}
              items={[
                { label: 'TIME',   value: timeLeft,       danger: timeLeft <= 10 },
                { label: 'HEIGHT', value: heightDisplay },
              ]}
            />
          )}
        </>
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

{phase === 'done' && finalSig && (
        <EndScreen
          gameId={GAME_ID}
          title={getPersonality(finalSig)}
          emoji={GAME_EMOJI}
          score={`${finalSig.maxHeight} blocks`}
          personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)}
          accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain}
          didWin={finalSig.maxHeight >= 8}
        />
      )}

      {phase === 'done' && finalSig && (
        <StackWebhookEmitter theme={theme} sig={finalSig} player={playerSessionRef.current} />
      )}
      {phase === 'playing' && (
        <>
          <ScorePopEffect pops={pops} accentColor={CATEGORY_ACCENT} />
          <StreakBadge streak={streak} accentColor={CATEGORY_ACCENT} />
        </>
      )}
    </GameShell>
    </>
  );
}

function StackWebhookEmitter({ theme, sig, player }: {
  theme: ReturnType<typeof useBrandTheme>;
  sig: Signals;
  player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const avgOverhang = sig.overhangs.length > 0
      ? Math.round(sig.overhangs.reduce((a, b) => a + b, 0) / sig.overhangs.length)
      : 0;
    postWebhook(theme, GAME_ID, {
      personality:    getPersonality(sig),
      score:          sig.score,
      maxHeight:      sig.maxHeight,
      blocksDropped:  sig.blocksDropped,
      perfectDrops:   sig.perfectDrops,
      avgOverhang,
      earlyDropRate:  sig.blocksDropped > 0 ? parseFloat((sig.earlyDrops / sig.blocksDropped).toFixed(3)) : 0,
    }, player);
  }, [theme, sig, player]);
  return null;
}
