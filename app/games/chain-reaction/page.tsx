'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'chain-reaction';
const ACCENT = '#fb7185';
const DURATION = 30;
const GAME_EMOJI = '💥';
const GAME_TITLE = 'Chain Reaction';
const GAME_TAGLINE = 'One tap. Maximum chaos.';

interface Cell { x: number; y: number; r: number; active: boolean; exploding: boolean; explodeRadius: number; color: string; mass: number; }
interface Signals { totalTaps: number; maxChain: number; totalExploded: number; perfectRounds: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(sig: Signals): string {
  if (sig.maxChain >= 20 && sig.perfectRounds >= 2) return 'Nuclear Genius 💥';
  if (sig.maxChain >= 15) return 'Chain Master 🔗';
  if (sig.maxStreak >= 4) return 'Combo Starter 🚀';
  if (sig.totalExploded >= 50) return 'Demolisher 🧨';
  return 'Spark Plug ⚡';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
const CELL_COLORS = ['#fb7185','#f43f5e','#ef4444','#fbbf24','#f97316','#a855f7'];
interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  cells: Cell[]; exploding: boolean; chainCount: number; roundActive: boolean; roundResult: number;
  accentColor: string; floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  scorePop: number; frame: number;
}

export default function ChainReaction() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalTaps: 0, maxChain: 0, totalExploded: 0, perfectRounds: 0, maxStreak: 0, streakCurrent: 0, score: 0 },
    cells: [], exploding: false, chainCount: 0, roundActive: false, roundResult: 0,
    accentColor: ACCENT, floats: [], scorePop: 0, frame: 0,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false; cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const generateCells = useCallback((W: number, H: number) => {
    const cells: Cell[] = [];
    const rows = 5, cols = 6;
    const cellW = (W - 40) / cols, cellH = (H * 0.7 - 40) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (Math.random() < 0.7) {
          cells.push({
            x: 20 + c * cellW + cellW / 2, y: H * 0.15 + r * cellH + cellH / 2,
            r: 18 + Math.random() * 12,
            active: true, exploding: false, explodeRadius: 0,
            color: CELL_COLORS[Math.floor(Math.random() * CELL_COLORS.length)],
            mass: 1 + Math.floor(Math.random() * 3),
          });
        }
      }
    }
    return cells;
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalTaps: 0, maxChain: 0, totalExploded: 0, perfectRounds: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.cells = generateCells(W, H); s.exploding = false; s.chainCount = 0; s.roundActive = false;
    s.floats = []; s.scorePop = 0; s.frame = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    timerRef.current = setInterval(() => { s.timeLeft--; setTimeLeft(s.timeLeft); if (s.timeLeft <= 0) { sfx.fail(); endGame(); } }, 1000);

    const EXPLOSION_SPEED = 3;
    const EXPLOSION_MAX = 80;
    const CHAIN_RANGE = 70;

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);
      s.frame++;
      // Dark neon background
      ctx.fillStyle = '#0a0008'; ctx.fillRect(0, 0, W, H);
      // Neon grid
      ctx.strokeStyle = 'rgba(251,113,133,0.05)'; ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 30) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
      for (let gy = 0; gy < H; gy += 30) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

      // Update explosions
      let anyExploding = false;
      s.cells.forEach(c => {
        if (!c.exploding) return;
        anyExploding = true;
        c.explodeRadius += EXPLOSION_SPEED;
        if (c.explodeRadius > EXPLOSION_MAX) {
          c.active = false; c.exploding = false;
          return;
        }
        // Chain to nearby cells
        s.cells.forEach(other => {
          if (other === c || !other.active || other.exploding) return;
          const dist = Math.hypot(other.x - c.x, other.y - c.y);
          if (dist < c.explodeRadius + CHAIN_RANGE) {
            other.exploding = true;
            s.chainCount++;
            s.sig.totalExploded++;
          }
        });
      });

      // Check if chain done
      if (s.exploding && !anyExploding) {
        s.exploding = false;
        const allGone = s.cells.every(c => !c.active);
        if (s.chainCount > s.sig.maxChain) s.sig.maxChain = s.chainCount;
        const isPerfect = allGone && s.cells.length > 0;
        if (isPerfect) { s.sig.perfectRounds++; hapticCombo(10); sfx.success(); }
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
        const pts = s.chainCount * mult;
        s.sig.score += pts;
        s.scorePop = Date.now() + 400;
        setScoreDisplay(s.sig.score);
        hapticScore();
        s.floats.push({ x: W/2, y: H*0.4, text: `+${pts}${isPerfect ? ' PERFECT! 🔥' : ''} (${s.chainCount} chain)`, alpha: 1, vy: -2, color: isPerfect ? '#fbbf24' : ACCENT });
        // Regenerate
        setTimeout(() => { if (s.running) { s.cells = generateCells(W, H); s.chainCount = 0; } }, 600);
      }

      // Draw cells and explosions
      s.cells.forEach(c => {
        if (!c.active && !c.exploding) return;
        ctx.save();
        if (c.exploding) {
          ctx.globalAlpha = Math.max(0, 1 - c.explodeRadius / EXPLOSION_MAX);
          ctx.strokeStyle = c.color;
          ctx.lineWidth = 3;
          for (let ring = 1; ring <= 3; ring++) {
            ctx.beginPath(); ctx.arc(c.x, c.y, c.explodeRadius * (ring / 3), 0, Math.PI * 2); ctx.stroke();
          }
          ctx.fillStyle = c.color + '44';
          ctx.beginPath(); ctx.arc(c.x, c.y, c.explodeRadius * 0.5, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.shadowBlur = 12; ctx.shadowColor = c.color;
          ctx.fillStyle = c.color + 'cc';
          ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = c.color; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.stroke();
          // Mass indicator
          ctx.fillStyle = '#ffffff'; ctx.font = `bold ${12 + c.mass * 2}px sans-serif`; ctx.textAlign = 'center';
          ctx.fillText(String(c.mass), c.x, c.y + 4);
        }
        ctx.restore();
      });

      // Chain counter live display
      if (s.exploding) {
        ctx.save(); ctx.fillStyle = '#fb7185'; ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center';
        ctx.shadowBlur = 12; ctx.shadowColor = '#fb7185';
        ctx.fillText(`⚡ ${s.chainCount}`, W/2, H * 0.95); ctx.restore();
      }

      if (s.scorePop > Date.now()) {
        const t = (s.scorePop - Date.now()) / 400;
        ctx.save(); ctx.globalAlpha = t; ctx.font = `bold ${Math.round(38*(1+(1-t)*0.3))}px sans-serif`;
        ctx.fillStyle = ACCENT; ctx.textAlign = 'center'; ctx.fillText(`${s.sig.score}`, W/2, 90); ctx.restore();
      }
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha; ctx.fillStyle = f.color; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.96;
      });
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, generateCells]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.exploding) return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      // Find closest cell
      let closest: Cell | null = null, closestDist = 9999;
      for (const c of s.cells) {
        if (!c.active) continue;
        const d = Math.hypot(c.x - px, c.y - py);
        if (d < closestDist && d < c.r + 20) { closest = c; closestDist = d; }
      }
      if (closest) {
        closest.exploding = true; s.exploding = true; s.chainCount = 1; s.sig.totalTaps++;
        sfx.click();
      } else {
        s.sig.streakCurrent = 0; sfx.collision(); hapticFail();
      }
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    return () => { window.removeEventListener('resize', resize); canvas.removeEventListener('pointerdown', onPointerDown); };
  }, [phase]);

  useEffect(() => () => { cancelAnimationFrame(animRef.current); if (timerRef.current) clearInterval(timerRef.current); }, []);
  const handleStart = useCallback(async (name: string, avatar: string) => { playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); await initAudio(); setPhase('countdown'); }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Tap one cell to start a chain reaction! Score big with long chains!" ctaLabel="React! 💥" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <><canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Chain reaction game canvas" />
        {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5 }, { label: 'SCORE', value: scoreDisplay }]} />}</>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Max Chain', value: String(finalSig.maxChain), color: ACCENT }, { label: 'Total Exploded', value: String(finalSig.totalExploded), color: '#fbbf24' }, { label: 'Perfect Rounds', value: String(finalSig.perfectRounds), color: '#4ade80' }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' }]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.maxChain >= 10} />
      )}
    </GameShell>
  );
}
