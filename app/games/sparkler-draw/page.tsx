'use client';
/**
 * SPARKLER DRAW
 * Real mechanic: A glowing firework star template is shown. Player traces it with their
 * finger as quickly and accurately as possible. Accuracy = how close to the template.
 * Score = accuracy% × speed bonus.
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

const GAME_ID = 'sparkler-draw';
const ACCENT = '#f59e0b';
const DURATION = 30;
const GAME_EMOJI = '✨';
const GAME_TITLE = 'Sparkler Draw';
const GAME_TAGLINE = 'Trace the firework. Be fast. Be precise.';
const PB_KEY = 'mg_pb_sparkler-draw';

interface Signals { score: number; accuracy: number; completionTime: number | null; tracedPct: number; }

function getPersonality(sig: Signals): string {
  if (sig.accuracy >= 88 && sig.completionTime && sig.completionTime < 8000) return 'Pyrotechnic Pro 🎆';
  if (sig.accuracy >= 80) return 'Star Tracer ⭐';
  if (sig.tracedPct >= 80) return 'Sparkle Chaser ✨';
  if (sig.accuracy >= 60) return 'Firework Fan 🎇';
  return 'Apprentice Lighter 🕯️';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

/** Generate a star polygon with n points */
function starPoints(cx: number, cy: number, outerR: number, innerR: number, n: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n * 2; i++) {
    const angle = (i * Math.PI) / n - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }
  return pts;
}

/** Sample points along a polyline at roughly every `step` pixels */
function samplePolyline(pts: { x: number; y: number }[], step: number): { x: number; y: number }[] {
  if (pts.length < 2) return pts;
  const result: { x: number; y: number }[] = [pts[0]];
  let remaining = step;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    let segLen = Math.hypot(dx, dy);
    let pos = 0;
    while (pos + remaining <= segLen) {
      pos += remaining;
      result.push({ x: pts[i - 1].x + (dx / segLen) * pos, y: pts[i - 1].y + (dy / segLen) * pos });
      remaining = step;
    }
    remaining -= segLen - pos;
  }
  return result;
}

