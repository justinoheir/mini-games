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

const GAME_ID = 'vocal-shield';
const ACCENT = '#818cf8';
const DURATION = 45;
const GAME_EMOJI = '🛡️';
const GAME_TITLE = 'Vocal Shield';
const GAME_TAGLINE = 'Sustain your voice. The shield holds as long as you do.';
const PB_KEY = 'mg_pb_vocal-shield';
const SHIELD_THRESHOLD = 0.2;  // voice must be above this to power shield
const SHIELD_BASE_R = 55;      // base shield radius
const SHIELD_MAX_BONUS = 85;   // extra radius at full volume

interface Signals {
  score: number;
  blocked: number;
  passed: number;
  sustainSeconds: number;
  peakVolume: number;
}

function getPersonality(sig: Signals): string {
  const total = sig.blocked + sig.passed;
  const blockRate = total > 0 ? sig.blocked / total : 0;
  if (blockRate >= 0.85 && sig.sustainSeconds >= 28) return 'Iron Wall 🧱';
  if (sig.blocked >= 18) return 'Shield Master 🛡️';
  if (sig.sustainSeconds >= 32) return 'Voice of Steel 🔊';
  if (blockRate >= 0.65) return 'Defender 🗡️';
  return 'Apprentice ⚔️';
}

interface Enemy {
  x: number;
  y: number;
  speed: number;
  r: number;
  color: string;
  hue: number;
  bouncing: boolean;
  bounceVx: number;
  bounceVy: number;
  bounceT: number;
  id: number;
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

export default function VocalShield() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef({
    running: false,
    timeLeft: DURATION,
    score: 0,
    blocked: 0,
    passed: 0,
    sustainFrames: 0,
    peakVol: 0,
    shieldPower: 0,        // 0-1, smoothed vol when above threshold
    shieldR: SHIELD_BASE_R,
    enemies: [] as Enemy[],
    particles: [] as Particle[],
    analyser: null as AnalyserNode | null,
    audioCtx: null as AudioContext | null,
    stream: null as MediaStream | null,
    animId: 0,
    timerIntervalId: null as ReturnType<typeof setInterval> | null,
    nextEnemyIn: 60,
    enemyIdCounter: 0,
    lives: 5,
    lastHitTime: 0,
    flashRed: 0,
    flashBlue: 0,
    shieldPulse: 0,
    shieldAngle: 0,
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
      blocked: s.blocked,
      passed: s.passed,
      sustainSeconds: Math.round(s.sustainFrames / 60),
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
    s.blocked = 0;
    s.passed = 0;
    s.sustainFrames = 0;
    s.peakVol = 0;
    s.shieldPower = 0;
    s.shieldR = SHIELD_BASE_R;
    s.enemies = [];
    s.particles = [];
    s.nextEnemyIn = 60;
    s.enemyIdCounter = 0;
    s.lives = 5;
    s.lastHitTime = 0;
    s.flashRed = 0;
    s.flashBlue = 0;
    s.shieldPulse = 0;
    s.shieldAngle = 0;
    setDisplayScore(0);
    setTimeLeft(DURATION);
    setIsNewBest(false);
    setPhase('playing');
    stopMusicRef.current = startMusic('calm');

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
      const cx = W / 2;
      const cy = H / 2;
      const vol = getVolume();
      if (vol > s.peakVol) s.peakVol = vol;
      const now = Date.now();
      s.shieldAngle += 0.015;

      // Shield power: smooth toward volume when above threshold, decay when silent
      const powered = vol >= SHIELD_THRESHOLD;
      if (powered) {
        s.shieldPower = Math.min(1, s.shieldPower * 0.88 + vol * 0.12 + 0.08);
        s.sustainFrames++;
      } else {
        s.shieldPower = Math.max(0, s.shieldPower - 0.04);
      }
      s.shieldR = SHIELD_BASE_R + s.shieldPower * SHIELD_MAX_BONUS;

      // Spawn enemies from edges
      s.nextEnemyIn--;
      if (s.nextEnemyIn <= 0) {
        const edge = Math.floor(Math.random() * 4);
        let ex = 0, ey = 0;
        if (edge === 0) { ex = Math.random() * W; ey = -20; }
        else if (edge === 1) { ex = W + 20; ey = Math.random() * H; }
        else if (edge === 2) { ex = Math.random() * W; ey = H + 20; }
        else { ex = -20; ey = Math.random() * H; }
        const hue = 0 + Math.random() * 30;
        const diff = 1 + (DURATION - s.timeLeft) / DURATION * 1.2;
        s.enemies.push({
          x: ex, y: ey,
          speed: (0.5 + Math.random() * 0.4) * diff,
          r: 14 + Math.random() * 10,
          color: `hsl(${hue}, 85%, 55%)`,
          hue,
          bouncing: false,
          bounceVx: 0, bounceVy: 0, bounceT: 0,
          id: s.enemyIdCounter++,
        });
        const interval = Math.max(30, 65 - s.score * 2);
        s.nextEnemyIn = interval;
      }

      // Background
      const bgR = Math.round(s.shieldPower * 20);
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H));
      bg.addColorStop(0, `rgba(${bgR}, ${bgR}, ${Math.round(30 + s.shieldPower * 50)}, 1)`);
      bg.addColorStop(1, '#000008');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Shield glow
      if (s.shieldPower > 0.05) {
        const sGlow = ctx.createRadialGradient(cx, cy, s.shieldR * 0.5, cx, cy, s.shieldR * 1.8);
        sGlow.addColorStop(0, `rgba(129,140,248,${s.shieldPower * 0.22})`);
        sGlow.addColorStop(1, 'transparent');
        ctx.fillStyle = sGlow;
        ctx.fillRect(0, 0, W, H);
      }

