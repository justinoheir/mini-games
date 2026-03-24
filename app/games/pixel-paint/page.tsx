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

const GAME_ID = 'pixel-paint';
const ACCENT = '#f472b6';
const DURATION = 30;
const GAME_EMOJI = '🎨';
const GAME_TITLE = 'Pixel Paint';
const GAME_TAGLINE = 'Speed-paint the pattern. Go!';

const GRID = 8;
const PATTERNS = [
  [1,0,1,0,1,0,1,0, 0,1,0,1,0,1,0,1, 1,0,1,0,1,0,1,0, 0,1,0,1,0,1,0,1, 1,0,1,0,1,0,1,0, 0,1,0,1,0,1,0,1, 1,0,1,0,1,0,1,0, 0,1,0,1,0,1,0,1],
  [1,1,1,1,1,1,1,1, 1,0,0,0,0,0,0,1, 1,0,1,1,1,1,0,1, 1,0,1,0,0,1,0,1, 1,0,1,0,0,1,0,1, 1,0,1,1,1,1,0,1, 1,0,0,0,0,0,0,1, 1,1,1,1,1,1,1,1],
  [0,0,0,1,1,0,0,0, 0,0,1,1,1,1,0,0, 0,1,1,0,0,1,1,0, 1,1,0,0,0,0,1,1, 1,0,0,0,0,0,0,1, 1,1,0,0,0,0,1,1, 0,1,1,0,0,1,1,0, 0,0,0,1,1,0,0,0],
];
const PATTERN_COLORS = ['#f472b6','#818cf8','#10b981'];

interface Signals { totalPatterns: number; completed: number; perfectCompletions: number; accuracy: number; maxStreak: number; streakCurrent: number; score: number; totalCells: number; correctCells: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.totalCells > 0 ? sig.correctCells / sig.totalCells : 0;
  if (acc >= 0.95 && sig.perfectCompletions >= 2) return 'Pixel Artist 🎨';
  if (sig.completed >= 3) return 'Speed Painter ⚡';
  if (sig.maxStreak >= 3) return 'Combo Brush 🖌️';
  if (acc >= 0.7) return 'Getting the Hang 📐';
  return 'Rough Sketch 🖊️';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  pattern: number[]; playerGrid: number[]; patternIndex: number; color: string;
  painting: boolean; cellSize: number; gridOffX: number; gridOffY: number;
  completionEffect: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  scorePop: number; frame: number;
}

