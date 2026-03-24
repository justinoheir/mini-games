'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo, hapticWarning } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'gymnast-beam';
const ACCENT = '#f472b6';
const DURATION = 60;
const GAME_EMOJI = '🤸';
const GAME_TITLE = 'Gymnast Beam';
const GAME_TAGLINE = 'Balance. Execute. Stick the landing.';

interface Signals {
  movesCompleted: number;  // beam moves successfully executed
  falls: number;           // times fallen off beam
  perfectMoves: number;    // moves timed within perfect window
  balanceTime: number;     // total frames on beam without wobble
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const perfect = sig.movesCompleted > 0 ? sig.perfectMoves / sig.movesCompleted : 0;
  if (perfect >= 0.8 && sig.falls === 0) return 'Perfect 10 🌟';
  if (sig.movesCompleted >= 12) return 'Floor General 🎖️';
  if (perfect >= 0.6) return 'Technique First 🎯';
  if (sig.falls <= 1) return 'Steady Gymnast 🤸';
  return 'Still Training 💪';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';
type MoveType = 'tap-center' | 'tap-left' | 'tap-right' | 'hold' | 'none';

interface GameState {
  running: boolean; timeLeft: number;
  sig: Signals; frame: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  // Balance
  balance: number;      // -1 (far left) to +1 (far right), 0 = center
  balanceSpeed: number; // how fast balance drifts
  // Gymnast
  gymnastX: number; // 0-1 along beam
  // Move prompt
  currentMove: MoveType;
  moveTimer: number;    // frames left to complete move
  moveDuration: number; // total frames for this move
  movePromptAlpha: number;
  waitingForInput: boolean;
  holdProgress: number; // 0-1 for hold moves
  isHolding: boolean;
}

export default function GymnastBeamGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { movesCompleted: 0, falls: 0, perfectMoves: 0, balanceTime: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    frame: 0, accentColor: ACCENT, floats: [],
    balance: 0, balanceSpeed: 0,
    gymnastX: 0.5,
    currentMove: 'none', moveTimer: 0, moveDuration: 80,
    movePromptAlpha: 0, waitingForInput: false,
    holdProgress: 0, isHolding: false,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const triggerMove = useCallback(() => {
    const s = stateRef.current;
    const moves: MoveType[] = ['tap-center', 'tap-left', 'tap-right', 'hold'];
    s.currentMove = moves[Math.floor(Math.random() * moves.length)];
    s.moveDuration = s.currentMove === 'hold' ? 120 : 90;
    s.moveTimer = s.moveDuration;
    s.waitingForInput = true;
    s.holdProgress = 0;
  }, []);

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
    s.sig = { movesCompleted: 0, falls: 0, perfectMoves: 0, balanceTime: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.frame = 0; s.floats = [];
    s.balance = 0; s.balanceSpeed = 0.005;
    s.gymnastX = 0.5;
    s.currentMove = 'none'; s.moveTimer = 0; s.waitingForInput = false;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    let moveSchedule = 0;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);
      s.frame++;

      // Background - gymnasium
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#1a0a18'); bg.addColorStop(1, '#0a0510');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      // Audience
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = `rgba(244,114,182,0.06)`;
        ctx.beginPath(); ctx.arc((i * 43 + 20) % W, 15 + (i % 3) * 12, 4, 0, Math.PI * 2); ctx.fill();
      }

      const beamY = H * 0.62;
      const beamW = W * 0.8;
      const beamX = W * 0.1;
      const beamThick = 16;

      // Beam shadow
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(beamX + 4, beamY + 4, beamW, beamThick);

      // Beam
      const beamGrad = ctx.createLinearGradient(0, beamY, 0, beamY + beamThick);
      beamGrad.addColorStop(0, '#d4a017'); beamGrad.addColorStop(1, '#8B6914');
      ctx.fillStyle = beamGrad;
      ctx.fillRect(beamX, beamY, beamW, beamThick);

      // Beam supports
      ctx.fillStyle = '#555'; ctx.fillRect(beamX + 30, beamY + beamThick, 12, 50);
      ctx.fillStyle = '#555'; ctx.fillRect(beamX + beamW - 42, beamY + beamThick, 12, 50);

