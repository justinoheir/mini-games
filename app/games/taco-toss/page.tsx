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

const GAME_ID    = 'taco-toss';
const ACCENT     = '#84cc16';
const DURATION   = 45;
const GAME_EMOJI = '🌮';
const GAME_TITLE = 'Taco Toss';
const GAME_TAGLINE = 'Catch the fillings. Build the taco!';

// Taco layers in correct order (bottom to top)
type Ingredient = 'tortilla'|'meat'|'cheese'|'lettuce'|'salsa';
const LAYER_ORDER: Ingredient[] = ['tortilla','meat','cheese','lettuce','salsa'];
const INGREDIENT_CONFIG: Record<Ingredient,{emoji:string;color:string}> = {
  tortilla: {emoji:'🫓', color:'#d97706'},
  meat:     {emoji:'🥩', color:'#92400e'},
  cheese:   {emoji:'🧀', color:'#fbbf24'},
  lettuce:  {emoji:'🥬', color:'#22c55e'},
  salsa:    {emoji:'🍅', color:'#ef4444'},
};

interface FallingIngredient {
  id:number; type:Ingredient; x:number; y:number; vy:number; r:number;
  caught:boolean; wrong:boolean; missed:boolean; flashT:number;
}

interface Signals {
  completedTacos: number;
  wrongOrder: number;
  ingredientsCaught: number;
  maxStreak: number;
  streakCurrent: number;
  score: number;
}

function getPersonality(s: Signals): string {
  if (s.completedTacos>=5&&s.wrongOrder===0) return 'Taco Perfectionist 🌟';
  if (s.completedTacos>=4)                   return 'Taco Master 🌮';
  if (s.wrongOrder>=6)                       return 'Freestyle Chef 🤪';
  if (s.completedTacos>=2)                   return 'Taco Apprentice 🍴';
  return 'First Fold 🫓';
}

type Phase = 'start'|'countdown'|'playing'|'done';
interface GS {
  running:boolean; timeLeft:number; sig:Signals; frame:number; accentColor:string;
  shellX:number; targetShellX:number;
  ingredients:FallingIngredient[]; nextId:number;
  currentLayerIdx:number; // which layer we're building (0-4)
  currentTacoLayers:Ingredient[];
  spawnTimer:number;
  tacoFlash:number;
  particles:Array<{x:number;y:number;vx:number;vy:number;alpha:number;color:string}>;
}

