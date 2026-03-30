'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, startMusic, increaseMusicTempo } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticImpact } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { Particle, spawnBurst, updateAndDrawParticles } from '@/lib/particles';
import { ShakeState, triggerShake, applyShake } from '@/lib/screenShake';
import SwipeInstructions from '@/components/SwipeInstructions';

const ACCENT = '#f97316';
const GAME_ID = 'hoop-shot';
const DURATION = 45;
const DURATION_MS = 45000; // kept for reference; timer uses DURATION (seconds)

// Stadium energy crowd comments shown on streak milestones
const CROWD_LINES = [
  '🏟️ CROWD GOES WILD!',
  '🔥 ON FIRE!',
  '🏆 UNSTOPPABLE!',
  '⚡ ELECTRIC!',
  '👑 LEGENDARY!',
];

interface FloatText { x: number; y: number; text: string; color: string; alpha: number; vy: number; scale: number; }
interface Signals {
  totalShots: number; makes: number; misses: number;
  threePointAttempts: number; threePointMakes: number;
  streakCurrent: number; streakMax: number;
  earlyMakes: number; earlyAttempts: number;
  lateMakes: number; lateAttempts: number;
  powerSum: number; score: number;
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const totalAttempts = sig.totalShots || 1;
  const lateAcc = sig.lateAttempts > 0 ? sig.lateMakes / sig.lateAttempts : 0;
  const threePtRate = sig.threePointAttempts / totalAttempts;
  if (lateAcc > 0.6 && sig.streakMax > 3) return '🏆 Clutch';
  if (threePtRate > 0.5) return '🎯 Gunner';
  if (sig.streakMax > 4 && lateAcc < 0.4) return '🔥 Streaky';
  return '⛹️ Steady';
}

