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
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'balloon-pop';
const ACCENT = '#f43f5e';
const DURATION = 30;
const GAME_EMOJI = '🎈';
const GAME_TITLE = 'Balloon Pop';
const GAME_TAGLINE = 'Pinch to pop before they overflow!';

interface Balloon {
  id: number; x: number; y: number; r: number; maxR: number;
  color: string; growing: boolean; alpha: number; popping: boolean;
  popTimer: number; vy: number;
}

interface Signals {
  totalBalloons: number; popped: number; missed: number;
  earlyPops: number; perfectPops: number;
  maxStreak: number; streakCurrent: number; score: number;
}

function getPersonality(sig: Signals): string {
  const perfect = sig.perfectPops;
  if (perfect >= 5 && sig.maxStreak >= 3) return 'Precision Popper 🎯';
  if (sig.popped >= 15) return 'Pop Maniac 🎈';
  if (sig.earlyPops > sig.popped / 2) return 'Trigger Happy 🚀';
  if (sig.maxStreak >= 4) return 'Combo King 👑';
  return 'Casual Popper 😊';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

const BALLOON_COLORS = ['#f43f5e', '#f97316', '#fbbf24', '#4ade80', '#06b6d4', '#a855f7', '#ec4899'];

interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  balloons: Balloon[]; nextId: number; spawnTimer: number;
  accentColor: string; scorePop: number;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
}

