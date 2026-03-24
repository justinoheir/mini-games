'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticImpact } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'node-connect';
const ACCENT = '#10b981';
const DURATION = 45;
const GAME_EMOJI = '🔗';
const GAME_TITLE = 'Node Connect';
const GAME_TAGLINE = 'Link the dots. Cross nothing.';

const COLORS = ['#ef4444', '#3b82f6', '#fbbf24', '#10b981', '#a855f7'];

interface Node { id: number; x: number; y: number; colorIdx: number; connected: boolean; }
interface Connection { from: number; to: number; colorIdx: number; }

interface Signals {
  puzzlesSolved: number; crossings: number; perfectPuzzles: number;
  maxStreak: number; streakCurrent: number; score: number; totalMoves: number;
}

function getPersonality(sig: Signals): string {
  if (sig.perfectPuzzles >= 3 && sig.crossings === 0) return 'Circuit Wizard 🧙';
  if (sig.puzzlesSolved >= 5) return 'Network Pro 🔗';
  if (sig.crossings === 0) return 'Clean Connections ✨';
  if (sig.puzzlesSolved >= 3) return 'Getting Linked 📡';
  return 'Node Novice 🔌';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface DrawingState { active: boolean; fromId: number; colorIdx: number; curX: number; curY: number; }

interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  nodes: Node[]; connections: Connection[];
  drawing: DrawingState; puzzlePairs: Array<[number, number]>;
  accentColor: string; scorePop: number;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
}

function linesIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