export default function HoopShot() {
  const theme = useBrandTheme();
  // Keep a ref so the rAF loop always sees the latest theme without stale closure
  const themeRef = useRef(theme);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Cached gradient refs (recreated only on canvas resize) ──────────────
  const bgGradRef   = useRef<CanvasGradient | null>(null);
  const vigGradRef  = useRef<CanvasGradient | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const gradDimsRef  = useRef<{ W: number; H: number } | null>(null);
  // ────────────────────────────────────────────────────────────────────────

  const [phase, setPhase] = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streakDisplay, setStreakDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [playerName, setPlayerName]   = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const playerSessionRef              = useRef<PlayerSession | null>(null);

  // Sync themeRef whenever theme changes
  useEffect(() => { themeRef.current = theme; }, [theme]);

  const stateRef = useRef({
    running: false,
    timeLeft: DURATION,
    score: 0,
    prevBest: 0,
    milestoneFired50: false,
    // Ball state
    ballX: 0, ballY: 0, ballVX: 0, ballVY: 0,
    ballInFlight: false, ballVisible: true,
    ballRadius: 20,
    // Hoop
    hoopX: 0, hoopY: 0, hoopRadius: 28,
    // 3pt line
    threePtY: 0,
    // Swipe
    swipeStartX: 0, swipeStartY: 0, swipeStartTime: 0, isSwiping: false,
    // Net animation
    netSwish: 0,
    // Float texts
    floats: [] as FloatText[],
    // Signals
    sig: {
      totalShots: 0, makes: 0, misses: 0,
      threePointAttempts: 0, threePointMakes: 0,
      streakCurrent: 0, streakMax: 0,
      earlyMakes: 0, earlyAttempts: 0,
      lateMakes: 0, lateAttempts: 0,
      powerSum: 0,
    } as Signals,
    gravity: 0.45,
    respawnTimer: 0,
    rimFlash: 0,
    hoopScored: false,
    particles: [] as Particle[],
    shake: { intensity: 0, duration: 0 } as ShakeState,
    nearMissX: 0, nearMissY: 0, nearMissTimer: 0,
  });

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const finalScore = s.sig.score;
    const finalSigSnap = { ...s.sig };
    setFinalSig(finalSigSnap);
    const isNewBestVal = finalScore > s.prevBest;
    if (isNewBestVal) {
      localStorage.setItem(`pb_${GAME_ID}`, String(finalScore));
      hapticVictory();
    } else {
      hapticVictory();
    }
    setIsNewBest(isNewBestVal);
    setPhase('done');
    postWebhook(theme, GAME_ID, {
      score: `${finalScore} pts`,
      personality: getPersonality(finalSigSnap),
      signals: { makes: finalSigSnap.makes, totalShots: finalSigSnap.totalShots, streakMax: finalSigSnap.streakMax },
    }, playerSessionRef.current);
  }, [theme]);

  const resetBall = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    s.ballX = window.innerWidth / 2;
    s.ballY = window.innerHeight - 80;
    s.ballVX = 0; s.ballVY = 0;
    s.ballInFlight = false;
    s.ballVisible = true;
    s.hoopScored = false;
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true;
    s.timeLeft = DURATION;
    s.score = 0;
    s.prevBest = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    s.milestoneFired50 = false;
    s.sig = { totalShots:0, makes:0, misses:0, threePointAttempts:0, threePointMakes:0,
               streakCurrent:0, streakMax:0, earlyMakes:0, earlyAttempts:0,
               lateMakes:0, lateAttempts:0, powerSum:0, score:0 };
    s.floats = [];
    s.netSwish = 0;
    s.particles = [];
    s.shake = { intensity: 0, duration: 0 };
    s.nearMissTimer = 0;
    setScoreDisplay(0);
    setStreakDisplay(0);
    s.rimFlash = 0;
    s.hoopX = W / 2;
    s.hoopY = H * 0.22;
    s.threePtY = H * 0.55;
    s.ballRadius = Math.min(W, H) * 0.04;
    s.hoopRadius = s.ballRadius * 1.45;
    resetBall();
    s.ballY = H - 80;

    setPhase('playing');
    setTimeLeft(DURATION);
    stopMusicRef.current = startMusic('drive');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft === 15) increaseMusicTempo(120);
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 5 && s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) { sfx.success(); endGame(); }
    }, 1000);

    // Helper: (re)build cached gradients and offscreen grain canvas
    const rebuildCachedAssets = (cW: number, cH: number) => {
      const bg = ctx.createRadialGradient(cW * 0.5, cH * 0.4, 0, cW * 0.5, cH * 0.6, Math.max(cW, cH) * 0.9);
      bg.addColorStop(0,   '#1c1204');
      bg.addColorStop(0.5, '#120c02');
      bg.addColorStop(1,   '#080500');
      bgGradRef.current = bg;

      const vig = ctx.createRadialGradient(cW * 0.5, cH * 0.5, cH * 0.2, cW * 0.5, cH * 0.5, cH * 0.85);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.45)');
      vigGradRef.current = vig;

      // Pre-render hardwood grain to an offscreen canvas
      const off = document.createElement('canvas');
      off.width  = cW;
      off.height = cH;
      const octx = off.getContext('2d');
      if (octx) {
        octx.strokeStyle = 'rgba(200,130,40,0.04)';
        octx.lineWidth = 1;
        for (let gy = 56; gy < cH; gy += 14) {
          octx.beginPath(); octx.moveTo(0, gy); octx.lineTo(cW, gy); octx.stroke();
        }
      }
      offscreenRef.current = off;
      gradDimsRef.current = { W: cW, H: cH };
    };

    // Build once immediately at game start
    rebuildCachedAssets(W, H);

    const loop = () => {
      if (!s.running) return;
      const cW = window.innerWidth, cH = window.innerHeight;

      // Rebuild cached assets only when canvas dimensions change
      if (!gradDimsRef.current || gradDimsRef.current.W !== cW || gradDimsRef.current.H !== cH) {
        rebuildCachedAssets(cW, cH);
      }

      const accentColor = themeRef.current.colors?.accent ?? ACCENT;

      ctx.save();
      applyShake(ctx, s.shake);

      // Basketball court background — use cached gradient
      ctx.fillStyle = bgGradRef.current!;
      ctx.fillRect(0, 0, cW, cH);

      // Vignette — use cached gradient
      ctx.fillStyle = vigGradRef.current!;
      ctx.fillRect(0, 0, cW, cH);

      // Hardwood grain — use pre-rendered offscreen canvas
      if (offscreenRef.current) ctx.drawImage(offscreenRef.current, 0, 0);

      // Court lines
      ctx.strokeStyle = 'rgba(255,140,60,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, cH/2); ctx.lineTo(cW, cH/2); ctx.stroke();

      // 3pt arc
      ctx.save();
      ctx.strokeStyle = 'rgba(255,140,60,0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.arc(cW/2, cH, cW*0.42, Math.PI*1.15, Math.PI*1.85);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Backboard
      const bw = s.hoopRadius * 2.5;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(s.hoopX - bw/2, s.hoopY - s.hoopRadius*1.8, bw, s.hoopRadius*0.6);

      // Rim
      const rimColor = s.rimFlash > Date.now() ? '#ff4444' : accentColor;
      ctx.save();
      ctx.strokeStyle = rimColor;
      ctx.lineWidth = 4;
      ctx.shadowBlur = 8; ctx.shadowColor = rimColor;
      ctx.beginPath();
      ctx.arc(s.hoopX, s.hoopY, s.hoopRadius, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();

      // Net
      const netLines = 8;
      const netBottom = s.hoopY + s.hoopRadius * 2.0;
      ctx.strokeStyle = 'rgba(220,220,220,0.6)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= netLines; i++) {
        const nx = s.hoopX - s.hoopRadius + (2*s.hoopRadius/netLines)*i;
        const swishOffset = s.netSwish > 0 ? Math.sin(Date.now()/80 + i) * 4 : 0;
        ctx.beginPath();
        ctx.moveTo(nx, s.hoopY + s.hoopRadius * 0.3);
        ctx.lineTo(s.hoopX + swishOffset, netBottom);
        ctx.stroke();
      }
      for (let j = 1; j <= 3; j++) {
        const ny = s.hoopY + s.hoopRadius * 0.3 + (netBottom - s.hoopY - s.hoopRadius*0.3) * (j/4);
        const hw = s.hoopRadius * (1 - j*0.15);
        const swishOffset2 = s.netSwish > 0 ? Math.sin(Date.now()/80 + j*2) * 3 : 0;
        ctx.beginPath();
        ctx.moveTo(s.hoopX - hw + swishOffset2, ny);
        ctx.lineTo(s.hoopX + hw + swishOffset2, ny);
        ctx.stroke();
      }
      if (s.netSwish > 0) s.netSwish--;

      // Ball physics
      if (s.ballInFlight) {
        s.ballVY += s.gravity;
        s.ballX += s.ballVX;
        s.ballY += s.ballVY;

        const dx = s.ballX - s.hoopX;
        const dy = s.ballY - s.hoopY;
        const dist = Math.sqrt(dx*dx + dy*dy);

        if (dist < s.hoopRadius + s.ballRadius && !s.hoopScored) {
          if (s.ballVY > 0 && Math.abs(dx) < s.hoopRadius * 0.7) {
            // SCORED!
            s.hoopScored = true;
            const isThree = s.swipeStartY > s.threePtY;
            const pts = isThree ? 3 : 2;
            s.score += pts;
            s.sig.makes++;
            s.sig.score = s.score;
            s.sig.streakCurrent++;
            setScoreDisplay(s.score);
            if (s.sig.streakCurrent > s.sig.streakMax) s.sig.streakMax = s.sig.streakCurrent;
            if (isThree) { s.sig.threePointMakes++; sfx.success(); }
            else { sfx.collect(); }
            const t = DURATION - s.timeLeft;
            if (t < 40) s.sig.earlyMakes++;
            else s.sig.lateMakes++;
            if (s.sig.streakCurrent >= 3) { setTimeout(() => sfx.go(), 100); }
            s.netSwish = 20;
            setStreakDisplay(s.sig.streakCurrent);
            hapticScore();

            s.floats.push({ x: s.hoopX, y: s.hoopY - 30, text: `+${pts}`, color: isThree ? '#fbbf24' : '#4ade80', alpha: 1, vy: -2.5, scale: isThree ? 1.4 : 1.0 });

            // Stadium energy at streak milestones
            if (s.sig.streakCurrent === 3) {
              s.floats.push({ x: cW/2, y: cH*0.45, text: '🔥 STREAK!', color: accentColor, alpha: 1, vy: -1.2, scale: 1.1 });
            } else if (s.sig.streakCurrent >= 5 && s.sig.streakCurrent % 3 === 2) {
              const line = CROWD_LINES[Math.min(Math.floor(s.sig.streakCurrent / 3) - 1, CROWD_LINES.length - 1)];
              s.floats.push({ x: cW/2, y: cH*0.4, text: line, color: '#fbbf24', alpha: 1, vy: -1.0, scale: 1.2 });
            }

            // PB mid-game milestone
            if (!s.milestoneFired50 && s.score > s.prevBest && s.prevBest > 0) {
              s.milestoneFired50 = true;
              s.floats.push({ x: cW/2, y: cH*0.35, text: '🏆 NEW BEST!', color: '#fbbf24', alpha: 1, vy: -0.8, scale: 1.3 });
              setTimeout(() => sfx.success(), 150);
            }

            spawnBurst(s.particles, s.hoopX, s.hoopY, isThree ? '#fbbf24' : '#4ade80', isThree ? 30 : 20, 6);
            setTimeout(() => resetBall(), 1200);
            s.ballInFlight = false;
            s.ballVisible = false;
          } else if (dist < s.hoopRadius + s.ballRadius * 0.5) {
            // Rim bounce
            const angle = Math.atan2(dy, dx);
            s.ballVX = Math.cos(angle) * Math.abs(s.ballVX + s.ballVY) * 0.5;
            s.ballVY = -Math.abs(s.ballVY) * 0.6;
            sfx.collision();
            hapticImpact();
            s.rimFlash = Date.now() + 200;
            if (Math.abs(dx) < s.hoopRadius * 0.4) {
              s.nearMissX = s.hoopX;
              s.nearMissY = s.hoopY - 50;
              s.nearMissTimer = 60;
            }
          }
        }

        if (s.ballY > cH + 60 || s.ballX < -60 || s.ballX > cW + 60) {
          if (!s.hoopScored) {
            s.sig.misses++;
            s.sig.streakCurrent = 0;
            setStreakDisplay(0);
            sfx.nearMiss();
            hapticFail();
            triggerShake(s.shake, 3, 5);
            spawnBurst(s.particles, s.ballX, s.ballY, '#ef4444', 10, 4);
          }
          setTimeout(() => resetBall(), 800);
          s.ballInFlight = false;
          s.ballVisible = false;
        }
        if (s.ballY < -60) {
          s.ballVY = Math.abs(s.ballVY) * 0.8;
        }
      }

      // Draw ball — ball gradient is position-dependent so recreated per frame (small cost)
      if (s.ballVisible) {
        const br = s.ballRadius;
        ctx.save();
        ctx.shadowBlur = 12; ctx.shadowColor = accentColor;
        const ballGrad = ctx.createRadialGradient(s.ballX - br*0.3, s.ballY - br*0.3, br*0.1, s.ballX, s.ballY, br);
        ballGrad.addColorStop(0, accentColor); ballGrad.addColorStop(1, '#c2410c');
        ctx.fillStyle = ballGrad;
        ctx.beginPath(); ctx.arc(s.ballX, s.ballY, br, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(s.ballX, s.ballY, br, 0, Math.PI*2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s.ballX - br, s.ballY); ctx.lineTo(s.ballX + br, s.ballY); ctx.stroke();
        ctx.beginPath(); ctx.arc(s.ballX, s.ballY, br * 0.6, 0.2, Math.PI - 0.2); ctx.stroke();
        ctx.beginPath(); ctx.arc(s.ballX, s.ballY, br * 0.6, Math.PI + 0.2, Math.PI*2 - 0.2); ctx.stroke();
        ctx.restore();
      }

      // Swipe aim line
      if (s.isSwiping && !s.ballInFlight) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(s.ballX, s.ballY);
        ctx.lineTo(s.ballX + (s.ballX - s.swipeStartX)*0.5, s.ballY + (s.ballY - s.swipeStartY)*0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Near-miss "So close!" overlay
      if (s.nearMissTimer > 0) {
        const alpha = Math.min(1, s.nearMissTimer / 20) * Math.min(1, (s.nearMissTimer > 40 ? 1 : s.nearMissTimer / 40));
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 28px sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#fbbf24';
        ctx.fillText('So close! 😬', s.nearMissX, s.nearMissY);
        ctx.restore();
        s.nearMissTimer--;
      }

      // Float texts with scale
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save();
        ctx.globalAlpha = f.alpha;
        ctx.fillStyle = f.color;
        const sz = Math.round((f.scale ?? 1) * 36);
        ctx.font = `bold ${sz}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.shadowBlur = 10;
        ctx.shadowColor = f.color;
        ctx.fillText(f.text, f.x, f.y);
        ctx.restore();
        f.y += f.vy; f.alpha *= 0.955;
      });

      ctx.restore();
      updateAndDrawParticles(ctx, s.particles);

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, resetBall]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const s = stateRef.current;
    if (!s.running || s.ballInFlight || !s.ballVisible) return;
    const t = e.touches[0];
    s.swipeStartX = t.clientX;
    s.swipeStartY = t.clientY;
    s.swipeStartTime = Date.now();
    s.isSwiping = true;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const s = stateRef.current;
    if (!s.running || !s.isSwiping || s.ballInFlight) { s.isSwiping = false; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - s.swipeStartX;
    const dy = t.clientY - s.swipeStartY;
    const dt = Math.max(1, Date.now() - s.swipeStartTime);
    const speed = Math.sqrt(dx*dx + dy*dy) / dt;
    s.isSwiping = false;

    if (dy > -20) return;
    const power = Math.min(speed * 18, 22);
    const angle = Math.atan2(dy, dx);
    s.ballVX = Math.cos(angle) * power;
    s.ballVY = Math.sin(angle) * power;
    s.ballInFlight = true;
    s.sig.totalShots++;
    s.sig.powerSum += power;
    if (s.swipeStartY > s.threePtY) s.sig.threePointAttempts++;
    const t2 = DURATION - s.timeLeft;
    if (t2 < 40) s.sig.earlyAttempts++; else s.sig.lateAttempts++;
    sfx.click();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const applySize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = window.innerWidth  * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width  = window.innerWidth  + 'px';
      canvas.style.height = window.innerHeight + 'px';
      const ctx2 = canvas.getContext('2d');
      if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Invalidate gradient cache on resize so it rebuilds next frame
      gradDimsRef.current = null;
    };
    applySize();
    const onForceEnd = () => { if (stateRef.current.running) endGame(); };
    window.addEventListener('resize', applySize);
    window.addEventListener('game:force-end', onForceEnd);
    return () => {
      window.removeEventListener('resize', applySize);
      window.removeEventListener('game:force-end', onForceEnd);
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, [endGame]);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio();
    sfx.click();
    setPhase('countdown');
  }, []);

  const handlePlayAgain = useCallback(() => {
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    stateRef.current.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    setStreakDisplay(0);
    setIsNewBest(false);
    setPhase('start');
  }, []);

  const sig = finalSig;
  const makes = sig?.makes ?? 0;
  const totalShots = sig?.totalShots ?? 1;
  const acc = totalShots > 0 ? Math.round((makes / totalShots) * 100) : 0;
  const accentUI = theme.colors?.accent ?? ACCENT;

  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="hoop-shot"
          steps={[{ icon: "👆", title: "Swipe UP to shoot", body: "Flick your finger upward on the screen to launch the ball." }, { icon: "🏀", title: "Aim for the hoop", body: "Start your swipe from the ball — the angle matters." }, { icon: "⏱️", title: "45 seconds on the clock", body: "Score as many baskets as you can before time runs out." }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title="Hoop Shot" emoji="🏀" accentColor={accentUI} theme={theme}
      background="radial-gradient(ellipse at 50% 120%, #8b5e3c 0%, #6b4423 30%, #4a2d14 60%, #1a0f06 85%, #0a0604 100%), radial-gradient(ellipse at 50% 0%, rgba(255,160,80,0.12) 0%, transparent 60%)">
      <canvas
        ref={canvasRef}
        style={{ display: phase === 'playing' ? 'block' : 'none', position: 'absolute', top: 0, left: 0, touchAction: 'none' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      />
      {phase === 'playing' && (
        <GameHUD
          items={[
            { label: 'SCORE', value: scoreDisplay,                               testId: 'score' },
            { label: 'TIME',  value: `${timeLeft}s`, danger: timeLeft <= 10, testId: 'timer' },
            { label: 'STREAK 🔥', value: streakDisplay },
          ]}
          accentColor={accentUI}
        />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accentUI} />}
      {phase === 'start' && (
        <GameStartScreen
          emoji="🏀"
          title="Hoop Shot"
          description="Swipe UP to shoot. Score as many baskets as you can in 45 seconds."
          sensorNote="Touch only"
          ctaLabel="Start Game →"
          accentColor={accentUI}
          onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #1a0c00 0%, #0e0700 55%, #060400 100%)"
        />
      )}
      {phase === 'done' && sig && (
        <EndScreen
          gameId={GAME_ID}
          title={getPersonality(sig)}
          emoji="🏀"
          score={`${sig.score} pts`}
          personality={getPersonality(sig)}
          insights={[
            { label: 'Made / Attempted', value: `${sig.makes}/${sig.totalShots}`, color: accentUI },
            { label: 'Accuracy', value: `${acc}%`, color: '#4ade80' },
            { label: 'Best Streak', value: `${sig.streakMax}`, color: '#fbbf24' },
            { label: '3PT Shots', value: `${sig.threePointMakes}/${sig.threePointAttempts}`, color: '#c084fc' },
            ...(isNewBest ? [{ label: '🏆 Personal Best', value: 'NEW RECORD!', color: '#fbbf24' }] : []),
          ]}
          accentColor={accentUI}
          onPlayAgain={handlePlayAgain}
          didWin={sig.makes > 0}
        />
      )}
    </GameShell>
    </>
  );
}
