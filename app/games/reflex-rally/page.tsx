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
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { Particle, spawnBurst, updateAndDrawParticles } from '@/lib/particles';
import { ShakeState, triggerShake, applyShake } from '@/lib/screenShake';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY_ACCENT = CATEGORY_THEMES.sports.primaryAccent;

// ─── SPRITE CACHE ─────────────────────────────────────────────────────────────
const _spriteCache = new Map<string, HTMLImageElement>();
function _loadSprite(src: string): HTMLImageElement {
  if (_spriteCache.has(src)) return _spriteCache.get(src)!;
  const img = new Image();
  img.src = src;
  _spriteCache.set(src, img);
  return img;
}
if (typeof window !== 'undefined') {
  _loadSprite('/sprites/reflex-rally/ball.svg');
  _loadSprite('/sprites/reflex-rally/paddle.svg');
}

const ACCENT = '#84cc16';
const GAME_ID = 'reflex-rally';
const PB_KEY       = 'pb_reflex-rally';
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
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [lives, setLives] = useState(MAX_LIVES);
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
    // Player Y (lerped)
    playerY: 0,
    particles: [] as Particle[],
    shake: { intensity: 0, duration: 0 } as ShakeState,
  });

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const finalSigSnap = { ...s.sig };
    setFinalSig(finalSigSnap);
    setPhase('done');
    postWebhook(theme, GAME_ID, {
      score: `${finalSigSnap.score} pts`,
      personality: getPersonality(finalSigSnap),
      signals: { returns: finalSigSnap.returns, misses: finalSigSnap.misses, streakMax: finalSigSnap.streakMax },
    }, playerSessionRef.current);
  }, [theme]);

  const spawnBall = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const H = window.innerHeight;
    const mid = (s.courtTop + s.courtBottom) / 2;
    const range = (s.courtBottom - s.courtTop) * 0.35;
    s.ballX = window.innerWidth + s.ballRadius;
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
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = DURATION; s.lives = MAX_LIVES;
    s.sig = { returns:0, misses:0, forehands:0, backhands:0, reactionTimes:[], score:0, streakMax:0, streakCurrent:0 };
    s.floats = []; s.swooshes = [];
    s.particles = []; s.shake = { intensity: 0, duration: 0 };
    setScoreDisplay(0); setStreakDisplay(0);
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
      if (s.timeLeft <= 5 && s.timeLeft > 0) sfx.tick(); // urgency cue
      if (s.timeLeft <= 0) { sfx.success(); haptic([30, 50, 100]); endGame(); } // timer end = survived 60s = success
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      ctx.save();
      applyShake(ctx, s.shake);
      // Init playerY on first frame
    if (!s.playerY) s.playerY = (s.courtTop + s.courtBottom) / 2;
    // Clay court — rich terracotta atmosphere
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.4, 0, W * 0.5, H * 0.7, Math.max(W, H) * 0.9);
      bg.addColorStop(0,   '#241008');
      bg.addColorStop(0.5, '#160a04');
      bg.addColorStop(1,   '#080402');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Vignette
      const rrVig = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.2, W * 0.5, H * 0.5, H * 0.85);
      rrVig.addColorStop(0, 'rgba(0,0,0,0)');
      rrVig.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = rrVig;
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

      // Player silhouette (left side) — tracks ball Y with lerp
      const px = W * 0.1;
      const targetPy = s.ballActive ? Math.max(ct + 40, Math.min(cb - 40, s.ballY)) : (ct + cb) / 2;
      if (!s.playerY) s.playerY = (ct + cb) / 2;
      s.playerY += (targetPy - s.playerY) * 0.1;
      const py = s.playerY;
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

        // Ball sprite
        ctx.save(); ctx.shadowBlur = 14; ctx.shadowColor = '#fde047';
        const _rrBall = _loadSprite('/sprites/reflex-rally/ball.svg');
        if (_rrBall.complete && _rrBall.naturalWidth > 0) {
          ctx.drawImage(_rrBall, s.ballX - s.ballRadius, s.ballY - s.ballRadius, s.ballRadius * 2, s.ballRadius * 2);
        } else {
          ctx.fillStyle = '#fde047'; ctx.beginPath();
          ctx.arc(s.ballX, s.ballY, s.ballRadius, 0, Math.PI*2); ctx.fill();
        }
        ctx.restore();

        // Miss — ball passed player zone
        if (s.ballX < W * 0.06) {
          s.lives--;
          s.sig.misses++;
          s.sig.streakCurrent = 0;
          setLives(s.lives);
          setStreakDisplay(0);
          sfx.collision(); hapticFail();
          triggerShake(s.shake, 7, 10);
          spawnBurst(s.particles, W*0.1, s.ballY, '#ef4444', 12, 5);
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

      // Particles layer (outside shake transform)
      ctx.restore();
      updateAndDrawParticles(ctx, s.particles);
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
    setStreakDisplay(s.sig.streakCurrent);

    sfx.collect(); haptic([40]);
    spawnBurst(s.particles, s.ballX, s.ballY, ACCENT, 14, 5);
    // Fast return (<300ms) = great reflex — celebrate with success sound (not nearMiss which is semantically wrong)
    if (reactionTime < 300) setTimeout(() => sfx.success(), 80);
    // Streak milestone: sfx.go() delayed so it follows the return sound
    if (s.sig.streakCurrent >= 3) setTimeout(() => sfx.go(), 120);
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
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, [endGame]);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); sfx.click();
    setPhase('countdown');
  }, []);

  const handlePlayAgain = useCallback(() => {
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    stateRef.current.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    setStreakDisplay(0);
    setPhase('start');
  
    setIsNewBest(false);
    setStreak(0);
    prevScoreRef.current = 0;
  }, []);

  const sig = finalSig;
  const avgRT = sig?.reactionTimes && sig.reactionTimes.length > 0
    ? Math.round(sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length) : 0;

  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="reflex-rally"
          steps={[{ icon: "👆", title: "Tap to return", body: "Tap when the ball reaches your side." }, { icon: "⚡", title: "Time it right", body: "Tap too early or too late and you miss." }, { icon: "🔥", title: "Speed up", body: "Each rally gets faster — how long can you keep it going?" }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title="Reflex Rally" emoji="🎾" accentColor={ACCENT} theme={theme}>
      <canvas
        ref={canvasRef}
        style={{ display: phase === 'playing' ? 'block' : 'none', position: 'absolute', top: 0, left: 0, touchAction: 'none' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      />
      {phase === 'playing' && (
        <GameHUD
          items={[
            { label: 'SCORE', value: scoreDisplay },
            { label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 10 },
            { label: 'LIVES', value: '❤️'.repeat(lives) },
            { label: 'STREAK 🎾', value: streakDisplay },
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
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #1a0505 0%, #0e0303 55%, #060101 100%)"
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
