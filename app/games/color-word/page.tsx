'use client';
/**
 * COLOR WORD — Stroop Effect with 3D floating color orbs as background.
 * The word says RED but is printed in BLUE. Tap the INK COLOR.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID   = 'color-word';
const PB_KEY    = 'mg_pb_color-word';
const ACCENT    = '#f43f5e';
const DURATION  = 45;
const GAME_EMOJI   = '🎨';
const GAME_TITLE   = 'Color Word';
const GAME_TAGLINE = 'Tap the INK COLOR — not what the word says.';
const Q_TIMEOUT_MS = 3500;

const COLORS: { name: string; hex: string; threeHex: number }[] = [
  { name:'RED',    hex:'#ef4444', threeHex:0xef4444 },
  { name:'GREEN',  hex:'#22c55e', threeHex:0x22c55e },
  { name:'BLUE',   hex:'#3b82f6', threeHex:0x3b82f6 },
  { name:'YELLOW', hex:'#fbbf24', threeHex:0xfbbf24 },
  { name:'PINK',   hex:'#ec4899', threeHex:0xec4899 },
  { name:'ORANGE', hex:'#f97316', threeHex:0xf97316 },
];
const N = COLORS.length;

interface Signals {
  score: number; correctTaps: number; wrongTaps: number;
  avgReactionMs: number; maxStreak: number;
}

function getPersonality(sig: Signals): string {
  const total = sig.correctTaps + sig.wrongTaps;
  const acc   = total > 0 ? sig.correctTaps / total : 0;
  if (acc >= 0.90 && sig.correctTaps >= 15) return 'Stroop Master 🎯';
  if (acc >= 0.80 && sig.correctTaps >= 10) return 'Color Analyst 🔬';
  if (sig.avgReactionMs < 1200)             return 'Fast Reflex ⚡';
  return 'Mind Over Words 🌊';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface Question {
  wordIdx: number; inkIdx: number; spawnMs: number;
}
function genQuestion(prevInkIdx: number): Question {
  const inkIdx  = (prevInkIdx + 1 + Math.floor(Math.random() * (N-1))) % N;
  let wordIdx: number;
  do { wordIdx = Math.floor(Math.random() * N); } while (wordIdx === inkIdx);
  return { wordIdx, inkIdx, spawnMs: Date.now() };
}

export default function ColorWordGame() {
  const theme        = useBrandTheme();
  const accent       = theme.colors.accent ?? ACCENT;
  const timerRef     = useRef<ReturnType<typeof setInterval>|null>(null);
  const qTimerRef    = useRef<ReturnType<typeof setTimeout>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  // Three.js background
  const mountRef    = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer|null>(null);
  const rafRef      = useRef(0);
  const orbsRef     = useRef<THREE.Mesh[]>([]);

  const reactionTimesRef = useRef<number[]>([]);
  const streakRef        = useRef(0);
  const maxStreakRef     = useRef(0);

  const [phase,       setPhase]       = useState<Phase>('start');
  const [timeLeft,    setTimeLeft]    = useState(DURATION);
  const [score,       setScore]       = useState(0);
  const [finalSig,    setFinalSig]    = useState<Signals|null>(null);
  const [question,    setQuestion]    = useState<Question|null>(null);
  const [feedback,    setFeedback]    = useState<'correct'|'wrong'|'timeout'|null>(null);

  // ── Three.js background ─────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    const W = mount.clientWidth||window.innerWidth; const H = mount.clientHeight||window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(W,H); renderer.setClearColor(0x0a0010, 1);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, W/H, 0.1, 50);
    camera.position.z = 8;

    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const pl = new THREE.PointLight(0xf43f5e, 3, 20);
    pl.position.set(0, 2, 5); scene.add(pl);

    // Floating color orbs
    COLORS.forEach((c, i) => {
      const geo = new THREE.SphereGeometry(0.55 + Math.random()*0.3, 16, 16);
      const mat = new THREE.MeshStandardMaterial({
        color: c.threeHex, metalness:0.3, roughness:0.4,
        emissive: c.threeHex, emissiveIntensity:0.4, transparent:true, opacity:0.35,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const angle = (i/N)*Math.PI*2;
      mesh.position.set(Math.cos(angle)*3.5, Math.sin(angle)*2.5, (Math.random()-0.5)*3-2);
      mesh.userData.phase = Math.random()*Math.PI*2;
      mesh.userData.floatSpeed = 0.4+Math.random()*0.3;
      scene.add(mesh); orbsRef.current.push(mesh);
    });

    // Background particles
    const geo2 = new THREE.BufferGeometry();
    const p2 = new Float32Array(200*3);
    for (let i=0;i<200;i++){p2[i*3]=(Math.random()-0.5)*20;p2[i*3+1]=(Math.random()-0.5)*20;p2[i*3+2]=(Math.random()-0.5)*6-4;}
    geo2.setAttribute('position',new THREE.BufferAttribute(p2,3));
    scene.add(new THREE.Points(geo2, new THREE.PointsMaterial({color:0xfda4af,size:0.06,sizeAttenuation:true,transparent:true,opacity:0.5})));

    let frame=0;
    const render = () => {
      rafRef.current = requestAnimationFrame(render);
      frame++;
      const t = frame*0.016;
      orbsRef.current.forEach((orb,i)=>{
        orb.position.y = orbsRef.current[i].position.y + Math.sin(t*orb.userData.floatSpeed+orb.userData.phase)*0.005;
        orb.rotation.y += 0.012;
        orb.rotation.x += 0.008;
      });
      camera.position.x = Math.sin(t*0.2)*0.3;
      camera.position.y = Math.cos(t*0.15)*0.2;
      renderer.render(scene, camera);
    };
    render();

    const onResize = () => {
      const W2=mount.clientWidth||window.innerWidth;const H2=mount.clientHeight||window.innerHeight;
      renderer.setSize(W2,H2);camera.aspect=W2/H2;camera.updateProjectionMatrix();
    };
    window.addEventListener('resize',onResize);
    return ()=>{
      window.removeEventListener('resize',onResize);
      cancelAnimationFrame(rafRef.current);
      renderer.dispose();mount.removeChild(renderer.domElement);
    };
  },[]);

  const scoreRef = useRef(0);

  const scheduleTimeout = useCallback((q: Question) => {
    if (qTimerRef.current) clearTimeout(qTimerRef.current);
    qTimerRef.current = setTimeout(() => {
      setFeedback('timeout');
      sfx.nearMiss(); haptic([20,30,20]);
      streakRef.current = 0;
      setTimeout(() => {
        const next = genQuestion(q.inkIdx);
        setQuestion(next); setFeedback(null);
        scheduleTimeout(next);
      }, 600);
    }, Q_TIMEOUT_MS);
  }, []);

  const endGame = useCallback(() => {
    if (qTimerRef.current) clearTimeout(qTimerRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    const rts = reactionTimesRef.current;
    const avg = rts.length > 0 ? Math.round(rts.reduce((a,b)=>a+b,0)/rts.length) : 0;
    const sig: Signals = { score:scoreRef.current, correctTaps:0, wrongTaps:0, avgReactionMs:avg, maxStreak:maxStreakRef.current };
    const pb = parseInt(localStorage.getItem(PB_KEY)??'0');
    if (sig.score>pb) localStorage.setItem(PB_KEY,String(sig.score));
    setFinalSig(sig); setPhase('done');
  }, []);

  const handleTap = useCallback((tappedIdx: number) => {
    const q = question; if (!q) return;
    if (qTimerRef.current) clearTimeout(qTimerRef.current);
    const rt = Date.now() - q.spawnMs;
    reactionTimesRef.current.push(rt);
    const correct = tappedIdx === q.inkIdx;
    if (correct) {
      streakRef.current++;
      if (streakRef.current>maxStreakRef.current) maxStreakRef.current=streakRef.current;
      const pts = 5 + (streakRef.current>=4?5:0);
      scoreRef.current += pts; setScore(scoreRef.current);
      sfx.collect(); setFeedback('correct');
      // Pulse orb
      if (orbsRef.current[tappedIdx]) {
        const mat = orbsRef.current[tappedIdx].material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity=2;
        setTimeout(()=>{ mat.emissiveIntensity=0.4; },300);
      }
    } else {
      streakRef.current=0; sfx.collision(); setFeedback('wrong');
    }
    setTimeout(() => {
      const next = genQuestion(q.inkIdx);
      setQuestion(next); setFeedback(null);
      scheduleTimeout(next);
    }, correct?300:600);
  }, [question, scheduleTimeout]);

  const startGame = useCallback(() => {
    scoreRef.current=0; reactionTimesRef.current=[]; streakRef.current=0; maxStreakRef.current=0;
    setScore(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('minimal');
    const q = genQuestion(0); setQuestion(q); setFeedback(null); scheduleTimeout(q);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        const next = prev-1;
        if (next<=10&&next>0) sfx.tick();
        if (next<=0) endGame();
        return next;
      });
    },1000);
  },[endGame, scheduleTimeout]);

  useEffect(()=>()=>{
    if(timerRef.current)clearInterval(timerRef.current);
    if(qTimerRef.current)clearTimeout(qTimerRef.current);
    if(stopMusicRef.current)stopMusicRef.current();
    cancelAnimationFrame(rafRef.current);
  },[]);

  const handleStart = useCallback((name:string,avatar:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar); initAudio(); setPhase('countdown');
  },[]);
  const handleCountdownDone = useCallback(()=>{startGame();},[startGame]);
  const handlePlayAgain = useCallback(()=>{setPhase('start');setScore(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  const fbColor = feedback==='correct'?'#22c55e':feedback==='wrong'||feedback==='timeout'?'#ef4444':'transparent';

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Play 🎨" accentColor={accent} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accent}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <>
          {/* 3D background */}
          <div ref={mountRef} style={{position:'absolute',inset:0,width:'100%',height:'100%'}}/>
          {phase==='playing'&&question&&(
            <>
              <GameHUD accentColor={accent} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:score}]}/>
              {/* Big word in ink color */}
              <div style={{position:'absolute',top:'22%',left:0,right:0,display:'flex',justifyContent:'center',pointerEvents:'none'}}>
                <div style={{
                  fontSize:'clamp(52px,18vw,100px)',fontWeight:900,letterSpacing:'-0.02em',lineHeight:1,
                  color:COLORS[question.inkIdx].hex,
                  textShadow:`0 0 30px ${COLORS[question.inkIdx].hex}88, 0 0 60px ${COLORS[question.inkIdx].hex}44`,
                  background: fbColor!=='transparent'?`${fbColor}22`:'transparent',
                  borderRadius:16, padding:'4px 16px',
                  transition:'background 150ms',
                }}>
                  {COLORS[question.wordIdx].name}
                </div>
              </div>
              {/* Color buttons */}
              <div style={{position:'absolute',bottom:60,left:'50%',transform:'translateX(-50%)',
                display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,width:'min(380px,90%)'}}>
                {COLORS.map((c,i)=>(
                  <button key={i} onClick={()=>handleTap(i)}
                    style={{height:52,borderRadius:12,border:'2px solid rgba(255,255,255,0.15)',
                      background:c.hex,color:'rgba(255,255,255,0.9)',fontSize:13,fontWeight:800,
                      cursor:'pointer',letterSpacing:'0.05em',boxShadow:`0 0 12px ${c.hex}44`,
                      touchAction:'manipulation',transition:'transform 80ms',
                    }}
                    onPointerDown={e=>(e.currentTarget.style.transform='scale(0.93)')}
                    onPointerUp={e=>(e.currentTarget.style.transform='scale(1)')}>
                    {c.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {phase==='done'&&finalSig&&(
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            {label:'Score',value:String(finalSig.score),color:accent},
            {label:'Best Streak',value:`×${finalSig.maxStreak}`,color:'#fbbf24'},
            {label:'Avg Reaction',value:`${(finalSig.avgReactionMs/1000).toFixed(1)}s`,color:'var(--color-text)'},
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.score>=50}/>
      )}
      {phase==='done'&&finalSig&&<WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>}
    </GameShell>
  );
}

function WebhookEmitter({theme,sig,personality,player}:{theme:ReturnType<typeof useBrandTheme>;sig:Signals;personality:string;player:PlayerSession|null;}) {
  const fired=useRef(false);
  useEffect(()=>{if(fired.current)return;fired.current=true;postWebhook(theme,GAME_ID,{personality,score:sig.score,avgReactionMs:sig.avgReactionMs,maxStreak:sig.maxStreak},player);},[theme,sig,personality,player]);
  return null;
}
