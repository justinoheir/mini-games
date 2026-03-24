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

const GAME_ID = 'friction-slide';
const ACCENT = '#0ea5e9';
const DURATION = 45;
const GAME_EMOJI = '🛷';
const GAME_TITLE = 'Friction Slide';
const GAME_TAGLINE = 'Flick with precision. Stop on target.';

interface Puck { x: number; y: number; vx: number; vy: number; moving: boolean; r: number; color: string; }
interface Zone { x: number; y: number; w: number; h: number; pts: number; color: string; }
interface Signals { totalFlicks: number; bullseyes: number; goodLandings: number; misses: number; maxStreak: number; streakCurrent: number; score: number; avgError: number; errorSum: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.totalFlicks > 0 ? (sig.bullseyes + sig.goodLandings) / sig.totalFlicks : 0;
  if (sig.bullseyes >= 5 && acc >= 0.8) return 'Curling Champion 🥌';
  if (sig.maxStreak >= 5) return 'Smooth Operator 🌊';
  if (acc >= 0.7) return 'Precision Slider 🎯';
  if (sig.totalFlicks >= 12) return 'Getting the Feel 📊';
  return 'Finding Friction 🤔';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
const PUCK_COLORS = ['#0ea5e9','#38bdf8','#7dd3fc','#06b6d4'];

interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  puck: Puck; zones: Zone[]; dragging: boolean; dragStartX: number; dragStartY: number;
  accentColor: string; floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  scorePop: number; frame: number;
}

