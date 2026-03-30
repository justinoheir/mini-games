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

const GAME_ID = 'curling-sweep';
const ACCENT = '#67e8f9';
const DURATION = 45;
const GAME_EMOJI = '🥌';
const GAME_TITLE = 'Curling Sweep';
const GAME_TAGLINE = 'Flick to throw. Tilt to sweep!';
const BG_COLOR = '#040d14';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = 'calm';
const PB_KEY = 'mg_pb_curling-sweep';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  if (sig.score >= 20) return '🥌 Olympic Curler';
  if (sig.score >= 12) return '🎯 Skip Champion';
  if (sig.maxStreak >= 3) return '🌀 Sweep Master';
  return '🧹 The Sweeper';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function CurlingSweepGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const tiltCtrlRef = useRef<ReturnType<typeof createTiltController> | null>(null);
  const tiltXRef = useRef(0);
  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { score: 0, hits: 0, attempts: 0, reactionTimes: [] as number[], maxStreak: 0, streakCurrent: 0 },
    // Stone state
    stoneState: 'aim' as 'aim' | 'sliding' | 'scoring' | 'resetting',
    stoneX: 0.5, stoneY: 0.85,
    stoneVX: 0, stoneVY: 0,
    stoneSpin: 0, stoneSpinV: 0,
    // Throw gesture
    throwStartX: 0, throwStartY: 0, throwStartT: 0,
    isAiming: false,
    // Target
    targetX: 0.5,
    rings: [0.24, 0.18, 0.12, 0.06], // ring radii as fraction of width
    // Ice markings
    sweepEffect: 0, sweepDir: 0,
    popText: '', popAlpha: 0, popY: 0,
    lastTs: 0, resetTimer: 0,
    iceParticles: [] as { x: number; y: number; vx: number; vy: number; life: number }[],
    stoneTrail: [] as { x: number; y: number }[],
    throwTime: 0,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const resetStone = useCallback(() => {
    const s = stateRef.current;
    s.stoneX = 0.5; s.stoneY = 0.85;
    s.stoneVX = 0; s.stoneVY = 0;
    s.stoneSpinV = 0; s.stoneSpin = 0;
    s.stoneState = 'aim';
    s.stoneTrail = [];
    s.targetX = 0.3 + Math.random() * 0.4;
    s.sig.attempts++;
    s.throwTime = Date.now();
  }, []);

  const scoreShot = useCallback(() => {
    const s = stateRef.current;
    const c = canvasRef.current; if (!c) return;
    const W = c.width;
    const dx = Math.abs(s.stoneX - s.targetX);
    const ringW = s.rings[0] * W * 0.8;
    const bullseye = dx < s.rings[3] * W * 0.8;
    const ring1 = dx < s.rings[2] * W * 0.8;
    const ring2 = dx < s.rings[1] * W * 0.8;
    const ring3 = dx < s.rings[0] * W * 0.8;

    let pts = 0;
    if (bullseye) { pts = 4; sfx.success(); haptic([40, 20, 80]); }
    else if (ring1) { pts = 3; sfx.collect(); haptic([30, 20, 60]); }
    else if (ring2) { pts = 2; sfx.collect(); haptic([30]); }
    else if (ring3) { pts = 1; sfx.collect(); haptic([20]); }
    else { sfx.nearMiss(); haptic([20, 30, 20]); }

    if (pts > 0) {
      s.sig.hits++; s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const bonus = s.sig.streakCurrent >= 3 ? pts + 1 : pts;
      s.sig.score += bonus; setScoreDisplay(s.sig.score);
      s.sig.reactionTimes.push(Date.now() - s.throwTime);
      s.popText = bullseye ? `BULLSEYE! +${bonus} ⭐` : `${ring1 ? 'GREAT' : 'GOOD'}! +${bonus}`;
    } else {
      s.sig.streakCurrent = 0;
      s.popText = 'OUT! 0pts';
      const missX = s.stoneX;
      for (let i = 0; i < 6; i++) {
        s.iceParticles.push({ x: missX * (c.width || 400), y: 0.22 * (c.height || 600), vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4, life: 1 });
      }
    }

    s.popAlpha = 1; s.popY = (c.height || 600) * 0.25;
    s.stoneState = 'resetting'; s.resetTimer = 80;
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
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, hits: 0, attempts: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic(MUSIC_PAT);
    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([100]); endGame(); }
    }, 1000);
    const tiltCtrl = createTiltController((x) => { tiltXRef.current = x; }, { sensitivity: 1.0, clamp: 20 });
    tiltCtrl.start(); tiltCtrlRef.current = tiltCtrl;
    resetStone();

    const loop = (ts: number) => {
      if (!s.running) return;
      const dt = s.lastTs ? Math.min((ts - s.lastTs) / 16.67, 3) : 1;
      s.lastTs = ts;
      const W = c.width, H = c.height;
      ctx.clearRect(0, 0, W, H);

      // Ice background
      const iceGrad = ctx.createLinearGradient(0, 0, 0, H);
      iceGrad.addColorStop(0, '#0a1e2e'); iceGrad.addColorStop(1, '#061018');
      ctx.fillStyle = iceGrad; ctx.fillRect(0, 0, W, H);

      // Ice sheen
      for (let i = 0; i < 5; i++) {
        const iy = H * (0.1 + i * 0.18);
        ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, iy); ctx.lineTo(W, iy + 10); ctx.stroke();
      }

      // Target area (house)
      const hx = s.targetX * W, hy = H * 0.22, hr = W * 0.25;
      // Rings
      const ringColors = ['#ef4444', '#ffffff', '#ef4444', '#1d4ed8'];
      for (let i = 0; i < s.rings.length; i++) {
        ctx.fillStyle = ringColors[i];
        ctx.beginPath(); ctx.arc(hx, hy, s.rings[i] * W * 0.8, 0, Math.PI * 2); ctx.fill();
      }
      // Inner button
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2); ctx.fill();
      // House label
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
      ctx.fillText('TARGET', hx, hy + hr * 0.6 + 12);

      // Delivery line
      ctx.strokeStyle = 'rgba(103,232,249,0.15)'; ctx.lineWidth = 1; ctx.setLineDash([6, 10]);
      ctx.beginPath(); ctx.moveTo(W / 2, H * 0.9); ctx.lineTo(hx, hy); ctx.stroke(); ctx.setLineDash([]);

      // Tee line (where stone stops)
      ctx.strokeStyle = 'rgba(103,232,249,0.3)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(W * 0.05, H * 0.22); ctx.lineTo(W * 0.95, H * 0.22); ctx.stroke();

      // Stone trail
      s.stoneTrail.forEach((p, i) => {
        ctx.globalAlpha = 0.15 * (1 - i / s.stoneTrail.length);
        ctx.fillStyle = '#67e8f9';
        ctx.beginPath(); ctx.arc(p.x * W, p.y * H, 10, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;

      // Physics update
      if (s.stoneState === 'sliding') {
        // Tilt-based sweeping
        const sweepForce = tiltXRef.current * 0.00015;
        s.stoneVX += sweepForce * dt;
        // Friction
        const friction = 0.994;
        s.stoneVX *= Math.pow(friction, dt);
        s.stoneVY *= Math.pow(friction, dt);
        s.stoneX += s.stoneVX * dt;
        s.stoneY += s.stoneVY * dt;
        s.stoneSpin += s.stoneSpinV * dt;
        s.stoneSpinV *= 0.98;

        // Wall clamp
        s.stoneX = Math.max(0.06, Math.min(0.94, s.stoneX));

        // Trail
        s.stoneTrail.unshift({ x: s.stoneX, y: s.stoneY });
        if (s.stoneTrail.length > 20) s.stoneTrail.pop();

        // Sweep ice particles from tilt
        if (Math.abs(tiltXRef.current) > 0.2) {
          s.iceParticles.push({ x: s.stoneX * W, y: s.stoneY * H, vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 2, life: 1 });
        }

        // Stop when slow or past target line
        const speed = Math.sqrt(s.stoneVX * s.stoneVX + s.stoneVY * s.stoneVY);
        if (speed < 0.0005 || s.stoneY < 0.2) {
          s.stoneState = 'scoring';
          scoreShot();
        }
      }

      if (s.stoneState === 'resetting') {
        s.resetTimer -= dt;
        if (s.resetTimer <= 0) resetStone();
      }

      // Ice particles (sweep spray)
      s.iceParticles.forEach(p => {
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= 0.04 * dt;
        ctx.globalAlpha = Math.max(0, p.life * 0.7);
        ctx.fillStyle = '#a5f3fc';
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
      });
      s.iceParticles = s.iceParticles.filter(p => p.life > 0);
      ctx.globalAlpha = 1;

      // Draw stone
      const sx = s.stoneX * W, sy = s.stoneY * H;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(s.stoneSpin);
      // Stone handle
      ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, -16, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(0, -8); ctx.stroke();
      // Stone body (granite)
      const stoneGrad = ctx.createRadialGradient(-6, -6, 2, 0, 0, 22);
      stoneGrad.addColorStop(0, '#94a3b8'); stoneGrad.addColorStop(0.6, '#475569'); stoneGrad.addColorStop(1, '#1e293b');
      ctx.fillStyle = stoneGrad;
      ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.stroke();
      // Team color ring
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();

      // Aim indicator
      if (s.stoneState === 'aim') {
        ctx.strokeStyle = ACCENT + '60'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 8]);
        ctx.beginPath(); ctx.moveTo(sx, sy - 22); ctx.lineTo(s.targetX * W, H * 0.22); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = ACCENT + 'cc'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('SWIPE UP TO THROW', W / 2, H * 0.93);
        ctx.fillStyle = '#a5f3fc80'; ctx.font = '11px sans-serif';
        ctx.fillText('TILT TO SWEEP IN FLIGHT', W / 2, H * 0.96);
      }

      // Tilt sweep indicator (in flight)
      if (s.stoneState === 'sliding') {
        const tiltAmt = tiltXRef.current;
        if (Math.abs(tiltAmt) > 0.1) {
          const sweepText = tiltAmt > 0 ? '← SWEEP LEFT' : 'SWEEP RIGHT →';
          ctx.fillStyle = `rgba(103,232,249,${Math.abs(tiltAmt)})`;
          ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(sweepText, W / 2, H * 0.93);
        }
      }

      // Pop text
      if (s.popAlpha > 0) {
        s.popAlpha -= 0.018 * dt; s.popY -= 0.4 * dt;
        ctx.globalAlpha = Math.max(0, s.popAlpha);
        ctx.fillStyle = s.popText.includes('BULLSEYE') ? '#f59e0b' : s.popText.includes('OUT') ? '#ef4444' : ACCENT;
        ctx.font = `bold ${s.popText.includes('BULLSEYE') ? 26 : 20}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(s.popText, W / 2, s.popY); ctx.globalAlpha = 1;
      }

      // Streak
      if (s.sig.streakCurrent >= 3) {
        ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`🥌 ON FIRE x${s.sig.streakCurrent}`, W / 2, H * 0.1);
      }

      // Timer pulse
      if (s.timeLeft <= 5) {
        const pulse = 0.5 + 0.5 * Math.sin(ts / 120);
        ctx.fillStyle = `rgba(239,68,68,${pulse * 0.18})`; ctx.fillRect(0, 0, W, H);
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, resetStone, scoreShot]);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const resize = () => { c.width = c.offsetWidth; c.height = c.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    let startY = 0, startX = 0, startT = 0;
    const onDown = (e: PointerEvent) => {
      const rect = c.getBoundingClientRect();
      startY = e.clientY - rect.top; startX = e.clientX - rect.left; startT = Date.now();
    };
    const onUp = (e: PointerEvent) => {
      const s = stateRef.current;
      if (s.stoneState !== 'aim') return;
      const rect = c.getBoundingClientRect();
      const dy = (e.clientY - rect.top) - startY;
      const dx = (e.clientX - rect.left) - startX;
      const dt = Math.max(Date.now() - startT, 50);
      if (dy < -20) {
        // Upward swipe = throw
        const velY = Math.min(Math.abs(dy) / dt * 0.012, 0.022);
        const velX = (dx / dt) * 0.006;
        const s2 = stateRef.current;
        s2.stoneVX = velX; s2.stoneVY = -velY;
        s2.stoneSpinV = dx / dt * 0.05;
        s2.stoneState = 'sliding';
        sfx.whoosh(); haptic([30]);
      }
    };
    // Touch-based sweep fallback (drag left/right while stone is moving)
    const onMove = (e: PointerEvent) => {
      const s = stateRef.current;
      if (s.stoneState === 'sliding') {
        const rect = c.getBoundingClientRect();
        const cx = (e.clientX - rect.left) / rect.width;
        tiltXRef.current = (cx - 0.5) * 2;
      }
    };
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('resize', resize);
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointerup', onUp);
      c.removeEventListener('pointermove', onMove);
    };
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
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    if (sig.score > pb) localStorage.setItem(PB_KEY, String(sig.score));
    return [
      { label: 'On Target', value: acc + '%', color: acc >= 70 ? '#4ade80' : acc >= 40 ? '#facc15' : '#ef4444' },
      { label: 'Shots', value: String(sig.hits), color: ACCENT },
      { label: 'Best Run', value: '🥌' + sig.maxStreak, color: ACCENT },
      { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && <>
        <canvas ref={canvasRef} aria-label="Curling Sweep game canvas" role="img"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
        {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5 }, { label: 'SCORE', value: scoreDisplay }]} />}
      </>}
      {phase === 'done' && finalSig && <>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 10} />
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      </>}
    </GameShell>
  );
}
