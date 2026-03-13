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
import PlayerNameInput from '@/components/PlayerNameInput';

const GAME_ID      = 'stack-drop';
const ACCENT       = '#f97316';
const DURATION     = 60;
const GAME_EMOJI   = '🧱';
const GAME_TITLE   = 'Stack Drop';
const GAME_TAGLINE = 'Drop it. Stack it. Don\'t tip it.';

const BLOCK_HEIGHT   = 28;
const INITIAL_WIDTH  = 0.78; // fraction of canvas width
const MIN_WIDTH_FRAC = 0.08; // below this, block is "lost"
const PERFECT_PX     = 10;   // overlap within this = perfect drop

interface Block {
  x: number;       // left edge
  width: number;
  y: number;       // top edge in canvas coords
  color: string;
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
  });
  const phaseRef     = useRef<Phase>('start');

  const [phase, setPhase]             = useState<Phase>('start');
  const [timeLeft, setTimeLeft]       = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]       = useState<Signals | null>(null);
  const [playerName, setPlayerName]   = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
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

    if (overlap <= 0) {
      // Completely missed — don't add to stack, just reset slider
      sfx.collision();
      haptic([60]);
      s.sliderWidth  = top.width; // keep slider same as top block
      s.sliderX      = (canvasRef.current?.width ?? 300) / 2 - s.sliderWidth / 2;
      s.sig.score    = Math.max(0, s.sig.score - 5);
      setScoreDisplay(s.sig.score);
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
    const canvas = canvasRef.current;
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

    if (isPerfect) sfx.collect();
    else sfx.collect();
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
      if (st.timeLeft <= 0) {
        st.running = false;
        clearInterval(timerRef.current!);
        cancelAnimationFrame(animRef.current);
        stopMusicRef.current?.();
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

  const handleStart = useCallback(() => {
    initAudio();
    playerSessionRef.current = savePlayerSession(GAME_ID, playerName, playerAvatar);
    setPhase('countdown');
    phaseRef.current = 'countdown';
  }, [playerName, playerAvatar]);

  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    setPhase('start');
    phaseRef.current = 'start';
    setScoreDisplay(0);
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
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Drop In"
          accentColor={theme.colors.accent ?? ACCENT}
          onStart={handleStart}
        >
          <PlayerNameInput
            accentColor={theme.colors.accent ?? ACCENT}
            onReady={(name, avatar) => { setPlayerName(name); setPlayerAvatar(avatar); }}
          />
        </GameStartScreen>
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
                { label: 'TIME',   value: timeLeft,      danger: timeLeft <= 10 },
                { label: 'HEIGHT', value: scoreDisplay },
              ]}
            />
          )}
        </>
      )}

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
    </GameShell>
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
