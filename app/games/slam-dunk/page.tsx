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

const GAME_ID = 'slam-dunk';
const ACCENT = '#f97316';
const DURATION = 45;
const GAME_EMOJI = '🏀';
const GAME_TITLE = 'Slam Dunk';
const GAME_TAGLINE = 'Two fingers. One moment. Go!';

interface Signals { totalAttempts: number; dunks: number; almostDunks: number; perfectTiming: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.totalAttempts > 0 ? sig.dunks / sig.totalAttempts : 0;
  if (acc >= 0.85 && sig.perfectTiming >= 3) return 'Dunk King 👑';
  if (sig.dunks >= 10) return 'Slam Legend 🏆';
  if (sig.maxStreak >= 5) return 'On a Roll 🔥';
  if (acc >= 0.5) return 'Decent Dunker 🏀';
  return 'Air Ball ❌';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  playerY: number; playerVY: number; jumping: boolean; onGround: boolean;
  chargeLevel: number; charging: boolean; chargeStart: number;
  hoopX: number; hoopY: number; ballX: number; ballY: number;
  dunkWindow: boolean; dunkWindowTimer: number; lastDunkFrame: number;
  accentColor: string; floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  scorePop: number; frame: number; pointerCount: number; shakeX: number;
}
const activePointers = new Set<number>();

