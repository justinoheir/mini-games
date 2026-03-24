'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticWarning } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'gravity-well';
const ACCENT = '#7c3aed';
const DURATION = 60;
const GAME_EMOJI = '🌌';
const GAME_TITLE = 'Gravity Well';
const GAME_TAGLINE = 'Orbit the well. Don\'t get pulled in.';

interface Well { x: number; y: number; strength: number; r: number; color: string; }
interface Goal { x: number; y: number; r: number; active: boolean; }
interface Signals { goalsReached: number; deaths: number; maxSurvivalTime: number; maxStreak: number; streakCurrent: number; score: number; totalTime: number; }
function getPersonality(sig: Signals): string {
  if (sig.deaths === 0 && sig.goalsReached >= 5) return 'Gravity Pilot 🌌';
  if (sig.goalsReached >= 8) return 'Space Navigator 🚀';
  if (sig.maxStreak >= 4) return 'Orbital Expert 💫';
  if (sig.goalsReached >= 3) return 'Getting the Pull 🌀';
  return 'Gravity Student 📚';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  shipX: number; shipY: number; shipVX: number; shipVY: number;
  wells: Well[]; goal: Goal; tiltX: number; tiltY: number;
  deathFlash: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  scorePop: number; frame: number; trail: Array<{ x: number; y: number; alpha: number }>;
}

