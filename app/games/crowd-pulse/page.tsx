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
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'crowd-pulse';
const ACCENT = '#a855f7';
const DURATION = 60;
const GAME_EMOJI = '💜';
const GAME_TITLE = 'Crowd Pulse';
const GAME_TAGLINE = 'Feel the room.';

interface Signals { taps: number; perfectSync: number; earlyTaps: number; lateTaps: number; maxStreak: number; score: number; }
function getPersonality(sig: Signals): string {
  const pct = sig.taps > 0 ? sig.perfectSync / sig.taps : 0;
  if (pct >= 0.75 && sig.maxStreak >= 8) return 'Pulse Master 💜';
  if (sig.maxStreak >= 6) return 'In the Zone 🌀';
  if (pct >= 0.5) return 'Rhythm Reader 🎵';
  if (sig.taps >= 15) return 'Feeling It 🕺';
  return 'Finding the Beat 🥁';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GState {
  running: boolean; timeLeft: number; sig: Signals;
  pulsePhase: number; bpm: number; streak: number;
  lastTapResult: string | null; lastTapAt: number;
  flashColor: string | null; flashUntil: number;
  outerRings: Array<{ r: number; alpha: number }>;
}

// BPM starts at 60, increases over time
function getBpm(elapsed: number): number {
  return 60 + Math.floor(elapsed / 8) * 6; // +6 BPM every 8 seconds
}

function CrowdPulseInner() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const stateRef = useRef<GState>({
    running: false, timeLeft: DURATION,
    sig: { taps: 0, perfectSync: 0, earlyTaps: 0, lateTaps: 0, maxStreak: 0, score: 0 },
    pulsePhase: 0, bpm: 60, streak: 0,
    lastTapResult: null, lastTapAt: 0,
    flashColor: null, flashUntil: 0,
    outerRings: [],
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

  const handleTap = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    const now = Date.now();
    const elapsed = (now - startTimeRef.current) / 1000;
    s.bpm = getBpm(elapsed);
    const beatInterval = 60000 / s.bpm; // ms per beat

    // Calculate phase at tap time (0 = peak, 0.5 = trough)
    // pulsePhase goes 0→1 per beat cycle
    const phaseAtTap = s.pulsePhase % 1;
    // Peak is at phase ~0, trough at ~0.5
    // We want taps near phase 0 (peak expansion)
    const distFromPeak = Math.min(phaseAtTap, 1 - phaseAtTap);

    s.sig.taps++;
    let pts = 0;
    let label = '';
    const now2 = Date.now();

    if (distFromPeak < 0.08) {
      pts = 50; label = 'PERFECT!'; s.sig.perfectSync++;
      s.streak++; if (s.streak > s.sig.maxStreak) s.sig.maxStreak = s.streak;
      sfx.success?.(); hapticScore();
      s.flashColor = '#22c55e';
      s.outerRings.push({ r: 0, alpha: 1 });
    } else if (distFromPeak < 0.18) {
      pts = 20; label = 'GOOD';
      s.streak++; if (s.streak > s.sig.maxStreak) s.sig.maxStreak = s.streak;
      sfx.collect?.(); hapticImpact();
      s.flashColor = '#a855f7';
      s.outerRings.push({ r: 0, alpha: 0.6 });
    } else if (phaseAtTap < 0.5) {
      pts = 5; label = 'EARLY'; s.sig.earlyTaps++;
      s.streak = 0; sfx.click?.();
      s.flashColor = '#f59e0b';
    } else {
      pts = 5; label = 'LATE'; s.sig.lateTaps++;
      s.streak = 0; sfx.click?.();
      s.flashColor = '#f59e0b';
    }
    const mult = s.streak >= 5 ? 3 : s.streak >= 3 ? 2 : 1;
    s.sig.score += pts * mult;
    setScoreDisplay(s.sig.score);
    s.lastTapResult = label;
    s.lastTapAt = now2;
    s.flashUntil = now2 + 250;
    void beatInterval;
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { taps: 0, perfectSync: 0, earlyTaps: 0, lateTaps: 0, maxStreak: 0, score: 0 };
    s.pulsePhase = 0; s.bpm = 60; s.streak = 0;
    s.lastTapResult = null; s.flashColor = null; s.flashUntil = 0;
    s.outerRings = [];
    startTimeRef.current = Date.now();
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail?.(); endGame(); }
    }, 1000);

    let lastT = performance.now();

    const draw = (ts: number) => {
      animRef.current = requestAnimationFrame(draw);
      if (!s.running) return;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      const W = canvas.width, H = canvas.height;
      const dt = (ts - lastT) / 1000;
      lastT = ts;

      // Update BPM
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      s.bpm = getBpm(DURATION - s.timeLeft);
      s.pulsePhase += (s.bpm / 60) * dt;

      const now = Date.now();

      ctx.fillStyle = '#08000f';
      ctx.fillRect(0, 0, W, H);

      // Flash
      if (s.flashColor && now < s.flashUntil) {
        ctx.save(); ctx.globalAlpha = 0.15; ctx.fillStyle = s.flashColor;
        ctx.fillRect(0, 0, W, H); ctx.restore();
      }

      const cx = W / 2, cy = H * 0.48;
      const baseR = Math.min(W, H) * 0.22;

      // Pulse: circle size oscillates
      const phase = (s.pulsePhase % 1) * Math.PI * 2;
      const pulseScale = 1 + Math.sin(phase) * 0.28;
      const r = baseR * pulseScale;

      // Background circle glow
      const dist = Math.abs(Math.sin(phase));
      ctx.save();
      ctx.shadowColor = '#a855f7';
      ctx.shadowBlur = 20 + dist * 40;
      // Outer ring bands
      for (let ring = 3; ring >= 0; ring--) {
        ctx.globalAlpha = 0.08 - ring * 0.015;
        ctx.fillStyle = '#a855f7';
        ctx.beginPath(); ctx.arc(cx, cy, r + ring * 28, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();

      // Main circle
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, 'rgba(216,180,254,0.9)');
      grad.addColorStop(0.5, 'rgba(168,85,247,0.8)');
      grad.addColorStop(1, 'rgba(109,40,217,0.6)');
      ctx.save();
      ctx.shadowColor = '#a855f7'; ctx.shadowBlur = 30;
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Ripple rings from taps
      s.outerRings = s.outerRings.filter(ring => ring.alpha > 0.02);
      for (const ring of s.outerRings) {
        ring.r += 3; ring.alpha *= 0.92;
        ctx.save();
        ctx.globalAlpha = ring.alpha;
        ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3;
        ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 15;
        ctx.beginPath(); ctx.arc(cx, cy, r + ring.r, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }

      // Peak indicator dot
      const isPeak = Math.abs(Math.sin(phase)) > 0.92;
      if (isPeak) {
        ctx.save(); ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      // BPM indicator
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = `${Math.round(H * 0.022)}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText(`${s.bpm} BPM`, W / 2, H * 0.2);
      ctx.restore();

      // Result label
      if (s.lastTapResult && now - s.lastTapAt < 600) {
        const age = (now - s.lastTapAt) / 600;
        ctx.save();
        ctx.globalAlpha = 1 - age;
        ctx.font = `bold ${Math.round(H * 0.05)}px Arial`;
        ctx.textAlign = 'center';
        const colors: Record<string, string> = { 'PERFECT!': '#22c55e', 'GOOD': '#a855f7', 'EARLY': '#f59e0b', 'LATE': '#f59e0b' };
        ctx.fillStyle = colors[s.lastTapResult] ?? '#ffffff';
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 20;
        ctx.fillText(s.lastTapResult, W / 2, cy + r + 50);
        ctx.restore();
      }

      // Streak
      if (s.streak >= 3) {
        ctx.save();
        ctx.fillStyle = '#f59e0b'; ctx.font = `bold ${Math.round(H * 0.025)}px Arial`;
        ctx.textAlign = 'center'; ctx.shadowColor = '#f59e0b'; ctx.shadowBlur = 15;
        ctx.fillText(`🔥 ×${s.streak}`, W / 2, H * 0.1);
        ctx.restore();
      }

      // Instruction
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = `${Math.round(H * 0.025)}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText('TAP AT THE PEAK', W / 2, H * 0.88);
      ctx.restore();

      void elapsed;
    };
    requestAnimationFrame(draw);
  }, [endGame]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || phase !== 'playing') return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);
    const onTap = (e: PointerEvent) => { e.preventDefault(); handleTap(); };
    canvas.addEventListener('pointerdown', onTap);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onTap);
    };
  }, [phase, handleTap]);

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

  const syncPct = finalSig && finalSig.taps > 0 ? Math.round(finalSig.perfectSync / finalSig.taps * 100) : 0;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="A circle pulses to a rhythm. Tap exactly when it reaches its peak size. Stay in sync — the beat gets faster!"
          ctaLabel="Feel It 💜" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
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
            { label: 'Taps', value: String(finalSig.taps), color: ACCENT },
            { label: 'Perfect Sync', value: `${syncPct}%`, color: '#22c55e' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#f59e0b' },
            { label: 'Off Beat', value: String(finalSig.earlyTaps + finalSig.lateTaps), color: '#ef4444' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={syncPct >= 50} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const CrowdPulse = dynamic(() => Promise.resolve({ default: CrowdPulseInner }), { ssr: false });
export default CrowdPulse;