export default function SparklerDrawGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef({
    running: false,
    timeLeft: DURATION,
    sig: { score: 0, accuracy: 0, completionTime: null as number | null, tracedPct: 0 } as Signals,
    // Template (star polygon sampled points)
    template: [] as { x: number; y: number }[],
    templateRaw: [] as { x: number; y: number }[], // vertices only
    templateSampled: [] as { x: number; y: number }[], // dense samples
    templateHit: [] as boolean[], // which sampled points have been traced
    // Player's drawn path
    playerPath: [] as { x: number; y: number }[],
    drawing: false,
    startTime: 0,
    completedAt: 0,
    // Tolerance for "on path"
    tolerance: 28,
    accentColor: ACCENT,
    sparkles: [] as { x: number; y: number; vx: number; vy: number; life: number; }[],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [accuracyDisplay, setAccuracyDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [donePop, setDonePop] = useState<string | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const computeAccuracy = useCallback(() => {
    const s = stateRef.current;
    if (s.templateHit.length === 0) return 0;
    const hitCount = s.templateHit.filter(Boolean).length;
    return Math.round((hitCount / s.templateHit.length) * 100);
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.gameOver(); haptic([100]);
    const acc = computeAccuracy();
    const tracedPct = s.templateHit.filter(Boolean).length / Math.max(1, s.templateHit.length) * 100;
    const timeBonusFactor = s.completedAt > 0
      ? Math.max(1, 2 - (s.completedAt - s.startTime) / 15000)
      : 1;
    const score = Math.round(acc * timeBonusFactor);
    s.sig = { score, accuracy: acc, completionTime: s.completedAt > 0 ? s.completedAt - s.startTime : null, tracedPct: Math.round(tracedPct) };
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0', 10);
      if (score > pb) localStorage.setItem(PB_KEY, String(score));
    } catch { /* noop */ }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, [computeAccuracy]);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const W = window.innerWidth, H = window.innerHeight;
    const s = stateRef.current;
    s.running = true;
    s.timeLeft = DURATION;
    s.drawing = false;
    s.playerPath = [];
    s.sparkles = [];
    s.completedAt = 0;
    s.startTime = 0;

    // Build star template centered in game area
    const cx = W / 2, cy = H * 0.48;
    const outerR = Math.min(W, H) * 0.28;
    const innerR = outerR * 0.42;
    s.templateRaw = starPoints(cx, cy, outerR, innerR, 5);
    s.template = [...s.templateRaw, s.templateRaw[0]]; // close loop
    s.templateSampled = samplePolyline(s.template, 10);
    s.templateHit = new Array(s.templateSampled.length).fill(false);

    setAccuracyDisplay(0); setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) { sfx.warning(); haptic([50, 30, 50]); }
      else if (s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const now = Date.now();
      const accent = s.accentColor;
      ctx.clearRect(0, 0, W, H);

      // Background – night sky
      const bg = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.5, Math.max(W, H) * 0.8);
      bg.addColorStop(0, '#0a0820'); bg.addColorStop(0.5, '#060415'); bg.addColorStop(1, '#020208');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      // Star background dots
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      for (let i = 0; i < 40; i++) {
        const sx = ((i * 173.7 + 11) % 1) * W;
        const sy = ((i * 89.3 + 7) % 1) * H;
        const sr = 0.8 + ((i * 57) % 1) * 1.2;
        ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
      }

      // Template star (dashed outline)
      ctx.save();
      ctx.strokeStyle = 'rgba(245,158,11,0.35)';
      ctx.lineWidth = 3; ctx.setLineDash([8, 10]); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.shadowBlur = 12; ctx.shadowColor = 'rgba(245,158,11,0.4)';
      ctx.beginPath();
      ctx.moveTo(s.template[0].x, s.template[0].y);
      for (let i = 1; i < s.template.length; i++) ctx.lineTo(s.template[i].x, s.template[i].y);
      ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]); ctx.restore();

      // Template progress — traced portions glow
      for (let i = 0; i < s.templateSampled.length; i++) {
        if (s.templateHit[i]) {
          ctx.save();
          ctx.fillStyle = accent + 'cc'; ctx.shadowBlur = 8; ctx.shadowColor = accent;
          ctx.beginPath(); ctx.arc(s.templateSampled[i].x, s.templateSampled[i].y, 3, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }

      // Player's drawn path (sparkler trail)
      if (s.playerPath.length >= 2) {
        for (let i = 1; i < s.playerPath.length; i++) {
          const t = i / s.playerPath.length;
          ctx.save();
          ctx.globalAlpha = 0.5 + t * 0.5;
          ctx.strokeStyle = accent; ctx.lineWidth = 3 + t * 3;
          ctx.shadowBlur = 14; ctx.shadowColor = accent;
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(s.playerPath[i - 1].x, s.playerPath[i - 1].y);
          ctx.lineTo(s.playerPath[i].x, s.playerPath[i].y); ctx.stroke();
          ctx.restore();
        }
        // Sparkler tip glow
        const tip = s.playerPath[s.playerPath.length - 1];
        ctx.save(); ctx.fillStyle = '#ffffff'; ctx.shadowBlur = 20; ctx.shadowColor = accent;
        ctx.beginPath(); ctx.arc(tip.x, tip.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }

      // Sparkle particles
      s.sparkles = s.sparkles.filter(sp => sp.life > 0);
      for (const sp of s.sparkles) {
        sp.x += sp.vx; sp.y += sp.vy; sp.vy += 0.1; sp.life -= 3;
        ctx.save(); ctx.globalAlpha = sp.life / 100;
        ctx.fillStyle = accent; ctx.shadowBlur = 6; ctx.shadowColor = accent;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }

      // Accuracy live update
      const acc = computeAccuracy();
      if (acc !== accuracyDisplay) setAccuracyDisplay(acc);

      // Check completion: >85% hit
      if (acc >= 85 && s.completedAt === 0 && s.drawing) {
        s.completedAt = now;
        sfx.collect(); haptic([40, 20, 60, 20, 80]);
        setDonePop('⭐ ' + acc + '%');
        setTimeout(() => setDonePop(null), 2000);
        // Burst sparkles
        const tip = s.playerPath[s.playerPath.length - 1] ?? { x: W / 2, y: H / 2 };
        for (let i = 0; i < 25; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 2 + Math.random() * 4;
          s.sparkles.push({ x: tip.x, y: tip.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2, life: 80 + Math.random() * 40 });
        }
      }

      void now;
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, computeAccuracy, accuracyDisplay]);

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
      s.drawing = true;
      if (s.startTime === 0) s.startTime = Date.now();
      const pos = getPos(e);
      s.playerPath = [pos];
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const s = stateRef.current; if (!s.running || !s.drawing) return;
      const pos = getPos(e);
      s.playerPath.push(pos);
      // Keep path lean
      if (s.playerPath.length > 400) s.playerPath.splice(0, 100);
      // Spawn sparkles occasionally
      if (Math.random() < 0.25) {
        const angle = Math.random() * Math.PI * 2;
        s.sparkles.push({ x: pos.x, y: pos.y, vx: Math.cos(angle) * (0.5 + Math.random() * 2), vy: Math.sin(angle) * (0.5 + Math.random() * 2) - 1, life: 60 + Math.random() * 40 });
      }
      // Check coverage against template
      for (let i = 0; i < s.templateSampled.length; i++) {
        if (!s.templateHit[i]) {
          const tp = s.templateSampled[i];
          if (Math.hypot(pos.x - tp.x, pos.y - tp.y) <= s.tolerance) {
            s.templateHit[i] = true;
          }
        }
      }
    };
    const onUp = () => { stateRef.current.drawing = false; };

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
    setPhase('start'); setAccuracyDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #0a0820 0%, #020208 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Light It Up →" accentColor={accent} onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #0a0820 0%, #020208 100%)" />
      )}
      {phase === 'countdown' && <Countdown onComplete={() => startLoop()} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <canvas ref={canvasRef} role="img" aria-label="Sparkler Draw game canvas"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <GameHUD accentColor={accent} items={[
          { label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 10, testId: 'timer' },
          { label: 'ACCURACY', value: `${accuracyDisplay}%`, testId: 'score' },
        ]} />
      )}
      <AnimatePresence>
        {donePop && (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1.2 }} exit={{ opacity: 0, y: -40 }} transition={{ duration: 0.6 }}
            style={{ position: 'fixed', top: '28%', left: '50%', transform: 'translateX(-50%)', zIndex: 80, pointerEvents: 'none', fontSize: 44, fontWeight: 900, color: accent, textShadow: `0 0 24px ${accent}`, whiteSpace: 'nowrap' }}>
            {donePop}
          </motion.div>
        )}
      </AnimatePresence>
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={`${finalSig.accuracy}%`} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Accuracy', value: `${finalSig.accuracy}%`, color: finalSig.accuracy >= 80 ? '#4ade80' : finalSig.accuracy >= 60 ? '#facc15' : '#ef4444' },
              { label: 'Coverage', value: `${finalSig.tracedPct}%`, color: accent },
              { label: 'Completion Time', value: finalSig.completionTime ? `${(finalSig.completionTime / 1000).toFixed(1)}s` : 'Not completed', color: finalSig.completionTime ? '#00ff88' : '#94a3b8' },
              { label: 'Score', value: String(finalSig.score), color: accent },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.accuracy >= 70} finalScore={finalSig.score} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}
