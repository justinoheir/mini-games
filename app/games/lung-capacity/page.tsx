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

const GAME_ID = 'lung-capacity';
const ACCENT = '#4ade80';
const DURATION = 45;
const GAME_EMOJI = '🫁';
const GAME_TITLE = 'Lung Capacity';
const GAME_TAGLINE = 'Hold steady. Fill the lungs. Don\'t burst.';
const PB_KEY = 'mg_pb_lung-capacity';

// Target zone: volume must stay in [LOW, HIGH] to fill lungs
const ZONE_LOW = 0.22;
const ZONE_HIGH = 0.58;

interface Signals {
  score: number;
  maxFill: number;
  steadySeconds: number;
  overBreaths: number;
  underBreaths: number;
}

function getPersonality(sig: Signals): string {
  if (sig.maxFill >= 90 && sig.steadySeconds >= 25) return 'Iron Lungs 🫁';
  if (sig.maxFill >= 75 && sig.overBreaths <= 3) return 'Breath Master 🧘';
  if (sig.steadySeconds >= 28) return 'Zen Breather 🌬️';
  if (sig.overBreaths > 8) return 'Overdrive 🔥';
  return 'Learning Lungs 🌱';
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

export default function LungCapacity() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef({
    running: false,
    timeLeft: DURATION,
    fill: 0,          // 0-100 lung fill %
    maxFill: 0,
    steadyFrames: 0,
    overBreaths: 0,
    underBreaths: 0,
    wasIn: false,
    analyser: null as AnalyserNode | null,
    audioCtx: null as AudioContext | null,
    stream: null as MediaStream | null,
    animId: 0,
    timerIntervalId: null as ReturnType<typeof setInterval> | null,
    lastHapticScore: 0,
    lastHapticFail: 0,
    breathCycle: 0,   // for lung animation
    flashGreen: 0,
    flashRed: 0,
    milestone: 0,     // last milestone fired (25, 50, 75)
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [displayFill, setDisplayFill] = useState(0);
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
      score: Math.round(s.maxFill),
      maxFill: Math.round(s.maxFill),
      steadySeconds: Math.round(s.steadyFrames / 60),
      overBreaths: s.overBreaths,
      underBreaths: s.underBreaths,
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
    s.fill = 0;
    s.maxFill = 0;
    s.steadyFrames = 0;
    s.overBreaths = 0;
    s.underBreaths = 0;
    s.wasIn = false;
    s.lastHapticScore = 0;
    s.lastHapticFail = 0;
    s.breathCycle = 0;
    s.flashGreen = 0;
    s.flashRed = 0;
    s.milestone = 0;
    setDisplayFill(0);
    setTimeLeft(DURATION);
    setIsNewBest(false);
    setPhase('playing');
    stopMusicRef.current = startMusic('calm');

    s.timerIntervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      setDisplayFill(Math.round(s.fill));
      sfx.tick();
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = window.innerWidth;
      const H = window.innerHeight;
      const vol = getVolume();
      const now = Date.now();

      // Zone logic
      const inZone = vol >= ZONE_LOW && vol <= ZONE_HIGH;
      const overZone = vol > ZONE_HIGH;

      if (inZone) {
        s.steadyFrames++;
        s.fill = Math.min(100, s.fill + 0.28);
        if (!s.wasIn) {
          s.flashGreen = now;
          if (now - s.lastHapticScore > 600) { hapticScore(); s.lastHapticScore = now; }
        }
        s.wasIn = true;
      } else if (overZone) {
        s.fill = Math.max(0, s.fill - 0.18);
        if (s.wasIn) {
          s.overBreaths++;
          s.flashRed = now;
          if (now - s.lastHapticFail > 800) { hapticFail(); s.lastHapticFail = now; }
        }
        s.wasIn = false;
      } else {
        s.fill = Math.max(0, s.fill - 0.1);
        if (s.wasIn) s.underBreaths++;
        s.wasIn = false;
      }

      if (s.fill > s.maxFill) s.maxFill = s.fill;
      s.breathCycle += 0.04;

      // Milestone haptics
      const fillInt = Math.floor(s.fill / 25) * 25;
      if (fillInt > s.milestone && fillInt > 0) {
        s.milestone = fillInt;
        sfx.collect();
        hapticScore();
      }

      // Background
      const bgA = s.fill / 100;
      const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.8);
      bg.addColorStop(0, `rgba(0,${Math.round(20 + bgA * 40)},${Math.round(10 + bgA * 20)},1)`);
      bg.addColorStop(1, '#000805');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Lung shape (left + right lobes)
      const lungCX = W / 2;
      const lungCY = H * 0.48;
      const fillFrac = s.fill / 100;
      const breathBulge = Math.sin(s.breathCycle) * (inZone ? 4 : 1) * fillFrac;
      const lW = 60 + fillFrac * 50 + breathBulge;
      const lH = 90 + fillFrac * 60 + breathBulge * 1.2;

      // Lung glow
      ctx.save();
      ctx.shadowBlur = 20 + fillFrac * 40;
      ctx.shadowColor = inZone ? '#4ade80' : (overZone ? '#ef4444' : '#666');

      // Left lobe
      const lAlpha = 0.15 + fillFrac * 0.55;
      ctx.fillStyle = inZone
        ? `rgba(74,222,128,${lAlpha})`
        : overZone
          ? `rgba(239,68,68,${lAlpha})`
          : `rgba(100,120,100,${lAlpha})`;
      ctx.beginPath();
      ctx.ellipse(lungCX - lW * 0.55, lungCY, lW * 0.5, lH, -0.15, 0, Math.PI * 2);
      ctx.fill();

      // Right lobe
      ctx.beginPath();
      ctx.ellipse(lungCX + lW * 0.55, lungCY, lW * 0.5, lH, 0.15, 0, Math.PI * 2);
      ctx.fill();

      // Trachea
      ctx.strokeStyle = inZone ? 'rgba(74,222,128,0.6)' : 'rgba(200,200,200,0.3)';
      ctx.lineWidth = 8 + fillFrac * 4;
      ctx.lineCap = 'round';
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(lungCX, lungCY - lH * 0.9);
      ctx.lineTo(lungCX, lungCY - lH * 0.9 - 40);
      ctx.stroke();

      // Branching bronchi
      ctx.lineWidth = 4 + fillFrac * 3;
      ctx.beginPath();
      ctx.moveTo(lungCX, lungCY - lH * 0.9);
      ctx.lineTo(lungCX - lW * 0.5, lungCY - lH * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(lungCX, lungCY - lH * 0.9);
      ctx.lineTo(lungCX + lW * 0.5, lungCY - lH * 0.7);
      ctx.stroke();

      ctx.restore();

      // Volume meter (right side)
      const mX = W - 44;
      const mH = H * 0.55;
      const mY = (H - mH) / 2;
      const mW = 20;

      // Track
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(mX, mY, mW, mH, 6) : ctx.rect(mX, mY, mW, mH);
      ctx.fill();

      // Zone band (target area)
      const zoneYTop = mY + mH * (1 - ZONE_HIGH);
      const zoneYBot = mY + mH * (1 - ZONE_LOW);
      ctx.fillStyle = 'rgba(74,222,128,0.18)';
      ctx.fillRect(mX, zoneYTop, mW, zoneYBot - zoneYTop);
      // Zone borders
      ctx.strokeStyle = 'rgba(74,222,128,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(mX - 4, zoneYTop);
      ctx.lineTo(mX + mW + 4, zoneYTop);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mX - 4, zoneYBot);
      ctx.lineTo(mX + mW + 4, zoneYBot);
      ctx.stroke();
      ctx.setLineDash([]);

      // Volume fill
      const volFillH = mH * Math.min(1, vol);
      const volColor = overZone ? '#ef4444' : (inZone ? '#4ade80' : '#64748b');
      ctx.fillStyle = volColor;
      ctx.shadowBlur = inZone ? 10 : 0;
      ctx.shadowColor = '#4ade80';
      ctx.fillRect(mX + 2, mY + mH - volFillH, mW - 4, volFillH);
      ctx.shadowBlur = 0;

      // Lung fill bar (bottom)
      const fillBarW = W * 0.65;
      const fillBarX = (W - fillBarW) / 2;
      const fillBarY = H - 52;
      const fillBarH = 12;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(fillBarX, fillBarY, fillBarW, fillBarH, 6) : ctx.rect(fillBarX, fillBarY, fillBarW, fillBarH);
      ctx.fill();
      if (s.fill > 0) {
        const fillGrad = ctx.createLinearGradient(fillBarX, 0, fillBarX + fillBarW, 0);
        fillGrad.addColorStop(0, '#22c55e');
        fillGrad.addColorStop(1, '#4ade80');
        ctx.fillStyle = fillGrad;
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#4ade80';
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(fillBarX, fillBarY, fillBarW * (s.fill / 100), fillBarH, 6) : ctx.rect(fillBarX, fillBarY, fillBarW * (s.fill / 100), fillBarH);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Fill % text
      ctx.fillStyle = inZone ? '#4ade80' : 'rgba(255,255,255,0.6)';
      ctx.font = `700 14px "Space Grotesk", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(s.fill)}%`, W / 2, fillBarY + fillBarH + 20);
      ctx.textAlign = 'left';

      // Zone label
      ctx.fillStyle = inZone ? '#4ade80' : (overZone ? '#ef4444' : 'rgba(255,255,255,0.35)');
      ctx.font = `700 13px "Space Grotesk", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(inZone ? '✓ IN ZONE' : (overZone ? '↑ TOO LOUD' : '↓ BREATHE MORE'), W / 2, H - 12);
      ctx.textAlign = 'left';

      // Flashes
      if (now - s.flashGreen < 350) {
        ctx.fillStyle = `rgba(74,222,128,${0.12 * (1 - (now - s.flashGreen) / 350)})`;
        ctx.fillRect(0, 0, W, H);
      }
      if (now - s.flashRed < 350) {
        ctx.fillStyle = `rgba(239,68,68,${0.12 * (1 - (now - s.flashRed) / 350)})`;
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
      analyser.smoothingTimeConstant = 0.5;
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
      background="radial-gradient(ellipse at 50% 50%, #001a10 0%, #000c08 60%, #000 100%)"
    >
      <canvas
        ref={canvasRef}
        style={{ display: phase === 'playing' ? 'block' : 'none', position: 'absolute', top: 0, left: 0, touchAction: 'none' }}
        role="img"
        aria-label="Lung Capacity game canvas — breathe steadily to fill lungs"
      />

      {phase === 'playing' && (
        <GameHUD
          accentColor={accent}
          items={[
            { label: 'FILL', value: `${displayFill}%`, testId: 'score' },
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
              description={GAME_TAGLINE + ' Breathe steadily into the green zone on the meter to fill your lungs. Too loud or too quiet and the lungs drain.'}
              sensorNote="🎤 Uses microphone"
              ctaLabel="Allow Mic & Breathe →"
              accentColor={accent}
              onStart={handleStart}
              gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #001a10 0%, #000c08 55%, #000 100%)"
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
              score={`${finalSig.score}%`}
              personality={getPersonality(finalSig)}
              insights={[
                { label: 'Max fill', value: `${finalSig.maxFill}%`, color: '#4ade80' },
                { label: 'Steady time', value: `${finalSig.steadySeconds}s`, color: '#22d3ee' },
                { label: 'Over-breaths', value: String(finalSig.overBreaths), color: '#ef4444' },
              ]}
              accentColor={accent}
              onPlayAgain={handlePlayAgain}
              didWin={finalSig.maxFill >= 60}
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
