'use client';
/**
 * REFLEX GRID
 * Real mechanic: 4x4 grid. Cells light up randomly and fade. Tap a lit cell to score.
 * Speed and number of simultaneous cells increases with score.
 * Tapping a dark cell breaks streak.
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

const GAME_ID = 'reflex-grid';
const ACCENT = '#ef4444';
const DURATION = 30;
const GAME_EMOJI = '⚡';
const GAME_TITLE = 'Reflex Grid';
const GAME_TAGLINE = 'Tap the flash. Never miss twice.';
const PB_KEY = 'mg_pb_reflex-grid';
const COLS = 4;
const ROWS = 4;

interface ActiveCell { id: number; col: number; row: number; spawnTime: number; windowMs: number; }
interface Signals { score: number; hits: number; misses: number; maxStreak: number; streakCurrent: number; avgReaction: number; reactionTimes: number[]; }

function getPersonality(sig: Signals): string {
  const avg = sig.avgReaction;
  const acc = sig.hits + sig.misses > 0 ? sig.hits / (sig.hits + sig.misses) : 0;
  if (avg < 280 && acc >= 0.85) return 'Lightning ⚡';
  if (avg < 400 && acc >= 0.75) return 'Quick Draw 🔫';
  if (acc >= 0.7) return 'Steady Reflex 🎯';
  if (sig.hits >= 10) return 'Persistent Tapper 👆';
  return 'Warming Up 🌡️';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function ReflexGridGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const spawnTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef({
    running: false,
    timeLeft: DURATION,
    sig: { score: 0, hits: 0, misses: 0, maxStreak: 0, streakCurrent: 0, avgReaction: 0, reactionTimes: [] as number[] } as Signals,
    activeCells: [] as ActiveCell[],
    nextId: 0,
    speedLevel: 1,      // increases every 5 points
    cellWindow: 1800,   // ms before cell fades
    maxActive: 2,       // max simultaneous lit cells
    accentColor: ACCENT,
    gridX: 0, gridY: 0, cellW: 0, cellH: 0,
    shakeUntil: 0,
    flashCell: null as { col: number; row: number; until: number; color: string } | null,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streakDisplay, setStreakDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [scorePop, setScorePop] = useState<string | null>(null);
  const [missPop, setMissPop] = useState(false);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (spawnTimerRef.current) { clearInterval(spawnTimerRef.current); spawnTimerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.gameOver(); haptic([100]);
    const sig = s.sig;
    sig.avgReaction = sig.reactionTimes.length > 0
      ? Math.round(sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length)
      : 0;
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0', 10);
      if (sig.score > pb) localStorage.setItem(PB_KEY, String(sig.score));
    } catch { /* noop */ }
    setFinalSig({ ...sig });
    setPhase('done');
  }, []);

  const spawnCell = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    if (s.activeCells.length >= s.maxActive) return;
    const occupied = new Set(s.activeCells.map(c => `${c.col},${c.row}`));
    const available: [number, number][] = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (!occupied.has(`${c},${r}`)) available.push([c, r]);
    }
    if (available.length === 0) return;
    const [col, row] = available[Math.floor(Math.random() * available.length)];
    s.activeCells.push({ id: s.nextId++, col, row, spawnTime: Date.now(), windowMs: s.cellWindow });
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const W = window.innerWidth, H = window.innerHeight;
    const s = stateRef.current;
    s.running = true;
    s.timeLeft = DURATION;
    s.sig = { score: 0, hits: 0, misses: 0, maxStreak: 0, streakCurrent: 0, avgReaction: 0, reactionTimes: [] };
    s.activeCells = []; s.nextId = 0; s.speedLevel = 1; s.cellWindow = 1800; s.maxActive = 2;
    s.flashCell = null; s.shakeUntil = 0;

    // Grid layout: centered, fills viewport nicely
    const gridPad = 24;
    const hudH = 100;
    const gridW = Math.min(W - gridPad * 2, 380);
    const gridH = Math.min(H - hudH - gridPad * 2 - 40, gridW);
    s.cellW = gridW / COLS;
    s.cellH = gridH / ROWS;
    s.gridX = (W - gridW) / 2;
    s.gridY = hudH + (H - hudH - gridH) / 2;

    setScoreDisplay(0); setStreakDisplay(0); setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    // Spawn timer (interval shrinks as speed increases)
    let spawnInterval = 900;
    const rescheduleSpawn = () => {
      if (spawnTimerRef.current) clearInterval(spawnTimerRef.current);
      spawnTimerRef.current = setInterval(() => {
        spawnCell();
        const newInterval = Math.max(350, 900 - s.speedLevel * 60);
        if (newInterval !== spawnInterval) { spawnInterval = newInterval; rescheduleSpawn(); }
      }, spawnInterval);
    };
    rescheduleSpawn();
    spawnCell();

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

      // Background
      ctx.fillStyle = '#140000'; ctx.fillRect(0, 0, W, H);
      const vg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.65);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

      // Screen shake for miss
      let shakeX = 0, shakeY = 0;
      if (now < s.shakeUntil) {
        shakeX = (Math.random() - 0.5) * 6; shakeY = (Math.random() - 0.5) * 6;
      }
      ctx.save(); ctx.translate(shakeX, shakeY);

      // Expire cells
      s.activeCells = s.activeCells.filter(cell => {
        const age = now - cell.spawnTime;
        if (age > cell.windowMs) {
          // Cell expired = miss
          s.sig.misses++;
          s.sig.streakCurrent = 0;
          setStreakDisplay(0);
          sfx.nearMiss(); haptic([20, 30, 20]);
          setMissPop(true); setTimeout(() => setMissPop(false), 600);
          return false;
        }
        return true;
      });

      // Draw grid cells
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const x = s.gridX + c * s.cellW;
          const y = s.gridY + r * s.cellH;
          const pad = 6;
          const cx = x + pad, cy = y + pad, cw = s.cellW - pad * 2, ch = s.cellH - pad * 2;
          const rr = 10;

          // Check if active
          const active = s.activeCells.find(a => a.col === c && a.row === r);
          // Flash feedback
          const flash = s.flashCell && s.flashCell.col === c && s.flashCell.row === r && now < s.flashCell.until;

          if (active) {
            const age = now - active.spawnTime;
            const pct = 1 - age / active.windowMs;
            const pulse = 0.8 + 0.2 * Math.sin(now * 0.015);
            ctx.save();
            ctx.shadowBlur = 24 * pct * pulse; ctx.shadowColor = accent;
            // Urgency color: green → yellow → red as time runs out
            const urgR = Math.round(239 * (1 - pct) + 74 * pct);
            const urgG = Math.round(68 * (1 - pct) + 222 * pct);
            const urgB = Math.round(68 * (1 - pct) + 128 * pct);
            const cellColor = `rgba(${urgR},${urgG},${urgB},${0.85 * pct * pulse + 0.1})`;
            ctx.fillStyle = cellColor;
            ctx.beginPath(); ctx.roundRect(cx, cy, cw, ch, rr); ctx.fill();
            ctx.strokeStyle = `rgba(${urgR},${urgG},${urgB},${pct * 0.9})`;
            ctx.lineWidth = 2; ctx.stroke();
            ctx.restore();
          } else if (flash) {
            ctx.save();
            const fp = Math.max(0, 1 - (now - (s.flashCell!.until - 200)) / 200);
            ctx.fillStyle = s.flashCell!.color + Math.round(fp * 0xcc).toString(16).padStart(2, '0');
            ctx.shadowBlur = 16; ctx.shadowColor = s.flashCell!.color;
            ctx.beginPath(); ctx.roundRect(cx, cy, cw, ch, rr); ctx.fill(); ctx.restore();
          } else {
            // Idle cell
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.04)';
            ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.roundRect(cx, cy, cw, ch, rr);
            ctx.fill(); ctx.stroke(); ctx.restore();
          }
        }
      }

      ctx.restore(); // end shake transform

      // Combo badge
      if (s.sig.streakCurrent >= 3) {
        ctx.save();
        ctx.fillStyle = '#fbbf24';
        ctx.font = `bold 18px "Space Grotesk", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(`🔥 ${s.sig.streakCurrent}x COMBO`, W / 2, 110);
        ctx.restore();
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnCell]);

  // Handle tap
  const handleTap = useCallback((clientX: number, clientY: number) => {
    const s = stateRef.current;
    if (!s.running) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    // Determine which grid cell was tapped
    const col = Math.floor((x - s.gridX) / s.cellW);
    const row = Math.floor((y - s.gridY) / s.cellH);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
    const activeIdx = s.activeCells.findIndex(a => a.col === col && a.row === row);
    if (activeIdx >= 0) {
      // Hit!
      const cell = s.activeCells[activeIdx];
      const rt = Date.now() - cell.spawnTime;
      s.sig.hits++;
      s.sig.reactionTimes.push(rt);
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const bonus = s.sig.streakCurrent >= 5 ? 3 : s.sig.streakCurrent >= 3 ? 2 : 1;
      s.sig.score += bonus;
      s.activeCells.splice(activeIdx, 1);
      setScoreDisplay(s.sig.score);
      setStreakDisplay(s.sig.streakCurrent);
      s.flashCell = { col, row, until: Date.now() + 200, color: '#4ade80' };
      sfx.collect(); haptic([30]);
      setScorePop(`+${bonus}`);
      setTimeout(() => setScorePop(null), 500);
      // Speed up every 5 points
      s.speedLevel = 1 + Math.floor(s.sig.score / 5);
      s.cellWindow = Math.max(600, 1800 - s.speedLevel * 120);
      s.maxActive = Math.min(4, 2 + Math.floor(s.sig.score / 8));
    } else {
      // Miss tap (tapped empty cell)
      s.sig.misses++;
      s.sig.streakCurrent = 0;
      setStreakDisplay(0);
      s.flashCell = { col, row, until: Date.now() + 200, color: '#ef4444' };
      s.shakeUntil = Date.now() + 150;
      sfx.nearMiss(); haptic([20, 30, 20]);
    }
  }, []);

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
    const onDown = (e: PointerEvent) => { if (stateRef.current.running) handleTap(e.clientX, e.clientY); };
    canvas.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('resize', resize); canvas.removeEventListener('pointerdown', onDown); };
  }, [handleTap]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (spawnTimerRef.current) clearInterval(spawnTimerRef.current);
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
      background="radial-gradient(ellipse at 50% 20%, rgba(239,68,68,0.1) 0%, transparent 60%), linear-gradient(180deg, #140000 0%, #0a0000 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start →" accentColor={accent} onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #1a0000 0%, #080000 100%)" />
      )}
      {phase === 'countdown' && <Countdown onComplete={() => startLoop()} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <canvas ref={canvasRef} role="img" aria-label="Reflex Grid game canvas"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <GameHUD accentColor={accent} items={[
          { label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 5, testId: 'timer' },
          { label: 'SCORE', value: scoreDisplay, testId: 'score' },
          { label: 'STREAK', value: streakDisplay, testId: 'streak' },
        ]} />
      )}
      <AnimatePresence>
        {scorePop && (
          <motion.div key="pop" initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1.4 }} exit={{ opacity: 0, y: -30 }} transition={{ duration: 0.4 }}
            style={{ position: 'fixed', top: '38%', left: '50%', transform: 'translateX(-50%)', zIndex: 80, pointerEvents: 'none', fontSize: 52, fontWeight: 900, color: '#4ade80', textShadow: '0 0 20px #4ade80' }}>
            {scorePop}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {missPop && (
          <motion.div key="miss" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            style={{ position: 'fixed', top: '38%', left: '50%', transform: 'translateX(-50%)', zIndex: 80, pointerEvents: 'none', fontSize: 32, fontWeight: 900, color: '#ef4444', textShadow: '0 0 16px #ef4444' }}>
            ✗
          </motion.div>
        )}
      </AnimatePresence>
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Taps Hit', value: String(finalSig.hits), color: accent },
              { label: 'Missed', value: String(finalSig.misses), color: finalSig.misses === 0 ? '#4ade80' : '#ef4444' },
              { label: 'Best Streak', value: `${finalSig.maxStreak}x`, color: '#fbbf24' },
              { label: 'Avg Reaction', value: `${finalSig.avgReaction}ms`, color: finalSig.avgReaction < 350 ? '#4ade80' : '#facc15' },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 10} finalScore={finalSig.score} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}
