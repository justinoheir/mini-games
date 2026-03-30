'use client';
/**
 * CABLE WRAP
 * Real mechanic: Drag the cable endpoint around pegs to wrap without crossing itself.
 * Score = pegs successfully wrapped. Self-intersection = cable resets from last peg.
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

const GAME_ID = 'cable-wrap';
const ACCENT = '#34d399';
const DURATION = 45;
const GAME_EMOJI = '🔌';
const GAME_TITLE = 'Cable Wrap';
const GAME_TAGLINE = 'Wrap every peg. No tangles.';
const PB_KEY = 'mg_pb_cable-wrap';

interface Peg { x: number; y: number; r: number; wrapped: boolean; id: number; }
interface Vec2 { x: number; y: number; }

interface Signals {
  score: number; wrapped: number; tangles: number; maxStreak: number; streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  if (sig.wrapped >= 8 && sig.tangles === 0) return 'Cable Whisperer 🔌';
  if (sig.wrapped >= 6 && sig.tangles <= 1) return 'Neat Freak 🧹';
  if (sig.wrapped >= 4) return 'Getting Tidy 🪢';
  if (sig.tangles > sig.wrapped) return 'Total Tangle 😵';
  return 'Apprentice Wrapper 🔧';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

/** Check if segment AB intersects segment CD (ignoring shared endpoints) */
function segmentsIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const denom = (dx - cx) * (ay - by) - (dy - cy) * (ax - bx);
  if (Math.abs(denom) < 1e-10) return false;
  const t = ((dx - cx) * (cy - ay) - (dy - cy) * (cx - ax)) / denom;
  const u = ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / denom;
  return t > 0.05 && t < 0.95 && u > 0.05 && u < 0.95;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export default function CableWrapGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef({
    running: false,
    timeLeft: DURATION,
    sig: { score: 0, wrapped: 0, tangles: 0, maxStreak: 0, streakCurrent: 0 } as Signals,
    pegs: [] as Peg[],
    path: [] as Vec2[],         // cable path polyline
    dragging: false,
    dragX: 0, dragY: 0,
    flashUntil: 0,              // red flash for tangle
    celebrateUntil: 0,
    accentColor: ACCENT,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streakDisplay, setStreakDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [scorePop, setScorePop] = useState<string | null>(null);
  const [tangleMsg, setTangleMsg] = useState(false);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const generatePegs = useCallback((W: number, H: number): Peg[] => {
    const pegs: Peg[] = [];
    const margin = 60;
    const positions: Vec2[] = [];
    const tries = 200;
    for (let attempt = 0; attempt < tries && pegs.length < 7; attempt++) {
      const x = margin + Math.random() * (W - margin * 2);
      const y = margin + Math.random() * (H - margin * 2);
      const minDist = 80;
      if (positions.every(p => Math.hypot(p.x - x, p.y - y) >= minDist)) {
        positions.push({ x, y });
        pegs.push({ x, y, r: 14, wrapped: false, id: pegs.length });
      }
    }
    return pegs;
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.gameOver();
    haptic([100]);
    // PB
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
    s.sig = { score: 0, wrapped: 0, tangles: 0, maxStreak: 0, streakCurrent: 0 };
    s.pegs = generatePegs(W, H);
    // Cable starts at center-bottom anchor
    const anchorX = W / 2, anchorY = H - 80;
    s.path = [{ x: anchorX, y: anchorY }];
    s.dragging = false;
    s.flashUntil = 0;
    s.celebrateUntil = 0;
    setScoreDisplay(0);
    setStreakDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) { sfx.warning(); haptic([50, 30, 50]); }
      else if (s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const accent = s.accentColor;
      ctx.fillStyle = '#001a0d';
      ctx.fillRect(0, 0, W, H);

      // Subtle grid
      ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 48) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
      for (let gy = 0; gy < H; gy += 48) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

      // Tangle flash
      if (Date.now() < s.flashUntil) {
        const p = Math.max(0, 1 - (Date.now() - (s.flashUntil - 300)) / 300);
        ctx.fillStyle = `rgba(239,68,68,${p * 0.25})`; ctx.fillRect(0, 0, W, H);
      }

      // Draw cable path
      if (s.path.length >= 2) {
        ctx.save();
        ctx.shadowBlur = 12; ctx.shadowColor = accent;
        ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(s.path[0].x, s.path[0].y);
        for (let i = 1; i < s.path.length; i++) ctx.lineTo(s.path[i].x, s.path[i].y);
        if (s.dragging) ctx.lineTo(s.dragX, s.dragY);
        ctx.stroke();
        ctx.restore();
        // Cable glow core
        ctx.save();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.globalAlpha = 0.4; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(s.path[0].x, s.path[0].y);
        for (let i = 1; i < s.path.length; i++) ctx.lineTo(s.path[i].x, s.path[i].y);
        if (s.dragging) ctx.lineTo(s.dragX, s.dragY);
        ctx.stroke();
        ctx.restore();
      }

      // Anchor dot
      const anchor = s.path[0];
      ctx.save();
      ctx.fillStyle = '#ffffff'; ctx.shadowBlur = 8; ctx.shadowColor = accent;
      ctx.beginPath(); ctx.arc(anchor.x, anchor.y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Pegs
      for (const peg of s.pegs) {
        ctx.save();
        ctx.shadowBlur = peg.wrapped ? 20 : 10;
        ctx.shadowColor = peg.wrapped ? '#00ff88' : accent;
        ctx.strokeStyle = peg.wrapped ? '#00ff88' : accent;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2); ctx.stroke();
        if (peg.wrapped) {
          ctx.fillStyle = 'rgba(0,255,136,0.2)'; ctx.fill();
        }
        // Peg bolt center
        ctx.fillStyle = peg.wrapped ? '#00ff88' : accent;
        ctx.shadowBlur = 4;
        ctx.beginPath(); ctx.arc(peg.x, peg.y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      // Dragging tip glow
      if (s.dragging) {
        ctx.save();
        ctx.fillStyle = accent; ctx.shadowBlur = 20; ctx.shadowColor = accent;
        ctx.beginPath(); ctx.arc(s.dragX, s.dragY, 7, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      // Streak display
      if (s.sig.streakCurrent >= 3) {
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 18px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(`🔥 ${s.sig.streakCurrent}x STREAK`, W / 2, 110);
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [generatePegs, endGame]);

  /** Called when user ends a drag — check if we wrapped a peg */
  const checkWrapPeg = useCallback((endX: number, endY: number) => {
    const s = stateRef.current;
    const path = s.path;
    if (path.length < 2) return;
    const lastPt = path[path.length - 1];
    const newSeg = { ax: lastPt.x, ay: lastPt.y, bx: endX, by: endY };

    // Check self-intersection with all prior segments except the last
    let intersects = false;
    for (let i = 0; i < path.length - 2; i++) {
      if (segmentsIntersect(newSeg.ax, newSeg.ay, newSeg.bx, newSeg.by, path[i].x, path[i].y, path[i + 1].x, path[i + 1].y)) {
        intersects = true;
        break;
      }
    }

    if (intersects) {
      // Tangle! Penalise and reset cable to last peg or anchor
      s.sig.tangles++;
      s.sig.streakCurrent = 0;
      s.flashUntil = Date.now() + 300;
      sfx.nearMiss();
      haptic([20, 30, 20]);
      // Trim path back to last wrapped peg or anchor
      const lastWrappedIdx = [...s.pegs].reverse().findIndex(p => p.wrapped);
      if (lastWrappedIdx >= 0) {
        const peg = [...s.pegs].reverse()[lastWrappedIdx];
        s.path = [s.path[0], { x: peg.x, y: peg.y }];
      } else {
        s.path = [s.path[0]];
      }
      setTangleMsg(true);
      setTimeout(() => setTangleMsg(false), 1000);
      return;
    }

    // Check if new segment passes close to an unwrapped peg
    for (const peg of s.pegs) {
      if (peg.wrapped) continue;
      const dist = distToSegment(peg.x, peg.y, newSeg.ax, newSeg.ay, newSeg.bx, newSeg.by);
      if (dist <= peg.r + 12) {
        peg.wrapped = true;
        s.sig.wrapped++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const bonus = s.sig.streakCurrent >= 3 ? 2 : 1;
        s.sig.score += bonus;
        setScoreDisplay(s.sig.score);
        setStreakDisplay(s.sig.streakCurrent);
        sfx.collect();
        haptic([30]);
        setScorePop(`+${bonus}`);
        setTimeout(() => setScorePop(null), 800);
      }
    }

    // Extend path
    path.push({ x: endX, y: endY });
    // Keep path from growing too long (thin it if >200 points)
    if (path.length > 200) {
      const keep = [path[0], ...path.slice(-199)];
      s.path = keep;
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const getCanvasPos = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (clientX - rect.left), y: (clientY - rect.top) };
    };

    const onDown = (e: PointerEvent) => {
      if (stateRef.current.running) {
        const pos = getCanvasPos(e.clientX, e.clientY);
        stateRef.current.dragging = true;
        stateRef.current.dragX = pos.x;
        stateRef.current.dragY = pos.y;
      }
    };
    const onMove = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running || !s.dragging) return;
      const pos = getCanvasPos(e.clientX, e.clientY);
      s.dragX = pos.x;
      s.dragY = pos.y;
    };
    const onUp = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running || !s.dragging) return;
      s.dragging = false;
      const pos = getCanvasPos(e.clientX, e.clientY);
      checkWrapPeg(pos.x, pos.y);
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
  }, [checkWrapPeg]);

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
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setStreakDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 0%, rgba(52,211,153,0.08) 0%, transparent 55%), linear-gradient(180deg, #001a0d 0%, #000f08 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start Wrapping →" accentColor={accent} onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #001a0d 0%, #000a06 100%)" />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <canvas ref={canvasRef} role="img" aria-label="Cable Wrap game canvas"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <GameHUD accentColor={accent} items={[
          { label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 10, testId: 'timer' },
          { label: 'SCORE', value: scoreDisplay, testId: 'score' },
          { label: 'STREAK', value: streakDisplay, testId: 'streak' },
        ]} />
      )}
      {/* Score pop */}
      <AnimatePresence>
        {scorePop && (
          <motion.div key="pop" initial={{ opacity: 0, scale: 0.5, y: 0 }} animate={{ opacity: 1, scale: 1.3, y: -20 }} exit={{ opacity: 0, y: -50 }} transition={{ duration: 0.6 }}
            style={{ position: 'fixed', top: '35%', left: '50%', transform: 'translateX(-50%)', zIndex: 80, pointerEvents: 'none', fontSize: 48, fontWeight: 900, color: accent, textShadow: `0 0 20px ${accent}` }}>
            {scorePop}
          </motion.div>
        )}
      </AnimatePresence>
      {/* Tangle warning */}
      <AnimatePresence>
        {tangleMsg && (
          <motion.div key="tangle" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
            style={{ position: 'fixed', top: '20%', left: '50%', transform: 'translateX(-50%)', zIndex: 80, pointerEvents: 'none', fontSize: 24, fontWeight: 800, color: '#ef4444', textShadow: '0 0 12px #ef4444', whiteSpace: 'nowrap' }}>
            ❌ Tangle! Reset
          </motion.div>
        )}
      </AnimatePresence>
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Pegs Wrapped', value: String(finalSig.wrapped), color: accent },
              { label: 'Tangles', value: String(finalSig.tangles), color: finalSig.tangles === 0 ? '#4ade80' : '#ef4444' },
              { label: 'Best Streak', value: `${finalSig.maxStreak}x`, color: '#fbbf24' },
              { label: 'Score', value: String(finalSig.score), color: accent },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.wrapped >= 4} finalScore={finalSig.score} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}
