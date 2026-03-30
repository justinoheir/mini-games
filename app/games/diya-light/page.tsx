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

const GAME_ID      = 'diya-light';
const ACCENT       = '#f59e0b';
const DURATION     = 45;
const GAME_EMOJI   = '🪔';
const GAME_TITLE   = 'Diya Light';
const GAME_TAGLINE = 'Tilt to pour oil, then tap to light at the perfect level!';
const PB_KEY       = 'mg_pb_diya-light';

// Perfect fill window
const FILL_LO = 0.58;
const FILL_HI = 0.82;
// Overfill
const FILL_OVERFLOW = 0.92;

interface Flame { x:number; y:number; phase:number; }
interface OilDrop { x:number; y:number; vy:number; alpha:number; }
interface Signals {
  score: number; diyas: number;
  perfectLights: number; overfills: number; underfills: number;
}

function getPersonality(sig: Signals): string {
  if (sig.perfectLights >= 4) return 'Diya Devotee 🪔';
  if (sig.perfectLights >= 2 && sig.overfills <= 1) return 'Careful Pourer 🫗';
  if (sig.overfills >= 3) return 'Overflow Artist 💧';
  if (sig.diyas >= 3) return 'Festival Lighter ✨';
  return 'Cautious Flame 🕯️';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  fillLevel: number;     // 0-1 oil fill
  pourRate: number;      // current pour rate (from tilt/drag)
  lit: boolean;          // diya currently lit
  litTimer: number;      // celebration timer after lighting
  flamePower: number;    // 0-1 flame intensity
  flames: Flame[];
  oilDrops: OilDrop[];
  // Tilt / drag input
  tiltX: number;        // -1..1 (from DeviceOrientation or drag)
  dragActive: boolean;
  dragStartX: number;
  dragBaseX: number;
  // State for completed diyas (show mini icons)
  completedFills: number[];
  // Flash
  lightFlash: number;
  overflowFlash: number;
  accentColor: string;
}

