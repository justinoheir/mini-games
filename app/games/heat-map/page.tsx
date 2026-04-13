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

const GAME_ID = 'heat-map';
const ACCENT = '#f97316';
const DURATION = 60;
const GAME_EMOJI = '👁️';
const GAME_TITLE = 'Heat Map';
const GAME_TAGLINE = 'Where do you look first?';

// Predefined "hot zones" for each scene (normalized 0-1 coords)
const SCENES = [
  {
    name: 'Product Shelf',
    hotZone: { x: 0.5, y: 0.35, label: 'Brand Logo' },
    draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => {
      // Shelf background
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#1e293b'); bg.addColorStop(1, '#0f172a');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      // Shelf planks
      for (let i = 0; i < 3; i++) {
        const y = H * (0.55 + i * 0.15);
        ctx.fillStyle = '#7c5533'; ctx.fillRect(0, y, W, 10);
      }
      // Products
      const colors = ['#ef4444','#3b82f6','#22c55e','#f59e0b','#a855f7','#ec4899'];
      for (let i = 0; i < 6; i++) {
        const x = W * 0.1 + i * W * 0.135;
        const y = H * 0.45;
        ctx.fillStyle = colors[i];
        ctx.beginPath(); ctx.roundRect(x, y, W * 0.1, H * 0.1, 4); ctx.fill();
      }
      // Hero product (center, bigger)
      ctx.shadowColor = '#f97316'; ctx.shadowBlur = 30;
      ctx.fillStyle = '#f97316';
      ctx.beginPath(); ctx.roundRect(W * 0.4, H * 0.18, W * 0.2, H * 0.18, 8); ctx.fill();
      ctx.shadowBlur = 0;
      // Label
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(H * 0.04)}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText('NEW!', W * 0.5, H * 0.28);
    },
  },
  {
    name: 'App Screen',
    hotZone: { x: 0.5, y: 0.2, label: 'CTA Button' },
    draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => {
      ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);
      // Header
      ctx.fillStyle = '#1e293b';
      ctx.beginPath(); ctx.roundRect(W * 0.05, H * 0.05, W * 0.9, H * 0.25, 12); ctx.fill();
      // Big CTA button
      ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 25;
      ctx.fillStyle = '#22c55e';
      ctx.beginPath(); ctx.roundRect(W * 0.15, H * 0.13, W * 0.7, H * 0.1, 30); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff'; ctx.font = `bold ${Math.round(H * 0.035)}px Arial`;
      ctx.textAlign = 'center'; ctx.fillText('GET STARTED →', W * 0.5, H * 0.19);
      // Content cards
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = '#1e293b';
        ctx.beginPath(); ctx.roundRect(W * 0.08, H * (0.38 + i * 0.18), W * 0.84, H * 0.14, 8); ctx.fill();
      }
    },
  },
  {
    name: 'Billboard',
    hotZone: { x: 0.25, y: 0.4, label: 'Face / Person' },
    draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => {
      ctx.fillStyle = '#f1f5f9'; ctx.fillRect(0, 0, W, H);
      // Billboard frame
      ctx.fillStyle = '#334155';
      ctx.beginPath(); ctx.roundRect(W * 0.05, H * 0.08, W * 0.9, H * 0.78, 16); ctx.fill();
      // Person silhouette (left side)
      ctx.shadowColor = '#ec4899'; ctx.shadowBlur = 20;
      ctx.fillStyle = '#ec4899';
      ctx.beginPath(); ctx.arc(W * 0.25, H * 0.35, H * 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(W * 0.25, H * 0.55, H * 0.08, H * 0.15, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      // Text on right
      ctx.fillStyle = '#ffffff'; ctx.font = `bold ${Math.round(H * 0.06)}px Arial`;
      ctx.textAlign = 'left';
      ctx.fillText('FEEL IT.', W * 0.42, H * 0.38);
      ctx.font = `${Math.round(H * 0.035)}px Arial`; ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText('New collection.', W * 0.42, H * 0.5);
    },
  },
  {
    name: 'Menu Board',
    hotZone: { x: 0.5, y: 0.3, label: 'Top Item / Special' },
    draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => {
      ctx.fillStyle = '#1c1007'; ctx.fillRect(0, 0, W, H);
      // Title
      ctx.fillStyle = '#f59e0b'; ctx.font = `bold ${Math.round(H * 0.06)}px serif`;
      ctx.textAlign = 'center'; ctx.fillText("TODAY'S SPECIALS", W * 0.5, H * 0.16);
      // Featured item (top center - hot zone)
      ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 25;
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath(); ctx.roundRect(W * 0.2, H * 0.2, W * 0.6, H * 0.18, 10); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#1c1007'; ctx.font = `bold ${Math.round(H * 0.04)}px Arial`;
      ctx.textAlign = 'center'; ctx.fillText('★ CHEF SPECIAL $14', W * 0.5, H * 0.31);
      // Regular items
      const items = ['Burger $9', 'Salad $7', 'Pasta $11', 'Soup $6'];
      items.forEach((item, i) => {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath(); ctx.roundRect(W * 0.08, H * (0.44 + i * 0.12), W * 0.84, H * 0.09, 6); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = `${Math.round(H * 0.028)}px Arial`;
        ctx.textAlign = 'left'; ctx.fillText(item, W * 0.12, H * (0.51 + i * 0.12));
      });
    },
  },
];

interface TapRecord { x: number; y: number; dist: number; }
interface Signals { rounds: number; totalDist: number; avgDist: number; score: number; hotHits: number; tapRecords: TapRecord[]; }
function getPersonality(sig: Signals): string {
  const avg = sig.avgDist;
  if (sig.hotHits >= 3 && avg < 0.12) return 'Attention Hawk 👁️';
  if (sig.hotHits >= 2) return 'Eye Tracker 🎯';
  if (avg < 0.2) return 'Instinct Player 🧠';
  if (sig.rounds >= 4) return 'Pattern Tester 📊';
  return 'First Glancer 👀';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
type SubPhase = 'reveal' | 'wait_tap' | 'show_result';

interface GState {
  running: boolean; timeLeft: number; sig: Signals; streak: number;
  sceneIdx: number; subPhase: SubPhase;
  tapX: number | null; tapY: number | null;
  resultUntil: number; revealAt: number; tapAt: number;
}

function HeatMapInner() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animRef = useRef<number>(0);
  const stateRef = useRef<GState>({
    running: false, streak: 0, timeLeft: DURATION,
    sig: { rounds: 0, totalDist: 0, avgDist: 0, score: 0, hotHits: 0, tapRecords: [] },
    sceneIdx: 0, subPhase: 'reveal',
    tapX: null, tapY: null, resultUntil: 0, revealAt: 0, tapAt: 0,
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
    s.sig.avgDist = s.sig.rounds > 0 ? s.sig.totalDist / s.sig.rounds : 1;
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const nextScene = useCallback(() => {
    const s = stateRef.current;
    s.sceneIdx = (s.sceneIdx + 1) % SCENES.length;
    s.subPhase = 'reveal'; s.revealAt = Date.now() + 200;
    s.tapX = null; s.tapY = null;
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { rounds: 0, totalDist: 0, avgDist: 0, score: 0, hotHits: 0, tapRecords: [] };
    s.sceneIdx = 0; s.subPhase = 'reveal'; s.revealAt = Date.now() + 500;
    s.tapX = null; s.tapY = null;
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

      ctx.clearRect(0, 0, W, H);
      const scene = SCENES[s.sceneIdx];

      // Draw scene
      ctx.save();
      if (s.subPhase === 'reveal') {
        const elapsed = now - s.revealAt + 200;
        ctx.globalAlpha = Math.min(1, elapsed / 300);
      }
      scene.draw(ctx, W, H);
      ctx.restore();

      if (s.subPhase === 'reveal' && now > s.revealAt) {
        s.subPhase = 'wait_tap';
        s.tapAt = now;
      }

      if (s.subPhase === 'wait_tap') {
        // Blinking crosshair prompt
        const blink = Math.sin(now * 0.008) > 0;
        ctx.save();
        ctx.fillStyle = blink ? 'rgba(249,115,22,0.9)' : 'rgba(249,115,22,0.4)';
        ctx.font = `bold ${Math.round(H * 0.028)}px Arial`;
        ctx.textAlign = 'center';
        ctx.shadowColor = '#f97316'; ctx.shadowBlur = 15;
        ctx.fillText('TAP WHERE YOU LOOKED FIRST', W / 2, H * 0.93);
        ctx.restore();
      }

      if (s.subPhase === 'show_result' && s.tapX !== null && s.tapY !== null) {
        const hz = scene.hotZone;
        const hx = hz.x * W, hy = hz.y * H;

        // Heat map ripple around tap
        const rippleAlpha = Math.max(0, 1 - (now - s.resultUntil + 1800) / 1800);
        for (let ring = 0; ring < 4; ring++) {
          const rr = (ring + 1) * 25;
          ctx.save();
          ctx.globalAlpha = rippleAlpha * (0.5 - ring * 0.1);
          ctx.strokeStyle = '#f97316'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(s.tapX!, s.tapY!, rr, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }

        // Player tap dot
        ctx.save();
        ctx.shadowColor = '#f97316'; ctx.shadowBlur = 20;
        ctx.fillStyle = '#f97316';
        ctx.beginPath(); ctx.arc(s.tapX!, s.tapY!, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(s.tapX!, s.tapY!, 5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        // Hot zone marker
        ctx.save();
        ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 20;
        ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(hx, hy, 22, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(34,197,94,0.2)';
        ctx.fill();
        ctx.restore();

        // Label
        ctx.save();
        ctx.fillStyle = '#22c55e'; ctx.font = `bold ${Math.round(H * 0.025)}px Arial`;
        ctx.textAlign = 'center';
        ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 10;
        ctx.fillText(`↑ ${hz.label}`, hx, hy - 30);
        ctx.restore();

        // Score result
        const dist = Math.hypot((s.tapX! - hx) / W, (s.tapY! - hy) / H);
        const pts = Math.round(Math.max(0, 100 - dist * 300));
        ctx.save();
        ctx.fillStyle = pts >= 60 ? '#22c55e' : '#f97316';
        ctx.font = `bold ${Math.round(H * 0.045)}px Arial`;
        ctx.textAlign = 'center'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 25;
        ctx.fillText(`+${pts}`, W / 2, H * 0.88);
        ctx.restore();

        if (now > s.resultUntil) nextScene();
      }
    };
    draw();
  }, [endGame, nextScene]);

  const handleTap = useCallback((nx: number, ny: number) => {
    const s = stateRef.current;
    if (!s.running || s.subPhase !== 'wait_tap') return;
    const canvas = canvasRef.current; if (!canvas) return;
    s.tapX = nx; s.tapY = ny;
    const W = canvas.width, H = canvas.height;
    const scene = SCENES[s.sceneIdx];
    const hx = scene.hotZone.x * W, hy = scene.hotZone.y * H;
    const dist = Math.hypot((nx - hx) / W, (ny - hy) / H);
    const pts = Math.round(Math.max(0, 100 - dist * 300));
    s.sig.rounds++;
    s.sig.totalDist += dist;
    if (pts >= 60) { s.streak=(s.streak||0)+1; } else { s.streak=0; }
    setStreak(s.streak);
    const _hm = Math.max(1,Math.floor(s.streak/3)+1);
    s.sig.score += pts * _hm;
    if (pts >= 60) s.sig.hotHits++;
    s.sig.tapRecords.push({ x: nx / W, y: ny / H, dist });
    setScoreDisplay(s.sig.score);
    s.subPhase = 'show_result';
    s.resultUntil = Date.now() + 1600;
    if (pts >= 60) { sfx.success?.(); hapticScore(); } else { sfx.click?.(); hapticImpact(); }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || phase !== 'playing') return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);
    const onTap = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      handleTap(e.clientX - rect.left, e.clientY - rect.top);
    };
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
    setPhase('start'); setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const avgDist = finalSig ? Math.round((1 - Math.min(1, finalSig.avgDist * 3)) * 100) : 0;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="A scene appears. Tap where your eye goes first — instinctively! See how close you get to the attention hotspot."
          ctaLabel="Show Me 👁️" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
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
            { label: 'Scenes', value: String(finalSig.rounds), color: ACCENT },
            { label: 'Hot Hits', value: String(finalSig.hotHits), color: '#22c55e' },
            { label: 'Attention Score', value: `${avgDist}%`, color: '#a855f7' },
            { label: 'Total Pts', value: String(finalSig.score), color: '#f59e0b' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.hotHits >= 2} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const HeatMap = dynamic(() => Promise.resolve({ default: HeatMapInner }), { ssr: false });
export default HeatMap;
