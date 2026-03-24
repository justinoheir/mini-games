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

const GAME_ID = 'ripple-tap';
const ACCENT = '#06b6d4';
const DURATION = 30;
const GAME_EMOJI = '💧';
const GAME_TITLE = 'Ripple Tap';
const GAME_TAGLINE = 'Tap the peak. Not too early, not late.';

interface Ripple {
  id: number; x: number; y: number; r: number; maxR: number; growing: boolean;
  spawnTime: number; color: string; alpha: number; tapped: boolean; peaked: boolean;
}

interface Signals {
  totalRipples: number; perfect: number; early: number; late: number;
  maxStreak: number; streakCurrent: number; score: number; avgAccuracy: number; accuracySum: number;
}

function getPersonality(sig: Signals): string {
  const perf = sig.totalRipples > 0 ? sig.perfect / sig.totalRipples : 0;
  if (perf >= 0.7 && sig.maxStreak >= 4) return 'Zen Master 🧘';
  if (sig.perfect >= 10) return 'Perfect Timing ⏱️';
  if (sig.maxStreak >= 5) return 'On the Wave 🌊';
  if (perf >= 0.4) return 'Getting There 📈';
  return 'Learning the Flow 💧';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

const RIPPLE_COLORS = ['#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#10b981'];

interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  ripples: Ripple[]; nextId: number; spawnTimer: number;
  accentColor: string; scorePop: number;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  frame: number;
}

