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

const GAME_ID      = 'bbq-master';
const ACCENT       = '#f97316';
const DURATION     = 45;
const GAME_EMOJI   = '🍖';
const GAME_TITLE   = 'BBQ Master';
const GAME_TAGLINE = 'Tap food at the PERFECT moment to flip it — don\'t burn the grill!';
const PB_KEY       = 'mg_pb_bbq-master';

// Cook timing constants (seconds per side)
const COOK_TOTAL = 5.5;    // seconds per side
const PERFECT_LO = 0.42;   // perfect flip window start
const PERFECT_HI = 0.58;   // perfect flip window end
const GOOD_LO    = 0.32;
const GOOD_HI    = 0.68;
const BURN_START = 0.75;   // starts burning after this fraction

type FoodType = 'burger' | 'sausage' | 'corn' | 'skewer';
const FOOD_TYPES: FoodType[] = ['burger','sausage','corn','skewer'];

const SLOT_COLS = 2;
const SLOT_ROWS = 2;

interface FoodItem {
  id: number; type: FoodType;
  slotCol: number; slotRow: number;
  progress: number; // 0-1 within current side
  side: number;     // 0 = first side, 1 = second side
  burnt: boolean;
  flipFlash: number; // animation
  smokeParticles: {x:number;y:number;vy:number;alpha:number}[];
}
interface Signals {
  score: number;
  perfectFlips: number;
  goodFlips: number;
  lateFlips: number;
  burntItems: number;
}

function getPersonality(sig: Signals): string {
  const total = sig.perfectFlips + sig.goodFlips + sig.lateFlips;
  const perfRatio = total > 0 ? sig.perfectFlips / total : 0;
  if (perfRatio >= 0.7 && sig.burntItems === 0) return 'Grill Master 🔥';
  if (perfRatio >= 0.5) return 'Seasoned Chef 👨‍🍳';
  if (sig.burntItems >= 4) return 'Smoke Signal 💨';
  if (sig.goodFlips >= 5) return 'Decent Flipper 🍳';
  return 'BBQ Rookie 🥩';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

// ─── DRAW FOOD ────────────────────────────────────────────────────────────────
function cookColor(progress: number, burnt: boolean): string {
  if (burnt) return '#1a0a00';
  if (progress < PERFECT_LO) {
    // Raw: pinkish → golden
    const t = progress / PERFECT_LO;
    const r = Math.floor(220 - t*30), g = Math.floor(150 + t*60), b = Math.floor(130 - t*80);
    return `rgb(${r},${g},${b})`;
  }
  if (progress < BURN_START) {
    // Perfect → overdone
    const t = (progress - PERFECT_LO) / (BURN_START - PERFECT_LO);
    const r = Math.floor(190 - t*100), g = Math.floor(210 - t*130), b = Math.floor(50 - t*40);
    return `rgb(${r},${g},${b})`;
  }
  // Burning
  const t = Math.min(1, (progress - BURN_START) / 0.25);
  const r = Math.floor(90 - t*70), g = Math.floor(80 - t*70), b = Math.floor(10);
  return `rgb(${r},${g},${b})`;
}

function drawFood(ctx: CanvasRenderingContext2D, item: FoodItem, cx: number, cy: number, cellW: number, cellH: number) {
  const col = cookColor(item.progress, item.burnt);
  const flash = item.flipFlash;
  ctx.save();
  if (flash > 0) {
    ctx.globalAlpha = 0.6 + flash * 0.4;
  }

  switch (item.type) {
    case 'burger': {
      const bw = cellW * 0.55, bh = cellH * 0.28;
      ctx.fillStyle = col;
      ctx.shadowBlur = flash > 0 ? 20 : 5; ctx.shadowColor = col;
      ctx.beginPath(); ctx.roundRect(cx - bw/2, cy - bh/2, bw, bh, bh/2); ctx.fill();
      // sesame seeds
      ctx.fillStyle = '#facc15';
      ctx.shadowBlur = 0;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.ellipse(cx + i*10, cy - bh*0.1, 2.5, 1.5, Math.PI*0.3, 0, Math.PI*2); ctx.fill();
      }
      break;
    }
    case 'sausage': {
      const sw = cellW * 0.6, sh = cellH * 0.22;
      ctx.fillStyle = col;
      ctx.shadowBlur = flash > 0 ? 20 : 5; ctx.shadowColor = col;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI * 0.1);
      ctx.beginPath(); ctx.roundRect(-sw/2, -sh/2, sw, sh, sh/2); ctx.fill();
      ctx.restore();
      break;
    }
    case 'corn': {
      const cr = cellH * 0.28;
      ctx.fillStyle = col;
      ctx.shadowBlur = flash > 0 ? 20 : 5; ctx.shadowColor = col;
      ctx.beginPath(); ctx.ellipse(cx, cy, cr*0.45, cr, 0, 0, Math.PI*2); ctx.fill();
      // Kernels
      ctx.fillStyle = item.burnt ? '#333' : '#fde68a';
      ctx.shadowBlur = 0;
      for (let row = -2; row <= 2; row++) {
        for (let col2 = -1; col2 <= 1; col2++) {
          ctx.beginPath(); ctx.arc(cx + col2*7 + (row%2)*3.5, cy + row*9, 3, 0, Math.PI*2); ctx.fill();
        }
      }
      break;
    }
    case 'skewer': {
      const sl = cellW * 0.65;
      // Stick
      ctx.strokeStyle = '#8b6914'; ctx.lineWidth = 3;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-Math.PI*0.15);
      ctx.beginPath(); ctx.moveTo(-sl/2, 0); ctx.lineTo(sl/2, 0); ctx.stroke();
      // Meat chunks
      ctx.fillStyle = col;
      ctx.shadowBlur = flash > 0 ? 20 : 5; ctx.shadowColor = col;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.roundRect(i*18 - 8, -8, 16, 16, 4); ctx.fill();
      }
      ctx.restore();
      break;
    }
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  items: FoodItem[]; nextId: number;
  lastSpawn: number; spawnInterval: number;
  cellW: number; cellH: number; gridX: number; gridY: number;
  accentColor: string;
}