      // Balance physics
      if (s.currentMove === 'none' || !s.waitingForInput) {
        s.balance += s.balanceSpeed;
        const drift = 0.002 + s.sig.movesCompleted * 0.0002;
        s.balanceSpeed += (Math.random() - 0.5) * drift;
        s.balanceSpeed = Math.max(-0.015, Math.min(0.015, s.balanceSpeed));
        s.balance = Math.max(-1.2, Math.min(1.2, s.balance));
      }

      // Warn if imbalanced
      const absBalance = Math.abs(s.balance);
      if (absBalance > 0.7 && s.frame % 20 === 0) hapticWarning();

      // Fall off beam
      if (absBalance > 1.0) {
        s.sig.falls++;
        s.sig.streakCurrent = 0;
        s.balance = (Math.random() - 0.5) * 0.3;
        s.balanceSpeed = 0;
        s.floats.push({ x: W / 2, y: beamY - 30, text: 'FELL! -1', alpha: 1, vy: -3, color: '#ef4444' });
        sfx.collision(); hapticFail();
      } else {
        s.sig.balanceTime++;
      }

      // Gymnast body
      const gx = beamX + s.gymnastX * beamW;
      const tiltAngle = s.balance * 0.3; // body tilts with balance
      const gy = beamY - 2;

      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(tiltAngle);
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 3;
      // Head
      ctx.beginPath(); ctx.arc(0, -52, 9, 0, Math.PI * 2); ctx.stroke();
      // Body
      ctx.beginPath(); ctx.moveTo(0, -43); ctx.lineTo(0, -18); ctx.stroke();
      // Arms
      const armSwing = s.currentMove !== 'none' && s.waitingForInput ? Math.sin(s.frame * 0.2) * 0.5 : 0;
      ctx.beginPath(); ctx.moveTo(0, -35); ctx.lineTo(-20 + armSwing * 10, -25); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -35); ctx.lineTo(20 + armSwing * 10, -25); ctx.stroke();
      // Legs
      ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(-12, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(12, 0); ctx.stroke();
      ctx.restore();

      // Balance indicator bar
      const barY = H * 0.15;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(W / 2 - 80, barY, 160, 14);
      const balColor = absBalance > 0.7 ? '#ef4444' : absBalance > 0.4 ? '#fbbf24' : '#4ade80';
      const balW = s.balance * 70;
      ctx.fillStyle = balColor;
      ctx.fillRect(W / 2, barY, balW, 14);
      ctx.strokeStyle = '#ffffff40'; ctx.lineWidth = 1; ctx.strokeRect(W / 2 - 80, barY, 160, 14);
      // Center mark
      ctx.fillStyle = '#ffffff'; ctx.fillRect(W / 2 - 1, barY - 2, 2, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('BALANCE', W / 2, barY - 4);

      // Move prompt
      moveSchedule--;
      if (moveSchedule <= 0 && s.currentMove === 'none') {
        moveSchedule = 120 + Math.random() * 80;
        triggerMove();
      }

      if (s.currentMove !== 'none' && s.waitingForInput) {
        s.moveTimer--;
        const pct = s.moveTimer / s.moveDuration;

        // Move instruction
        const labels: Record<MoveType, string> = {
          'tap-center': 'TAP CENTER 🎯',
          'tap-left': '⬅️ TAP LEFT',
          'tap-right': 'TAP RIGHT ➡️',
          'hold': 'HOLD! 🤲',
          'none': '',
        };

        const urgency = pct < 0.3 ? '#ef4444' : pct < 0.6 ? '#fbbf24' : '#4ade80';
        ctx.fillStyle = urgency;
        ctx.font = `bold ${Math.min(24, W * 0.06)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(labels[s.currentMove], W / 2, H * 0.1);

        // Timer arc
        ctx.strokeStyle = urgency; ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(W / 2, H * 0.1 + 15, 20, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
        ctx.stroke();

        // Hold progress
        if (s.currentMove === 'hold' && s.isHolding) {
          s.holdProgress = Math.min(1, s.holdProgress + 0.015);
          ctx.fillStyle = ACCENT; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(`${Math.round(s.holdProgress * 100)}%`, W / 2, H * 0.1 + 40);
        }

        // Auto-fail if timer runs out
        if (s.moveTimer <= 0) {
          s.currentMove = 'none';
          s.waitingForInput = false;
          s.sig.streakCurrent = 0;
          s.floats.push({ x: W / 2, y: H * 0.3, text: 'TOO SLOW!', alpha: 1, vy: -2, color: '#ef4444' });
          sfx.collision(); hapticFail();
        }
      }

      // Floats
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
  }, [endGame, triggerMove]);

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
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const W = canvas.width;

      if (s.currentMove === 'hold') {
        s.isHolding = true;
        return;
      }

      if (!s.waitingForInput || s.currentMove === 'none') {
        // Balance correction - tap to nudge balance
        if (px < W / 2) s.balance -= 0.1;
        else s.balance += 0.1;
        return;
      }

      const isLeft = px < W / 2;
      const isCenter = px > W * 0.3 && px < W * 0.7;

      let success = false;
      if (s.currentMove === 'tap-center' && isCenter) success = true;
      if (s.currentMove === 'tap-left' && isLeft) success = true;
      if (s.currentMove === 'tap-right' && !isLeft) success = true;

      const pct = s.moveTimer / s.moveDuration;
      const isPerfect = pct > 0.5;

      if (success) {
        s.sig.movesCompleted++;
        if (isPerfect) s.sig.perfectMoves++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const pts = isPerfect ? 3 : 2;
        const combo = s.sig.streakCurrent >= 3 ? 1 : 0;
        s.sig.score += pts + combo;
        setScoreDisplay(s.sig.score);
        s.balance *= 0.5; // good execution steadies balance
        sfx.collect(); hapticScore();
        if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
        s.floats.push({ x: W / 2, y: canvas.height * 0.3, text: `+${pts + combo}${isPerfect ? ' ✨' : ''}`, alpha: 1, vy: -2.5, color: '#fbbf24' });
      } else {
        s.sig.streakCurrent = 0;
        s.balance += (Math.random() - 0.5) * 0.4; // wrong tap destabilizes
        sfx.collision(); hapticFail();
        s.floats.push({ x: W / 2, y: canvas.height * 0.3, text: 'WRONG SIDE!', alpha: 1, vy: -2, color: '#ef4444' });
      }

      s.currentMove = 'none'; s.waitingForInput = false;
    };

    const onPointerUp = () => {
      const s = stateRef.current;
      if (s.currentMove === 'hold' && s.isHolding) {
        s.isHolding = false;
        if (s.holdProgress >= 0.7) {
          s.sig.movesCompleted++;
          if (s.holdProgress >= 0.95) s.sig.perfectMoves++;
          s.sig.streakCurrent++;
          if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
          const pts = s.holdProgress >= 0.95 ? 4 : 2;
          s.sig.score += pts; setScoreDisplay(s.sig.score);
          sfx.collect(); hapticScore();
          s.floats.push({ x: canvas.width / 2, y: canvas.height * 0.3, text: `+${pts} HELD!`, alpha: 1, vy: -2.5, color: ACCENT });
        } else {
          sfx.collision(); hapticFail();
          s.floats.push({ x: canvas.width / 2, y: canvas.height * 0.3, text: 'HOLD LONGER!', alpha: 1, vy: -2, color: '#ef4444' });
        }
        s.currentMove = 'none'; s.waitingForInput = false; s.holdProgress = 0;
      }
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
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Stay balanced on the beam and execute moves when prompted!" ctaLabel="Mount! 🤸" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Gymnast Beam game canvas" />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Moves Done', value: String(finalSig.movesCompleted), color: ACCENT },
            { label: 'Perfect', value: String(finalSig.perfectMoves), color: '#fbbf24' },
            { label: 'Falls', value: String(finalSig.falls), color: finalSig.falls === 0 ? '#4ade80' : '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.movesCompleted >= 8 && finalSig.falls <= 2} />
      )}
    </GameShell>
  );
}
