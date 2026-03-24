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

const GAME_ID = 'wobble-stack';
const ACCENT = '#fb923c';
const DURATION = 60;
const GAME_EMOJI = '🗼';
const GAME_TITLE = 'Wobble Stack';
const GAME_TAGLINE = 'Keep it balanced. It gets worse.';

interface Block { w: number; h: number; color: string; offsetX: number; angle: number; }
interface Signals {
  totalBlocks: number; survived: number; dropped: number;
  maxStack: number; maxStreak: number; streakCurrent: number; score: number; maxTilt: number;
}
function getPersonality(sig: Signals): string {
  if (sig.maxStack >= 12 && sig.dropped === 0) return 'Tower Master 🗼';
  if (sig.survived >= 15) return 'Steady Builder 🧱';
  if (sig.maxStreak >= 5) return 'Balanced Genius ⚖️';
  if (sig.dropped <= 2) return 'Careful Constructor 🔧';
  return 'Wobble Apprentice 🌀';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  stack: Block[]; tiltX: number; tiltVelocity: number; tiltAngle: number;
  newBlockTimer: number; gameOverTimer: number;
  accentColor: string; floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  scorePop: number; frame: number;
}
const BLOCK_COLORS = ['#fb923c','#f97316','#ea580c','#fbbf24','#f59e0b','#ef4444','#dc2626'];

