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

const GAME_ID      = 'echo-clap';
const ACCENT       = '#ef4444';
const DURATION     = 45;
const GAME_EMOJI   = '👏';
const GAME_TITLE   = 'Echo Clap';
const GAME_TAGLINE = 'Clap in time with the echo pattern. It speeds up!';
const MIC_THRESHOLD = 0.15;
const CLAP_COOLDOWN = 200;

interface ClapTarget { time: number; hit: boolean; shown: boolean; }

interface Signals {
  totalCues: number;
  clapsOnTime: number;
  clapsLate: number;
  roundsCompleted: number;
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  clapTargets: ClapTarget[];
  currentRound: number;
  roundBPM: number;
  roundActive: boolean;
  lastClapTime: number;
  micLevel: number;
  accentColor: string;
  ripples: Array<{x:number;y:number;r:number;alpha:number}>;
  patternPhase: number;
  patternLength: number;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const acc = sig.totalCues > 0 ? sig.clapsOnTime / sig.totalCues : 0;
  if (acc >= 0.80 && sig.roundsCompleted >= 4) return 'Echo Master 👏';
  if (acc >= 0.70) return 'Rhythm Clapper 🎵';
  if (sig.roundsCompleted >= 5) return 'Speed Demon ⚡';
  if (sig.maxStreak >= 6) return 'Streak Keeper 🔥';
  return 'Off-Tempo Tapper 🎲';
}

