'use client';
/**
 * THREAD NEEDLE
 * Real mechanic: The needle oscillates left/right. Drag the thread endpoint through
 * the needle's eye (small gap) to score. As score increases the needle moves faster.
 */
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
import { motion, AnimatePresence } from 'framer-motion';

const GAME_ID = 'thread-needle';
const ACCENT = '#f472b6';
const DURATION = 45;
const GAME_EMOJI = '🪡';
const GAME_TITLE = 'Thread Needle';
const GAME_TAGLINE = 'Guide the thread through the moving eye.';
const PB_KEY = 'mg_pb_thread-needle';

interface Signals {
  score: number; attempts: number; maxStreak: number; streakCurrent: number; nearMisses: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.score / sig.attempts : 0;
  if (acc >= 0.8 && sig.score >= 6) return 'Master Tailor 🧵';
  if (acc >= 0.6 && sig.score >= 4) return 'Steady Stitcher 🪡';
  if (sig.score >= 3) return 'Thread Wrangler 🧶';
  if (sig.nearMisses > sig.score * 2) return 'Almost Had It 😤';
  return 'Tangled Beginner 🤕';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function ThreadNeedleGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef({
    running: false,
    timeLeft: DURATION,
    sig: { score: 0, attempts: 0, maxStreak: 0, streakCurrent: 0, nearMisses: 0 } as Signals,
    // Needle
    needleX: 0,       // center X of needle eye
    needleY: 0,       // center Y of needle
    needleOscPhase: 0,
    needleSpeed: 1.2, // oscillation speed factor
    // Thread anchor (fixed bottom center)
    anchorX: 0, anchorY: 0,
    // Thread endpoint (dragged by player)
    threadX: 0, threadY: 0,
    dragging: false,
    // Threading state
    inEye: false,
    threaded: false,       // currently inside the eye
    flashGreen: 0,         // timestamp for success flash
    flashRed: 0,
    // Eye geometry
    eyeWidth: 22,
    eyeHeight: 10,
    accentColor: ACCENT,
    lastNearMiss: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streakDisplay, setStreakDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [scorePop, setScorePop] = useState<string | null>(null);
  const [nearMsg, setNearMsg] = useState(false);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.gameOver(); haptic([100]);
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0', 10);
      if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score));
    } catch { /* noop */ }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const W = window.innerWidth, H = window.innerHeight;
    const s = stateRef.current;
    s.running = true;
    s.timeLeft = DURATION;
    s.sig = { score: 0, attempts: 0, maxStreak: 0, streakCurrent: 0, nearMisses: 0 };
    s.anchorX = W / 2; s.anchorY = H - 60;
    s.threadX = W / 2; s.threadY = H - 60;
    s.needleX = W / 2; s.needleY = H * 0.3;
    s.needleOscPhase = 0; s.needleSpeed = 1.2;
    s.dragging = false; s.threaded = false;
    s.flashGreen = 0; s.flashRed = 0;
    setScoreDisplay(0); setStreakDisplay(0); setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('minimal');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) { sfx.warning(); haptic([50, 30, 50]); }
      else if (s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    // Needle height and geometry
    const needleH = 100;
    const eyeW = s.eyeWidth;
    const eyeH = s.eyeHeight;
    const eyeOffsetFromTop = needleH * 0.22; // eye is near the tip

    const SWING = W * 0.32; // oscillation amplitude

    const loop = () => {
      if (!s.running) return;
      const now = Date.now();
      const accent = s.accentColor;
      ctx.clearRect(0, 0, W, H);

      // Background
      ctx.fillStyle = '#1a0010'; ctx.fillRect(0, 0, W, H);
      const vg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

      // Success/fail flash
      if (now < s.flashGreen) {
        const p = Math.max(0, 1 - (now - (s.flashGreen - 300)) / 300);
        ctx.fillStyle = `rgba(74,222,128,${p * 0.2})`; ctx.fillRect(0, 0, W, H);
      }
      if (now < s.flashRed) {
        const p = Math.max(0, 1 - (now - (s.flashRed - 200)) / 200);
        ctx.fillStyle = `rgba(239,68,68,${p * 0.25})`; ctx.fillRect(0, 0, W, H);
      }

      // Oscillate needle
      s.needleOscPhase += 0.018 * s.needleSpeed;
      s.needleX = W / 2 + Math.sin(s.needleOscPhase) * SWING;
      const needleCX = s.needleX;
      const needleCY = s.needleY;
      const eyeCX = needleCX;
      const eyeCY = needleCY - needleH / 2 + eyeOffsetFromTop + eyeH / 2;

      // Draw fabric threads background
      ctx.save(); ctx.globalAlpha = 0.08;
      ctx.strokeStyle = '#f472b6'; ctx.lineWidth = 1;
      for (let y = 0; y < H; y += 18) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.restore();

      // Guide line (faint) from anchor area to eye
      ctx.save();
      ctx.strokeStyle = 'rgba(244,114,182,0.15)'; ctx.lineWidth = 1; ctx.setLineDash([8, 12]);
      ctx.beginPath(); ctx.moveTo(s.anchorX, s.anchorY); ctx.lineTo(eyeCX, eyeCY);
      ctx.stroke(); ctx.setLineDash([]); ctx.restore();

      // Draw needle
      ctx.save();
      // Needle body (silver metallic)
      const nGrad = ctx.createLinearGradient(needleCX - 4, 0, needleCX + 4, 0);
      nGrad.addColorStop(0, '#888'); nGrad.addColorStop(0.4, '#eee'); nGrad.addColorStop(0.7, '#aaa'); nGrad.addColorStop(1, '#666');
      ctx.fillStyle = nGrad;
      ctx.shadowBlur = 10; ctx.shadowColor = '#ffffff44';
      // Body above eye
      ctx.fillRect(needleCX - 4, needleCY - needleH / 2, 8, eyeOffsetFromTop - eyeH / 2);
      // Body below eye
      ctx.fillRect(needleCX - 4, eyeCY + eyeH / 2, 8, needleH - eyeOffsetFromTop - eyeH / 2 - 2);
      // Left side of eye
      ctx.fillRect(needleCX - 4, eyeCY - eyeH / 2, (4 - eyeW / 2), eyeH);
      // Right side of eye
      ctx.fillRect(needleCX + eyeW / 2, eyeCY - eyeH / 2, (4 - eyeW / 2 + 4), eyeH);
      // Needle tip
      ctx.beginPath(); ctx.moveTo(needleCX - 4, needleCY + needleH / 2 - 2);
      ctx.lineTo(needleCX + 4, needleCY + needleH / 2 - 2); ctx.lineTo(needleCX, needleCY + needleH / 2 + 14);
      ctx.closePath(); ctx.fill();
      ctx.restore();

      // Eye outline/glow
      const eyeInRange = s.dragging && Math.abs(s.threadX - eyeCX) < eyeW && Math.abs(s.threadY - eyeCY) < eyeH + 8;
      ctx.save();
      ctx.strokeStyle = eyeInRange ? '#4ade80' : (accent + '99');
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = eyeInRange ? 18 : 8;
      ctx.shadowColor = eyeInRange ? '#4ade80' : accent;
      ctx.beginPath(); ctx.ellipse(eyeCX, eyeCY, eyeW / 2, eyeH / 2, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();

      // Thread (anchor to thread endpoint)
      ctx.save();
      ctx.shadowBlur = 10; ctx.shadowColor = accent;
      ctx.strokeStyle = accent; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s.anchorX, s.anchorY);
      // Slight curve for natural thread look
      const cpX = (s.anchorX + s.threadX) / 2 + (s.threadX - s.anchorX) * 0.1;
      const cpY = (s.anchorY + s.threadY) / 2 - 30;
      ctx.quadraticCurveTo(cpX, cpY, s.threadX, s.threadY);
      ctx.stroke();
      ctx.restore();

      // Thread endpoint dot
      ctx.save();
      ctx.fillStyle = '#ffffff'; ctx.shadowBlur = 12; ctx.shadowColor = accent;
      ctx.beginPath(); ctx.arc(s.threadX, s.threadY, 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Anchor bobbin
      ctx.save();
      ctx.fillStyle = accent; ctx.shadowBlur = 8; ctx.shadowColor = accent;
      ctx.beginPath(); ctx.arc(s.anchorX, s.anchorY, 12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();

      // Threading check: thread endpoint passes through eye
      const inEyeNow = (
        Math.abs(s.threadX - eyeCX) < eyeW / 2 - 1 &&
        Math.abs(s.threadY - eyeCY) < eyeH / 2 + 4
      );

      // Near miss detection
      const nearEye = Math.abs(s.threadX - eyeCX) < eyeW + 10 && Math.abs(s.threadY - eyeCY) < eyeH + 15;

      if (inEyeNow && !s.threaded && s.dragging) {
        s.threaded = true;
        s.sig.score++;
        s.sig.attempts++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        s.needleSpeed = Math.min(3.5, 1.2 + s.sig.score * 0.2);
        s.flashGreen = now + 300;
        setScoreDisplay(s.sig.score);
        setStreakDisplay(s.sig.streakCurrent);
        sfx.collect(); haptic([30]);
        const bonus = s.sig.streakCurrent >= 3 ? '+2 🔥' : '+1';
        setScorePop(bonus);
        setTimeout(() => setScorePop(null), 700);
      } else if (!inEyeNow && s.threaded) {
        s.threaded = false;
      }

      // Near miss feedback (only while dragging, not in eye, close to eye)
      if (s.dragging && !inEyeNow && nearEye) {
        const nmt = Date.now();
        if (nmt - s.lastNearMiss > 2000) {
          s.lastNearMiss = nmt;
          s.sig.nearMisses++;
          setNearMsg(true);
          setTimeout(() => setNearMsg(false), 1000);
        }
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = window.innerWidth * dpr; canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px'; canvas.style.height = window.innerHeight + 'px';
      const ctx = canvas.getContext('2d'); if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const getPos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onDown = (e: PointerEvent) => {
      const s = stateRef.current; if (!s.running) return;
      const pos = getPos(e);
      // Only start drag if near thread endpoint
      if (Math.hypot(pos.x - s.threadX, pos.y - s.threadY) < 40) {
        s.dragging = true;
        s.sig.attempts++;
        canvas.setPointerCapture(e.pointerId);
      }
    };
    const onMove = (e: PointerEvent) => {
      const s = stateRef.current; if (!s.running || !s.dragging) return;
      const pos = getPos(e);
      s.threadX = pos.x; s.threadY = pos.y;
    };
    const onUp = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running || !s.dragging) return;
      s.dragging = false;
      // Snap thread back to anchor if missed
      if (!s.threaded) {
        s.sig.streakCurrent = 0;
        setStreakDisplay(0);
      }
      s.threadX = s.anchorX; s.threadY = s.anchorY;
      s.threaded = false;
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
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio();
    setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setStreakDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #1a0010 0%, #0d0008 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start Threading →" accentColor={accent} onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #1a0010 0%, #0a0006 100%)" />
      )}
      {phase === 'countdown' && <Countdown onComplete={() => startLoop()} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <canvas ref={canvasRef} role="img" aria-label="Thread Needle game canvas"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <GameHUD accentColor={accent} items={[
          { label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 10, testId: 'timer' },
          { label: 'SCORE', value: scoreDisplay, testId: 'score' },
          { label: 'STREAK', value: streakDisplay, testId: 'streak' },
        ]} />
      )}
      <AnimatePresence>
        {scorePop && (
          <motion.div key="pop" initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1.3 }} exit={{ opacity: 0, y: -40 }} transition={{ duration: 0.5 }}
            style={{ position: 'fixed', top: '35%', left: '50%', transform: 'translateX(-50%)', zIndex: 80, pointerEvents: 'none', fontSize: 48, fontWeight: 900, color: '#4ade80', textShadow: '0 0 20px #4ade80' }}>
            {scorePop}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {nearMsg && (
          <motion.div key="near" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            style={{ position: 'fixed', top: '22%', left: '50%', transform: 'translateX(-50%)', zIndex: 80, pointerEvents: 'none', fontSize: 22, fontWeight: 800, color: '#fbbf24', whiteSpace: 'nowrap' }}>
            Almost! 🪡
          </motion.div>
        )}
      </AnimatePresence>
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Threads Passed', value: String(finalSig.score), color: accent },
              { label: 'Attempts', value: String(finalSig.attempts), color: '#94a3b8' },
              { label: 'Best Streak', value: `${finalSig.maxStreak}x`, color: '#fbbf24' },
              { label: 'Near Misses', value: String(finalSig.nearMisses), color: '#f97316' },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 3} finalScore={finalSig.score} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}
