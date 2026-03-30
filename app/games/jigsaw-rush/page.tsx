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

const GAME_ID      = 'jigsaw-rush';
const ACCENT       = '#22d3ee';
const DURATION     = 45;
const GAME_EMOJI   = '🧩';
const GAME_TITLE   = 'Jigsaw Rush';
const GAME_TAGLINE = 'Drag each piece to its ghost outline — as fast as you can!';
const PB_KEY       = 'mg_pb_jigsaw-rush';

const GRID_COLS = 3;
const GRID_ROWS = 3;
const SNAP_DIST = 38;

// Vibrant palette: each cell of the jigsaw image has a unique color/pattern
const PIECE_PALETTE = [
  ['#7c3aed','#a855f7','#d946ef'],
  ['#2563eb','#3b82f6','#22d3ee'],
  ['#059669','#10b981','#4ade80'],
  ['#d97706','#f59e0b','#facc15'],
  ['#dc2626','#ef4444','#f87171'],
  ['#0891b2','#06b6d4','#67e8f9'],
  ['#7c3aed','#c026d3','#e879f9'],
  ['#0f766e','#0d9488','#5eead4'],
  ['#b45309','#d97706','#fbbf24'],
];

interface Piece {
  id: number; row: number; col: number;
  x: number; y: number;          // current position (top-left of cell)
  targetX: number; targetY: number;
  placed: boolean;
  dragging: boolean;
  dragOX: number; dragOY: number;
  glowAlpha: number;             // success glow fade
}

interface Signals {
  score: number;
  piecesPlaced: number;
  puzzlesCompleted: number;
  totalAttempts: number;
  fastestSolveMs: number;
}

