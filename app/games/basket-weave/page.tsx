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

const GAME_ID    = 'basket-weave';
const ACCENT     = '#d97706';
const DURATION   = 60;
const GAME_EMOJI = '🧺';
const GAME_TITLE = 'Basket Weave';
const GAME_TAGLINE = 'Over. Under. Don\'t drop a strand.';

// The weave pattern: alternate L/R taps in rhythm
// Strand = horizontal reed that must be tapped from left or right zone

type Side = 'left'|'right';

interface Strand {
  y: number;
  side: Side;      // correct next tap side
  tapped: boolean;
  wrong: boolean;
  alpha: number;
}

interface Signals {
  correctWeaves: number;
  mistakes: number;
  maxStreak: number;
  streakCurrent: number;
  basketProgress: number; // 0-100
  score: number;
}

function getPersonality(s: Signals): string {
  if (s.basketProgress>=90&&s.mistakes===0) return 'Master Weaver 🏆';
  if (s.correctWeaves>=30)                  return 'Reed Whisperer 🌾';
  if (s.mistakes>=10)                       return 'Tangled Fingers 🪢';
  if (s.maxStreak>=12)                      return 'Rhythm Weaver 🎵';
  return 'Apprentice Weaver 🧵';
}

type Phase = 'start'|'countdown'|'playing'|'done';
interface GS {
  running:boolean; timeLeft:number; sig:Signals; frame:number; accentColor:string;
  strands:Strand[]; nextSide:Side; spawnTimer:number; scrollY:number;
  weaveGrid:boolean[][]; gridW:number; gridH:number;
  tapFeedback:Array<{x:number;y:number;ok:boolean;alpha:number}>;
}

