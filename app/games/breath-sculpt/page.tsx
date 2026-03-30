'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { motion, AnimatePresence } from 'framer-motion';

const GAME_ID = 'breath-sculpt';
const ACCENT = '#a78bfa';
const DURATION = 45;
const GAME_EMOJI = '🌬️';
const GAME_TITLE = 'Breath Sculpt';
const GAME_TAGLINE = 'Your breath shapes the swarm. Guide it through the gaps.';
const PB_KEY = 'mg_pb_breath-sculpt';
const PARTICLE_COUNT = 28;
const SCROLL_SPEED_BASE = 1.2;
const SCROLL_SPEED_MAX = 2.4;
const GAP_HEIGHT = 140;

interface Signals {
  score: number;
  gapsCleared: number;
  collisions: number;
  breathVariance: number;
}

function getPersonality(sig: Signals): string {
  if (sig.gapsCleared >= 12 && sig.collisions <= 2) return 'Sculpt Master 🎨';
  if (sig.gapsCleared >= 8) return 'Flow Rider 🌊';
  if (sig.collisions <= 1) return 'Phantom Breath 👻';
  if (sig.gapsCleared >= 5) return 'Shape Shifter 🌀';
  return 'First Breath 🌱';
}

interface SwarmParticle {
  offX: number;  // offset from swarm center
  offY: number;
  vx: number;
  vy: number;
  size: number;
  hue: number;
}

interface Barrier {
  x: number;
  gapY: number;   // center of gap
  passed: boolean;
  hitFlash: number;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function WebhookEmitter({ theme, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>;
  sig: Signals;
  personality: string;
  player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score }, player);
  }, [theme, sig, personality, player]);
  return null;
}