function drawDiya(ctx: CanvasRenderingContext2D, cx: number, cy: number, fillLevel: number, lit: boolean, flamePower: number, flames: Flame[], flashAlpha: number) {
  const w = 90, h = 40;
  // Shadow
  ctx.save();
  ctx.shadowBlur = lit ? 40 + flamePower * 20 : 8;
  ctx.shadowColor = lit ? '#f59e0b' : '#4a2800';

  // Bowl outline (clay terracotta)
  ctx.fillStyle = '#c2612a';
  ctx.beginPath();
  ctx.moveTo(cx - w/2, cy);
  ctx.quadraticCurveTo(cx - w/2, cy + h, cx, cy + h * 0.7);
  ctx.quadraticCurveTo(cx + w/2, cy + h, cx + w/2, cy);
  ctx.closePath(); ctx.fill();

  // Oil in bowl
  const oilY = cy + h * 0.7 - fillLevel * h * 0.55;
  const grad = ctx.createLinearGradient(cx, oilY, cx, cy + h * 0.7);
  if (lit) {
    grad.addColorStop(0, `rgba(251,191,36,${0.85 + flamePower * 0.1})`);
    grad.addColorStop(1, `rgba(234,88,12,0.9)`);
  } else {
    grad.addColorStop(0, 'rgba(180,140,60,0.85)');
    grad.addColorStop(1, 'rgba(120,80,20,0.9)');
  }
  if (fillLevel > 0.02) {
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.45, oilY);
    ctx.lineTo(cx + w * 0.45, oilY);
    ctx.quadraticCurveTo(cx + w * 0.45, cy + h * 0.68, cx, cy + h * 0.65);
    ctx.quadraticCurveTo(cx - w * 0.45, cy + h * 0.68, cx - w * 0.45, oilY);
    ctx.closePath(); ctx.fill();
  }

  // Wick
  ctx.strokeStyle = '#8b6914'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - 16); ctx.stroke();

  // Perfect zone indicator (green marks on side)
  if (!lit) {
    const loY = cy + h * 0.7 - FILL_LO * h * 0.55;
    const hiY = cy + h * 0.7 - FILL_HI * h * 0.55;
    ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx + w*0.5, loY); ctx.lineTo(cx + w*0.5 + 10, loY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + w*0.5, hiY); ctx.lineTo(cx + w*0.5 + 10, hiY); ctx.stroke();
    ctx.fillStyle = 'rgba(74,222,128,0.15)';
    ctx.fillRect(cx + w*0.5, hiY, 10, loY - hiY);
    ctx.fillStyle = '#4ade80'; ctx.font = '9px system-ui';
    ctx.textAlign = 'left'; ctx.fillText('✓', cx + w*0.5 + 12, (loY + hiY)/2 + 3);
  }

  // Flames
  if (lit && flamePower > 0) {
    for (const fl of flames) {
      ctx.save();
      ctx.globalAlpha = flamePower * fl.alpha;
      const fy = cy - 16;
      const fh = 18 + Math.sin(fl.phase) * 5 + flamePower * 14;
      const fw = 8 + Math.sin(fl.phase * 1.3) * 3;
      const flameGrad = ctx.createRadialGradient(cx + fl.x, fy - fh/2, 0, cx + fl.x, fy, fh);
      flameGrad.addColorStop(0, '#fff9c4');
      flameGrad.addColorStop(0.3, '#f59e0b');
      flameGrad.addColorStop(0.7, '#ef4444');
      flameGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = flameGrad;
      ctx.shadowBlur = 18; ctx.shadowColor = '#f59e0b';
      ctx.beginPath();
      ctx.moveTo(cx + fl.x, fy);
      ctx.quadraticCurveTo(cx + fl.x + fw, fy - fh*0.5, cx + fl.x, fy - fh);
      ctx.quadraticCurveTo(cx + fl.x - fw, fy - fh*0.5, cx + fl.x, fy);
      ctx.fill();
      ctx.restore();
    }
  }

  // Flash overlay
  if (flashAlpha > 0) {
    ctx.fillStyle = `rgba(245,158,11,${flashAlpha * 0.4})`;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

export default function DiyaLightGame() {
  const theme = useBrandTheme();
  const accentColor = theme.id !== 'ether' ? theme.colors.accent : ACCENT;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const lastFrameRef = useRef(0);

  const stateRef = useRef<GS>({
    running:false, timeLeft:DURATION,
    sig:{score:0,diyas:0,perfectLights:0,overfills:0,underfills:0},
    fillLevel:0, pourRate:0, lit:false, litTimer:0, flamePower:0,
    flames:[{x:0,y:0,phase:0},{x:3,y:0,phase:1.2},{x:-3,y:0,phase:2.4}],
    oilDrops:[], tiltX:0, dragActive:false, dragStartX:0, dragBaseX:0,
    completedFills:[], lightFlash:0, overflowFlash:0, accentColor:ACCENT,
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
    s.sig={score:0,diyas:0,perfectLights:0,overfills:0,underfills:0};
    s.fillLevel=0; s.pourRate=0; s.lit=false; s.litTimer=0; s.flamePower=0;
    s.flames=[{x:0,y:0,phase:0},{x:3,y:0,phase:1.2},{x:-3,y:0,phase:2.4}];
    s.oilDrops=[]; s.completedFills=[]; s.lightFlash=0; s.overflowFlash=0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('chill');
    lastFrameRef.current = performance.now();

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

      // BG — warm festival night
      const bg = ctx.createRadialGradient(W/2, H*0.4, 0, W/2, H*0.5, Math.max(W,H));
      bg.addColorStop(0, '#1a0800');
      bg.addColorStop(1, '#0d0500');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      // Stars
      ctx.fillStyle = 'rgba(255,255,200,0.4)';
      for (let i = 0; i < 30; i++) {
        const sx = ((i * 137 + 50) % W), sy = ((i * 97 + 20) % (H * 0.45));
        const blink = 0.3 + 0.7 * Math.abs(Math.sin(ts * 0.001 + i * 0.5));
        ctx.globalAlpha = blink * 0.5;
        ctx.beginPath(); ctx.arc(sx, sy, 1.2, 0, Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      const diyaX = W / 2, diyaY = H * 0.52;

      // ── Oil jug above diya ──
      if (!s.lit) {
        const jx = W * 0.25, jy = H * 0.3;
        const tilt = s.tiltX * 0.8; // jug tilts with tilt input
        ctx.save();
        ctx.translate(jx, jy); ctx.rotate(tilt);
        ctx.fillStyle = '#7c4f28'; ctx.strokeStyle = '#a8783a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, 0, 18, 30, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#a8783a'; ctx.beginPath(); ctx.ellipse(0, -30, 8, 6, 0, 0, Math.PI*2); ctx.fill();
        // Spout
        ctx.strokeStyle = '#a8783a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(18, -10); ctx.lineTo(28, -22); ctx.stroke();
        ctx.restore();

        // Pour rate from tilt
        s.pourRate = Math.max(0, s.tiltX) * 0.25;

        // Oil drops when pouring
        if (s.pourRate > 0.02) {
          const spoutX = jx + Math.cos(tilt) * 28, spoutY = jy - Math.sin(tilt) * 22;
          if (Math.random() < s.pourRate * 4) {
            s.oilDrops.push({x: spoutX, y: spoutY, vy: 0.5, alpha: 0.9});
          }
        }
        s.oilDrops = s.oilDrops.filter(d => d.alpha > 0.05);
        for (const d of s.oilDrops) {
          d.y += d.vy; d.vy += 0.15;
          d.alpha -= 0.02;
          // If drop reaches diya, add to fill
          if (d.y >= diyaY + 5) {
            s.fillLevel = Math.min(1, s.fillLevel + 0.004);
            d.alpha = 0;
          }
          ctx.save();
          ctx.globalAlpha = d.alpha;
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath(); ctx.arc(d.x, d.y, 3, 0, Math.PI*2); ctx.fill();
          ctx.restore();
        }

        // Tilt hint
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('← TILT RIGHT to pour →', W/2, H * 0.85);
        ctx.fillText('TAP diya when oil is in green zone', W/2, H * 0.9);

        // Overflow
        if (s.fillLevel >= FILL_OVERFLOW) {
          s.fillLevel = FILL_OVERFLOW;
          s.overflowFlash = Math.min(1, s.overflowFlash + dt * 3);
          s.sig.overfills++;
          s.fillLevel = 0;
          s.overflowFlash = 0;
          sfx.nearMiss(); haptic([20,30,20]);
          setScoreDisplay(s.sig.score);
        }
      }

      // Update lit timer
      if (s.lit) {
        s.litTimer -= dt;
        s.flamePower = Math.min(1, s.flamePower + dt * 1.5);
        // Animate flames
        for (const fl of s.flames) { fl.phase += dt * 6; }
        if (s.litTimer <= 0) {
          // Next diya
          s.lit = false; s.fillLevel = 0; s.flamePower = 0; s.lightFlash = 0;
          for (const fl of s.flames) fl.phase = 0;
        }
      }
      s.lightFlash = Math.max(0, s.lightFlash - dt * 2);
      s.overflowFlash = Math.max(0, s.overflowFlash - dt * 2);

      // Draw diya
      drawDiya(ctx, diyaX, diyaY, s.fillLevel, s.lit, s.flamePower, s.flames, s.lightFlash);

      // Overflow flash
      if (s.overflowFlash > 0) {
        ctx.fillStyle = `rgba(59,130,246,${s.overflowFlash * 0.3})`;
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = `rgba(59,130,246,${s.overflowFlash})`;
        ctx.font = 'bold 22px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('OVERFLOW! -0', W/2, H*0.72);
      }

      // Completed diya row
      for (let i = 0; i < s.sig.diyas; i++) {
        const ix = W/2 - (s.sig.diyas-1)*22/2 + i*22, iy = H*0.1;
        ctx.fillStyle = '#f59e0b'; ctx.font = '18px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('🪔', ix, iy);
      }
      // Current fill label
      if (!s.lit) {
        const fillPct = Math.round(s.fillLevel * 100);
        const inZone = s.fillLevel >= FILL_LO && s.fillLevel <= FILL_HI;
        ctx.fillStyle = inZone ? '#4ade80' : '#f59e0b';
        ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(`${fillPct}% oil ${inZone ? '✓ TAP NOW!' : ''}`, diyaX, diyaY + 70);
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  // Device orientation (tilt)
  useEffect(() => {
    if (phase !== 'playing') return;
    const onOrientation = (e: DeviceOrientationEvent) => {
      const s = stateRef.current; if (!s.running) return;
      // gamma: left/right tilt -90..90
      const g = e.gamma ?? 0;
      s.tiltX = Math.max(-1, Math.min(1, g / 45));
    };
    window.addEventListener('deviceorientation', onOrientation);
    return () => window.removeEventListener('deviceorientation', onOrientation);
  }, [phase]);

  // Canvas tap + drag fallback (for desktop/no tilt)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);

    const onDown = (e: PointerEvent) => {
      const s = stateRef.current; if (!s.running) return;
      s.dragActive = true; s.dragStartX = e.clientX; s.dragBaseX = s.tiltX;
      // Also handle tap on diya to light
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const diyaX = canvas.width / 2, diyaY = canvas.height * 0.52;
      if (!s.lit && Math.hypot(x - diyaX, y - diyaY) < 70) {
        // Attempt to light
        if (s.fillLevel >= FILL_LO && s.fillLevel <= FILL_HI) {
          s.lit = true; s.litTimer = 1.5; s.lightFlash = 1;
          s.sig.diyas++; s.sig.perfectLights++; s.sig.score += 10;
          sfx.collect(); haptic([30, 20, 30, 20, 60]);
          setScoreDisplay(s.sig.score);
          s.completedFills.push(Math.round(s.fillLevel * 100));
        } else if (s.fillLevel < FILL_LO) {
          s.sig.underfills++; s.sig.score = Math.max(0, s.sig.score - 1);
          sfx.nearMiss(); haptic([20,30,20]);
          setScoreDisplay(s.sig.score);
        }
        // Overfull taps don't trigger (handled by overflow logic)
      }
    };

    const onMove = (e: PointerEvent) => {
      const s = stateRef.current; if (!s.running || !s.dragActive) return;
      const dx = (e.clientX - s.dragStartX) / 120;
      s.tiltX = Math.max(-1, Math.min(1, s.dragBaseX + dx));
    };

    const onUp = () => { const s = stateRef.current; s.dragActive = false; s.tiltX = 0; };

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
      {label:'Diyas Lit',value:String(sig.diyas),color:sig.diyas>=4?'#4ade80':sig.diyas>=2?'#facc15':'#ef4444'},
      {label:'Perfect Lights',value:String(sig.perfectLights),color:sig.perfectLights>=3?'#4ade80':'#facc15'},
      {label:'Overflows',value:String(sig.overfills),color:sig.overfills===0?'#4ade80':sig.overfills<=2?'#facc15':'#ef4444'},
      {label:'Personal Best',value:String(pb),color:'var(--color-text)'},
    ];
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accentColor} gameId={GAME_ID}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Light the Diyas!" accentColor={accentColor} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accentColor}/>}
      {(phase==='playing'||phase==='countdown')&&<>
        <canvas ref={canvasRef} role="img" aria-label="Diya Light canvas" style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
        {phase==='playing'&&<GameHUD accentColor={accentColor} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5,testId:'timer'},{label:'SCORE',value:scoreDisplay,testId:'score'}]}/>}
      </>}
      {phase==='done'&&finalSig&&<>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={accentColor} onPlayAgain={handlePlayAgain} didWin={finalSig.diyas>=3}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}
