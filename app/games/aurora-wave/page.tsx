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

const GAME_ID      = 'aurora-wave';
const ACCENT       = '#34d399';
const DURATION     = 60;
const GAME_EMOJI   = '🌌';
const GAME_TITLE   = 'Aurora Wave';
const GAME_TAGLINE = 'Breathe slowly to paint aurora waves. Erratic = broken!';
const SMOOTH_THRESHOLD = 0.08;
const ERRATIC_THRESHOLD = 0.18;

interface Signals {
  auroraSegments: number;
  brokenWaves: number;
  longestCalmBreath: number;
  avgBreathVariance: number;
  score: number;
  maxColor: number;
}

interface WavePoint { x: number; y: number; color: string; }
interface AuroraWave { points: WavePoint[]; alpha: number; color: string; }

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  micLevel: number;
  prevMicLevel: number;
  wavePhase: number;
  waveX: number;
  calmStreak: number;
  waves: AuroraWave[];
  currentWave: AuroraWave | null;
  colorHue: number;
  breathVariances: number[];
  accentColor: string;
  breakFlash: number;
  stars: Array<{x:number;y:number;brightness:number;twinkle:number}>;
}

const AURORA_COLORS = ['#34d399','#6ee7b7','#a7f3d0','#67e8f9','#a5f3fc','#c4b5fd','#f0abfc'];
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  if (sig.auroraSegments >= 40 && sig.brokenWaves <= 2) return 'Aurora Sage 🌟';
  if (sig.brokenWaves === 0 && sig.auroraSegments >= 20) return 'Serene Breather 🌿';
  if (sig.auroraSegments >= 30) return 'Wave Painter 🎨';
  if (sig.longestCalmBreath >= 5) return 'Deep Calm 🧘';
  return 'Turbulent Spirit 🌪️';
}