export default function BreathSculpt() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef({
    running: false,
    timeLeft: DURATION,
    score: 0,
    collisions: 0,
    swarmY: 0,
    swarmTargetY: 0,
    swarmParticles: [] as SwarmParticle[],
    barriers: [] as Barrier[],
    nextBarrierIn: 0,
    lives: 3,
    volSamples: [] as number[],
    analyser: null as AnalyserNode | null,
    audioCtx: null as AudioContext | null,
    stream: null as MediaStream | null,
    animId: 0,
    timerIntervalId: null as ReturnType<typeof setInterval> | null,
    lastHitTime: 0,
    screenFlash: 0,
    screenFlashColor: 'rgba(168,139,250,0.2)',
    passedFlash: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [displayScore, setDisplayScore] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const accent = theme.colors.accent ?? ACCENT;

  const getVolume = useCallback((): number => {
    const s = stateRef.current;
    if (!s.analyser) return 0;
    const data = new Uint8Array(s.analyser.frequencyBinCount);
    s.analyser.getByteFrequencyData(data);
    return data.reduce((a, b) => a + b, 0) / data.length / 255;
  }, []);

  const initSwarm = useCallback((cy: number) => {
    const s = stateRef.current;
    s.swarmParticles = Array.from({ length: PARTICLE_COUNT }, () => ({
      offX: (Math.random() - 0.5) * 50,
      offY: (Math.random() - 0.5) * 50,
      vx: 0,
      vy: 0,
      size: 3 + Math.random() * 4,
      hue: 260 + Math.random() * 40,
    }));
    s.swarmY = cy;
    s.swarmTargetY = cy;
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.timerIntervalId) clearInterval(s.timerIntervalId);
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {});
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.success();
    hapticVictory();
    const avg = s.volSamples.length > 0 ? s.volSamples.reduce((a, b) => a + b, 0) / s.volSamples.length : 0;
    const variance = s.volSamples.length > 0
      ? Math.sqrt(s.volSamples.reduce((a, v) => a + (v - avg) ** 2, 0) / s.volSamples.length)
      : 0;
    const sig: Signals = {
      score: s.score,
      gapsCleared: s.score,
      collisions: s.collisions,
      breathVariance: Math.round(variance * 100),
    };
    try {
      const prev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (sig.score > prev) { localStorage.setItem(PB_KEY, String(sig.score)); setIsNewBest(true); }
    } catch { /* ignore */ }
    setFinalSig(sig);
    setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    s.running = true;
    s.timeLeft = DURATION;
    s.score = 0;
    s.collisions = 0;
    s.lives = 3;
    s.volSamples = [];
    s.barriers = [];
    s.nextBarrierIn = 120;
    s.lastHitTime = 0;
    s.screenFlash = 0;
    s.passedFlash = 0;
    setDisplayScore(0);
    setTimeLeft(DURATION);
    setIsNewBest(false);
    setPhase('playing');
    stopMusicRef.current = startMusic('calm');

    const W = window.innerWidth;
    const H = window.innerHeight;
    initSwarm(H / 2);

    s.timerIntervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      setDisplayScore(s.score);
      sfx.tick();
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W2 = window.innerWidth;
      const H2 = window.innerHeight;
      const vol = getVolume();
      s.volSamples.push(vol);
      const now = Date.now();
      const progress = (DURATION - s.timeLeft) / DURATION;
      const scrollSpeed = SCROLL_SPEED_BASE + (SCROLL_SPEED_MAX - SCROLL_SPEED_BASE) * progress;

      // Swarm target Y: high vol = rise, low vol = fall
      const targetY = H2 * 0.5 - (vol - 0.3) * H2 * 0.7;
      s.swarmTargetY = Math.max(80, Math.min(H2 - 60, targetY));
      s.swarmY += (s.swarmTargetY - s.swarmY) * 0.1;

      // Update swarm particles
      for (const p of s.swarmParticles) {
        const fx = -p.offX * 0.04 + (Math.random() - 0.5) * 0.8;
        const fy = -p.offY * 0.04 + (Math.random() - 0.5) * 0.8;
        p.vx += fx; p.vy += fy;
        p.vx *= 0.9; p.vy *= 0.9;
        p.offX += p.vx; p.offY += p.vy;
        const maxOff = 35 + vol * 20;
        const dist = Math.sqrt(p.offX ** 2 + p.offY ** 2);
        if (dist > maxOff) { p.offX *= maxOff / dist; p.offY *= maxOff / dist; }
      }

      // Spawn barriers
      s.nextBarrierIn--;
      if (s.nextBarrierIn <= 0) {
        const gapMin = 80;
        const gapMax = H2 - 80;
        const gapY = gapMin + Math.random() * (gapMax - gapMin);
        s.barriers.push({ x: W2 + 30, gapY, passed: false, hitFlash: 0 });
        s.nextBarrierIn = Math.max(80, 160 - s.score * 6);
      }

      // Background
      ctx.fillStyle = '#050010';
      ctx.fillRect(0, 0, W2, H2);

      // Ambient glow around swarm
      const glowA = 0.1 + vol * 0.2;
      const glowR = 60 + vol * 80;
      const glow = ctx.createRadialGradient(W2 * 0.2, s.swarmY, 0, W2 * 0.2, s.swarmY, glowR);
      glow.addColorStop(0, `rgba(167,139,250,${glowA})`);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(W2 * 0.2 - glowR, s.swarmY - glowR, glowR * 2, glowR * 2);

      // Draw and update barriers
      for (let i = s.barriers.length - 1; i >= 0; i--) {
        const b = s.barriers[i];
        b.x -= scrollSpeed;
        if (b.x < -40) { s.barriers.splice(i, 1); continue; }

        const hitAge = now - b.hitFlash;
        const barrierAlpha = b.hitFlash > 0 && hitAge < 400 ? (0.4 + (hitAge / 400) * 0.4) : 0.8;
        const barrierColor = b.hitFlash > 0 && hitAge < 400
          ? `rgba(239,68,68,${barrierAlpha})`
          : `rgba(100,60,220,${barrierAlpha})`;

        // Top barrier
        ctx.fillStyle = barrierColor;
        ctx.shadowBlur = 12;
        ctx.shadowColor = b.hitFlash > 0 ? '#ef4444' : '#7c3aed';
        ctx.fillRect(b.x - 18, 0, 36, b.gapY - GAP_HEIGHT / 2);
        // Bottom barrier
        ctx.fillRect(b.x - 18, b.gapY + GAP_HEIGHT / 2, 36, H2 - (b.gapY + GAP_HEIGHT / 2));
        ctx.shadowBlur = 0;

        // Gap indicator line
        ctx.strokeStyle = `rgba(167,139,250,0.3)`;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(b.x - 18, b.gapY);
        ctx.lineTo(b.x + 18, b.gapY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Check if swarm passed through gap
        if (!b.passed && b.x < W2 * 0.2 + 20 && b.x > W2 * 0.2 - 30) {
          const inGap = s.swarmY > b.gapY - GAP_HEIGHT / 2 + 15 && s.swarmY < b.gapY + GAP_HEIGHT / 2 - 15;
          const hitBarrier = !inGap && now - s.lastHitTime > 700;
          if (hitBarrier) {
            b.hitFlash = now;
            s.collisions++;
            s.lives--;
            s.lastHitTime = now;
            sfx.collision();
            hapticFail();
            s.screenFlash = now;
            s.screenFlashColor = 'rgba(239,68,68,0.2)';
            if (s.lives <= 0) { endGame(); return; }
          } else if (inGap) {
            b.passed = true;
            s.score++;
            sfx.collect();
            hapticScore();
            s.passedFlash = now;
          }
        }
      }

      // Draw swarm particles
      for (const p of s.swarmParticles) {
        const px = W2 * 0.2 + p.offX;
        const py = s.swarmY + p.offY;
        const pAlpha = 0.5 + vol * 0.5;
        ctx.save();
        ctx.globalAlpha = pAlpha;
        ctx.shadowBlur = 8 + vol * 12;
        ctx.shadowColor = `hsl(${p.hue}, 80%, 65%)`;
        ctx.fillStyle = `hsl(${p.hue}, 80%, ${55 + vol * 20}%)`;
        ctx.beginPath();
        ctx.arc(px, py, p.size * (0.8 + vol * 0.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Lives
      ctx.save();
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = i < s.lives ? 1 : 0.2;
        ctx.font = '20px serif';
        ctx.fillText('💜', 14 + i * 28, H2 - 18);
      }
      ctx.restore();

      // Mic bar
      const bW = 60, bH = 4;
      const bX = W2 / 2 - bW / 2, bY = H2 - 14;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(bX, bY, bW, bH);
      ctx.fillStyle = `rgba(167,139,250,${0.4 + vol * 0.6})`;
      ctx.fillRect(bX, bY, bW * Math.min(1, vol * 1.5), bH);

      // Pass flash
      if (now - s.passedFlash < 400) {
        const fa = (1 - (now - s.passedFlash) / 400) * 0.18;
        ctx.fillStyle = `rgba(167,139,250,${fa})`;
        ctx.fillRect(0, 0, W2, H2);
      }
      if (now - s.screenFlash < 350) {
        ctx.fillStyle = s.screenFlashColor.replace('0.2)', `${0.2 * (1 - (now - s.screenFlash) / 350)})`);
        ctx.fillRect(0, 0, W2, H2);
      }

      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [getVolume, endGame, initSwarm]);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio();
    sfx.click();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.45;
      src.connect(analyser);
      const s = stateRef.current;
      s.stream = stream;
      s.analyser = analyser;
      s.audioCtx = audioCtx;
    } catch { /* mic denied */ }
    setPhase('countdown');
  }, []);

  const handlePlayAgain = useCallback(() => {
    setIsNewBest(false);
    setFinalSig(null);
    setPhase('start');
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      const c = canvas.getContext('2d');
      if (c) c.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      const s = stateRef.current;
      s.running = false;
      cancelAnimationFrame(s.animId);
      if (s.timerIntervalId) clearInterval(s.timerIntervalId);
      if (s.stream) s.stream.getTracks().forEach(t => t.stop());
      if (s.audioCtx) s.audioCtx.close().catch(() => {});
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []);

  // suppress unused
  void haptic;
  void startMusic;

  return (
    <GameShell
      title={GAME_TITLE}
      emoji={GAME_EMOJI}
      accentColor={accent}
      theme={theme}
      background="radial-gradient(ellipse at 50% 50%, #0a0020 0%, #050010 60%, #000 100%)"
    >
      <canvas
        ref={canvasRef}
        style={{ display: phase === 'playing' ? 'block' : 'none', position: 'absolute', top: 0, left: 0, touchAction: 'none' }}
        role="img"
        aria-label="Breath Sculpt game canvas — guide the particle swarm with your breath"
      />

      {phase === 'playing' && (
        <GameHUD
          accentColor={accent}
          items={[
            { label: 'GAPS', value: displayScore, testId: 'score' },
            { label: 'TIME', value: timeLeft, danger: timeLeft <= 10, testId: 'timer' },
          ]}
        />
      )}

      <AnimatePresence mode="wait">
        {phase === 'start' && (
          <motion.div key="start" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ height: '100%' }}>
            <GameStartScreen
              emoji={GAME_EMOJI}
              title={GAME_TITLE}
              description={GAME_TAGLINE + ' Blow harder to rise, breathe softly to fall. Navigate the particle swarm through the gaps in each barrier.'}
              sensorNote="🎤 Uses microphone"
              ctaLabel="Allow Mic & Sculpt →"
              accentColor={accent}
              onStart={handleStart}
              gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #0a0020 0%, #050010 55%, #000 100%)"
            />
          </motion.div>
        )}
        {phase === 'countdown' && (
          <motion.div key="countdown" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Countdown onComplete={startLoop} accentColor={accent} />
          </motion.div>
        )}
        {phase === 'done' && finalSig && (
          <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ height: '100%' }}>
            <EndScreen
              gameId={GAME_ID}
              title={getPersonality(finalSig)}
              emoji={GAME_EMOJI}
              score={String(finalSig.score)}
              personality={getPersonality(finalSig)}
              insights={[
                { label: 'Gaps cleared', value: String(finalSig.gapsCleared), color: '#a78bfa' },
                { label: 'Collisions', value: String(finalSig.collisions), color: '#ef4444' },
                { label: 'Breath control', value: `${finalSig.breathVariance}% var`, color: '#22d3ee' },
              ]}
              accentColor={accent}
              onPlayAgain={handlePlayAgain}
              didWin={finalSig.score >= 5}
              finalScore={finalSig.score}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}

      <AnimatePresence>
        {isNewBest && phase === 'done' && (
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
    </GameShell>
  );
}
