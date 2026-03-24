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

const GAME_ID      = 'paint-splash';
const ACCENT       = '#f43f5e';
const DURATION     = 45;
const GAME_EMOJI   = '🎨';
const GAME_TITLE   = 'Paint Splash';
const GAME_TAGLINE = 'Shake and tilt to splatter paint. Cover the canvas!';

const SPLASH_COLORS = ['#f43f5e','#f97316','#facc15','#4ade80','#22d3ee','#a855f7','#ec4899','#3b82f6'];

interface Signals {
  totalSplashes: number;
  coveragePercent: number;
  maxShakeIntensity: number;
  score: number;
  combo: number;
  maxCombo: number;
}

interface Splash {
  x: number; y: number; r: number; color: string; alpha: number; age: number;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  splashes: Splash[];
  coverageCanvas: HTMLCanvasElement | null;
  lastShakeTime: number;
  accentColor: string;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  if (sig.coveragePercent >= 75 && sig.totalSplashes >= 30) return 'Abstract Master 🎨';
  if (sig.maxShakeIntensity >= 15 && sig.totalSplashes >= 20) return 'Wild Shaker 🌪️';
  if (sig.coveragePercent >= 50) return 'Even Spreader 🖌️';
  if (sig.totalSplashes >= 25) return 'Rapid Tapper 💥';
  return 'Gentle Dabbler 🌸';
}

