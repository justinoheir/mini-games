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

const GAME_ID = 'pole-vault';
const ACCENT = '#a3e635';
const DURATION = 45;
const GAME_EMOJI = '🏃';
const GAME_TITLE = 'Pole Vault';
const GAME_TAGLINE = 'Run. Plant. Fly. Clear it!';

// Behavioral signals
interface Signals {
  attempts: number;          // total vault attempts
  cleared: number;           // bars cleared
  bestHeight: number;        // highest bar cleared (in px)
  runEfficiency: number;     // avg run speed score (0-1)
  plantAccuracy: number;     // sum of plant timing accuracy
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const clearRate = sig.attempts > 0 ? sig.cleared / sig.attempts : 0;
  if (clearRate >= 0.8 && sig.bestHeight > 300) return 'World Record 🏆';
  if (sig.cleared >= 8) return 'Vaulting Legend 🌟';
  if (clearRate >= 0.6) return 'Technique Pro 🎯';
  if (sig.runEfficiency > 0.7) return 'Speed Merchant ⚡';
  return 'Still Climbing 💪';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';
type VaultPhase = 'run' | 'plant' | 'vault' | 'result';

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  frame: number;
  accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  // Vault state
  vaultPhase: VaultPhase;
  runSpeed: number;        // 0-1, built by holding/swiping
  runProgress: number;     // 0-1, athlete position on track
  plantTiming: number;     // 0-1, how accurate the plant was
  vaultAngle: number;      // degrees, 0=flat, 90=top
  barHeight: number;       // current bar height (pixels from bottom)
  cleared: boolean | null; // null = in progress
  resultTimer: number;     // frames to show result
  isDragging: boolean;
  dragStartX: number;
  dragStartY: number;
}

