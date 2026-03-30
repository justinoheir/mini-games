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
import { Particle, spawnBurst, updateAndDrawParticles } from '@/lib/particles';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { motion, AnimatePresence } from 'framer-motion';

const GAME_ID = 'whistle-launch';
const ACCENT = '#f59e0b';
const DURATION = 45;
const GAME_EMOJI = '🎯';
const GAME_TITLE = 'Whistle Launch';
const GAME_TAGLINE = 'Sharp spike fires. Hit every target!';
const PB_KEY = 'mg_pb_whistle-launch';
// Volume must jump by SPIKE_DELTA in one frame, exceeding SPIKE_MIN to count
const SPIKE_MIN = 0.45;
const SPIKE_DELTA = 0.22;
const TARGET_COUNT = 6;

interface Signals {
  score: number;
  hits: number;
  misses: number;
  maxStreak: number;
  peakVolume: number;
}

function getPersonality(sig: Signals): string {
  const acc = (sig.hits + sig.misses) > 0 ? sig.hits / (sig.hits + sig.misses) : 0;
  if (acc >= 0.85 && sig.maxStreak >= 4) return 'Dead Eye 🎯';
  if (sig.hits >= 18) return 'Marksman 🏹';
  if (acc >= 0.75) return 'Sharpshooter ⚡';
  if (sig.peakVolume > 0.85) return 'Thundervoice 🌩️';
  return 'Training Day 🌱';
}

interface Target {
  x: number;
  y: number;
  r: number;
  hp: number;
  hitAt: number;
  spawnAt: number;
  id: number;
  vx: number;
  vy: number;
  pulseT: number;
}

interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;   // target x at fire time
  ty: number;
  id: number;
  born: number;
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

