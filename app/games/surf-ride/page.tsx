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

const GAME_ID = 'surf-ride';
const ACCENT = '#34d399';
const DURATION = 45;
const GAME_EMOJI = '🏄';
const GAME_TITLE = 'Surf Ride';
const GAME_TAGLINE = 'Tilt to balance. Survive the wipeout!';
const BG_COLOR = '#020b18';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = 'ambient';
const PB_KEY = 'mg_pb_surf-ride';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  if (sig.score >= 30) return '🏄 Pipeline Legend';
  if (sig.score >= 18) return '🌊 Tube Rider';
  if (sig.maxStreak >= 5) return '🔥 Hot Surfer';
  if (sig.hits < 3) return '💦 Wipeout King';
  return '🤙 Hang Loose';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function SurfRideGame() {
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
    // Surfer physics
    surferX: 0.5,
    surferLean: 0, // -1 to 1
    surferVelX: 0,
    // Wave
    waveTime: 0,
    waveAmplitude: 0.05,
    waveFreq: 1.8,
    waveSpeed: 0.015,
    waveScrollX: 0,
    // Balance
    balance: 0, // -1 (hard left) to 1 (hard right)
    balanceVel: 0,
    isWipingOut: false,
    wipeoutT: 0,
    // Score per-second
    scoreAccum: 0,
    scoreTimer: 0,
    bonusActive: false,
    bonusTimer: 0,
    // Obstacles (waves/rocks)
    obstacles: [] as { x: number; type: 'wave' | 'rock'; passed: boolean }[],
    lastObstacle: 0,
    // Particles
    splashParticles: [] as { x: number; y: number; vx: number; vy: number; life: number; color: string }[],
    wakePoints: [] as { x: number; y: number; life: number }[],
    lastTs: 0,
    difficulty: 1,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const doWipeout = useCallback(() => {
    const s = stateRef.current;
    if (s.isWipingOut) return;
    s.isWipingOut = true; s.wipeoutT = 1;
    sfx.collision(); haptic([80, 40, 80]);
    s.sig.streakCurrent = 0; s.sig.attempts++;
    // Splash particles
    const c = canvasRef.current;
    if (c) {
      const W = c.width, H = c.height;
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        s.splashParticles.push({
          x: s.surferX * W, y: H * 0.55,
          vx: Math.cos(angle) * (2 + Math.random() * 4),
          vy: Math.sin(angle) * (2 + Math.random() * 4) - 3,
          life: 1, color: `hsl(${190 + Math.random() * 30}, 80%, ${60 + Math.random() * 20}%)`
        });
      }
    }
    // Auto-recover after 1.2s
    setTimeout(() => {
      const st = stateRef.current;
      if (!st.running) return;
      st.isWipingOut = false; st.balance = 0; st.balanceVel = 0;
      st.surferX = 0.3 + Math.random() * 0.4;
      st.sig.hits++; // count recovery as a "ride"
    }, 1200);
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
    s.running = true; s.timeLeft = DURATION; s.isWipingOut = false;
    s.sig = { score: 0, hits: 0, attempts: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 };
    s.surferX = 0.5; s.balance = 0; s.balanceVel = 0;
    s.waveTime = 0; s.waveScrollX = 0; s.scoreAccum = 0; s.scoreTimer = 0;
    s.obstacles = []; s.lastObstacle = 0; s.splashParticles = []; s.wakePoints = [];
    s.difficulty = 1;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic(MUSIC_PAT);
    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([100]); endGame(); }
    }, 1000);
    const tiltCtrl = createTiltController((x) => { tiltXRef.current = x; }, { sensitivity: 1.1, clamp: 22 });
    tiltCtrl.start(); tiltCtrlRef.current = tiltCtrl;

    const loop = (ts: number) => {
      if (!s.running) return;
      const dt = s.lastTs ? Math.min((ts - s.lastTs) / 16.67, 3) : 1;
      s.lastTs = ts;
      const W = c.width, H = c.height;
      ctx.clearRect(0, 0, W, H);

      s.waveTime += 0.02 * dt;
      s.waveScrollX -= s.waveSpeed * dt;
      s.difficulty = 1 + (DURATION - s.timeLeft) / DURATION * 2;

      // Sky
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.45);
      skyGrad.addColorStop(0, '#020b18'); skyGrad.addColorStop(1, '#0c2a45');
      ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H * 0.45);
      // Sun
      ctx.fillStyle = '#fde68a';
      ctx.beginPath(); ctx.arc(W * 0.8, H * 0.08, 28, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(253,230,138,0.15)';
      ctx.beginPath(); ctx.arc(W * 0.8, H * 0.08, 42, 0, Math.PI * 2); ctx.fill();

      // Wave function
      const getWaveY = (xNorm: number): number => {
        const x = xNorm + s.waveScrollX;
        let y = Math.sin(x * Math.PI * 2 * s.waveFreq + s.waveTime) * s.waveAmplitude;
        y += Math.sin(x * Math.PI * 2 * s.waveFreq * 1.7 + s.waveTime * 1.3) * s.waveAmplitude * 0.5;
        y += Math.sin(x * Math.PI * 2 * s.waveFreq * 3.1 + s.waveTime * 0.7) * s.waveAmplitude * 0.25;
        return 0.5 + y * s.difficulty;
      };

      // Draw ocean
      const oceanGrad = ctx.createLinearGradient(0, H * 0.4, 0, H);
      oceanGrad.addColorStop(0, '#0369a1'); oceanGrad.addColorStop(0.3, '#0284c7'); oceanGrad.addColorStop(1, '#082f49');
      ctx.fillStyle = oceanGrad; ctx.fillRect(0, H * 0.4, W, H * 0.6);

      // Draw wave surface
      ctx.beginPath(); ctx.moveTo(0, H * getWaveY(0));
      for (let i = 1; i <= 60; i++) {
        const xn = i / 60;
        ctx.lineTo(xn * W, H * getWaveY(xn));
      }
      ctx.lineTo(W, H * 0.7); ctx.lineTo(0, H * 0.7); ctx.closePath();
      const waveGrad = ctx.createLinearGradient(0, H * 0.45, 0, H * 0.7);
      waveGrad.addColorStop(0, '#38bdf8cc'); waveGrad.addColorStop(1, '#0369a1');
      ctx.fillStyle = waveGrad; ctx.fill();

      // Wave crest foam
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(0, H * getWaveY(0));
      for (let i = 1; i <= 60; i++) {
        const xn = i / 60;
        ctx.lineTo(xn * W, H * getWaveY(xn));
      }
      ctx.stroke();

      // Horizon shimmer
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      for (let i = 0; i < 6; i++) {
        const shimX = ((s.waveScrollX * 60 + i * 17) % 1) * W;
        ctx.fillRect(shimX, H * 0.47, 40 + i * 8, 2);
      }

      // Update balance physics
      if (!s.isWipingOut) {
        const waveYAtSurfer = getWaveY(s.surferX);
        const waveSlope = getWaveY(s.surferX + 0.01) - getWaveY(s.surferX - 0.01);
        const slopePush = waveSlope * 15 * s.difficulty;
        const tiltCorrection = tiltXRef.current * 2.5;

        s.balanceVel += (slopePush - tiltCorrection) * 0.04 * dt;
        s.balanceVel *= 0.88;
        s.balance += s.balanceVel * dt;
        s.balance = Math.max(-1.5, Math.min(1.5, s.balance));

        // Surfer moves slightly with tilt
        s.surferVelX += tiltXRef.current * 0.0008 * dt;
        s.surferVelX *= 0.92;
        s.surferX += s.surferVelX * dt;
        s.surferX = Math.max(0.06, Math.min(0.94, s.surferX));

        // Score points per frame when balanced
        const balanceMag = Math.abs(s.balance);
        if (balanceMag < 0.5) {
          s.scoreTimer += dt;
          s.sig.streakCurrent = Math.min(s.sig.streakCurrent + dt * 0.02, 10);
          if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = Math.ceil(s.sig.streakCurrent);
          if (s.scoreTimer >= 30) {
            s.scoreTimer = 0;
            const pts = balanceMag < 0.15 ? 2 : 1;
            s.sig.score += pts; setScoreDisplay(s.sig.score);
            if (pts === 2) { sfx.tick(); haptic([20]); }
            s.sig.hits++;
          }
        } else {
          s.sig.streakCurrent = Math.max(0, s.sig.streakCurrent - dt * 0.05);
          s.scoreTimer = 0;
        }

        // Wipeout threshold
        if (Math.abs(s.balance) > 1.2) doWipeout();

        // Wake trail
        s.wakePoints.unshift({ x: s.surferX * W, y: H * waveYAtSurfer + 8, life: 1 });
        if (s.wakePoints.length > 25) s.wakePoints.pop();
      } else {
        s.wipeoutT -= 0.025 * dt;
        s.wakePoints = [];
      }

      // Draw wake trail
      s.wakePoints.forEach((p, i) => {
        p.life -= 0.04;
        ctx.globalAlpha = Math.max(0, p.life * 0.3);
        ctx.strokeStyle = '#a7f3d0'; ctx.lineWidth = 2;
        if (i > 0) {
          ctx.beginPath();
          ctx.moveTo(s.wakePoints[i - 1].x - 10, s.wakePoints[i - 1].y);
          ctx.lineTo(p.x - 10, p.y); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(s.wakePoints[i - 1].x + 10, s.wakePoints[i - 1].y);
          ctx.lineTo(p.x + 10, p.y); ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;

      // Draw surfer
      const sx = s.surferX * W;
      const sy = H * getWaveY(s.surferX) - 8;
      const leanAngle = s.isWipingOut ? s.wipeoutT * Math.PI * 1.5 : s.balance * 0.4;

      if (!s.isWipingOut || s.wipeoutT > 0.1) {
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(leanAngle);
        // Surfboard
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath(); ctx.ellipse(0, 8, 32, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath(); ctx.ellipse(0, 8, 28, 4, 0, 0, Math.PI * 2); ctx.fill();
        // Board stripe
        ctx.fillStyle = '#ef4444'; ctx.fillRect(-28, 5, 56, 3);
        // Surfer body
        ctx.fillStyle = '#1f2937'; // wetsuit
        ctx.beginPath(); ctx.arc(0, -20, 11, 0, Math.PI * 2); ctx.fill(); // head
        ctx.fillRect(-8, -9, 16, 18); // torso
        // Arms (wide for balance)
        ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-8, -5); ctx.lineTo(-28, -12); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(8, -5); ctx.lineTo(28, -12); ctx.stroke();
        // Face
        ctx.fillStyle = '#fed7aa';
        ctx.beginPath(); ctx.arc(0, -20, 8, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      // Wipeout splash
      if (s.isWipingOut && s.wipeoutT > 0) {
        ctx.globalAlpha = s.wipeoutT;
        ctx.font = '38px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('💦', sx, sy - 10 - (1 - s.wipeoutT) * 30);
        ctx.globalAlpha = 1;
      }

      // Splash particles
      s.splashParticles.forEach(p => {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.2 * dt; p.life -= 0.035 * dt;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
      });
      s.splashParticles = s.splashParticles.filter(p => p.life > 0);
      ctx.globalAlpha = 1;

      // Balance indicator bar at bottom
      const barW = W * 0.55, barH = 10;
      const barX = (W - barW) / 2, barY = H - 38;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, 5); ctx.fill();
      const balancePct = (s.balance + 1.5) / 3;
      const balColor = Math.abs(s.balance) < 0.5 ? '#34d399' : Math.abs(s.balance) < 1 ? '#fbbf24' : '#ef4444';
      ctx.fillStyle = balColor;
      ctx.beginPath(); ctx.roundRect(barX, barY, barW * Math.min(balancePct, 1), barH, 5); ctx.fill();
      // Center marker
      ctx.strokeStyle = '#ffffff66'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(barX + barW / 2, barY - 3); ctx.lineTo(barX + barW / 2, barY + barH + 3); ctx.stroke();
      ctx.fillStyle = '#94a3b8'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('BALANCE', W / 2, H - 22);

      // Streak ring when perfectly balanced
      if (Math.abs(s.balance) < 0.2 && !s.isWipingOut) {
        const pulse = 0.4 + 0.6 * Math.sin(ts / 300);
        ctx.strokeStyle = `rgba(52,211,153,${pulse})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(sx, sy - 15, 40, 0, Math.PI * 2); ctx.stroke();
      }

      // Streak
      if (s.sig.streakCurrent >= 3) {
        ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`🏄 RIDING x${Math.floor(s.sig.streakCurrent)}`, W / 2, H * 0.1);
      }

      // Timer pulse
      if (s.timeLeft <= 5) {
        const pulse = 0.5 + 0.5 * Math.sin(ts / 120);
        ctx.fillStyle = `rgba(239,68,68,${pulse * 0.18})`; ctx.fillRect(0, 0, W, H);
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, doWipeout]);

  // Touch fallback for balance (drag left/right)
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const resize = () => { c.width = c.offsetWidth; c.height = c.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    const onMove = (e: PointerEvent) => {
      const rect = c.getBoundingClientRect();
      tiltXRef.current = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
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
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    if (sig.score > pb) localStorage.setItem(PB_KEY, String(sig.score));
    return [
      { label: 'Rides', value: String(sig.hits), color: '#4ade80' },
      { label: 'Max Balance', value: '🏄' + Math.floor(sig.maxStreak), color: ACCENT },
      { label: 'Wipeouts', value: String(sig.attempts), color: sig.attempts < 3 ? '#4ade80' : '#ef4444' },
      { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Drop In!" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && <>
        <canvas ref={canvasRef} aria-label="Surf Ride game canvas" role="img"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
        {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5 }, { label: 'SCORE', value: scoreDisplay }]} />}
      </>}
      {phase === 'done' && finalSig && <>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 15} />
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      </>}
    </GameShell>
  );
}
