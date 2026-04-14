'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'mirror-dance';
const ACCENT = '#ec4899';
const DURATION = 60;
const GAME_EMOJI = '🪩';
const GAME_TITLE = 'Mirror Dance';
const GAME_TAGLINE = 'Match the mirror. Move with the beat.';

interface Signals {
  correct: number; wrong: number; maxStreak: number;
  streakCurrent: number; reactionTimes: number[]; score: number;
}
function getPersonality(sig: Signals): string {
  const acc = (sig.correct + sig.wrong) > 0 ? sig.correct / (sig.correct + sig.wrong) : 0;
  const avgRT = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length : 999;
  if (acc >= 0.9 && avgRT < 400) return 'Mirror Master 🪩';
  if (sig.maxStreak >= 8) return 'On Fire 🔥';
  if (acc >= 0.75) return 'Smooth Mover 💃';
  if (sig.correct >= 10) return 'Getting Groovy 🎵';
  return 'Finding the Beat 🥁';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GState {
  running: boolean; timeLeft: number; sig: Signals;
  currentDir: 'left' | 'right' | null;
  promptAt: number; timeoutMs: number;
  answered: boolean; flashColor: string | null; flashUntil: number;
  beatPhase: number;
}

function MirrorDanceInner() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animRef = useRef<number>(0);
  const stateRef = useRef<GState>({
    running: false, timeLeft: DURATION,
    sig: { correct: 0, wrong: 0, maxStreak: 0, streakCurrent: 0, reactionTimes: [], score: 0 },
    currentDir: null, promptAt: 0, timeoutMs: 1400,
    answered: false, flashColor: null, flashUntil: 0,
    beatPhase: 0,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    cancelAnimationFrame(animRef.current);
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const nextPrompt = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    s.currentDir = Math.random() < 0.5 ? 'left' : 'right';
    s.promptAt = Date.now();
    s.answered = false;
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { correct: 0, wrong: 0, maxStreak: 0, streakCurrent: 0, reactionTimes: [], score: 0 };
    s.timeoutMs = 1400; s.beatPhase = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail?.(); endGame(); }
    }, 1000);

    nextPrompt();

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      if (!s.running) return;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      const dpr = window.devicePixelRatio || 1; const W = canvas.offsetWidth, H = canvas.offsetHeight; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Background gradient
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0f0520');
      bg.addColorStop(1, '#1a0535');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const now = Date.now();
      s.beatPhase = (s.beatPhase + 0.03) % (Math.PI * 2);

      // Mirror line down center
      ctx.save();
      ctx.strokeStyle = 'rgba(236,72,153,0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
      ctx.stroke(); ctx.setLineDash([]); ctx.restore();

      // Flash overlay
      if (now < s.flashUntil && s.flashColor) {
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = s.flashColor;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }

      // Draw silhouette on LEFT side (the "source")
      const cxLeft = W * 0.25;
      const cxRight = W * 0.75;
      const cy = H * 0.42;
      const sc = Math.min(W, H) * 0.0022;

      // Silhouette dancer
      const drawFigure = (cx: number, mirrored: boolean, dir: 'left' | 'right' | null, highlight: boolean) => {
        ctx.save();
        ctx.translate(cx, cy);
        if (mirrored) ctx.scale(-1, 1);
        const pulse = 1 + Math.sin(s.beatPhase) * 0.04;
        ctx.scale(pulse, pulse);

        const glowColor = highlight ? '#ec4899' : '#a855f7';
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = highlight ? 30 : 15;
        ctx.fillStyle = highlight ? '#f0abca' : '#c084fc';

        // Body
        ctx.beginPath();
        ctx.ellipse(0, 0, 18 * sc, 28 * sc, 0, 0, Math.PI * 2);
        ctx.fill();
        // Head
        ctx.beginPath();
        ctx.arc(0, -36 * sc, 12 * sc, 0, Math.PI * 2);
        ctx.fill();

        // Arm direction
        const armAngle = dir === 'left' ? -Math.PI * 0.7 : (dir === 'right' ? -Math.PI * 0.3 : -Math.PI * 0.5);
        ctx.save();
        ctx.rotate(armAngle);
        ctx.beginPath();
        ctx.ellipse(0, -22 * sc, 6 * sc, 20 * sc, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Legs
        ctx.save(); ctx.rotate(dir === 'left' ? 0.3 : -0.3);
        ctx.beginPath(); ctx.ellipse(-8 * sc, 28 * sc, 5 * sc, 18 * sc, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.save(); ctx.rotate(dir === 'left' ? -0.3 : 0.3);
        ctx.beginPath(); ctx.ellipse(8 * sc, 28 * sc, 5 * sc, 18 * sc, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        ctx.restore();
      };

      drawFigure(cxLeft, false, s.currentDir, false);
      drawFigure(cxRight, true, s.currentDir, true);

      // Direction arrow under left figure
      if (s.currentDir) {
        ctx.save();
        const arrowX = cxLeft + (s.currentDir === 'left' ? -60 : 60) * sc;
        ctx.font = `bold ${Math.round(40 * sc)}px 'Space Grotesk', Arial, sans-serif`;
        ctx.fillStyle = '#ec4899';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#ec4899'; ctx.shadowBlur = 20;
        ctx.fillText(s.currentDir === 'left' ? '←' : '→', arrowX, cy + 80 * sc);
        ctx.restore();
      }

      // Timer bar for current prompt
      if (!s.answered && s.currentDir) {
        const elapsed = now - s.promptAt;
        const frac = Math.max(0, 1 - elapsed / s.timeoutMs);
        const barW = W * 0.7;
        const barX = (W - barW) / 2;
        const barY = H * 0.78;
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.roundRect(barX, barY, barW, 8, 4); ctx.fill();
        const col = frac > 0.4 ? '#ec4899' : '#ef4444';
        ctx.fillStyle = col;
        ctx.roundRect(barX, barY, barW * frac, 8, 4); ctx.fill();
        ctx.restore();
      }

      // Labels
      ctx.save();
      ctx.font = `bold ${Math.round(16 * sc)}px 'Space Grotesk', Arial, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.textAlign = 'center';
      ctx.fillText('MIRROR', cxRight, cy + 90 * sc);
      ctx.restore();

      // Tap prompts at bottom
      ctx.save();
      ctx.font = `bold ${Math.round(24 * sc)}px 'Space Grotesk', Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('TAP LEFT', W * 0.25, H * 0.9);
      ctx.fillText('TAP RIGHT', W * 0.75, H * 0.9);
      ctx.restore();

      // Timeout check
      if (!s.answered && s.currentDir && (now - s.promptAt) > s.timeoutMs) {
        s.sig.wrong++; s.sig.streakCurrent = 0;
        s.flashColor = '#ef4444'; s.flashUntil = now + 300;
        sfx.fail?.(); hapticFail();
        s.timeoutMs = Math.max(600, s.timeoutMs - 10);
        nextPrompt();
      }
    };
    draw();
  }, [endGame, nextPrompt]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || phase !== 'playing') return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);

    const handleTap = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running || s.answered || !s.currentDir) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const isLeft = x < canvas.width / 2;
      const tapped: 'left' | 'right' = isLeft ? 'left' : 'right';
      const rt = Date.now() - s.promptAt;
      s.answered = true;

      if (tapped === s.currentDir) {
        s.sig.correct++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        s.sig.reactionTimes.push(rt);
        const bonus = s.sig.streakCurrent >= 3 ? 2 : 1;
        s.sig.score += 10 * bonus;
        setScoreDisplay(s.sig.score);
        s.flashColor = '#22c55e'; s.flashUntil = Date.now() + 250;
        sfx.success?.(); hapticScore();
        s.timeoutMs = Math.max(600, s.timeoutMs - 20);
      } else {
        s.sig.wrong++; s.sig.streakCurrent = 0;
        s.flashColor = '#ef4444'; s.flashUntil = Date.now() + 300;
        sfx.fail?.(); hapticFail();
      }
      setTimeout(() => { if (s.running) nextPrompt(); }, 350);
    };
    canvas.addEventListener('pointerdown', handleTap);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', handleTap);
    };
  }, [phase, nextPrompt]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    cancelAnimationFrame(animRef.current);
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const acc = finalSig ? (finalSig.correct + finalSig.wrong > 0 ? Math.round(finalSig.correct / (finalSig.correct + finalSig.wrong) * 100) : 0) : 0;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="Watch the silhouette move left or right — tap the matching side to mirror it! Speed increases. Stay sharp."
          ctaLabel="Start Dancing 🪩" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Correct', value: String(finalSig.correct), color: '#22c55e' },
            { label: 'Accuracy', value: `${acc}%`, color: ACCENT },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#a855f7' },
            { label: 'Missed', value: String(finalSig.wrong), color: '#ef4444' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.correct >= 15} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const MirrorDance = dynamic(() => Promise.resolve({ default: MirrorDanceInner }), { ssr: false });
export default MirrorDance;
