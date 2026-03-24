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

const GAME_ID = 'drop-zone';
const ACCENT = '#22d3ee';
const DURATION = 45;
const GAME_EMOJI = '🎯';
const GAME_TITLE = 'Drop Zone';
const GAME_TAGLINE = 'Release at the right moment.';

interface Zone { x: number; w: number; pts: number; color: string; label: string; }
interface Ball { x: number; y: number; r: number; vx: number; active: boolean; released: boolean; vy: number; }
interface Signals { totalDrops: number; bullseyes: number; misses: number; goodDrops: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.totalDrops > 0 ? (sig.bullseyes + sig.goodDrops) / sig.totalDrops : 0;
  if (sig.bullseyes >= 5 && acc >= 0.8) return 'Dead Eye 🎯';
  if (sig.maxStreak >= 5) return 'Zone Finder 🌀';
  if (acc >= 0.6) return 'Good Aim 👀';
  if (sig.totalDrops >= 15) return 'Keep Dropping 📦';
  return 'Off Target 🎪';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  ball: Ball; zones: Zone[]; pendulumAngle: number; pendulumSpeed: number;
  accentColor: string; floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  scorePop: number; frame: number; impactFlash: number;
}

export default function DropZone() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalDrops: 0, bullseyes: 0, misses: 0, goodDrops: 0, maxStreak: 0, streakCurrent: 0, score: 0 },
    ball: { x: 0, y: 80, r: 18, vx: 3, active: true, released: false, vy: 0 },
    zones: [], pendulumAngle: 0, pendulumSpeed: 0.03, accentColor: ACCENT, floats: [], scorePop: 0, frame: 0, impactFlash: 0,
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

  const resetBall = useCallback((W: number) => {
    const s = stateRef.current;
    s.ball = { x: 30, y: 80, r: 18, vx: 2.5 + Math.random() * 2, active: true, released: false, vy: 0 };
    if (Math.random() < 0.5) s.ball.vx = -s.ball.vx;
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalDrops: 0, bullseyes: 0, misses: 0, goodDrops: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    // Zones
    const zoneW = W / 5;
    s.zones = [
      { x: 0, w: zoneW, pts: 1, color: '#3b82f6', label: 'OK' },
      { x: zoneW, w: zoneW, pts: 2, color: '#10b981', label: 'GOOD' },
      { x: zoneW*2, w: zoneW, pts: 5, color: '#fbbf24', label: 'BULL' },
      { x: zoneW*3, w: zoneW, pts: 2, color: '#10b981', label: 'GOOD' },
      { x: zoneW*4, w: zoneW, pts: 1, color: '#3b82f6', label: 'OK' },
    ];
    resetBall(W);
    s.pendulumAngle = 0; s.pendulumSpeed = 0.025; s.frame = 0; s.floats = []; s.scorePop = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    timerRef.current = setInterval(() => { s.timeLeft--; setTimeLeft(s.timeLeft); if (s.timeLeft <= 0) { sfx.fail(); endGame(); } }, 1000);

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);
      s.frame++;
      // Background: industrial factory
      ctx.fillStyle = '#080c12'; ctx.fillRect(0, 0, W, H);
      // Factory ceiling lines
      ctx.strokeStyle = 'rgba(34,211,238,0.06)'; ctx.lineWidth = 2;
      for (let cx = 0; cx < W; cx += 60) { ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, 60); ctx.stroke(); }

      // Pendulum conveyor
      s.pendulumAngle += s.pendulumSpeed;
      const pendulumX = W/2 + Math.sin(s.pendulumAngle) * (W/2 - 40);

      // Ball physics
      if (s.ball.active) {
        if (!s.ball.released) {
          // Ball follows pendulum on conveyor
          s.ball.x = pendulumX;
          s.ball.y = 80;
        } else {
          s.ball.vy += 0.4;
          s.ball.x += s.ball.vx * 0.5;
          s.ball.y += s.ball.vy;
          s.ball.x = Math.max(s.ball.r, Math.min(W - s.ball.r, s.ball.x));
          // Landing
          if (s.ball.y + s.ball.r >= H - 80) {
            s.ball.active = false;
            s.impactFlash = 15;
            const zone = s.zones.find(z => s.ball.x >= z.x && s.ball.x < z.x + z.w);
            if (zone) {
              s.sig.totalDrops++;
              const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
              const pts = zone.pts * mult;
              s.sig.score += pts;
              s.scorePop = Date.now() + 300;
              setScoreDisplay(s.sig.score);
              if (zone.pts >= 5) { s.sig.bullseyes++; sfx.success(); hapticScore(); }
              else if (zone.pts >= 2) { s.sig.goodDrops++; sfx.collect(); hapticScore(); }
              else sfx.click();
              s.sig.streakCurrent++;
              if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
              s.floats.push({ x: s.ball.x, y: H - 100, text: `+${pts} ${zone.label}`, alpha: 1, vy: -2.5, color: zone.color });
              hapticImpact();
            } else {
              s.sig.misses++; s.sig.streakCurrent = 0; hapticFail(); sfx.collision();
            }
            setTimeout(() => { if (s.running) resetBall(W); }, 500);
          }
        }
      }

      // Draw zones
      const zoneH = 80;
      s.zones.forEach(z => {
        ctx.fillStyle = z.color + '18'; ctx.fillRect(z.x, H - zoneH, z.w, zoneH);
        ctx.strokeStyle = z.color + '60'; ctx.lineWidth = 1;
        ctx.strokeRect(z.x, H - zoneH, z.w, zoneH);
        ctx.fillStyle = z.color; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(z.label, z.x + z.w/2, H - zoneH/2 + 5);
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText(`+${z.pts}`, z.x + z.w/2, H - zoneH/2 + 24);
      });

      // Impact flash
      if (s.impactFlash > 0) {
        ctx.fillStyle = `rgba(34,211,238,${s.impactFlash / 15 * 0.3})`;
        ctx.fillRect(0, 0, W, H);
        s.impactFlash--;
      }

      // Conveyor rope
      ctx.save(); ctx.strokeStyle = '#334155'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 40); ctx.lineTo(W, 40); ctx.stroke();
      // Conveyor hook
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(pendulumX, 40); ctx.lineTo(pendulumX, 70); ctx.stroke();
      ctx.beginPath(); ctx.arc(pendulumX, 40, 6, 0, Math.PI*2); ctx.fillStyle = ACCENT; ctx.fill();
      ctx.restore();

      // Ball
      if (s.ball.active) {
        const trail = s.ball.released;
        ctx.save();
        ctx.shadowBlur = 16; ctx.shadowColor = ACCENT;
        const ballGrad = ctx.createRadialGradient(s.ball.x-4, s.ball.y-4, 2, s.ball.x, s.ball.y, s.ball.r);
        ballGrad.addColorStop(0, '#67e8f9'); ballGrad.addColorStop(1, '#0e7490');
        ctx.fillStyle = ballGrad;
        ctx.beginPath(); ctx.arc(s.ball.x, s.ball.y, s.ball.r, 0, Math.PI*2); ctx.fill();
        if (!trail) {
          // Release arrow
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(s.ball.x, s.ball.y + s.ball.r + 5); ctx.lineTo(s.ball.x, s.ball.y + s.ball.r + 25); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(s.ball.x - 6, s.ball.y + s.ball.r + 18); ctx.lineTo(s.ball.x, s.ball.y + s.ball.r + 25); ctx.lineTo(s.ball.x + 6, s.ball.y + s.ball.r + 18); ctx.stroke();
        }
        ctx.restore();
      }

      if (s.scorePop > Date.now()) {
        const t = (s.scorePop - Date.now()) / 300;
        ctx.save(); ctx.globalAlpha = t; ctx.font = `bold ${Math.round(38*(1+(1-t)*0.3))}px sans-serif`;
        ctx.fillStyle = ACCENT; ctx.textAlign = 'center'; ctx.fillText(`${s.sig.score}`, W/2, 130); ctx.restore();
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
  }, [endGame, resetBall]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    const onPointerDown = () => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.ball.active && !s.ball.released) { s.ball.released = true; s.ball.vy = 0; sfx.click(); }
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    return () => { window.removeEventListener('resize', resize); canvas.removeEventListener('pointerdown', onPointerDown); };
  }, [phase]);

  useEffect(() => () => { cancelAnimationFrame(animRef.current); if (timerRef.current) clearInterval(timerRef.current); }, []);
  const handleStart = useCallback(async (name: string, avatar: string) => { playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); await initAudio(); setPhase('countdown'); }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Tap to release the ball when it's above the bullseye target!" ctaLabel="Drop! 🎯" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <><canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Drop zone precision game canvas" />
        {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}</>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Bullseyes', value: String(finalSig.bullseyes), color: '#fbbf24' }, { label: 'Good Drops', value: String(finalSig.goodDrops), color: ACCENT }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' }, { label: 'Missed', value: String(finalSig.misses), color: '#ef4444' }]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.bullseyes >= 3} />
      )}
    </GameShell>
  );
}