export default function WobbleStack() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalBlocks: 0, survived: 0, dropped: 0, maxStack: 0, maxStreak: 0, streakCurrent: 0, score: 0, maxTilt: 0 },
    stack: [], tiltX: 0, tiltVelocity: 0, tiltAngle: 0,
    newBlockTimer: 0, gameOverTimer: 0, accentColor: ACCENT, floats: [], scorePop: 0, frame: 0,
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
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalBlocks: 0, survived: 0, dropped: 0, maxStack: 0, maxStreak: 0, streakCurrent: 0, score: 0, maxTilt: 0 };
    s.stack = [{ w: 120, h: 24, color: '#166534', offsetX: 0, angle: 0 }];
    s.tiltX = 0; s.tiltVelocity = 0; s.tiltAngle = 0; s.frame = 0; s.floats = []; s.scorePop = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    timerRef.current = setInterval(() => { s.timeLeft--; setTimeLeft(s.timeLeft); if (s.timeLeft <= 0) { sfx.fail(); endGame(); } }, 1000);
    const handleMotion = (e: DeviceMotionEvent) => {
      if (!s.running) return;
      const x = e.accelerationIncludingGravity?.x ?? 0;
      s.tiltX = x * 0.8;
      if (Math.abs(x) > s.sig.maxTilt) s.sig.maxTilt = Math.abs(x);
    };
    window.addEventListener('devicemotion', handleMotion);

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);
      s.frame++;
      // Background: warehouse
      ctx.fillStyle = '#0d0a06'; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 5; i++) {
        ctx.strokeStyle = `rgba(251,146,60,0.04)`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, (i / 5) * H); ctx.lineTo(W, (i / 5) * H); ctx.stroke();
      }
      // Add block every 3 seconds
      s.newBlockTimer++;
      if (s.newBlockTimer > 180) {
        s.newBlockTimer = 0;
        const w = Math.max(40, 120 - s.stack.length * 5);
        s.stack.push({ w, h: 22, color: BLOCK_COLORS[s.stack.length % BLOCK_COLORS.length], offsetX: (Math.random() - 0.5) * 20, angle: (Math.random() - 0.5) * 0.1 });
        s.sig.totalBlocks++;
        s.sig.survived++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        if (s.stack.length > s.sig.maxStack) s.sig.maxStack = s.stack.length;
        const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
        s.sig.score += mult;
        s.scorePop = Date.now() + 300;
        setScoreDisplay(s.sig.score);
        sfx.collect(); hapticScore();
        s.floats.push({ x: W/2, y: H*0.3, text: `+${mult} Block Added!`, alpha: 1, vy: -1.5, color: ACCENT });
      }
      // Physics: wobble from tilt
      s.tiltAngle += (s.tiltX * 0.001 + s.tiltVelocity);
      s.tiltVelocity *= 0.96;
      s.tiltVelocity += s.tiltX * 0.0008;
      s.tiltAngle *= 0.99; // natural dampening
      if (Math.abs(s.tiltAngle) > s.sig.maxTilt * 0.1) s.sig.maxTilt = Math.abs(s.tiltAngle) * 10;
      // Check if tower fell
      if (Math.abs(s.tiltAngle) > 0.6) {
        s.sig.dropped++;
        s.sig.streakCurrent = 0;
        hapticFail(); sfx.fail();
        s.floats.push({ x: W/2, y: H/2, text: '💥 FELL!', alpha: 1, vy: -2, color: '#ef4444' });
        // Reset with fewer blocks
        s.stack = s.stack.slice(0, Math.max(1, s.stack.length - 2));
        s.tiltAngle = 0; s.tiltVelocity = 0;
      }
      if (Math.abs(s.tiltAngle) > 0.3) { hapticWarning(); }
      // Draw tower
      const baseY = H * 0.85;
      const baseX = W / 2;
      ctx.save();
      ctx.translate(baseX, baseY);
      ctx.rotate(s.tiltAngle);
      let stackH = 0;
      for (let i = 0; i < s.stack.length; i++) {
        const b = s.stack[i];
        const by = -stackH - b.h;
        ctx.save();
        ctx.translate(b.offsetX, by);
        ctx.rotate(b.angle);
        ctx.shadowBlur = 6; ctx.shadowColor = b.color;
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.w/2, 0, b.w, b.h);
        // Stripe
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(-b.w/2, 0, b.w, 4);
        ctx.restore();
        stackH += b.h + 2;
      }
      ctx.restore();
      // Tilt meter
      const tiltPct = Math.min(1, Math.abs(s.tiltAngle) / 0.6);
      ctx.fillStyle = tiltPct > 0.7 ? '#ef4444' : tiltPct > 0.4 ? '#f59e0b' : '#4ade80';
      ctx.fillRect(10, H*0.4, 12, -(tiltPct * H * 0.3));
      ctx.strokeStyle = '#ffffff44'; ctx.lineWidth = 1;
      ctx.strokeRect(10, H*0.1, 12, H * 0.3);
      if (s.scorePop > Date.now()) {
        const t = (s.scorePop - Date.now()) / 300;
        ctx.save(); ctx.globalAlpha = t;
        ctx.font = `bold ${Math.round(38*(1+(1-t)*0.3))}px sans-serif`;
        ctx.fillStyle = ACCENT; ctx.textAlign = 'center';
        ctx.fillText(`${s.sig.score}`, W/2, 90); ctx.restore();
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
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [endGame]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    // Touch fallback
    let lastTX = 0;
    const onPointerDown = (e: PointerEvent) => { if (phase !== 'playing') return; const rect = canvas.getBoundingClientRect(); lastTX = (e.clientX - rect.left) * (canvas.width / rect.width); };
    const onPointerMove = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      s.tiltX = (px - lastTX) * 0.5;
      lastTX = px;
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
    };
  }, [phase]);

  useEffect(() => () => { cancelAnimationFrame(animRef.current); if (timerRef.current) clearInterval(timerRef.current); }, []);
  const handleStart = useCallback(async (name: string, avatar: string) => { playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); await initAudio(); setPhase('countdown'); }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Tilt to keep the growing tower balanced!" ctaLabel="Balance! 🗼" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <><canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Wobble stack balancing game canvas" />
        {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}</>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Max Stack', value: String(finalSig.maxStack), color: ACCENT }, { label: 'Dropped', value: String(finalSig.dropped), color: '#ef4444' }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' }, { label: 'Survived', value: String(finalSig.survived), color: '#4ade80' }]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.maxStack >= 8} />
      )}
    </GameShell>
  );
}