export default function TacoTossGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef(0);
  const timerRef  = useRef<ReturnType<typeof setInterval>|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{completedTacos:0,wrongOrder:0,ingredientsCaught:0,maxStreak:0,streakCurrent:0,score:0},
    frame:0,accentColor:ACCENT,
    shellX:200,targetShellX:200,ingredients:[],nextId:0,
    currentLayerIdx:0,currentTacoLayers:[],
    spawnTimer:0,tacoFlash:0,particles:[],
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
    setFinalSig({...s.sig}); setPhase('done'); hapticVictory();
  },[]);

  const startLoop = useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const s=stateRef.current; const W=canvas.width,H=canvas.height;
    s.running=true; s.timeLeft=DURATION; s.frame=0;
    s.sig={completedTacos:0,wrongOrder:0,ingredientsCaught:0,maxStreak:0,streakCurrent:0,score:0};
    s.shellX=W/2; s.targetShellX=W/2;
    s.ingredients=[]; s.nextId=0; s.currentLayerIdx=0; s.currentTacoLayers=[];
    s.spawnTimer=40; s.tacoFlash=0; s.particles=[];
    setScore(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current=setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if(s.timeLeft<=0){ sfx.fail(); endGame(); }
    },1000);

    const SHELL_W=70, SHELL_H=30, CATCH_Y_OFFSET=40;

    const loop=()=>{
      if(!s.running) return; s.frame++;
      const W=canvas.width,H=canvas.height;
      const SHELL_Y=H-70;

      // Fiesta background
      ctx.fillStyle='#1a0a00'; ctx.fillRect(0,0,W,H);
      // Colorful bunting
      const BUNTING=['#ef4444','#fbbf24','#22c55e','#84cc16','#f97316'];
      for(let i=0;i<8;i++){
        const bx1=i*(W/7); const bx2=(i+1)*(W/7);
        ctx.strokeStyle=BUNTING[i%BUNTING.length]; ctx.lineWidth=2;
        ctx.beginPath(); ctx.moveTo(bx1,0); ctx.lineTo(bx1+(bx2-bx1)/2,30); ctx.lineTo(bx2,0); ctx.stroke();
        ctx.fillStyle=BUNTING[i%BUNTING.length]+'88';
        ctx.beginPath(); ctx.moveTo(bx1,0); ctx.lineTo(bx1+(bx2-bx1)/2,30); ctx.lineTo(bx2,0); ctx.fill();
      }

      // Smooth shell movement
      s.shellX+=(s.targetShellX-s.shellX)*0.2;
      s.shellX=Math.max(50,Math.min(W-50,s.shellX));

      // Spawn ingredients
      s.spawnTimer--;
      if(s.spawnTimer<=0){
        s.spawnTimer=50+Math.random()*30;
        // Favor current needed ingredient (70%) or random (30%)
        let type:Ingredient;
        if(Math.random()<0.7&&s.currentLayerIdx<LAYER_ORDER.length){
          type=LAYER_ORDER[s.currentLayerIdx];
        } else {
          type=LAYER_ORDER[Math.floor(Math.random()*LAYER_ORDER.length)];
        }
        s.ingredients.push({id:s.nextId++, type, x:30+Math.random()*(W-60), y:-30,
          vy:2+Math.random()*2, r:22, caught:false, wrong:false, missed:false, flashT:0});
      }

      // Update ingredients
      for(let i=s.ingredients.length-1;i>=0;i--){
        const it=s.ingredients[i];
        if(it.caught||it.wrong||it.missed){ it.flashT++; if(it.flashT>25) s.ingredients.splice(i,1); continue; }
        it.y+=it.vy;
        const catchY=SHELL_Y-CATCH_Y_OFFSET;
        if(it.y>=catchY&&Math.abs(it.x-s.shellX)<=SHELL_W/2+it.r/2){
          const needed=LAYER_ORDER[s.currentLayerIdx];
          if(it.type===needed){
            it.caught=true; s.currentTacoLayers.push(it.type);
            s.sig.ingredientsCaught++; s.sig.streakCurrent++;
            if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
            sfx.collect(); hapticScore();
            s.currentLayerIdx++;
            if(s.currentLayerIdx>=LAYER_ORDER.length){
              // Taco complete!
              s.sig.completedTacos++; s.sig.score+=5;
              s.tacoFlash=40; sfx.success(); hapticCombo(5);
              if(s.sig.streakCurrent>=5) hapticCombo(s.sig.streakCurrent);
              s.currentLayerIdx=0; s.currentTacoLayers=[];
              setScore(s.sig.score);
              for(let p=0;p<16;p++) s.particles.push({
                x:s.shellX,y:SHELL_Y, vx:(Math.random()-0.5)*12, vy:-5-Math.random()*6,
                alpha:1, color:BUNTING[Math.floor(Math.random()*BUNTING.length)]
              });
            } else {
              s.sig.score+=1; setScore(s.sig.score);
            }
          } else {
            it.wrong=true; s.sig.wrongOrder++; s.sig.streakCurrent=0;
            sfx.collision(); hapticFail();
          }
        }
        if(it.y>H+10){ it.missed=true; }
      }

      // Particles
      for(let i=s.particles.length-1;i>=0;i--){
        const p=s.particles[i]; p.x+=p.vx; p.y+=p.vy; p.vy+=0.2; p.alpha*=0.92;
        if(p.alpha<0.02){ s.particles.splice(i,1); continue; }
        ctx.save(); ctx.globalAlpha=p.alpha; ctx.fillStyle=p.color;
        ctx.beginPath(); ctx.arc(p.x,p.y,4,0,Math.PI*2); ctx.fill(); ctx.restore();
      }

      // Draw ingredients
      s.ingredients.forEach(it=>{
        const cfg=INGREDIENT_CONFIG[it.type];
        ctx.save();
        if(it.wrong){ ctx.globalAlpha=1-it.flashT/25; ctx.shadowBlur=12; ctx.shadowColor='#ef4444'; }
        if(it.caught){ ctx.globalAlpha=1-it.flashT/25; ctx.shadowBlur=12; ctx.shadowColor='#4ade80'; }
        ctx.font=`${it.r*1.8}px sans-serif`; ctx.textAlign='center';
        ctx.fillText(cfg.emoji,it.x,it.y+it.r*0.6); ctx.restore();
      });

      // Draw taco shell + current layers
      const shellFlash=s.tacoFlash>0?(0.5+Math.sin(s.frame*0.5)*0.5):1;
      s.tacoFlash=Math.max(0,s.tacoFlash-1);
      ctx.save(); ctx.globalAlpha=shellFlash;
      // Shell
      ctx.fillStyle='#d97706';
      ctx.beginPath(); ctx.ellipse(s.shellX,SHELL_Y,SHELL_W/2,SHELL_H/2,0,0,Math.PI*2); ctx.fill();
      // Stack layers
      s.currentTacoLayers.forEach((type,i)=>{
        const cfg=INGREDIENT_CONFIG[type];
        ctx.font='20px sans-serif'; ctx.textAlign='center';
        ctx.fillText(cfg.emoji,s.shellX,SHELL_Y-(i+1)*18);
      });
      ctx.restore();

      // Next ingredient hint
      if(s.currentLayerIdx<LAYER_ORDER.length){
        const needed=LAYER_ORDER[s.currentLayerIdx]; const cfg=INGREDIENT_CONFIG[needed];
        const a=0.6+Math.sin(s.frame*0.2)*0.4;
        ctx.save(); ctx.globalAlpha=a; ctx.fillStyle='#fbbf24';
        ctx.font='bold 13px sans-serif'; ctx.textAlign='center';
        ctx.fillText(`Need: ${cfg.emoji}`,s.shellX,SHELL_Y-s.currentTacoLayers.length*18-25); ctx.restore();
      }

      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{ canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; };
    resize(); window.addEventListener('resize',resize);

    const onPM=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const s=stateRef.current;
      const rect=canvas.getBoundingClientRect();
      s.targetShellX=(e.clientX-rect.left)*(canvas.width/rect.width);
    };
    const onPD=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const s=stateRef.current;
      const rect=canvas.getBoundingClientRect();
      s.targetShellX=(e.clientX-rect.left)*(canvas.width/rect.width);
    };
    canvas.addEventListener('pointermove',onPM);
    canvas.addEventListener('pointerdown',onPD);
    return()=>{ window.removeEventListener('resize',resize);
      canvas.removeEventListener('pointermove',onPM); canvas.removeEventListener('pointerdown',onPD); };
  },[phase]);

  useEffect(()=>()=>{ cancelAnimationFrame(animRef.current); if(timerRef.current) clearInterval(timerRef.current); },[]);

  const handleStart=useCallback(async(n:string,a:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,n,a); await initAudio(); setPhase('countdown');
  },[]);
  const handlePlayAgain=useCallback(()=>{ setPhase('start'); setScore(0); setTimeLeft(DURATION); setFinalSig(null); },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
        ctaLabel="Build the Taco! 🌮" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}
            role="img" aria-label="Taco building game canvas"/>
          {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT}
            items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}
        </>
      )}
      {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
        score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[
          {label:'Tacos Built',value:`${finalSig.completedTacos}`,color:'#4ade80'},
          {label:'Wrong Order',value:`${finalSig.wrongOrder}`,color:finalSig.wrongOrder===0?'#4ade80':'#ef4444'},
          {label:'Ingredients',value:`${finalSig.ingredientsCaught}`,color:ACCENT},
          {label:'Best Streak',value:`×${finalSig.maxStreak}`,color:'#fbbf24'},
        ]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.completedTacos>=3}/>}
    </GameShell>
  );
}