export default function BalloonPop() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalBalloons: 0, popped: 0, missed: 0, earlyPops: 0, perfectPops: 0, maxStreak: 0, streakCurrent: 0, score: 0 },
    balloons: [], nextId: 0, spawnTimer: 0, accentColor: ACCENT, scorePop: 0, floats: [],
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

  const spawnBalloon = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const W = canvas.width;
    const H = canvas.height;
    const maxR = 40 + Math.random() * 50;
    s.balloons.push({
      id: s.nextId++,
      x: 60 + Math.random() * (W - 120),
      y: H - 20,
      r: 10,
      maxR,
      color: BALLOON_COLORS[Math.floor(Math.random() * BALLOON_COLORS.length)],
      growing: true,
      alpha: 1,
      popping: false,
      popTimer: 0,
      vy: -(0.5 + Math.random() * 0.8),
    });
    s.sig.totalBalloons++;
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;

    s.running = true;
    s.timeLeft = DURATION;
    s.sig = { totalBalloons: 0, popped: 0, missed: 0, earlyPops: 0, perfectPops: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.balloons = [];
    s.nextId = 0;
    s.spawnTimer = 0;
    s.floats = [];
    s.scorePop = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    let frame = 0;

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);

      // Background: festive gradient
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.3, 0, W * 0.5, H * 0.5, Math.max(W, H));
      bg.addColorStop(0, '#1a0030');
      bg.addColorStop(0.5, '#0f001a');
      bg.addColorStop(1, '#080010');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Confetti dots
      for (let i = 0; i < 20; i++) {
        const bx = ((i * 137 + frame * 0.3) % W);
        const by = ((i * 91 + frame * 0.5) % H);
        ctx.fillStyle = BALLOON_COLORS[i % BALLOON_COLORS.length] + '22';
        ctx.beginPath();
        ctx.arc(bx, by, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Spawn balloon
      frame++;
      const spawnRate = Math.max(20, 60 - frame * 0.3);
      if (frame % Math.floor(spawnRate) === 0) spawnBalloon();

      // Update balloons
      s.balloons.forEach(b => {
        if (b.popping) {
          b.popTimer++;
          b.alpha = Math.max(0, 1 - b.popTimer / 12);
          b.r *= 1.08;
          return;
        }
        b.y += b.vy;
        if (b.growing) {
          b.r = Math.min(b.r + 0.5, b.maxR);
          if (b.r >= b.maxR) b.growing = false;
        }
        // Missed if off-screen top
        if (b.y + b.r < 0) {
          s.sig.missed++;
          s.sig.streakCurrent = 0;
          b.alpha = 0;
        }
        // Burst if too big
        if (!b.growing && b.r >= b.maxR * 1.5) {
          s.sig.missed++;
          s.sig.streakCurrent = 0;
          hapticFail();
          b.alpha = 0;
        }
      });
      s.balloons = s.balloons.filter(b => b.alpha > 0.01);

      // Draw balloons
      s.balloons.forEach(b => {
        ctx.save();
        ctx.globalAlpha = b.alpha;

        if (b.popping) {
          ctx.strokeStyle = b.color;
          ctx.lineWidth = 2;
          for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const len = b.r * 0.4;
            ctx.beginPath();
            ctx.moveTo(b.x + Math.cos(angle) * (b.r * 0.5), b.y + Math.sin(angle) * (b.r * 0.5));
            ctx.lineTo(b.x + Math.cos(angle) * (b.r * 0.5 + len), b.y + Math.sin(angle) * (b.r * 0.5 + len));
            ctx.stroke();
          }
        } else {
          ctx.shadowBlur = 12;
          ctx.shadowColor = b.color;
          const grad = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, 2, b.x, b.y, b.r);
          grad.addColorStop(0, b.color + 'ff');
          grad.addColorStop(0.7, b.color + 'cc');
          grad.addColorStop(1, b.color + '44');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
          ctx.fill();

          // Shine
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.beginPath();
          ctx.ellipse(b.x - b.r * 0.25, b.y - b.r * 0.25, b.r * 0.2, b.r * 0.12, -Math.PI / 4, 0, Math.PI * 2);
          ctx.fill();

          // Stem
          ctx.strokeStyle = b.color + '88';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y + b.r);
          ctx.lineTo(b.x + Math.sin(frame * 0.05 + b.id) * 4, b.y + b.r + 15);
          ctx.stroke();

          // Fullness indicator ring
          const fullness = b.r / b.maxR;
          ctx.strokeStyle = fullness > 0.85 ? '#ef4444' : 'rgba(255,255,255,0.3)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r + 4, -Math.PI / 2, -Math.PI / 2 + fullness * Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      });

      // Score pop
      if (s.scorePop > Date.now()) {
        const t = (s.scorePop - Date.now()) / 300;
        ctx.save();
        ctx.globalAlpha = t;
        ctx.font = `bold ${Math.round(40 * (1 + (1 - t) * 0.3))}px sans-serif`;
        ctx.fillStyle = '#fbbf24';
        ctx.textAlign = 'center';
        ctx.shadowBlur = 8; ctx.shadowColor = '#fbbf24';
        ctx.fillText(`${s.sig.score}`, W / 2, 90);
        ctx.restore();
      }

      // Float texts
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha;
        ctx.fillStyle = f.color; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.95;
      });

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnBalloon]);

  // Multi-touch pinch detection
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);
      activePointers.current.set(e.pointerId, { x, y });
      canvas.setPointerCapture(e.pointerId);

      // Check if two pointers are on same balloon (pinch-pop)
      if (activePointers.current.size >= 2) {
        const pts = Array.from(activePointers.current.values());
        const s = stateRef.current;
        const W = canvas.width;
        for (const b of s.balloons) {
          if (b.popping) continue;
          let allOnBalloon = true;
          for (const pt of pts) {
            const d = Math.sqrt((pt.x - b.x) ** 2 + (pt.y - b.y) ** 2);
            if (d > b.r + 20) { allOnBalloon = false; break; }
          }
          if (allOnBalloon) {
            b.popping = true;
            b.popTimer = 0;
            const fullness = b.r / b.maxR;
            const isPerfect = fullness >= 0.85;
            if (isPerfect) s.sig.perfectPops++; else s.sig.earlyPops++;
            s.sig.popped++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const pts2 = isPerfect ? 3 : 1;
            const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
            s.sig.score += pts2 * mult;
            s.scorePop = Date.now() + 300;
            setScoreDisplay(s.sig.score);
            sfx.collect();
            hapticScore();
            if (s.sig.streakCurrent >= 3) { hapticCombo(s.sig.streakCurrent); sfx.success(); }
            const label = isPerfect ? `+${pts2 * mult} PERFECT! 🎯` : `+${pts2 * mult}`;
            s.floats.push({ x: b.x, y: b.y - 30, text: label, alpha: 1, vy: -2.5, color: isPerfect ? '#fbbf24' : '#4ade80' });
            break;
          }
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => { activePointers.current.delete(e.pointerId); };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    };
  }, [phase]);

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
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Use two fingers to pinch-pop balloons at full size for bonus points!"
          ctaLabel="Pop it! 🎈" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
            role="img" aria-label="Balloon popping game canvas" />
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
            { label: 'Popped', value: String(finalSig.popped), color: ACCENT },
            { label: 'Perfect Pops', value: String(finalSig.perfectPops), color: '#fbbf24' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' },
            { label: 'Missed', value: String(finalSig.missed), color: '#ef4444' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.popped >= 5} />
      )}
    </GameShell>
  );
}
