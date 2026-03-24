'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticTick } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'pendulum-swing';
const ACCENT = '#a855f7';
const DURATION = 60;
const GAME_EMOJI = '🕰️';
const GAME_TITLE = 'Pendulum Swing';
const GAME_TAGLINE = 'Keep the rhythm. Don\'t let it stop.';

interface Signals {
  totalSwings: number; rhythmicSwings: number; misTimedSwings: number;
  maxAmplitude: number; maxStreak: number; streakCurrent: number; score: number;
}

function getPersonality(sig: Signals): string {
  const rhythm = sig.totalSwings > 0 ? sig.rhythmicSwings / sig.totalSwings : 0;
  if (rhythm >= 0.8 && sig.maxAmplitude >= 150) return 'Maestro 🎵';
  if (sig.maxStreak >= 8) return 'In the Zone 🌀';
  if (rhythm >= 0.6) return 'Steady Beat 🥁';
  if (sig.totalSwings >= 20) return 'Persistent 💪';
  return 'Finding the Rhythm 🎶';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  angle: number; angularVelocity: number; pivotX: number; pivotY: number; length: number;
  targetZoneMin: number; targetZoneMax: number; lastPeakSide: number;
  isAtPeak: boolean; pushWindow: boolean; pushWindowTimer: number;
  accentColor: string; floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  scorePop: number; frame: number; amplitude: number; maxAmplitudeReached: number;
}

