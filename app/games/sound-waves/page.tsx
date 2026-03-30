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

const GAME_ID = 'sound-waves';
const ACCENT = '#22d3ee';
const DURATION = 45;
const GAME_EMOJI = '🌊';
const GAME_TITLE = 'Sound Waves';
const GAME_TAGLINE = 'Shout to shatter. Louder waves hit harder.';
const PB_KEY = 'mg_pb_sound-waves';

interface Signals {
  score: number;
  targetsDestroyed: number;
  peakVolume: number;
  wavesFired: number;
}

function getPersonality(sig: Signals): string {
  if (sig.targetsDestroyed >= 20 && sig.peakVolume > 0.75) return 'Sonic Destroyer 💥';
  if (sig.targetsDestroyed >= 14) return 'Wave Master 🌊';
  if (sig.peakVolume > 0.8) return 'Peak Screamer 🔊';
  if (sig.wavesFired >= 20) return 'Steady Pulsar 🔵';
  return 'Echo Chamber 🔇';
}

interface WaveRing {
  r: number;
  maxR: number;
  strength: number;
  born: number;
  cx: number;
  cy: number;
}

interface Target {
  x: number;
  y: number;
  r: number;
  hitAlpha: number;
  hitAt: number;
  id: number;
}

interface Ripple {
  x: number;
  y: number;
  r: number;
  alpha: number;
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

export default function SoundWaves() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef({
    running: false,
    timeLeft: DURATION,
    score: 0,
    peakVol: 0,
    wavesFired: 0,
    waves: [] as WaveRing[],
    targets: [] as Target[],
    ripples: [] as Ripple[],
    analyser: null as AnalyserNode | null,
    audioCtx: null as AudioContext | null,
    stream: null as MediaStream | null,
    animId: 0,
    timerIntervalId: null as ReturnType<typeof setInterval> | null,
    lastWaveVol: 0,
    waveThrottle: 0,
    targetIdCounter: 0,
    scoreFlash: 0,
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

  const spawnTargets = useCallback((W: number, H: number, count: number) => {
    const s = stateRef.current;
    const cx = W / 2;
    const cy = H / 2;
    for (let i = 0; i < count; i++) {
      let x = 0, y = 0, attempts = 0;
      do {
        const angle = Math.random() * Math.PI * 2;
        const dist = W * 0.22 + Math.random() * Math.min(W, H) * 0.3;
        x = cx + Math.cos(angle) * dist;
        y = cy + Math.sin(angle) * dist;
        attempts++;
      } while ((x < 30 || x > W - 30 || y < 90 || y > H - 40) && attempts < 20);
      s.targets.push({ x, y, r: 18 + Math.random() * 10, hitAlpha: 0, hitAt: 0, id: s.targetIdCounter++ });
    }
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
      targetsDestroyed: s.score,
      peakVolume: s.peakVol,
      wavesFired: s.wavesFired,
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
    s.peakVol = 0;
    s.wavesFired = 0;
    s.waves = [];
    s.targets = [];
    s.ripples = [];
    s.lastWaveVol = 0;
    s.waveThrottle = 0;
    s.targetIdCounter = 0;
    s.scoreFlash = 0;
    setDisplayScore(0);
    setTimeLeft(DURATION);
    setIsNewBest(false);
    setPhase('playing');
    stopMusicRef.current = startMusic('calm');

    const W = window.innerWidth;
    const H = window.innerHeight;
    spawnTargets(W, H, 7);

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
      const cx = W2 / 2;
      const cy = H2 / 2;
      const vol = getVolume();
      if (vol > s.peakVol) s.peakVol = vol;

      // Fire wave when volume crosses threshold coming up
      s.waveThrottle--;
      if (vol > 0.18 && s.lastWaveVol <= 0.18 && s.waveThrottle <= 0) {
        const strength = Math.min(1, (vol - 0.18) / 0.6 + 0.1);
        const maxR = Math.min(W2, H2) * (0.35 + strength * 0.55);
        s.waves.push({ r: 0, maxR, strength, born: Date.now(), cx, cy });
        s.wavesFired++;
        s.waveThrottle = 8;
      }
      // Also fire continuous waves for sustained loud sound
      if (vol > 0.35 && s.waveThrottle <= 0) {
        const strength = Math.min(1, vol);
        const maxR = Math.min(W2, H2) * (0.25 + strength * 0.5);
        s.waves.push({ r: 0, maxR, strength, born: Date.now(), cx, cy });
        s.waveThrottle = 18;
        s.wavesFired++;
      }
      s.lastWaveVol = vol;

      // Background
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W2, H2) * 0.8);
      bg.addColorStop(0, '#001420');
      bg.addColorStop(1, '#000810');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W2, H2);

      // Center source glow
      const glowR = 30 + vol * 50;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      glow.addColorStop(0, `rgba(34,211,238,${0.3 + vol * 0.5})`);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);