export default function PaintSplashGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const coverageRef = useRef<HTMLCanvasElement | null>(null);

  const stateRef = useRef<GameState>({
    running: false,
    timeLeft: DURATION,
    sig: { totalSplashes: 0, coveragePercent: 0, maxShakeIntensity: 0, score: 0, combo: 0, maxCombo: 0 },
    splashes: [],
    coverageCanvas: null,
    lastShakeTime: 0,
    accentColor: ACCENT,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎨');
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const computeCoverage = useCallback((canvas: HTMLCanvasElement): number => {
    const cv = coverageRef.current;
    if (!cv) return 0;
    const ctx = cv.getContext('2d');
    if (!ctx) return 0;
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let painted = 0;
    const total = cv.width * cv.height;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 10) painted++;
    }
    return Math.min(100, Math.round((painted / total) * 100));
  }, []);

  const addSplash = useCallback((x: number, y: number, intensity: number) => {
    const s = stateRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const numDrops = Math.floor(3 + intensity * 2);
    const color = SPLASH_COLORS[s.sig.totalSplashes % SPLASH_COLORS.length];

    // Draw onto coverage canvas
    const cv = coverageRef.current;
    if (cv) {
      const ctx = cv.getContext('2d');
      if (ctx) {
        for (let i = 0; i < numDrops; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * intensity * 8;
          const r = 8 + Math.random() * 20 + intensity * 3;
          ctx.beginPath();
          ctx.arc(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, r, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
      }
    }

    for (let i = 0; i < numDrops; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * intensity * 10;
      s.splashes.push({
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        r: 10 + Math.random() * 25 + intensity * 3,
        color,
        alpha: 0.85,
        age: 0,
      });
    }

    s.sig.totalSplashes++;
    s.sig.combo++;
    if (s.sig.combo > s.sig.maxCombo) s.sig.maxCombo = s.sig.combo;
    const pts = s.sig.combo >= 3 ? 3 : 1;
    s.sig.score += pts;
    setScoreDisplay(s.sig.score);
    sfx.collect();
    haptic([30]);
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    // Final coverage
    const canvas = canvasRef.current;
    if (canvas) s.sig.coveragePercent = computeCoverage(canvas);
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, [computeCoverage]);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    // Init coverage canvas
    const cv = document.createElement('canvas');
    cv.width = canvas.width;
    cv.height = canvas.height;
    coverageRef.current = cv;

    s.running = true;
    s.timeLeft = DURATION;
    s.sig = { totalSplashes: 0, coveragePercent: 0, maxShakeIntensity: 0, score: 0, combo: 0, maxCombo: 0 };
    s.splashes = [];
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('chill');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      // Update coverage periodically
      if (canvas) s.sig.coveragePercent = computeCoverage(canvas);
      s.sig.combo = 0; // reset combo each second if no new splash
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width;
      const H = canvas.height;

      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, W, H);

      // Draw coverage canvas
      const cv = coverageRef.current;
      if (cv) {
        ctx.globalAlpha = 0.9;
        ctx.drawImage(cv, 0, 0, W, H);
        ctx.globalAlpha = 1;
      }

      // Animate splashes (fade particles)
      s.splashes = s.splashes.filter(sp => sp.alpha > 0.05);
      for (const sp of s.splashes) {
        sp.age++;
        sp.alpha = Math.max(0, sp.alpha - 0.015);
        ctx.save();
        ctx.globalAlpha = sp.alpha;
        ctx.shadowBlur = 12;
        ctx.shadowColor = sp.color;
        ctx.fillStyle = sp.color;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Coverage indicator
      const cov = s.sig.coveragePercent;
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(W - 24, 60, 12, H - 80);
      ctx.fillStyle = ACCENT;
      const barH = ((H - 80) * cov) / 100;
      ctx.fillRect(W - 24, 60 + (H - 80) - barH, 12, barH);

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, computeCoverage]);

  // Motion / device shake detection
  useEffect(() => {
    if (phase !== 'playing') return;
    let lastX = 0, lastY = 0, lastZ = 0;
    const canvas = canvasRef.current;

    const onMotion = (e: DeviceMotionEvent) => {
      const s = stateRef.current;
      if (!s.running || !canvas) return;
      const ag = e.accelerationIncludingGravity;
      if (!ag) return;
      const dx = (ag.x ?? 0) - lastX;
      const dy = (ag.y ?? 0) - lastY;
      const dz = (ag.z ?? 0) - lastZ;
      lastX = ag.x ?? 0; lastY = ag.y ?? 0; lastZ = ag.z ?? 0;
      const intensity = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (intensity > 3) {
        if (intensity > s.sig.maxShakeIntensity) s.sig.maxShakeIntensity = intensity;
        const rect = canvas.getBoundingClientRect();
        const x = (canvas.width / rect.width) * (rect.width / 2 + (ag.x ?? 0) * 10);
        const y = (canvas.height / rect.height) * (rect.height / 2 - (ag.y ?? 0) * 10);
        addSplash(
          Math.max(20, Math.min(canvas.width - 20, x)),
          Math.max(20, Math.min(canvas.height - 20, y)),
          Math.min(intensity, 15)
        );
      }
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [phase, addSplash]);

  // Canvas tap fallback
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running) return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);
      addSplash(x, y, 5 + Math.random() * 5);
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    return () => { window.removeEventListener('resize', resize); canvas.removeEventListener('pointerdown', onPointerDown); };
  }, [addSplash]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    setPlayerName(name); setPlayerAvatar(avatar);
    initAudio();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
    coverageRef.current = null;
  }, []);

  const buildInsights = (sig: Signals) => [
    { label: 'Canvas Coverage', value: `${sig.coveragePercent}%`, color: sig.coveragePercent >= 60 ? '#4ade80' : sig.coveragePercent >= 30 ? '#facc15' : '#ef4444' },
    { label: 'Total Splashes',  value: `${sig.totalSplashes}`,   color: ACCENT },
    { label: 'Best Combo',      value: `×${sig.maxCombo}`,        color: ACCENT },
    { label: 'Max Shake',       value: `${sig.maxShakeIntensity.toFixed(1)}g`, color: 'var(--color-text)' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start Painting" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} role="img" aria-label="Paint splash canvas"
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
          onPlayAgain={handlePlayAgain} didWin={finalSig.coveragePercent >= 50} />
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
    postWebhook(theme, gameId, { personality, score: sig.score, totalSplashes: sig.totalSplashes,
      coveragePercent: sig.coveragePercent, maxShakeIntensity: parseFloat(sig.maxShakeIntensity.toFixed(2)),
      maxCombo: sig.maxCombo }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
