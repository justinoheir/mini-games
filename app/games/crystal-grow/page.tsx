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

const GAME_ID      = 'crystal-grow';
const ACCENT       = '#e879f9';
const DURATION     = 45;
const GAME_EMOJI   = '💎';
const GAME_TITLE   = 'Crystal Grow';
const GAME_TAGLINE = 'Breathe slowly and steadily to grow a crystal — erratic breath shatters it.';

interface Signals {
  maxCrystalSize: number;
  shatters: number;
  steadyBreathSeconds: number;
  avgBreathRate: number;
  score: number;
}

function getPersonality(sig: Signals): string {
  if (sig.shatters === 0 && sig.maxCrystalSize >= 0.8)  return 'Crystal Sage 💎';
  if (sig.shatters <= 1 && sig.steadyBreathSeconds >= 25) return 'Gentle Grower 🌿';
  if (sig.maxCrystalSize >= 0.6)                         return 'Fragile Beauty 🔮';
  if (sig.shatters >= 4)                                  return 'Shatter Artist 💥';
  return 'Breath Apprentice 🌬️';
}

interface CrystalBranch {
  angle: number;
  length: number;
  children: CrystalBranch[];
  width: number;
  depth: number;
}

interface ShardParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  size: number;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  volume: number;
  smoothVolume: number;
  breathRate: number;     // smoothed rate of change
  prevVolume: number;
  crystalSize: number;    // 0-1
  crystalTarget: number;
  isGrowing: boolean;
  shards: ShardParticle[];
  glowPulse: number;
  accentColor: string;
  analyser: AnalyserNode | null;
  micStream: MediaStream | null;
  dataArray: Uint8Array | null;
  steadyTicks: number;
  volumeHistory: number[];
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

const MIN_VOL = 0.08;
const MAX_VOL = 0.55;
const ERRATIC_THRESHOLD = 0.25;  // change rate that shatters

function buildCrystal(depth: number, angle: number, length: number, maxDepth: number): CrystalBranch {
  const children: CrystalBranch[] = [];
  if (depth < maxDepth) {
    const numChildren = depth === 0 ? 6 : 2;
    for (let i = 0; i < numChildren; i++) {
      const childAngle = depth === 0
        ? (i / numChildren) * Math.PI * 2
        : angle + (Math.random() - 0.5) * 1.2;
      children.push(buildCrystal(depth + 1, childAngle, length * 0.6, maxDepth));
    }
  }
  return { angle, length, children, width: Math.max(1, 4 - depth * 0.8), depth };
}

