'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, increaseMusicTempo } from '@/lib/audio';
import { playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { createTiltController } from '@/lib/tilt';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { Particle, spawnBurst, updateAndDrawParticles } from '@/lib/particles';
import { ShakeState, triggerShake, applyShake } from '@/lib/screenShake';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY_ACCENT = CATEGORY_THEMES.sports.primaryAccent;

const ACCENT = '#a16207';
const GAME_ID = 'spiral-throw';
const PB_KEY       = 'pb_spiral-throw';
const DURATION = 60;

type Route = 'curl' | 'out' | 'post' | 'go';
interface FloatText { x: number; y: number; text: string; color: string; alpha: number; vy: number; }
interface Signals {
  attempts: number; completions: number; interceptions: number; score: number;
  leadPasses: number; deepThrows: number; fastDecisions: number;
  catchStreak: number; streakMax: number;
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const total = sig.attempts || 1;
  const compRate = sig.completions / total;
  const leadRate = sig.leadPasses / total;
  const depthRate = sig.deepThrows / total;
  if (compRate > 0.7 && leadRate > 0.65) return '🧠 Field General';
  if (depthRate > 0.5) return '🔫 Gunslinger';
  if (depthRate <= 0.3 && compRate > 0.75) return '📋 Checkdown Artist';
  return '🏈 QB';
}

const ROUTES: Route[] = ['curl', 'out', 'post', 'go'];

function generateRoute(route: Route, startX: number, startY: number, fieldH: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  switch (route) {
    case 'go':
      for (let i = 0; i <= 8; i++) pts.push({ x: startX, y: startY - fieldH * 0.7 * i / 8 });
      break;
    case 'curl':
      for (let i = 0; i <= 5; i++) pts.push({ x: startX, y: startY - fieldH * 0.25 * i / 5 });
      // curl back
      for (let i = 1; i <= 3; i++) pts.push({ x: startX + 30*i, y: startY - fieldH * 0.25 });
      break;
    case 'out':
      for (let i = 0; i <= 5; i++) pts.push({ x: startX, y: startY - fieldH * 0.2 * i / 5 });
      for (let i = 1; i <= 4; i++) pts.push({ x: startX - 40*i, y: startY - fieldH * 0.2 });
      break;
    case 'post':
      for (let i = 0; i <= 5; i++) pts.push({ x: startX, y: startY - fieldH * 0.3 * i / 5 });
      for (let i = 1; i <= 4; i++) pts.push({ x: startX + 30*i, y: startY - fieldH * 0.3 - 25*i });
      break;
  }
  return pts;
}

export default function SpiralThrow() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tiltRef = useRef<ReturnType<typeof createTiltController> | null>(null);
  const [phase, setPhase] = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streakDisplay, setStreakDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [playerName, setPlayerName]   = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const { pops, triggerPop } = useScorePop();
  const [streak, setStreak] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const prevScoreRef = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const numScore = typeof scoreDisplay === 'number' ? scoreDisplay : 0;
    if (numScore > prevScoreRef.current) {
      triggerPop(`+${numScore - prevScoreRef.current}`, window.innerWidth / 2, 200);
      hapticScore();
      playScoreHit('default', numScore - prevScoreRef.current);
      setStreak(Math.floor(numScore / 5));
    }
    prevScoreRef.current = numScore;
  }, [scoreDisplay]); // triggerPop is stable
  const playerSessionRef              = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    // Ball
    ballX: 0, ballY: 0, ballVX: 0, ballVY: 0, ballInFlight: false, ballAngle: 0,
    ballRadius: 12,
    // Receiver
    recX: 0, recY: 0, recRoute: [] as { x:number;y:number }[], recRouteIdx: 0,
    recSnapped: false, recCaught: false, recTrail: [] as { x:number;y:number }[],
    // State
    gamePhase: 'pre-snap' as 'pre-snap' | 'running' | 'ball-in-flight' | 'result',
    currentRoute: 'go' as Route, snapTime: 0, throwTime: 0,
    // Swipe
    swipeStartX: 0, swipeStartY: 0, swipeStartTime: 0, isSwiping: false,
    // Float texts
    floats: [] as FloatText[],
    sig: { attempts:0, completions:0, interceptions:0, score:0,
           leadPasses:0, deepThrows:0, fastDecisions:0, catchStreak:0, streakMax:0 } as Signals,
    stars: [] as { x:number;y:number;alpha:number;vy:number }[],
    particles: [] as Particle[],
    shake: { intensity: 0, duration: 0 } as ShakeState,
  });

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    tiltRef.current?.stop();
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const finalSigSnap = { ...s.sig };
    setFinalSig(finalSigSnap);
    setPhase('done');
    postWebhook(theme, GAME_ID, {
      score: `${finalSigSnap.score} pts`,
      personality: getPersonality(finalSigSnap),
      signals: { completions: finalSigSnap.completions, attempts: finalSigSnap.attempts, streakMax: finalSigSnap.streakMax },
    }, playerSessionRef.current);
  }, [theme]);

  const setupNewPlay = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;
    s.recX = W / 2 + (Math.random() - 0.5) * W * 0.2;
    s.recY = H * 0.65;
    s.currentRoute = ROUTES[Math.floor(Math.random() * ROUTES.length)];
    s.recRoute = generateRoute(s.currentRoute, s.recX, s.recY, H * 0.8);
    s.recRouteIdx = 0;
    s.recSnapped = false; s.recCaught = false;
    s.ballX = W / 2; s.ballY = H * 0.82;
    s.ballInFlight = false; s.ballAngle = 0;
    s.gamePhase = 'pre-snap'; s.recTrail = [];
    s.isSwiping = false;
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { attempts:0, completions:0, interceptions:0, score:0,
               leadPasses:0, deepThrows:0, fastDecisions:0, catchStreak:0, streakMax:0 };
    s.floats = []; s.stars = [];
    s.particles = []; s.shake = { intensity: 0, duration: 0 };
    setupNewPlay();
    setPhase('playing'); setTimeLeft(DURATION); setScoreDisplay(0); setStreakDisplay(0);
    stopMusicRef.current = startMusic('drive');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft === 15) increaseMusicTempo(120); // ramp for final stretch
      if (s.timeLeft <= 5 && s.timeLeft > 0) sfx.tick(); // urgency cue
      if (s.timeLeft <= 0) { sfx.success(); haptic([30, 50, 100]); endGame(); } // timer end = completed session
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      ctx.save();
      applyShake(ctx, s.shake);
      // Football field — rich dark grass
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0d1f0a'); bg.addColorStop(1, '#050f05');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Yard lines
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        const y = H * i / 8;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      // Sidelines
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(W*0.05, 0); ctx.lineTo(W*0.05, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W*0.95, 0); ctx.lineTo(W*0.95, H); ctx.stroke();

      // Route preview (dotted)
      if (s.gamePhase === 'pre-snap' && s.recRoute.length > 0) {
        ctx.save(); ctx.strokeStyle = 'rgba(255,220,0,0.4)'; ctx.lineWidth = 2;
        ctx.setLineDash([6,4]);
        ctx.beginPath(); ctx.moveTo(s.recRoute[0].x, s.recRoute[0].y);
        s.recRoute.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Receiver trail
      s.recTrail.push({ x: s.recX, y: s.recY });
      if (s.recTrail.length > 6) s.recTrail.shift();
      s.recTrail.forEach((p, i) => {
        ctx.save(); ctx.globalAlpha = (i / 6) * 0.4;
        ctx.fillStyle = '#fbbf24'; ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI*2); ctx.fill(); ctx.restore();
      });

      // Receiver
      ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = '#fbbf24';
      ctx.fillStyle = '#fbbf24'; ctx.beginPath();
      ctx.arc(s.recX, s.recY, 10, 0, Math.PI*2); ctx.fill(); ctx.restore();

      // Receiver movement along route
      if (s.recSnapped && !s.recCaught && s.recRouteIdx < s.recRoute.length - 1) {
        const target = s.recRoute[Math.min(s.recRouteIdx + 1, s.recRoute.length - 1)];
        const dx = target.x - s.recX, dy = target.y - s.recY;
        const d = Math.sqrt(dx*dx+dy*dy);
        if (d < 4) { s.recRouteIdx++; }
        else { const spd = 3.5; s.recX += dx/d*spd; s.recY += dy/d*spd; }
      }

      // Ball flight
      if (s.ballInFlight) {
        s.ballAngle += 0.15;
        s.ballX += s.ballVX; s.ballY += s.ballVY;
        // Check catch
        const dx = s.ballX - s.recX, dy = s.ballY - s.recY;
        const dist = Math.sqrt(dx*dx+dy*dy);
        if (dist < 28) {
          // Determine lead/lag
          const isLead = s.recRouteIdx < s.recRoute.length - 2;
          s.sig.attempts++;
          if (isLead) s.sig.leadPasses++;
          // deepThrows tracked at throw time (handleTouchEnd) — not here
          const decisionTime = Date.now() - s.snapTime;
          if (decisionTime < 2500) s.sig.fastDecisions++;

          s.sig.completions++;
          s.sig.score += 7;
          s.sig.catchStreak++;
          if (s.sig.catchStreak > s.sig.streakMax) s.sig.streakMax = s.sig.catchStreak;
          setScoreDisplay(s.sig.score);
          setStreakDisplay(s.sig.catchStreak);
          // Streak≥3 celebration: delay sfx.success so it doesn't stack with sfx.collect
          if (s.sig.catchStreak >= 3) setTimeout(() => sfx.success(), 100);
          sfx.collect(); haptic([60,30,60]);
          s.floats.push({ x: s.recX, y: s.recY - 20, text:'+7', color:'#fbbf24', alpha:1, vy:-2 });
          spawnBurst(s.particles, s.recX, s.recY, '#fbbf24', 22, 7);
          // Stars
          for (let i = 0; i < 8; i++) {
            s.stars.push({ x: s.recX + (Math.random()-0.5)*40, y: s.recY + (Math.random()-0.5)*40,
                           alpha: 1, vy: -2 - Math.random()*2 });
          }
          s.recCaught = true; s.ballInFlight = false;
          setTimeout(() => setupNewPlay(), 1200);
        }
        // Incomplete — all four screen edges (fixed P1: was missing bottom edge)
        if (s.ballY < -50 || s.ballX < -50 || s.ballX > window.innerWidth + 50 || s.ballY > window.innerHeight + 50) {
          // Interception if ball goes backward (below receiver position = behind the play)
          const isInterception = s.ballY > s.recY + 30;
          s.sig.attempts++;
          s.sig.catchStreak = 0;
          setStreakDisplay(0);
          if (isInterception) {
            s.sig.interceptions++;
            s.sig.score -= 3;
            setScoreDisplay(s.sig.score); // update HUD after score drop (fixed P2)
            sfx.fail(); haptic([300]);
            triggerShake(s.shake, 7, 10);
            spawnBurst(s.particles, s.ballX > 0 && s.ballX < window.innerWidth ? s.ballX : W/2,
                       s.ballY > 0 && s.ballY < window.innerHeight ? s.ballY : H/2, '#ef4444', 14, 5);
            s.floats.push({ x: s.ballX, y: s.ballY, text:'-3', color:'#ef4444', alpha:1, vy:-1.5 });
          } else {
            sfx.collision();
            triggerShake(s.shake, 4, 6);
          }
          s.ballInFlight = false;
          setTimeout(() => setupNewPlay(), 900);
        }
      }

      // Draw ball (football oval)
      if (!s.recCaught || s.ballInFlight) {
        ctx.save(); ctx.translate(s.ballX, s.ballY); ctx.rotate(s.ballAngle);
        ctx.fillStyle = '#8b4513'; ctx.beginPath();
        ctx.ellipse(0, 0, s.ballRadius, s.ballRadius * 0.55, 0, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-s.ballRadius*0.6, 0); ctx.lineTo(s.ballRadius*0.6, 0); ctx.stroke();
        ctx.restore();
      }

      // Swipe aim indicator
      if (s.isSwiping && !s.ballInFlight) {
        ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2; ctx.setLineDash([6,4]);
        ctx.beginPath(); ctx.moveTo(s.ballX, s.ballY);
        ctx.lineTo(s.ballX + (s.ballX - s.swipeStartX)*0.5, s.ballY + (s.ballY - s.swipeStartY)*0.5);
        ctx.stroke(); ctx.setLineDash([]); ctx.restore();
      }

      // Stars
      s.stars = s.stars.filter(st => st.alpha > 0.05);
      s.stars.forEach(st => {
        ctx.save(); ctx.globalAlpha = st.alpha; ctx.fillStyle = '#fbbf24';
        ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('★', st.x, st.y);
        ctx.restore(); st.y += st.vy; st.alpha *= 0.93;
      });

      // Float texts
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha; ctx.fillStyle = f.color;
        ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(f.text, f.x, f.y);
        ctx.restore(); f.y += f.vy; f.alpha *= 0.97;
      });

      // Snap prompt
      if (s.gamePhase === 'pre-snap') {
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center'; ctx.fillText('TAP to snap, then SWIPE to throw', W/2, H*0.9);
      }

      // Particles layer (outside shake transform for visual stability)
      ctx.restore();
      updateAndDrawParticles(ctx, s.particles);
      // HUD drawn by DOM overlay GameHUD component

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, setupNewPlay]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const s = stateRef.current;
    if (!s.running) return;
    e.preventDefault();
    const t = e.touches[0];
    s.swipeStartX = t.clientX; s.swipeStartY = t.clientY; s.swipeStartTime = Date.now();
    s.isSwiping = true;
    if (s.gamePhase === 'pre-snap') {
      s.gamePhase = 'running';
      s.recSnapped = true;
      s.snapTime = Date.now();
      sfx.click();
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const s = stateRef.current;
    if (!s.running || !s.isSwiping || s.ballInFlight) { s.isSwiping = false; return; }
    if (s.gamePhase !== 'running') { s.isSwiping = false; return; }
    s.isSwiping = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.swipeStartX;
    const dy = t.clientY - s.swipeStartY;
    const dist = Math.sqrt(dx*dx+dy*dy);
    if (dist < 15) return;
    const tiltY = tiltRef.current?.getValues().y ?? 0;
    const power = 8 + Math.abs(tiltY) * 4;
    s.ballVX = (dx / dist) * power;
    s.ballVY = (dy / dist) * power;
    s.ballInFlight = true;
    s.gamePhase = 'ball-in-flight';
    s.throwTime = Date.now();
    // deepThrows: measure at throw time using upfield velocity (negative VY = thrown toward top = downfield)
    if (s.ballVY < -6) s.sig.deepThrows++;
    sfx.click();
  }, []);

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
    const onForceEnd = () => { if (stateRef.current.running) endGame(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('game:force-end', onForceEnd);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('game:force-end', onForceEnd);
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      tiltRef.current?.stop();
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, [endGame]);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); sfx.click();
    const ctrl = createTiltController(() => {}, { sensitivity: 1.0, smoothing: 0.45, deadzone: 3 });
    tiltRef.current = ctrl;
    await ctrl.start();
    setPhase('countdown');
  }, []);

  const handlePlayAgain = useCallback(() => {
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    stateRef.current.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    tiltRef.current?.stop();
    setStreakDisplay(0);
    setPhase('start');
  
    setIsNewBest(false);
    setStreak(0);
    prevScoreRef.current = 0;
  }, []);

  const sig = finalSig;
  const compRate = sig ? Math.round(sig.completions / Math.max(1, sig.attempts) * 100) : 0;

  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="spiral-throw"
          steps={[{ icon: "👆", title: "Swipe to throw", body: "Swipe up to launch the football in a spiral." }, { icon: "🏈", title: "Hit the target", body: "Aim for the moving receiver downfield." }, { icon: "🔥", title: "Build combos", body: "Consecutive completions multiply your score." }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title="Spiral Throw" emoji="🏈" accentColor={ACCENT} theme={theme}>
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
            { label: 'STREAK 🏈', value: streakDisplay },
          ]}
          accentColor={ACCENT}
        />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={ACCENT} />}
      {phase === 'start' && (
        <GameStartScreen
          emoji="🏈"
          title="Spiral Throw"
          description="Tap to snap. Swipe to throw. Lead your receiver — anticipate where they'll be."
          sensorNote="Touch + motion"
          ctaLabel="Start Game →"
          accentColor={ACCENT}
          ctaTextColor="#000"
          onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #1a0e00 0%, #0e0700 55%, #060400 100%)"
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
          emoji="🏈"
          score={`${sig.score} pts`}
          personality={getPersonality(sig)}
          insights={[
            { label: 'Completions', value: `${sig.completions}/${sig.attempts}`, color: ACCENT },
            { label: 'Completion %', value: `${compRate}%`, color: '#4ade80' },
            { label: 'Lead Passes', value: `${sig.leadPasses}`, color: '#fbbf24' },
            { label: 'Best Streak', value: `${sig.streakMax}`, color: '#c084fc' },
          ]}
          accentColor={ACCENT}
          onPlayAgain={handlePlayAgain}
          didWin={sig.completions > 5}
        />
      )}
      {phase === 'playing' && (
        <>
          <ScorePopEffect pops={pops} accentColor={CATEGORY_ACCENT} />
          <StreakBadge streak={streakDisplay} accentColor={CATEGORY_ACCENT} />
        </>
      )}
    </GameShell>
    </>
  );
}
