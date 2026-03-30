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

const GAME_ID      = 'gear-grind';
const ACCENT       = '#a855f7';
const DURATION     = 45;
const GAME_EMOJI   = '⚙️';
const GAME_TITLE   = 'Gear Grind';
const GAME_TAGLINE = 'Drag gears onto the chain to connect source to target!';
const PB_KEY       = 'mg_pb_gear-grind';

// Gear drawing helper
function drawGear(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number,
                  teeth: number, toothH: number, rotation: number, fillColor: string, glowing: boolean) {
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(rotation);
  if (glowing) { ctx.shadowBlur = 18; ctx.shadowColor = fillColor; }

  // Teeth
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a1 = (i / teeth) * Math.PI * 2;
    const a2 = ((i + 0.35) / teeth) * Math.PI * 2;
    const a3 = ((i + 0.65) / teeth) * Math.PI * 2;
    const a4 = ((i + 1) / teeth) * Math.PI * 2;
    ctx.moveTo(Math.cos(a1) * radius, Math.sin(a1) * radius);
    ctx.lineTo(Math.cos(a2) * radius, Math.sin(a2) * radius);
    ctx.lineTo(Math.cos(a2) * (radius + toothH), Math.sin(a2) * (radius + toothH));
    ctx.lineTo(Math.cos(a3) * (radius + toothH), Math.sin(a3) * (radius + toothH));
    ctx.lineTo(Math.cos(a3) * radius, Math.sin(a3) * radius);
  }
  ctx.closePath(); ctx.fill();

  // Body disc
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();

  // Inner cutout
  ctx.fillStyle = '#1a0a2e';
  ctx.beginPath(); ctx.arc(0, 0, radius * 0.45, 0, Math.PI * 2); ctx.fill();

  // Hub hole
  ctx.fillStyle = fillColor;
  ctx.beginPath(); ctx.arc(0, 0, radius * 0.18, 0, Math.PI * 2); ctx.fill();

  ctx.shadowBlur = 0;
  ctx.restore();
}

interface PaletteGear {
  id: number; radius: number; teeth: number; color: string;
  homeX: number; homeY: number;
  x: number; y: number;
  dragging: boolean; dragOX: number; dragOY: number;
  placed: boolean; slotIndex: number;
}

interface ChainSlot {
  x: number; y: number; radius: number; filled: boolean; gearId: number | null;
}

interface Signals {
  score: number; puzzlesSolved: number; gearsPlaced: number;
  chainFlashes: number;
}

function getPersonality(sig: Signals): string {
  if (sig.puzzlesSolved >= 4) return 'Clockwork Genius ⚙️';
  if (sig.puzzlesSolved >= 2 && sig.gearsPlaced >= 8) return 'Precision Engineer 🔩';
  if (sig.puzzlesSolved >= 2) return 'Gear Head 🛠️';
  if (sig.gearsPlaced >= 6) return 'Slot Filler 🔧';
  return 'Apprentice Mechanic 🪛';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  slots: ChainSlot[];
  palette: PaletteGear[];
  dragId: number | null;
  chainActive: boolean; chainTimer: number;
  chainFlash: number;
  rotations: number[];   // rotation per slot (animates when chain active)
  difficulty: number;    // 2, 3, 4 slots
  nextGearId: number;
  accentColor: string;
}

const GEAR_COLORS = ['#a855f7','#22d3ee','#f59e0b','#4ade80','#f43f5e','#3b82f6'];

