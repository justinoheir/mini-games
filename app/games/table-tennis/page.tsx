'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo, hapticImpact } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'table-tennis';
const ACCENT = '#fb923c';
const DURATION = 45;
const GAME_EMOJI = '🏓';
const GAME_TITLE = 'Table Tennis';
const GAME_TAGLINE = "Return everything. Don't blink.";

interface Signals {
  returns: number;       // successful returns
  misses: number;        // missed balls
  longestRally: number;  // longest continuous rally
  currentRally: number;
  avgTimingMs: number;   // avg ms between ball reaching player and swipe
  totalTimingMs: number;
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const acc = (sig.returns + sig.misses) > 0 ? sig.returns / (sig.returns + sig.misses) : 0;
  if (sig.longestRally >= 12 && acc >= 0.75) return 'Table Master 🏆';
  if (sig.longestRally >= 8) return 'Rally King 👑';
  if (acc >= 0.7) return 'Steady Returner 🎯';
  if (sig.avgTimingMs < 300 && sig.returns >= 5) return 'Lightning Reflex ⚡';
  return 'Warming Up 🏓';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface Ball {
  x: number; y: number;
  vx: number; vy: number;
  spin: number; // degrees per frame
}

interface GameState {
  running: boolean; timeLeft: number;
  sig: Signals; frame: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  ball: Ball;
  playerY: number;     // player's paddle Y center
  opponentY: number;   // AI opponent paddle Y
  playerSide: boolean; // true = player on right, false = player on left
  ballAtPlayer: boolean;
  swipeWindowOpen: boolean;
  swipeWindowStart: number; // Date.now() when ball enters player zone
  lastSwipeX: number; lastSwipeY: number;
  swipeDx: number; swipeDy: number;
  tableW: number; tableH: number; // computed once
  rallyActive: boolean;
  paddleFlash: number; // frames to show hit flash
  speed: number; // ball speed multiplier
}

export default function TableTennisGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { returns: 0, misses: 0, longestRally: 0, currentRally: 0, avgTimingMs: 0, totalTimingMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    frame: 0, accentColor: ACCENT, floats: [],
    ball: { x: 0, y: 0, vx: 3, vy: 1, spin: 0 },
    playerY: 0, opponentY: 0,
    playerSide: true,
    ballAtPlayer: false, swipeWindowOpen: false, swipeWindowStart: 0,
    lastSwipeX: 0, lastSwipeY: 0, swipeDx: 0, swipeDy: 0,
    tableW: 0, tableH: 0,
    rallyActive: true, paddleFlash: 0, speed: 1,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const pb = parseInt(localStorage.getItem('pb_' + GAME_ID) ?? '0');
    if (s.sig.score > pb) localStorage.setItem('pb_' + GAME_ID, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { returns: 0, misses: 0, longestRally: 0, currentRally: 0, avgTimingMs: 0, totalTimingMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.frame = 0; s.floats = []; s.speed = 1;

    const tW = Math.min(W - 40, 340), tH = Math.min(H * 0.55, 300);
    const tX = (W - tW) / 2, tY = (H - tH) / 2 + 20;
    s.tableW = tW; s.tableH = tH;
    s.ball = { x: tX + tW / 2, y: tY + tH / 2, vx: 3, vy: (Math.random() - 0.5) * 2, spin: 0 };
    s.playerY = tY + tH / 2;
    s.opponentY = tY + tH / 2;
    s.swipeWindowOpen = false; s.ballAtPlayer = false;
    s.rallyActive = true;

    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);
      s.frame++;

      // Background - sports hall
      ctx.fillStyle = '#0f1a2e'; ctx.fillRect(0, 0, W, H);
      // Audience dots
      for (let i = 0; i < 20; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.05 + Math.sin(s.frame * 0.05 + i) * 0.03})`;
        ctx.beginPath(); ctx.arc((i * 53) % W, 20 + (i % 4) * 15, 3, 0, Math.PI * 2); ctx.fill();
      }

      const tX2 = (W - s.tableW) / 2, tY2 = (H - s.tableH) / 2 + 20;
      const tR = tX2 + s.tableW, tB = tY2 + s.tableH;

      // Table surface
      ctx.fillStyle = '#1e4d8c'; ctx.fillRect(tX2, tY2, s.tableW, s.tableH);
      // Table lines
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.strokeRect(tX2, tY2, s.tableW, s.tableH);
      // Net
      ctx.strokeStyle = '#ffffff66'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(tX2 + s.tableW / 2, tY2); ctx.lineTo(tX2 + s.tableW / 2, tB); ctx.stroke();
      // Center line
      ctx.strokeStyle = '#ffffff33'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(tX2, tY2 + s.tableH / 2); ctx.lineTo(tR, tY2 + s.tableH / 2); ctx.stroke();
      ctx.setLineDash([]);

      // Move ball
      const b = s.ball;
      b.x += b.vx * s.speed;
      b.y += b.vy * s.speed;
      b.y += b.spin * 0.3;

      // Bounce off top/bottom table edges
      if (b.y < tY2 + 5) { b.y = tY2 + 5; b.vy = Math.abs(b.vy); b.spin *= -0.8; }
      if (b.y > tB - 5) { b.y = tB - 5; b.vy = -Math.abs(b.vy); b.spin *= -0.8; }

      const paddleW = 8, paddleH = 50;
      const playerX = tR - 20; // player on right

      // AI opponent on left - tracks ball
      const targetOppY = b.y;
      s.opponentY += (targetOppY - s.opponentY) * 0.08;
      s.opponentY = Math.max(tY2 + paddleH / 2, Math.min(tB - paddleH / 2, s.opponentY));

      // Ball at player side?
      if (b.x > playerX - 30 && b.vx > 0) {
        if (!s.swipeWindowOpen) {
          s.swipeWindowOpen = true;
          s.swipeWindowStart = Date.now();
          s.ballAtPlayer = true;
        }
      } else {
        s.ballAtPlayer = false;
      }

      // Ball missed (went past player)
      if (b.x > tR + 20) {
        s.sig.misses++;
        s.sig.currentRally = 0;
        s.sig.streakCurrent = 0;
        s.floats.push({ x: W / 2, y: tY2 - 20, text: 'MISS!', alpha: 1, vy: -2, color: '#ef4444' });
        sfx.collision(); hapticFail();
        s.swipeWindowOpen = false;
        // Reset ball from left
        b.x = tX2 + 40; b.y = tY2 + s.tableH / 2 + (Math.random() - 0.5) * s.tableH * 0.4;
        b.vx = 2.5 * s.speed; b.vy = (Math.random() - 0.5) * 3;
      }

      // Opponent missed
      if (b.x < tX2 - 20) {
        // Opponent returns automatically (slight miss chance)
        if (Math.random() < 0.08) {
          s.sig.misses++;
          b.x = tX2 + 40; b.y = tY2 + s.tableH / 2;
          b.vx = 2.5 * s.speed; b.vy = (Math.random() - 0.5) * 3;
        } else {
          // Opponent returns
          b.vx = Math.abs(b.vx) + 0.1;
          b.vy += (s.opponentY - b.y) * 0.05;
        }
      }

      // Draw paddles
      if (s.paddleFlash > 0) { s.paddleFlash--; ctx.fillStyle = '#fbbf24'; }
      else { ctx.fillStyle = ACCENT; }
      // Player paddle
      ctx.fillRect(playerX, s.playerY - paddleH / 2, paddleW, paddleH);
      // Opponent paddle
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(tX2 + 10, s.opponentY - paddleH / 2, paddleW, paddleH);

      // Player paddle indicator hint
      if (s.swipeWindowOpen) {
        const elapsed = Date.now() - s.swipeWindowStart;
        const urgency = Math.min(1, elapsed / 1000);
        ctx.strokeStyle = urgency > 0.6 ? '#ef4444' : ACCENT;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(playerX + paddleW / 2, s.playerY, 30, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('SWIPE!', playerX + paddleW / 2, tB + 20);
      }

      // Draw ball with spin effect
      ctx.save();
      ctx.shadowBlur = 12; ctx.shadowColor = '#ffffff';
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Rally counter
      ctx.fillStyle = ACCENT; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`Rally: ${s.sig.currentRally}`, W / 2, tY2 - 30);

      // Score pop
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha;
        ctx.fillStyle = f.color; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.95;
      });

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    let pointerStart = { x: 0, y: 0, t: 0 };

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      pointerStart = { x: e.clientX, y: e.clientY, t: Date.now() };
    };

    const onPointerUp = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.swipeWindowOpen) return;

      const rect = canvas.getBoundingClientRect();
      const dx = e.clientX - pointerStart.x;
      const dy = e.clientY - pointerStart.y;
      const dt = Date.now() - pointerStart.t;
      const swipeSpeed = Math.sqrt(dx * dx + dy * dy) / Math.max(1, dt) * 100;

      if (swipeSpeed < 0.5 && Math.abs(dx) < 10) return; // too slow / not a swipe

      const timingMs = Date.now() - s.swipeWindowStart;
      s.sig.totalTimingMs += timingMs;
      s.sig.returns++;
      s.sig.currentRally++;
      if (s.sig.currentRally > s.sig.longestRally) s.sig.longestRally = s.sig.currentRally;
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;

      const pts = timingMs < 300 ? 3 : timingMs < 600 ? 2 : 1;
      const bonus = s.sig.currentRally >= 5 ? 1 : 0;
      s.sig.score += pts + bonus;
      s.speed = Math.min(2.5, 1 + s.sig.returns * 0.03);
      setScoreDisplay(s.sig.score);

      // Return ball with player's swipe direction
      const b = s.ball;
      b.vx = -Math.abs(b.vx) - swipeSpeed * 0.01;
      b.vy = dy * 0.04 + (Math.random() - 0.5) * 1.5;
      b.spin = -dx * 0.02;

      // Move player paddle to swipe position
      const py = e.clientY - canvas.getBoundingClientRect().top;
      s.playerY = (py / canvas.offsetHeight) * canvas.height;

      s.paddleFlash = 6;
      s.swipeWindowOpen = false;
      s.ballAtPlayer = false;

      sfx.collect(); hapticScore();
      if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);

      const label = pts === 3 ? '⚡ PERFECT!' : pts === 2 ? '+ GOOD' : '+ RETURN';
      s.floats.push({ x: canvas.width * 0.75, y: canvas.height * 0.4, text: label, alpha: 1, vy: -2.5, color: '#fbbf24' });
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [phase]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Swipe to return the ball when it reaches your side!" ctaLabel="Rally! 🏓" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Table Tennis game canvas" />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Returns', value: String(finalSig.returns), color: ACCENT },
            { label: 'Best Rally', value: String(finalSig.longestRally), color: '#fbbf24' },
            { label: 'Accuracy', value: `${(finalSig.returns + finalSig.misses) > 0 ? Math.round(finalSig.returns / (finalSig.returns + finalSig.misses) * 100) : 0}%`, color: '#4ade80' },
            { label: 'Avg Timing', value: `${finalSig.returns > 0 ? Math.round(finalSig.totalTimingMs / finalSig.returns) : 0}ms`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.longestRally >= 8} />
      )}
    </GameShell>
  );
}
