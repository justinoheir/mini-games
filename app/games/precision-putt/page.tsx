'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { createTiltController } from '@/lib/tilt';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY_ACCENT = CATEGORY_THEMES.sports.primaryAccent;

const ACCENT = '#86efac';
const GAME_ID = 'precision-putt';
const PB_KEY       = 'pb_precision-putt';
const MAX_HOLES = 8;

interface FloatText { x: number; y: number; text: string; color: string; alpha: number; vy: number; }
interface Signals {
  holes: number; totalStrokes: number; holesInOne: number; pars: number; bogeys: number;
  sweetSpotHits: number; avgReadTime: number; readTimes: number[]; powerHistory: number[];
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const powerAcc = sig.sweetSpotHits / Math.max(1, sig.totalStrokes);
  const avgRead = sig.avgReadTime;
  if (powerAcc > 0.7 && avgRead > 2) return '🔬 Surgeon';
  if (powerAcc > 0.6 && avgRead < 1.5) return '🎯 Feel Player';
  if (avgRead > 3 && powerAcc < 0.5) return '🤔 Overthinks It';
  return '🏌️ Steady Putter';
}

interface HoleConfig { x: number; y: number; par: number; windAngle: number; windSpeed: number; }

function generateHole(W: number, H: number, index: number): HoleConfig {
  const margin = 80;
  const cx = W / 2 + (Math.random() - 0.5) * W * 0.5;
  const cy = margin + Math.random() * (H * 0.45);
  return {
    x: Math.max(margin, Math.min(W - margin, cx)),
    y: Math.max(margin, Math.min(H * 0.5, cy)),
    par: index < 2 ? 1 : (index < 5 ? 2 : 3),
    windAngle: Math.random() * Math.PI * 2,
    windSpeed: Math.random() * 2,
  };
}

