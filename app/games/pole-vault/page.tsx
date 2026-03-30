/**
 * ══════════════════════════════════════════════════════════════════
 *  POLE VAULT — Ether Glimmer
 *  Hold to charge sprint. Release to plant pole. Tilt for vault angle.
 *  Mechanic: hold+release + tilt physics for max height
 * ══════════════════════════════════════════════════════════════════
 */
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { createTiltController } from '@/lib/tilt';
import { Particle, spawnBurst, updateAndDrawParticles } from '@/lib/particles';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';

// ── CONSTANTS ──────────────────────────────────────────────────────
const GAME_ID      = 'pole-vault';
const PB_KEY       = 'pb_pole-vault';
const ACCENT       = '#f59e0b';
const DURATION     = 45;
const GAME_EMOJI   = '🏃';
const GAME_TITLE   = 'Pole Vault';
const GAME_TAGLINE = 'Charge your sprint. Plant. Soar.';
const MAX_CHARGE   = 3500; // ms for full charge
const VAULT_BAR_START = 2.5; // meters, starting bar height

// ── TYPES ───────────────────────────────────────────────────────────
type AttemptPhase = 'idle' | 'running' | 'vaulting' | 'landing';

interface Attempt {
  chargeMs: number;
  peakHeight: number;
  cleared: boolean;
  barHeight: number;
}