export default function GravityWell() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { goalsReached: 0, deaths: 0, maxSurvivalTime: 0, maxStreak: 0, streakCurrent: 0, score: 0, totalTime: 0 },
    shipX: 0, shipY: 0, shipVX: 0, shipVY: 0, wells: [], goal: { x: 0, y: 0, r: 25, active: true },
    tiltX: 0, tiltY: 0, deathFlash: 0, accentColor: ACCENT, floats: [], scorePop: 0, frame: 0, trail: [],
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false; cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const placeGoal = useCallback((W: number, H: number, wells: Well[]) => {
    let gx = 0, gy = 0, tries = 0;
    do {
      gx = 60 + Math.random() * (W - 120);
      gy = 60 + Math.random() * (H - 120);
      tries++;
    } while (wells.some(w => Math.hypot(w.x - gx, w.y - gy) < 80) && tries < 30);
    return { x: gx, y: gy, r: 22, active: true };
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { goalsReached: 0, deaths: 0, maxSurvivalTime: 0, maxStreak: 0, streakCurrent: 0, score: 0, totalTime: 0 };
    const numWells = 3;
    s.wells = Array.from({ length: numWells }, (_, i) => ({
      x: 100 + (W - 200) * (i / (numWells - 1)), y: H * 0.3 + Math.random() * H * 0.4,
      strength: 1200 + Math.random() * 800, r: 22 + Math.random() * 15,
      color: ['#7c3aed','#4f46e5','#6d28d9'][i % 3],
    }));
    s.goal = placeGoal(W, H, s.wells);
    s.shipX = W / 2; s.shipY = H * 0.85;
    s.shipVX = 0; s.shipVY = -1;
    s.tiltX = 0; s.tiltY = 0; s.frame = 0; s.trail = []; s.floats = []; s.scorePop = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    timerRef.current = setInterval(() => { s.timeLeft--; setTimeLeft(s.timeLeft); if (s.timeLeft <= 0) { sfx.fail(); endGame(); } }, 1000);

    const handleMotion = (e: DeviceMotionEvent) => {
      if (!s.running) return;
      s.tiltX = (e.accelerationIncludingGravity?.x ?? 0) * 0.3;
      s.tiltY = (e.accelerationIncludingGravity?.y ?? 0) * -0.3;
    };
    window.addEventListener('devicemotion', handleMotion);

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);
      s.frame++;
      // Deep space background
      ctx.fillStyle = '#020208'; ctx.fillRect(0, 0, W, H);
      // Stars
      for (let i = 0; i < 50; i++) {
        const sx = (i * 137 + s.frame * 0.05) % W;
        const sy = (i * 79) % H;
        const alpha = 0.2 + Math.sin(s.frame * 0.02 + i) * 0.15;
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.beginPath(); ctx.arc(sx, sy, 1, 0, Math.PI*2); ctx.fill();
      }

      // Apply thrust from tilt
      s.shipVX += s.tiltX * 0.08;
      s.shipVY += s.tiltY * 0.08;

      // Gravity wells pull
      for (const w of s.wells) {
        const dx = w.x - s.shipX, dy = w.y - s.shipY;
        const distSq = dx*dx + dy*dy;
        const dist = Math.sqrt(distSq);
        if (dist < w.r + 12) {
          // Absorbed!
          s.sig.deaths++;
          s.sig.streakCurrent = 0;
          s.deathFlash = 20;
          hapticFail(); sfx.fail();
          s.floats.push({ x: s.shipX, y: s.shipY, text: '💥 Absorbed!', alpha: 1, vy: -2, color: '#ef4444' });
          s.shipX = W / 2; s.shipY = H * 0.85;
          s.shipVX = 0; s.shipVY = -1;
          s.trail = [];
          break;
        }
        const force = w.strength / distSq;
        s.shipVX += (dx / dist) * force * 0.016;
        s.shipVY += (dy / dist) * force * 0.016;
      }

      // Speed limit
      const speed = Math.sqrt(s.shipVX**2 + s.shipVY**2);
      if (speed > 8) { s.shipVX *= 8 / speed; s.shipVY *= 8 / speed; }

      s.shipX += s.shipVX; s.shipY += s.shipVY;
      // Wrap
      if (s.shipX < 0) s.shipX = W;
      if (s.shipX > W) s.shipX = 0;
      if (s.shipY < 0) s.shipY = H;
      if (s.shipY > H) s.shipY = 0;

      // Goal check
      if (s.goal.active && Math.hypot(s.shipX - s.goal.x, s.shipY - s.goal.y) < s.goal.r + 12) {
        s.sig.goalsReached++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
        s.sig.score += 5 * mult;
        s.scorePop = Date.now() + 400;
        setScoreDisplay(s.sig.score);
        sfx.success(); hapticScore();
        s.floats.push({ x: s.goal.x, y: s.goal.y - 20, text: `+${5*mult} ⭐`, alpha: 1, vy: -2, color: '#fbbf24' });
        s.goal = placeGoal(W, H, s.wells);
      }

      // Trail
      s.trail.push({ x: s.shipX, y: s.shipY, alpha: 0.8 });
      if (s.trail.length > 40) s.trail.shift();
      s.trail.forEach((pt, i) => {
        ctx.save(); ctx.globalAlpha = pt.alpha * (i / s.trail.length) * 0.6;
        ctx.fillStyle = ACCENT;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 3 * (i / s.trail.length), 0, Math.PI*2); ctx.fill();
        ctx.restore();
      });

      // Draw wells
      s.wells.forEach(w => {
        ctx.save();
        for (let ring = 5; ring >= 1; ring--) {
          const alpha = 0.05 + (5-ring) * 0.02;
          ctx.strokeStyle = `rgba(124,58,237,${alpha})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(w.x, w.y, w.r * ring * 1.2, 0, Math.PI*2); ctx.stroke();
        }
        ctx.shadowBlur = 20; ctx.shadowColor = w.color;
        const wGrad = ctx.createRadialGradient(w.x, w.y, 2, w.x, w.y, w.r);
        wGrad.addColorStop(0, '#ffffff'); wGrad.addColorStop(0.3, w.color); wGrad.addColorStop(1, '#000000');
        ctx.fillStyle = wGrad;
        ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      });

      // Goal
      if (s.goal.active) {
        const pulse = 1 + Math.sin(s.frame * 0.1) * 0.15;
        ctx.save();
        ctx.shadowBlur = 16; ctx.shadowColor = '#fbbf24';
        ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.goal.x, s.goal.y, s.goal.r * pulse, 0, Math.PI*2); ctx.stroke();
        ctx.fillStyle = '#fbbf2422';
        ctx.beginPath(); ctx.arc(s.goal.x, s.goal.y, s.goal.r * pulse, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#fbbf24'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('⭐', s.goal.x, s.goal.y + 6);
        ctx.restore();
      }

      // Ship
      const shipAngle = Math.atan2(s.shipVY, s.shipVX);
      ctx.save();
      ctx.translate(s.shipX, s.shipY); ctx.rotate(shipAngle);
      ctx.shadowBlur = 14; ctx.shadowColor = ACCENT;
      ctx.fillStyle = '#c4b5fd';
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-10, -8); ctx.lineTo(-6, 0); ctx.lineTo(-10, 8); ctx.closePath(); ctx.fill();
      ctx.restore();

      if (s.deathFlash > 0) {
        ctx.fillStyle = `rgba(239,68,68,${s.deathFlash/20*0.4})`; ctx.fillRect(0,0,W,H); s.deathFlash--;
      }
      if (s.scorePop > Date.now()) {
        const t = (s.scorePop - Date.now()) / 400;
        ctx.save(); ctx.globalAlpha = t; ctx.font = `bold ${Math.round(38*(1+(1-t)*0.3))}px sans-serif`;
        ctx.fillStyle = ACCENT; ctx.textAlign = 'center'; ctx.fillText(`${s.sig.score}`, W/2, 80); ctx.restore();
      }
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha; ctx.fillStyle = f.color; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.95;
      });
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [endGame, placeGoal]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    // Touch fallback
    const onPointerMove = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      s.tiltX = (px - canvas.width / 2) / canvas.width * 6;
      s.tiltY = (py - canvas.height / 2) / canvas.height * 6;
    };
    canvas.addEventListener('pointermove', onPointerMove);
    return () => { window.removeEventListener('resize', resize); canvas.removeEventListener('pointermove', onPointerMove); };
  }, [phase]);

  useEffect(() => () => { cancelAnimationFrame(animRef.current); if (timerRef.current) clearInterval(timerRef.current); }, []);
  const handleStart = useCallback(async (name: string, avatar: string) => { playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); await initAudio(); setPhase('countdown'); }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Tilt to steer your ship. Collect stars but avoid gravity wells!" ctaLabel="Launch! 🌌" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <><canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Gravity well navigation game canvas" />
        {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}</>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Stars Collected', value: String(finalSig.goalsReached), color: '#fbbf24' }, { label: 'Deaths', value: String(finalSig.deaths), color: '#ef4444' }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: ACCENT }, { label: 'Total Goals', value: String(finalSig.goalsReached), color: '#4ade80' }]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.goalsReached >= 5} />
      )}
    </GameShell>
  );
}
