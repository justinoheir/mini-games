'use client';
/**
 * ECHO MATCH — Simon Says with colored tiles and tones. Listen, then repeat.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, playVictoryFanfare } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { spawnBurst, updateAndDrawParticles, Particle } from '@/lib/particles';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';

const GAME_ID  = 'echo-match';
const PB_KEY   = 'mg_pb_echo-match';
const ACCENT   = '#06b6d4';
const DURATION = 45;
const GAME_EMOJI  = '🎶';
const GAME_TITLE  = 'Echo Match';
const GAME_TAGLINE = 'Watch the sequence. Repeat it perfectly.';

const TILE_COLORS  = ['#ef4444','#06b6d4','#a855f7','#22c55e'];
const TILE_EMOJIS  = ['🔴','🔵','🟣','🟢'];
const TILE_FREQS   = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
const LIT_DURATION = 480; // ms tile stays lit
const LIT_GAP      = 220; // ms between tiles in sequence
const MIN_SEQ_LEN  = 3;

interface Signals {
  score: number; rounds: number; longestSeq: number;
  correctTaps: number; wrongTaps: number;
}
function getPersonality(s: Signals): string {
  if (s.rounds >= 5 && s.wrongTaps === 0) return 'Perfect Memory 🧠';
  if (s.rounds >= 4) return 'Sharp Listener 👂';
  if (s.rounds >= 2) return 'Getting Warmer 🌡️';
  return 'Learning the Beat 🎵';
}

type SubPhase = 'watching'|'repeating'|'correct'|'wrong';
type Phase = 'start'|'countdown'|'playing'|'done';

export default function EchoMatchGame() {
  const theme  = useBrandTheme();
  const accent = theme.colors.accent ?? ACCENT;
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const animRef        = useRef(0);
  const timerRef       = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef   = useRef<(()=>void)|null>(null);
  const audioCtxRef    = useRef<AudioContext|null>(null);
  const cancelledRef   = useRef(false);
  const playerSessionRef = useRef<PlayerSession|null>(null);
  const resizeRef      = useRef<(()=>void)|null>(null);

  // Mutable game state (not re-render triggers)
  const sigRef    = useRef<Signals>({score:0,rounds:0,longestSeq:0,correctTaps:0,wrongTaps:0});
  const seqRef    = useRef<number[]>([]);
  const progRef   = useRef(0); // player input progress index
  const timeRef   = useRef(DURATION);
  const particlesRef = useRef<Particle[]>([]);

  const [phase,      setPhase]      = useState<Phase>('start');
  const [timeLeft,   setTimeLeft]   = useState(DURATION);
  const [scoreDisp,  setScoreDisp]  = useState(0);
  const [streakDisp, setStreakDisp] = useState(0);
  const [subPhase,   setSubPhase]   = useState<SubPhase>('watching');
  const [litTile,    setLitTile]    = useState(-1);
  const [wrongFlash, setWrongFlash] = useState(false);
  const [finalSig,   setFinalSig]   = useState<Signals|null>(null);
  const [isNewBest,  setIsNewBest]  = useState(false);
  const { pops, triggerPop } = useScorePop();
  const prevScore = useRef(0);

  useEffect(()=>{
    if(scoreDisp>prevScore.current) triggerPop(`+${scoreDisp-prevScore.current}`,window.innerWidth/2,200);
    prevScore.current=scoreDisp;
  },[scoreDisp,triggerPop]);

  const playTone = useCallback((tileIdx:number)=>{
    try{
      const ctx = audioCtxRef.current ?? new AudioContext();
      audioCtxRef.current=ctx;
      const osc=ctx.createOscillator(), gain=ctx.createGain();
      osc.type='sine'; osc.frequency.value=TILE_FREQS[tileIdx];
      gain.gain.setValueAtTime(0.38,ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.45);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime+0.45);
    }catch{/**/}
  },[]);

  const endGame = useCallback(()=>{
    const s=sigRef.current;
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    cancelledRef.current=true;
    sfx.success(); hapticVictory(); playVictoryFanfare();
    try{
      const prev=parseInt(localStorage.getItem(PB_KEY)||'0',10);
      if(s.score>prev){localStorage.setItem(PB_KEY,String(s.score));setIsNewBest(true);}
    }catch{/**/}
    setFinalSig({...s});
    cancelAnimationFrame(animRef.current);
    setPhase('done');
  },[]);

  // Play a sequence of tiles (with gap + lit duration)
  const playSequence = useCallback(async (seq:number[])=>{
    setSubPhase('watching');
    setLitTile(-1);
    for(let i=0;i<seq.length;i++){
      if(cancelledRef.current) return;
      await new Promise<void>(r=>setTimeout(r,LIT_GAP));
      if(cancelledRef.current) return;
      setLitTile(seq[i]);
      playTone(seq[i]);
      await new Promise<void>(r=>setTimeout(r,LIT_DURATION));
      if(cancelledRef.current) return;
      setLitTile(-1);
    }
    await new Promise<void>(r=>setTimeout(r,200));
    if(cancelledRef.current) return;
    progRef.current=0;
    setSubPhase('repeating');
  },[playTone]);

  const startRound = useCallback((seqLen:number)=>{
    const seq=[];
    for(let i=0;i<seqLen;i++) seq.push(Math.floor(Math.random()*4));
    seqRef.current=seq;
    void playSequence(seq);
  },[playSequence]);

  const handleTileTap = useCallback((tileIdx:number)=>{
    if(subPhase!=='repeating') return;
    const seq=seqRef.current; const prog=progRef.current;
    if(prog>=seq.length) return;
    setLitTile(tileIdx); playTone(tileIdx);
    setTimeout(()=>setLitTile(-1),200);

    if(seq[prog]===tileIdx){
      // Correct tap
      hapticScore(); sfx.collect();
      const s=sigRef.current; s.correctTaps++;
      s.score += 10;
      setScoreDisp(s.score);
      setStreakDisp(s.correctTaps);
      progRef.current = prog+1;
      if(progRef.current >= seq.length){
        // Completed round
        s.rounds++; s.score+=30; // bonus
        if(seq.length > s.longestSeq) s.longestSeq=seq.length;
        setScoreDisp(s.score);
        setSubPhase('correct');
        hapticVictory(); sfx.success();
        setTimeout(()=>{
          if(cancelledRef.current) return;
          const nextLen = Math.min(MIN_SEQ_LEN + s.rounds, 8);
          startRound(nextLen);
        },700);
      }
    } else {
      // Wrong tap
      hapticFail(); sfx.collision();
      sigRef.current.wrongTaps++;
      setWrongFlash(true);
      setSubPhase('wrong');
      setTimeout(()=>setWrongFlash(false),500);
      // Replay same sequence
      setTimeout(()=>{
        if(cancelledRef.current) return;
        void playSequence(seq);
      },700);
    }
  },[subPhase, playTone, startRound, playSequence]);

  // Canvas background rendering
  const startLoop = useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const resize=()=>{
      const dpr=window.devicePixelRatio||1,w=window.innerWidth,h=window.innerHeight;
      canvas.style.width=w+'px'; canvas.style.height=h+'px';
      canvas.width=w*dpr; canvas.height=h*dpr; ctx.setTransform(dpr,0,0,dpr,0,0);
    };
    resize(); window.addEventListener('resize',resize); resizeRef.current=()=>window.removeEventListener('resize',resize);

    const loop=(ts:number)=>{
      const W=window.innerWidth,H=window.innerHeight;
      ctx.fillStyle='#010a0e'; ctx.fillRect(0,0,W,H);
      // subtle pulsing grid
      ctx.strokeStyle='rgba(6,182,212,0.04)'; ctx.lineWidth=1;
      const gSize=40;
      for(let x=0;x<W;x+=gSize){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
      for(let y=0;y<H;y+=gSize){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
      updateAndDrawParticles(ctx,particlesRef.current);
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[]);

  const beginGame = useCallback(()=>{
    cancelledRef.current=false;
    sigRef.current={score:0,rounds:0,longestSeq:0,correctTaps:0,wrongTaps:0};
    particlesRef.current=[];
    timeRef.current=DURATION;
    setScoreDisp(0); setTimeLeft(DURATION); setStreakDisp(0); setPhase('playing');
    stopMusicRef.current=startMusic('calm');
    timerRef.current=setInterval(()=>{
      timeRef.current--;
      setTimeLeft(timeRef.current);
      sfx.tick();
      if(timeRef.current===10) sfx.warning();
      if(timeRef.current<=0) endGame();
    },1000);
    startLoop();
    setTimeout(()=>{ if(!cancelledRef.current) startRound(MIN_SEQ_LEN); },300);
  },[endGame,startLoop,startRound]);

  useEffect(()=>()=>{
    cancelledRef.current=true;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current) clearInterval(timerRef.current);
    if(stopMusicRef.current) stopMusicRef.current();
    if(resizeRef.current) resizeRef.current();
    if(audioCtxRef.current) audioCtxRef.current.close().catch(()=>{});
  },[]);

  const handleStart=useCallback((name:string,avatar:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);
    initAudio(); sfx.click(); setPhase('countdown');
  },[]);

  const handlePlayAgain=useCallback(()=>{
    cancelledRef.current=true;
    setPhase('start'); setScoreDisp(0); setTimeLeft(DURATION);
    setFinalSig(null); setIsNewBest(false); setStreakDisp(0);
    setLitTile(-1); setSubPhase('watching'); setWrongFlash(false);
    prevScore.current=0;
  },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 30%,rgba(6,182,212,0.1) 0%,transparent 55%),linear-gradient(180deg,#010a0e 0%,#020d12 100%)">

      {phase==='start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start Matching →" accentColor={accent} onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%,#011018 0%,#010d14 55%,#010810 100%)" />
      )}
      {phase==='countdown' && <Countdown onComplete={beginGame} accentColor={accent} />}

      {(phase==='playing'||phase==='countdown') && (
        <div style={{position:'absolute',inset:0}}>
          <canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} />

          {phase==='playing' && <>
            <GameHUD accentColor={accent} items={[
              {label:'TIME',value:timeLeft,danger:timeLeft<=10,testId:'timer'},
              {label:'SCORE',value:scoreDisp,testId:'score'},
            ]}/>

            {/* Sub-phase banner */}
            <div style={{position:'absolute',top:68,left:0,right:0,textAlign:'center',pointerEvents:'none'}}>
              <AnimatePresence mode="wait">
                <motion.div key={subPhase}
                  initial={{opacity:0,y:-6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:6}}
                  transition={{duration:0.18}}
                  style={{display:'inline-block',padding:'4px 18px',borderRadius:20,
                    background:subPhase==='wrong'?'rgba(239,68,68,0.18)':subPhase==='correct'?'rgba(34,197,94,0.18)':'rgba(6,182,212,0.12)',
                    border:`1px solid ${subPhase==='wrong'?'rgba(239,68,68,0.4)':subPhase==='correct'?'rgba(34,197,94,0.4)':'rgba(6,182,212,0.3)'}`,
                    fontSize:13,fontWeight:700,color:subPhase==='wrong'?'#ef4444':subPhase==='correct'?'#22c55e':'rgba(6,182,212,0.9)',letterSpacing:'0.06em'}}>
                  {subPhase==='watching'?'👀 WATCH THE SEQUENCE…':subPhase==='repeating'?'🎯 REPEAT IT NOW!':subPhase==='correct'?'✅ CORRECT! NEXT ROUND':'❌ WRONG! WATCHING AGAIN…'}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Sequence length indicator */}
            <div style={{position:'absolute',top:104,left:0,right:0,textAlign:'center',pointerEvents:'none'}}>
              <span style={{fontSize:12,color:'rgba(255,255,255,0.3)',letterSpacing:'0.1em'}}>
                SEQUENCE: {seqRef.current.length} | ROUND: {sigRef.current.rounds+1}
              </span>
            </div>

            {/* Tile grid */}
            <div style={{
              position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',
              display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,width:280,marginTop:20,
            }}>
              {TILE_COLORS.map((col,i)=>{
                const isLit=litTile===i;
                const isWrong=wrongFlash&&subPhase==='wrong'&&seqRef.current[progRef.current]!==i&&i===litTile;
                return (
                  <motion.button key={i}
                    onPointerDown={()=>handleTileTap(i)}
                    whileTap={{scale:0.93}}
                    animate={isLit?{scale:1.06,boxShadow:`0 0 28px ${col}, 0 0 60px ${col}44`}:{scale:1,boxShadow:'0 2px 8px rgba(0,0,0,0.4)'}}
                    transition={{duration:0.09}}
                    style={{
                      width:132,height:132,borderRadius:20,cursor:'pointer',
                      background:isLit?col:`rgba(${hexRgbEc(col)},0.18)`,
                      border:`2px solid rgba(${hexRgbEc(col)},${isLit?0.9:0.3})`,
                      fontSize:40,display:'flex',alignItems:'center',justifyContent:'center',
                      touchAction:'none',
                    }}
                    aria-label={`Tile ${i+1}`}>
                    {TILE_EMOJIS[i]}
                  </motion.button>
                );
              })}
            </div>

            {/* Wrong flash overlay */}
            <AnimatePresence>
              {wrongFlash && (
                <motion.div key="wrongflash"
                  initial={{opacity:0.5}} animate={{opacity:0}} exit={{opacity:0}}
                  transition={{duration:0.5}}
                  style={{position:'absolute',inset:0,background:'rgba(239,68,68,0.25)',pointerEvents:'none',zIndex:50}} />
              )}
            </AnimatePresence>
          </>}
        </div>
      )}

      {phase==='done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            {label:'Rounds Done',   value:`${finalSig.rounds}`,       color:'#22c55e'},
            {label:'Longest Seq',   value:`${finalSig.longestSeq}`,   color:accent},
            {label:'Correct Taps',  value:`${finalSig.correctTaps}`,  color:'#fbbf24'},
            {label:'Wrong Taps',    value:`${finalSig.wrongTaps}`,    color:'#ef4444'},
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.rounds>=2} />
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

function hexRgbEc(hex:string){ const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16); return `${r},${g},${b}`; }

function WebhookEmitter({theme,sig,personality,player}:{
  theme:ReturnType<typeof useBrandTheme>;sig:Signals;personality:string;player:PlayerSession|null;
}){
  const fired=useRef(false);
  useEffect(()=>{
    if(fired.current) return; fired.current=true;
    postWebhook(theme,GAME_ID,{personality,score:sig.score,rounds:sig.rounds,longestSeq:sig.longestSeq,correctTaps:sig.correctTaps,wrongTaps:sig.wrongTaps},player);
  },[theme,sig,personality,player]);
  return null;
}