function getPersonality(sig: Signals): string {
  const avgPer = sig.puzzlesCompleted > 0 ? sig.piecesPlaced / sig.puzzlesCompleted : 0;
  if (sig.puzzlesCompleted >= 2 && sig.fastestSolveMs < 20000) return 'Jigsaw Prodigy 🧩';
  if (sig.puzzlesCompleted >= 2) return 'Puzzle Master 🔍';
  if (sig.piecesPlaced >= 7) return 'Pattern Seeker 🎯';
  if (sig.piecesPlaced >= 4) return 'Piece Finder 🔎';
  return 'Casual Puzzler 🤔';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

// Jigsaw connector offsets (tab/blank) per edge
// Each piece's edges: T, R, B, L — +1 = tab out, -1 = blank in, 0 = flat (border)
function getEdge(row: number, col: number, side: 'T'|'R'|'B'|'L', totalRows: number, totalCols: number): number {
  if (side === 'T') return row === 0 ? 0 : ((row * 3 + col * 7) % 2 === 0 ? 1 : -1);
  if (side === 'B') return row === totalRows - 1 ? 0 : -getEdge(row+1, col, 'T', totalRows, totalCols);
  if (side === 'L') return col === 0 ? 0 : ((row * 5 + col * 11) % 2 === 0 ? 1 : -1);
  if (side === 'R') return col === totalCols - 1 ? 0 : -getEdge(row, col+1, 'L', totalRows, totalCols);
  return 0;
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  piece: Piece, pw: number, ph: number,
  colors: string[], alpha: number, glowColor: string, glowAlpha: number
) {
  const { x, y, row, col } = piece;
  const cx = x + pw / 2, cy = y + ph / 2;
  const tabSize = Math.min(pw, ph) * 0.22;
  const totalRows = GRID_ROWS, totalCols = GRID_COLS;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();

  // TOP edge
  ctx.moveTo(x, y);
  const te = getEdge(row, col, 'T', totalRows, totalCols);
  if (te !== 0) {
    const mid = x + pw / 2;
    ctx.lineTo(mid - tabSize, y);
    ctx.arc(mid, y + te * tabSize, tabSize, Math.PI * (te > 0 ? 1 : 0), Math.PI * (te > 0 ? 0 : 1), te > 0);
    ctx.lineTo(x + pw, y);
  } else {
    ctx.lineTo(x + pw, y);
  }
  // RIGHT edge
  const re = getEdge(row, col, 'R', totalRows, totalCols);
  if (re !== 0) {
    const mid = y + ph / 2;
    ctx.lineTo(x + pw, mid - tabSize);
    ctx.arc(x + pw + re * tabSize, mid, tabSize, Math.PI * (re > 0 ? 1.5 : 0.5), Math.PI * (re > 0 ? 0.5 : 1.5), re > 0);
    ctx.lineTo(x + pw, y + ph);
  } else {
    ctx.lineTo(x + pw, y + ph);
  }
  // BOTTOM edge (drawn right to left)
  const be = getEdge(row, col, 'B', totalRows, totalCols);
  if (be !== 0) {
    const mid = x + pw / 2;
    ctx.lineTo(mid + tabSize, y + ph);
    ctx.arc(mid, y + ph + be * tabSize, tabSize, 0, Math.PI, be < 0);
    ctx.lineTo(x, y + ph);
  } else {
    ctx.lineTo(x, y + ph);
  }
  // LEFT edge (drawn bottom to top)
  const le = getEdge(row, col, 'L', totalRows, totalCols);
  if (le !== 0) {
    const mid = y + ph / 2;
    ctx.lineTo(x, mid + tabSize);
    ctx.arc(x + le * tabSize, mid, tabSize, Math.PI * (le > 0 ? 0.5 : 1.5), Math.PI * (le > 0 ? 1.5 : 0.5), le > 0);
    ctx.lineTo(x, y);
  } else {
    ctx.lineTo(x, y);
  }
  ctx.closePath();

  // Clip and fill
  ctx.save();
  ctx.clip();
  // Gradient fill using piece's color palette
  const idx = (row * totalCols + col) % PIECE_PALETTE.length;
  const colPal = PIECE_PALETTE[idx];
  const grad = ctx.createLinearGradient(x, y, x + pw, y + ph);
  grad.addColorStop(0, colPal[0]);
  grad.addColorStop(0.5, colPal[1]);
  grad.addColorStop(1, colPal[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(x - pw, y - ph, pw * 3, ph * 3);

  // Inner detail pattern
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath(); ctx.arc(cx, cy, Math.min(pw,ph)*0.22, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, Math.min(pw,ph)*0.34, 0, Math.PI*2); ctx.stroke();
  ctx.restore();

  // Outline
  if (glowAlpha > 0) {
    ctx.shadowBlur = 16; ctx.shadowColor = glowColor;
  }
  ctx.strokeStyle = piece.placed ? 'rgba(74,222,128,0.8)' : 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  pieces: Piece[];
  pw: number; ph: number;
  boardX: number; boardY: number;
  dragId: number | null;
  puzzleStartTime: number;
  completionFlash: number;
  difficulty: number; // increases cols/rows
  accentColor: string;
}

export default function JigsawRushGame() {
  const theme = useBrandTheme();
  const accentColor = theme.id !== 'ether' ? theme.colors.accent : ACCENT;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const buildPuzzleRef = useRef<() => void>(() => {});

  const stateRef = useRef<GS>({
    running:false, timeLeft:DURATION,
    sig:{score:0,piecesPlaced:0,puzzlesCompleted:0,totalAttempts:0,fastestSolveMs:Infinity},
    pieces:[], pw:0, ph:0, boardX:0, boardY:0,
    dragId:null, puzzleStartTime:0, completionFlash:0, difficulty:0,
    accentColor:ACCENT,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);
  useEffect(()=>{stateRef.current.accentColor=accentColor;},[accentColor]);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if (stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    sfx.gameOver(); haptic([100]);
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score));
    const finalSig2 = {...s.sig};
    if (finalSig2.fastestSolveMs === Infinity) finalSig2.fastestSolveMs = 0;
    setFinalSig(finalSig2); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;
    canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;

    s.running=true; s.timeLeft=DURATION;
    s.sig={score:0,piecesPlaced:0,puzzlesCompleted:0,totalAttempts:0,fastestSolveMs:Infinity};
    s.dragId=null; s.completionFlash=0; s.difficulty=0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('chill');

    const buildPuzzle = () => {
      const s2 = stateRef.current; const c = canvasRef.current; if (!c) return;
      const W = c.width, H = c.height;
      const margin = 16;
      const boardW = W - margin * 2;
      const boardH = H * 0.52;
      s2.boardX = margin; s2.boardY = H * 0.08;
      s2.pw = boardW / GRID_COLS;
      s2.ph = boardH / GRID_ROWS;

      s2.pieces = [];
      // Scatter pieces in lower area
      const scatterY = H * 0.63;
      const scatterH = H * 0.32;
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c2 = 0; c2 < GRID_COLS; c2++) {
          const targetX = s2.boardX + c2 * s2.pw;
          const targetY = s2.boardY + r * s2.ph;
          // Scatter randomly in lower zone
          let sx: number, sy: number;
          let attempts = 0;
          do {
            sx = margin + Math.random() * (W - margin * 2 - s2.pw);
            sy = scatterY + Math.random() * (scatterH - s2.ph);
            attempts++;
          } while (attempts < 10 && s2.pieces.some(p =>
            Math.abs(p.x - sx) < s2.pw * 0.7 && Math.abs(p.y - sy) < s2.ph * 0.7
          ));
          s2.pieces.push({
            id: r * GRID_COLS + c2,
            row: r, col: c2,
            x: sx, y: sy,
            targetX, targetY,
            placed: false,
            dragging: false, dragOX: 0, dragOY: 0,
            glowAlpha: 0,
          });
        }
      }
      s2.puzzleStartTime = Date.now();
    };
    buildPuzzleRef.current = buildPuzzle;
    buildPuzzle();

    timerRef.current = setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft<=5&&s.timeLeft>0) sfx.collect();
      if (s.timeLeft<=0) endGame();
    },1000);

    const loop = (ts: number) => {
      if (!s.running) return;
      const W = canvas.width, H = canvas.height;

      // BG
      const bg = ctx.createLinearGradient(0,0,0,H);
      bg.addColorStop(0,'#0a1628'); bg.addColorStop(1,'#0d1a2e');
      ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

      // Completion flash
      s.completionFlash = Math.max(0, s.completionFlash - 0.03);
      if (s.completionFlash > 0) {
        ctx.fillStyle = `rgba(34,211,238,${s.completionFlash * 0.3})`;
        ctx.fillRect(0,0,W,H);
      }

      // Board area backdrop
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.beginPath(); ctx.roundRect(s.boardX, s.boardY, s.pw * GRID_COLS, s.ph * GRID_ROWS, 8); ctx.fill();

      // Ghost outlines (target positions)
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c2 = 0; c2 < GRID_COLS; c2++) {
          const piece = s.pieces.find(p => p.row===r && p.col===c2);
          const alreadyPlaced = piece?.placed ?? false;
          if (alreadyPlaced) continue;
          const gx = s.boardX + c2 * s.pw, gy = s.boardY + r * s.ph;
          ctx.save();
          ctx.strokeStyle = 'rgba(34,211,238,0.35)'; ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(gx + 2, gy + 2, s.pw - 4, s.ph - 4);
          ctx.setLineDash([]);
          // Row/col label
          const idx = (r * GRID_COLS + c2) % PIECE_PALETTE.length;
          const cp = PIECE_PALETTE[idx];
          ctx.globalAlpha = 0.18;
          const grad = ctx.createLinearGradient(gx, gy, gx + s.pw, gy + s.ph);
          grad.addColorStop(0, cp[0]); grad.addColorStop(1, cp[2]);
          ctx.fillStyle = grad;
          ctx.fillRect(gx, gy, s.pw, s.ph);
          ctx.restore();
        }
      }

      // Update glow fades
      for (const p of s.pieces) { p.glowAlpha = Math.max(0, p.glowAlpha - 0.025); }

      // Scatter zone label
      ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('Drag pieces to the board', W/2, H * 0.61);

      // Draw placed pieces first, then unplaced, then dragged on top
      const sorted = [...s.pieces].sort((a, b) => {
        if (a.placed && !b.placed) return -1;
        if (!a.placed && b.placed) return 1;
        if (a.dragging) return 1;
        if (b.dragging) return -1;
        return 0;
      });
      for (const p of sorted) {
        const alpha = p.placed ? 1 : p.dragging ? 0.95 : 0.88;
        drawPiece(ctx, p, s.pw, s.ph, PIECE_PALETTE[(p.row*GRID_COLS+p.col)%PIECE_PALETTE.length], alpha, accentColor, p.glowAlpha);
      }

      // Check if puzzle complete
      const allPlaced = s.pieces.length > 0 && s.pieces.every(p => p.placed);
      if (allPlaced) {
        const solveMs = Date.now() - s.puzzleStartTime;
        if (solveMs < s.sig.fastestSolveMs) s.sig.fastestSolveMs = solveMs;
        s.sig.puzzlesCompleted++;
        const timeBonus = Math.max(0, 10 - Math.floor(solveMs / 3000));
        s.sig.score += 15 + timeBonus;
        s.completionFlash = 1; s.difficulty++;
        sfx.collect(); haptic([30,20,30,20,60]);
        setScoreDisplay(s.sig.score);
        // Brief pause then rebuild
        setTimeout(() => { if (s.running) buildPuzzleRef.current(); }, 800);
      }

      // Progress text
      const placed2 = s.pieces.filter(p => p.placed).length;
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(`${placed2}/${s.pieces.length} pieces`, W/2, H * 0.93);

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, accentColor]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);

    const getPos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {x: e.clientX - rect.left, y: e.clientY - rect.top};
    };

    const onDown = (e: PointerEvent) => {
      const s = stateRef.current; if (!s.running) return;
      const {x, y} = getPos(e);
      // Pick up unplaced piece closest to tap
      let best: Piece | null = null; let bestDist = s.pw * 0.6;
      for (const p of s.pieces) {
        if (p.placed) continue;
        const px = p.x + s.pw / 2, py = p.y + s.ph / 2;
        const d = Math.hypot(x - px, y - py);
        if (d < bestDist) { bestDist = d; best = p; }
      }
      if (best) {
        best.dragging = true; best.dragOX = x - best.x; best.dragOY = y - best.y;
        s.dragId = best.id;
        s.sig.totalAttempts++;
      }
    };

    const onMove = (e: PointerEvent) => {
      const s = stateRef.current; if (!s.running || s.dragId === null) return;
      const {x, y} = getPos(e);
      const p = s.pieces.find(pc => pc.id === s.dragId);
      if (p && p.dragging) { p.x = x - p.dragOX; p.y = y - p.dragOY; }
    };

    const onUp = (e: PointerEvent) => {
      const s = stateRef.current; if (!s.running || s.dragId === null) return;
      const p = s.pieces.find(pc => pc.id === s.dragId);
      if (p && p.dragging) {
        p.dragging = false;
        const cx = p.x + s.pw / 2, cy = p.y + s.ph / 2;
        const tCx = p.targetX + s.pw / 2, tCy = p.targetY + s.ph / 2;
        if (Math.hypot(cx - tCx, cy - tCy) < SNAP_DIST) {
          p.x = p.targetX; p.y = p.targetY; p.placed = true; p.glowAlpha = 1;
          s.sig.piecesPlaced++; s.sig.score += 2;
          sfx.collect(); haptic([30]);
          setScoreDisplay(s.sig.score);
        }
      }
      s.dragId = null;
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
    await initAudio(); sfx.click(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);
  const buildInsights = useCallback((sig: Signals) => {
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    const fastMs = sig.fastestSolveMs === Infinity || sig.fastestSolveMs === 0 ? null : sig.fastestSolveMs;
    return [
      {label:'Pieces Placed',value:String(sig.piecesPlaced),color:sig.piecesPlaced>=7?'#4ade80':sig.piecesPlaced>=4?'#facc15':'#ef4444'},
      {label:'Puzzles Done',value:String(sig.puzzlesCompleted),color:sig.puzzlesCompleted>=2?'#4ade80':'#facc15'},
      {label:'Fastest Solve',value:fastMs ? `${(fastMs/1000).toFixed(1)}s` : '—',color:ACCENT},
      {label:'Personal Best',value:String(pb),color:'var(--color-text)'},
    ];
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accentColor} gameId={GAME_ID}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start Puzzle!" accentColor={accentColor} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accentColor}/>}
      {(phase==='playing'||phase==='countdown')&&<>
        <canvas ref={canvasRef} role="img" aria-label="Jigsaw Rush canvas" style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
        {phase==='playing'&&<GameHUD accentColor={accentColor} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5,testId:'timer'},{label:'SCORE',value:scoreDisplay,testId:'score'}]}/>}
      </>}
      {phase==='done'&&finalSig&&<>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={accentColor} onPlayAgain={handlePlayAgain} didWin={finalSig.piecesPlaced>=7}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}
