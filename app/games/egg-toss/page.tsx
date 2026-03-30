'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { createTiltController } from '@/lib/tilt';

const GAME_ID = 'egg-toss';
const ACCENT = '#fde68a';
const DURATION = 45;
const GAME_EMOJI = '🥚';
const GAME_TITLE = 'Egg Toss';
const GAME_TAGLINE = "Toss it. Catch it. Don't crack it!";
const BG_COLOR = '#0a1207';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = 'holiday';
const PB_KEY = 'mg_pb_egg-toss';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  if (acc >= 0.8 && sig.maxStreak >= 5) return '🥚 Egg Champion';
  if (acc >= 0.65) return '🤲 Gentle Catcher';
  if (sig.maxStreak >= 4) return '🔥 Streak Keeper';
  return '💥 Egg-sploder';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function EggTossGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const tiltCtrlRef = useRef<ReturnType<typeof createTiltController> | null>(null);
  const catcherXRef = useRef(0.5);
  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { score: 0, hits: 0, attempts: 0, reactionTimes: [] as number[], maxStreak: 0, streakCurrent: 0 },
    eggState: 'idle' as 'idle' | 'flying' | 'landing' | 'catching' | 'cracking',
    eggT: 0, eggSpeed: 0.009,
    sx: 0.08, sy: 0.6, ex: 0.85, ey: 0.65, arcH: 0.35,
    eggX: 0, eggY: 0,
    throwTime: 0,
    popText: '', popAlpha: 0, popX: 0, popY: 0,
    crackT: 0, lastTs: 0,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const nextThrow = useCallback(() => {
    const s = stateRef.current;
    s.eggState = 'flying'; s.eggT = 0;
    s.eggSpeed = 0.007 + Math.min(s.sig.hits * 0.0003, 0.008) + Math.random() * 0.003;
    s.sx = 0.06 + Math.random() * 0.04; s.sy = 0.62;
    s.ex = 0.72 + Math.random() * 0.2; s.ey = 0.65;
    s.arcH = 0.28 + Math.random() * 0.18;
    s.throwTime = Date.now(); s.sig.attempts++;
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (tiltCtrlRef.current) { tiltCtrlRef.current.stop(); tiltCtrlRef.current = null; }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.eggState = 'idle';
    s.sig = { score: 0, hits: 0, attempts: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic(MUSIC_PAT);
    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([100]); endGame(); }
    }, 1000);
    const tiltCtrl = createTiltController((x) => { catcherXRef.current = 0.5 + x * 0.45; }, { sensitivity: 0.9, clamp: 28 });
    tiltCtrl.start(); tiltCtrlRef.current = tiltCtrl;
    setTimeout(() => nextThrow(), 400);

    const loop = (ts: number) => {
      if (!s.running) return;
      const dt = s.lastTs ? Math.min((ts - s.lastTs) / 16.67, 3) : 1;
      s.lastTs = ts;
      const W = c.width, H = c.height;
      ctx.clearRect(0, 0, W, H);

      // Sky gradient
      const sky = ctx.createLinearGradient(0, 0, 0, H * 0.8);
      sky.addColorStop(0, '#0d1b0a'); sky.addColorStop(1, '#1a3a0f');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H * 0.8);
      // Ground
      ctx.fillStyle = '#2d5016'; ctx.fillRect(0, H * 0.8, W, H * 0.2);
      ctx.fillStyle = '#3a6b1e'; ctx.fillRect(0, H * 0.79, W, 5);

      // Catcher position from tilt or touch
      const cx = Math.max(0.08, Math.min(0.95, catcherXRef.current));
      const catcherPx = W * cx, catcherPy = H * 0.72;

      // Draw thrower
      const tx = W * 0.09, ty = H * 0.73;
      ctx.fillStyle = '#f97316';
      ctx.beginPath(); ctx.arc(tx, ty - 32, 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c2410c'; ctx.fillRect(tx - 10, ty - 16, 20, 30);
      ctx.strokeStyle = '#c2410c'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(tx + 10, ty - 10); ctx.lineTo(tx + 32, ty - 28); ctx.stroke();

      // Landing zone marker
      if (s.eggState === 'flying' || s.eggState === 'landing') {
        const lx = W * s.ex, ly = catcherPy;
        const dist = Math.abs(cx - s.ex);
        const inZone = dist < 0.13;
        const pulse = 0.5 + 0.5 * Math.sin(ts / 200);
        ctx.strokeStyle = inZone ? `rgba(74,222,128,${0.7 + pulse * 0.3})` : `rgba(253,230,138,${0.4 + pulse * 0.3})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(lx, ly, 26, 0, Math.PI * 2); ctx.stroke();
        if (!inZone) {
          ctx.fillStyle = ACCENT + 'cc'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(cx < s.ex ? '→ MOVE RIGHT' : '← MOVE LEFT', W * 0.5, H * 0.55);
        }
      }

      // Update egg arc
      if (s.eggState === 'flying') {
        s.eggT += s.eggSpeed * dt;
        if (s.eggT >= 0.85) s.eggState = 'landing';
        if (s.eggT >= 1) {
          s.eggT = 1;
          const dist = Math.abs(cx - s.ex);
          if (dist < 0.13) {
            s.eggState = 'catching'; sfx.collect(); haptic([30]);
            s.sig.hits++; s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const pts = s.sig.streakCurrent >= 3 ? 2 : 1;
            s.sig.score += pts; setScoreDisplay(s.sig.score);
            s.sig.reactionTimes.push(Date.now() - s.throwTime);
            s.popText = s.sig.streakCurrent >= 3 ? `COMBO +${pts}!` : 'CAUGHT! +1';
            s.popAlpha = 1; s.popX = catcherPx; s.popY = catcherPy - 60;
          } else {
            s.eggState = 'cracking'; s.crackT = 1;
            sfx.collision(); haptic([20, 30, 20]);
            s.sig.streakCurrent = 0;
            s.popText = 'DROPPED! 💥'; s.popAlpha = 1;
            s.popX = W * s.ex; s.popY = catcherPy - 30;
          }
          setTimeout(() => { if (s.running) nextThrow(); }, 650);
        }
        // Quadratic bezier
        const t = s.eggT;
        const cpx = (s.sx + s.ex) / 2, cpy = Math.min(s.sy, s.ey) - s.arcH;
        s.eggX = (1 - t) * (1 - t) * s.sx + 2 * (1 - t) * t * cpx + t * t * s.ex;
        s.eggY = (1 - t) * (1 - t) * s.sy + 2 * (1 - t) * t * cpy + t * t * s.ey;
      }

      // Draw egg in flight
      if (s.eggState === 'flying' || s.eggState === 'landing') {
        const ex = s.eggX * W, ey = s.eggY * H;
        const scale = 0.6 + s.eggT * 0.6;
        // Shadow on ground
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(ex, H * 0.82, 14 * scale, 4 * scale, 0, 0, Math.PI * 2); ctx.fill();
        // Egg
        const angle = Math.atan2(s.eggY - s.sy, s.eggX - s.sx) * 0.5;
        ctx.save(); ctx.translate(ex, ey); ctx.rotate(angle);
        ctx.scale(scale, scale * 1.25);
        ctx.fillStyle = '#f9f3e3'; ctx.strokeStyle = '#d4b896'; ctx.lineWidth = 1.5 / scale;
        ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }

      // Draw catcher
      ctx.fillStyle = '#6366f1';
      ctx.beginPath(); ctx.arc(catcherPx, catcherPy - 38, 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4f46e5'; ctx.fillRect(catcherPx - 10, catcherPy - 22, 20, 30);
      // Hands open to catch
      ctx.fillStyle = '#fde68a'; ctx.strokeStyle = '#92400e'; ctx.lineWidth = 1.5;
      for (const dx of [-18, 18]) {
        ctx.beginPath(); ctx.arc(catcherPx + dx, catcherPy - 6, 9, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }

      // Crack animation
      if (s.crackT > 0) {
        s.crackT -= 0.04 * dt;
        ctx.globalAlpha = Math.max(0, s.crackT);
        ctx.font = `${32 + (1 - s.crackT) * 16}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🍳', W * s.ex, catcherPy);
        ctx.globalAlpha = 1;
      }

      // Pop text
      if (s.popAlpha > 0) {
        s.popAlpha -= 0.022 * dt; s.popY -= 0.6 * dt;
        ctx.globalAlpha = Math.max(0, s.popAlpha);
        ctx.fillStyle = s.popText.includes('COMBO') ? '#f59e0b' : s.popText.includes('DROPPED') ? '#ef4444' : '#4ade80';
        ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(s.popText, s.popX, s.popY); ctx.globalAlpha = 1;
      }

      // Streak indicator
      if (s.sig.streakCurrent >= 3) {
        ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`🔥 STREAK x${s.sig.streakCurrent}`, W / 2, H * 0.1);
      }

      // Timer pulse
      if (s.timeLeft <= 5) {
        const pulse = 0.5 + 0.5 * Math.sin(ts / 120);
        ctx.fillStyle = `rgba(239,68,68,${pulse * 0.18})`; ctx.fillRect(0, 0, W, H);
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, nextThrow]);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const resize = () => { c.width = c.offsetWidth; c.height = c.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    const onMove = (e: PointerEvent) => {
      const rect = c.getBoundingClientRect();
      catcherXRef.current = (e.clientX - rect.left) / rect.width;
    };
    c.addEventListener('pointermove', onMove);
    return () => { window.removeEventListener('resize', resize); c.removeEventListener('pointermove', onMove); };
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    if (tiltCtrlRef.current) tiltCtrlRef.current.stop();
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const buildInsights = (sig: Signals) => {
    const acc = sig.attempts > 0 ? Math.round((sig.hits / sig.attempts) * 100) : 0;
    const avg = sig.reactionTimes.length > 0 ? Math.round(sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length) : 0;
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    if (sig.score > pb) localStorage.setItem(PB_KEY, String(sig.score));
    return [
      { label: 'Accuracy', value: acc + '%', color: acc >= 70 ? '#4ade80' : acc >= 40 ? '#facc15' : '#ef4444' },
      { label: 'Avg React', value: avg + 'ms', color: ACCENT },
      { label: 'Best Streak', value: '🔥' + sig.maxStreak, color: ACCENT },
      { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && <>
        <canvas ref={canvasRef} aria-label="Egg Toss game canvas" role="img"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
        {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5 }, { label: 'SCORE', value: scoreDisplay }]} />}
      </>}
      {phase === 'done' && finalSig && <>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 5} />
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      </>}
    </GameShell>
  );
}