export default function RippleTap() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalRipples: 0, perfect: 0, early: 0, late: 0, maxStreak: 0, streakCurrent: 0, score: 0, avgAccuracy: 0, accuracySum: 0 },
    ripples: [], nextId: 0, spawnTimer: 0, accentColor: ACCENT, scorePop: 0, floats: [], frame: 0,
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

  const spawnRipple = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;
    const margin = 80;
    const maxR = 50 + Math.random() * 60;
    s.ripples.push({
      id: s.nextId++, x: margin + Math.random() * (W - margin * 2), y: margin + Math.random() * (H - margin * 2),
      r: 10, maxR, growing: true, spawnTime: Date.now(),
      color: RIPPLE_COLORS[Math.floor(Math.random() * RIPPLE_COLORS.length)],
      alpha: 1, tapped: false, peaked: false,
    });
    s.sig.totalRipples++;
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalRipples: 0, perfect: 0, early: 0, late: 0, maxStreak: 0, streakCurrent: 0, score: 0, avgAccuracy: 0, accuracySum: 0 };
    s.ripples = []; s.nextId = 0; s.frame = 0; s.floats = []; s.scorePop = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    spawnRipple();

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);
      s.frame++;

      // Background: deep ocean
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.3, 0, W * 0.5, H * 0.8, Math.max(W, H));
      bg.addColorStop(0, '#001a26');
      bg.addColorStop(0.6, '#000d1a');
      bg.addColorStop(1, '#00050d');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Wave shimmer
      ctx.strokeStyle = 'rgba(6,182,212,0.04)';
      ctx.lineWidth = 1;
      for (let gy = 0; gy < H; gy += 40) {
        ctx.beginPath();
        for (let gx = 0; gx <= W; gx += 4) {
          const wy = gy + Math.sin((gx / W) * Math.PI * 4 + s.frame * 0.03) * 6;
          if (gx === 0) ctx.moveTo(gx, wy); else ctx.lineTo(gx, wy);
        }
        ctx.stroke();
      }

      // Spawn cadence
      if (s.frame % 40 === 0 && s.ripples.filter(r => !r.tapped).length < 5) spawnRipple();

      const growSpeed = 1.0;
      const shrinkSpeed = 0.8;

      s.ripples.forEach(r => {
        if (r.tapped) { r.alpha *= 0.88; return; }
        if (r.growing) {
          r.r += growSpeed;
          if (r.r >= r.maxR) { r.growing = false; r.peaked = true; }
        } else {
          r.r -= shrinkSpeed;
          if (r.r <= 8) {
            // Missed
            r.alpha = 0;
            s.sig.streakCurrent = 0;
            hapticFail();
            s.sig.late++;
          }
        }
      });
      s.ripples = s.ripples.filter(r => r.alpha > 0.01);

      // Draw ripples
      s.ripples.forEach(r => {
        if (r.tapped) return;
        const phase_pct = r.r / r.maxR;
        ctx.save();
        ctx.globalAlpha = r.alpha;
        ctx.shadowBlur = 20;
        ctx.shadowColor = r.color;

        // Multiple rings
        for (let ring = 0; ring < 3; ring++) {
          const ringR = r.r * (1 - ring * 0.15);
          const ringAlpha = 1 - ring * 0.3;
          ctx.strokeStyle = r.color;
          ctx.lineWidth = 3 - ring;
          ctx.globalAlpha = r.alpha * ringAlpha;
          ctx.beginPath();
          ctx.arc(r.x, r.y, ringR, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Peak indicator
        if (Math.abs(phase_pct - 1) < 0.1) {
          ctx.globalAlpha = r.alpha * 0.6;
          ctx.fillStyle = r.color;
          ctx.beginPath();
          ctx.arc(r.x, r.y, r.r * 0.15, 0, Math.PI * 2);
          ctx.fill();
        }

        // Fullness arc (outer indicator)
        ctx.globalAlpha = r.alpha * 0.4;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.maxR + 6, -Math.PI / 2, -Math.PI / 2 + phase_pct * Math.PI * 2);
        ctx.stroke();

        ctx.restore();
      });

      // Score pop
      if (s.scorePop > Date.now()) {
        const t = (s.scorePop - Date.now()) / 300;
        ctx.save(); ctx.globalAlpha = t;
        ctx.font = `bold ${Math.round(40 * (1 + (1 - t) * 0.3))}px sans-serif`;
        ctx.fillStyle = '#06b6d4'; ctx.textAlign = 'center';
        ctx.fillText(`${s.sig.score}`, W / 2, 90); ctx.restore();
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
  }, [endGame, spawnRipple]);

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
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);

      for (const r of s.ripples) {
        if (r.tapped) continue;
        const dist = Math.sqrt((px - r.x) ** 2 + (py - r.y) ** 2);
        if (dist <= r.maxR + 20) {
          r.tapped = true;
          const phasePct = r.r / r.maxR;
          const isPerfect = phasePct >= 0.85 && phasePct <= 1.0;
          const isEarly = phasePct < 0.5;

          if (isPerfect) {
            s.sig.perfect++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
            s.sig.score += 3 * mult;
            s.scorePop = Date.now() + 300;
            setScoreDisplay(s.sig.score);
            sfx.success();
            hapticScore();
            if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
            s.floats.push({ x: r.x, y: r.y - 20, text: `+${3 * mult} PERFECT! 💧`, alpha: 1, vy: -2.5, color: '#06b6d4' });
          } else if (!isEarly) {
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            s.sig.score += 1;
            s.scorePop = Date.now() + 300;
            setScoreDisplay(s.sig.score);
            sfx.collect();
            hapticScore();
            s.floats.push({ x: r.x, y: r.y - 20, text: '+1', alpha: 1, vy: -2, color: '#4ade80' });
          } else {
            s.sig.early++;
            s.sig.streakCurrent = 0;
            sfx.collision();
            hapticFail();
            s.floats.push({ x: r.x, y: r.y - 20, text: 'Too early!', alpha: 1, vy: -1.5, color: '#ef4444' });
          }
          break;
        }
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
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
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Tap the Wave 💧" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
            role="img" aria-label="Ripple timing game canvas" />
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
            { label: 'Perfect Taps', value: String(finalSig.perfect), color: '#06b6d4' },
            { label: 'Too Early', value: String(finalSig.early), color: '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
            { label: 'Total Taps', value: String(finalSig.totalRipples), color: '#a855f7' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.perfect >= 5} />
      )}
    </GameShell>
  );
}