export default function GearGrindGame() {
  const theme = useBrandTheme();
  const accentColor = theme.id !== 'ether' ? theme.colors.accent : ACCENT;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const lastFrameRef = useRef(0);
  const buildPuzzleRef = useRef<() => void>(() => {});

  const stateRef = useRef<GS>({
    running:false, timeLeft:DURATION,
    sig:{score:0,puzzlesSolved:0,gearsPlaced:0,chainFlashes:0},
    slots:[], palette:[], dragId:null,
    chainActive:false, chainTimer:0, chainFlash:0,
    rotations:[], difficulty:2, nextGearId:0, accentColor:ACCENT,
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
    setFinalSig({...s.sig}); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;
    canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;

    s.running=true; s.timeLeft=DURATION;
    s.sig={score:0,puzzlesSolved:0,gearsPlaced:0,chainFlashes:0};
    s.chainActive=false; s.chainTimer=0; s.chainFlash=0;
    s.difficulty=2; s.nextGearId=0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('chill');
    lastFrameRef.current = performance.now();

    const buildPuzzle = () => {
      const s2 = stateRef.current; const c = canvasRef.current; if (!c) return;
      const W = c.width, H = c.height;
      const numSlots = s2.difficulty;
      const totalGears = numSlots + 2; // slots + source + target
      const chainY = H * 0.44;
      const spacing = Math.min(80, (W * 0.85) / (totalGears + 1));
      const startX = W / 2 - spacing * (totalGears - 1) / 2;

      s2.slots = [];
      s2.rotations = new Array(totalGears).fill(0);

      for (let i = 0; i < numSlots; i++) {
        const gx = startX + spacing * (i + 1);
        s2.slots.push({x: gx, y: chainY, radius: 28, filled: false, gearId: null});
      }

      // Palette gears at bottom
      const paletteY = H * 0.78;
      const gearCount = numSlots + 2;
      s2.palette = [];
      for (let i = 0; i < gearCount; i++) {
        const gx = W / 2 - (gearCount - 1) * 38 / 2 + i * 38;
        s2.palette.push({
          id: s2.nextGearId++,
          radius: 22 + (i % 2) * 8,
          teeth: 8 + (i % 2) * 4,
          color: GEAR_COLORS[i % GEAR_COLORS.length],
          homeX: gx, homeY: paletteY,
          x: gx, y: paletteY,
          dragging: false, dragOX: 0, dragOY: 0,
          placed: false, slotIndex: -1,
        });
      }
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
      const dt = Math.min(50, ts - lastFrameRef.current) / 1000;
      lastFrameRef.current = ts;
      const W = canvas.width, H = canvas.height;
      const numSlots = s.difficulty;
      const totalGears = numSlots + 2;
      const spacing = Math.min(80, (W * 0.85) / (totalGears + 1));
      const startX = W / 2 - spacing * (totalGears - 1) / 2;
      const chainY = H * 0.44;

      // BG
      const bg = ctx.createLinearGradient(0,0,0,H);
      bg.addColorStop(0,'#0d0020'); bg.addColorStop(1,'#1a0030');
      ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

      // Chain flash
      s.chainFlash = Math.max(0, s.chainFlash - dt * 2.5);
      if (s.chainFlash > 0) {
        ctx.fillStyle = `rgba(168,85,247,${s.chainFlash * 0.2})`;
        ctx.fillRect(0,0,W,H);
      }

      // Chain animation
      if (s.chainActive) {
        s.chainTimer -= dt;
        // Spin gears in alternating directions
        for (let i = 0; i < s.rotations.length; i++) {
          s.rotations[i] += dt * 3 * (i % 2 === 0 ? 1 : -1);
        }
        if (s.chainTimer <= 0) {
          // Puzzle solved! Next difficulty
          s.chainActive = false;
          s.sig.puzzlesSolved++;
          s.sig.score += (s.difficulty + 1) * 5;
          s.difficulty = Math.min(4, s.difficulty + 1);
          setScoreDisplay(s.sig.score);
          buildPuzzleRef.current();
        }
      }

      // Draw shaft lines between gear positions
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(startX, chainY);
      ctx.lineTo(startX + spacing * (totalGears - 1), chainY);
      ctx.stroke();

      // Source gear (always spinning, green)
      const srcX = startX, tgtX = startX + spacing * (totalGears - 1);
      const srcRot = s.chainActive ? s.rotations[0] : (ts * 0.002);
      drawGear(ctx, srcX, chainY, 32, 10, 7, srcRot, '#4ade80', true);
      ctx.fillStyle = '#4ade80'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('SRC', srcX, chainY + 48);

      // Target gear (static, purple when incomplete, green when chain active)
      const tgtRot = s.chainActive ? s.rotations[totalGears - 1] : 0;
      const tgtCol = s.chainActive ? '#4ade80' : '#a855f7';
      drawGear(ctx, tgtX, chainY, 32, 10, 7, tgtRot, tgtCol, s.chainActive);
      ctx.fillStyle = tgtCol; ctx.font = 'bold 10px system-ui';
      ctx.fillText('TGT', tgtX, chainY + 48);

      // Slot gears
      for (let i = 0; i < s.slots.length; i++) {
        const slot = s.slots[i];
        const slotX = startX + spacing * (i + 1);
        if (slot.filled && slot.gearId !== null) {
          const gear = s.palette.find(g => g.id === slot.gearId);
          if (gear) {
            const rot = s.chainActive ? s.rotations[i+1] : 0;
            drawGear(ctx, slotX, chainY, gear.radius, gear.teeth, 5, rot, gear.color, s.chainActive);
          }
        } else {
          // Empty slot ghost
          ctx.save();
          ctx.strokeStyle = 'rgba(168,85,247,0.4)'; ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath(); ctx.arc(slotX, chainY, 30, 0, Math.PI*2); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(168,85,247,0.15)';
          ctx.beginPath(); ctx.arc(slotX, chainY, 30, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle = 'rgba(168,85,247,0.5)'; ctx.font = '20px system-ui';
          ctx.textAlign = 'center'; ctx.fillText('+', slotX, chainY + 7);
          ctx.restore();
        }
      }

      // Arrow indicators between slots
      for (let i = 0; i < totalGears - 1; i++) {
        const ax = startX + spacing * i + spacing * 0.5, ay = chainY;
        ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('→', ax, ay + 3);
      }

      // Palette area
      const paletteY = H * 0.78;
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.roundRect(20, paletteY - 45, W - 40, 90, 12); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(20, paletteY - 45, W - 40, 90, 12); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('DRAG GEARS TO SLOTS', W/2, paletteY + 48);

      // Palette gears
      for (const g of s.palette) {
        if (g.placed) continue;
        drawGear(ctx, g.x, g.y, g.radius, g.teeth, 5, g.dragging ? ts * 0.003 : 0, g.color, g.dragging);
      }

      // Completion status
      const allFilled = s.slots.length > 0 && s.slots.every(sl => sl.filled);
      if (allFilled && !s.chainActive) {
        s.chainActive = true; s.chainTimer = 1.2; s.chainFlash = 1;
        s.sig.chainFlashes++;
        sfx.collect(); haptic([30,20,30,20,60]);
      }

      // Instructions when no slots
      if (s.slots.length === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '14px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('Drag gears from below to fill the chain!', W/2, H*0.7);
      }

      // Solved count
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(`Puzzles solved: ${s.sig.puzzlesSolved}`, W/2, H*0.92);

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);

    const getPos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {x: e.clientX - rect.left, y: e.clientY - rect.top};
    };

    const onDown = (e: PointerEvent) => {
      const s = stateRef.current; if (!s.running || s.chainActive) return;
      const {x, y} = getPos(e);
      // Find palette gear hit
      let best: PaletteGear | null = null; let bestDist = 50;
      for (const g of s.palette) {
        if (g.placed) continue;
        const d = Math.hypot(x - g.x, y - g.y);
        if (d < g.radius + 15 && d < bestDist) { bestDist = d; best = g; }
      }
      if (best) {
        best.dragging = true; best.dragOX = x - best.x; best.dragOY = y - best.y;
        s.dragId = best.id;
      }
    };

    const onMove = (e: PointerEvent) => {
      const s = stateRef.current; if (!s.running || s.dragId === null) return;
      const {x, y} = getPos(e);
      const g = s.palette.find(p => p.id === s.dragId);
      if (g && g.dragging) { g.x = x - g.dragOX; g.y = y - g.dragOY; }
    };

    const onUp = (e: PointerEvent) => {
      const s = stateRef.current; if (!s.running || s.dragId === null) return;
      const {x, y} = getPos(e);
      const g = s.palette.find(p => p.id === s.dragId);
      if (g && g.dragging) {
        g.dragging = false;
        // Find nearest empty slot
        let bestSlot: ChainSlot | null = null; let bestDist = 50;
        for (const sl of s.slots) {
          if (sl.filled) continue;
          const d = Math.hypot(x - sl.x, y - sl.y);
          if (d < bestDist) { bestDist = d; bestSlot = sl; }
        }
        if (bestSlot) {
          bestSlot.filled = true; bestSlot.gearId = g.id;
          g.placed = true; g.slotIndex = s.slots.indexOf(bestSlot);
          g.x = bestSlot.x; g.y = bestSlot.y;
          s.sig.gearsPlaced++;
          sfx.collect(); haptic([30]);
        } else {
          // Return to home
          g.x = g.homeX; g.y = g.homeY;
        }
        s.dragId = null;
      }
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
    return [
      {label:'Puzzles Solved',value:String(sig.puzzlesSolved),color:sig.puzzlesSolved>=3?'#4ade80':sig.puzzlesSolved>=1?'#facc15':'#ef4444'},
      {label:'Gears Placed',value:String(sig.gearsPlaced),color:ACCENT},
      {label:'Score',value:String(sig.score),color:ACCENT},
      {label:'Personal Best',value:String(pb),color:'var(--color-text)'},
    ];
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accentColor} gameId={GAME_ID}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start the Machine!" accentColor={accentColor} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accentColor}/>}
      {(phase==='playing'||phase==='countdown')&&<>
        <canvas ref={canvasRef} role="img" aria-label="Gear Grind canvas" style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
        {phase==='playing'&&<GameHUD accentColor={accentColor} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5,testId:'timer'},{label:'SCORE',value:scoreDisplay,testId:'score'}]}/>}
      </>}
      {phase==='done'&&finalSig&&<>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={accentColor} onPlayAgain={handlePlayAgain} didWin={finalSig.puzzlesSolved>=2}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}