export default function CrystalGrowGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const crystalRef   = useRef<CrystalBranch | null>(null);

  const stateRef = useRef<GameState>({
    running: false,
    timeLeft: DURATION,
    sig: { maxCrystalSize: 0, shatters: 0, steadyBreathSeconds: 0, avgBreathRate: 0, score: 0 },
    volume: 0,
    smoothVolume: 0,
    breathRate: 0,
    prevVolume: 0,
    crystalSize: 0.05,
    crystalTarget: 0.05,
    isGrowing: false,
    shards: [],
    glowPulse: 0,
    accentColor: ACCENT,
    analyser: null,
    micStream: null,
    dataArray: null,
    steadyTicks: 0,
    volumeHistory: [],
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('💎');
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const stopMic = useCallback(() => {
    const s = stateRef.current;
    if (s.micStream) { s.micStream.getTracks().forEach(t => t.stop()); s.micStream = null; }
    s.analyser = null; s.dataArray = null;
  }, []);

  const shatterCrystal = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    s.sig.shatters++;
    const cx = canvas.width / 2;
    const cy = canvas.height * 0.5;
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      s.shards.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        alpha: 1, size: 3 + Math.random() * 8,
      });
    }
    s.crystalSize = 0.05;
    s.crystalTarget = 0.05;
    crystalRef.current = buildCrystal(0, -Math.PI / 2, 30, 2);
    sfx.fail();
    haptic([100, 50, 100]);
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

  const drawBranch = useCallback((ctx: CanvasRenderingContext2D, branch: CrystalBranch, x: number, y: number, scale: number, alpha: number) => {
    const endX = x + Math.cos(branch.angle) * branch.length * scale;
    const endY = y + Math.sin(branch.angle) * branch.length * scale;
    ctx.globalAlpha = alpha * (1 - branch.depth * 0.15);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = branch.width * scale;
    ctx.shadowBlur = 6;
    ctx.shadowColor = ACCENT;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.shadowBlur = 0;
    for (const child of branch.children) {
      drawBranch(ctx, child, endX, endY, scale * 0.55, alpha);
    }
  }, []);

  const startLoop = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    s.running = true;
    s.timeLeft = DURATION;
    s.sig = { maxCrystalSize: 0, shatters: 0, steadyBreathSeconds: 0, avgBreathRate: 0, score: 0 };
    s.crystalSize = 0.05;
    s.crystalTarget = 0.05;
    s.shards = [];
    s.steadyTicks = 0;
    s.volumeHistory = [];
    crystalRef.current = buildCrystal(0, -Math.PI / 2, 30, 2);
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

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
    } catch { /* fallback */ }

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.isGrowing) {
        s.sig.steadyBreathSeconds++;
        s.sig.score += Math.ceil(s.crystalSize * 3);
        setScoreDisplay(s.sig.score);
        haptic([30]);
      }
      if (s.crystalSize > s.sig.maxCrystalSize) s.sig.maxCrystalSize = s.crystalSize;
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width;
      const H = canvas.height;

      if (s.analyser && s.dataArray) {
        s.analyser.getByteFrequencyData(s.dataArray);
        let sum = 0;
        for (let i = 0; i < s.dataArray.length; i++) sum += s.dataArray[i];
        s.volume = sum / (s.dataArray.length * 255);
      }

      const prev = s.smoothVolume;
      s.smoothVolume += (s.volume - s.smoothVolume) * 0.12;
      const rate = Math.abs(s.smoothVolume - prev);
      s.breathRate = s.breathRate * 0.9 + rate * 0.1;

      const vol = s.smoothVolume;
      const isSteady = vol >= MIN_VOL && vol <= MAX_VOL && s.breathRate < ERRATIC_THRESHOLD;
      s.isGrowing = isSteady;

      if (isSteady) {
        s.crystalTarget = Math.min(1, s.crystalTarget + 0.003);
        s.steadyTicks++;
      } else if (s.breathRate > ERRATIC_THRESHOLD * 2) {
        shatterCrystal();
      } else {
        s.crystalTarget = Math.max(0.05, s.crystalTarget - 0.002);
      }

      s.crystalSize += (s.crystalTarget - s.crystalSize) * 0.05;
      s.glowPulse += 0.05;

      // Background
      ctx.fillStyle = '#0d0015';
      ctx.fillRect(0, 0, W, H);

      // Ambient glow
      if (s.isGrowing) {
        const g = ctx.createRadialGradient(W / 2, H * 0.5, 10, W / 2, H * 0.5, 150 * s.crystalSize);
        g.addColorStop(0, 'rgba(232,121,249,0.15)');
        g.addColorStop(1, 'rgba(232,121,249,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      // Update & draw shards
      s.shards = s.shards.filter(sh => {
        sh.x += sh.vx; sh.y += sh.vy; sh.vy += 0.1;
        sh.alpha -= 0.02;
        if (sh.alpha <= 0) return false;
        ctx.globalAlpha = sh.alpha;
        ctx.fillStyle = ACCENT;
        ctx.beginPath();
        ctx.moveTo(sh.x, sh.y - sh.size);
        ctx.lineTo(sh.x + sh.size * 0.5, sh.y + sh.size * 0.5);
        ctx.lineTo(sh.x - sh.size * 0.5, sh.y + sh.size * 0.5);
        ctx.fill();
        ctx.globalAlpha = 1;
        return true;
      });

      // Draw crystal
      if (crystalRef.current) {
        const scale = 1 + s.crystalSize * 3;
        const pulse = 1 + Math.sin(s.glowPulse) * 0.05 * s.crystalSize;
        ctx.save();
        ctx.translate(W / 2, H * 0.52);
        drawBranch(ctx, crystalRef.current, 0, 0, scale * pulse, 0.8 + s.crystalSize * 0.2);
        ctx.restore();
        ctx.globalAlpha = 1;
      }

      // Volume meter
      const meterX = 24; const meterH = H * 0.45; const meterY = H * 0.25;
      ctx.fillStyle = '#111'; ctx.fillRect(meterX, meterY, 20, meterH);
      const gx1 = meterY + meterH * (1 - MAX_VOL);
      const gx2 = meterY + meterH * (1 - MIN_VOL);
      ctx.fillStyle = 'rgba(232,121,249,0.25)'; ctx.fillRect(meterX, gx1, 20, gx2 - gx1);
      const barH = meterH * vol;
      ctx.fillStyle = s.isGrowing ? ACCENT : '#ef4444';
      ctx.fillRect(meterX + 2, meterY + meterH - barH, 16, barH);

      // Status
      ctx.fillStyle = s.isGrowing ? ACCENT : '#ef4444';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      const statusMsg = s.isGrowing ? 'CRYSTAL GROWING ✨'
        : vol < MIN_VOL ? 'BREATHE INTO MIC'
        : vol > MAX_VOL ? 'TOO LOUD!'
        : 'BREATHE STEADIER';
      ctx.fillText(statusMsg, W / 2, H * 0.88);

      // Crystal size indicator
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '11px monospace';
      ctx.fillText(`CRYSTAL: ${Math.round(s.crystalSize * 100)}%`, W / 2, H * 0.92);
      ctx.textAlign = 'left';

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, stopMic, drawBranch, shatterCrystal]);

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
    setPlayerName(name); setPlayerAvatar(avatar);
    initAudio();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const buildInsights = (sig: Signals) => [
    { label: 'Max Size',    value: `${Math.round(sig.maxCrystalSize * 100)}%`, color: sig.maxCrystalSize >= 0.7 ? '#4ade80' : '#facc15' },
    { label: 'Steady Time', value: `${sig.steadyBreathSeconds}s`,              color: ACCENT },
    { label: 'Shatters',    value: `${sig.shatters}`,                          color: sig.shatters === 0 ? '#4ade80' : '#ef4444' },
    { label: 'Score',       value: `${sig.score}`,                             color: 'var(--color-text)' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Allow Mic & Breathe" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Crystal Grow game canvas" />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME',  value: timeLeft,      danger: timeLeft <= 10 },
              { label: 'SCORE', value: scoreDisplay },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.maxCrystalSize >= 0.6} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
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
    postWebhook(theme, gameId, { personality, score: sig.score, maxCrystalSize: sig.maxCrystalSize, shatters: sig.shatters, steadyBreathSeconds: sig.steadyBreathSeconds }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
