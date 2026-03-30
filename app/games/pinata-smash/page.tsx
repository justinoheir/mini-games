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

const GAME_ID      = 'pinata-smash';
const ACCENT       = '#f97316';
const DURATION     = 30;
const GAME_EMOJI   = '🎊';
const GAME_TITLE   = 'Piñata Smash';
const GAME_TAGLINE = 'Swipe fast and hard — burst the piñata for candy!';
const PB_KEY       = 'mg_pb_pinata-smash';
const CANDY_COLORS = ['#f43f5e','#f97316','#facc15','#4ade80','#22d3ee','#a855f7','#ec4899','#3b82f6'];
const PINATA_COLORS = ['#ec4899','#f97316','#facc15','#22d3ee','#a855f7','#4ade80'];

interface Candy { x:number;y:number;vx:number;vy:number;r:number;color:string;alpha:number;rot:number;vrot:number; }
interface Crack { rx:number;ry:number;ex:number;ey:number;alpha:number; }
interface Signals { score:number;totalHits:number;bursts:number;maxSwipeSpeed:number;totalSwipes:number; }

function getPersonality(sig: Signals): string {
  if (sig.bursts >= 4 && sig.maxSwipeSpeed >= 700) return 'Fiesta Destroyer 🎉';
  if (sig.bursts >= 3) return 'Candy Chaser 🍬';
  if (sig.maxSwipeSpeed >= 700) return 'Speed Smasher ⚡';
  if (sig.totalHits >= 20) return 'Steady Striker 🔨';
  return 'Gentle Swinger 🌸';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number, innerR: number, pts: number) {
  ctx.beginPath();
  for (let i = 0; i < pts * 2; i++) {
    const a = (i * Math.PI) / pts - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    if (i === 0) ctx.moveTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r);
    else ctx.lineTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r);
  }
  ctx.closePath();
}

interface GS {
  running:boolean; timeLeft:number; sig:Signals;
  pinX:number; pinY:number; pinW:number;
  damage:number; colorIdx:number; swayPhase:number;
  cracks:Crack[]; candy:Candy[];
  pDown:boolean; lastPX:number; lastPY:number; lastPTime:number; lastHitTime:number;
  burstFlash:number; shakeAmt:number; accentColor:string;
}

