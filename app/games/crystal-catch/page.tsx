'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticImpact } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'crystal-catch';
const ACCENT = '#818cf8';
const DURATION = 45;
const GAME_EMOJI = '💎';
const GAME_TITLE = 'Crystal Catch';
const GAME_TAGLINE = 'Tilt and collect. Don\'t shatter them.';

interface Crystal { x: number; y: number; vy: number; r: number; color: string; id: number; dangerous: boolean; }

interface Signals {
  totalCrystals: number; caught: number; shattered: number; dangerous: number;
  maxStreak: number; streakCurrent: number; score: number; maxTiltAngle: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.totalCrystals > 0 ? sig.caught / sig.totalCrystals : 0;
  if (acc >= 0.9 && sig.shattered === 0) return 'Crystal Guardian 💎';
  if (sig.caught >= 30) return 'Gem Collector 💜';
  if (sig.maxStreak >= 8) return 'Combo Catcher ✨';
  if (acc >= 0.6) return 'Careful Handler 🤲';
  return 'Clumsy Gatherer 🙈';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

const CRYSTAL_COLORS = ['#818cf8', '#a78bfa', '#c084fc', '#e879f9', '#38bdf8'];

interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  crystals: Crystal[]; nextId: number; basketX: number; basketW: number;
  tiltX: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  scorePop: number; frame: number; shatterParticles: Array<{ x: number; y: number; vx: number; vy: number; r: number; alpha: number; color: string }>;
}

