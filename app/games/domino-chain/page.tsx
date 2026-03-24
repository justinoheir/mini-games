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

const GAME_ID      = 'domino-chain';
const ACCENT       = '#f97316';
const DURATION     = 60;
const GAME_EMOJI   = '🁣';
const GAME_TITLE   = 'Domino Chain';
const GAME_TAGLINE = 'Tap the first domino at the perfect moment. Watch the chain fall!';

const CHAIN_SIZE = 15;
const TAP_WINDOW = 600; // ms

interface Domino { x: number; y: number; fallen: boolean; fallAngle: number; fallProgress: number; }

interface Signals {
  totalRounds: number;
  perfectTaps: number;
  earlyTaps: number;
  lateTaps: number;
  maxChainFall: number;
  score: number;
  bestChain: number;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  dominoes: Domino[];
  chainFalling: boolean;
  fallIndex: number;
  tapReady: boolean;
  tapWindowOpen: boolean;
  tapWindowTime: number;
  phaseTimer: number;
  phaseDuration: number;
  currentChainFall: number;
  accentColor: string;
  feedbackText: string;
  feedbackAlpha: number;
  fallSpeed: number;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const acc = (sig.perfectTaps + sig.earlyTaps + sig.lateTaps) > 0
    ? sig.perfectTaps / (sig.perfectTaps + sig.earlyTaps + sig.lateTaps) : 0;
  if (acc >= 0.80 && sig.bestChain >= CHAIN_SIZE) return 'Chain Master 🏆';
  if (sig.bestChain >= CHAIN_SIZE) return 'Full Cascade 🌊';
  if (acc >= 0.70) return 'Precision Tipper 🎯';
  if (sig.totalRounds >= 5) return 'Rapid Resetter ⚡';
  return 'Careful Observer 🔍';
}

function buildDominoes(W: number, H: number): Domino[] {
  const dominoes: Domino[] = [];
  const startX = W * 0.1;
  const spacing = (W * 0.8) / (CHAIN_SIZE - 1);
  const y = H * 0.55;
  for (let i = 0; i < CHAIN_SIZE; i++) {
    dominoes.push({ x: startX + i * spacing, y, fallen: false, fallAngle: 0, fallProgress: 0 });
  }
  return dominoes;
}

