'use client';
/**
 * BEAT BOX — Scrolling 4-lane rhythm game. Tap tiles exactly in rhythm. BPM escalates.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, playScoreHit, playVictoryFanfare } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { spawnBurst, updateAndDrawParticles, Particle } from '@/lib/particles';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';

const GAME_ID  = 'beat-box';
const PB_KEY   = 'mg_pb_beat-box';
const ACCENT   = '#f97316';
const DURATION = 60;
const GAME_EMOJI  = '🥁';
const GAME_TITLE  = 'Beat Box';
const GAME_TAGLINE = "Tap the tiles in rhythm. Don't miss a beat.";

const NUM_LANES   = 4;
const LANE_COLORS = ['#f97316', '#06b6d4', '#a855f7', '#22c55e'];
const LANE_LABELS = ['🟠', '🔵', '🟣', '🟢'];
const HIT_X_RATIO  = 0.22;
const HIT_WIN_MS   = 220;
const PERFECT_MS   = 85;
const BUTTON_H     = 76;
const TILE_W       = 56;

function hexRgb(hex: string) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

interface Tile { lane:number; x:number; speed:number; hit:boolean; missed:boolean; }
interface Signals {
  score: number; hits: number; perfectHits: number; misses: number; maxStreak: number;
}
function getPersonality(s: Signals): string {
  const acc = (s.hits + s.misses) > 0 ? s.hits / (s.hits + s.misses) : 0;
  if (acc >= 0.85 && s.perfectHits >= 10) return 'Human Drum Machine 🥁';
  if (acc >= 0.70) return 'Groove Master 🎵';
  if (acc >= 0.50) return 'Off-Beat Rapper 🎤';
  return 'Just Vibing 😎';
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  tiles: Tile[]; particles: Particle[];
  lastBeatMs: number; beatInterval: number; streak: number;
  flashLane: number; flashAlpha: number;
  tapFeedback: { lane:number; perfect:boolean; ts:number } | null;
  missFlash: number; accentColor: string;
}
type Phase = 'start'|'countdown'|'playing'|'done';

export default function BeatBoxGame() {
  const theme   = useBrandTheme();
  const accent  = theme.colors.accent ?? ACCENT;
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const animRef     = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef= useRef<(()=>void)|null>(null);
  const resizeRef   = useRef<(()=>void)|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const stateRef = useRef<GS>({
    running:false, timeLeft:DURATION,
    sig:{score:0,hits:0,perfectHits:0,misses:0,maxStreak:0},
    tiles:[], particles:[],
    lastBeatMs:0, beatInterval:750, streak:0,
    flashLane:-1, flashAlpha:0,
    tapFeedback:null, missFlash:0, accentColor:ACCENT,
  });

  const [phase,      setPhase]      = useState<Phase>('start');
  const [timeLeft,   setTimeLeft]   = useState(DURATION);
  const [scoreDisp,  setScoreDisp]  = useState(0);
  const [streakDisp, setStreakDisp] = useState(0);
  const [finalSig,   setFinalSig]   = useState<Signals|null>(null);
  const [isNewBest,  setIsNewBest]  = useState(false);
  const { pops, triggerPop } = useScorePop();
  const prevScore = useRef(0);

  useEffect(()=>{ stateRef.current.accentColor = accent; },[accent]);
  useEffect(()=>{
    if(scoreDisp > prevScore.current) triggerPop(`+${scoreDisp-prevScore.current}`, window.innerWidth/2, 200);
    prevScore.current = scoreDisp;
  },[scoreDisp,triggerPop]);

  const getBeatInterval = (tl:number) => tl>40 ? 750 : tl>20 ? 600 : 500;

  const endGame = useCallback(()=>{
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    sfx.success(); hapticVictory(); playVictoryFanfare();
    try{
      const prev = parseInt(localStorage.getItem(PB_KEY)||'0',10);
      if(s.sig.score > prev){ localStorage.setItem(PB_KEY,String(s.sig.score)); setIsNewBest(true); }
    }catch{/**/}
    setFinalSig({...s.sig});
    setPhase('done');
  },[]);

  const handleLaneTap = useCallback((lane:number)=>{
    const s = stateRef.current;
    if(!s.running) return;
    const hitX = window.innerWidth * HIT_X_RATIO;
    let best:Tile|null=null, bestDist=Infinity;
    for(const t of s.tiles){
      if(t.lane!==lane||t.hit||t.missed) continue;
      const d = Math.abs(t.x - hitX);
      const win = t.speed * HIT_WIN_MS;
      if(d < win && d < bestDist){ bestDist=d; best=t; }
    }
    if(best){
      best.hit = true;
      s.streak++;
      if(s.streak > s.sig.maxStreak) s.sig.maxStreak=s.streak;
      const perfect = bestDist < best.speed * PERFECT_MS;
      const pts = perfect ? 20 : 10;
      const mult = s.streak>=10 ? 2 : s.streak>=5 ? 1.5 : 1;
      const earned = Math.round(pts*mult);
      s.sig.score += earned; s.sig.hits++; if(perfect) s.sig.perfectHits++;
      s.tapFeedback = {lane, perfect, ts:performance.now()};
      s.flashLane=lane; s.flashAlpha=0.9;
      const H=window.innerHeight; const laneH=(H-60-BUTTON_H)/NUM_LANES;
      spawnBurst(s.particles, hitX, 60+(lane+0.5)*laneH, LANE_COLORS[lane], 12, 4);
      hapticScore(); sfx.collect(); playScoreHit('default',earned);
      setScoreDisp(s.sig.score); setStreakDisp(s.streak);
    } else {
      sfx.collision(); hapticFail();
    }
  },[]);

  const startLoop = useCallback(()=>{
    const canvas = canvasRef.current; if(!canvas) return;
    const ctx = canvas.getContext('2d'); if(!ctx) return;
    const s = stateRef.current;

    const resize=()=>{
      const dpr=window.devicePixelRatio||1, w=window.innerWidth, h=window.innerHeight;
      canvas.style.width=w+'px'; canvas.style.height=h+'px';
      canvas.width=w*dpr; canvas.height=h*dpr;
      ctx.setTransform(dpr,0,0,dpr,0,0);
    };
    resize(); window.addEventListener('resize',resize); resizeRef.current=()=>window.removeEventListener('resize',resize);

    s.running=true; s.timeLeft=DURATION;
    s.sig={score:0,hits:0,perfectHits:0,misses:0,maxStreak:0};
    s.tiles=[]; s.particles=[]; s.lastBeatMs=performance.now(); s.beatInterval=750;
    s.streak=0; s.flashLane=-1; s.flashAlpha=0; s.tapFeedback=null; s.missFlash=0;
    setScoreDisp(0); setTimeLeft(DURATION); setStreakDisp(0); setPhase('playing');
    stopMusicRef.current = startMusic('pulse');

    timerRef.current = setInterval(()=>{
      s.timeLeft--; s.beatInterval=getBeatInterval(s.timeLeft);
      setTimeLeft(s.timeLeft); sfx.tick();
      if(s.timeLeft===10) sfx.warning();
      if(s.timeLeft<=0) endGame();
    },1000);

    let lastTs = performance.now();
    const loop=(ts:number)=>{
      if(!s.running) return;
      const dt = ts - lastTs; lastTs=ts;
      const W=window.innerWidth, H=window.innerHeight;
      const hitX=W*HIT_X_RATIO;
      const laneAreaH=H-60-BUTTON_H, laneH=laneAreaH/NUM_LANES;

      // Spawn tiles on beat
      if(ts - s.lastBeatMs >= s.beatInterval){
        s.lastBeatMs = ts;
        const count = Math.random()<0.3?2:1;
        const used=new Set<number>();
        for(let i=0;i<count;i++){
          let lane:number; do{ lane=Math.floor(Math.random()*NUM_LANES); }while(used.has(lane));
          used.add(lane);
          const travelMs = s.beatInterval * 2.5;
          const spd = (W - hitX) / travelMs;
          s.tiles.push({ lane, x:W+TILE_W/2, speed:spd, hit:false, missed:false });
        }
      }

      // Move tiles
      for(const t of s.tiles){
        t.x -= t.speed * dt;
        if(!t.hit && !t.missed && t.x < hitX - t.speed*HIT_WIN_MS){
          t.missed=true; s.sig.misses++; s.streak=0; setStreakDisp(0);
          s.missFlash=0.55; sfx.collision(); hapticFail();
        }
      }
      s.tiles = s.tiles.filter(t=>t.x > -TILE_W-10);
      s.flashAlpha = Math.max(0,s.flashAlpha-0.05);
      s.missFlash  = Math.max(0,s.missFlash-0.025);
      if(s.tapFeedback && ts-s.tapFeedback.ts>350) s.tapFeedback=null;

      // --- RENDER ---
      ctx.clearRect(0,0,W,H);
      ctx.fillStyle='#080408'; ctx.fillRect(0,0,W,H);

      // Lanes
      for(let i=0;i<NUM_LANES;i++){
        const lY=60+i*laneH, c=LANE_COLORS[i];
        ctx.fillStyle=`rgba(${hexRgb(c)},0.04)`; ctx.fillRect(0,lY,W,laneH);
        if(i>0){ ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,lY); ctx.lineTo(W,lY); ctx.stroke(); }
        if(s.flashLane===i&&s.flashAlpha>0){ ctx.fillStyle=`rgba(${hexRgb(c)},${s.flashAlpha*0.18})`; ctx.fillRect(0,lY,W,laneH); }
      }

      // Hit zone line
      ctx.save();
      ctx.strokeStyle=`rgba(255,255,255,${0.35+Math.sin(ts*0.003)*0.08})`;
      ctx.lineWidth=2; ctx.shadowBlur=12; ctx.shadowColor='rgba(255,255,255,0.4)';
      ctx.beginPath(); ctx.moveTo(hitX,60); ctx.lineTo(hitX,60+laneAreaH); ctx.stroke();
      ctx.restore();

      // Hit zone circles
      for(let i=0;i<NUM_LANES;i++){
        const cy=60+(i+0.5)*laneH, c=LANE_COLORS[i];
        ctx.beginPath(); ctx.arc(hitX,cy,14,0,Math.PI*2);
        ctx.fillStyle=`rgba(${hexRgb(c)},0.12)`; ctx.fill();
        ctx.strokeStyle=`rgba(${hexRgb(c)},0.45)`; ctx.lineWidth=1.5; ctx.stroke();
      }

      // Tiles
      for(const t of s.tiles){
        if(t.hit && t.x<hitX-20) continue;
        const lY=60+t.lane*laneH; const tH=laneH*0.65;
        const tY=lY+(laneH-tH)/2; const c=LANE_COLORS[t.lane];
        const inZone=!t.hit&&!t.missed&&Math.abs(t.x-hitX)<t.speed*HIT_WIN_MS;
        ctx.save();
        if(inZone){ ctx.shadowBlur=18; ctx.shadowColor=c; }
        if(t.hit) ctx.globalAlpha=0.25;
        ctx.fillStyle=t.missed?'rgba(80,80,80,0.35)':c;
        ctx.beginPath(); ctx.roundRect(t.x-TILE_W/2,tY,TILE_W,tH,9); ctx.fill();
        if(!t.hit&&!t.missed){ ctx.fillStyle='rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.roundRect(t.x-TILE_W/2+4,tY+3,TILE_W-8,tH*0.28,4); ctx.fill(); }
        ctx.restore();
      }

      // Miss flash
      if(s.missFlash>0){ ctx.fillStyle=`rgba(239,68,68,${s.missFlash*0.22})`; ctx.fillRect(0,0,W,H); }

      // Tap feedback
      if(s.tapFeedback){
        const lY=60+s.tapFeedback.lane*laneH+laneH*0.28;
        const alpha=Math.max(0,1-(ts-s.tapFeedback.ts)/350);
        ctx.font='bold 18px "Space Grotesk",sans-serif'; ctx.textAlign='center';
        ctx.fillStyle=s.tapFeedback.perfect?`rgba(255,220,0,${alpha})`:`rgba(255,255,255,${alpha})`;
        if(s.tapFeedback.perfect){ctx.shadowBlur=14;ctx.shadowColor='rgba(255,220,0,0.7)';}
        ctx.fillText(s.tapFeedback.perfect?'PERFECT!':'HIT!',hitX+55,lY);
        ctx.shadowBlur=0; ctx.textAlign='left';
      }

      // BPM label
      const bpm=s.timeLeft>40?80:s.timeLeft>20?100:120;
      ctx.fillStyle='rgba(255,255,255,0.22)'; ctx.font='11px "Space Grotesk",sans-serif';
      ctx.textAlign='right'; ctx.fillText(`${bpm} BPM`,W-10,H-BUTTON_H-6); ctx.textAlign='left';

      updateAndDrawParticles(ctx,s.particles);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  },[endGame]);

  useEffect(()=>()=>{
    cancelAnimationFrame(animRef.current);
    if(timerRef.current) clearInterval(timerRef.current);
    if(stopMusicRef.current) stopMusicRef.current();
    if(resizeRef.current) resizeRef.current();
  },[]);

  const handleStart = useCallback((name:string,avatar:string)=>{
    playerSessionRef.current = savePlayerSession(GAME_ID,name,avatar);
    initAudio(); sfx.click(); setPhase('countdown');
  },[]);

  const handlePlayAgain = useCallback(()=>{
    setPhase('start'); setScoreDisp(0); setTimeLeft(DURATION);
    setFinalSig(null); setIsNewBest(false); setStreakDisp(0); prevScore.current=0;
  },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg,#0a0408 0%,#0d0510 100%)">

      {phase==='start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start Beatboxing →" accentColor={accent} onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%,#1a0808 0%,#0d0510 55%,#060308 100%)" />
      )}
      {phase==='countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}

      {(phase==='playing'||phase==='countdown') && (
        <>
          <canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} />
          {phase==='playing' && (
            <>
              <GameHUD accentColor={accent} items={[
                {label:'TIME',value:timeLeft,danger:timeLeft<=10,testId:'timer'},
                {label:'SCORE',value:scoreDisp,testId:'score'},
              ]}/>
              <div style={{position:'absolute',bottom:0,left:0,right:0,height:BUTTON_H,display:'flex',zIndex:10}}>
                {LANE_COLORS.map((col,i)=>(
                  <button key={i} onPointerDown={()=>handleLaneTap(i)}
                    style={{flex:1,height:'100%',border:'none',cursor:'pointer',
                      background:`rgba(${hexRgb(col)},0.15)`,
                      borderTop:`2.5px solid rgba(${hexRgb(col)},0.45)`,
                      borderRight:i<3?'1px solid rgba(255,255,255,0.08)':'none',
                      fontSize:26,touchAction:'none'}}
                    aria-label={`Tap lane ${i+1}`}>
                    {LANE_LABELS[i]}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {phase==='done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            {label:'Tiles Hit',   value:`${finalSig.hits}`,        color:'#22c55e'},
            {label:'Perfects',    value:`${finalSig.perfectHits}`, color:'#fbbf24'},
            {label:'Misses',      value:`${finalSig.misses}`,      color:'#ef4444'},
            {label:'Best Streak', value:`${finalSig.maxStreak}x`,  color:accent},
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.hits>=10} />
      )}
      {phase==='done' && finalSig && <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />}

      {phase==='playing' && <>
        <ScorePopEffect pops={pops} accentColor={accent} />
        <StreakBadge streak={streakDisp} accentColor={accent} />
      </>}

      <AnimatePresence>
        {isNewBest && (
          <motion.div key="pb"
            initial={{opacity:0,y:-20,scale:0.8}} animate={{opacity:1,y:0,scale:1}}
            exit={{opacity:0,y:-20}} transition={{duration:0.4,delay:0.5}}
            style={{position:'fixed',top:'10%',left:'50%',transform:'translateX(-50%)',zIndex:90,
              pointerEvents:'none',background:'linear-gradient(135deg,#fbbf24,#f59e0b)',
              borderRadius:20,padding:'8px 20px',fontSize:20,fontWeight:900,color:'#000',
              whiteSpace:'nowrap',boxShadow:'0 4px 20px rgba(251,191,36,0.5)'}}>
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }:{
  theme:ReturnType<typeof useBrandTheme>; sig:Signals; personality:string; player:PlayerSession|null;
}) {
  const fired = useRef(false);
  useEffect(()=>{
    if(fired.current) return; fired.current=true;
    postWebhook(theme,GAME_ID,{personality,score:sig.score,hits:sig.hits,misses:sig.misses,perfectHits:sig.perfectHits,maxStreak:sig.maxStreak},player);
  },[theme,sig,personality,player]);
  return null;
}
