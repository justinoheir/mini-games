'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticImpact } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'wire-cross';
const ACCENT = '#00e5ff';
const DURATION = 45;
const GAME_EMOJI = '⚡';
const GAME_TITLE = 'Wire Cross';
const GAME_TAGLINE = 'Thread the ring. Don\'t touch the wire.';

interface Signals {
  totalAttempts: number;
  completions: number;
  touches: number;
  maxStreak: number;
  streakCurrent: number;
  avgSpeed: number;
  speedSum: number;
  score: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.totalAttempts > 0 ? sig.completions / sig.totalAttempts : 0;
  if (acc >= 0.8 && sig.maxStreak >= 3) return 'Surgeon 🔬';
  if (sig.touches === 0 && sig.completions >= 3) return 'Untouchable ✨';
  if (sig.avgSpeed < 3000 && acc >= 0.6) return 'Speed Demon ⚡';
  if (acc >= 0.5) return 'Steady Hand 🎯';
  return 'Learning Curve 📚';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface WirePoint { x: number; y: number; }

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  ringX: number;
  ringY: number;
  ringRadius: number;
  isDragging: boolean;
  wirePoints: WirePoint[];
  currentSegment: number;
  startTime: number;
  touchFlash: number;
  prevBest: number;
  accentColor: string;
  comboDisplay: number;
  scorePop: number;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number }>;
}