export default function PendulumSwing() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalSwings: 0, rhythmicSwings: 0, misTimedSwings: 0, maxAmplitude: 0, maxStreak: 0, streakCurrent: 0, score: 0 },
    angle: 0.3, angularVelocity: 0.02, pivotX: 0, pivotY: 0, length: 200,
    targetZoneMin: 0, targetZoneMax: 0, lastPeakSide: 0,
    isAtPeak: false, pushWindow: false, pushWindowTimer: 0,
    accentColor: ACCENT, floats: [], scorePop: 0, frame: 0, amplitude: 0.3, maxAmplitudeReached: 0,
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
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
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
    s.sig = { totalSwings: 0, rhythmicSwings: 0, misTimedSwings: 0, maxAmplitude: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.pivotX = W / 2; s.pivotY = H * 0.18;
    s.length = Math.min(W, H) * 0.45;
    s.angle = 0.4; s.angularVelocity = 0.01;
    s.amplitude = 0.4; s.frame = 0; s.floats = []; s.scorePop = 0;
    s.lastPeakSide = 0; s.pushWindow = false;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const DAMPING = 0.998;
    const GRAVITY = 0.0025;
    let prevAngularVelocity = 0;

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);
      s.frame++;

      // Background: dark clock tower
      ctx.fillStyle = '#0a0810';
      ctx.fillRect(0, 0, W, H);

      // Ornate grid
      ctx.strokeStyle = 'rgba(168,85,247,0.05)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
      for (let gy = 0; gy < H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

      // Physics
      const g = GRAVITY;
      s.angularVelocity -= Math.sin(s.angle) * g;
      s.angularVelocity *= DAMPING;
      s.angle += s.angularVelocity;

      // Detect peak (velocity sign change)
      const newSide = s.angularVelocity < 0 ? -1 : 1;
      if (Math.sign(s.angularVelocity) !== Math.sign(prevAngularVelocity) && prevAngularVelocity !== 0) {
        // Just passed peak on one side
        s.pushWindow = true;
        s.pushWindowTimer = 30;
        s.lastPeakSide = newSide;
        s.sig.totalSwings++;
        hapticTick();
      }
      if (s.pushWindowTimer > 0) s.pushWindowTimer--;
      else s.pushWindow = false;
      prevAngularVelocity = s.angularVelocity;

      const bobX = s.pivotX + Math.sin(s.angle) * s.length;
      const bobY = s.pivotY + Math.cos(s.angle) * s.length;
      const currentAmp = Math.abs(s.angle);
      s.maxAmplitudeReached = Math.max(s.maxAmplitudeReached, currentAmp * s.length);

      // Target zone arcs
      const tMin = 0.35, tMax = 0.65;
      ctx.save();
      ctx.strokeStyle = `rgba(168,85,247,${s.pushWindow ? 0.6 : 0.2})`;
      ctx.lineWidth = 3;
      const arcLeft = -tMax, arcRight = tMax;
      ctx.beginPath();
      ctx.arc(s.pivotX, s.pivotY, s.length, Math.PI / 2 + arcLeft, Math.PI / 2 + arcRight - Math.PI * 0.4);
      ctx.stroke();
      ctx.restore();

      // Pivot
      ctx.save();
      ctx.fillStyle = '#4a4060';
      ctx.shadowBlur = 8; ctx.shadowColor = ACCENT;
      ctx.beginPath(); ctx.arc(s.pivotX, s.pivotY, 10, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Rod
      ctx.save();
      ctx.strokeStyle = s.accentColor + '88';
      ctx.lineWidth = 3;
      ctx.shadowBlur = 6; ctx.shadowColor = ACCENT;
      ctx.beginPath(); ctx.moveTo(s.pivotX, s.pivotY); ctx.lineTo(bobX, bobY); ctx.stroke();
      ctx.restore();

      // Bob with amplitude glow
      const glowIntensity = Math.min(1, currentAmp / 0.6);
      ctx.save();
      ctx.shadowBlur = 20 + glowIntensity * 20;
      ctx.shadowColor = ACCENT;
      const bobGrad = ctx.createRadialGradient(bobX - 6, bobY - 6, 2, bobX, bobY, 22);
      bobGrad.addColorStop(0, '#e879f9');
      bobGrad.addColorStop(1, '#7c3aed');
      ctx.fillStyle = bobGrad;
      ctx.beginPath(); ctx.arc(bobX, bobY, 22, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffffff33';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bobX, bobY, 22, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();

      // Amplitude meter (right side)
      const meterH = H * 0.4;
      const meterY = H * 0.3;
      const meterX = W - 30;
      const ampPct = Math.min(1, currentAmp / 0.8);
      ctx.fillStyle = '#1a1030';
      ctx.fillRect(meterX - 8, meterY, 16, meterH);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(meterX - 8, meterY + meterH * (1 - ampPct), 16, meterH * ampPct);
      ctx.strokeStyle = ACCENT + '44';
      ctx.lineWidth = 1;
      ctx.strokeRect(meterX - 8, meterY, 16, meterH);

      // Push window indicator
      if (s.pushWindow) {
        ctx.save();
        ctx.fillStyle = '#a855f7';
        ctx.globalAlpha = 0.7;
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('TAP! 🔵', W / 2, H * 0.88);
        ctx.restore();
      }

      // Amplitude score drain
      if (s.frame % 120 === 0 && s.running) {
        const ampScore = Math.round(currentAmp * s.length / 10);
        if (ampScore > 0) {
          s.sig.score += ampScore;
          s.sig.sig?.maxAmplitude; // no-op just reference
          if (currentAmp * s.length > s.sig.maxAmplitude) s.sig.maxAmplitude = currentAmp * s.length;
          s.scorePop = Date.now() + 300;
          setScoreDisplay(s.sig.score);
        }
        if (currentAmp < 0.05) {
          // Too slow - end
          hapticFail();
          sfx.fail();
          endGame();
        }
      }

      // Score pop
      if (s.scorePop > Date.now()) {
        const t = (s.scorePop - Date.now()) / 300;
        ctx.save(); ctx.globalAlpha = t;
        ctx.font = `bold ${Math.round(36 * (1 + (1 - t) * 0.3))}px sans-serif`;
        ctx.fillStyle = ACCENT; ctx.textAlign = 'center';
        ctx.fillText(`${s.sig.score}`, W / 2, 80); ctx.restore();
      }

      // Float texts
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha;
        ctx.fillStyle = f.color; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center';
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

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.pushWindow) {
        s.sig.misTimedSwings++;
        sfx.collision();
        s.floats.push({ x: s.pivotX, y: s.pivotY + 50, text: 'Wrong timing!', alpha: 1, vy: -1.5, color: '#ef4444' });
        return;
      }
      // Push the pendulum in direction of travel
      const pushForce = 0.04;
      s.angularVelocity += s.lastPeakSide > 0 ? pushForce : -pushForce;
      s.sig.rhythmicSwings++;
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
      s.sig.score += 2 * mult;
      s.scorePop = Date.now() + 300;
      setScoreDisplay(s.sig.score);
      sfx.collect();
      hapticScore();
      s.floats.push({ x: s.pivotX, y: s.pivotY + 50, text: `+${2 * mult} ✨`, alpha: 1, vy: -2, color: '#a855f7' });
      s.pushWindow = false;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
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
          ctaLabel="Swing! 🕰️" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
            role="img" aria-label="Pendulum swing game canvas" />
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
            { label: 'Rhythmic Swings', value: String(finalSig.rhythmicSwings), color: ACCENT },
            { label: 'Mis-timed', value: String(finalSig.misTimedSwings), color: '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
            { label: 'Max Amplitude', value: `${Math.round(finalSig.maxAmplitude)}px`, color: '#4ade80' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.rhythmicSwings >= 10} />
      )}
    </GameShell>
  );
}
