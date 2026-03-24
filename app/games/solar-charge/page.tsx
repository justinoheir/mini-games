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

const GAME_ID      = 'solar-charge';
const ACCENT       = '#facc15';
const DURATION     = 45;
const GAME_EMOJI   = '☀️';
const GAME_TITLE   = 'Solar Charge';
const GAME_TAGLINE = 'Stay silent to charge the solar panel. Noise drains it!';
const MIC_THRESHOLD = 0.05;
const CHARGE_RATE  = 1.2;
const DISCHARGE_RATE = 3.0;
const TARGET_CHARGE = 100;

interface Signals {
  maxCharge: number;
  timesFullyCharged: number;
  totalSilentFrames: number;
  totalNoisyFrames: number;
  score: number;
  longestSilentStreak: number;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  chargeLevel: number;
  micLevel: number;
  isCharging: boolean;
  accentColor: string;
  rayAngle: number;
  silentStreak: number;
  scoreFlash: number;
  rays: Array<{angle:number;len:number;alpha:number}>;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  if (sig.timesFullyCharged >= 3 && sig.totalNoisyFrames < 100) return 'Zen Master ☮️';
  if (sig.timesFullyCharged >= 2) return 'Power Harvester ⚡';
  if (sig.longestSilentStreak >= 180) return 'Silent Storm 🌟';
  if (sig.maxCharge >= 75) return 'Almost There 🔋';
  return 'Noisy Neighbour 📢';
}

