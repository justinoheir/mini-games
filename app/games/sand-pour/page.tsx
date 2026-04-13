﻿﻿﻿'use client';
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

const GAME_ID = 'sand-pour';
const ACCENT = '#f59e0b';
const DURATION = 60;
const GAME_EMOJI = '⏳';
const GAME_TITLE = 'Sand Pour';
const GAME_TAGLINE = "Fill the glass. Don't spill.";

interface Signals { poured: number; spilled: number; maxFill: number; score: number; fills: number; }
function getPersonality(sig: Signals): string {
  const total = sig.poured + sig.spilled;
  const acc = total > 0 ? sig.poured / total : 0;
  if (sig.fills >= 3 && acc >= 0.85) return 'Master Pourer 🏆';
  if (acc >= 0.8 && sig.poured >= 200) return 'Steady Hands ✋';
  if (sig.fills >= 2) return 'Good Flow 🌊';
  if (sig.spilled > sig.poured) return 'Messy But Learning 💦';
  return 'Novice Bartender 🍺';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface Particle { x: number; y: number; vx: number; vy: number; life: number; }

interface GState {
  running: boolean; timeLeft: number; sig: Signals; streak: number;
  tiltAngle: number; isDragging: boolean; dragStartX: number;
  particles: Particle[]; glassFill: number; glassTarget: number;
  nextSpawnAt: number; spawnInterval: number;
  overflowFlash: number; fillFlash: number;
  pitcherX: number; pitcherY: number; pitcherAngle: number;
}

function SandPourInner() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animRef = useRef<number>(0);
  const stateRef = useRef<GState>({
    running: false, streak: 0, timeLeft: DURATION,
    sig: { poured: 0, spilled: 0, maxFill: 0, score: 0, fills: 0 },
    tiltAngle: 0, isDragging: false, dragStartX: 0,
    particles: [], glassFill: 0, glassTarget: 0.75,
    nextSpawnAt: 0, spawnInterval: 80,
    overflowFlash: 0, fillFlash: 0,
    pitcherX: 0.5, pitcherY: 0.25, pitcherAngle: 0,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streak, setStreak] = useState(0);
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

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { poured: 0, spilled: 0, maxFill: 0, score: 0, fills: 0 };
    s.particles = []; s.glassFill = 0; s.tiltAngle = 0; s.isDragging = false;
    s.overflowFlash = 0; s.fillFlash = 0;
    setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail?.(); endGame(); }
    }, 1000);

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      if (!s.running) return;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      const W = canvas.width, H = canvas.height;
      const now = Date.now();

      ctx.fillStyle = '#0a0a15';
      ctx.fillRect(0, 0, W, H);

      // Glass dimensions
      const glassW = W * 0.22;
      const glassH = H * 0.35;
      const glassX = W * 0.5 - glassW / 2;
      const glassTop = H * 0.55;
      const glassBot = glassTop + glassH;

      // Pitcher position (top center area)
      const pitchX = W * s.pitcherX;
      const pitchY = H * s.pitcherY;
      const tilt = s.tiltAngle;

      // Spawn sand particles when tilted
      if (now > s.nextSpawnAt && Math.abs(tilt) > 0.3) {
        s.nextSpawnAt = now + s.spawnInterval;
        // Spout tip position based on tilt
        const spoutOffX = Math.cos(tilt - Math.PI / 2) * (W * 0.07);
        const spoutOffY = Math.sin(tilt - Math.PI / 2) * (W * 0.07);
        const sx = pitchX + spoutOffX;
        const sy = pitchY + spoutOffY;
        for (let i = 0; i < 3; i++) {
          s.particles.push({
            x: sx + (Math.random() - 0.5) * 6,
            y: sy + (Math.random() - 0.5) * 6,
            vx: Math.cos(tilt + Math.PI / 2) * 1.5 + (Math.random() - 0.5) * 1,
            vy: Math.sin(tilt + Math.PI / 2) * 1.5 + Math.random() * 0.5,
            life: 1,
          });
        }
      }

      // Update particles
      const alive: Particle[] = [];
      for (const p of s.particles) {
        p.vy += 0.25; // gravity
        p.x += p.vx; p.y += p.vy;
        p.life -= 0.01;
        if (p.life <= 0) continue;
        if (p.y > glassBot + 20) continue; // fell past glass

        // Check if in glass
        if (p.x >= glassX && p.x <= glassX + glassW && p.y >= glassTop && p.y <= glassBot) {
          if (s.glassFill < 1.0) {
            s.glassFill += 0.002;
            s.sig.poured++;
            if (s.glassFill > s.sig.maxFill) s.sig.maxFill = s.glassFill;
            // Check fill complete
            if (s.glassFill >= 1.0) {
              s.glassFill = 1.0;
              s.streak=(s.streak||0)+1; setStreak(s.streak);
              const _sp=Math.max(1,Math.floor(s.streak/3)+1);
              s.sig.fills++; s.sig.score += 100 * _sp;
              setScoreDisplay(s.sig.score);
              s.fillFlash = now + 600;
              sfx.success?.(); hapticScore();
              // Reset glass after pause
              setTimeout(() => { if (s.running) { s.glassFill = 0; } }, 800);
            }
          } else {
            // overflow
            s.sig.spilled++; s.streak=0; setStreak(0);
            s.overflowFlash = now + 300;
            continue;
          }
        } else if (p.y > glassTop && (p.x < glassX - 5 || p.x > glassX + glassW + 5)) {
          // Spilled
          s.sig.spilled++; s.streak=0; setStreak(0);
          s.overflowFlash = now + 200;
          continue;
        }
        alive.push(p);
      }
      s.particles = alive.slice(-200); // cap

      // Draw glass
      ctx.save();
      ctx.shadowColor = '#f59e0b'; ctx.shadowBlur = now < s.fillFlash ? 30 : 10;
      // Glass body
      ctx.strokeStyle = now < s.fillFlash ? '#fbbf24' : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(glassX, glassTop);
      ctx.lineTo(glassX, glassBot);
      ctx.lineTo(glassX + glassW, glassBot);
      ctx.lineTo(glassX + glassW, glassTop);
      ctx.stroke();
      // Fill
      const fillH = glassH * s.glassFill;
      const grad = ctx.createLinearGradient(0, glassBot - fillH, 0, glassBot);
      grad.addColorStop(0, 'rgba(251,191,36,0.8)');
      grad.addColorStop(1, 'rgba(217,119,6,0.9)');
      ctx.fillStyle = grad;
      ctx.fillRect(glassX + 2, glassBot - fillH, glassW - 4, fillH);

      // Fill target marker
      const targetY = glassBot - glassH * s.glassTarget;
      ctx.strokeStyle = 'rgba(34,197,94,0.7)'; ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(glassX, targetY); ctx.lineTo(glassX + glassW, targetY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Overflow flash
      if (now < s.overflowFlash) {
        ctx.save(); ctx.globalAlpha = 0.15; ctx.fillStyle = '#ef4444';
        ctx.fillRect(0, 0, W, H); ctx.restore();
      }
      if (now < s.fillFlash) {
        ctx.save(); ctx.globalAlpha = 0.15; ctx.fillStyle = '#22c55e';
        ctx.fillRect(0, 0, W, H); ctx.restore();
      }

      // Draw pitcher
      ctx.save();
      ctx.translate(pitchX, pitchY);
      ctx.rotate(tilt);
      ctx.shadowColor = '#f59e0b'; ctx.shadowBlur = 15;
      // Pitcher body
      ctx.fillStyle = '#7c3aed';
      ctx.beginPath();
      ctx.roundRect(-W * 0.06, -H * 0.08, W * 0.12, H * 0.13, 8);
      ctx.fill();
      // Spout
      ctx.fillStyle = '#6d28d9';
      ctx.beginPath();
      ctx.moveTo(W * 0.06, -H * 0.04);
      ctx.lineTo(W * 0.1, -H * 0.07);
      ctx.lineTo(W * 0.1, -H * 0.02);
      ctx.closePath(); ctx.fill();
      // Handle
      ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(-W * 0.08, 0, H * 0.04, -Math.PI * 0.4, Math.PI * 0.4);
      ctx.stroke();
      // Sand inside pitcher (level)
      const pitFill = 0.7 - (s.sig.poured * 0.0005);
      if (pitFill > 0) {
        ctx.fillStyle = 'rgba(251,191,36,0.7)';
        const pf = Math.max(0, pitFill);
        ctx.fillRect(-W * 0.055, H * 0.04 - H * 0.1 * pf, W * 0.11, H * 0.1 * pf);
      }
      ctx.restore();

      // Draw particles
      ctx.save();
      for (const p of s.particles) {
        ctx.globalAlpha = p.life * 0.9;
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // Instructions overlay
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `${Math.round(H * 0.022)}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText('DRAG ← → to tilt and pour', W / 2, H * 0.92);
      ctx.restore();

      // Fill level %
      ctx.save();
      ctx.fillStyle = '#f59e0b';
      ctx.font = `bold ${Math.round(H * 0.028)}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(s.glassFill * 100)}%`, W / 2, glassTop - 12);
      ctx.restore();
    };
    draw();
  }, [endGame]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || phase !== 'playing') return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onDown = (e: PointerEvent) => {
      const s = stateRef.current;
      s.isDragging = true; s.dragStartX = e.clientX;
    };
    const onMove = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.isDragging) return;
      const dx = e.clientX - s.dragStartX;
      s.tiltAngle = Math.max(-1.2, Math.min(1.2, dx / 120));
    };
    const onUp = () => {
      const s = stateRef.current;
      s.isDragging = false;
      // Spring back to center
      const springBack = () => {
        const s2 = stateRef.current;
        if (!s2.isDragging) {
          s2.tiltAngle *= 0.85;
          if (Math.abs(s2.tiltAngle) > 0.01) requestAnimationFrame(springBack);
          else s2.tiltAngle = 0;
        }
      };
      requestAnimationFrame(springBack);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, [phase]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    cancelAnimationFrame(animRef.current);
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="Drag left or right to tilt the pitcher and pour sand into the glass. Fill to the line — without spilling!"
          ctaLabel="Pour It ⏳" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} role="application" aria-label="Game canvas - tap to interact" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
            {phase === 'playing' && streak >= 3 && (
        <div style={{ position: 'fixed', top: 128, left: '50%', transform: 'translateX(-50%)', zIndex: 25, pointerEvents: 'none', fontSize: 20, fontWeight: 900, color: '#fbbf24', textShadow: '0 0 16px #fbbf2488', letterSpacing: 1, whiteSpace: 'nowrap' }} aria-live="polite" aria-atomic="true">
          ⚡ x{Math.max(1,Math.floor(streak/3)+1)} Streak!
        </div>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Glasses Filled', value: String(finalSig.fills), color: '#22c55e' },
            { label: 'Poured', value: String(finalSig.poured), color: ACCENT },
            { label: 'Spilled', value: String(finalSig.spilled), color: '#ef4444' },
            { label: 'Max Fill', value: `${Math.round(finalSig.maxFill * 100)}%`, color: '#a855f7' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.fills >= 2} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const SandPour = dynamic(() => Promise.resolve({ default: SandPourInner }), { ssr: false });
export default SandPour;