export default function BasketWeaveGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef(0);
  const timerRef  = useRef<ReturnType<typeof setInterval>|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{correctWeaves:0,mistakes:0,maxStreak:0,streakCurrent:0,basketProgress:0,score:0},
    frame:0,accentColor:ACCENT,
    strands:[],nextSide:'left',spawnTimer:0,scrollY:0,
    weaveGrid:Array.from({length:20},()=>Array(10).fill(false)),
    gridW:10,gridH:20,tapFeedback:[],
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
    s.sig.basketProgress=Math.min(100,Math.round(s.sig.correctWeaves/30*100));
    setFinalSig({...s.sig}); setPhase('done'); hapticVictory();
  },[]);

  const startLoop = useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const s=stateRef.current; const W=canvas.width,H=canvas.height;
    s.running=true; s.timeLeft=DURATION; s.frame=0; s.nextSide='left';
    s.sig={correctWeaves:0,mistakes:0,maxStreak:0,streakCurrent:0,basketProgress:0,score:0};
    s.strands=[]; s.spawnTimer=0; s.scrollY=0; s.tapFeedback=[];
    setScore(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current=setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if(s.timeLeft<=0){ sfx.fail(); endGame(); }
    },1000);

    const STRAND_H=40;
    const COLORS_L=['#d97706','#b45309','#92400e','#fbbf24','#a16207'];
    const COLORS_R=['#78350f','#dc8a1e','#e6a623','#c87d18','#f0aa3a'];

    const loop=()=>{
      if(!s.running) return; s.frame++;
      const W=canvas.width,H=canvas.height;
      const HIT_ZONE_H=80; // active strand zone from bottom
      const WARP_W=W*0.1; // left/right tap zones

      // Wicker/tan background
      ctx.fillStyle='#2d1a00'; ctx.fillRect(0,0,W,H);
      // Basket weave background texture
      for(let gy=0;gy<H;gy+=20){
        for(let gx=0;gx<W;gx+=20){
          const c=(Math.floor(gy/20)+Math.floor(gx/20))%2===0?'#3d2a0a':'#2d1a00';
          ctx.fillStyle=c; ctx.fillRect(gx,gy,20,20);
        }
      }

      // Left/Right tap zones
      const leftActive=s.nextSide==='left';
      ctx.save(); ctx.globalAlpha=0.3+Math.sin(s.frame*0.2)*0.1;
      ctx.fillStyle=leftActive?'#d97706':'rgba(100,60,0,0.3)';
      ctx.fillRect(0,H-HIT_ZONE_H,WARP_W*1.5,HIT_ZONE_H);
      ctx.fillStyle=!leftActive?'#d97706':'rgba(100,60,0,0.3)';
      ctx.fillRect(W-WARP_W*1.5,H-HIT_ZONE_H,WARP_W*1.5,HIT_ZONE_H);
      ctx.restore();
      // Zone labels
      ctx.fillStyle='rgba(255,200,100,0.7)'; ctx.font='bold 14px sans-serif'; ctx.textAlign='center';
      ctx.fillText(leftActive?'◀ HERE':'◀',WARP_W*0.75,H-30);
      ctx.fillText(!leftActive?'HERE ▶':'▶',W-WARP_W*0.75,H-30);

      // Spawn strands
      s.spawnTimer++; s.scrollY+=0.5;
      if(s.spawnTimer>=35){
        s.spawnTimer=0;
        const side:Side=s.nextSide; // alternating
        s.strands.push({ y:-10, side, tapped:false, wrong:false, alpha:1 });
      }

      // Update strands
      for(let i=s.strands.length-1;i>=0;i--){
        const st=s.strands[i]; st.y+=1.8;
        if(st.y>H+10){ s.strands.splice(i,1); continue; }
        if(!st.tapped&&!st.wrong&&st.y>H-HIT_ZONE_H&&st.y<H){
          // Missed window passes
        }
        if(st.tapped||st.wrong){ st.alpha-=0.04; if(st.alpha<0) s.strands.splice(i,1); }
      }

      // Draw strands (horizontal reeds)
      s.strands.forEach((st,i)=>{
        ctx.save(); ctx.globalAlpha=st.alpha;
        const isLeft=st.side==='left';
        const baseColor=isLeft?COLORS_L[i%COLORS_L.length]:COLORS_R[i%COLORS_R.length];
        // Over/under weave pattern
        const overUnder=i%2===0;
        ctx.strokeStyle=baseColor; ctx.lineWidth=STRAND_H*0.6;
        ctx.lineCap='round';
        // Draw reed
        ctx.beginPath();
        if(overUnder){
          ctx.moveTo(isLeft?-10:W+10,st.y);
          ctx.lineTo(isLeft?W*0.6:W*0.4,st.y);
        } else {
          ctx.moveTo(isLeft?0:W,st.y);
          ctx.lineTo(isLeft?W*0.4:W*0.6,st.y);
        }
        ctx.stroke();
        // Highlight active strand
        if(!st.tapped&&!st.wrong&&st.y>H-HIT_ZONE_H-20){
          ctx.shadowBlur=15; ctx.shadowColor=ACCENT;
          ctx.strokeStyle='#fbbf24'; ctx.lineWidth=2;
          ctx.beginPath(); ctx.moveTo(0,st.y); ctx.lineTo(W,st.y); ctx.stroke();
        }
        ctx.restore();
      });

      // Tap feedback
      for(let i=s.tapFeedback.length-1;i>=0;i--){
        const f=s.tapFeedback[i]; f.alpha-=0.05;
        if(f.alpha<=0){ s.tapFeedback.splice(i,1); continue; }
        ctx.save(); ctx.globalAlpha=f.alpha;
        ctx.fillStyle=f.ok?'#4ade80':'#ef4444';
        ctx.font='bold 20px sans-serif'; ctx.textAlign='center';
        ctx.fillText(f.ok?'✓':'✗',f.x,f.y); ctx.restore();
      }

      // Progress indicator
      const prog=Math.min(1,s.sig.correctWeaves/30);
      ctx.fillStyle='rgba(255,200,100,0.2)'; ctx.fillRect(0,H-4,W,4);
      ctx.fillStyle=ACCENT; ctx.fillRect(0,H-4,W*prog,4);

      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  const handleTap = useCallback((cx:number,_cy:number,canvas:HTMLCanvasElement)=>{
    const s=stateRef.current; if(!s.running) return;
    const W=canvas.width;
    const side:Side=cx<W/2?'left':'right';
    // Find the lowest strand in hit zone
    const HIT_ZONE_H=80;
    const H=canvas.height;
    let best:typeof s.strands[0]|null=null;
    for(const st of s.strands){
      if(st.tapped||st.wrong) continue;
      if(st.y>H-HIT_ZONE_H&&st.y<H){
        if(!best||st.y>best.y) best=st;
      }
    }
    const feedX=side==='left'?W*0.15:W*0.85;
    const feedY=H-50;
    if(!best) return;
    if(best.side===side){
      best.tapped=true;
      s.sig.correctWeaves++; s.sig.streakCurrent++;
      if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
      const pts=s.sig.streakCurrent>=4?2:1; s.sig.score+=pts;
      sfx.collect(); hapticScore();
      if(s.sig.streakCurrent>=4) hapticCombo(s.sig.streakCurrent);
      s.nextSide=side==='left'?'right':'left';
      setScore(s.sig.score);
      s.tapFeedback.push({x:feedX,y:feedY,ok:true,alpha:1});
    } else {
      best.wrong=true; s.sig.mistakes++; s.sig.streakCurrent=0;
      sfx.collision(); hapticFail();
      s.tapFeedback.push({x:feedX,y:feedY,ok:false,alpha:1});
    }
  },[]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{ canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; };
    resize(); window.addEventListener('resize',resize);

    const onPD=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const rect=canvas.getBoundingClientRect();
      const cx=(e.clientX-rect.left)*(canvas.width/rect.width);
      const cy=(e.clientY-rect.top)*(canvas.height/rect.height);
      handleTap(cx,cy,canvas);
    };
    canvas.addEventListener('pointerdown',onPD);
    return()=>{ window.removeEventListener('resize',resize); canvas.removeEventListener('pointerdown',onPD); };
  },[phase,handleTap]);

  useEffect(()=>()=>{ cancelAnimationFrame(animRef.current); if(timerRef.current) clearInterval(timerRef.current); },[]);

  const handleStart=useCallback(async(n:string,a:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,n,a); await initAudio(); setPhase('countdown');
  },[]);
  const handlePlayAgain=useCallback(()=>{ setPhase('start'); setScore(0); setTimeLeft(DURATION); setFinalSig(null); },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
        ctaLabel="Start Weaving 🧺" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}
            role="img" aria-label="Basket weaving game canvas"/>
          {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT}
            items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}
        </>
      )}
      {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
        score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[
          {label:'Correct Weaves',value:`${finalSig.correctWeaves}`,color:'#4ade80'},
          {label:'Mistakes',value:`${finalSig.mistakes}`,color:finalSig.mistakes===0?'#4ade80':'#ef4444'},
          {label:'Best Streak',value:`×${finalSig.maxStreak}`,color:ACCENT},
          {label:'Basket',value:`${finalSig.basketProgress}%`,color:'#fbbf24'},
        ]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.correctWeaves>=20}/>}
    </GameShell>
  );
}