export default function CrystalCatch() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalCrystals: 0, caught: 0, shattered: 0, dangerous: 0, maxStreak: 0, streakCurrent: 0, score: 0, maxTiltAngle: 0 },
    crystals: [], nextId: 0, basketX: 0, basketW: 80, tiltX: 0,
    accentColor: ACCENT, floats: [], scorePop: 0, frame: 0, shatterParticles: [],
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

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalCrystals: 0, caught: 0, shattered: 0, dangerous: 0, maxStreak: 0, streakCurrent: 0, score: 0, maxTiltAngle: 0 };
    s.crystals = []; s.nextId = 0; s.basketX = W / 2; s.basketW = 80; s.tiltX = 0;
    s.floats = []; s.scorePop = 0; s.frame = 0; s.shatterParticles = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    // Accelerometer support
    const handleMotion = (e: DeviceMotionEvent) => {
      if (!s.running) return;
      const x = e.accelerationIncludingGravity?.x ?? 0;
      s.tiltX = x;
      if (Math.abs(x) > s.sig.maxTiltAngle) s.sig.maxTiltAngle = Math.abs(x);
    };
    window.addEventListener('devicemotion', handleMotion);

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);
      s.frame++;

      // Background: crystal cave
      const bg = ctx.createRadialGradient(W * 0.5, 0, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
      bg.addColorStop(0, '#0a0820');
      bg.addColorStop(0.5, '#06041a');
      bg.addColorStop(1, '#020212');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Crystal stalactites in background
      for (let i = 0; i < 8; i++) {
        const cx = (i / 8) * W + W / 16;
        const ch = 30 + (i % 3) * 20;
        ctx.fillStyle = CRYSTAL_COLORS[i % CRYSTAL_COLORS.length] + '18';
        ctx.beginPath();
        ctx.moveTo(cx - 10, 0); ctx.lineTo(cx + 10, 0); ctx.lineTo(cx, ch);
        ctx.closePath(); ctx.fill();
      }

      // Move basket with tilt
      const tiltSens = 4;
      s.basketX = Math.max(s.basketW / 2, Math.min(W - s.basketW / 2, s.basketX - s.tiltX * tiltSens));

      // Spawn crystals
      if (s.frame % Math.max(20, 60 - Math.floor(s.frame / 100) * 5) === 0) {
        const isDangerous = Math.random() < 0.25;
        s.crystals.push({
          id: s.nextId++, x: 20 + Math.random() * (W - 40), y: -20,
          vy: 2 + Math.random() * 2 + s.frame * 0.003, r: 12 + Math.random() * 12,
          color: isDangerous ? '#ef4444' : CRYSTAL_COLORS[Math.floor(Math.random() * CRYSTAL_COLORS.length)],
          dangerous: isDangerous,
        });
        s.sig.totalCrystals++;
      }

      // Update crystals
      for (let i = s.crystals.length - 1; i >= 0; i--) {
        const c = s.crystals[i];
        c.y += c.vy;

        const basketTop = H - 70;
        if (c.y + c.r > basketTop && c.y - c.r < basketTop + 20 && Math.abs(c.x - s.basketX) < s.basketW / 2 + c.r * 0.5) {
          // Caught
          if (c.dangerous) {
            s.sig.dangerous++;
            s.sig.shattered++;
            s.sig.streakCurrent = 0;
            sfx.collision(); hapticFail();
            // Shatter effect
            for (let p = 0; p < 8; p++) {
              const angle = (p / 8) * Math.PI * 2;
              s.shatterParticles.push({ x: c.x, y: c.y, vx: Math.cos(angle) * 4, vy: Math.sin(angle) * 4, r: 4, alpha: 1, color: '#ef4444' });
            }
            s.floats.push({ x: c.x, y: c.y - 20, text: '💥 OUCH!', alpha: 1, vy: -2, color: '#ef4444' });
          } else {
            s.sig.caught++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
            s.sig.score += mult;
            s.scorePop = Date.now() + 300;
            setScoreDisplay(s.sig.score);
            sfx.collect(); hapticScore();
            s.floats.push({ x: c.x, y: basketTop - 20, text: `+${mult}${mult > 1 ? ' ✨' : ''}`, alpha: 1, vy: -2, color: ACCENT });
          }
          s.crystals.splice(i, 1);
          continue;
        }
        if (c.y - c.r > H) {
          if (!c.dangerous) {
            s.sig.shattered++;
            s.sig.streakCurrent = 0;
            hapticImpact();
          }
          s.crystals.splice(i, 1);
        }
      }

      // Update shatter particles
      s.shatterParticles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.alpha *= 0.9; });
      s.shatterParticles = s.shatterParticles.filter(p => p.alpha > 0.05);

      // Draw falling crystals
      s.crystals.forEach(c => {
        ctx.save();
        ctx.shadowBlur = 14; ctx.shadowColor = c.color;
        ctx.fillStyle = c.color + 'cc';
        ctx.strokeStyle = c.color;
        ctx.lineWidth = 2;
        // Diamond shape
        ctx.translate(c.x, c.y);
        ctx.rotate(s.frame * 0.03 + c.id);
        ctx.beginPath();
        ctx.moveTo(0, -c.r); ctx.lineTo(c.r * 0.7, 0);
        ctx.lineTo(0, c.r); ctx.lineTo(-c.r * 0.7, 0);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        // Inner shine
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.moveTo(0, -c.r * 0.5); ctx.lineTo(c.r * 0.3, 0); ctx.lineTo(0, c.r * 0.3); ctx.closePath(); ctx.fill();
        ctx.restore();
      });

      // Draw shatter particles
      s.shatterParticles.forEach(p => {
        ctx.save(); ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });

      // Draw basket
      const bx = s.basketX - s.basketW / 2;
      const by = H - 70;
      const tiltIndicator = s.tiltX;
      ctx.save();
      ctx.translate(s.basketX, by + 20);
      ctx.rotate(tiltIndicator * 0.05);
      ctx.shadowBlur = 12; ctx.shadowColor = ACCENT;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-s.basketW / 2, 0); ctx.lineTo(-s.basketW / 2 - 10, 40);
      ctx.lineTo(s.basketW / 2 + 10, 40); ctx.lineTo(s.basketW / 2, 0);
      ctx.stroke();
      // Basket lines
      for (let bLine = 0; bLine < 4; bLine++) {
        const bLX = -s.basketW / 2 + (bLine / 3) * (s.basketW + 10);
        ctx.strokeStyle = ACCENT + '66';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bLX - 5 + (bLine / 3) * -10, 0);
        ctx.lineTo(s.basketX - s.basketX + bLX, 40);
        ctx.stroke();
      }
      ctx.restore();

      // Score pop
      if (s.scorePop > Date.now()) {
        const t = (s.scorePop - Date.now()) / 300;
        ctx.save(); ctx.globalAlpha = t;
        ctx.font = `bold ${Math.round(38 * (1 + (1 - t) * 0.3))}px sans-serif`;
        ctx.fillStyle = ACCENT; ctx.textAlign = 'center';
        ctx.fillText(`${s.sig.score}`, W / 2, 80); ctx.restore();
      }

      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha;
        ctx.fillStyle = f.color; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.95;
      });

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [endGame]);

  // Touch fallback
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    let touchX = 0;
    const onPointerMove = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const dx = px - touchX;
      s.basketX = Math.max(s.basketW / 2, Math.min(canvas.width - s.basketW / 2, s.basketX + dx * 0.3));
      touchX = px;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const rect = canvas.getBoundingClientRect();
      touchX = (e.clientX - rect.left) * (canvas.width / rect.width);
    };

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointermove', onPointerMove);
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
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Tilt your device or drag to catch falling crystals! Avoid the red ones!"
          ctaLabel="Collect! 💎" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
            role="img" aria-label="Crystal catching game canvas" />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
              { label: 'SCORE', value: scoreDisplay },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Crystals Caught', value: String(finalSig.caught), color: ACCENT },
            { label: 'Shattered', value: String(finalSig.shattered), color: finalSig.shattered === 0 ? '#4ade80' : '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
            { label: 'Dangerous Caught', value: String(finalSig.dangerous), color: '#f97316' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.caught >= 15} />
      )}
    </GameShell>
  );
}