export default function PinataSmashGame() {
  const theme = useBrandTheme();
  const accentColor = theme.id !== 'ether' ? theme.colors.accent : ACCENT;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const burstRef = useRef<()=>void>(() => {});

  const stateRef = useRef<GS>({
    running:false, timeLeft:DURATION,
    sig:{score:0,totalHits:0,bursts:0,maxSwipeSpeed:0,totalSwipes:0},
    pinX:0, pinY:0, pinW:80, damage:0, colorIdx:0, swayPhase:0,
    cracks:[], candy:[],
    pDown:false, lastPX:0, lastPY:0, lastPTime:0, lastHitTime:0,
    burstFlash:0, shakeAmt:0, accentColor:ACCENT,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);
  useEffect(() => { stateRef.current.accentColor = accentColor; }, [accentColor]);

  const resetPinata = useCallback(() => {
    const s = stateRef.current; const c = canvasRef.current; if (!c) return;
    s.pinX = c.width/2; s.pinY = c.height*0.40; s.pinW = 78; s.damage = 0; s.cracks = [];
  }, []);

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
    s.sig={score:0,totalHits:0,bursts:0,maxSwipeSpeed:0,totalSwipes:0};
    s.candy=[]; s.burstFlash=0; s.colorIdx=0; s.swayPhase=0; s.shakeAmt=0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('holiday');
    resetPinata();

    // Store burst fn in ref so input handler can access latest without stale closure
    const doBurst = () => {
      const spawnCount = 28 + s.sig.bursts*6;
      for (let i = 0; i < spawnCount; i++) {
        const a = Math.random()*Math.PI*2, spd = 2+Math.random()*10;
        s.candy.push({x:s.pinX,y:s.pinY,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd-5,
          r:3+Math.random()*8,color:CANDY_COLORS[Math.floor(Math.random()*CANDY_COLORS.length)],
          alpha:1,rot:Math.random()*Math.PI*2,vrot:(Math.random()-0.5)*0.28});
      }
      s.sig.bursts++; s.sig.score += 5+s.sig.bursts*2;
      s.burstFlash=1; s.shakeAmt=12;
      s.colorIdx=(s.colorIdx+1)%PINATA_COLORS.length;
      sfx.collect(); haptic([30,20,30,20,60]);
      setScoreDisplay(s.sig.score);
      resetPinata();
    };
    burstRef.current = doBurst;

    timerRef.current = setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft<=5&&s.timeLeft>0) sfx.collect();
      if (s.timeLeft<=0) endGame();
    },1000);

    const loop = ()=>{
      if (!s.running) return;
      const W=canvas.width, H=canvas.height;
      const bg=ctx.createLinearGradient(0,0,0,H);
      bg.addColorStop(0,'#1a0030'); bg.addColorStop(1,'#0d001a');
      ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

      if (s.burstFlash>0){
        ctx.fillStyle=`rgba(250,204,21,${s.burstFlash*0.32})`; ctx.fillRect(0,0,W,H);
        s.burstFlash=Math.max(0,s.burstFlash-0.055);
      }
      s.shakeAmt*=0.7;
      const shk=s.shakeAmt*(Math.random()<0.5?1:-1);
      s.swayPhase+=0.022;
      const swayOff=Math.sin(s.swayPhase)*28+shk;
      const px=s.pinX+swayOff, py=s.pinY, pw=s.pinW;
      const dmRatio=s.damage/100;

      // Rope
      ctx.save(); ctx.strokeStyle='#8b6914'; ctx.lineWidth=3; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(W/2,0);
      ctx.quadraticCurveTo(px,py*0.4,px,py-pw*0.6); ctx.stroke(); ctx.restore();

      // Body
      const col=PINATA_COLORS[s.colorIdx];
      const f=1-dmRatio*0.6;
      const n=parseInt(col.replace('#',''),16);
      const [pr,pg,pb2]=[(n>>16)&255,(n>>8)&255,n&255];
      ctx.save();
      ctx.shadowBlur=28-dmRatio*12; ctx.shadowColor=col;
      ctx.fillStyle=`rgb(${Math.floor(pr*f)},${Math.floor(pg*f)},${Math.floor(pb2*f)})`;
      drawStar(ctx,px,py,pw/2,pw/4.5,8); ctx.fill();
      ctx.strokeStyle=`rgba(255,255,255,${0.3-dmRatio*0.25})`; ctx.lineWidth=3;
      ctx.beginPath(); ctx.moveTo(px-pw*0.25,py-pw*0.3); ctx.lineTo(px+pw*0.25,py+pw*0.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px+pw*0.25,py-pw*0.3); ctx.lineTo(px-pw*0.25,py+pw*0.3); ctx.stroke();
      ctx.restore();

      // Cracks
      for (const cr of s.cracks){
        cr.alpha=Math.max(0,cr.alpha-0.0035);
        ctx.strokeStyle=`rgba(30,0,0,${cr.alpha*0.9})`; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(px+cr.rx,py+cr.ry); ctx.lineTo(px+cr.ex,py+cr.ey); ctx.stroke();
      }

      // Damage bar
      const bw=90,bh=8,bx=px-bw/2,by=py+pw*0.55+14;
      ctx.fillStyle='rgba(255,255,255,0.1)'; ctx.beginPath(); ctx.roundRect(bx,by,bw,bh,4); ctx.fill();
      const bc=dmRatio<0.5?'#4ade80':dmRatio<0.8?'#facc15':'#ef4444';
      ctx.fillStyle=bc; ctx.shadowBlur=8; ctx.shadowColor=bc;
      ctx.beginPath(); ctx.roundRect(bx,by,bw*dmRatio,bh,4); ctx.fill(); ctx.shadowBlur=0;

      // Hint
      ctx.fillStyle='rgba(255,255,255,0.28)'; ctx.font='bold 13px system-ui';
      ctx.textAlign='center'; ctx.textBaseline='alphabetic';
      ctx.fillText('← SWIPE TO SMASH →',W/2,H*0.77);

      // Candy
      s.candy=s.candy.filter(c=>c.alpha>0.04);
      for (const c of s.candy){
        c.x+=c.vx; c.y+=c.vy; c.vy+=0.3; c.vx*=0.99; c.rot+=c.vrot; c.alpha-=0.012;
        ctx.save(); ctx.globalAlpha=Math.max(0,c.alpha); ctx.translate(c.x,c.y); ctx.rotate(c.rot);
        ctx.fillStyle=c.color; ctx.shadowBlur=5; ctx.shadowColor=c.color;
        ctx.fillRect(-c.r/2,-c.r/2,c.r,c.r); ctx.restore();
      }
      if (s.sig.bursts>0){
        ctx.save(); ctx.globalAlpha=0.055; ctx.fillStyle='#facc15';
        ctx.font=`bold 150px system-ui`; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(`×${s.sig.bursts}`,W/2,H*0.62); ctx.restore();
      }
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  }, [endGame, resetPinata]);

  useEffect(()=>{
    const canvas=canvasRef.current; if (!canvas) return;
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;};
    resize(); window.addEventListener('resize',resize);

    const onDown=(e:PointerEvent)=>{
      const s=stateRef.current; if(!s.running)return;
      s.pDown=true; s.lastPX=e.clientX; s.lastPY=e.clientY; s.lastPTime=Date.now();
    };
    const onMove=(e:PointerEvent)=>{
      const s=stateRef.current; if(!s.running||!s.pDown)return;
      const now=Date.now(), dt=Math.max(8,now-s.lastPTime);
      const dx=e.clientX-s.lastPX, dy=e.clientY-s.lastPY;
      const speed=Math.sqrt(dx*dx+dy*dy)/dt*1000;
      if(speed>s.sig.maxSwipeSpeed) s.sig.maxSwipeSpeed=Math.round(speed);
      const rect=canvas.getBoundingClientRect();
      const cx=e.clientX-rect.left, cy=e.clientY-rect.top;
      const swayOff=Math.sin(s.swayPhase)*28;
      const hd=Math.sqrt((cx-(s.pinX+swayOff))**2+(cy-s.pinY)**2);
      if(speed>240&&hd<s.pinW/2+24&&(now-s.lastHitTime)>110){
        s.lastHitTime=now; s.sig.totalHits++;
        const dmg=Math.min(26,7+speed/85);
        s.damage=Math.min(100,s.damage+dmg);
        const ca=Math.random()*Math.PI*2,cl=8+Math.random()*18;
        const crx=(Math.random()-0.5)*s.pinW*0.55, cry=(Math.random()-0.5)*s.pinW*0.55;
        s.cracks.push({rx:crx,ry:cry,ex:crx+Math.cos(ca)*cl,ey:cry+Math.sin(ca)*cl,alpha:1});
        sfx.collect(); haptic([30]);
        if(s.damage>=100) burstRef.current();
      }
      s.lastPX=e.clientX; s.lastPY=e.clientY; s.lastPTime=now;
    };
    const onUp=()=>{
      const s=stateRef.current;
      if(s.pDown){s.pDown=false;s.sig.totalSwipes++;}
    };
    canvas.addEventListener('pointerdown',onDown);
    canvas.addEventListener('pointermove',onMove);
    canvas.addEventListener('pointerup',onUp);
    canvas.addEventListener('pointercancel',onUp);
    return ()=>{
      window.removeEventListener('resize',resize);
      canvas.removeEventListener('pointerdown',onDown);
      canvas.removeEventListener('pointermove',onMove);
      canvas.removeEventListener('pointerup',onUp);
      canvas.removeEventListener('pointercancel',onUp);
    };
  },[]);

  useEffect(()=>()=>{
    cancelAnimationFrame(animRef.current);
    if(timerRef.current)clearInterval(timerRef.current);
    if(stopMusicRef.current)stopMusicRef.current();
  },[]);

  const handleStart=useCallback(async(name:string,avatar:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);
    await initAudio(); sfx.click(); setPhase('countdown');
  },[]);
  const handleCountdownDone=useCallback(()=>{startLoop();},[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);
  const buildInsights=useCallback((sig:Signals)=>{
    const pb=parseInt(localStorage.getItem(PB_KEY)??'0');
    return [
      {label:'Piñatas Burst',value:String(sig.bursts),color:sig.bursts>=3?'#4ade80':sig.bursts>=1?'#facc15':'#ef4444'},
      {label:'Total Hits',value:String(sig.totalHits),color:ACCENT},
      {label:'Max Swipe Speed',value:`${Math.round(sig.maxSwipeSpeed)}px/s`,color:ACCENT},
      {label:'Personal Best',value:String(pb),color:'var(--color-text)'},
    ];
  },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accentColor} gameId={GAME_ID}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Smash It!" accentColor={accentColor} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accentColor}/>}
      {(phase==='playing'||phase==='countdown')&&<>
        <canvas ref={canvasRef} role="img" aria-label="Piñata Smash canvas" style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
        {phase==='playing'&&<GameHUD accentColor={accentColor} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5,testId:'timer'},{label:'SCORE',value:scoreDisplay,testId:'score'}]}/>}
      </>}
      {phase==='done'&&finalSig&&<>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={accentColor} onPlayAgain={handlePlayAgain} didWin={finalSig.bursts>=2}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}
