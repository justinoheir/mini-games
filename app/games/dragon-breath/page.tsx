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

const GAME_ID = 'dragon-breath';
const ACCENT = '#ef4444';
const DURATION = 45;
const GAME_EMOJI = '🐉';
const GAME_TITLE = 'Dragon Breath';
const GAME_TAGLINE = 'Blow fire. Burn your enemies!';
const PB_KEY = 'mg_pb_dragon-breath';

interface Signals {
  score: number;
  enemiesKilled: number;
  breathSeconds: number;
  maxStreak: number;
}

function getPersonality(sig: Signals): string {
  if (sig.enemiesKilled >= 18 && sig.breathSeconds > 22) return 'Inferno Dragon 🔥';
  if (sig.enemiesKilled >= 12) return 'Fire Breather 🐉';
  if (sig.breathSeconds > 28) return 'Smoldering Beast 🌋';
  if (sig.enemiesKilled >= 6) return 'Ember Guardian ⚔️';
  return 'Young Dragon 🥚';
}

interface Enemy {
  x: number;
  y: number;
  speed: number;
  size: number;
  hue: number;
}

interface FireParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  hue: number;
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

export default function DragonBreath() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef({
    running: false,
    timeLeft: DURATION,
    score: 0,
    streak: 0,
    maxStreak: 0,
    breathFrames: 0,
    enemies: [] as Enemy[],
    fireParticles: [] as FireParticle[],
    celebrationParticles: [] as Particle[],
    analyser: null as AnalyserNode | null,
    audioCtx: null as AudioContext | null,
    stream: null as MediaStream | null,
    animId: 0,
    timerIntervalId: null as ReturnType<typeof setInterval> | null,
    nextEnemyIn: 80,
    enemyCounter: 0,
    lives: 3,
    lastHitTime: 0,
    flashUntil: 0,
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
      enemiesKilled: s.score,
      breathSeconds: Math.round(s.breathFrames / 60),
      maxStreak: s.maxStreak,
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
    s.streak = 0;
    s.maxStreak = 0;
    s.breathFrames = 0;
    s.enemies = [];
    s.fireParticles = [];
    s.celebrationParticles = [];
    s.nextEnemyIn = 80;
    s.enemyCounter = 0;
    s.lives = 3;
    s.flashUntil = 0;
    setDisplayScore(0);
    setTimeLeft(DURATION);
    setIsNewBest(false);
    setPhase('playing');
    stopMusicRef.current = startMusic('pulse');

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
      const W = window.innerWidth;
      const H = window.innerHeight;
      const vol = getVolume();
      const isFiring = vol > 0.12;
      if (isFiring) s.breathFrames++;

      const dragonX = W * 0.1;
      const dragonY = H * 0.5;

      // Spawn fire particles when blowing
      if (isFiring) {
        const intensity = Math.min(1, (vol - 0.12) / 0.55);
        const count = Math.floor(intensity * 6) + 1;
        for (let i = 0; i < count; i++) {
          const life = 0.7 + Math.random() * 0.5;
          s.fireParticles.push({
            x: dragonX + 38,
            y: dragonY + (Math.random() - 0.5) * 28,
            vx: 4 + Math.random() * 4 + intensity * 5,
            vy: (Math.random() - 0.5) * 2.5,
            life,
            maxLife: life,
            size: 5 + Math.random() * 9 + intensity * 7,
            hue: Math.random() * 55,
          });
        }
      }

      // Spawn enemies
      s.nextEnemyIn--;
      if (s.nextEnemyIn <= 0) {
        const diff = 1 + (DURATION - s.timeLeft) / DURATION * 1.5;
        s.enemies.push({
          x: W + 35,
          y: H * 0.18 + Math.random() * H * 0.64,
          speed: (0.55 + Math.random() * 0.45) * diff,
          size: 16 + Math.random() * 14,
          hue: 0 + Math.random() * 30,
        });
        s.nextEnemyIn = Math.max(28, 80 - s.enemyCounter * 2);
        s.enemyCounter++;
      }

      // Background
      ctx.fillStyle = '#060000';
      ctx.fillRect(0, 0, W, H);

      // Fire glow behind dragon
      if (isFiring) {
        const grd = ctx.createRadialGradient(dragonX, dragonY, 0, W * 0.5, dragonY, W * 0.55);
        grd.addColorStop(0, `rgba(255,100,0,${vol * 0.18})`);
        grd.addColorStop(1, 'transparent');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, W, H);
      }

      // Update and draw enemies
      const now = Date.now();
      for (let i = s.enemies.length - 1; i >= 0; i--) {
        const e = s.enemies[i];
        e.x -= e.speed;

        // Check fire collision
        let hit = false;
        for (let j = s.fireParticles.length - 1; j >= 0; j--) {
          const p = s.fireParticles[j];
          const dx = p.x - e.x;
          const dy = p.y - e.y;
          if (dx * dx + dy * dy < (e.size + p.size) * (e.size + p.size)) {
            hit = true;
            s.fireParticles.splice(j, 1);
            break;
          }
        }

        if (hit) {
          s.enemies.splice(i, 1);
          s.score++;
          s.streak++;
          if (s.streak > s.maxStreak) s.maxStreak = s.streak;
          sfx.collect();
          hapticScore();
          spawnBurst(s.celebrationParticles, e.x, e.y, '#ff6600', 12, 5);
          continue;
        }

        // Reached dragon
        if (e.x < dragonX + 25 && now - s.lastHitTime > 900) {
          s.enemies.splice(i, 1);
          s.lives--;
          s.streak = 0;
          sfx.collision();
          hapticFail();
          s.flashUntil = now + 220;
          s.lastHitTime = now;
          if (s.lives <= 0) { endGame(); return; }
          continue;
        }

        // Draw enemy — glowing eye creature
        ctx.save();
        ctx.shadowBlur = 14;
        ctx.shadowColor = `hsl(${e.hue}, 90%, 50%)`;
        ctx.fillStyle = `hsl(${e.hue}, 80%, 40%)`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
        ctx.fill();
        // Eye
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(e.x + e.size * 0.3, e.y - e.size * 0.2, e.size * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f00';
        ctx.beginPath();
        ctx.arc(e.x + e.size * 0.35, e.y - e.size * 0.2, e.size * 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Update and draw fire particles
      for (let i = s.fireParticles.length - 1; i >= 0; i--) {
        const p = s.fireParticles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.04;
        p.life -= 0.02;
        if (p.life <= 0 || p.x > W + 30) { s.fireParticles.splice(i, 1); continue; }
        const a = p.life / p.maxLife;
        ctx.save();
        ctx.globalAlpha = a * 0.9;
        ctx.shadowBlur = 12;
        ctx.shadowColor = `hsl(${p.hue}, 100%, 60%)`;
        ctx.fillStyle = `hsl(${p.hue}, 100%, ${45 + a * 20}%)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * a + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Draw dragon
      ctx.save();
      // Body
      ctx.shadowBlur = isFiring ? 28 : 8;
      ctx.shadowColor = isFiring ? '#ff5500' : '#661100';
      ctx.fillStyle = '#1e6b14';
      ctx.beginPath();
      ctx.ellipse(dragonX, dragonY + 5, 24, 36, -0.15, 0, Math.PI * 2);
      ctx.fill();
      // Wings
      ctx.fillStyle = '#3a9a2e';
      ctx.beginPath();
      ctx.moveTo(dragonX - 10, dragonY - 20);
      ctx.lineTo(dragonX - 38, dragonY - 50);
      ctx.lineTo(dragonX - 5, dragonY - 10);
      ctx.fill();
      // Head
      ctx.fillStyle = '#2ab020';
      ctx.beginPath();
      ctx.ellipse(dragonX + 28, dragonY - 8, 18, 14, 0.25, 0, Math.PI * 2);
      ctx.fill();
      // Eye
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffe600';
      ctx.beginPath();
      ctx.arc(dragonX + 34, dragonY - 13, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(dragonX + 35, dragonY - 13, 2.5, 0, Math.PI * 2);
      ctx.fill();
      // Snout / open mouth
      ctx.fillStyle = '#1d7c16';
      ctx.beginPath();
      ctx.ellipse(dragonX + 44, dragonY + 2, 10, 6, 0.1, 0, Math.PI * 2);
      ctx.fill();
      if (isFiring) {
        ctx.fillStyle = '#ff5500';
        ctx.beginPath();
        ctx.ellipse(dragonX + 52, dragonY + 3, 7, 4, 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Celebration particles
      updateAndDrawParticles(ctx, s.celebrationParticles);

      // Hit flash overlay
      if (now < s.flashUntil) {
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }

      // Lives row
      ctx.save();
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = i < s.lives ? 1 : 0.22;
        ctx.font = '22px serif';
        ctx.fillText('❤️', 16 + i * 30, H - 18);
      }
      ctx.restore();

      // Mic bar
      const bW = 70, bH = 5;
      const bX = W / 2 - bW / 2, bY = H - 16;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(bX, bY, bW, bH);
      ctx.fillStyle = isFiring ? '#ff6600' : 'rgba(255,255,255,0.28)';
      ctx.fillRect(bX, bY, bW * Math.min(1, vol), bH);

      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [getVolume, endGame]);

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
      analyser.smoothingTimeConstant = 0.4;
      src.connect(analyser);
      const s = stateRef.current;
      s.stream = stream;
      s.analyser = analyser;
      s.audioCtx = audioCtx;
    } catch { /* mic denied — vol returns 0 */ }
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

  return (
    <GameShell
      title={GAME_TITLE}
      emoji={GAME_EMOJI}
      accentColor={accent}
      theme={theme}
      background="radial-gradient(ellipse at 50% 50%, #1a0500 0%, #0a0000 60%, #000 100%)"
    >
      <canvas
        ref={canvasRef}
        style={{ display: phase === 'playing' ? 'block' : 'none', position: 'absolute', top: 0, left: 0, touchAction: 'none' }}
        role="img"
        aria-label="Dragon Breath game canvas — blow into mic to fire"
      />

      {phase === 'playing' && (
        <GameHUD
          accentColor={accent}
          items={[
            { label: 'SCORE', value: displayScore, testId: 'score' },
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
              description={GAME_TAGLINE + ' Blow into the mic to breathe fire and destroy the enemies marching toward you.'}
              sensorNote="🎤 Uses microphone"
              ctaLabel="Allow Mic & Breathe Fire →"
              accentColor={accent}
              onStart={handleStart}
              gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #2a0800 0%, #100300 55%, #000 100%)"
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
                { label: 'Enemies slain', value: String(finalSig.enemiesKilled), color: '#ef4444' },
                { label: 'Fire time', value: `${finalSig.breathSeconds}s`, color: '#f97316' },
                { label: 'Best streak', value: String(finalSig.maxStreak), color: '#fbbf24' },
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