export default function PrecisionPutt() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tiltRef = useRef<ReturnType<typeof createTiltController> | null>(null);
  const endGameRef = useRef<(() => void) | null>(null); // stable ref for canvas effect
  const touchStartXRef = useRef(0);
  const chargeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef(false);
  const [phase, setPhase] = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft] = useState(60);
  const [holeDisplay, setHoleDisplay] = useState(1);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [playerName, setPlayerName]   = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const { pops, triggerPop } = useScorePop();
  const [streak, setStreak] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const prevScoreRef = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const numScore = typeof holeDisplay === 'number' ? holeDisplay : 0;
    if (numScore > prevScoreRef.current) {
      triggerPop(`+${numScore - prevScoreRef.current}`, window.innerWidth / 2, 200);
      hapticScore();
      playScoreHit('default', numScore - prevScoreRef.current);
      setStreak(Math.floor(numScore / 5));
    }
    prevScoreRef.current = numScore;
  }, [holeDisplay]);
  const playerSessionRef              = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: 60,
    // Ball
    ballX: 0, ballY: 0, ballVX: 0, ballVY: 0, ballMoving: false, ballRadius: 10,
    // Aim
    aimAngle: -Math.PI/2, // up by default
    // Power
    charging: false, power: 0, powerStart: 0,
    // Hole
    hole: null as HoleConfig | null, holeRadius: 16,
    holeIndex: 0, strokeCount: 0,
    // Physics
    friction: 0.985,
    // Confetti
    confetti: [] as { x:number;y:number;vx:number;vy:number;color:string;alpha:number }[],
    // Float texts
    floats: [] as FloatText[],
    // Read time
    tiltStableTime: 0, aimReadStart: 0,
    // Signals
    sig: { holes:0, totalStrokes:0, holesInOne:0, pars:0, bogeys:0,
           sweetSpotHits:0, avgReadTime:0, readTimes:[], powerHistory:[] } as Signals,
    phase: 'aiming' as 'aiming' | 'putting' | 'result',
    strokesThisHole: 0,
    holeComplete: false,
    // Audio throttle — prevents sfx.tick() from firing 60x/sec during charging
    lastTickTime: 0,
  });

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    tiltRef.current?.stop();
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    // Finalize: accumulate any strokes on the in-progress hole (timer expiry mid-hole)
    // Without this, strokes played on an incomplete hole are lost from the total count
    if (!s.holeComplete && s.strokesThisHole > 0) {
      s.sig.totalStrokes += s.strokesThisHole;
    }
    // Final avg read time
    if (s.sig.readTimes.length > 0) {
      s.sig.avgReadTime = s.sig.readTimes.reduce((a,b)=>a+b,0) / s.sig.readTimes.length;
    }
    const finalSigSnap = { ...s.sig };
    setFinalSig(finalSigSnap);
    setPhase('done');
    postWebhook(theme, GAME_ID, {
      score: `${finalSigSnap.totalStrokes} strokes`,
      personality: getPersonality(finalSigSnap),
      signals: { holes: finalSigSnap.holes, holesInOne: finalSigSnap.holesInOne, sweetSpotHits: finalSigSnap.sweetSpotHits },
    }, playerSessionRef.current);
  }, [theme]);

  const setupHole = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;
    s.hole = generateHole(W, H, s.holeIndex);
    s.ballX = W / 2; s.ballY = H * 0.82;
    s.ballVX = 0; s.ballVY = 0; s.ballMoving = false;
    s.aimAngle = -Math.PI / 2;
    s.charging = false; s.power = 0;
    s.phase = 'aiming'; s.strokesThisHole = 0; s.holeComplete = false;
    s.aimReadStart = Date.now();
    s.tiltStableTime = Date.now();
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = 60; s.holeIndex = 0;
    s.sig = { holes:0, totalStrokes:0, holesInOne:0, pars:0, bogeys:0,
               sweetSpotHits:0, avgReadTime:0, readTimes:[], powerHistory:[] };
    setHoleDisplay(1);
    s.floats = []; s.confetti = [];
    setupHole();
    setPhase('playing'); setTimeLeft(60);
    stopMusicRef.current = startMusic('minimal');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 5 && s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      // Golf fairway — rich dark green
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0c1e10'); bg.addColorStop(1, '#060f08');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Grass contour circles
      for (let i = 0; i < 6; i++) {
        const cx2 = W * 0.2 + W * 0.6 * (i / 5);
        const cy2 = H * 0.3 + H * 0.4 * Math.sin(i * 1.2);
        ctx.save(); ctx.globalAlpha = 0.04;
        ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 30;
        ctx.beginPath(); ctx.arc(cx2, cy2, 60 + i*20, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
      }

      // Tilt controls aim
      const tilt = tiltRef.current?.getValues() ?? { x: 0, y: 0 };
      if (s.phase === 'aiming' && !s.ballMoving) {
        const prevAngle = s.aimAngle;
        s.aimAngle += tilt.x * 0.06;
        if (Math.abs(s.aimAngle - prevAngle) < 0.005) {
          // stable
        } else {
          s.tiltStableTime = Date.now();
        }
      }

      // Hole
      if (s.hole) {
        const hx = s.hole.x, hy = s.hole.y, hr = s.holeRadius;
        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI*2); ctx.fill();
        // Flag
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx, hy - hr*2.5); ctx.stroke();
        ctx.fillStyle = '#ef4444';
        ctx.beginPath(); ctx.moveTo(hx, hy - hr*2.5); ctx.lineTo(hx + 18, hy - hr*1.8); ctx.lineTo(hx, hy - hr*1.2); ctx.fill();
        // Wind arrow (top-right)
        const windR = W - 50;
        const windT = H - 100;
        ctx.save(); ctx.translate(windR, windT); ctx.rotate(s.hole.windAngle);
        const windLen = 10 + s.hole.windSpeed * 8;
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-windLen/2, 0); ctx.lineTo(windLen/2, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(windLen/2, 0); ctx.lineTo(windLen/2 - 6, -5); ctx.lineTo(windLen/2 - 6, 5); ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '11px sans-serif';
        ctx.textAlign = 'right'; ctx.fillText('WIND', windR + 18, windT + 22);
      }

      // Aim line (dotted) — only when aiming
      if (s.phase === 'aiming' && !s.ballMoving) {
        const aimLen = 120;
        const ex = s.ballX + Math.cos(s.aimAngle) * aimLen;
        const ey = s.ballY + Math.sin(s.aimAngle) * aimLen;
        ctx.save(); ctx.strokeStyle = 'rgba(134,239,172,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([8,6]);
        ctx.beginPath(); ctx.moveTo(s.ballX, s.ballY); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
      }

      // Ball physics
      if (s.ballMoving) {
        // Wind effect
        if (s.hole) {
          s.ballVX += Math.cos(s.hole.windAngle) * s.hole.windSpeed * 0.003;
          s.ballVY += Math.sin(s.hole.windAngle) * s.hole.windSpeed * 0.003;
        }
        s.ballVX *= s.friction; s.ballVY *= s.friction;
        s.ballX += s.ballVX; s.ballY += s.ballVY;
        const speed = Math.sqrt(s.ballVX*s.ballVX + s.ballVY*s.ballVY);
        if (speed < 0.15) { s.ballMoving = false; s.ballVX = 0; s.ballVY = 0; }

        // Bounce off walls
        if (s.ballX < s.ballRadius) { s.ballX = s.ballRadius; s.ballVX = Math.abs(s.ballVX)*0.6; }
        if (s.ballX > window.innerWidth - s.ballRadius) { s.ballX = window.innerWidth - s.ballRadius; s.ballVX = -Math.abs(s.ballVX)*0.6; }
        if (s.ballY < s.ballRadius) { s.ballY = s.ballRadius; s.ballVY = Math.abs(s.ballVY)*0.6; }
        if (s.ballY > window.innerHeight - s.ballRadius) { s.ballY = window.innerHeight - s.ballRadius; s.ballVY = -Math.abs(s.ballVY)*0.6; }

        // Check hole
        if (s.hole && !s.holeComplete) {
          const dx = s.ballX - s.hole.x, dy = s.ballY - s.hole.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < s.holeRadius * 0.9) {
            s.holeComplete = true; s.ballMoving = false;
            s.sig.holes++;
            s.sig.totalStrokes += s.strokesThisHole;
            const par = s.hole.par;
            const strokes = s.strokesThisHole;
            if (strokes === 1) {
              s.sig.holesInOne++; sfx.success(); haptic([60,30,60,30,60]);
              s.floats.push({ x: s.hole.x, y: s.hole.y - 30, text:'HOLE IN ONE! 🎊', color:'#fbbf24', alpha:1, vy:-2 });
              // Confetti
              for (let ci = 0; ci < 30; ci++) {
                s.confetti.push({ x: s.hole.x, y: s.hole.y, vx:(Math.random()-0.5)*5, vy:-2-Math.random()*4,
                  color: ['#fbbf24','#4ade80','#60a5fa','#f472b6'][Math.floor(Math.random()*4)], alpha:1 });
              }
            } else if (strokes <= par) {
              s.sig.pars++; sfx.collect(); haptic([60,30,60]);
              s.floats.push({ x: s.hole.x, y: s.hole.y - 30, text:'In the hole! ⛳', color: ACCENT, alpha:1, vy:-1.5 });
            } else {
              s.sig.bogeys++; sfx.nearMiss();
              s.floats.push({ x: s.hole.x, y: s.hole.y - 30, text:`+${strokes - par} Bogey`, color:'#f97316', alpha:1, vy:-1.5 });
            }
            s.holeIndex++;
            setHoleDisplay(s.holeIndex + 1);
            if (s.holeIndex >= MAX_HOLES) {
              // Round complete — celebratory sound (only fires once, from a setTimeout so
              // it doesn't interfere with the per-hole result sound above)
              setTimeout(() => { sfx.success(); haptic([60,30,60,30,60,30,100]); }, 300);
              setTimeout(() => endGame(), 1500);
            } else {
              setTimeout(() => setupHole(), 1500);
            }
          }
        }
      }

      // Draw ball
      ctx.save();
      const ballGrad = ctx.createRadialGradient(s.ballX - 3, s.ballY - 3, 1, s.ballX, s.ballY, s.ballRadius);
      ballGrad.addColorStop(0, '#fff'); ballGrad.addColorStop(1, '#ddd');
      ctx.fillStyle = ballGrad;
      ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(134,239,172,0.5)';
      ctx.beginPath(); ctx.arc(s.ballX, s.ballY, s.ballRadius, 0, Math.PI*2); ctx.fill();
      ctx.restore();

      // Power bar (charging)
      if (s.charging) {
        // ⚠️ Throttle: sfx.tick() creates a new Tone.js node each call.
        // At 60fps without throttling = 60 nodes/sec → audio distortion + memory leak.
        const nowMs = Date.now();
        if (nowMs - s.lastTickTime >= 200) {
          s.lastTickTime = nowMs;
          sfx.tick();
        }
        const pFill = s.power / 100;
        const barW = 180, barH = 16;
        const barX = (W - barW) / 2, barY = H - 60;
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(barX, barY, barW, barH);
        const barColor = pFill < 0.4 ? '#4ade80' : pFill < 0.7 ? '#fbbf24' : '#ef4444';
        ctx.fillStyle = barColor; ctx.fillRect(barX, barY, barW * pFill, barH);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(barX, barY, barW, barH);
        // Sweet spot zone
        ctx.strokeStyle = 'rgba(134,239,172,0.5)'; ctx.lineWidth = 2;
        ctx.strokeRect(barX + barW*0.4, barY - 2, barW*0.3, barH+4);
        s.power = Math.min(100, s.power + 1.2);
      }

      // Confetti
      s.confetti = s.confetti.filter(c => c.alpha > 0.05);
      s.confetti.forEach(c => {
        ctx.save(); ctx.globalAlpha = c.alpha;
        ctx.fillStyle = c.color; ctx.fillRect(c.x - 4, c.y - 4, 8, 8);
        ctx.restore(); c.x += c.vx; c.y += c.vy; c.vy += 0.12; c.alpha *= 0.96;
      });

      // Float texts
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha; ctx.fillStyle = f.color;
        ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(f.text, f.x, f.y);
        ctx.restore(); f.y += f.vy; f.alpha *= 0.97;
      });

      // HUD drawn by DOM overlay GameHUD component

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, setupHole]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const s = stateRef.current;
    if (!s.running || s.phase !== 'aiming' || s.ballMoving || s.holeComplete) return;
    e.preventDefault();
    touchStartXRef.current = e.touches[0].clientX;
    isDraggingRef.current = false;
    // Delay charge start by 120ms — gives time to detect a drag vs. a hold.
    // If the touch moves > 8px horizontally, handleTouchMove cancels this timer.
    chargeTimerRef.current = setTimeout(() => {
      if (!isDraggingRef.current && s.running && !s.ballMoving && !s.holeComplete) {
        s.charging = true;
        s.power = 0;
        s.powerStart = Date.now();
        s.lastTickTime = 0;
        // Record read time only when charging actually starts (not on drag-aim gestures).
        // Measuring from setupHole/last-putt to charge-start accurately captures decision time.
        const readTime = (Date.now() - s.aimReadStart) / 1000;
        s.sig.readTimes.push(readTime);
      }
    }, 120);
  }, []);

  // ── Drag-to-aim fallback (works as primary control when tilt is denied) ──────
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const s = stateRef.current;
    if (!s.running) return;
    const dx = e.touches[0].clientX - touchStartXRef.current;
    if (!s.charging && Math.abs(dx) > 8) {
      isDraggingRef.current = true;
      if (chargeTimerRef.current) { clearTimeout(chargeTimerRef.current); chargeTimerRef.current = null; }
      // 0.009 rad/px — gentle rotation; continuous delta (update start each move)
      s.aimAngle += dx * 0.009;
      touchStartXRef.current = e.touches[0].clientX;
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const s = stateRef.current;
    if (chargeTimerRef.current) { clearTimeout(chargeTimerRef.current); chargeTimerRef.current = null; }
    isDraggingRef.current = false;
    if (!s.running || !s.charging) return;
    s.charging = false;
    const pwr = s.power;
    // Sweet spot 40-70
    if (pwr >= 40 && pwr <= 70) s.sig.sweetSpotHits++;
    s.sig.powerHistory.push(pwr);
    // Putt!
    const speed = pwr * 0.085;
    s.ballVX = Math.cos(s.aimAngle) * speed;
    s.ballVY = Math.sin(s.aimAngle) * speed;
    s.ballMoving = true;
    s.strokesThisHole++;
    // Note: s.sig.totalStrokes is accumulated per-hole in the hole-completion check
    s.aimReadStart = Date.now();
    sfx.click(); haptic([40]);
  }, []);

  // Keep endGameRef always pointing to the latest endGame (breaks the [endGame] dep cycle)
  useEffect(() => { endGameRef.current = endGame; }, [endGame]);

  // ⚠️ Canvas effect MUST use [] deps — [endGame] would re-run cleanup (cancelAnimationFrame,
  // clearInterval, tilt.stop) every time theme changes, stopping the game unexpectedly.
  // Use endGameRef.current inside to always call the latest endGame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = window.innerWidth  * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width  = window.innerWidth  + 'px';
    canvas.style.height = window.innerHeight + 'px';
    const ctx2 = canvas.getContext('2d');
    if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    const onResize = () => {
      const d = window.devicePixelRatio || 1;
      canvas.width  = window.innerWidth  * d;
      canvas.height = window.innerHeight * d;
      canvas.style.width  = window.innerWidth  + 'px';
      canvas.style.height = window.innerHeight + 'px';
      const c2 = canvas.getContext('2d');
      if (c2) c2.setTransform(d, 0, 0, d, 0, 0);
    };
    const onForceEnd = () => { if (stateRef.current.running) endGameRef.current?.(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('game:force-end', onForceEnd);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('game:force-end', onForceEnd);
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (chargeTimerRef.current) clearTimeout(chargeTimerRef.current);
      tiltRef.current?.stop();
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); sfx.click();
    const ctrl = createTiltController((x) => {
      stateRef.current.aimAngle += x * 0.05;
    }, { sensitivity: 1.0, smoothing: 0.5, deadzone: 2 });
    tiltRef.current = ctrl;
    await ctrl.start();
    setPhase('countdown');
  }, []);

  const handlePlayAgain = useCallback(() => {
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (chargeTimerRef.current) { clearTimeout(chargeTimerRef.current); chargeTimerRef.current = null; }
    stateRef.current.running = false;
    stateRef.current.charging = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    tiltRef.current?.stop();
    setPhase('start');
  
    setIsNewBest(false);
    setStreak(0);
    prevScoreRef.current = 0;
  }, []);

  const sig = finalSig;
  const parTotal = sig ? sig.pars + sig.holesInOne : 0;

  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="precision-putt"
          steps={[{ icon: "👆", title: "Swipe to putt", body: "Swipe to aim and set the power of your putt." }, { icon: "⛳", title: "Read the green", body: "Adjust for distance and angle to the hole." }, { icon: "🏆", title: "Fewer strokes", body: "Get the ball in with as few shots as possible." }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title="Precision Putt" emoji="🏌️" accentColor={ACCENT} theme={theme}>
      <canvas
        ref={canvasRef}
        style={{ display: phase === 'playing' ? 'block' : 'none', position: 'absolute', top: 0, left: 0, touchAction: 'none' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
      {phase === 'playing' && (
        <GameHUD
          items={[
            { label: 'HOLE', value: `${Math.min(holeDisplay, MAX_HOLES)}/${MAX_HOLES}` },
            { label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 10 },
          ]}
          accentColor={ACCENT}
        />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={ACCENT} />}
      {phase === 'start' && (
        <GameStartScreen
          emoji="🏌️"
          title="Precision Putt"
          description="Tilt to aim. Tap & hold to charge power. Hit the sweet spot (40–70%). 8 holes."
          sensorNote="Uses motion sensors"
          ctaLabel="Start Putting →"
          accentColor={ACCENT}
          onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #001a0a 0%, #000e05 55%, #000603 100%)"
        />
      )}
      {/* New best banner */}
      <AnimatePresence>
        {isNewBest && (
          <motion.div
            key="new-best"
            initial={{ opacity: 0, y: -20, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, delay: 0.5 }}
            style={{
              position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)',
              zIndex: 90, pointerEvents: 'none',
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
              borderRadius: 20, padding: '8px 20px', fontSize: 20,
              fontWeight: 900, color: '#000', whiteSpace: 'nowrap',
              boxShadow: '0 4px 20px rgba(251,191,36,0.5)',
            }}
          >
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>

      {phase === 'done' && sig && (
        <EndScreen
          gameId={GAME_ID}
          title={getPersonality(sig)}
          emoji="🏌️"
          score={`${sig.totalStrokes} strokes`}
          personality={getPersonality(sig)}
          insights={[
            { label: 'Holes Completed', value: `${sig.holes}/${MAX_HOLES}`, color: ACCENT },
            { label: 'Hole-in-Ones', value: `${sig.holesInOne}`, color: '#fbbf24' },
            { label: 'Sweet Spot Hits', value: `${sig.sweetSpotHits}`, color: '#4ade80' },
            { label: 'Avg Read Time', value: `${sig.avgReadTime > 0 ? sig.avgReadTime.toFixed(1)+'s' : 'N/A'}`, color: '#c084fc' },
          ]}
          accentColor={ACCENT}
          onPlayAgain={handlePlayAgain}
          didWin={sig.holesInOne > 0}
        />
      )}
      {phase === 'playing' && (
        <>
          <ScorePopEffect pops={pops} accentColor={CATEGORY_ACCENT} />
          <StreakBadge streak={streak} accentColor={CATEGORY_ACCENT} />
        </>
      )}
    </GameShell>
    </>
  );
}