export default function NodeConnect() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { puzzlesSolved: 0, crossings: 0, perfectPuzzles: 0, maxStreak: 0, streakCurrent: 0, score: 0, totalMoves: 0 },
    nodes: [], connections: [], drawing: { active: false, fromId: -1, colorIdx: 0, curX: 0, curY: 0 },
    puzzlePairs: [], accentColor: ACCENT, scorePop: 0, floats: [],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, []);

  const generatePuzzle = useCallback((W: number, H: number) => {
    const s = stateRef.current;
    const numColors = 3 + Math.min(s.sig.puzzlesSolved, 2);
    const margin = 60;
    const nodes: Node[] = [];
    const pairs: Array<[number, number]> = [];
    let id = 0;

    for (let c = 0; c < numColors; c++) {
      // Place 2 nodes of same color
      for (let p = 0; p < 2; p++) {
        let nx = 0, ny = 0, tries = 0;
        do {
          nx = margin + Math.random() * (W - margin * 2);
          ny = margin + Math.random() * (H * 0.7 - margin);
          tries++;
        } while (nodes.some(n => Math.hypot(n.x - nx, n.y - ny) < 60) && tries < 50);
        nodes.push({ id, x: nx, y: ny, colorIdx: c, connected: false });
        id++;
      }
      pairs.push([id - 2, id - 1]);
    }

    s.nodes = nodes;
    s.connections = [];
    s.puzzlePairs = pairs;
    s.drawing = { active: false, fromId: -1, colorIdx: 0, curX: 0, curY: 0 };
  }, []);

  const checkPuzzleComplete = useCallback(() => {
    const s = stateRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const solved = s.puzzlePairs.every(([a, b]) =>
      s.connections.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a))
    );
    if (!solved) return;

    const hasCrossings = s.sig.crossings > 0;
    s.sig.puzzlesSolved++;
    if (!hasCrossings) s.sig.perfectPuzzles++;
    s.sig.streakCurrent++;
    if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
    const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
    const pts = (hasCrossings ? 5 : 10) * mult;
    s.sig.score += pts;
    s.scorePop = Date.now() + 400;
    setScoreDisplay(s.sig.score);
    sfx.success();
    hapticScore();
    s.floats.push({ x: canvas.width / 2, y: canvas.height * 0.4, text: hasCrossings ? `+${pts} Solved!` : `+${pts} PERFECT! ✨`, alpha: 1, vy: -2, color: hasCrossings ? '#fbbf24' : '#10b981' });
    setTimeout(() => generatePuzzle(canvas.width, canvas.height), 500);
  }, [generatePuzzle]);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { puzzlesSolved: 0, crossings: 0, perfectPuzzles: 0, maxStreak: 0, streakCurrent: 0, score: 0, totalMoves: 0 };
    s.floats = []; s.scorePop = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    generatePuzzle(W, H);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);

      // Background: circuit board aesthetic
      ctx.fillStyle = '#061010';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(16,185,129,0.06)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 30) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
      for (let gy = 0; gy < H; gy += 30) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

      // Draw connections
      s.connections.forEach(conn => {
        const fromNode = s.nodes.find(n => n.id === conn.from);
        const toNode = s.nodes.find(n => n.id === conn.to);
        if (!fromNode || !toNode) return;
        const color = COLORS[conn.colorIdx];
        ctx.save();
        ctx.shadowBlur = 12; ctx.shadowColor = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(fromNode.x, fromNode.y);
        ctx.lineTo(toNode.x, toNode.y);
        ctx.stroke();
        ctx.restore();
      });

      // Draw active drawing line
      if (s.drawing.active) {
        const fromNode = s.nodes.find(n => n.id === s.drawing.fromId);
        if (fromNode) {
          const color = COLORS[s.drawing.colorIdx];
          ctx.save();
          ctx.strokeStyle = color + '88';
          ctx.lineWidth = 3;
          ctx.setLineDash([8, 5]);
          ctx.beginPath();
          ctx.moveTo(fromNode.x, fromNode.y);
          ctx.lineTo(s.drawing.curX, s.drawing.curY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }

      // Draw nodes
      s.nodes.forEach(n => {
        const color = COLORS[n.colorIdx];
        ctx.save();
        ctx.shadowBlur = n.connected ? 20 : 10;
        ctx.shadowColor = color;
        ctx.fillStyle = n.connected ? color : '#1a2a2a';
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 20, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        if (!n.connected) {
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(n.x, n.y, 8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      });

      // Score pop
      if (s.scorePop > Date.now()) {
        const t = (s.scorePop - Date.now()) / 400;
        ctx.save(); ctx.globalAlpha = t;
        ctx.font = `bold ${Math.round(40 * (1 + (1 - t) * 0.3))}px sans-serif`;
        ctx.fillStyle = ACCENT; ctx.textAlign = 'center';
        ctx.fillText(`${s.sig.score}`, W / 2, 80); ctx.restore();
      }

      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha;
        ctx.fillStyle = f.color; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.96;
      });

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, generatePuzzle]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const getNode = (px: number, py: number) => {
      const s = stateRef.current;
      return s.nodes.find(n => Math.hypot(n.x - px, n.y - py) < 28);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      const node = getNode(px, py);
      if (node) {
        s.drawing = { active: true, fromId: node.id, colorIdx: node.colorIdx, curX: px, curY: py };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.drawing.active) return;
      const rect = canvas.getBoundingClientRect();
      s.drawing.curX = (e.clientX - rect.left) * (canvas.width / rect.width);
      s.drawing.curY = (e.clientY - rect.top) * (canvas.height / rect.height);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.drawing.active) return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      const endNode = getNode(px, py);

      if (endNode && endNode.id !== s.drawing.fromId && endNode.colorIdx === s.drawing.colorIdx) {
        const fromNode = s.nodes.find(n => n.id === s.drawing.fromId)!;
        // Check for crossings
        let crosses = false;
        for (const conn of s.connections) {
          const a = s.nodes.find(n => n.id === conn.from)!;
          const b = s.nodes.find(n => n.id === conn.to)!;
          if (linesIntersect(fromNode.x, fromNode.y, endNode.x, endNode.y, a.x, a.y, b.x, b.y)) {
            crosses = true; break;
          }
        }
        if (crosses) { s.sig.crossings++; hapticFail(); sfx.collision(); }
        // Add connection anyway (allow crossing with penalty)
        s.connections.push({ from: s.drawing.fromId, to: endNode.id, colorIdx: s.drawing.colorIdx });
        fromNode.connected = true; endNode.connected = true;
        s.sig.totalMoves++;
        sfx.collect(); hapticScore();
        checkPuzzleComplete();
      }

      s.drawing = { active: false, fromId: -1, colorIdx: 0, curX: 0, curY: 0 };
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [phase, checkPuzzleComplete]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Drag from a node to its matching color. No crossing lines allowed!"
          ctaLabel="Connect! 🔗" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
            role="img" aria-label="Node connection puzzle game canvas" />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
              { label: 'SCORE', value: scoreDisplay },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Puzzles Solved', value: String(finalSig.puzzlesSolved), color: ACCENT },
            { label: 'Perfect (no cross)', value: String(finalSig.perfectPuzzles), color: '#fbbf24' },
            { label: 'Crossings', value: String(finalSig.crossings), color: finalSig.crossings === 0 ? '#4ade80' : '#ef4444' },
            { label: 'Total Connections', value: String(finalSig.totalMoves), color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.puzzlesSolved >= 3} />
      )}
    </GameShell>
  );
}