interface Signals {
  score: number;
  attempts: number;
  bestHeight: number;
  clears: number;
  maxStreak: number;
  streak: number;
  totalCharge: number;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface VaultState {
  // Attempt management
  attemptPhase: AttemptPhase;
  chargeStart: number;    // timestamp when hold began
  chargeMs: number;       // current charge duration
  runnerX: number;        // pixels, runner position
  runnerY: number;        // pixels
  poleAngle: number;      // radians (vertical = π/2)
  poleAngleVel: number;
  runnerVx: number;
  runnerVy: number;
  isHolding: boolean;     // finger down

  // Bar
  barHeight: number;      // meters (visual scale applied)
  barCleared: boolean;

  // Physics / visuals
  vaultPeakY: number;     // peak screen Y during vault
  landX: number;          // where runner lands
  tiltInput: number;      // normalized -1..1 from device
  particles: Particle[];
  groundY: number;        // screen pixels

  // Scoring
  currentAttemptPeak: number;
  attempts: Attempt[];
  sig: Signals;

  // Display
  runPhase: number;       // 0..1 running animation phase
  gameStartTime: number;
  running: boolean;
  timeLeft: number;
  accentColor: string;

  // Outcome message
  outcomeMsg: string;
  outcomeMsgAlpha: number;
}

// ── PERSONALITY ─────────────────────────────────────────────────────
function getPersonality(sig: Signals): string {
  if (sig.clears >= 3 && sig.bestHeight >= 5.0) return 'World Record 🌟';
  if (sig.clears >= 4)                          return 'Elite Vaulter 🏅';
  if (sig.bestHeight >= 4.5)                    return 'High Flyer 🦅';
  if (sig.clears >= 2)                          return 'Bar Clearer 💪';
  if (sig.attempts >= 6)                        return 'Never Give Up 🔥';
  if (sig.totalCharge > sig.attempts * 2000)    return 'Power Charger ⚡';
  return 'Learning to Fly 🎿';
}

// ── COMPONENT ───────────────────────────────────────────────────────
export default function PoleVaultGame() {
  const theme      = useBrandTheme();
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const animRef    = useRef(0);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const tiltRef    = useRef<ReturnType<typeof createTiltController> | null>(null);
  const touchRef   = useRef(false);
  const endCalledRef = useRef(false);

  const stateRef = useRef<VaultState>({
    attemptPhase: 'idle',
    chargeStart: 0, chargeMs: 0,
    runnerX: 0, runnerY: 0,
    poleAngle: Math.PI * 0.15, poleAngleVel: 0,
    runnerVx: 0, runnerVy: 0,
    isHolding: false,
    barHeight: VAULT_BAR_START,
    barCleared: false,
    vaultPeakY: 0, landX: 0,
    tiltInput: 0, particles: [],
    groundY: 0, currentAttemptPeak: 0,
    attempts: [], sig: { score: 0, attempts: 0, bestHeight: 0, clears: 0, maxStreak: 0, streak: 0, totalCharge: 0 },
    runPhase: 0, gameStartTime: 0, running: false, timeLeft: DURATION, accentColor: ACCENT,
    outcomeMsg: '', outcomeMsgAlpha: 0,
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [chargeDisplay, setChargeDisplay] = useState(0); // 0-100
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest]       = useState(false);
  const { pops, triggerPop }            = useScorePop();
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  // ── END GAME ──────────────────────────────────────────────────────
  const endGame = useCallback(() => {
    if (endCalledRef.current) return;
    endCalledRef.current = true;
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    stopMusicRef.current?.(); stopMusicRef.current = null;
    tiltRef.current?.stop();
    sfx.gameOver();
    try {
      const prev = parseFloat(localStorage.getItem(PB_KEY) || '0');
      if (s.sig.bestHeight > prev) { localStorage.setItem(PB_KEY, String(s.sig.bestHeight)); setIsNewBest(true); }
    } catch { /* ignore */ }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  // ── GAME LOOP ────────────────────────────────────────────────────
  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;

    endCalledRef.current = false;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, attempts: 0, bestHeight: 0, clears: 0, maxStreak: 0, streak: 0, totalCharge: 0 };
    s.attemptPhase = 'idle';
    s.chargeMs = 0; s.isHolding = false;
    s.barHeight = VAULT_BAR_START;
    s.particles = []; s.gameStartTime = Date.now();
    s.outcomeMsgAlpha = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setChargeDisplay(0);

    stopMusicRef.current = startMusic('sports');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      sfx.tick();
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = window.innerWidth, H = window.innerHeight;
      const now = Date.now();
      const groundY = H * 0.78;
      s.groundY = groundY;

      // ─ Layout constants ─
      const boxX  = W * 0.62;  // pole plant box X
      const pitX  = W * 0.72;  // landing pit X
      const startX = W * 0.1;  // runner start
      const METER_PX = H * 0.065; // pixels per meter of height

      // ─ Draw Background ─
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#1e3a5f');
      bg.addColorStop(0.6, '#1e40af');
      bg.addColorStop(1, '#1d4ed8');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Stadium stands (top)
      ctx.fillStyle = '#1e2d5f';
      ctx.fillRect(0, 0, W, H * 0.22);
      ctx.fillStyle = '#263070';
      for (let si = 0; si < 8; si++) {
        ctx.fillRect(si * W / 8, H * 0.04, W / 8 - 2, H * 0.15);
      }

      // Track
      ctx.fillStyle = '#c2410c';
      ctx.fillRect(0, groundY, W, H - groundY);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(0, groundY, W, 4);

      // Landing pit
      ctx.fillStyle = '#a16207';
      ctx.fillRect(pitX, groundY + 4, W * 0.22, H - groundY - 4);
      ctx.fillStyle = '#854d0e';
      ctx.strokeStyle = '#713f12';
      ctx.lineWidth = 2;
      ctx.strokeRect(pitX, groundY + 4, W * 0.22, H - groundY - 4);

      // Plant box
      ctx.fillStyle = '#374151';
      ctx.fillRect(boxX - 6, groundY - 8, 12, 8);

      // ─ Bar + uprights ─
      const barY = groundY - s.barHeight * METER_PX;
      const barLeft  = pitX - 8;
      const barRight = pitX + W * 0.22 + 8;

      // Uprights
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(barLeft, groundY - 4); ctx.lineTo(barLeft, barY - 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(barRight, groundY - 4); ctx.lineTo(barRight, barY - 10); ctx.stroke();
      // Bar
      ctx.strokeStyle = s.barCleared ? '#4ade80' : '#f59e0b';
      ctx.lineWidth = 5;
      ctx.shadowBlur = 10; ctx.shadowColor = s.barCleared ? '#4ade80' : '#f59e0b';
      ctx.beginPath(); ctx.moveTo(barLeft, barY); ctx.lineTo(barRight, barY); ctx.stroke();
      ctx.shadowBlur = 0;

      // Bar height label
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${s.barHeight.toFixed(1)}m`, barRight + 10, barY + 5);

      // ─ Runner & Pole Physics ─
      if (s.attemptPhase === 'idle') {
        // Show runner at start, waiting for hold
        s.runnerX = startX;
        s.runnerY = groundY;
        s.runPhase = 0;
        s.chargeMs = s.isHolding ? (now - s.chargeStart) : 0;
        if (s.isHolding) {
          const chargeRatio = Math.min(1, s.chargeMs / MAX_CHARGE);
          setChargeDisplay(Math.round(chargeRatio * 100));
        }
      } else if (s.attemptPhase === 'running') {
        // Runner sprints toward box
        const chargeRatio = Math.min(1, s.chargeMs / MAX_CHARGE);
        const runSpeed = 2.5 + chargeRatio * 4.5;
        s.runnerX += runSpeed;
        s.runPhase += runSpeed * 0.12;
        s.runnerY = groundY;

        // Carrying pole (angled down)
        const poleLen = 90;
        const poleAngle = -Math.PI * 0.1;

        // Draw pole (carried while running)
        ctx.save();
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(s.runnerX, s.runnerY - 35);
        ctx.lineTo(s.runnerX + Math.cos(poleAngle) * poleLen, s.runnerY - 35 + Math.sin(poleAngle) * poleLen);
        ctx.stroke();
        ctx.restore();

        // Plant: when runner reaches box
        if (s.runnerX >= boxX - 10) {
          s.attemptPhase = 'vaulting';
          const chargeRatioFinal = Math.min(1, s.chargeMs / MAX_CHARGE);
          s.runnerVx = 0;
          s.runnerVy = -(8 + chargeRatioFinal * 9);  // launch velocity
          s.poleAngle = Math.PI * 0.15;
          s.poleAngleVel = (2 + chargeRatioFinal * 3) * 0.035;
          s.currentAttemptPeak = groundY;
          hapticScore();
          sfx.collect();
        }
      } else if (s.attemptPhase === 'vaulting') {
        // Vault physics
        const tilt = touchRef.current ? 0 : s.tiltInput;
        s.poleAngle = Math.min(Math.PI * 0.85, s.poleAngle + s.poleAngleVel + tilt * 0.015);
        s.poleAngleVel += 0.003; // slow down rotation as pole rises

        const poleLen = 100;
        const poleBottomX = boxX;
        const poleBottomY = groundY - 8;
        const poleTopX = poleBottomX + Math.cos(s.poleAngle) * poleLen;
        const poleTopY = poleBottomY - Math.sin(s.poleAngle) * poleLen;

        // Runner hangs from pole top
        s.runnerX = poleTopX;
        s.runnerY = poleTopY - 25;
        s.currentAttemptPeak = Math.min(s.currentAttemptPeak, s.runnerY);

        // Draw vaulting pole
        ctx.save();
        // Pole bend (parabolic arc)
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 5;
        ctx.shadowBlur = 6; ctx.shadowColor = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.moveTo(poleBottomX, poleBottomY);
        const midX = poleBottomX + Math.cos(s.poleAngle) * poleLen * 0.5 + Math.sin(s.poleAngle) * 15;
        const midY = poleBottomY - Math.sin(s.poleAngle) * poleLen * 0.5 - Math.cos(s.poleAngle) * 15;
        ctx.quadraticCurveTo(midX, midY, poleTopX, poleTopY);
        ctx.stroke();
        ctx.restore();

        // When pole is near vertical = max height reached
        if (s.poleAngle >= Math.PI * 0.72) {
          // Check clearance
          const peakHeightM = (groundY - s.currentAttemptPeak) / METER_PX;
          const cleared = peakHeightM >= s.barHeight - 0.15;
          s.attemptPhase = 'landing';
          s.sig.attempts++;
          s.sig.totalCharge += s.chargeMs;

          if (cleared) {
            s.barCleared = true;
            s.sig.clears++;
            s.sig.streak++;
            if (s.sig.streak > s.sig.maxStreak) s.sig.maxStreak = s.sig.streak;
            if (peakHeightM > s.sig.bestHeight) s.sig.bestHeight = peakHeightM;
            const pts = Math.round(peakHeightM * 10);
            s.sig.score += pts;
            setScoreDisplay(s.sig.score);
            triggerPop(`+${pts}`, W / 2, H * 0.3);
            spawnBurst(s.particles, s.runnerX, s.runnerY, ACCENT, 20, 6);
            sfx.collect(); hapticVictory();
            s.outcomeMsg = `🎉 Cleared ${s.barHeight.toFixed(1)}m!`;
            s.outcomeMsgAlpha = 1.0;
            // Raise bar
            setTimeout(() => {
              s.barHeight = parseFloat((s.barHeight + 0.2).toFixed(1));
              s.barCleared = false;
            }, 1500);
          } else {
            s.sig.streak = 0;
            sfx.nearMiss(); hapticFail();
            s.outcomeMsg = `No clear — ${peakHeightM.toFixed(1)}m`;
            s.outcomeMsgAlpha = 1.0;
          }

          s.landX = pitX + W * 0.1;
          setTimeout(() => {
            s.attemptPhase = 'idle';
            s.chargeMs = 0;
            setChargeDisplay(0);
          }, 1400);
        }
      } else if (s.attemptPhase === 'landing') {
        // Runner falls into pit
        s.runnerY = Math.min(groundY - 5, s.runnerY + 4);
        s.runnerX += (s.landX - s.runnerX) * 0.05;
      }

      // Draw outcome message
      if (s.outcomeMsgAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = s.outcomeMsgAlpha;
        ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 12; ctx.shadowColor = ACCENT;
        ctx.fillText(s.outcomeMsg, W / 2, H * 0.28);
        ctx.restore();
        s.outcomeMsgAlpha = Math.max(0, s.outcomeMsgAlpha - 0.015);
      }

      // Draw runner
      if (s.attemptPhase !== 'landing' || s.runnerY < groundY) {
        const legOsc = Math.sin(s.runPhase) * (s.attemptPhase === 'running' ? 18 : 0);
        ctx.save();
        ctx.translate(s.runnerX, s.runnerY);
        ctx.shadowBlur = 16; ctx.shadowColor = s.accentColor;
        ctx.fillStyle = s.accentColor;
        // Head
        ctx.beginPath(); ctx.arc(0, -52, 10, 0, Math.PI * 2); ctx.fill();
        // Torso
        ctx.fillRect(-5, -42, 10, 24);
        // Arms
        ctx.strokeStyle = s.accentColor; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(-5, -32); ctx.lineTo(-18, -20); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(5, -32);  ctx.lineTo(18, -20);  ctx.stroke();
        // Legs
        if (s.attemptPhase === 'running') {
          ctx.beginPath(); ctx.moveTo(-3, -18); ctx.lineTo(-8 - legOsc * 0.3, 0); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(3, -18);  ctx.lineTo(8 + legOsc * 0.3, 0);  ctx.stroke();
        } else {
          ctx.beginPath(); ctx.moveTo(-3, -18); ctx.lineTo(-6, 5); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(3, -18);  ctx.lineTo(6, 5);  ctx.stroke();
        }
        ctx.restore();
      }

      // Particles
      if (s.particles.length > 0) updateAndDrawParticles(ctx, s.particles);

      // ─ Charge bar (shown in idle/running phases) ─
      if (s.attemptPhase === 'idle' || s.attemptPhase === 'running') {
        const chargeRatio = Math.min(1, s.chargeMs / MAX_CHARGE);
        const barW = W * 0.55;
        const barH = 14;
        const barX = (W - barW) / 2;
        const barYPos = H - 130;

        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(barX - 2, barYPos - 2, barW + 4, barH + 4);
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(barX, barYPos, barW, barH);

        // Gradient fill: green → yellow → red
        const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
        grad.addColorStop(0, '#4ade80');
        grad.addColorStop(0.6, '#fbbf24');
        grad.addColorStop(1, '#ef4444');
        ctx.fillStyle = grad;
        ctx.fillRect(barX, barYPos, barW * chargeRatio, barH);

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(s.isHolding ? 'CHARGING... RELEASE TO RUN' : 'HOLD TO CHARGE', W / 2, barYPos - 8);
      }

      // Height meter (left edge)
      {
        const meterX = W * 0.04;
        const meterH = H * 0.55;
        const meterY = H * 0.2;
        const maxHeight = 7;
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(meterX - 2, meterY, 20, meterH);
        for (let hi = 0; hi <= maxHeight; hi++) {
          const y = meterY + meterH - (hi / maxHeight) * meterH;
          ctx.strokeStyle = 'rgba(255,255,255,0.3)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(meterX - 2, y); ctx.lineTo(meterX + 18, y); ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.font = '10px monospace';
          ctx.textAlign = 'right';
          ctx.fillText(`${hi}m`, meterX - 4, y + 4);
        }
        // Best height marker
        if (s.sig.bestHeight > 0) {
          const bestY = meterY + meterH - (s.sig.bestHeight / maxHeight) * meterH;
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(meterX - 2, bestY); ctx.lineTo(meterX + 22, bestY); ctx.stroke();
        }
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, triggerPop]);

  // ── INPUT ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      canvas.width  = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      const ctx2 = canvas.getContext('2d');
      if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = () => {
      const s = stateRef.current;
      if (!s.running || s.attemptPhase !== 'idle') return;
      s.isHolding = true; s.chargeStart = Date.now();
    };
    const onPointerUp = () => {
      const s = stateRef.current;
      if (!s.running || !s.isHolding) return;
      s.chargeMs = Date.now() - s.chargeStart;
      s.isHolding = false;
      if (s.attemptPhase === 'idle') {
        s.attemptPhase = 'running';
        sfx.collect();
      }
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    stopMusicRef.current?.();
    tiltRef.current?.stop();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio();
    const ctrl = createTiltController(
      (x) => { stateRef.current.tiltInput = x; },
      { sensitivity: 1.0, smoothing: 0.45, deadzone: 2, clamp: 30 },
    );
    const granted = await ctrl.start();
    if (granted) { tiltRef.current = ctrl; touchRef.current = false; }
    else { ctrl.stop(); touchRef.current = true; }
    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => {
    startLoop();
    setPhase('playing');
  }, [startLoop]);

  const handlePlayAgain = useCallback(async () => {
    tiltRef.current?.stop(); tiltRef.current = null;
    endCalledRef.current = false;
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false);
    setChargeDisplay(0);
    const ctrl = createTiltController(
      (x) => { stateRef.current.tiltInput = x; },
      { sensitivity: 1.0, smoothing: 0.45, deadzone: 2, clamp: 30 },
    );
    const granted = await ctrl.start();
    if (granted) { tiltRef.current = ctrl; touchRef.current = false; }
    else { ctrl.stop(); touchRef.current = true; }
    setPhase('countdown');
  }, []);

  const buildInsights = (sig: Signals) => [
    { label: 'Best Height',   value: `${sig.bestHeight.toFixed(1)}m`, color: '#fbbf24' },
    { label: 'Bars Cleared',  value: `${sig.clears}`,                 color: '#4ade80' },
    { label: 'Attempts',      value: `${sig.attempts}`,               color: theme.colors.accent ?? ACCENT },
    { label: 'Best Streak',   value: `${sig.maxStreak}x`,             color: '#c084fc' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg, #1e3a5f 0%, #1e40af 100%)">

      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Ready to Vault →"
          sensorNote="Hold screen to charge your sprint. Release to run. Tilt to adjust vault angle."
          accentColor={theme.colors.accent ?? ACCENT}
          ctaTextColor="#000"
          onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #1a2f5a 0%, #0d1a38 60%, #050d1a 100%)"
        />
      )}

      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}

      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME',   value: timeLeft,      danger: timeLeft <= 5, testId: 'timer' },
              { label: 'SCORE',  value: scoreDisplay,  testId: 'score' },
            ]} />
          )}
        </>
      )}

      <AnimatePresence>
        {isNewBest && phase === 'done' && (
          <motion.div key="nb" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)', zIndex: 90,
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', borderRadius: 20, padding: '8px 20px',
              fontSize: 20, fontWeight: 900, color: '#000', whiteSpace: 'nowrap' }}>
            🏆 New Record!
          </motion.div>
        )}
      </AnimatePresence>

      {phase === 'done' && finalSig && (
        <EndScreen
          gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={`${finalSig.bestHeight.toFixed(1)}m`} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain} didWin={finalSig.clears >= 2}
        />
      )}

      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}

      {phase === 'playing' && (
        <ScorePopEffect pops={pops} accentColor={theme.colors.accent ?? ACCENT} />
      )}
    </GameShell>
  );
}

// ── WEBHOOK EMITTER ─────────────────────────────────────────────────
function WebhookEmitter({ theme, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>;
  sig: Signals; personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, {
      personality, score: sig.score, bestHeight: sig.bestHeight,
      clears: sig.clears, attempts: sig.attempts,
    }, player);
  }, [theme, sig, personality, player]);
  return null;
}