export default function PixelPaint() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalPatterns: 0, completed: 0, perfectCompletions: 0, accuracy: 0, maxStreak: 0, streakCurrent: 0, score: 0, totalCells: 0, correctCells: 0 },
    pattern: [], playerGrid: [], patternIndex: 0, color: ACCENT,
    painting: false, cellSize: 0, gridOffX: 0, gridOffY: 0, completionEffect: 0,
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

  const loadPattern = useCallback(() => {
    const s = stateRef.current;
    s.patternIndex = (s.patternIndex + 1) % PATTERNS.length;
    s.pattern = [...PATTERNS[s.patternIndex]];
    s.playerGrid = new Array(GRID * GRID).fill(0);
    s.color = PATTERN_COLORS[s.patternIndex % PATTERN_COLORS.length];
    s.sig.totalPatterns++;
  }, []);

  const checkCompletion = useCallback(() => {
    const s = stateRef.current;
    const canvas = canvasRef.current; if (!canvas) return;
    let correct = 0;
    for (let i = 0; i < s.pattern.length; i++) {
      if (s.playerGrid[i] === s.pattern[i]) correct++;
    }
    const acc = correct / s.pattern.length;
    s.sig.totalCells += s.pattern.length;
    s.sig.correctCells += correct;
    if (acc >= 0.95) {
      s.sig.completed++;
      const isPerfect = acc === 1;
      if (isPerfect) s.sig.perfectCompletions++;
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
      const pts = (isPerfect ? 5 : 3) * mult;
      s.sig.score += pts;
      s.scorePop = Date.now() + 400;
      setScoreDisplay(s.sig.score);
      sfx.success(); hapticScore();
      s.completionEffect = 30;
      s.floats.push({ x: canvas.width/2, y: canvas.height*0.3, text: isPerfect ? `+${pts} PERFECT! ✨` : `+${pts} Done!`, alpha: 1, vy: -2, color: isPerfect ? '#fbbf24' : ACCENT });
      setTimeout(() => { if (s.running) loadPattern(); }, 500);
    }
  }, [loadPattern]);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalPatterns: 0, completed: 0, perfectCompletions: 0, accuracy: 0, maxStreak: 0, streakCurrent: 0, score: 0, totalCells: 0, correctCells: 0 };
    const cellSz = Math.floor(Math.min(W, H * 0.4) / GRID);
    s.cellSize = cellSz;
    s.gridOffX = Math.floor((W - cellSz * GRID) / 2);
    s.gridOffY = Math.floor(H * 0.45);
    s.patternIndex = -1;
    loadPattern();
    s.floats = []; s.scorePop = 0; s.frame = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    timerRef.current = setInterval(() => { s.timeLeft--; setTimeLeft(s.timeLeft); if (s.timeLeft <= 0) { sfx.fail(); endGame(); } }, 1000);

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);
      s.frame++;
      // Background: bright artsy
      ctx.fillStyle = '#0f0a14'; ctx.fillRect(0, 0, W, H);
      // Sparkle dots
      for (let i = 0; i < 15; i++) {
        const bx = (i * 137) % W, by = (i * 97) % (H * 0.35);
        ctx.fillStyle = PATTERN_COLORS[i % PATTERN_COLORS.length] + '20';
        ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI * 2); ctx.fill();
      }
      const cs = s.cellSize, gox = s.gridOffX, goy = s.gridOffY;
      // Draw target pattern (top)
      const topGOY = H * 0.05;
      const topCS = Math.floor(Math.min(W * 0.45, H * 0.35) / GRID);
      const topGOX = W * 0.05;
      ctx.save();
      ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#888'; ctx.textAlign = 'left';
      ctx.fillText('TARGET:', topGOX, topGOY - 5);
      for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
        const i = r * GRID + c;
        ctx.fillStyle = s.pattern[i] ? s.color : '#1a1220';
        ctx.fillRect(topGOX + c * topCS, topGOY + r * topCS, topCS - 1, topCS - 1);
      }
      // Preview of player vs target
      ctx.restore();
      // Draw player canvas (bottom)
      ctx.save();
      ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#888'; ctx.textAlign = 'left';
      ctx.fillText('YOUR CANVAS:', gox, goy - 5);
      for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
        const i = r * GRID + c;
        const isCorrect = s.playerGrid[i] === s.pattern[i];
        let cellColor = '#1a1220';
        if (s.playerGrid[i] === 1) cellColor = s.color;
        ctx.fillStyle = cellColor;
        ctx.fillRect(gox + c * cs, goy + r * cs, cs - 1, cs - 1);
        // Correct indicator
        if (s.playerGrid[i] === 1 && !isCorrect) {
          ctx.fillStyle = 'rgba(239,68,68,0.3)';
          ctx.fillRect(gox + c * cs, goy + r * cs, cs - 1, cs - 1);
        }
      }
      // Grid lines
      ctx.strokeStyle = '#ffffff10'; ctx.lineWidth = 1;
      for (let r = 0; r <= GRID; r++) { ctx.beginPath(); ctx.moveTo(gox, goy + r * cs); ctx.lineTo(gox + cs * GRID, goy + r * cs); ctx.stroke(); }
      for (let c = 0; c <= GRID; c++) { ctx.beginPath(); ctx.moveTo(gox + c * cs, goy); ctx.lineTo(gox + c * cs, goy + cs * GRID); ctx.stroke(); }
      ctx.restore();
      // Completion flash
      if (s.completionEffect > 0) {
        ctx.fillStyle = `rgba(244,114,182,${s.completionEffect / 30 * 0.4})`;
        ctx.fillRect(0, 0, W, H);
        s.completionEffect--;
      }
      if (s.scorePop > Date.now()) {
        const t = (s.scorePop - Date.now()) / 400;
        ctx.save(); ctx.globalAlpha = t; ctx.font = `bold ${Math.round(38*(1+(1-t)*0.3))}px sans-serif`;
        ctx.fillStyle = ACCENT; ctx.textAlign = 'center'; ctx.fillText(`${s.sig.score}`, W/2, 80); ctx.restore();
      }
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha; ctx.fillStyle = f.color; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.96;
      });
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, loadPattern]);

  const paintCell = useCallback((px: number, py: number) => {
    const s = stateRef.current;
    const col = Math.floor((px - s.gridOffX) / s.cellSize);
    const row = Math.floor((py - s.gridOffY) / s.cellSize);
    if (col < 0 || col >= GRID || row < 0 || row >= GRID) return;
    const i = row * GRID + col;
    if (s.playerGrid[i] !== 1) {
      s.playerGrid[i] = 1;
      checkCompletion();
    }
  }, [checkCompletion]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      stateRef.current.painting = true;
      const rect = canvas.getBoundingClientRect();
      paintCell((e.clientX - rect.left) * (canvas.width / rect.width), (e.clientY - rect.top) * (canvas.height / rect.height));
    };
    const onPointerMove = (e: PointerEvent) => {
      if (phase !== 'playing' || !stateRef.current.painting) return;
      const rect = canvas.getBoundingClientRect();
      paintCell((e.clientX - rect.left) * (canvas.width / rect.width), (e.clientY - rect.top) * (canvas.height / rect.height));
    };
    const onPointerUp = () => { stateRef.current.painting = false; };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [phase, paintCell]);

  useEffect(() => () => { cancelAnimationFrame(animRef.current); if (timerRef.current) clearInterval(timerRef.current); }, []);
  const handleStart = useCallback(async (name: string, avatar: string) => { playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); await initAudio(); setPhase('countdown'); }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Paint the target pattern on your canvas as fast as possible!" ctaLabel="Paint! 🎨" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <><canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Pixel painting game canvas" />
        {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5 }, { label: 'SCORE', value: scoreDisplay }]} />}</>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Patterns Done', value: String(finalSig.completed), color: ACCENT }, { label: 'Perfect', value: String(finalSig.perfectCompletions), color: '#fbbf24' }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' }, { label: 'Accuracy', value: `${finalSig.totalCells > 0 ? Math.round(finalSig.correctCells/finalSig.totalCells*100) : 0}%`, color: '#06b6d4' }]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.completed >= 2} />
      )}
    </GameShell>
  );
}
