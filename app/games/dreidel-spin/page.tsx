'use client';
/**
 * DREIDEL SPIN — 3D: swipe up to spin a real 3D dreidel, brake to land on target symbol.
 * Blue and silver festival environment with glowing Hebrew symbols.
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
import { motion, AnimatePresence } from 'framer-motion';

const GAME_ID = 'dreidel-spin';
const ACCENT = '#fbbf24';
const DURATION = 45;
const GAME_EMOJI = '🌀';
const GAME_TITLE = 'Dreidel Spin';
const GAME_TAGLINE = 'Spin it. Brake it. Land on the symbol.';
const PB_KEY = 'mg_pb_dreidel-spin';

const SYMBOLS = ['נ','ג','ה','ש'];
const SYMBOL_NAMES = ['Nun','Gimel','Hey','Shin'];
const NUM_SYMBOLS = 4;
const SECTOR_ANGLE = (Math.PI*2)/NUM_SYMBOLS;

interface Signals {
  score:number; hits:number; attempts:number; maxStreak:number; streakCurrent:number; avgAccuracy:number;
}
function getPersonality(sig:Signals):string {
  const acc=sig.attempts>0?sig.hits/sig.attempts:0;
  if(acc>=0.8&&sig.score>=5) return 'Dreidel Master 🌟';
  if(acc>=0.65) return 'Precision Spinner 🎯';
  if(sig.maxStreak>=3) return 'Lucky Streak 🍀';
  if(sig.attempts>=5) return 'Determined Player 💪';
  return 'Learning to Spin 🌀';
}

type Phase='start'|'countdown'|'playing'|'done';
type SpinState='idle'|'spinning'|'braking'|'stopped';

function DreidelSpinGameInner() {
  const theme = useBrandTheme();
  const accent = theme.colors.accent ?? ACCENT;

  const mountRef     = useRef<HTMLDivElement>(null);
  const rendererRef  = useRef<THREE.WebGLRenderer|null>(null);
  const sceneRef     = useRef<THREE.Scene|null>(null);
  const cameraRef    = useRef<THREE.PerspectiveCamera|null>(null);
  const rafRef       = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const dreidelRef   = useRef<THREE.Group|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const stateRef = useRef({
    running:false, timeLeft:DURATION,
    sig:{score:0,hits:0,attempts:0,maxStreak:0,streakCurrent:0,avgAccuracy:0} as Signals,
    angle:0, angularVel:0, spinState:'idle' as SpinState,
    swipeStartY:0, swipeStartTime:0, isSwiping:false, isBraking:false,
    targetSymbolIdx:0, resultCorrect:false, resultFlash:0,
    accentColor:ACCENT, wobble:0, tilt:0, accuracyDiffs:[] as number[],
  });

  const [phase,setPhase]           = useState<Phase>('start');
  const [timeLeft,setTimeLeft]      = useState(DURATION);
  const [scoreDisplay,setScore]     = useState(0);
  const [finalSig,setFinalSig]      = useState<Signals|null>(null);
  const [spinStateDisplay,setSpinSt]= useState<SpinState>('idle');
  const [resultMsg,setResultMsg]    = useState<string|null>(null);
  const [targetDisplay,setTargetD]  = useState(0);
  const [streakDisplay,setStreak]   = useState(0);

  useEffect(()=>{stateRef.current.accentColor=accent;},[accent]);

  const getTopSymbolIdx=useCallback(()=>{
    const s=stateRef.current;
    const norm=((s.angle%(Math.PI*2))+(Math.PI*2))%(Math.PI*2);
    return Math.round(norm/SECTOR_ANGLE)%NUM_SYMBOLS;
  },[]);

  // ── Three.js setup ──────────────────────────────────────────────────────
  useEffect(()=>{
    if(!mountRef.current)return;
    const mount=mountRef.current;
    const W=mount.clientWidth||window.innerWidth;const H=mount.clientHeight||window.innerHeight;

    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(W,H);renderer.setClearColor(0x020714);
    mount.appendChild(renderer.domElement);
    rendererRef.current=renderer;

    const scene=new THREE.Scene();
    sceneRef.current=scene;

    const camera=new THREE.PerspectiveCamera(65,W/H,0.1,50);
    camera.position.set(0,2,7);camera.lookAt(0,0,0);
    cameraRef.current=camera;

    scene.add(new THREE.AmbientLight(0xffffff,0.3));
    const pl=new THREE.PointLight(0x60a5fa,4,20);pl.position.set(0,4,5);scene.add(pl);
    const pl2=new THREE.PointLight(0xfbbf24,2,10);pl2.position.set(-3,0,3);scene.add(pl2);

    // Background stars
    const sg=new THREE.BufferGeometry();const sp=new Float32Array(300*3);
    for(let i=0;i<300;i++){sp[i*3]=(Math.random()-0.5)*20;sp[i*3+1]=(Math.random()-0.5)*20;sp[i*3+2]=(Math.random()-0.5)*6-5;}
    sg.setAttribute('position',new THREE.BufferAttribute(sp,3));
    scene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0x93c5fd,size:0.05,sizeAttenuation:true,transparent:true,opacity:0.7})));

    // Menorah-like background structure
    for(let i=0;i<9;i++){
      const geo=new THREE.CylinderGeometry(0.04,0.04,0.5+Math.random()*0.5,6);
      const mat=new THREE.MeshStandardMaterial({color:0xfbbf24,metalness:0.7,roughness:0.3,emissive:0xf59e0b,emissiveIntensity:0.3});
      const m=new THREE.Mesh(geo,mat);
      m.position.set(-3.2+i*0.8,-1.5,-3);scene.add(m);
      // Flame
      const fGeo=new THREE.ConeGeometry(0.05,0.2,6);
      const fMat=new THREE.MeshStandardMaterial({color:0xfbbf24,emissive:0xf59e0b,emissiveIntensity:2,transparent:true,opacity:0.9});
      const fl=new THREE.Mesh(fGeo,fMat);fl.position.set(-3.2+i*0.8,-1.0,-3);scene.add(fl);
    }

    // Table
    const tableGeo=new THREE.BoxGeometry(8,0.1,4);
    const tableMat=new THREE.MeshStandardMaterial({color:0x0a1428,metalness:0.3,roughness:0.8});
    const table=new THREE.Mesh(tableGeo,tableMat);table.position.y=-1;scene.add(table);

    // Dreidel group
    const dreidel=new THREE.Group();

    // Body (tapered square prism → classic dreidel shape)
    const bodyGeo=new THREE.CylinderGeometry(0.45,0.6,1.2,4);
    const bodyMat=new THREE.MeshStandardMaterial({color:0x1e3a8a,metalness:0.4,roughness:0.4,emissive:0x1d4ed8,emissiveIntensity:0.3});
    dreidel.add(new THREE.Mesh(bodyGeo,bodyMat));

    // Pointed bottom
    const tipGeo=new THREE.ConeGeometry(0.15,0.7,6);
    const tipMat=new THREE.MeshStandardMaterial({color:0xfbbf24,metalness:0.6,roughness:0.3,emissive:0xf59e0b,emissiveIntensity:0.4});
    const tip=new THREE.Mesh(tipGeo,tipMat);tip.rotation.z=Math.PI;tip.position.y=-0.9;dreidel.add(tip);

    // Handle on top
    const handleGeo=new THREE.CylinderGeometry(0.1,0.1,0.7,8);
    const handleMat=new THREE.MeshStandardMaterial({color:0xdbeafe,metalness:0.5,roughness:0.4});
    const handle=new THREE.Mesh(handleGeo,handleMat);handle.position.y=0.95;dreidel.add(handle);

    // Symbol faces (simple planes with glowing emissive)
    const faceColors=[0x60a5fa,0xfbbf24,0x34d399,0xf472b6];
    for(let i=0;i<4;i++){
      const fGeo=new THREE.PlaneGeometry(0.55,0.7);
      const fMat=new THREE.MeshStandardMaterial({color:faceColors[i],emissive:faceColors[i],emissiveIntensity:0.8,transparent:true,opacity:0.9,side:THREE.FrontSide});
      const face=new THREE.Mesh(fGeo,fMat);
      face.rotation.y=(i/4)*Math.PI*2;face.position.set(Math.sin((i/4)*Math.PI*2)*0.51,0,Math.cos((i/4)*Math.PI*2)*0.51);
      dreidel.add(face);
    }

    dreidel.position.y=0.1;
    scene.add(dreidel);dreidelRef.current=dreidel;

    // Target indicator ring on table
    const targetRingGeo=new THREE.TorusGeometry(0.7,0.04,6,24);
    const targetRingMat=new THREE.MeshStandardMaterial({color:0x60a5fa,emissive:0x60a5fa,emissiveIntensity:1,transparent:true,opacity:0.6});
    const targetRing=new THREE.Mesh(targetRingGeo,targetRingMat);
    targetRing.rotation.x=Math.PI/2;targetRing.position.y=-0.94;scene.add(targetRing);

    const onResize=()=>{
      const W2=mount.clientWidth||window.innerWidth;const H2=mount.clientHeight||window.innerHeight;
      renderer.setSize(W2,H2);camera.aspect=W2/H2;camera.updateProjectionMatrix();
    };
    window.addEventListener('resize',onResize);

    let frame=0;
    const render=()=>{
      rafRef.current=requestAnimationFrame(render);
      frame++;
      const t=frame*0.016;
      const s=stateRef.current;

      // Rotate dreidel
      if(s.spinState==='spinning'){
        s.angularVel*=0.998;
        if(s.isBraking)s.angularVel*=0.92;
        s.angle+=s.angularVel;
        if(Math.abs(s.angularVel)<0.008){
          s.spinState='stopped';setSpinSt('stopped');
          // Score
          const landed=getTopSymbolIdx();
          const correct=landed===s.targetSymbolIdx;
          s.sig.attempts++;
          if(correct){
            s.sig.hits++;s.sig.streakCurrent++;
            if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;
            s.sig.score++;setScore(s.sig.score);setStreak(s.sig.streakCurrent);
            sfx.success();haptic([30,20,60]);setResultMsg('✨ CORRECT!');
          } else {
            s.sig.streakCurrent=0;sfx.collision();haptic([50]);setStreak(0);
            setResultMsg(`× Landed: ${SYMBOL_NAMES[landed]}`);
          }
          setTimeout(()=>{
            setResultMsg(null);s.spinState='idle';setSpinSt('idle');
            s.isBraking=false;
            // New target
            s.targetSymbolIdx=Math.floor(Math.random()*NUM_SYMBOLS);
            setTargetD(s.targetSymbolIdx);
          },1200);
        }
        s.wobble=Math.abs(s.angularVel)*0.12;
      } else if(s.spinState==='idle'){
        s.wobble=Math.sin(t*1.5)*0.02;
      }

      // Apply rotation to 3D dreidel
      if(dreidelRef.current){
        dreidelRef.current.rotation.y=s.angle;
        dreidelRef.current.rotation.x=s.wobble*Math.cos(t*3);
        dreidelRef.current.rotation.z=s.wobble*Math.sin(t*2.5);
        dreidelRef.current.position.y=0.1+Math.abs(s.wobble)*0.2;
      }

      // Target ring pulse
      const r=scene.children.find(c=>(c as THREE.Mesh).geometry instanceof THREE.TorusGeometry) as THREE.Mesh;
      if(r)(r.material as THREE.MeshStandardMaterial).emissiveIntensity=0.6+Math.sin(t*3)*0.4;

      renderer.render(scene,camera);
    };
    render();

    return()=>{
      window.removeEventListener('resize',onResize);
      cancelAnimationFrame(rafRef.current);
      renderer.dispose();mount.removeChild(renderer.domElement);
    };
  },[getTopSymbolIdx]);

  const endGame=useCallback(()=>{
    const s=stateRef.current;s.running=false;
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    const acc=s.sig.attempts>0?s.sig.hits/s.sig.attempts:0;
    s.sig.avgAccuracy=acc;
    const sig={...s.sig};
    const pb=parseInt(localStorage.getItem(PB_KEY)??'0');
    if(sig.score>pb)localStorage.setItem(PB_KEY,String(sig.score));
    setFinalSig(sig);setPhase('done');
  },[]);

  const startLoop=useCallback(()=>{
    const s=stateRef.current;
    s.running=true;s.timeLeft=DURATION;
    s.sig={score:0,hits:0,attempts:0,maxStreak:0,streakCurrent:0,avgAccuracy:0};
    s.angle=0;s.angularVel=0;s.spinState='idle';s.isBraking=false;
    s.targetSymbolIdx=Math.floor(Math.random()*NUM_SYMBOLS);
    setScore(0);setTimeLeft(DURATION);setStreak(0);setTargetD(s.targetSymbolIdx);setSpinSt('idle');setPhase('playing');
    stopMusicRef.current=startMusic('chill');

    timerRef.current=setInterval(()=>{
      const s2=stateRef.current;s2.timeLeft--;setTimeLeft(s2.timeLeft);
      if(s2.timeLeft<=10&&s2.timeLeft>0)sfx.tick();
      if(s2.timeLeft<=0)endGame();
    },1000);
  },[endGame]);

  // Swipe + brake input
  useEffect(()=>{
    const mount=mountRef.current;if(!mount)return;
    const onDown=(e:PointerEvent)=>{
      const s=stateRef.current;if(!s.running)return;
      s.swipeStartY=e.clientY;s.swipeStartTime=Date.now();s.isSwiping=true;
      if(s.spinState==='spinning')s.isBraking=true;
    };
    const onUp=(e:PointerEvent)=>{
      const s=stateRef.current;if(!s.running)return;
      s.isBraking=false;
      if(s.isSwiping&&s.spinState==='idle'){
        const dy=s.swipeStartY-e.clientY;const dt=Math.max(Date.now()-s.swipeStartTime,50);
        if(dy>30){
          const vel=Math.min(Math.abs(dy)/dt*0.3,0.4);
          s.angularVel=vel*(Math.random()<0.5?1:-1);
          s.spinState='spinning';setSpinSt('spinning');
          sfx.whoosh();haptic([15]);
        }
      }
      s.isSwiping=false;
    };
    mount.addEventListener('pointerdown',onDown);mount.addEventListener('pointerup',onUp);
    return()=>{mount.removeEventListener('pointerdown',onDown);mount.removeEventListener('pointerup',onUp);};
  },[phase]);

  useEffect(()=>()=>{cancelAnimationFrame(rafRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);
  const handleStart=useCallback(async(name:string,avatar:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);await initAudio();setPhase('countdown');},[]);
  const handleCountdownDone=useCallback(()=>{startLoop();},[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScore(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  const tc=SYMBOLS[targetDisplay]||'נ';
  const tcName=SYMBOL_NAMES[targetDisplay]||'Nun';

  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Spin! 🌀" accentColor={accent} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accent}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <>
          <div ref={mountRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
          {phase==='playing'&&(
            <>
              <GameHUD accentColor={accent} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>
              {/* Target display */}
              <div style={{position:'absolute',top:80,left:'50%',transform:'translateX(-50%)',display:'flex',flexDirection:'column',alignItems:'center',gap:4,pointerEvents:'none'}}>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.5)',fontWeight:600,letterSpacing:'0.15em'}}>LAND ON</div>
                <div style={{width:56,height:56,borderRadius:12,background:`rgba(96,165,250,0.15)`,border:`2px solid ${accent}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,fontWeight:900,color:accent,boxShadow:`0 0 16px ${accent}66`}}>
                  {tc}
                </div>
                <div style={{fontSize:13,color:accent,fontWeight:700}}>{tcName}</div>
              </div>
              {/* Spin state hint */}
              <div style={{position:'absolute',bottom:60,left:'50%',transform:'translateX(-50%)',fontSize:13,color:'rgba(255,255,255,0.5)',fontWeight:600,letterSpacing:'0.08em',textAlign:'center',pointerEvents:'none'}}>
                {spinStateDisplay==='idle'?'SWIPE UP TO SPIN':spinStateDisplay==='spinning'?'TAP TO BRAKE':'...'}
              </div>
              {/* Streak */}
              {streakDisplay>=2&&<div style={{position:'absolute',top:'20%',right:20,fontSize:20,fontWeight:900,color:'#fbbf24',pointerEvents:'none'}}>🔥×{streakDisplay}</div>}
              {/* Result flash */}
              <AnimatePresence>
                {resultMsg&&<motion.div key="res" initial={{opacity:0,scale:0.7}} animate={{opacity:1,scale:1}} exit={{opacity:0,scale:0.8}} style={{position:'absolute',top:'38%',left:'50%',transform:'translateX(-50%)',fontSize:24,fontWeight:900,color:resultMsg.startsWith('✨')?'#4ade80':'#ef4444',textShadow:`0 0 20px currentColor`,pointerEvents:'none'}}>{resultMsg}</motion.div>}
              </AnimatePresence>
            </>
          )}
        </>
      )}
      {phase==='done'&&finalSig&&(
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            {label:'Hits',value:`${finalSig.hits}/${finalSig.attempts}`,color:finalSig.hits/Math.max(finalSig.attempts,1)>=0.6?'#4ade80':'#facc15'},
            {label:'Accuracy',value:`${Math.round(finalSig.avgAccuracy*100)}%`,color:accent},
            {label:'Best Streak',value:`×${finalSig.maxStreak}`,color:'#fbbf24'},
            {label:'Score',value:String(finalSig.score),color:'var(--color-text)'},
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.score>=5}/>
      )}
      {phase==='done'&&finalSig&&<WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>}
    </GameShell>
  );
}

function WebhookEmitter({theme,sig,personality,player}:{theme:ReturnType<typeof useBrandTheme>;sig:Signals;personality:string;player:PlayerSession|null;}){
  const fired=useRef(false);
  useEffect(()=>{if(fired.current)return;fired.current=true;postWebhook(theme,GAME_ID,{personality,score:sig.score},player);},[theme,sig,personality,player]);
  return null;
}

import dynamic from 'next/dynamic';
const DreidelSpinGame = dynamic(() => Promise.resolve({ default: DreidelSpinGameInner }), { ssr: false });
export default DreidelSpinGame;
