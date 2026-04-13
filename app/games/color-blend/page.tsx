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

const GAME_ID = 'color-blend';
const ACCENT = '#a855f7';
const DURATION = 60;
const GAME_EMOJI = '🎨';
const GAME_TITLE = 'Color Blend';
const GAME_TAGLINE = 'Swipe to blend. Hit the target hue.';

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}
function hueDiff(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

const COLOR_PAIRS = [
  { a: '#ef4444', b: '#3b82f6' }, // red-blue → purple
  { a: '#eab308', b: '#ef4444' }, // yellow-red → orange
  { a: '#22c55e', b: '#3b82f6' }, // green-blue → teal
  { a: '#f97316', b: '#a855f7' }, // orange-purple → magenta
  { a: '#eab308', b: '#22c55e' }, // yellow-green → lime
];

interface Signals { rounds: number; totalAccuracy: number; bestAccuracy: number; score: number; perfectHits: number; }
function getPersonality(sig: Signals): string {
  const avg = sig.rounds > 0 ? sig.totalAccuracy / sig.rounds : 0;
  if (avg >= 90 && sig.perfectHits >= 2) return 'Color Alchemist 🧙';
  if (avg >= 80) return 'Hue Master 🎨';
  if (sig.rounds >= 4) return 'Palette Explorer 🖌️';
  if (avg >= 60) return 'Color Curious 🌈';
  return 'Still Mixing 🎭';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GState {
  running: boolean; timeLeft: number; sig: Signals;
  sliderValue: number; isDragging: boolean; dragStartX: number; dragStartVal: number;
  colorA: string; colorB: string; targetBlend: number; targetColor: string;
  roundResult: null | { accuracy: number; score: number; flash: number };
  resultDisplayUntil: number;
}

function ColorBlendInner() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animRef = useRef<number>(0);
  const stateRef = useRef<GState>({
    running: false, streak: 0, timeLeft: DURATION,
    sig: { rounds: 0, totalAccuracy: 0, bestAccuracy: 0, score: 0, perfectHits: 0 },
    sliderValue: 0.5, isDragging: false, dragStartX: 0, dragStartVal: 0.5,
    colorA: '#ef4444', colorB: '#3b82f6', targetBlend: 0.5, targetColor: '#7b3c7b',
    roundResult: null, resultDisplayUntil: 0,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streak, setStreak] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const lerpColor = useCallback((hexA: string, hexB: string, t: number): string => {
    const ra = parseInt(hexA.slice(1, 3), 16), ga = parseInt(hexA.slice(3, 5), 16), ba = parseInt(hexA.slice(5, 7), 16);
    const rb = parseInt(hexB.slice(1, 3), 16), gb = parseInt(hexB.slice(3, 5), 16), bb = parseInt(hexB.slice(5, 7), 16);
    const r = Math.round(ra + (rb - ra) * t);
    const g = Math.round(ga + (gb - ga) * t);
    const b = Math.round(ba + (bb - ba) * t);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }, []);

  const nextRound = useCallback(() => {
    const s = stateRef.current;
    const pair = COLOR_PAIRS[Math.floor(Math.random() * COLOR_PAIRS.length)];
    s.colorA = pair.a; s.colorB = pair.b;
    s.targetBlend = 0.2 + Math.random() * 0.6;
    s.targetColor = lerpColor(pair.a, pair.b, s.targetBlend);
    s.sliderValue = 0.5;
    s.roundResult = null;
  }, [lerpColor]);

  const submitBlend = useCallback(() => {
    const s = stateRef.current;
    if (!s.running || s.roundResult) return;
    const [tH] = hexToHsl(s.targetColor);
    const blendedColor = lerpColor(s.colorA, s.colorB, s.sliderValue);
    const [bH] = hexToHsl(blendedColor);
    const diff = hueDiff(tH, bH);
    const accuracy = Math.max(0, Math.round(100 - diff * 1.2));
    const pts = Math.round(accuracy * 1.2);
    s.sig.rounds++;
    s.sig.totalAccuracy += accuracy;
    if (accuracy > s.sig.bestAccuracy) s.sig.bestAccuracy = accuracy;
    if (accuracy >= 80) { s.streak=(s.streak||0)+1; } else { s.streak=0; }
    setStreak(s.streak);
    const _cb=Math.max(1,Math.floor(s.streak/3)+1);
    s.sig.score += pts * _cb;
    if (accuracy >= 85) s.sig.perfectHits++;
    setScoreDisplay(s.sig.score);
    s.roundResult = { accuracy, score: pts, flash: Date.now() + 800 };
    s.resultDisplayUntil = Date.now() + 1200;
    if (accuracy >= 80) { sfx.success?.(); hapticScore(); }
    else { sfx.click?.(); hapticFail(); }
    setTimeout(() => { if (s.running) nextRound(); }, 1300);
  }, [lerpColor, nextRound]);

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
    s.sig = { rounds: 0, totalAccuracy: 0, bestAccuracy: 0, score: 0, perfectHits: 0 };
    setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setPhase('playing');
    nextRound();

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

      ctx.fillStyle = '#08080f';
      ctx.fillRect(0, 0, W, H);

      const blendedColor = lerpColor(s.colorA, s.colorB, s.sliderValue);

      // Target color swatch
      const swatchW = W * 0.38;
      const swatchH = H * 0.18;
      const swatchY = H * 0.08;

      // Label
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `bold ${Math.round(H * 0.022)}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText('TARGET HUE', W / 2, swatchY - 8);

      // Target swatch
      ctx.save();
      ctx.shadowColor = s.targetColor; ctx.shadowBlur = 25;
      ctx.fillStyle = s.targetColor;
      ctx.beginPath(); ctx.roundRect((W - swatchW) / 2, swatchY, swatchW, swatchH, 12); ctx.fill();
      ctx.restore();

      // Source colors
      const srcW = W * 0.25, srcH = H * 0.12;
      const srcY = H * 0.33;
      ctx.save();
      ctx.shadowColor = s.colorA; ctx.shadowBlur = 20;
      ctx.fillStyle = s.colorA;
      ctx.beginPath(); ctx.roundRect(W * 0.08, srcY, srcW, srcH, 10); ctx.fill();
      ctx.shadowColor = s.colorB;
      ctx.fillStyle = s.colorB;
      ctx.beginPath(); ctx.roundRect(W * 0.67, srcY, srcW, srcH, 10); ctx.fill();
      ctx.restore();

      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = `${Math.round(H * 0.018)}px Arial`;
      ctx.textAlign = 'left';
      ctx.fillText('A', W * 0.08 + srcW / 2 - 5, srcY - 8);
      ctx.textAlign = 'right';
      ctx.fillText('B', W * 0.67 + srcW / 2 + 5, srcY - 8);

      // Gradient slider track
      const sliderY = H * 0.55;
      const sliderX = W * 0.1;
      const sliderW = W * 0.8;
      const sliderH2 = 24;
      const grad = ctx.createLinearGradient(sliderX, 0, sliderX + sliderW, 0);
      grad.addColorStop(0, s.colorA);
      grad.addColorStop(1, s.colorB);
      ctx.save();
      ctx.beginPath(); ctx.roundRect(sliderX, sliderY, sliderW, sliderH2, 12); ctx.clip();
      ctx.fillStyle = grad; ctx.fillRect(sliderX, sliderY, sliderW, sliderH2);
      ctx.restore();
      // Slider thumb
      const thumbX = sliderX + s.sliderValue * sliderW;
      ctx.save();
      ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 15;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(thumbX, sliderY + sliderH2 / 2, 16, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Current blend swatch
      const bSwatchY = H * 0.64;
      ctx.save();
      ctx.shadowColor = blendedColor; ctx.shadowBlur = 25;
      ctx.fillStyle = blendedColor;
      ctx.beginPath(); ctx.roundRect((W - swatchW) / 2, bSwatchY, swatchW, H * 0.14, 12); ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `bold ${Math.round(H * 0.022)}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText('YOUR MIX', W / 2, bSwatchY - 8);

      // Result overlay
      if (s.roundResult && now < s.resultDisplayUntil) {
        const acc = s.roundResult.accuracy;
        ctx.save();
        ctx.globalAlpha = Math.min(1, (s.resultDisplayUntil - now) / 300);
        ctx.fillStyle = acc >= 80 ? '#22c55e' : acc >= 50 ? '#f59e0b' : '#ef4444';
        ctx.font = `bold ${Math.round(H * 0.06)}px Arial`;
        ctx.textAlign = 'center';
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 30;
        ctx.fillText(`${acc}%`, W / 2, H * 0.48);
        ctx.font = `${Math.round(H * 0.03)}px Arial`;
        ctx.fillText(`+${s.roundResult.score} pts`, W / 2, H * 0.52);
        ctx.restore();
      }

      // Submit button
      ctx.save();
      ctx.shadowColor = ACCENT; ctx.shadowBlur = 20;
      ctx.fillStyle = ACCENT;
      ctx.beginPath(); ctx.roundRect(W * 0.25, H * 0.82, W * 0.5, 48, 24); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(H * 0.028)}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText('SUBMIT BLEND', W / 2, H * 0.82 + 30);
      ctx.restore();
    };
    draw();
  }, [endGame, nextRound, lerpColor]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || phase !== 'playing') return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onDown = (e: PointerEvent) => {
      const s = stateRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const H = canvas.height, W = canvas.width;
      // Check submit button
      if (y > H * 0.82 && y < H * 0.82 + 48 && x > W * 0.25 && x < W * 0.75) {
        submitBlend(); return;
      }
      // Check slider
      const sliderY = H * 0.55;
      const sliderX = W * 0.1;
      const sliderW = W * 0.8;
      if (y >= sliderY - 20 && y <= sliderY + 44 && x >= sliderX - 20 && x <= sliderX + sliderW + 20) {
        s.isDragging = true; s.dragStartX = e.clientX; s.dragStartVal = s.sliderValue;
      }
    };
    const onMove = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.isDragging) return;
      const W = canvas.width;
      const sliderW = W * 0.8;
      const dx = e.clientX - s.dragStartX;
      s.sliderValue = Math.max(0, Math.min(1, s.dragStartVal + dx / sliderW));
    };
    const onUp = () => { stateRef.current.isDragging = false; };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
    };
  }, [phase, submitBlend]);

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

  const avgAcc = finalSig && finalSig.rounds > 0 ? Math.round(finalSig.totalAccuracy / finalSig.rounds) : 0;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="Drag the slider to blend two colors together. Match the target hue as closely as possible!"
          ctaLabel="Blend It 🎨" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} role="application" aria-label="Game canvas - tap to interact" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Rounds', value: String(finalSig.rounds), color: ACCENT },
            { label: 'Avg Accuracy', value: `${avgAcc}%`, color: '#22c55e' },
            { label: 'Best', value: `${finalSig.bestAccuracy}%`, color: '#f59e0b' },
            { label: 'Perfect Hits', value: String(finalSig.perfectHits), color: '#a855f7' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={avgAcc >= 70} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const ColorBlend = dynamic(() => Promise.resolve({ default: ColorBlendInner }), { ssr: false });
export default ColorBlend;