export default function SolarChargeGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const micRef = useRef<{ stream: MediaStream; analyser: AnalyserNode; data: Uint8Array } | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { maxCharge: 0, timesFullyCharged: 0, totalSilentFrames: 0, totalNoisyFrames: 0,
           score: 0, longestSilentStreak: 0 },
    chargeLevel: 0, micLevel: 0, isCharging: false,
    accentColor: ACCENT, rayAngle: 0, silentStreak: 0,
    scoreFlash: 0, rays: [],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [chargeDisplay, setChargeDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('☀️');
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (micRef.current) { micRef.current.stream.getTracks().forEach(t => t.stop()); micRef.current = null; }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const startLoop = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ac = new AudioContext();
      const analyser = ac.createAnalyser();
      analyser.fftSize = 256;
      ac.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      micRef.current = { stream, analyser, data };
    } catch { /* tap fallback */ }

    s.running = true; s.timeLeft = DURATION;
    s.sig = { maxCharge: 0, timesFullyCharged: 0, totalSilentFrames: 0,
              totalNoisyFrames: 0, score: 0, longestSilentStreak: 0 };
    s.chargeLevel = 0; s.silentStreak = 0; s.scoreFlash = 0;
    s.rays = Array.from({ length: 12 }, (_, i) => ({ angle: (i / 12) * Math.PI * 2, len: 30, alpha: 0.6 }));
    setScoreDisplay(0); setChargeDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('chill');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width; const H = canvas.height;

      // Read mic
      let loud = false;
      if (micRef.current) {
        const { analyser, data } = micRef.current;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += Math.abs(v - 128);
        s.micLevel = sum / data.length / 128;
        loud = s.micLevel > MIC_THRESHOLD;
      }

      // Charge logic
      if (loud) {
        s.chargeLevel = Math.max(0, s.chargeLevel - DISCHARGE_RATE);
        s.sig.totalNoisyFrames++;
        s.silentStreak = 0;
        if (s.chargeLevel < (s.sig.maxCharge - 10) && s.sig.maxCharge > 50) {
          sfx.collision();
        }
      } else {
        s.chargeLevel = Math.min(TARGET_CHARGE, s.chargeLevel + CHARGE_RATE);
        s.sig.totalSilentFrames++;
        s.silentStreak++;
        if (s.silentStreak > s.sig.longestSilentStreak) s.sig.longestSilentStreak = s.silentStreak;
      }
      if (s.chargeLevel > s.sig.maxCharge) s.sig.maxCharge = s.chargeLevel;

      // Full charge score
      if (s.chargeLevel >= TARGET_CHARGE && s.scoreFlash === 0) {
        s.sig.timesFullyCharged++;
        s.sig.score += 10;
        setScoreDisplay(s.sig.score);
        s.scoreFlash = 60;
        sfx.collect(); haptic([50, 30, 50]);
        s.chargeLevel = 40; // reset for next charge
      }
      if (s.scoreFlash > 0) s.scoreFlash--;
      setChargeDisplay(Math.round(s.chargeLevel));

      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, W, H);

      // Sky gradient
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.7);
      skyGrad.addColorStop(0, loud ? '#1a0a0a' : '#0d1b2a');
      skyGrad.addColorStop(1, '#0d1117');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H * 0.7);

      const cx = W / 2; const cy = H * 0.32;

      // Sun rays
      s.rayAngle += 0.005;
      const glowColor = loud ? '#ef444466' : `${ACCENT}${Math.floor(s.chargeLevel * 2).toString(16).padStart(2,'0')}`;
      ctx.save();
      ctx.strokeStyle = ACCENT;
      for (const ray of s.rays) {
        const angle = ray.angle + s.rayAngle;
        const rayLen = ray.len + s.chargeLevel * 0.8;
        const innerR = 45;
        ctx.globalAlpha = ray.alpha * (s.chargeLevel / 100) * 0.8;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 8; ctx.shadowColor = ACCENT;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
        ctx.lineTo(cx + Math.cos(angle) * rayLen, cy + Math.sin(angle) * rayLen);
        ctx.stroke();
      }
      ctx.restore();

      // Sun disc
      ctx.save();
      ctx.shadowBlur = 30 + s.chargeLevel * 0.3;
      ctx.shadowColor = loud ? '#ef4444' : ACCENT;
      const sunGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 45);
      sunGrad.addColorStop(0, loud ? '#ef4444' : '#fff7d6');
      sunGrad.addColorStop(1, loud ? '#7f1d1d' : ACCENT);
      ctx.fillStyle = sunGrad;
      ctx.beginPath(); ctx.arc(cx, cy, 45, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Solar panel
      const panelW = Math.min(W * 0.5, 180);
      const panelH = 90;
      const panelX = cx - panelW / 2;
      const panelY = H * 0.55;

      ctx.fillStyle = '#1e293b';
      ctx.fillRect(panelX, panelY, panelW, panelH);

      // Panel fill
      const fillH = (panelH * s.chargeLevel) / 100;
      const fillGrad = ctx.createLinearGradient(0, panelY + panelH - fillH, 0, panelY + panelH);
      fillGrad.addColorStop(0, ACCENT + '88');
      fillGrad.addColorStop(1, ACCENT);
      ctx.fillStyle = fillGrad;
      ctx.fillRect(panelX, panelY + panelH - fillH, panelW, fillH);

      // Panel grid
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(panelX + (panelW / 4) * i, panelY);
        ctx.lineTo(panelX + (panelW / 4) * i, panelY + panelH); ctx.stroke();
      }
      for (let i = 1; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(panelX, panelY + (panelH / 3) * i);
        ctx.lineTo(panelX + panelW, panelY + (panelH / 3) * i); ctx.stroke();
      }
      ctx.strokeStyle = ACCENT + '88'; ctx.lineWidth = 2;
      ctx.strokeRect(panelX, panelY, panelW, panelH);

      // Charge text
      ctx.fillStyle = s.scoreFlash > 0 ? '#4ade80' : '#fff';
      ctx.font = `bold ${s.scoreFlash > 0 ? 22 : 18}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(s.scoreFlash > 0 ? 'CHARGED! +10' : `${Math.round(s.chargeLevel)}%`, cx, panelY + panelH + 20);

      // Mic indicator
      ctx.fillStyle = loud ? '#ef4444' : '#4ade80';
      ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(loud ? '🔊 Too Loud!' : '🤫 Keep Quiet', cx, H * 0.88);

      // Mic bar
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(cx - 60, H * 0.92, 120, 8);
      ctx.fillStyle = loud ? '#ef4444' : '#4ade80';
      ctx.fillRect(cx - 60, H * 0.92, Math.min(120, s.micLevel * 800), 8);

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  // Touch fallback: tap to simulate clap disruption toggle
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
      if (micRef.current) micRef.current.stream.getTracks().forEach(t => t.stop());
    };
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    setPlayerName(name); setPlayerAvatar(avatar);
    initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setChargeDisplay(0);
  }, []);

  const buildInsights = (sig: Signals) => {
    const silentPct = (sig.totalSilentFrames + sig.totalNoisyFrames) > 0
      ? Math.round((sig.totalSilentFrames / (sig.totalSilentFrames + sig.totalNoisyFrames)) * 100) : 0;
    return [
      { label: 'Times Charged',   value: `${sig.timesFullyCharged}×`, color: sig.timesFullyCharged >= 2 ? '#4ade80' : '#facc15' },
      { label: 'Silence Rate',    value: `${silentPct}%`,             color: silentPct >= 70 ? '#4ade80' : '#ef4444' },
      { label: 'Peak Charge',     value: `${Math.round(sig.maxCharge)}%`, color: ACCENT },
      { label: 'Quiet Streak',    value: `${Math.round(sig.longestSilentStreak / 60)}s`, color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Allow Mic & Soak" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} role="img" aria-label="Solar charge silence game"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME', value: timeLeft, danger: timeLeft <= 5 },
              { label: 'SCORE', value: scoreDisplay },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain} didWin={finalSig.timesFullyCharged >= 1} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig}
          personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, gameId, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>; gameId: string; sig: Signals; personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    const silentPct = (sig.totalSilentFrames + sig.totalNoisyFrames) > 0
      ? sig.totalSilentFrames / (sig.totalSilentFrames + sig.totalNoisyFrames) : 0;
    postWebhook(theme, gameId, { personality, score: sig.score, timesFullyCharged: sig.timesFullyCharged,
      silenceRate: parseFloat(silentPct.toFixed(3)), maxCharge: Math.round(sig.maxCharge),
      longestQuietStreak: Math.round(sig.longestSilentStreak / 60) }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