export default function WireCross() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalAttempts: 0, completions: 0, touches: 0, maxStreak: 0, streakCurrent: 0, avgSpeed: 0, speedSum: 0, score: 0 },
    ringX: 0, ringY: 0, ringRadius: 28,
    isDragging: false,
    wirePoints: [],
    currentSegment: 0,
    startTime: 0,
    touchFlash: 0,
    prevBest: 0,
    accentColor: ACCENT,
    comboDisplay: 0,
    scorePop: 0,
    floats: [],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const buildWire = useCallback((W: number, H: number): WirePoint[] => {
    const pts: WirePoint[] = [];
    const segments = 6 + Math.floor(Math.random() * 4);
    pts.push({ x: 30, y: H / 2 });
    for (let i = 1; i < segments - 1; i++) {
      const x = 30 + (W - 60) * (i / (segments - 1));
      const y = H * 0.2 + Math.random() * H * 0.6;
      pts.push({ x, y });
    }
    pts.push({ x: W - 30, y: H / 2 });
    return pts;
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, []);

  const setupNextWire = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;
    s.wirePoints = buildWire(W, H);
    s.currentSegment = 0;
    s.ringX = s.wirePoints[0].x;
    s.ringY = s.wirePoints[0].y;
    s.isDragging = false;
    s.startTime = Date.now();
    s.sig.totalAttempts++;
  }, [buildWire]);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;

    s.running = true;
    s.timeLeft = DURATION;
    s.sig = { totalAttempts: 0, completions: 0, touches: 0, maxStreak: 0, streakCurrent: 0, avgSpeed: 0, speedSum: 0, score: 0 };
    s.prevBest = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    s.floats = [];
    s.scorePop = 0;
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    setupNextWire();

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);

      // Background: dark industrial
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0a0a14');
      bg.addColorStop(1, '#060610');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Grid
      ctx.strokeStyle = 'rgba(0,229,255,0.04)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 32) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
      for (let gy = 0; gy < H; gy += 32) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

      const pts = s.wirePoints;
      if (pts.length < 2) { animRef.current = requestAnimationFrame(loop); return; }

      // Draw wire glow
      ctx.save();
      ctx.shadowBlur = 12;
      ctx.shadowColor = s.accentColor;
      ctx.strokeStyle = `${s.accentColor}88`;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();

      // Wire core
      ctx.strokeStyle = s.accentColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.restore();

      // Start/end markers
      ctx.save();
      ctx.fillStyle = '#4ade80';
      ctx.shadowBlur = 8; ctx.shadowColor = '#4ade80';
      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f59e0b';
      ctx.shadowColor = '#f59e0b';
      ctx.beginPath(); ctx.arc(pts[pts.length - 1].x, pts[pts.length - 1].y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Touch flash
      const flashAlpha = Math.max(0, (s.touchFlash - Date.now()) / 200);
      if (flashAlpha > 0) {
        ctx.fillStyle = `rgba(239,68,68,${flashAlpha * 0.3})`;
        ctx.fillRect(0, 0, W, H);
      }

      // Ring — draw after checking collision
      if (s.isDragging) {
        // Check collision with wire
        let colliding = false;
        for (let i = 0; i < pts.length - 1; i++) {
          const ax = pts[i].x, ay = pts[i].y, bx = pts[i + 1].x, by = pts[i + 1].y;
          const lenSq = (bx - ax) ** 2 + (by - ay) ** 2;
          const t2 = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((s.ringX - ax) * (bx - ax) + (s.ringY - ay) * (by - ay)) / lenSq));
          const closestX = ax + t2 * (bx - ax), closestY = ay + t2 * (by - ay);
          const dist = Math.sqrt((s.ringX - closestX) ** 2 + (s.ringY - closestY) ** 2);
          if (dist < s.ringRadius - 4) { colliding = true; break; }
        }
        if (colliding && Date.now() > s.touchFlash) {
          s.touchFlash = Date.now() + 200;
          s.sig.touches++;
          s.sig.streakCurrent = 0;
          sfx.collision();
          hapticImpact();
          s.sig.score = Math.max(0, s.sig.score - 1);
          setScoreDisplay(s.sig.score);
        }

        // Check if reached end
        const endDist = Math.sqrt((s.ringX - pts[pts.length - 1].x) ** 2 + (s.ringY - pts[pts.length - 1].y) ** 2);
        if (endDist < s.ringRadius + 10) {
          s.sig.completions++;
          s.sig.streakCurrent++;
          if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
          const elapsed = Date.now() - s.startTime;
          s.sig.speedSum += elapsed;
          s.sig.avgSpeed = s.sig.speedSum / s.sig.completions;
          const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
          s.sig.score += 10 * mult;
          s.scorePop = Date.now() + 300;
          setScoreDisplay(s.sig.score);
          sfx.collect();
          hapticScore();
          const popText = s.sig.streakCurrent >= 3 ? `+${10 * mult} 🔥x${s.sig.streakCurrent}` : `+${10 * mult}`;
          s.floats.push({ x: W / 2, y: H * 0.3, text: popText, alpha: 1, vy: -2 });
          setupNextWire();
        }
      }

      // Draw ring
      const ringPulse = 1 + Math.sin(Date.now() / 200) * 0.05;
      const ringColor = s.touchFlash > Date.now() ? '#ef4444' : '#ffffff';
      ctx.save();
      ctx.shadowBlur = 16;
      ctx.shadowColor = ringColor;
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(s.ringX, s.ringY, s.ringRadius * ringPulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Score pop
      if (s.scorePop > Date.now()) {
        const t3 = (s.scorePop - Date.now()) / 300;
        const popScale = 1 + t3 * 0.3;
        ctx.save();
        ctx.globalAlpha = t3;
        ctx.font = `bold ${Math.round(32 * popScale)}px sans-serif`;
        ctx.fillStyle = '#4ade80';
        ctx.textAlign = 'center';
        ctx.fillText(`${s.sig.score}`, W / 2, 80);
        ctx.restore();
      }

      // Float texts
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save();
        ctx.globalAlpha = f.alpha;
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 28px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y);
        ctx.restore();
        f.y += f.vy; f.alpha *= 0.96;
      });

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, setupNextWire]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);
      const dx = x - s.ringX, dy = y - s.ringY;
      if (Math.sqrt(dx * dx + dy * dy) < s.ringRadius + 20) s.isDragging = true;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.isDragging) return;
      const rect = canvas.getBoundingClientRect();
      s.ringX = (e.clientX - rect.left) * (canvas.width / rect.width);
      s.ringY = (e.clientY - rect.top) * (canvas.height / rect.height);
    };
    const onPointerUp = () => { stateRef.current.isDragging = false; };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [phase]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name); setPlayerAvatar(avatar);
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);

  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
            role="img" aria-label="Wire threading game canvas" />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
              { label: 'SCORE', value: scoreDisplay },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Completions', value: String(finalSig.completions), color: ACCENT },
            { label: 'Wire Touches', value: String(finalSig.touches), color: finalSig.touches === 0 ? '#4ade80' : '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
            { label: 'Avg Speed', value: `${Math.round(finalSig.avgSpeed / 100) / 10}s`, color: '#a855f7' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.completions >= 3} />
      )}
    </GameShell>
  );
}