      // Center icon
      ctx.save();
      ctx.shadowBlur = 20 + vol * 30;
      ctx.shadowColor = '#22d3ee';
      ctx.fillStyle = `rgba(34,211,238,${0.5 + vol * 0.5})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 14 + vol * 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Update waves and detect collisions
      const now = Date.now();
      for (let i = s.waves.length - 1; i >= 0; i--) {
        const w = s.waves[i];
        const age = (now - w.born) / 1000;
        w.r = w.maxR * Math.min(1, age * 2.2);
        const alpha = Math.max(0, 1 - age * 1.4);
        if (alpha <= 0) { s.waves.splice(i, 1); continue; }

        // Draw wave ring
        const lineW = 2.5 + w.strength * 3.5;
        ctx.save();
        ctx.strokeStyle = `rgba(34,211,238,${alpha * 0.85})`;
        ctx.lineWidth = lineW;
        ctx.shadowBlur = 10 + w.strength * 18;
        ctx.shadowColor = `rgba(34,211,238,${alpha})`;
        ctx.beginPath();
        ctx.arc(w.cx, w.cy, w.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Check target collisions
        for (let j = s.targets.length - 1; j >= 0; j--) {
          const t = s.targets[j];
          if (t.hitAt > 0 && now - t.hitAt < 500) continue;
          const dx = t.x - w.cx;
          const dy = t.y - w.cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (Math.abs(dist - w.r) < t.r + lineW * 1.5) {
            if (t.hitAt === 0) {
              t.hitAt = now;
              t.hitAlpha = 1;
              s.score++;
              sfx.collect();
              hapticScore();
              s.scoreFlash = now;
              // Spawn replacement
              setTimeout(() => {
                if (!s.running) return;
                spawnTargets(W2, H2, 1);
              }, 1200);
              // Ripple on target
              s.ripples.push({ x: t.x, y: t.y, r: t.r, alpha: 1 });
            }
          }
        }
      }

      // Remove dead targets (fully faded)
      s.targets = s.targets.filter(t => !(t.hitAt > 0 && now - t.hitAt > 800));

      // Draw targets
      for (const t of s.targets) {
        const isHit = t.hitAt > 0;
        const hitAge = isHit ? (now - t.hitAt) / 800 : 0;
        const alpha = isHit ? Math.max(0, 1 - hitAge) : 1;
        const scale = isHit ? 1 + hitAge * 1.5 : 1;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(t.x, t.y);
        ctx.scale(scale, scale);
        // Outer ring
        ctx.strokeStyle = isHit ? '#4ade80' : '#22d3ee';
        ctx.lineWidth = 2;
        ctx.shadowBlur = isHit ? 20 : 8;
        ctx.shadowColor = isHit ? '#4ade80' : '#22d3ee88';
        ctx.beginPath();
        ctx.arc(0, 0, t.r, 0, Math.PI * 2);
        ctx.stroke();
        // Inner fill
        ctx.fillStyle = isHit ? 'rgba(74,222,128,0.3)' : 'rgba(34,211,238,0.15)';
        ctx.fill();
        // Center dot
        ctx.fillStyle = isHit ? '#4ade80' : '#22d3ee';
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Draw ripples
      for (let i = s.ripples.length - 1; i >= 0; i--) {
        const rp = s.ripples[i];
        rp.r += 3.5;
        rp.alpha -= 0.04;
        if (rp.alpha <= 0) { s.ripples.splice(i, 1); continue; }
        ctx.save();
        ctx.strokeStyle = `rgba(74,222,128,${rp.alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Score flash
      if (s.scoreFlash > 0 && now - s.scoreFlash < 300) {
        const fa = (1 - (now - s.scoreFlash) / 300) * 0.2;
        ctx.fillStyle = `rgba(34,211,238,${fa})`;
        ctx.fillRect(0, 0, W2, H2);
      }

      // Volume mic bar
      const bW = 70, bH = 5;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(W2 / 2 - bW / 2, H2 - 16, bW, bH);
      ctx.fillStyle = `rgba(34,211,238,${0.4 + vol * 0.6})`;
      ctx.fillRect(W2 / 2 - bW / 2, H2 - 16, bW * Math.min(1, vol * 1.5), bH);

      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [getVolume, endGame, spawnTargets]);

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
      analyser.smoothingTimeConstant = 0.35;
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

  // suppress unused import warnings
  void haptic;
  void startMusic;

  return (
    <GameShell
      title={GAME_TITLE}
      emoji={GAME_EMOJI}
      accentColor={accent}
      theme={theme}
      background="radial-gradient(ellipse at 50% 50%, #001a28 0%, #000c14 60%, #000 100%)"
    >
      <canvas
        ref={canvasRef}
        style={{ display: phase === 'playing' ? 'block' : 'none', position: 'absolute', top: 0, left: 0, touchAction: 'none' }}
        role="img"
        aria-label="Sound Waves game canvas — shout to fire waves"
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
              description={GAME_TAGLINE + ' Your voice creates expanding wave rings — hit the glowing targets to score.'}
              sensorNote="🎤 Uses microphone"
              ctaLabel="Allow Mic & Shout →"
              accentColor={accent}
              onStart={handleStart}
              gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #001a28 0%, #000c14 55%, #000 100%)"
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
                { label: 'Targets hit', value: String(finalSig.targetsDestroyed), color: '#22d3ee' },
                { label: 'Peak volume', value: `${Math.round(finalSig.peakVolume * 100)}%`, color: '#a78bfa' },
                { label: 'Waves fired', value: String(finalSig.wavesFired), color: '#4ade80' },
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