export default function FrictionSlide() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasRef>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalFlicks: 0, bullseyes: 0, goodLandings: 0, misses: 0, maxStreak: 0, streakCurrent: 0, score: 0, avgError: 0, errorSum: 0 },
    puck: { x: 0, y: 0, vx: 0, vy: 0, moving: false, r: 20, color: PUCK_COLORS[0] },
    zones: [], dragging: false, dragStartX: 0, dragStartY: 0,
    accentColor: ACCENT, floats: [], scorePop: 0, frame: 0,
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

  const resetPuck = useCallback((W: number, H: number) => {
    const s = stateRef.current;
    s.puck = { x: W / 2, y: H - 100, vx: 0, vy: 0, moving: false, r: 20, color: PUCK_COLORS[Math.floor(Math.random() * PUCK_COLORS.length)] };
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalFlicks: 0, bullseyes: 0, goodLandings: 0, misses: 0, maxStreak: 0, streakCurrent: 0, score: 0, avgError: 0, errorSum: 0 };
    const zW = W / 3, zH = 50;
    s.zones = [
      { x: 0, y: H * 0.25, w: zW, h: zH, pts: 1, color: '#3b82f6' },
      { x: zW, y: H * 0.25, w: zW, h: zH, pts: 3, color: '#10b981' },
      { x: zW*2, y: H * 0.25, w: zW, h: zH, pts: 1, color: '#3b82f6' },
      { x: W*0.25, y: H * 0.4, w: W * 0.5, h: zH, pts: 5, color: '#fbbf24' },
    ];
    resetPuck(W, H);
    s.dragging = false; s.frame = 0; s.floats = []; s.scorePop = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    timerRef.current = setInterval(() => { s.timeLeft--; setTimeLeft(s.timeLeft); if (s.timeLeft <= 0) { sfx.fail(); endGame(); } }, 1000);

    const FRICTION = 0.97;

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);
      s.frame++;
      // Background: ice rink
      ctx.fillStyle = '#e8f4fd'; ctx.fillRect(0, 0, W, H);
      // Ice texture
      ctx.strokeStyle = 'rgba(14,165,233,0.08)'; ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 25) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
      for (let gy = 0; gy < H; gy += 25) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
      // Rink border
      ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 3;
      ctx.strokeRect(5, 5, W-10, H-10);

      // Draw zones
      s.zones.forEach(z => {
        ctx.save();
        ctx.fillStyle = z.color + '44';
        ctx.fillRect(z.x, z.y, z.w, z.h);
        ctx.strokeStyle = z.color; ctx.lineWidth = 2;
        ctx.strokeRect(z.x, z.y, z.w, z.h);
        ctx.fillStyle = z.color;
        ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`+${z.pts}`, z.x + z.w/2, z.y + z.h/2 + 6);
        ctx.restore();
      });

      // Puck physics
      if (s.puck.moving) {
        s.puck.vx *= FRICTION; s.puck.vy *= FRICTION;
        s.puck.x += s.puck.vx; s.puck.y += s.puck.vy;
        // Wall bounce
        if (s.puck.x - s.puck.r < 5 || s.puck.x + s.puck.r > W - 5) s.puck.vx *= -0.7;
        if (s.puck.y - s.puck.r < 5) s.puck.vy *= -0.7;
        // Stopped
        const speed = Math.sqrt(s.puck.vx**2 + s.puck.vy**2);
        if (speed < 0.2) {
          s.puck.moving = false;
          s.puck.vx = 0; s.puck.vy = 0;
          // Score
          const zone = s.zones.find(z => s.puck.x >= z.x && s.puck.x <= z.x+z.w && s.puck.y >= z.y && s.puck.y <= z.y+z.h);
          s.sig.totalFlicks++;
          if (zone) {
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
            const pts = zone.pts * mult;
            s.sig.score += pts;
            s.scorePop = Date.now() + 300;
            setScoreDisplay(s.sig.score);
            if (zone.pts >= 5) { s.sig.bullseyes++; sfx.success(); hapticScore(); }
            else { s.sig.goodLandings++; sfx.collect(); hapticScore(); }
            s.floats.push({ x: s.puck.x, y: s.puck.y - 30, text: `+${pts}`, alpha: 1, vy: -2.5, color: zone.color });
          } else {
            s.sig.misses++; s.sig.streakCurrent = 0; hapticFail();
            s.floats.push({ x: s.puck.x, y: s.puck.y - 30, text: 'Miss!', alpha: 1, vy: -1.5, color: '#ef4444' });
          }
          hapticImpact();
          setTimeout(() => { if (s.running) resetPuck(W, H); }, 600);
        }
        // Off bottom
        if (s.puck.y > H + 50) {
          s.puck.moving = false;
          s.sig.misses++; s.sig.streakCurrent = 0; hapticFail();
          setTimeout(() => { if (s.running) resetPuck(W, H); }, 300);
        }
      }

      // Drag arrow
      if (s.dragging) {
        const dx = s.puck.x - s.dragStartX, dy = s.puck.y - s.dragStartY;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len > 5) {
          ctx.save();
          ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 3;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(s.puck.x, s.puck.y);
          ctx.lineTo(s.puck.x + dx * 1.5, s.puck.y + dy * 1.5);
          ctx.stroke(); ctx.setLineDash([]);
          ctx.restore();
        }
      }

      // Draw puck
      ctx.save();
      ctx.shadowBlur = s.puck.moving ? 20 : 10;
      ctx.shadowColor = s.puck.color;
      const grad = ctx.createRadialGradient(s.puck.x-4, s.puck.y-4, 2, s.puck.x, s.puck.y, s.puck.r);
      grad.addColorStop(0, '#7dd3fc'); grad.addColorStop(1, '#0369a1');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(s.puck.x, s.puck.y, s.puck.r, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.puck.x, s.puck.y, s.puck.r, 0, Math.PI*2); ctx.stroke();
      ctx.restore();

      if (s.scorePop > Date.now()) {
        const t = (s.scorePop - Date.now()) / 300;
        ctx.save(); ctx.globalAlpha = t; ctx.font = `bold ${Math.round(38*(1+(1-t)*0.3))}px sans-serif`;
        ctx.fillStyle = ACCENT; ctx.textAlign = 'center'; ctx.fillText(`${s.sig.score}`, W/2, 80); ctx.restore();
      }
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha; ctx.fillStyle = f.color; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.95;
      });
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, resetPuck]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.puck.moving) return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      if (Math.hypot(px - s.puck.x, py - s.puck.y) < s.puck.r + 30) {
        s.dragging = true; s.dragStartX = px; s.dragStartY = py;
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.dragging) return;
      s.dragging = false;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      const dx = s.dragStartX - px, dy = s.dragStartY - py;
      const len = Math.sqrt(dx*dx + dy*dy);
      if (len > 15) {
        s.puck.vx = (dx / len) * Math.min(len * 0.15, 12);
        s.puck.vy = (dy / len) * Math.min(len * 0.15, 12);
        s.puck.moving = true;
        sfx.click(); hapticScore();
      }
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [phase]);

  useEffect(() => () => { cancelAnimationFrame(animRef.current); if (timerRef.current) clearInterval(timerRef.current); }, []);
  const handleStart = useCallback(async (name: string, avatar: string) => { playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); await initAudio(); setPhase('countdown'); }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Flick the puck — judge the momentum to stop it on target!" ctaLabel="Slide! 🛷" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <><canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Friction slide precision game canvas" />
        {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}</>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Bullseyes', value: String(finalSig.bullseyes), color: '#fbbf24' }, { label: 'Good', value: String(finalSig.goodLandings), color: ACCENT }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' }, { label: 'Missed', value: String(finalSig.misses), color: '#ef4444' }]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.bullseyes >= 3} />
      )}
    </GameShell>
  );
}