export default function SlamDunk() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalAttempts: 0, dunks: 0, almostDunks: 0, perfectTiming: 0, maxStreak: 0, streakCurrent: 0, score: 0 },
    playerY: 0, playerVY: 0, jumping: false, onGround: true,
    chargeLevel: 0, charging: false, chargeStart: 0,
    hoopX: 0, hoopY: 0, ballX: 0, ballY: 0, dunkWindow: false, dunkWindowTimer: 0, lastDunkFrame: -100,
    accentColor: ACCENT, floats: [], scorePop: 0, frame: 0, pointerCount: 0, shakeX: 0,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);
  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false; cancelAnimationFrame(animRef.current);
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
    s.sig = { totalAttempts: 0, dunks: 0, almostDunks: 0, perfectTiming: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.playerY = H * 0.78; s.playerVY = 0; s.jumping = false; s.onGround = true;
    s.hoopX = W / 2; s.hoopY = H * 0.28;
    s.ballX = W / 2; s.ballY = H * 0.72;
    s.chargeLevel = 0; s.charging = false;
    s.frame = 0; s.floats = []; s.scorePop = 0; s.shakeX = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    timerRef.current = setInterval(() => { s.timeLeft--; setTimeLeft(s.timeLeft); if (s.timeLeft <= 0) { sfx.fail(); endGame(); } }, 1000);

    const GRAVITY = 0.45;
    const GROUND = H * 0.78;

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);
      s.frame++;
      // Court background
      const bg = ctx.createRadialGradient(W*0.5, H*0.5, 0, W*0.5, H*0.5, H);
      bg.addColorStop(0, '#1a0a00'); bg.addColorStop(1, '#060300');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      // Court floor
      ctx.fillStyle = '#3d1a00'; ctx.fillRect(0, H*0.8, W, H*0.2);
      ctx.strokeStyle = 'rgba(249,115,22,0.2)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, H*0.8); ctx.lineTo(W, H*0.8); ctx.stroke();

      // Backboard
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(s.hoopX - 40, s.hoopY - 45, 80, 50);
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 3;
      ctx.strokeRect(s.hoopX - 16, s.hoopY - 30, 32, 24);

      // Hoop
      ctx.save();
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 5;
      ctx.shadowBlur = 10; ctx.shadowColor = ACCENT;
      ctx.beginPath(); ctx.arc(s.hoopX, s.hoopY, 22, 0, Math.PI); ctx.stroke();
      ctx.restore();

      // Net
      ctx.save();
      ctx.strokeStyle = 'rgba(220,220,220,0.6)'; ctx.lineWidth = 1;
      for (let i = 0; i <= 6; i++) {
        const nx = s.hoopX - 22 + (44/6)*i;
        ctx.beginPath(); ctx.moveTo(nx, s.hoopY); ctx.lineTo(s.hoopX, s.hoopY + 28); ctx.stroke();
      }
      for (let j = 1; j <= 3; j++) {
        const ny = s.hoopY + j * 8;
        ctx.beginPath(); ctx.moveTo(s.hoopX - 22*(1-j/4), ny); ctx.lineTo(s.hoopX + 22*(1-j/4), ny); ctx.stroke();
      }
      ctx.restore();

      // Player physics
      if (s.jumping) {
        s.playerVY += GRAVITY;
        s.playerY += s.playerVY;
        s.ballX = s.hoopX + Math.sin(s.frame * 0.3) * 5;
        s.ballY = s.playerY - 60;

        // Dunk window at top of jump
        if (Math.abs(s.playerY - s.hoopY - 40) < 40 && s.playerVY > -2 && s.playerVY < 2) {
          s.dunkWindow = true;
          s.dunkWindowTimer = Math.max(0, s.dunkWindowTimer - 1);
        } else {
          s.dunkWindow = false;
        }

        // Land
        if (s.playerY >= GROUND) {
          s.playerY = GROUND; s.playerVY = 0; s.jumping = false; s.onGround = true;
          s.ballX = W / 2; s.ballY = s.playerY - 60;
          if (s.sig.totalAttempts > 0 && s.frame - s.lastDunkFrame > 20) {
            // Missed dunk
            s.sig.almostDunks++;
            s.sig.streakCurrent = 0;
            sfx.collision(); hapticFail();
          }
        }
      }

      // Charge animation
      if (s.charging && s.onGround) {
        s.chargeLevel = Math.min(1, (Date.now() - s.chargeStart) / 1200);
      }

      // Draw charge circle
      if (s.charging && s.onGround) {
        ctx.save();
        ctx.strokeStyle = `rgba(249,115,22,${s.chargeLevel*0.8})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(W/2, s.playerY, 30 + s.chargeLevel * 40, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
      }

      // Dunk window indicator
      if (s.dunkWindow) {
        ctx.save();
        ctx.fillStyle = 'rgba(251,191,36,0.6)';
        ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
        ctx.shadowBlur = 10; ctx.shadowColor = '#fbbf24';
        ctx.fillText('🏀 DUNK NOW!', W/2, H*0.85); ctx.restore();
      }

      // Player body (simple stick figure)
      ctx.save();
      ctx.strokeStyle = '#fed7aa'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      const px = W/2 + (s.shakeX *= 0.8);
      const py = s.playerY;
      // Body
      ctx.beginPath(); ctx.moveTo(px, py - 50); ctx.lineTo(px, py - 25); ctx.stroke();
      // Arms raised during jump
      if (s.jumping) {
        ctx.beginPath(); ctx.moveTo(px - 20, py - 40); ctx.lineTo(px, py - 45); ctx.lineTo(px + 20, py - 40); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(px - 20, py - 30); ctx.lineTo(px, py - 35); ctx.lineTo(px + 20, py - 30); ctx.stroke();
      }
      // Legs
      ctx.beginPath(); ctx.moveTo(px, py - 25); ctx.lineTo(px - 12, py); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px, py - 25); ctx.lineTo(px + 12, py); ctx.stroke();
      // Head
      ctx.fillStyle = '#fed7aa';
      ctx.beginPath(); ctx.arc(px, py - 58, 12, 0, Math.PI*2); ctx.fill();
      ctx.restore();

      // Ball
      ctx.save();
      ctx.shadowBlur = 10; ctx.shadowColor = ACCENT;
      const ballGrad = ctx.createRadialGradient(s.ballX-5, s.ballY-5, 2, s.ballX, s.ballY, 16);
      ballGrad.addColorStop(0, '#fb923c'); ballGrad.addColorStop(1, '#c2410c');
      ctx.fillStyle = ballGrad;
      ctx.beginPath(); ctx.arc(s.ballX, s.ballY, 16, 0, Math.PI*2); ctx.fill();
      ctx.restore();

      if (s.scorePop > Date.now()) {
        const t = (s.scorePop - Date.now()) / 400;
        ctx.save(); ctx.globalAlpha = t; ctx.font = `bold ${Math.round(42*(1+(1-t)*0.3))}px sans-serif`;
        ctx.fillStyle = ACCENT; ctx.textAlign = 'center'; ctx.fillText(`${s.sig.score}`, W/2, 90); ctx.restore();
      }
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha; ctx.fillStyle = f.color; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.95;
      });
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      activePointers.add(e.pointerId);
      s.pointerCount = activePointers.size;
      if (activePointers.size >= 2 && s.onGround && !s.charging) {
        // Two-finger charge
        s.charging = true; s.chargeStart = Date.now();
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      activePointers.delete(e.pointerId);
      s.pointerCount = activePointers.size;
      if (s.charging && s.onGround) {
        s.charging = false;
        const jumpForce = -(12 + s.chargeLevel * 10);
        s.playerVY = jumpForce;
        s.jumping = true; s.onGround = false;
        s.sig.totalAttempts++;
        sfx.click(); hapticScore();
      } else if (s.dunkWindow && s.jumping) {
        // Dunk!
        const isPerfect = Math.abs(s.playerVY) < 1;
        s.sig.dunks++;
        if (isPerfect) s.sig.perfectTiming++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
        const pts = (isPerfect ? 3 : 2) * mult;
        s.sig.score += pts;
        s.scorePop = Date.now() + 400;
        setScoreDisplay(s.sig.score);
        sfx.success(); hapticScore();
        s.lastDunkFrame = s.frame;
        s.floats.push({ x: s.hoopX, y: s.hoopY - 30, text: isPerfect ? `+${pts} 🔥 PERFECT!` : `+${pts} DUNK!`, alpha: 1, vy: -2.5, color: '#fbbf24' });
        hapticImpact();
      }
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      activePointers.clear();
    };
  }, [phase]);

  useEffect(() => () => { cancelAnimationFrame(animRef.current); if (timerRef.current) clearInterval(timerRef.current); }, []);
  const handleStart = useCallback(async (name: string, avatar: string) => { playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); await initAudio(); setPhase('countdown'); }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Hold TWO fingers to charge your jump, then tap again to dunk at the peak!" ctaLabel="Dunk! 🏀" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <><canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Slam dunk basketball game canvas" />
        {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}</>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Dunks', value: String(finalSig.dunks), color: ACCENT }, { label: 'Perfect Timing', value: String(finalSig.perfectTiming), color: '#fbbf24' }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' }, { label: 'Attempts', value: String(finalSig.totalAttempts), color: '#06b6d4' }]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.dunks >= 5} />
      )}
    </GameShell>
  );
}