export default function BBQMasterGame() {
  const theme = useBrandTheme();
  const accentColor = theme.id !== 'ether' ? theme.colors.accent : ACCENT;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const lastFrameRef = useRef(0);

  const stateRef = useRef<GS>({
    running:false, timeLeft:DURATION,
    sig:{score:0,perfectFlips:0,goodFlips:0,lateFlips:0,burntItems:0},
    items:[], nextId:0, lastSpawn:0, spawnInterval:3200,
    cellW:0, cellH:0, gridX:0, gridY:0, accentColor:ACCENT,
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

  const spawnItem = useCallback(() => {
    const s = stateRef.current;
    const emptySlots: {c:number;r:number}[] = [];
    for (let c = 0; c < SLOT_COLS; c++) {
      for (let r = 0; r < SLOT_ROWS; r++) {
        if (!s.items.some(it => it.slotCol===c && it.slotRow===r)) {
          emptySlots.push({c, r});
        }
      }
    }
    if (emptySlots.length === 0) return;
    const slot = emptySlots[Math.floor(Math.random() * emptySlots.length)];
    s.items.push({
      id: s.nextId++,
      type: FOOD_TYPES[Math.floor(Math.random() * FOOD_TYPES.length)],
      slotCol: slot.c, slotRow: slot.r,
      progress: 0, side: 0, burnt: false,
      flipFlash: 0, smokeParticles: [],
    });
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;
    canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;

    const W = canvas.width, H = canvas.height;
    s.cellW = W / SLOT_COLS;
    s.cellH = (H * 0.55) / SLOT_ROWS;
    s.gridX = 0; s.gridY = H * 0.22;

    s.running=true; s.timeLeft=DURATION;
    s.sig={score:0,perfectFlips:0,goodFlips:0,lateFlips:0,burntItems:0};
    s.items=[]; s.nextId=0; s.lastSpawn=0; s.spawnInterval=3200;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('holiday');
    lastFrameRef.current = performance.now();
    spawnItem(); spawnItem();

    timerRef.current = setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft<=5&&s.timeLeft>0) sfx.collect();
      if (s.timeLeft<=0) endGame();
    },1000);

    const loop = (ts: number) => {
      if (!s.running) return;
      const dt = Math.min(50, ts - lastFrameRef.current) / 1000; // seconds
      lastFrameRef.current = ts;
      const W2 = canvas.width, H2 = canvas.height;

      // BG
      ctx.fillStyle = '#1a0a00'; ctx.fillRect(0, 0, W2, H2);

      // Grill surface
      const gTop = s.gridY - 10, gBot = s.gridY + s.cellH * SLOT_ROWS + 10;
      ctx.fillStyle = '#2d1a00';
      ctx.fillRect(0, gTop, W2, gBot - gTop);

      // Grill bars (horizontal metal bars)
      ctx.strokeStyle = '#4a2800'; ctx.lineWidth = 10;
      const barCount = 8;
      for (let i = 0; i <= barCount; i++) {
        const gy = gTop + (i / barCount) * (gBot - gTop);
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W2, gy); ctx.stroke();
      }
      // Grill glow
      const grillGrad = ctx.createLinearGradient(0, gBot, 0, gBot + 30);
      grillGrad.addColorStop(0, 'rgba(255,100,0,0.35)');
      grillGrad.addColorStop(1, 'rgba(255,100,0,0)');
      ctx.fillStyle = grillGrad; ctx.fillRect(0, gBot, W2, 30);

      // Grid dividers
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
      for (let c = 1; c < SLOT_COLS; c++) {
        const gx = s.gridX + c * s.cellW;
        ctx.beginPath(); ctx.moveTo(gx, gTop); ctx.lineTo(gx, gBot); ctx.stroke();
      }

      // Spawn
      const now2 = performance.now();
      if (now2 - s.lastSpawn > s.spawnInterval && s.items.length < SLOT_COLS * SLOT_ROWS) {
        spawnItem(); s.lastSpawn = now2;
        // Ramp up speed
        s.spawnInterval = Math.max(1800, s.spawnInterval - 80);
      }

      // Update and draw items
      for (const item of s.items) {
        if (!item.burnt) item.progress = Math.min(1, item.progress + dt / COOK_TOTAL);
        if (item.progress >= 1 && !item.burnt) {
          item.burnt = true; s.sig.burntItems++;
          sfx.nearMiss(); haptic([20,30,20]);
          setScoreDisplay(s.sig.score);
        }
        item.flipFlash = Math.max(0, item.flipFlash - dt * 4);

        // Smoke for burning
        if (item.burnt || item.progress > BURN_START) {
          if (Math.random() < 0.12) {
            const cx2 = s.gridX + item.slotCol * s.cellW + s.cellW / 2;
            const cy2 = s.gridY + item.slotRow * s.cellH + s.cellH / 2;
            item.smokeParticles.push({x: cx2 + (Math.random()-0.5)*20, y: cy2 - 20, vy: -0.6 - Math.random()*0.4, alpha: 0.5});
          }
        }
        item.smokeParticles = item.smokeParticles.filter(p=>p.alpha>0.02);
        for (const p of item.smokeParticles) {
          p.y += p.vy; p.alpha -= 0.012;
          ctx.save(); ctx.globalAlpha = p.alpha;
          ctx.fillStyle = '#888'; ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI*2); ctx.fill();
          ctx.restore();
        }

        const cx2 = s.gridX + item.slotCol * s.cellW + s.cellW / 2;
        const cy2 = s.gridY + item.slotRow * s.cellH + s.cellH / 2;
        drawFood(ctx, item, cx2, cy2, s.cellW * 0.85, s.cellH * 0.85);

        // Cook progress ring
        const ringR = Math.min(s.cellW, s.cellH) * 0.35;
        const inPerfect = item.progress >= PERFECT_LO && item.progress <= PERFECT_HI;
        const ringCol = item.burnt ? '#ef4444' : inPerfect ? '#4ade80' : item.progress < PERFECT_LO ? '#facc15' : '#f97316';
        ctx.strokeStyle = ringCol; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx2, cy2, ringR + 8, -Math.PI/2, -Math.PI/2 + Math.PI*2*item.progress);
        ctx.stroke();
        // Perfect zone arc
        ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 5; ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.arc(cx2, cy2, ringR + 8, -Math.PI/2 + Math.PI*2*PERFECT_LO, -Math.PI/2 + Math.PI*2*PERFECT_HI);
        ctx.stroke(); ctx.globalAlpha = 1;

        // Side indicator
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(item.side === 0 ? 'SIDE 1' : 'SIDE 2', cx2, cy2 + s.cellH*0.38);

        // Burnt X
        if (item.burnt) {
          ctx.fillStyle = '#ef4444'; ctx.font = 'bold 20px system-ui';
          ctx.fillText('✗', cx2, cy2 - s.cellH*0.3);
        }
      }

      // Remove burnt items after delay (they showed their burn state)
      s.items = s.items.filter(it => !(it.burnt && it.progress >= 1 && it.flipFlash <= 0));

      // Instructions
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('TAP when the ring hits the GREEN zone', W2/2, H2 * 0.92);

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnItem]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);

    const onTap = (e: PointerEvent) => {
      const s = stateRef.current; if (!s.running) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;

      for (const item of s.items) {
        if (item.burnt) continue;
        const cx = s.gridX + item.slotCol * s.cellW + s.cellW / 2;
        const cy = s.gridY + item.slotRow * s.cellH + s.cellH / 2;
        if (Math.hypot(x - cx, y - cy) < s.cellW * 0.4) {
          // Flip!
          const p = item.progress;
          if (p >= PERFECT_LO && p <= PERFECT_HI) {
            s.sig.perfectFlips++; s.sig.score += 3; item.flipFlash = 1;
            sfx.collect(); haptic([30]);
          } else if (p >= GOOD_LO && p <= GOOD_HI) {
            s.sig.goodFlips++; s.sig.score += 1; item.flipFlash = 0.6;
            sfx.collect(); haptic([20]);
          } else {
            s.sig.lateFlips++; s.sig.score = Math.max(0, s.sig.score - 1); item.flipFlash = 0.3;
            sfx.nearMiss(); haptic([20,30,20]);
          }
          // Flip to side 2 or remove if done
          if (item.side === 0) {
            item.side = 1; item.progress = 0;
          } else {
            // Fully cooked — award and remove
            s.sig.score += 2; setScoreDisplay(s.sig.score);
            s.items = s.items.filter(it => it.id !== item.id);
            sfx.collect(); haptic([30,20,30]);
          }
          setScoreDisplay(s.sig.score);
          break;
        }
      }
    };

    canvas.addEventListener('pointerdown', onTap);
    return () => { window.removeEventListener('resize', resize); canvas.removeEventListener('pointerdown', onTap); };
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
      {label:'Perfect Flips',value:String(sig.perfectFlips),color:sig.perfectFlips>=5?'#4ade80':sig.perfectFlips>=2?'#facc15':'#ef4444'},
      {label:'Burnt Items',value:String(sig.burntItems),color:sig.burntItems===0?'#4ade80':sig.burntItems<=2?'#facc15':'#ef4444'},
      {label:'Score',value:String(sig.score),color:ACCENT},
      {label:'Personal Best',value:String(pb),color:'var(--color-text)'},
    ];
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accentColor} gameId={GAME_ID}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Fire Up the Grill!" accentColor={accentColor} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accentColor}/>}
      {(phase==='playing'||phase==='countdown')&&<>
        <canvas ref={canvasRef} role="img" aria-label="BBQ Master canvas" style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
        {phase==='playing'&&<GameHUD accentColor={accentColor} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5,testId:'timer'},{label:'SCORE',value:scoreDisplay,testId:'score'}]}/>}
      </>}
      {phase==='done'&&finalSig&&<>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={accentColor} onPlayAgain={handlePlayAgain} didWin={finalSig.perfectFlips>=4&&finalSig.burntItems<=2}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}