export default function WhistleLaunch() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef({
    running: false,
    timeLeft: DURATION,
    score: 0,
    hits: 0,
    misses: 0,
    streak: 0,
    maxStreak: 0,
    peakVol: 0,
    targets: [] as Target[],
    projectiles: [] as Projectile[],
    particles: [] as Particle[],
    analyser: null as AnalyserNode | null,
    audioCtx: null as AudioContext | null,
    stream: null as MediaStream | null,
    animId: 0,
    timerIntervalId: null as ReturnType<typeof setInterval> | null,
    prevVol: 0,
    spikeThrottle: 0,
    targetIdCounter: 0,
    projIdCounter: 0,
    launchFlash: 0,
    hitFlash: 0,
    launcherY: 0,
    launcherX: 0,
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

  const spawnTarget = useCallback((W: number, H: number) => {
    const s = stateRef.current;
    const margin = 60;
    const lx = s.launcherX;
    const ly = s.launcherY;
    let x = 0, y = 0, attempts = 0;
    do {
      x = margin + Math.random() * (W - margin * 2);
      y = 100 + Math.random() * (H - 180);
      attempts++;
    } while (Math.hypot(x - lx, y - ly) < W * 0.25 && attempts < 15);

    const moving = s.score >= 5;
    const speed = moving ? (0.5 + Math.random() * 0.8) : 0;
    const angle = Math.random() * Math.PI * 2;
    s.targets.push({
      x, y,
      r: 22 + Math.random() * 10,
      hp: 1,
      hitAt: 0,
      spawnAt: Date.now(),
      id: s.targetIdCounter++,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      pulseT: Math.random() * Math.PI * 2,
    });
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
    const sig: Signals = {
      score: s.score,
      hits: s.hits,
      misses: s.misses,
      maxStreak: s.maxStreak,
      peakVolume: s.peakVol,
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
    s.hits = 0;
    s.misses = 0;
    s.streak = 0;
    s.maxStreak = 0;
    s.peakVol = 0;
    s.targets = [];
    s.projectiles = [];
    s.particles = [];
    s.prevVol = 0;
    s.spikeThrottle = 0;
    s.targetIdCounter = 0;
    s.projIdCounter = 0;
    s.launchFlash = 0;
    s.hitFlash = 0;
    setDisplayScore(0);
    setTimeLeft(DURATION);
    setIsNewBest(false);
    setPhase('playing');
    stopMusicRef.current = startMusic('pulse');

    const W = window.innerWidth;
    const H = window.innerHeight;
    s.launcherX = W / 2;
    s.launcherY = H - 60;
    for (let i = 0; i < TARGET_COUNT; i++) spawnTarget(W, H);

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
      if (vol > s.peakVol) s.peakVol = vol;
      const now = Date.now();
      s.launcherX = W2 / 2;
      s.launcherY = H2 - 60;

      // Spike detection
      s.spikeThrottle--;
      const delta = vol - s.prevVol;
      if (vol >= SPIKE_MIN && delta >= SPIKE_DELTA && s.spikeThrottle <= 0) {
        // Find nearest live target
        let nearest: Target | null = null;
        let nearDist = Infinity;
        for (const t of s.targets) {
          if (t.hitAt > 0) continue;
          const d = Math.hypot(t.x - s.launcherX, t.y - s.launcherY);
          if (d < nearDist) { nearDist = d; nearest = t; }
        }
        if (nearest) {
          const dx = nearest.x - s.launcherX;
          const dy = nearest.y - s.launcherY;
          const len = Math.hypot(dx, dy);
          const speed = 9 + nearDist / 80;
          s.projectiles.push({
            x: s.launcherX,
            y: s.launcherY,
            vx: (dx / len) * speed,
            vy: (dy / len) * speed,
            tx: nearest.x,
            ty: nearest.y,
            id: s.projIdCounter++,
            born: now,
          });
          s.launchFlash = now;
          s.spikeThrottle = 20;
        }
      }
      s.prevVol = vol;

      // Background
      ctx.fillStyle = '#08060e';
      ctx.fillRect(0, 0, W2, H2);

      // Update and draw targets
      for (let i = s.targets.length - 1; i >= 0; i--) {
        const t = s.targets[i];
        if (t.hitAt > 0 && now - t.hitAt > 700) {
          s.targets.splice(i, 1);
          spawnTarget(W2, H2);
          continue;
        }
        if (t.hitAt === 0 && t.vx !== 0) {
          t.x += t.vx; t.y += t.vy;
          if (t.x < t.r || t.x > W2 - t.r) t.vx *= -1;
          if (t.y < 90 || t.y > H2 - 90) t.vy *= -1;
        }
        t.pulseT += 0.06;
        const isHit = t.hitAt > 0;
        const hitAge = isHit ? (now - t.hitAt) / 700 : 0;
        const alpha = isHit ? Math.max(0, 1 - hitAge * 1.4) : (0.7 + Math.sin(t.pulseT) * 0.3);
        const scale = isHit ? 1 + hitAge * 2 : 1;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(t.x, t.y);
        ctx.scale(scale, scale);
        // Outer ring
        ctx.shadowBlur = isHit ? 30 : 12;
        ctx.shadowColor = isHit ? '#fbbf24' : '#f59e0b88';
        // Outer halo
        ctx.strokeStyle = isHit ? '#fbbf24' : `rgba(245,158,11,${0.3 + Math.sin(t.pulseT) * 0.2})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, t.r + 8, 0, Math.PI * 2);
        ctx.stroke();
        // Target circle
        ctx.fillStyle = isHit ? 'rgba(251,191,36,0.4)' : 'rgba(245,158,11,0.15)';
        ctx.beginPath();
        ctx.arc(0, 0, t.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = isHit ? '#fbbf24' : '#f59e0b';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        // Inner ring
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, t.r * 0.5, 0, Math.PI * 2);
        ctx.stroke();
        // Bullseye
        ctx.fillStyle = isHit ? '#fbbf24' : '#f59e0b';
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Update and draw projectiles
      for (let i = s.projectiles.length - 1; i >= 0; i--) {
        const p = s.projectiles[i];
        p.x += p.vx;
        p.y += p.vy;
        const age = (now - p.born) / 1000;

        // Remove if off-screen or old
        if (p.x < -20 || p.x > W2 + 20 || p.y < -20 || p.y > H2 + 20 || age > 3) {
          s.projectiles.splice(i, 1);
          continue;
        }

        // Check target collision
        let hit = false;
        for (const t of s.targets) {
          if (t.hitAt > 0) continue;
          if (Math.hypot(p.x - t.x, p.y - t.y) < t.r + 8) {
            t.hitAt = now;
            s.score++;
            s.hits++;
            s.streak++;
            if (s.streak > s.maxStreak) s.maxStreak = s.streak;
            sfx.collect();
            hapticScore();
            spawnBurst(s.particles, t.x, t.y, '#fbbf24', 14, 5);
            s.hitFlash = now;
            hit = true;
            break;
          }
        }
        if (hit) { s.projectiles.splice(i, 1); continue; }

        // Draw projectile trail
        const trailLen = 4;
        for (let ti = 0; ti < trailLen; ti++) {
          const ta = (ti / trailLen) * 0.6;
          const tx2 = p.x - p.vx * ti * 0.8;
          const ty2 = p.y - p.vy * ti * 0.8;
          ctx.save();
          ctx.globalAlpha = ta;
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(tx2, ty2, 5 - ti * 0.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        // Projectile head
        ctx.save();
        ctx.shadowBlur = 18;
        ctx.shadowColor = '#fbbf24';
        ctx.fillStyle = '#fffbeb';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Particles
      updateAndDrawParticles(ctx, s.particles);

      // Launcher (bottom center)
      const lx = s.launcherX;
      const ly = s.launcherY;
      const launchAge = now - s.launchFlash;
      const launchGlow = launchAge < 200 ? (1 - launchAge / 200) : 0;
      ctx.save();
      ctx.shadowBlur = 15 + launchGlow * 30;
      ctx.shadowColor = '#f59e0b';
      ctx.fillStyle = `rgba(245,158,11,${0.8 + launchGlow * 0.2})`;
      // Triangle launcher
      ctx.beginPath();
      ctx.moveTo(lx, ly - 24);
      ctx.lineTo(lx - 16, ly + 10);
      ctx.lineTo(lx + 16, ly + 10);
      ctx.closePath();
      ctx.fill();
      // Base
      ctx.fillStyle = 'rgba(245,158,11,0.4)';
      ctx.beginPath();
      ctx.arc(lx, ly + 10, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Vol indicator
      const bW = 60, bH = 4;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(lx - bW / 2, ly + 28, bW, bH);
      ctx.fillStyle = vol >= SPIKE_MIN ? '#fbbf24' : 'rgba(255,255,255,0.25)';
      ctx.fillRect(lx - bW / 2, ly + 28, bW * Math.min(1, vol), bH);

      // Launch flash overlay
      if (launchAge < 200) {
        ctx.fillStyle = `rgba(245,158,11,${launchGlow * 0.12})`;
        ctx.fillRect(0, 0, W2, H2);
      }
      if (now - s.hitFlash < 250) {
        const ha = (1 - (now - s.hitFlash) / 250) * 0.15;
        ctx.fillStyle = `rgba(251,191,36,${ha})`;
        ctx.fillRect(0, 0, W2, H2);
      }

      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [getVolume, endGame, spawnTarget]);

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
      analyser.smoothingTimeConstant = 0.2;  // fast response for spike detection
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
  void hapticFail;

  return (
    <GameShell
      title={GAME_TITLE}
      emoji={GAME_EMOJI}
      accentColor={accent}
      theme={theme}
      background="radial-gradient(ellipse at 50% 50%, #100800 0%, #080500 60%, #000 100%)"
    >
      <canvas
        ref={canvasRef}
        style={{ display: phase === 'playing' ? 'block' : 'none', position: 'absolute', top: 0, left: 0, touchAction: 'none' }}
        role="img"
        aria-label="Whistle Launch game canvas — sharp volume spike fires a projectile"
      />

      {phase === 'playing' && (
        <GameHUD
          accentColor={accent}
          items={[
            { label: 'HITS', value: displayScore, testId: 'score' },
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
              description={GAME_TAGLINE + ' Whistle or shout sharply into the mic — each sharp spike launches a projectile at the nearest target.'}
              sensorNote="🎤 Uses microphone"
              ctaLabel="Allow Mic & Fire →"
              accentColor={accent}
              onStart={handleStart}
              gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #100800 0%, #080500 55%, #000 100%)"
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
                { label: 'Targets hit', value: String(finalSig.hits), color: '#f59e0b' },
                { label: 'Best streak', value: String(finalSig.maxStreak), color: '#fbbf24' },
                { label: 'Peak volume', value: `${Math.round(finalSig.peakVolume * 100)}%`, color: '#ef4444' },
              ]}
              accentColor={accent}
              onPlayAgain={handlePlayAgain}
              didWin={finalSig.score >= 6}
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
