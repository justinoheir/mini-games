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

const GAME_ID      = 'signal-boost';
const ACCENT       = '#f59e0b';
const DURATION     = 45;
const GAME_EMOJI   = '📡';
const GAME_TITLE   = 'Signal Boost';
const GAME_TAGLINE = 'Hum steadily to keep the signal alive — too quiet or too loud drops the tower.';

interface Signals {
  timeInZone: number;     // seconds in green zone
  maxConsecutive: number; // max consecutive seconds in zone
  totalDrops: number;     // times signal dropped
  avgVolume: number;
  score: number;
}

function getPersonality(sig: Signals): string {
  const ratio = sig.timeInZone / DURATION;
  if (ratio >= 0.85 && sig.totalDrops <= 1)  return 'Signal Master 📡';
  if (sig.maxConsecutive >= 20)               return 'Steady Carrier 📶';
  if (ratio >= 0.6)                           return 'Reliable Relay 🔄';
  if (sig.totalDrops >= 8)                    return 'Noisy Channel 📻';
  return 'Weak Signal 📵';
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  color: string;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  volume: number;        // 0-1 raw mic volume
  smoothVolume: number;  // smoothed
  inZone: boolean;
  consecutiveTicks: number;
  towerHealth: number;   // 0-1
  wavePhase: number;
  particles: Particle[];
  accentColor: string;
  analyser: AnalyserNode | null;
  micStream: MediaStream | null;
  dataArray: Uint8Array | null;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

const MIN_VOL = 0.15;
const MAX_VOL = 0.70;

export default function SignalBoostGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef<GameState>({
    running: false,
    timeLeft: DURATION,
    sig: { timeInZone: 0, maxConsecutive: 0, totalDrops: 0, avgVolume: 0, score: 0 },
    volume: 0,
    smoothVolume: 0,
    inZone: false,
    consecutiveTicks: 0,
    towerHealth: 1,
    wavePhase: 0,
    particles: [],
    accentColor: ACCENT,
    analyser: null,
    micStream: null,
    dataArray: null,
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('📡');
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const stopMic = useCallback(() => {
    const s = stateRef.current;
    if (s.micStream) { s.micStream.getTracks().forEach(t => t.stop()); s.micStream = null; }
    s.analyser = null;
    s.dataArray = null;
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    stopMic();
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, [stopMic]);

  const startLoop = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    s.running = true;
    s.timeLeft = DURATION;
    s.sig = { timeInZone: 0, maxConsecutive: 0, totalDrops: 0, avgVolume: 0, score: 0 };
    s.towerHealth = 1;
    s.wavePhase = 0;
    s.particles = [];
    s.consecutiveTicks = 0;
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

    // Setup mic
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.micStream = stream;
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      s.analyser = analyser;
      s.dataArray = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      // Mic denied — simulate with fallback
    }

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);

      if (s.inZone) {
        s.sig.timeInZone++;
        s.consecutiveTicks++;
        if (s.consecutiveTicks > s.sig.maxConsecutive) s.sig.maxConsecutive = s.consecutiveTicks;
        s.sig.score += 2;
        setScoreDisplay(s.sig.score);
        haptic([30]);
      } else {
        s.consecutiveTicks = 0;
        if (s.towerHealth < 0.3) { sfx.collision(); haptic([20, 30, 20]); }
      }

      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width;
      const H = canvas.height;

      // Read mic volume
      if (s.analyser && s.dataArray) {
        s.analyser.getByteFrequencyData(s.dataArray);
        let sum = 0;
        for (let i = 0; i < s.dataArray.length; i++) sum += s.dataArray[i];
        s.volume = sum / (s.dataArray.length * 255);
      }
      s.smoothVolume += (s.volume - s.smoothVolume) * 0.15;

      const vol = s.smoothVolume;
      s.inZone = vol >= MIN_VOL && vol <= MAX_VOL;

      // Tower health decay/recovery
      if (s.inZone) {
        s.towerHealth = Math.min(1, s.towerHealth + 0.008);
      } else if (vol < MIN_VOL * 0.5 || vol > MAX_VOL * 1.3) {
        const prev = s.towerHealth;
        s.towerHealth = Math.max(0, s.towerHealth - 0.012);
        if (Math.floor(prev * 10) > Math.floor(s.towerHealth * 10)) {
          s.sig.totalDrops++;
        }
      } else {
        s.towerHealth = Math.max(0, s.towerHealth - 0.004);
      }

      s.wavePhase += 0.05;

      // Background
      ctx.fillStyle = '#0d0800';
      ctx.fillRect(0, 0, W, H);

      // Ground
      ctx.fillStyle = '#1a1000';
      ctx.fillRect(0, H * 0.75, W, H * 0.25);

      // Signal waves emanating from tower
      const towerX = W / 2;
      const towerBaseY = H * 0.75;
      const towerH = H * 0.35;

      if (s.inZone) {
        for (let i = 1; i <= 4; i++) {
          const waveR = (W * 0.15) * i + (s.wavePhase * 20) % (W * 0.15);
          const waveAlpha = (1 - i / 5) * s.towerHealth * 0.6;
          ctx.beginPath();
          ctx.arc(towerX, towerBaseY - towerH, waveR, -Math.PI, 0);
          ctx.strokeStyle = `rgba(245,158,11,${waveAlpha})`;
          ctx.lineWidth = 2;
          ctx.shadowBlur = 10;
          ctx.shadowColor = ACCENT;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      // Tower structure
      const healthColor = s.towerHealth > 0.6 ? ACCENT : s.towerHealth > 0.3 ? '#fbbf24' : '#ef4444';
      ctx.fillStyle = healthColor;
      ctx.shadowBlur = s.inZone ? 20 : 5;
      ctx.shadowColor = healthColor;
      // Tower legs
      ctx.lineWidth = 4;
      ctx.strokeStyle = healthColor;
      ctx.beginPath();
      ctx.moveTo(towerX, towerBaseY - towerH);
      ctx.lineTo(towerX - 20, towerBaseY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(towerX, towerBaseY - towerH);
      ctx.lineTo(towerX + 20, towerBaseY);
      ctx.stroke();
      // Cross braces
      for (let y = 0.2; y < 1; y += 0.25) {
        const bY = towerBaseY - towerH + towerH * y;
        const bW = 20 * (1 - y * 0.6);
        ctx.beginPath();
        ctx.moveTo(towerX - bW, bY);
        ctx.lineTo(towerX + bW, bY);
        ctx.stroke();
      }
      // Antenna top
      ctx.beginPath();
      ctx.arc(towerX, towerBaseY - towerH, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Volume meter (left side)
      const meterX = 24;
      const meterH = H * 0.5;
      const meterY = H * 0.2;
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(meterX, meterY, 24, meterH);

      // Green zone indicator
      const greenTop = meterY + meterH * (1 - MAX_VOL);
      const greenBot = meterY + meterH * (1 - MIN_VOL);
      ctx.fillStyle = 'rgba(74,222,128,0.3)';
      ctx.fillRect(meterX, greenTop, 24, greenBot - greenTop);
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 1;
      ctx.strokeRect(meterX, greenTop, 24, greenBot - greenTop);

      // Volume bar
      const barH = meterH * vol;
      const barY = meterY + meterH - barH;
      const barColor = s.inZone ? '#4ade80' : vol < MIN_VOL ? '#ef4444' : '#f97316';
      ctx.fillStyle = barColor;
      ctx.fillRect(meterX + 2, barY, 20, barH);

      // Health bar (right side)
      const hBarX = W - 32;
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(hBarX, meterY, 16, meterH);
      ctx.fillStyle = healthColor;
      ctx.fillRect(hBarX + 2, meterY + meterH * (1 - s.towerHealth), 12, meterH * s.towerHealth);

      // Status text
      ctx.fillStyle = s.inZone ? '#4ade80' : '#ef4444';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(s.inZone ? 'SIGNAL STRONG' : vol < MIN_VOL ? 'HUM LOUDER' : 'TOO LOUD!', W / 2, H * 0.88);
      ctx.textAlign = 'left';

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, stopMic]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); };
  }, [phase]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
      stopMic();
    };
  }, [stopMic]);

  const handleStart = useCallback((name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    initAudio();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    setPhase('start');
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setFinalSig(null);
  }, []);

  const buildInsights = (sig: Signals) => {
    const ratio = Math.round((sig.timeInZone / DURATION) * 100);
    return [
      { label: 'In Zone',     value: `${ratio}%`,              color: ratio >= 70 ? '#4ade80' : '#facc15' },
      { label: 'Best Run',    value: `${sig.maxConsecutive}s`, color: ACCENT },
      { label: 'Drops',       value: `${sig.totalDrops}`,      color: sig.totalDrops <= 2 ? '#4ade80' : '#ef4444' },
      { label: 'Signal Time', value: `${sig.timeInZone}s`,     color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Allow Mic & Start"
          accentColor={theme.colors.accent ?? ACCENT}
          onStart={handleStart}
        />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Signal Boost game canvas" />
          {phase === 'playing' && (
            <GameHUD
              accentColor={theme.colors.accent ?? ACCENT}
              items={[
                { label: 'TIME',  value: timeLeft,      danger: timeLeft <= 10 },
                { label: 'SCORE', value: scoreDisplay },
              ]}
            />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen
          gameId={GAME_ID}
          title={getPersonality(finalSig)}
          emoji={GAME_EMOJI}
          score={String(finalSig.score)}
          personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)}
          accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain}
          didWin={finalSig.timeInZone >= 30}
        />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, gameId, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>;
  gameId: string;
  sig: Signals;
  personality: string;
  player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    postWebhook(theme, gameId, {
      personality,
      score: sig.score,
      timeInZone: sig.timeInZone,
      maxConsecutive: sig.maxConsecutive,
      totalDrops: sig.totalDrops,
    }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