export default function EchoClapGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const micRef = useRef<{ stream: MediaStream; analyser: AnalyserNode; data: Uint8Array } | null>(null);
  const patternTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalCues: 0, clapsOnTime: 0, clapsLate: 0, roundsCompleted: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    clapTargets: [], currentRound: 1, roundBPM: 60, roundActive: false,
    lastClapTime: 0, micLevel: 0, accentColor: ACCENT,
    ripples: [], patternPhase: 0, patternLength: 4,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('👏');
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const schedulePattern = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    const intervalMs = (60 / s.roundBPM) * 1000;
    s.clapTargets = [];
    s.patternPhase = 0;
    const now = Date.now();
    // Play echo cue sounds
    for (let i = 0; i < s.patternLength; i++) {
      setTimeout(() => {
        if (!s.running) return;
        sfx.collect(); haptic([20]);
      }, i * intervalMs * 0.5); // half speed first (echo)
    }
    // Schedule user clap targets at full speed
    const startDelay = s.patternLength * intervalMs * 0.5 + 800;
    for (let i = 0; i < s.patternLength; i++) {
      const targetTime = now + startDelay + i * intervalMs;
      s.clapTargets.push({ time: targetTime, hit: false, shown: false });
      s.sig.totalCues++;
    }
    s.roundActive = true;
    // After all targets, check and advance round
    patternTimerRef.current = setTimeout(() => {
      if (!s.running) return;
      const missed = s.clapTargets.filter(t => !t.hit).length;
      if (missed === 0) {
        s.sig.roundsCompleted++;
        s.currentRound++;
        s.roundBPM = Math.min(160, 60 + s.currentRound * 10);
        s.patternLength = Math.min(8, 4 + Math.floor(s.currentRound / 2));
        sfx.collect(); haptic([30, 20, 30]);
      }
      s.roundActive = false;
      setTimeout(() => { if (s.running) schedulePattern(); }, 1000);
    }, startDelay + s.patternLength * intervalMs + 500);
  }, []);

  const processClap = useCallback(() => {
    const s = stateRef.current;
    const now = Date.now();
    if (now - s.lastClapTime < CLAP_COOLDOWN) return;
    s.lastClapTime = now;
    const canvas = canvasRef.current;
    if (canvas) {
      s.ripples.push({ x: canvas.width / 2, y: canvas.height / 2, r: 10, alpha: 1 });
    }

    // Find nearest unHit target within window
    const window_ms = 300;
    let bestTarget: ClapTarget | null = null;
    let bestDiff = Infinity;
    for (const t of s.clapTargets) {
      if (t.hit) continue;
      const diff = Math.abs(now - t.time);
      if (diff < window_ms && diff < bestDiff) { bestDiff = diff; bestTarget = t; }
    }

    if (bestTarget) {
      bestTarget.hit = true;
      s.sig.clapsOnTime++;
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const pts = s.sig.streakCurrent >= 3 ? 3 : 2;
      s.sig.score += pts;
      setScoreDisplay(s.sig.score);
      sfx.collect(); haptic([30]);
    } else {
      s.sig.clapsLate++;
      s.sig.streakCurrent = 0;
      sfx.collision(); haptic([20, 30, 20]);
    }
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (patternTimerRef.current) { clearTimeout(patternTimerRef.current); patternTimerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (micRef.current) {
      micRef.current.stream.getTracks().forEach(t => t.stop());
      micRef.current = null;
    }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const startLoop = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    // Request mic
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ac = new AudioContext();
      const analyser = ac.createAnalyser();
      analyser.fftSize = 256;
      ac.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      micRef.current = { stream, analyser, data };
    } catch { /* no mic — tap fallback */ }

    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalCues: 0, clapsOnTime: 0, clapsLate: 0, roundsCompleted: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.clapTargets = []; s.currentRound = 1; s.roundBPM = 60; s.roundActive = false;
    s.ripples = []; s.patternLength = 4;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('chill');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    setTimeout(() => { if (s.running) schedulePattern(); }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width; const H = canvas.height;

      // Read mic
      if (micRef.current) {
        const { analyser, data } = micRef.current;
        analyser.getByteTimeDomainData(data as Uint8Array<ArrayBuffer>);
        let sum = 0;
        for (const v of data) sum += Math.abs(v - 128);
        const level = sum / data.length / 128;
        s.micLevel = level;
        setMicLevel(level);
        if (level > MIC_THRESHOLD) processClap();
      }

      ctx.fillStyle = '#1a0a0a';
      ctx.fillRect(0, 0, W, H);

      // Draw cue circles
      const now = Date.now();
      for (let i = 0; i < s.clapTargets.length; i++) {
        const t = s.clapTargets[i];
        const timeToTarget = t.time - now;
        if (timeToTarget < -500 || timeToTarget > 3000) continue;
        const x = W * 0.2 + (W * 0.6 / (s.patternLength)) * (i + 0.5);
        const y = H * 0.5;
        const frac = Math.max(0, Math.min(1, 1 - timeToTarget / 2000));
        const r = 15 + frac * 30;
        ctx.save();
        ctx.strokeStyle = t.hit ? '#4ade80' : ACCENT;
        ctx.lineWidth = 3;
        ctx.globalAlpha = t.hit ? 0.4 : 0.9;
        ctx.shadowBlur = 15; ctx.shadowColor = t.hit ? '#4ade80' : ACCENT;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
        if (Math.abs(timeToTarget) < 300 && !t.hit) {
          ctx.fillStyle = ACCENT + '44';
          ctx.fill();
        }
        ctx.restore();
      }

      // Round info
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Round ${s.currentRound} — ${s.roundBPM} BPM`, W / 2, H * 0.25);

      // Mic level bar
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(W / 2 - 60, H * 0.75, 120, 10);
      ctx.fillStyle = s.micLevel > MIC_THRESHOLD ? '#4ade80' : ACCENT;
      ctx.fillRect(W / 2 - 60, H * 0.75, Math.min(120, s.micLevel * 800), 10);

      // Ripples
      s.ripples = s.ripples.filter(r => r.alpha > 0.05);
      for (const rip of s.ripples) {
        rip.r += 4; rip.alpha -= 0.04;
        ctx.save(); ctx.globalAlpha = rip.alpha;
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(rip.x, rip.y, rip.r, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }

      ctx.fillStyle = '#fff';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Clap or tap to match the echo!', W / 2, H * 0.88);

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, schedulePattern, processClap]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    const onPointerDown = () => { if (phase === 'playing') processClap(); };
    canvas.addEventListener('pointerdown', onPointerDown);
    return () => { window.removeEventListener('resize', resize); canvas.removeEventListener('pointerdown', onPointerDown); };
  }, [phase, processClap]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (patternTimerRef.current) clearTimeout(patternTimerRef.current);
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

  const buildInsights = (sig: Signals) => {
    const acc = sig.totalCues > 0 ? Math.round((sig.clapsOnTime / sig.totalCues) * 100) : 0;
    return [
      { label: 'Clap Accuracy',   value: `${acc}%`,               color: acc >= 70 ? '#4ade80' : '#facc15' },
      { label: 'Rounds Cleared',  value: `${sig.roundsCompleted}`, color: ACCENT },
      { label: 'Best Streak',     value: `×${sig.maxStreak}`,       color: ACCENT },
      { label: 'Off-Time Claps',  value: `${sig.clapsLate}`,        color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Allow Mic & Start" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} role="img" aria-label="Echo clap rhythm game"
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
          onPlayAgain={handlePlayAgain} didWin={finalSig.roundsCompleted >= 3} />
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
    const acc = sig.totalCues > 0 ? sig.clapsOnTime / sig.totalCues : 0;
    postWebhook(theme, gameId, { personality, score: sig.score, clapAccuracy: parseFloat(acc.toFixed(3)),
      roundsCompleted: sig.roundsCompleted, maxStreak: sig.maxStreak, clapsLate: sig.clapsLate }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}