export default function PoleVaultGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { attempts: 0, cleared: 0, bestHeight: 0, runEfficiency: 0, plantAccuracy: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    frame: 0, accentColor: ACCENT, floats: [],
    vaultPhase: 'run', runSpeed: 0, runProgress: 0,
    plantTiming: 0, vaultAngle: 0,
    barHeight: 150, cleared: null, resultTimer: 0,
    isDragging: false, dragStartX: 0, dragStartY: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const nextAttempt = useCallback(() => {
    const s = stateRef.current;
    s.vaultPhase = 'run';
    s.runSpeed = 0; s.runProgress = 0;
    s.plantTiming = 0; s.vaultAngle = 0;
    s.cleared = null; s.resultTimer = 0;
    s.isDragging = false;
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
    s.running = true; s.timeLeft = DURATION;
    s.sig = { attempts: 0, cleared: 0, bestHeight: 0, runEfficiency: 0, plantAccuracy: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.frame = 0; s.floats = [];
    s.barHeight = 150;
    nextAttempt();
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); hapticVictory(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      s.frame++;

      // Athletic stadium background
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0a1a0a'); bg.addColorStop(1, '#051005');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      // Track surface
      ctx.fillStyle = '#8B3A2A';
      ctx.fillRect(0, H * 0.72, W, H * 0.28);
      ctx.fillStyle = '#A04030';
      ctx.fillRect(0, H * 0.72, W, 8);

      // Track lane lines
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const ly = H * 0.72 + (H * 0.28 / 4) * i;
        ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(W, ly); ctx.stroke();
      }

      // Crossbar (the bar to vault over)
      const barY = H - s.barHeight - 40;
      const poleX = W * 0.7;

      // Standards (uprights)
      ctx.strokeStyle = '#666'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(poleX - 40, H * 0.72); ctx.lineTo(poleX - 40, barY - 20); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(poleX + 40, H * 0.72); ctx.lineTo(poleX + 40, barY - 20); ctx.stroke();

      // Crossbar
      ctx.strokeStyle = s.cleared === false ? '#ef4444' : s.cleared === true ? '#4ade80' : '#ffffff';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(poleX - 50, barY); ctx.lineTo(poleX + 50, barY); ctx.stroke();

      // Bar height indicator
      ctx.fillStyle = 'rgba(163,230,53,0.8)';
      ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(`Bar: ${Math.round(s.barHeight / 3)}m`, W - 10, barY - 8);

      if (s.vaultPhase === 'run') {
        // Show "RUN!" instruction and speed gauge
        const athleteX = 30 + s.runProgress * (poleX - 80);
        const athleteY = H * 0.72 - 24;

        // Athlete (simple stick figure running)
        ctx.save();
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 3;
        const legSwing = Math.sin(s.frame * 0.3) * 15;
        // Body
        ctx.beginPath(); ctx.moveTo(athleteX, athleteY - 20); ctx.lineTo(athleteX, athleteY); ctx.stroke();
        // Head
        ctx.beginPath(); ctx.arc(athleteX, athleteY - 26, 7, 0, Math.PI * 2); ctx.stroke();
        // Legs
        ctx.beginPath(); ctx.moveTo(athleteX, athleteY);
        ctx.lineTo(athleteX - legSwing, athleteY + 18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(athleteX, athleteY);
        ctx.lineTo(athleteX + legSwing, athleteY + 18); ctx.stroke();
        // Pole (held)
        ctx.strokeStyle = '#d4a017'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(athleteX + 5, athleteY - 10);
        ctx.lineTo(athleteX + 50, athleteY + 10); ctx.stroke();
        ctx.restore();

        // Speed gauge
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(W / 2 - 80, H * 0.1, 160, 20);
        ctx.fillStyle = s.runSpeed > 0.7 ? '#4ade80' : s.runSpeed > 0.4 ? '#fbbf24' : '#ef4444';
        ctx.fillRect(W / 2 - 80, H * 0.1, 160 * s.runSpeed, 20);
        ctx.strokeStyle = '#ffffff40'; ctx.lineWidth = 1;
        ctx.strokeRect(W / 2 - 80, H * 0.1, 160, 20);

        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('SWIPE RIGHT TO RUN →', W / 2, H * 0.1 - 8);

        // Athlete progresses with run speed
        if (s.isDragging) {
          s.runProgress = Math.min(1, s.runProgress + s.runSpeed * 0.015);
        }

        // Plant zone indicator (when athlete is near the pit)
        if (s.runProgress > 0.75) {
          const plantPct = (s.runProgress - 0.75) / 0.25;
          ctx.fillStyle = `rgba(163,230,53,${0.3 + plantPct * 0.5})`;
          ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('TAP TO PLANT!', W / 2, H * 0.55);
        }

      } else if (s.vaultPhase === 'plant') {
        // Show plant timing arc
        const athleteX = poleX - 60;
        const athleteY = H * 0.72 - 24;
        s.vaultAngle += 2;

        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('TAP AT PERFECT ANGLE!', W / 2, H * 0.15);

        // Moving plant angle indicator
        const angle = (s.vaultAngle % 180) * Math.PI / 180;
        const perfect = Math.PI * 0.45; // ~81 degrees is perfect
        const accuracy = 1 - Math.abs(angle - perfect) / perfect;

        // Arc indicator
        ctx.save();
        ctx.translate(athleteX, athleteY);
        ctx.strokeStyle = accuracy > 0.8 ? '#4ade80' : accuracy > 0.5 ? '#fbbf24' : '#ef4444';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(angle - Math.PI / 2) * 80, Math.sin(angle - Math.PI / 2) * 80);
        ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.arc(Math.cos(angle - Math.PI / 2) * 80, Math.sin(angle - Math.PI / 2) * 80, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Perfect zone arc
        ctx.save(); ctx.translate(athleteX, athleteY);
        ctx.strokeStyle = 'rgba(74,222,128,0.3)'; ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(0, 0, 80, -Math.PI * 0.5 - 0.2, -Math.PI * 0.5 + 0.2);
        ctx.stroke();
        ctx.restore();

      } else if (s.vaultPhase === 'vault') {
        // Animate the vault
        s.vaultAngle += 2.5 * s.runSpeed;
        const vaultPct = Math.min(1, s.vaultAngle / 100);
        const vaultX = poleX - 60 + vaultPct * 80;
        const vaultY = H * 0.72 - 30 - Math.sin(vaultPct * Math.PI) * (s.barHeight + 50);

        // Athlete vault arc
        ctx.save();
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 3;
        // Simple figure at arc position
        ctx.beginPath(); ctx.arc(vaultX, vaultY, 10, 0, Math.PI * 2); ctx.stroke();
        // Body
        const bodyAngle = vaultPct * Math.PI;
        ctx.beginPath();
        ctx.moveTo(vaultX, vaultY + 10);
        ctx.lineTo(vaultX + Math.sin(bodyAngle) * 20, vaultY + 10 + Math.cos(bodyAngle) * 20);
        ctx.stroke();
        ctx.restore();

        // Pole
        ctx.strokeStyle = '#d4a017'; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(poleX - 100, H * 0.72);
        ctx.lineTo(vaultX - 5, vaultY + 8);
        ctx.stroke();

        if (vaultPct >= 1) {
          // Check if cleared
          const athleteHighestY = H * 0.72 - 30 - (s.barHeight + 50);
          s.cleared = athleteHighestY <= barY;
          s.resultTimer = 60;
          s.vaultPhase = 'result';
          s.sig.attempts++;
          if (s.cleared) {
            s.sig.cleared++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            if (s.barHeight > s.sig.bestHeight) s.sig.bestHeight = s.barHeight;
            const pts = Math.ceil(s.barHeight / 30) + (s.sig.streakCurrent >= 3 ? 2 : 0);
            s.sig.score += pts;
            setScoreDisplay(s.sig.score);
            s.floats.push({ x: W / 2, y: H * 0.3, text: `+${pts} CLEARED!`, alpha: 1, vy: -3, color: '#4ade80' });
            sfx.collect(); hapticScore();
            if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
            s.barHeight = Math.min(s.barHeight + 20, s.barHeight + Math.floor(s.sig.cleared / 3) * 15 + 20);
          } else {
            s.sig.streakCurrent = 0;
            s.floats.push({ x: W / 2, y: H * 0.3, text: 'KNOCKED!', alpha: 1, vy: -3, color: '#ef4444' });
            sfx.collision(); hapticFail();
          }
        }
      } else if (s.vaultPhase === 'result') {
        s.resultTimer--;
        ctx.fillStyle = s.cleared ? 'rgba(74,222,128,0.15)' : 'rgba(239,68,68,0.15)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = s.cleared ? '#4ade80' : '#ef4444';
        ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(s.cleared ? '✓ CLEARED!' : '✗ KNOCKED', W / 2, H / 2);
        if (s.resultTimer <= 0) nextAttempt();
      }

      // Floats
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha;
        ctx.fillStyle = f.color; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.95;
      });

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, nextAttempt]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      s.isDragging = true;
      s.dragStartX = e.clientX; s.dragStartY = e.clientY;
      if (s.vaultPhase === 'run' && s.runProgress > 0.75) {
        // Plant!
        s.vaultPhase = 'plant';
        s.vaultAngle = 0;
        sfx.collect();
        hapticImpact();
      } else if (s.vaultPhase === 'plant') {
        // Record plant timing accuracy
        const angle = (s.vaultAngle % 180) * Math.PI / 180;
        const perfect = Math.PI * 0.45;
        s.plantTiming = Math.max(0, 1 - Math.abs(angle - perfect) / perfect);
        s.sig.plantAccuracy += s.plantTiming;
        s.vaultPhase = 'vault';
        s.vaultAngle = 0;
        sfx.collect();
        hapticScore();
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.isDragging || s.vaultPhase !== 'run') return;
      const dx = e.clientX - s.dragStartX;
      if (dx > 0) {
        s.runSpeed = Math.min(1, s.runSpeed + dx * 0.003);
        s.sig.runEfficiency = s.runSpeed;
        s.dragStartX = e.clientX;
      }
    };

    const onPointerUp = () => {
      const s = stateRef.current;
      s.isDragging = false;
      if (s.vaultPhase === 'run') s.runSpeed = Math.max(0, s.runSpeed - 0.1);
    };

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

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Swipe right to run, tap to plant the pole, vault over the bar!" ctaLabel="Vault! 🏃" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Pole Vault game canvas" />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Cleared', value: `${finalSig.cleared}/${finalSig.attempts}`, color: ACCENT },
            { label: 'Best Height', value: `${Math.round(finalSig.bestHeight / 3)}m`, color: '#fbbf24' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' },
            { label: 'Plant Avg', value: `${finalSig.attempts > 0 ? Math.round(finalSig.plantAccuracy / finalSig.attempts * 100) : 0}%`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.cleared >= 5} />
      )}
    </GameShell>
  );
}
