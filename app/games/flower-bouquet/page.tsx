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

const GAME_ID      = 'flower-bouquet';
const ACCENT       = '#ec4899';
const DURATION     = 45;
const GAME_EMOJI   = '💐';
const GAME_TITLE   = 'Flower Bouquet';
const GAME_TAGLINE = 'Catch falling stems and drag them into the bouquet!';
const PB_KEY       = 'mg_pb_flower-bouquet';

const FLOWER_COLORS = ['#ec4899','#f43f5e','#facc15','#a855f7','#22d3ee','#4ade80','#f97316','#fb7185'];
const SPAWN_INTERVAL_MS = 1800;

interface Flower {
  id: number; x: number; y: number; vy: number;
  color: string; petalCount: number; stemTilt: number;
  dragging: boolean; dragOX: number; dragOY: number;
  placed: boolean; bouquetAngle: number; bouquetDist: number;
  alpha: number;
}
interface Signals {
  score: number; placed: number; missed: number; maxBouquet: number;
}

function getPersonality(sig: Signals): string {
  if (sig.placed >= 12) return 'Master Florist 🌸';
  if (sig.placed >= 8 && sig.missed <= 3) return 'Graceful Arranger 🌷';
  if (sig.placed >= 6) return 'Petal Collector 💐';
  if (sig.missed > 8) return 'Butterfingers 🌿';
  return 'Casual Bloomer 🌼';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

function drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, petalCount: number, r: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  // Petals
  for (let i = 0; i < petalCount; i++) {
    const a = (i / petalCount) * Math.PI * 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = color;
    ctx.shadowBlur = 6; ctx.shadowColor = color;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.7, r * 0.4, r * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Center
  ctx.fillStyle = '#facc15';
  ctx.shadowBlur = 8; ctx.shadowColor = '#facc15';
  ctx.beginPath(); ctx.arc(x, y, r * 0.35, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  flowers: Flower[];
  nextId: number; spawnTimer: number;
  vaseX: number; vaseY: number; vaseR: number;
  bouquetFlowers: Flower[];
  dragId: number | null;
  accentColor: string;
}

export default function FlowerBouquetGame() {
  const theme = useBrandTheme();
  const accentColor = theme.id !== 'ether' ? theme.colors.accent : ACCENT;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const lastSpawnRef = useRef(0);

  const stateRef = useRef<GS>({
    running:false, timeLeft:DURATION,
    sig:{score:0,placed:0,missed:0,maxBouquet:0},
    flowers:[], nextId:0, spawnTimer:0,
    vaseX:0, vaseY:0, vaseR:60,
    bouquetFlowers:[],
    dragId:null, accentColor:ACCENT,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);
  useEffect(()=>{stateRef.current.accentColor=accentColor;},[accentColor]);

  const spawnFlower = useCallback(() => {
    const s = stateRef.current; const c = canvasRef.current; if (!c) return;
    const x = 60 + Math.random() * (c.width - 120);
    s.flowers.push({
      id: s.nextId++, x, y: -30, vy: 1.2 + Math.random() * 0.8,
      color: FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)],
      petalCount: 5 + Math.floor(Math.random() * 3),
      stemTilt: (Math.random() - 0.5) * 0.3,
      dragging: false, dragOX: 0, dragOY: 0,
      placed: false, bouquetAngle: 0, bouquetDist: 0, alpha: 1,
    });
  }, []);

  const placeFn = useRef<(id: number) => void>(() => {});

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

    s.running = true; s.timeLeft = DURATION;
    s.sig = {score:0,placed:0,missed:0,maxBouquet:0};
    s.flowers = []; s.bouquetFlowers = []; s.nextId = 0; s.dragId = null;
    s.vaseX = canvas.width / 2; s.vaseY = canvas.height - 90; s.vaseR = 65;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('chill');
    lastSpawnRef.current = Date.now();

    placeFn.current = (id: number) => {
      const s2 = stateRef.current;
      const fl = s2.flowers.find(f => f.id === id);
      if (!fl) return;
      // Arrange in bouquet arc
      const idx = s2.bouquetFlowers.length;
      const total = idx + 1;
      fl.bouquetAngle = -Math.PI / 2 + (idx - (total - 1) / 2) * 0.35;
      fl.bouquetDist = 30 + (idx % 3) * 12;
      fl.placed = true; fl.dragging = false;
      s2.bouquetFlowers.push(fl);
      s2.flowers = s2.flowers.filter(f => f.id !== id);
      s2.sig.placed++;
      s2.sig.score += 3 + Math.floor(s2.bouquetFlowers.length / 3);
      if (s2.sig.placed > s2.sig.maxBouquet) s2.sig.maxBouquet = s2.sig.placed;
      sfx.collect(); haptic([30]);
      setScoreDisplay(s2.sig.score);
    };

    timerRef.current = setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft<=5&&s.timeLeft>0) sfx.collect();
      if (s.timeLeft<=0) endGame();
    },1000);

    const loop = (ts: number) => {
      if (!s.running) return;
      const W = canvas.width, H = canvas.height;
      const now = Date.now();

      // BG
      const bg = ctx.createLinearGradient(0,0,0,H);
      bg.addColorStop(0,'#0d1a0d'); bg.addColorStop(1,'#1a0d1a');
      ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);

      // Spawn flowers
      if (now - lastSpawnRef.current > SPAWN_INTERVAL_MS) {
        spawnFlower(); lastSpawnRef.current = now;
      }

      // Update falling flowers
      for (const fl of s.flowers) {
        if (fl.dragging || fl.placed) continue;
        fl.y += fl.vy;
        if (fl.y > H + 40) { s.sig.missed++; sfx.nearMiss(); haptic([20,30,20]); }
      }
      s.flowers = s.flowers.filter(fl => fl.y <= H + 40 || fl.dragging || fl.placed);

      // Draw vase
      const vx = s.vaseX, vy = s.vaseY, vr = s.vaseR;
      ctx.save();
      // Drop zone glow
      ctx.shadowBlur = 20; ctx.shadowColor = ACCENT;
      ctx.strokeStyle = `${ACCENT}88`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(vx, vy, vr, Math.PI, 0); ctx.stroke();
      ctx.shadowBlur = 0;
      // Vase body
      ctx.fillStyle = '#5c3b1e';
      ctx.beginPath();
      ctx.moveTo(vx - vr, vy);
      ctx.lineTo(vx - vr * 0.7, vy + 55);
      ctx.lineTo(vx + vr * 0.7, vy + 55);
      ctx.lineTo(vx + vr, vy);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#8b6914'; ctx.lineWidth = 2; ctx.stroke();
      // Vase rim
      ctx.fillStyle = '#7c4f28';
      ctx.beginPath(); ctx.ellipse(vx, vy, vr, 10, 0, 0, Math.PI*2); ctx.fill();
      ctx.restore();

      // Draw placed bouquet flowers
      for (let i = 0; i < s.bouquetFlowers.length; i++) {
        const fl = s.bouquetFlowers[i];
        const bx = vx + Math.cos(fl.bouquetAngle) * (fl.bouquetDist + 30);
        const by = vy - 20 - fl.bouquetDist * 1.2;
        // Stem
        ctx.save(); ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(vx + (Math.cos(fl.bouquetAngle)*10), vy - 5);
        ctx.quadraticCurveTo(vx + Math.cos(fl.bouquetAngle)*20, by + 30, bx, by);
        ctx.stroke(); ctx.restore();
        drawFlower(ctx, bx, by - 14, fl.color, fl.petalCount, 13, 1);
      }

      // Vase label
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '12px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('Drop here', vx, vy + 70);

      // Draw falling / dragged flowers
      for (const fl of s.flowers) {
        const fx = fl.x, fy = fl.y;
        // Stem
        ctx.save();
        ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2.5;
        ctx.translate(fx, fy); ctx.rotate(fl.stemTilt);
        ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(0, 55); ctx.stroke();
        ctx.restore();
        drawFlower(ctx, fx, fy, fl.color, fl.petalCount, 14, fl.alpha);
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnFlower]);

  // Pointer input
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
      // Find nearest flower to tap
      let best: Flower | null = null; let bestDist = 40;
      for (const fl of s.flowers) {
        if (fl.placed) continue;
        const d = Math.hypot(x - fl.x, y - fl.y);
        if (d < bestDist) { bestDist = d; best = fl; }
      }
      if (best) {
        best.dragging = true; best.dragOX = x - best.x; best.dragOY = y - best.y;
        s.dragId = best.id;
      }
    };

    const onMove = (e: PointerEvent) => {
      const s = stateRef.current; if (!s.running || s.dragId === null) return;
      const {x, y} = getPos(e);
      const fl = s.flowers.find(f => f.id === s.dragId);
      if (fl && fl.dragging) { fl.x = x - fl.dragOX; fl.y = y - fl.dragOY; }
    };

    const onUp = (e: PointerEvent) => {
      const s = stateRef.current; if (!s.running || s.dragId === null) return;
      const {x, y} = getPos(e);
      const fl = s.flowers.find(f => f.id === s.dragId);
      if (fl && fl.dragging) {
        const dist = Math.hypot(x - s.vaseX, y - s.vaseY);
        if (dist < s.vaseR + 20) {
          placeFn.current(fl.id);
        } else {
          fl.dragging = false;
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
    return [
      {label:'Flowers Placed',value:String(sig.placed),color:sig.placed>=8?'#4ade80':sig.placed>=4?'#facc15':'#ef4444'},
      {label:'Flowers Missed',value:String(sig.missed),color:sig.missed<=3?'#4ade80':sig.missed<=7?'#facc15':'#ef4444'},
      {label:'Score',value:String(sig.score),color:ACCENT},
      {label:'Personal Best',value:String(pb),color:'var(--color-text)'},
    ];
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accentColor} gameId={GAME_ID}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start Arranging" accentColor={accentColor} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accentColor}/>}
      {(phase==='playing'||phase==='countdown')&&<>
        <canvas ref={canvasRef} role="img" aria-label="Flower Bouquet canvas" style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
        {phase==='playing'&&<GameHUD accentColor={accentColor} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5,testId:'timer'},{label:'SCORE',value:scoreDisplay,testId:'score'}]}/>}
      </>}
      {phase==='done'&&finalSig&&<>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={accentColor} onPlayAgain={handlePlayAgain} didWin={finalSig.placed>=6}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}