export default function AuroraWaveGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const micRef = useRef<{ stream: MediaStream; analyser: AnalyserNode; data: Uint8Array } | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { auroraSegments: 0, brokenWaves: 0, longestCalmBreath: 0, avgBreathVariance: 0, score: 0, maxColor: 0 },
    micLevel: 0, prevMicLevel: 0, wavePhase: 0, waveX: 0, calmStreak: 0,
    waves: [], currentWave: null, colorHue: 160,
    breathVariances: [], accentColor: ACCENT, breakFlash: 0,
    stars: [],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🌌');
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (micRef.current) { micRef.current.stream.getTracks().forEach(t => t.stop()); micRef.current = null; }
    const avgVar = s.breathVariances.length > 0
      ? s.breathVariances.reduce((a, b) => a + b, 0) / s.breathVariances.length : 0;
    s.sig.avgBreathVariance = avgVar;
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
      analyser.fftSize = 512;
      ac.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      micRef.current = { stream, analyser, data };
    } catch { /* no mic — use simulated breath */ }

    s.running = true; s.timeLeft = DURATION;
    s.sig = { auroraSegments: 0, brokenWaves: 0, longestCalmBreath: 0, avgBreathVariance: 0, score: 0, maxColor: 0 };
    s.micLevel = 0; s.prevMicLevel = 0; s.wavePhase = 0; s.waveX = 0;
    s.calmStreak = 0; s.waves = []; s.currentWave = null; s.colorHue = 160;
    s.breathVariances = []; s.breakFlash = 0;

    // Generate stars
    s.stars = Array.from({ length: 80 }, () => ({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height * 0.4,
      brightness: 0.3 + Math.random() * 0.7, twinkle: Math.random() * Math.PI * 2,
    }));

    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
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
      let breathLevel = s.micLevel;
      if (micRef.current) {
        const { analyser, data } = micRef.current;
        analyser.getByteTimeDomainData(data as Uint8Array<ArrayBuffer>);
        let sum = 0;
        for (const v of data) sum += Math.abs(v - 128);
        breathLevel = sum / data.length / 128;
        breathLevel = s.micLevel * 0.7 + breathLevel * 0.3; // smooth
        s.micLevel = breathLevel;
      } else {
        // Simulated breath for no-mic fallback
        s.micLevel = 0.06 + Math.sin(Date.now() / 2000) * 0.04;
        breathLevel = s.micLevel;
      }

      const variance = Math.abs(breathLevel - s.prevMicLevel);
      s.breathVariances.push(variance);
      if (s.breathVariances.length > 300) s.breathVariances.shift();
      s.prevMicLevel = breathLevel;

      const isCalm = breathLevel > 0.02 && breathLevel < SMOOTH_THRESHOLD;
      const isErratic = variance > ERRATIC_THRESHOLD;

      // Night sky
      ctx.fillStyle = '#040820';
      ctx.fillRect(0, 0, W, H);

      // Stars
      for (const star of s.stars) {
        star.twinkle += 0.03;
        const alpha = star.brightness * (0.7 + Math.sin(star.twinkle) * 0.3);
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(star.x, star.y, 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      // Mountains silhouette
      ctx.fillStyle = '#0a1628';
      ctx.beginPath(); ctx.moveTo(0, H * 0.65);
      for (let mx = 0; mx <= W; mx += 20) {
        const my = H * 0.55 + Math.sin(mx * 0.02) * 40 + Math.sin(mx * 0.007) * 60;
        ctx.lineTo(mx, my);
      }
      ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();

      // Wave progression
      s.wavePhase += 0.02;
      if (isCalm) {
        s.calmStreak++;
        s.waveX += 1.5;
        s.colorHue = (s.colorHue + 0.3) % 360;
        if (s.calmStreak > s.sig.longestCalmBreath * 60) {
          s.sig.longestCalmBreath = s.calmStreak / 60;
        }

        // Start or continue wave
        if (!s.currentWave) {
          const hue = s.colorHue;
          s.currentWave = { points: [], alpha: 0.85, color: `hsl(${hue}, 80%, 65%)` };
        }
        if (s.currentWave) {
          const waveY = H * 0.4 + Math.sin(s.wavePhase + s.waveX * 0.01) * 40 * breathLevel * 8;
          s.currentWave.points.push({ x: s.waveX, y: waveY, color: s.currentWave.color });
          s.sig.auroraSegments++;
          if (s.sig.auroraSegments % 30 === 0) {
            s.sig.score++;
            setScoreDisplay(s.sig.score);
            sfx.collect();
          }
        }
      } else if (isErratic) {
        s.calmStreak = 0;
        s.breakFlash = 15;
        if (s.currentWave && s.currentWave.points.length > 10) {
          s.waves.push({ ...s.currentWave });
          s.sig.brokenWaves++;
          sfx.collision(); haptic([20, 30, 20]);
        }
        s.currentWave = null;
        s.waveX = 0;
      } else {
        s.calmStreak = Math.max(0, s.calmStreak - 1);
      }

      if (s.waveX > W) {
        // Wave completed full screen — score big!
        if (s.currentWave) {
          s.waves.push({ ...s.currentWave });
          s.sig.score += 5;
          setScoreDisplay(s.sig.score);
          sfx.collect(); haptic([50, 30, 50]);
        }
        s.currentWave = null; s.waveX = 0;
      }

      // Keep only last 5 waves
      if (s.waves.length > 5) s.waves.shift();

      // Draw completed waves
      for (const wave of s.waves) {
        if (wave.points.length < 2) continue;
        ctx.save(); ctx.globalAlpha = wave.alpha * 0.4;
        ctx.strokeStyle = wave.color; ctx.lineWidth = 3;
        ctx.shadowBlur = 15; ctx.shadowColor = wave.color;
        ctx.beginPath();
        ctx.moveTo(wave.points[0].x, wave.points[0].y);
        for (let i = 1; i < wave.points.length; i++) {
          ctx.lineTo(wave.points[i].x, wave.points[i].y);
        }
        ctx.stroke();
        wave.alpha -= 0.002;
        ctx.restore();
      }

      // Draw current wave
      if (s.currentWave && s.currentWave.points.length > 1) {
        const pts = s.currentWave.points;
        ctx.save();
        // Aurora glow layers
        for (let layer = 3; layer >= 0; layer--) {
          ctx.globalAlpha = 0.15 + layer * 0.1;
          ctx.strokeStyle = s.currentWave.color;
          ctx.lineWidth = 4 + layer * 3;
          ctx.shadowBlur = 20 + layer * 10; ctx.shadowColor = s.currentWave.color;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Break flash
      if (s.breakFlash > 0) {
        s.breakFlash--;
        ctx.save(); ctx.globalAlpha = s.breakFlash / 15 * 0.3;
        ctx.fillStyle = '#ef4444'; ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }

      // Breath guide
      const breathBarH = 50;
      const breathBarY = H - breathBarH - 10;
      ctx.fillStyle = '#1e293b44'; ctx.fillRect(10, breathBarY, W - 20, breathBarH);
      // Calm zone
      ctx.fillStyle = '#4ade8033';
      const calmStart = SMOOTH_THRESHOLD * 5 * (W - 20) / 1;
      ctx.fillRect(10, breathBarY, calmStart, breathBarH);
      // Current level
      ctx.fillStyle = isErratic ? '#ef4444' : isCalm ? '#4ade80' : ACCENT;
      ctx.fillRect(10, breathBarY, Math.min(W - 20, breathLevel * (W - 20) * 5), breathBarH);
      ctx.strokeStyle = '#fff4'; ctx.lineWidth = 1;
      ctx.strokeRect(10, breathBarY, W - 20, breathBarH);
      ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(isCalm ? '🌬️ Perfect breath' : isErratic ? '💨 Too erratic!' : '🫁 Breathe gently', W / 2, breathBarY + breathBarH / 2 + 4);

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;
      stateRef.current.waveX = 0;
    };
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
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const buildInsights = (sig: Signals) => [
    { label: 'Aurora Segments', value: `${sig.auroraSegments}`, color: sig.auroraSegments >= 30 ? '#4ade80' : '#facc15' },
    { label: 'Broken Waves',    value: `${sig.brokenWaves}`,     color: sig.brokenWaves === 0 ? '#4ade80' : '#ef4444' },
    { label: 'Calm Streak',     value: `${Math.round(sig.longestCalmBreath)}s`, color: ACCENT },
    { label: 'Breath Control',  value: sig.avgBreathVariance < 0.05 ? 'Excellent' : sig.avgBreathVariance < 0.1 ? 'Good' : 'Erratic',
      color: sig.avgBreathVariance < 0.05 ? '#4ade80' : sig.avgBreathVariance < 0.1 ? '#facc15' : '#ef4444' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Allow Mic & Begin" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} role="img" aria-label="Aurora wave breathing game"
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
          onPlayAgain={handlePlayAgain} didWin={finalSig.auroraSegments >= 20} />
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
    postWebhook(theme, gameId, { personality, score: sig.score, auroraSegments: sig.auroraSegments,
      brokenWaves: sig.brokenWaves, longestCalmBreath: Math.round(sig.longestCalmBreath),
      avgBreathVariance: parseFloat(sig.avgBreathVariance.toFixed(4)) }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}


