'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, increaseMusicTempo } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';

const ACCENT = '#84cc16';
const GAME_ID = 'reflex-rally';
const DURATION = 60;
const MAX_LIVES = 5;

interface FloatText { x: number; y: number; text: string; color: string; alpha: number; vy: number; }
interface Signals {
  returns: number; misses: number; forehands: number; backhands: number;
  reactionTimes: number[]; score: number; streakMax: number; streakCurrent: number;
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const avgRT = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length : 999;
  const early = sig.reactionTimes.slice(0, Math.floor(sig.reactionTimes.length/2));
  const late = sig.reactionTimes.slice(Math.floor(sig.reactionTimes.length/2));
  const earlyAvg = early.length > 0 ? early.reduce((a,b)=>a+b,0)/early.length : 999;
  const lateAvg = late.length > 0 ? late.reduce((a,b)=>a+b,0)/late.length : 999;
  const dropoff = Math.abs(earlyAvg - lateAvg) / earlyAvg;
  if (dropoff < 0.1 && avgRT < 400) return '🤖 Machine';
  if (lateAvg < earlyAvg) return '⚡ Clutch Player';
  return '🎾 Consistent';
}

export default function ReflexRally() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [lives, setLives] = useState(MAX_LIVES);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION, lives: MAX_LIVES,
    // Ball
    ballX: 0, ballY: 0, ballVX: -5, ballVY: 0, ballActive: false,
    ballRadius: 14, ballInZone: false, ballZoneEnterTime: 0,
    // Player zone
    playerZoneX: 0,
    // Swipe
    swipeStartX: 0, swipeStartY: 0, swipeStartTime: 0, isSwiping: false,
    // Swoosh
    swooshes: [] as { x: number; y: number; dx: number; alpha: number }[],
    // Speed
    baseSpeed: 5, speed: 5, speedTier: 0,
    // Net
    netX: 0,
    // Float texts
    floats: [] as FloatText[],
    // Court height
    courtTop: 0, courtBottom: 0,
    // Signals
    sig: { returns:0, misses:0, forehands:0, backhands:0, reactionTimes:[], score:0, streakMax:0, streakCurrent:0 } as Signals,
    // Narrow at 30s
    courtNarrow: false,
  });

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const spawnBall = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const H = canvas.height;
    const mid = (s.courtTop + s.courtBottom) / 2;
    const range = (s.courtBottom - s.courtTop) * 0.35;
    s.ballX = canvas.width + s.ballRadius;
    s.ballY = mid + (Math.random() - 0.5) * range * 2;
    s.ballVX = -(s.speed + Math.random() * 2);
    s.ballVY = (Math.random() - 0.5) * 2;
    s.ballActive = true;
    s.ballInZone = false;
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;

    s.running = true; s.timeLeft = DURATION; s.lives = MAX_LIVES;
    s.sig = { returns:0, misses:0, forehands:0, backhands:0, reactionTimes:[], score:0, streakMax:0, streakCurrent:0 };
    s.floats = []; s.swooshes = [];
    setScoreDisplay(0);
    s.speed = s.baseSpeed = 5; s.speedTier = 0;
    s.netX = W / 2;
    s.playerZoneX = W * 0.3;
    s.courtTop = H * 0.2; s.courtBottom = H * 0.8;
    s.courtNarrow = false;
    setPhase('playing'); setTimeLeft(DURATION); setLives(MAX_LIVES);
    stopMusicRef.current = startMusic('drive');
    spawnBall();

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      // Speed up every 10s
      const elapsed = DURATION - s.timeLeft;
      const newTier = Math.floor(elapsed / 10);
      if (newTier > s.speedTier) {
        s.speedTier = newTier;
        s.speed = s.baseSpeed + newTier * 1.5;
        increaseMusicTempo(128 + newTier * 8);
      }
      // Narrow court at 30s
      if (elapsed >= 30 && !s.courtNarrow) {
        s.courtNarrow = true;
        s.courtTop = H * 0.28; s.courtBottom = H * 0.72;
      }
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      // Clay court — terracotta atmosphere
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#200e06'); bg.addColorStop(1, '#0d0603');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const ct = s.courtTop, cb = s.courtBottom;

      // Court outline
      ctx.strokeStyle = 'rgba(255,200,150,0.3)'; ctx.lineWidth = 2;
      ctx.strokeRect(W*0.05, ct, W*0.9, cb - ct);

      // Net
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(s.netX, ct); ctx.lineTo(s.netX, cb); ctx.stroke();
      for (let ny = ct; ny <= cb; ny += 12) {
        ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(s.netX - 4, ny); ctx.lineTo(s.netX + 4, ny); ctx.stroke();
      }

      // Player zone indicator
      ctx.strokeStyle = 'rgba(132,204,22,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(s.playerZoneX, ct); ctx.lineTo(s.playerZoneX, cb); ctx.stroke();
      ctx.setLineDash([]);

      // Player silhouette (left side)
      const px = W * 0.1, py = (ct + cb) / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(px, py - 28, 12, 0, Math.PI*2); ctx.fill();
      ctx.fillRect(px - 8, py - 16, 16, 32);
      ctx.fillRect(px - 20, py - 10, 12, 5);
      ctx.fillRect(px + 8, py - 10, 12, 5);
      ctx.fillRect(px - 10, py + 16, 8, 20);
      ctx.fillRect(px + 2, py + 16, 8, 20);

      // Ball
      if (s.ballActive) {
        s.ballX += s.ballVX;
        s.ballY += s.ballVY;

        // Bounce off top/bottom court
        if (s.ballY - s.ballRadius < ct) { s.ballY = ct + s.ballRadius; s.ballVY = Math.abs(s.ballVY); sfx.click(); }
        if (s.ballY + s.ballRadius > cb) { s.ballY = cb - s.ballRadius; s.ballVY = -Math.abs(s.ballVY); sfx.click(); }

        // Check if entering player zone
        if (s.ballX < s.playerZoneX && !s.ballInZone && s.ballVX < 0) {
          s.ballInZone = true;
          s.ballZoneEnterTime = Date.now();
        }

        // Speed lines
        if (Math.abs(s.ballVX) > 7) {
          for (let i = 1; i <= 3; i++) {
            ctx.save(); ctx.globalAlpha = 0.15 * (1 - i*0.2);
            ctx.fillStyle = '#fde047'; ctx.beginPath();
            ctx.arc(s.ballX + i * 12, s.ballY + (Math.random()-0.5)*4, s.ballRadius * 0.5, 0, Math.PI*2); ctx.fill();
            ctx.restore();
          }
        }

        // Ball (neon yellow)
        ctx.save(); ctx.shadowBlur = 14; ctx.shadowColor = '#fde047';
        ctx.fillStyle = '#fde047'; ctx.beginPath();
        ctx.arc(s.ballX, s.ballY, s.ballRadius, 0, Math.PI*2); ctx.fill(); ctx.restore();

        // Miss — ball passed player zone
        if (s.ballX < W * 0.06) {
          s.lives--;
          s.sig.misses++;
          s.sig.streakCurrent = 0;
          setLives(s.lives);
          sfx.collision(); haptic([300]);
          s.floats.push({ x: W*0.15, y: (ct+cb)/2, text:'MISS!', color:'#ef4444', alpha:1, vy:-1.5 });
          s.ballActive = false;
          if (s.lives <= 0) { sfx.fail(); haptic([500]); endGame(); return; }
          setTimeout(() => spawnBall(), 800);
        }
      }

      // Swooshes
      s.swooshes = s.swooshes.filter(sw => sw.alpha > 0.05);
      s.swooshes.forEach(sw => {
        ctx.save(); ctx.globalAlpha = sw.alpha;
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(sw.x, sw.y, 20, 0, Math.PI * 0.7 * Math.sign(sw.dx)); ctx.stroke();
        ctx.restore(); sw.alpha *= 0.88;
      });

      // Float texts
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha; ctx.fillStyle = f.color;
        ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(f.text, f.x, f.y);
        ctx.restore(); f.y += f.vy; f.alpha *= 0.96;
      });

      // Lives (tennis balls top-left)
      for (let i = 0; i < MAX_LIVES; i++) {
        ctx.save();
        ctx.globalAlpha = i < s.lives ? 1.0 : 0.2;
        ctx.fillStyle = '#fde047';
        ctx.beginPath(); ctx.arc(20 + i * 28, H - 30, 10, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#85a502'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(20 + i * 28, H - 30, 10, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
      }

      // HUD drawn by DOM overlay GameHUD component

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnBall]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const s = stateRef.current;
    if (!s.running) return;
    e.preventDefault();
    const t = e.touches[0];
    s.swipeStartX = t.clientX; s.swipeStartY = t.clientY; s.swipeStartTime = Date.now();
    s.isSwiping = true;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const s = stateRef.current;
    if (!s.running || !s.isSwiping) return;
    s.isSwiping = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.swipeStartX;

    // Must be in player zone or past it
    if (!s.ballActive || s.ballX > s.playerZoneX * 1.5) return;
    if (Math.abs(dx) < 20) return;

    const reactionTime = Date.now() - s.ballZoneEnterTime;
    s.sig.reactionTimes.push(reactionTime);

    // Forehand = swipe left, backhand = swipe right
    if (dx < 0) s.sig.forehands++; else s.sig.backhands++;

    // Return the ball
    s.ballVX = Math.abs(s.ballVX) * 1.1;
    s.ballVY += (Math.random() - 0.5) * 2;
    s.ballX = s.playerZoneX;
    s.ballInZone = false;
    s.sig.returns++;
    s.sig.score += 10;
    s.sig.streakCurrent++;
    if (s.sig.streakCurrent > s.sig.streakMax) s.sig.streakMax = s.sig.streakCurrent;
    setScoreDisplay(s.sig.score);

    sfx.collect(); haptic([40]);
    if (reactionTime < 300) sfx.nearMiss();
    s.floats.push({ x: s.ballX, y: s.ballY - 20, text:'+10', color: ACCENT, alpha:1, vy:-2 });
    s.swooshes.push({ x: s.ballX, y: s.ballY, dx, alpha: 1 });

    // Ball will come back after hitting right wall
    setTimeout(() => {
      if (!s.running) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      s.ballVX = -Math.abs(s.ballVX) * (1 + Math.random() * 0.3);
    }, 800);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const onResize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    const onForceEnd = () => { if (stateRef.current.running) endGame(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('game:force-end', onForceEnd);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('game:force-end', onForceEnd);
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, [endGame]);

  const handleStart = useCallback(async () => {
    await initAudio(); sfx.click();
    setPhase('countdown');
  }, []);

  const handlePlayAgain = useCallback(() => {
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    stateRef.current.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase('start');
  }, []);

  const sig = finalSig;
  const avgRT = sig?.reactionTimes && sig.reactionTimes.length > 0
    ? Math.round(sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length) : 0;

  return (
    <GameShell title="Reflex Rally" emoji="🎾" accentColor={ACCENT} theme={theme}>
      <canvas
        ref={canvasRef}
        style={{ display: phase === 'playing' ? 'block' : 'none', position: 'absolute', top: 0, left: 0 }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      />
      {phase === 'playing' && (
        <GameHUD
          items={[
            { label: 'SCORE', value: scoreDisplay },
            { label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 10 },
            { label: 'LIVES', value: '❤️'.repeat(lives) },
          ]}
          accentColor={ACCENT}
        />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={ACCENT} />}
      {phase === 'start' && (
        <GameStartScreen
          emoji="🎾"
          title="Reflex Rally"
          description="Swipe left or right when the ball enters your zone. Return every shot. 5 lives."
          sensorNote="Touch only"
          ctaLabel="Start Game →"
          accentColor={ACCENT}
          onStart={handleStart}
        />
      )}
      {phase === 'done' && sig && (
        <EndScreen
          gameId={GAME_ID}
          title={getPersonality(sig)}
          emoji="🎾"
          score={`${sig.score} pts`}
          personality={getPersonality(sig)}
          insights={[
            { label: 'Returns', value: `${sig.returns}`, color: ACCENT },
            { label: 'Avg Reaction', value: avgRT > 0 ? `${avgRT}ms` : 'N/A', color: '#fbbf24' },
            { label: 'Forehand/Back', value: `${sig.forehands}/${sig.backhands}`, color: '#c084fc' },
            { label: 'Best Streak', value: `${sig.streakMax}`, color: '#60a5fa' },
          ]}
          accentColor={ACCENT}
          onPlayAgain={handlePlayAgain}
          didWin={sig.returns > 15}
        />
      )}
    </GameShell>
  );
}
