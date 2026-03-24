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

const GAME_ID    = 'sound-garden';
const ACCENT     = '#4ade80';
const DURATION   = 60;
const GAME_EMOJI = '🌱';
const GAME_TITLE = 'Sound Garden';
const GAME_TAGLINE = 'Touch to grow. Grow to play.';

// 4×4 grid of garden cells, each with a unique color/note
const GRID_COLS = 4;
const GRID_ROWS = 4;
const CELL_COUNT = GRID_COLS * GRID_ROWS;

const CELL_COLORS = [
  '#4ade80','#22c55e','#86efac','#bbf7d0',
  '#34d399','#6ee7b7','#a7f3d0','#d1fae5',
  '#10b981','#059669','#047857','#065f46',
  '#2dd4bf','#5eead4','#99f6e4','#ccfbf1',
];

interface Plant {
  cellIdx: number;
  growth: number;   // 0-100
  maxGrowth: number; // stops at this level without water
  lastTap: number;
  color: string;
  wilt: boolean;
}

interface Signals {
  plantsGrown: number;
  tapCount: number;
  bloomedPlants: number;
  gardenFullness: number;
  maxStreak: number;
  streakCurrent: number;
  score: number;
}

function getPersonality(s: Signals): string {
  if (s.bloomedPlants>=8&&s.tapCount<40) return 'Green Thumb Maestro 🌺';
  if (s.bloomedPlants>=6)               return 'Garden Whisperer 🌻';
  if (s.plantsGrown>=12)                return 'Busy Botanist 🌿';
  if (s.gardenFullness>=80)             return 'Patient Grower 🌱';
  return 'Seedling 🌾';
}

type Phase = 'start'|'countdown'|'playing'|'done';
interface GS {
  running:boolean; timeLeft:number; sig:Signals; frame:number; accentColor:string;
  plants:Map<number,Plant>;
  particles:Array<{x:number;y:number;vx:number;vy:number;alpha:number;color:string}>;
  bloomParticles:Array<{x:number;y:number;vx:number;vy:number;alpha:number;r:number;color:string}>;
}