      // Update and draw enemies
      for (let i = s.enemies.length - 1; i >= 0; i--) {
        const e = s.enemies[i];

        if (e.bouncing) {
          e.x += e.bounceVx;
          e.y += e.bounceVy;
          e.bounceT += 0.07;
          const bounceAge = (now - (e.bounceT * 1000)) / 1200;
          if (e.x < -50 || e.x > W + 50 || e.y < -50 || e.y > H + 50 || bounceAge > 1) {
            s.enemies.splice(i, 1);
            continue;
          }
        } else {
          // Move toward center
          const dx = cx - e.x;
          const dy = cy - e.y;
          const len = Math.hypot(dx, dy);
          e.x += (dx / len) * e.speed;
          e.y += (dy / len) * e.speed;

          // Shield collision
          const distToCenter = Math.hypot(e.x - cx, e.y - cy);
          if (distToCenter < s.shieldR + e.r) {
            if (s.shieldPower >= 0.3) {
              // Bounce!
              const nx = (e.x - cx) / distToCenter;
              const ny = (e.y - cy) / distToCenter;
              e.bouncing = true;
              e.bounceVx = nx * (3 + s.shieldPower * 3);
              e.bounceVy = ny * (3 + s.shieldPower * 3);
              e.bounceT = now / 1000;
              s.blocked++;
              s.score++;
              sfx.collect();
              hapticScore();
              spawnBurst(s.particles, e.x, e.y, '#818cf8', 10, 4);
              s.flashBlue = now;
              s.shieldPulse = now;
            } else if (distToCenter < 30 && now - s.lastHitTime > 600) {
              // Passed through
              s.passed++;
              s.lives--;
              s.enemies.splice(i, 1);
              sfx.collision();
              hapticFail();
              s.flashRed = now;
              s.lastHitTime = now;
              if (s.lives <= 0) { endGame(); return; }
              continue;
            }
          }
        }

        // Draw enemy
        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowColor = e.color;
        ctx.fillStyle = e.color;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fill();
        // Eye spike
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 0.28, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 0.14, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Particles
      updateAndDrawParticles(ctx, s.particles);

      // Shield rings
      const pulseBoom = s.shieldPulse > 0 && now - s.shieldPulse < 400
        ? (1 - (now - s.shieldPulse) / 400) * 18
        : 0;

      // Outer decorative rings (spinning)
      if (s.shieldPower > 0.1) {
        for (let ring = 0; ring < 3; ring++) {
          const ringR = s.shieldR + ring * 10 + pulseBoom;
          const ringAlpha = (s.shieldPower - 0.1) * (0.6 - ring * 0.15);
          ctx.save();
          ctx.strokeStyle = `rgba(129,140,248,${ringAlpha})`;
          ctx.lineWidth = 1.5 - ring * 0.3;
          ctx.setLineDash([8, 8]);
          ctx.lineDashOffset = s.shieldAngle * 40 * (ring % 2 === 0 ? 1 : -1);
          ctx.beginPath();
          ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Main shield
      const shieldAlpha = 0.08 + s.shieldPower * 0.25;
      ctx.save();
      ctx.shadowBlur = 20 + s.shieldPower * 40;
      ctx.shadowColor = `rgba(129,140,248,${s.shieldPower})`;
      ctx.strokeStyle = `rgba(129,140,248,${0.3 + s.shieldPower * 0.6})`;
      ctx.lineWidth = 2.5 + s.shieldPower * 3;
      ctx.beginPath();
      ctx.arc(cx, cy, s.shieldR + pulseBoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(129,140,248,${shieldAlpha})`;
      ctx.fill();
      ctx.restore();

      // Core orb
      const coreR = 18 + s.shieldPower * 10;
      ctx.save();
      ctx.shadowBlur = 30 + s.shieldPower * 30;
      ctx.shadowColor = powered ? '#818cf8' : '#334155';
      ctx.fillStyle = powered ? `rgba(129,140,248,${0.6 + s.shieldPower * 0.4})` : 'rgba(51,65,85,0.6)';
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();
      // Inner glow
      ctx.fillStyle = powered ? `rgba(255,255,255,${s.shieldPower * 0.5})` : 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.arc(cx - coreR * 0.25, cy - coreR * 0.25, coreR * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Shield power bar
      const barW = 120, barH = 6;
      const barX = cx - barW / 2, barY = cy + s.shieldR + 25;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(barX, barY, barW, barH);
      const powerColor = s.shieldPower > 0.5 ? '#818cf8' : (s.shieldPower > 0.2 ? '#fbbf24' : '#ef4444');
      ctx.fillStyle = powerColor;
      ctx.shadowBlur = powered ? 8 : 0;
      ctx.shadowColor = powerColor;
      ctx.fillRect(barX, barY, barW * s.shieldPower, barH);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '700 11px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(powered ? 'SHIELD ACTIVE' : 'SPEAK TO POWER', cx, barY + barH + 14);
      ctx.textAlign = 'left';

      // Lives
      ctx.save();
      for (let i = 0; i < 5; i++) {
        ctx.globalAlpha = i < s.lives ? 0.9 : 0.18;
        ctx.font = '16px serif';
        ctx.fillText('💜', 12 + i * 22, H - 16);
      }
      ctx.restore();

      // Mic bar
      const mbW = 60, mbH = 4;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(W - mbW - 10, H - 16, mbW, mbH);
      ctx.fillStyle = powered ? '#818cf8' : 'rgba(255,255,255,0.2)';
      ctx.fillRect(W - mbW - 10, H - 16, mbW * Math.min(1, vol * 1.5), mbH);

      // Flashes
      if (now - s.flashBlue < 300) {
        ctx.fillStyle = `rgba(129,140,248,${(1 - (now - s.flashBlue) / 300) * 0.15})`;
        ctx.fillRect(0, 0, W, H);
      }
      if (now - s.flashRed < 300) {
        ctx.fillStyle = `rgba(239,68,68,${(1 - (now - s.flashRed) / 300) * 0.2})`;
        ctx.fillRect(0, 0, W, H);
      }

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
      background="radial-gradient(ellipse at 50% 50%, #0a0a20 0%, #050510 60%, #000 100%)"
    >
      <canvas
        ref={canvasRef}
        style={{ display: phase === 'playing' ? 'block' : 'none', position: 'absolute', top: 0, left: 0, touchAction: 'none' }}
        role="img"
        aria-label="Vocal Shield game canvas — sustain your voice to power the shield"
      />

      {phase === 'playing' && (
        <GameHUD
          accentColor={accent}
          items={[
            { label: 'BLOCKED', value: displayScore, testId: 'score' },
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
              description={GAME_TAGLINE + ' Speak or hum continuously to keep your energy shield up. Enemies bounce off when powered — fall silent and they break through.'}
              sensorNote="🎤 Uses microphone"
              ctaLabel="Allow Mic & Defend →"
              accentColor={accent}
              onStart={handleStart}
              gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #0a0a20 0%, #050510 55%, #000 100%)"
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
                { label: 'Enemies blocked', value: String(finalSig.blocked), color: '#818cf8' },
                { label: 'Voice sustained', value: `${finalSig.sustainSeconds}s`, color: '#22d3ee' },
                { label: 'Broke through', value: String(finalSig.passed), color: '#ef4444' },
                { label: 'Peak power', value: `${Math.round(finalSig.peakVolume * 100)}%`, color: '#fbbf24' },
              ]}
              accentColor={accent}
              onPlayAgain={handlePlayAgain}
              didWin={finalSig.score >= 8}
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