export default function DominoChainGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalRounds: 0, perfectTaps: 0, earlyTaps: 0, lateTaps: 0, maxChainFall: 0, score: 0, bestChain: 0 },
    dominoes: [], chainFalling: false, fallIndex: 0,
    tapReady: false, tapWindowOpen: false, tapWindowTime: 0,
    phaseTimer: 0, phaseDuration: 180,
    currentChainFall: 0, accentColor: ACCENT,
    feedbackText: '', feedbackAlpha: 0, fallSpeed: 0.04,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🁣');
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const resetChain = useCallback((canvas: HTMLCanvasElement) => {
    const s = stateRef.current;
    s.dominoes = buildDominoes(canvas.width, canvas.height);
    s.chainFalling = false; s.fallIndex = 0;
    s.tapReady = false; s.tapWindowOpen = false;
    s.currentChainFall = 0;
    s.phaseTimer = 0;
    s.phaseDuration = Math.max(60, 180 - s.sig.totalRounds * 8);
    s.tapWindowTime = 0;
  }, []);

  const handleTap = useCallback(() => {
    const s = stateRef.current;
    if (!s.running || s.chainFalling) return;
    const now = Date.now();
    const timeSinceWindow = now - s.tapWindowTime;

    if (s.tapWindowOpen && timeSinceWindow >= 0 && timeSinceWindow < TAP_WINDOW) {
      // Perfect or good tap
      const quality = timeSinceWindow < TAP_WINDOW * 0.3 ? 'perfect' : 'good';
      s.sig.perfectTaps++;
      s.chainFalling = true; s.fallIndex = 0;
      s.feedbackText = quality === 'perfect' ? '⚡ PERFECT!' : '✓ GOOD';
      s.feedbackAlpha = 1;
      sfx.collect(); haptic([30]);
    } else if (s.tapReady && !s.tapWindowOpen) {
      // Early tap
      s.sig.earlyTaps++;
      s.feedbackText = '⏭ Too Early!';
      s.feedbackAlpha = 1;
      sfx.collision(); haptic([20, 30, 20]);
      // Knock just a few
      s.chainFalling = true; s.fallIndex = 0;
      s.phaseDuration = Math.max(3, Math.floor(CHAIN_SIZE * 0.3)); // only few fall
    } else if (!s.tapReady) {
      s.sig.lateTaps++;
      s.feedbackText = '⏭ Too Late!';
      s.feedbackAlpha = 1;
      sfx.collision(); haptic([20]);
    }
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalRounds: 0, perfectTaps: 0, earlyTaps: 0, lateTaps: 0, maxChainFall: 0, score: 0, bestChain: 0 };
    s.fallSpeed = 0.04;
    resetChain(canvas);
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width; const H = canvas.height;

      ctx.fillStyle = '#1a1206';
      ctx.fillRect(0, 0, W, H);

      // Floor
      ctx.fillStyle = '#2d1f0e';
      ctx.fillRect(0, H * 0.62, W, H - H * 0.62);
      ctx.fillStyle = '#3d2912';
      ctx.fillRect(0, H * 0.62, W, 2);

      // Phase/ready logic
      if (!s.chainFalling) {
        s.phaseTimer++;
        const warmup = Math.floor(s.phaseDuration * 0.6);
        if (s.phaseTimer >= warmup && !s.tapReady) {
          s.tapReady = true;
          s.tapWindowTime = Date.now() + (s.phaseDuration - warmup) * (1000 / 60) * 0.5;
        }
        if (s.tapReady && Date.now() >= s.tapWindowTime && !s.tapWindowOpen) {
          s.tapWindowOpen = true;
        }
        if (s.tapWindowOpen && Date.now() > s.tapWindowTime + TAP_WINDOW) {
          // Missed tap — auto-start minimal fall
          s.tapWindowOpen = false; s.tapReady = false;
          s.sig.lateTaps++;
          s.chainFalling = true; s.fallIndex = 0;
          s.feedbackText = '⌛ Missed!'; s.feedbackAlpha = 1;
          sfx.fail(); haptic([20]);
        }
      }

      // Window indicator
      if (s.tapReady && !s.chainFalling) {
        const progress = s.tapWindowOpen
          ? 1 - Math.max(0, (Date.now() - s.tapWindowTime) / TAP_WINDOW)
          : Math.max(0, (s.tapWindowTime - Date.now()) / (s.phaseDuration * (1000/60) * 0.5));
        const barW = W * 0.6;
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(W / 2 - barW / 2, H * 0.78, barW, 12);
        ctx.fillStyle = s.tapWindowOpen ? '#4ade80' : ACCENT;
        ctx.fillRect(W / 2 - barW / 2, H * 0.78, barW * (s.tapWindowOpen ? progress : 1 - progress), 12);
        ctx.strokeStyle = '#fff4'; ctx.lineWidth = 1;
        ctx.strokeRect(W / 2 - barW / 2, H * 0.78, barW, 12);

        ctx.fillStyle = '#fff';
        ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(s.tapWindowOpen ? '👆 TAP NOW!' : '⏳ Wait...', W / 2, H * 0.9);
      }

      // Fall animation
      if (s.chainFalling && s.fallIndex < s.dominoes.length) {
        const d = s.dominoes[s.fallIndex];
        if (!d.fallen) {
          d.fallProgress = Math.min(1, d.fallProgress + s.fallSpeed);
          d.fallAngle = d.fallProgress * (Math.PI / 2);
          if (d.fallProgress >= 1) {
            d.fallen = true; s.fallIndex++;
            s.currentChainFall++;
            if (s.currentChainFall > s.sig.maxChainFall) s.sig.maxChainFall = s.currentChainFall;
            sfx.collect();
          }
        }
      }

      // Check if chain finished
      if (s.chainFalling && s.fallIndex >= s.dominoes.length) {
        const fell = s.dominoes.filter(d => d.fallen).length;
        if (fell > s.sig.bestChain) s.sig.bestChain = fell;
        const pts = Math.round((fell / CHAIN_SIZE) * 10);
        s.sig.score += pts;
        s.sig.totalRounds++;
        setScoreDisplay(s.sig.score);
        s.fallSpeed = Math.min(0.12, 0.04 + s.sig.totalRounds * 0.008);
        sfx.collect(); haptic([50, 30, 100]);
        setTimeout(() => { if (s.running) resetChain(canvas); }, 1200);
        s.chainFalling = false; s.fallIndex = CHAIN_SIZE + 99;
      }

      // Draw dominoes
      const DW = Math.max(6, Math.min(14, W * 0.03));
      const DH = DW * 2.5;
      for (let i = 0; i < s.dominoes.length; i++) {
        const d = s.dominoes[i];
        ctx.save();
        const isFirst = i === 0 && !d.fallen && !s.chainFalling;
        ctx.translate(d.x, d.y);
        ctx.rotate(-d.fallAngle);
        ctx.fillStyle = isFirst ? ACCENT : (d.fallen ? '#78350f' : '#fef3c7');
        ctx.fillRect(-DW / 2, -DH, DW, DH);
        if (!d.fallen) {
          ctx.strokeStyle = '#92400e'; ctx.lineWidth = 1;
          ctx.strokeRect(-DW / 2, -DH, DW, DH);
          // Dots
          ctx.fillStyle = '#92400e';
          ctx.beginPath(); ctx.arc(0, -DH * 0.65, 2, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(0, -DH * 0.35, 2, 0, Math.PI * 2); ctx.fill();
        }
        if (isFirst) {
          ctx.shadowBlur = 15; ctx.shadowColor = ACCENT;
          ctx.fillStyle = ACCENT; ctx.fillRect(-DW/2, -DH, DW, DH);
        }
        ctx.restore();
      }

      // Feedback text
      if (s.feedbackAlpha > 0) {
        s.feedbackAlpha -= 0.02;
        ctx.save(); ctx.globalAlpha = s.feedbackAlpha;
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(s.feedbackText, W / 2, H * 0.3);
        ctx.restore();
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, resetChain]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    const onPointerDown = () => { if (phase === 'playing') handleTap(); };
    canvas.addEventListener('pointerdown', onPointerDown);
    return () => { window.removeEventListener('resize', resize); canvas.removeEventListener('pointerdown', onPointerDown); };
  }, [phase, handleTap]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
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
    const acc = (sig.perfectTaps + sig.earlyTaps + sig.lateTaps) > 0
      ? Math.round((sig.perfectTaps / (sig.perfectTaps + sig.earlyTaps + sig.lateTaps)) * 100) : 0;
    return [
      { label: 'Tap Precision',  value: `${acc}%`,           color: acc >= 70 ? '#4ade80' : '#facc15' },
      { label: 'Best Chain',     value: `${sig.bestChain}/${CHAIN_SIZE}`, color: ACCENT },
      { label: 'Rounds Played',  value: `${sig.totalRounds}`, color: ACCENT },
      { label: 'Early Taps',     value: `${sig.earlyTaps}`,   color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Set the Chain" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} role="img" aria-label="Domino chain reaction game"
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
          onPlayAgain={handlePlayAgain} didWin={finalSig.bestChain >= CHAIN_SIZE} />
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
    const acc = (sig.perfectTaps + sig.earlyTaps + sig.lateTaps) > 0
      ? sig.perfectTaps / (sig.perfectTaps + sig.earlyTaps + sig.lateTaps) : 0;
    postWebhook(theme, gameId, { personality, score: sig.score, tapPrecision: parseFloat(acc.toFixed(3)),
      bestChain: sig.bestChain, totalRounds: sig.totalRounds, earlyTaps: sig.earlyTaps }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