export default function SoundGardenGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef(0);
  const timerRef  = useRef<ReturnType<typeof setInterval>|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{plantsGrown:0,tapCount:0,bloomedPlants:0,gardenFullness:0,maxStreak:0,streakCurrent:0,score:0},
    frame:0,accentColor:ACCENT,
    plants:new Map(),particles:[],bloomParticles:[],
  });

  const [phase,setPhase]        = useState<Phase>('start');
  const [timeLeft,setTimeLeft]  = useState(DURATION);
  const [scoreDisplay,setScore] = useState(0);
  const [finalSig,setFinalSig]  = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);
  useEffect(()=>{ stateRef.current.accentColor=theme.colors.accent??ACCENT; },[theme]);

  const endGame = useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){ clearInterval(timerRef.current); timerRef.current=null; }
    const pb=parseInt(localStorage.getItem('pb_'+GAME_ID)??"0");
    if(s.sig.score>pb) localStorage.setItem('pb_'+GAME_ID,String(s.sig.score));
    s.sig.gardenFullness=Math.round(s.plants.size/CELL_COUNT*100);
    s.sig.bloomedPlants=[...s.plants.values()].filter(p=>p.growth>=100).length;
    setFinalSig({...s.sig}); setPhase('done'); hapticVictory();
  },[]);

  function getCellXY(idx:number,W:number,H:number):{cx:number,cy:number,cw:number,ch:number}{
    const margin=10, topPad=80;
    const cw=(W-margin*2)/GRID_COLS, ch=(H-topPad-margin*2)/GRID_ROWS;
    const col=idx%GRID_COLS, row=Math.floor(idx/GRID_COLS);
    return {cx:margin+col*cw, cy:topPad+margin+row*ch, cw, ch};
  }

  const startLoop = useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION; s.frame=0;
    s.sig={plantsGrown:0,tapCount:0,bloomedPlants:0,gardenFullness:0,maxStreak:0,streakCurrent:0,score:0};
    s.plants=new Map(); s.particles=[]; s.bloomParticles=[];
    setScore(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current=setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if(s.timeLeft<=0){ sfx.fail(); endGame(); }
      // Plants wilt slowly if not tapped
      const now=Date.now();
      s.plants.forEach(p=>{
        if(now-p.lastTap>4000&&p.growth>0&&p.growth<100){
          p.growth=Math.max(0,p.growth-8); p.wilt=true;
        }
      });
    },1000);

    const PLANT_STAGES=['🌱','🌿','🌸','🌺','🌻'];

    const loop=()=>{
      if(!s.running) return; s.frame++;
      const W=canvas.width,H=canvas.height;

      // Soft garden background
      const bgGrad=ctx.createLinearGradient(0,0,0,H);
      bgGrad.addColorStop(0,'#0a2010');
      bgGrad.addColorStop(1,'#0d1a0a');
      ctx.fillStyle=bgGrad; ctx.fillRect(0,0,W,H);

      // Soil texture
      for(let i=0;i<30;i++){
        const sx=((i*173)%W), sy=H*0.8+((i*97)%H*0.2);
        ctx.fillStyle='rgba(100,60,20,0.05)';
        ctx.beginPath(); ctx.arc(sx,sy,8,0,Math.PI*2); ctx.fill();
      }

      // Draw grid cells
      for(let idx=0;idx<CELL_COUNT;idx++){
        const {cx,cy,cw,ch}=getCellXY(idx,W,H);
        const plant=s.plants.get(idx);
        const glow=plant&&plant.growth>50?plant.color:null;

        ctx.save();
        if(glow){ ctx.shadowBlur=15+Math.sin(s.frame*0.08+idx)*5; ctx.shadowColor=glow; }
        // Cell background
        ctx.fillStyle=plant?`${plant.color}22`:'rgba(10,40,15,0.5)';
        ctx.strokeStyle=plant?plant.color:'rgba(70,120,70,0.3)';
        ctx.lineWidth=plant?2:1;
        ctx.beginPath(); ctx.roundRect(cx+3,cy+3,cw-6,ch-6,8); ctx.fill(); ctx.stroke();

        if(plant){
          // Growth bar
          const barH=4, barY=cy+ch-10;
          ctx.fillStyle='rgba(0,0,0,0.3)'; ctx.fillRect(cx+8,barY,cw-16,barH);
          ctx.fillStyle=plant.growth>=100?'#fbbf24':plant.color;
          ctx.fillRect(cx+8,barY,(cw-16)*(plant.growth/100),barH);

          // Plant emoji based on growth stage
          const stage=Math.min(4,Math.floor(plant.growth/25));
          const emoji=PLANT_STAGES[stage];
          const scale=0.6+plant.growth/100*0.6;
          const fy=cy+ch*0.5+8;
          ctx.font=`${Math.round(cw*scale*0.5)}px sans-serif`;
          ctx.textAlign='center';
          ctx.globalAlpha=plant.wilt?0.5:1;
          ctx.fillText(emoji,cx+cw/2,fy);

          // Bloom animation
          if(plant.growth>=100){
            const glimmer=Math.sin(s.frame*0.15+idx)*0.3+0.7;
            ctx.globalAlpha=glimmer;
            ctx.font='10px sans-serif';
            ctx.fillText('✨',cx+cw/2+Math.sin(s.frame*0.1+idx)*8, cy+12);
          }
        } else {
          // Empty cell hint
          const a=0.2+Math.sin(s.frame*0.1+idx*0.5)*0.1;
          ctx.globalAlpha=a; ctx.fillStyle='#4ade80';
          ctx.font=`${Math.round(cw*0.3)}px sans-serif`; ctx.textAlign='center';
          ctx.fillText('+',cx+cw/2,cy+ch/2+8);
        }
        ctx.restore();
      }

      // Floating particles
      for(let i=s.particles.length-1;i>=0;i--){
        const p=s.particles[i]; p.x+=p.vx; p.y+=p.vy; p.vy-=0.05; p.alpha*=0.94;
        if(p.alpha<0.02){ s.particles.splice(i,1); continue; }
        ctx.save(); ctx.globalAlpha=p.alpha; ctx.fillStyle=p.color;
        ctx.font='12px sans-serif'; ctx.textAlign='center';
        ctx.fillText('🌸',p.x,p.y); ctx.restore();
      }

      // Bloom particles
      for(let i=s.bloomParticles.length-1;i>=0;i--){
        const p=s.bloomParticles[i]; p.x+=p.vx; p.y+=p.vy; p.vy+=0.05; p.alpha*=0.92; p.r*=0.97;
        if(p.alpha<0.02){ s.bloomParticles.splice(i,1); continue; }
        ctx.save(); ctx.globalAlpha=p.alpha; ctx.fillStyle=p.color;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill(); ctx.restore();
      }

      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{ canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; };
    resize(); window.addEventListener('resize',resize);

    const onPD=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const s=stateRef.current; if(!s.running) return;
      const rect=canvas.getBoundingClientRect();
      const cx=(e.clientX-rect.left)*(canvas.width/rect.width);
      const cy=(e.clientY-rect.top)*(canvas.height/rect.height);
      const W=canvas.width,H=canvas.height;

      // Find which cell was tapped
      let hitIdx=-1;
      for(let idx=0;idx<CELL_COUNT;idx++){
        const {cx:gx,cy:gy,cw,ch}=getCellXY(idx,W,H);
        if(cx>=gx&&cx<gx+cw&&cy>=gy&&cy<gy+ch){ hitIdx=idx; break; }
      }
      if(hitIdx<0) return;

      s.sig.tapCount++;
      const now=Date.now();
      if(!s.plants.has(hitIdx)){
        // Plant a new seed
        const plant:Plant={
          cellIdx:hitIdx, growth:15, maxGrowth:100,
          lastTap:now, color:CELL_COLORS[hitIdx],
          wilt:false
        };
        s.plants.set(hitIdx,plant);
        s.sig.plantsGrown++; s.sig.streakCurrent++;
        if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
        s.sig.score+=1; sfx.click(); hapticScore();
        setScore(s.sig.score);
        s.particles.push({x:cx,y:cy,vx:(Math.random()-0.5)*2,vy:-2-Math.random()*2,alpha:1,color:CELL_COLORS[hitIdx]});
      } else {
        const plant=s.plants.get(hitIdx)!;
        plant.lastTap=now; plant.wilt=false;
        const wasBloom=plant.growth>=100;
        plant.growth=Math.min(100,plant.growth+15);
        if(plant.growth>=100&&!wasBloom){
          // Full bloom!
          s.sig.bloomedPlants++; s.sig.score+=3;
          sfx.success(); hapticCombo(3);
          setScore(s.sig.score);
          const {cx:gx,cy:gy,cw,ch}=getCellXY(hitIdx,W,H);
          for(let p=0;p<12;p++) s.bloomParticles.push({
            x:gx+cw/2, y:gy+ch/2,
            vx:(Math.random()-0.5)*8, vy:(Math.random()-0.5)*8,
            alpha:1, r:6, color:CELL_COLORS[hitIdx]
          });
        } else {
          s.sig.score+=1; sfx.collect(); hapticScore();
          setScore(s.sig.score);
          const {cx:gx,cy:gy,cw,ch}=getCellXY(hitIdx,W,H);
          s.particles.push({x:gx+cw/2,y:gy+ch/2,vx:(Math.random()-0.5)*3,vy:-2.5,alpha:1,color:CELL_COLORS[hitIdx]});
        }
      }
    };
    canvas.addEventListener('pointerdown',onPD);
    return()=>{ window.removeEventListener('resize',resize); canvas.removeEventListener('pointerdown',onPD); };
  },[phase]);

  useEffect(()=>()=>{ cancelAnimationFrame(animRef.current); if(timerRef.current) clearInterval(timerRef.current); },[]);

  const handleStart=useCallback(async(n:string,a:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,n,a); await initAudio(); setPhase('countdown');
  },[]);
  const handlePlayAgain=useCallback(()=>{ setPhase('start'); setScore(0); setTimeLeft(DURATION); setFinalSig(null); },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
        ctaLabel="Plant Your Garden 🌱" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}
            role="img" aria-label="Sound garden growing canvas"/>
          {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT}
            items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}
        </>
      )}
      {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
        score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[
          {label:'Bloomed',value:`${finalSig.bloomedPlants}`,color:'#fbbf24'},
          {label:'Planted',value:`${finalSig.plantsGrown}`,color:'#4ade80'},
          {label:'Garden Full',value:`${finalSig.gardenFullness}%`,color:ACCENT},
          {label:'Taps',value:`${finalSig.tapCount}`,color:'var(--color-text)'},
        ]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.bloomedPlants>=4}/>}
    </GameShell>
  );
}
