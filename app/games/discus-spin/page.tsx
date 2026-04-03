'use client';
/**
 * DISCUS SPIN — 3D: hold to spin-charge a glowing discus, release to launch it.
 * Stadium field perspective, spinning disc flies through the air.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticImpact } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'discus-spin';
const ACCENT = '#10b981';
const DURATION = 45;
const GAME_EMOJI = '💿';
const GAME_TITLE = 'Discus Spin';
const GAME_TAGLINE = 'Spin it. Flick it. Fly!';

interface Signals {
  totalAttempts:number; bestResult:number; maxStreak:number; streakCurrent:number;
  score:number; goodAttempts:number; perfectAttempts:number;
}
function getPersonality(sig:Signals):string {
  if(sig.perfectAttempts>=4&&sig.maxStreak>=3) return 'Elite Athlete 🏆';
  if(sig.maxStreak>=5) return 'On a Roll 🔥';
  if(sig.goodAttempts>=5) return 'Solid Performer 💪';
  return 'Rising Athlete 🌱';
}
type Phase='start'|'countdown'|'playing'|'done';

interface GS {
  running:boolean; timeLeft:number; sig:Signals;
  chargeLevel:number; charging:boolean; chargeStart:number;
  inFlight:boolean; discPos:THREE.Vector3; discVel:THREE.Vector3;
  spinAngle:number; frame:number;
}

export default function GameDiscusSpin() {
  const theme = useBrandTheme();
  const accent = theme.colors.accent ?? ACCENT;

  const mountRef    = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer|null>(null);
  const sceneRef    = useRef<THREE.Scene|null>(null);
  const cameraRef   = useRef<THREE.PerspectiveCamera|null>(null);
  const rafRef      = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setInterval>|null>(null);
  const discMeshRef = useRef<THREE.Group|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{totalAttempts:0,bestResult:0,maxStreak:0,streakCurrent:0,score:0,goodAttempts:0,perfectAttempts:0},
    chargeLevel:0,charging:false,chargeStart:0,
    inFlight:false,discPos:new THREE.Vector3(-2.5,0,3),discVel:new THREE.Vector3(),
    spinAngle:0,frame:0,
  });

  const [phase,setPhase]        = useState<Phase>('start');
  const [timeLeft,setTimeLeft]  = useState(DURATION);
  const [scoreDisplay,setScore] = useState(0);
  const [finalSig,setFinalSig]  = useState<Signals|null>(null);
  const [chargeLevel,setCharge] = useState(0);

  // ── Three.js setup ──────────────────────────────────────────────────────
  useEffect(()=>{
    if(!mountRef.current)return;
    const mount=mountRef.current;
    const W=mount.clientWidth||window.innerWidth;const H=mount.clientHeight||window.innerHeight;

    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(W,H);renderer.setClearColor(0x0a1008);
    mount.appendChild(renderer.domElement);
    rendererRef.current=renderer;

    const scene=new THREE.Scene();
    scene.fog=new THREE.Fog(0x0a1008,18,40);
    sceneRef.current=scene;

    const camera=new THREE.PerspectiveCamera(65,W/H,0.1,50);
    camera.position.set(0,2,8);camera.lookAt(0,0,-5);
    cameraRef.current=camera;

    scene.add(new THREE.AmbientLight(0xffffff,0.4));
    const pl=new THREE.PointLight(0x10b981,3,20);pl.position.set(0,5,3);scene.add(pl);
    scene.add(new THREE.DirectionalLight(0xffffff,0.3));

    // Grass field
    const floorGeo=new THREE.PlaneGeometry(22,30);
    const floorMat=new THREE.MeshStandardMaterial({color:0x1a4a10,roughness:0.9,metalness:0.02});
    const floor=new THREE.Mesh(floorGeo,floorMat);
    floor.rotation.x=-Math.PI/2;floor.position.y=-0.8;
    scene.add(floor);

    // Field lines
    for(let i=0;i<5;i++){
      const geo=new THREE.PlaneGeometry(12,0.04);
      const mat=new THREE.MeshStandardMaterial({color:0xffffff,transparent:true,opacity:0.2});
      const m=new THREE.Mesh(geo,mat);m.rotation.x=-Math.PI/2;m.position.set(0,-0.79,-i*3);
      scene.add(m);
    }

    // Landing zones
    const zones=[{x:-3,color:0x3b82f6,label:'OK'},{x:0,color:0x10b981,label:'GOOD'},{x:3,color:0xfbbf24,label:'BEST'}];
    zones.forEach(z=>{
      const geo=new THREE.BoxGeometry(2,0.05,2);
      const mat=new THREE.MeshStandardMaterial({color:z.color,transparent:true,opacity:0.4,emissive:z.color,emissiveIntensity:0.2});
      const m=new THREE.Mesh(geo,mat);m.position.set(z.x,-0.78,-6);
      scene.add(m);
    });

    // Discus
    const discGroup=new THREE.Group();
    const discGeo=new THREE.CylinderGeometry(0.45,0.45,0.08,24);
    const discMat=new THREE.MeshStandardMaterial({color:0x10b981,metalness:0.7,roughness:0.2,emissive:0x10b981,emissiveIntensity:0.3});
    discGroup.add(new THREE.Mesh(discGeo,discMat));
    // Rim
    const rimGeo=new THREE.TorusGeometry(0.44,0.05,8,24);
    const rimMat=new THREE.MeshStandardMaterial({color:0x34d399,metalness:0.8,roughness:0.15,emissive:0x10b981,emissiveIntensity:0.5});
    discGroup.add(new THREE.Mesh(rimGeo,rimMat));
    discGroup.position.set(-2.5,0.5,3);
    scene.add(discGroup);
    discMeshRef.current=discGroup;

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
      const disc=discMeshRef.current;

      if(s.charging)s.chargeLevel=Math.min(1,(Date.now()-s.chargeStart)/1400);

      if(disc){
        if(s.inFlight){
          s.discPos.x+=s.discVel.x;s.discPos.y+=s.discVel.y;s.discPos.z+=s.discVel.z;
          s.discVel.y-=0.012;
          disc.position.copy(s.discPos);
          s.spinAngle+=0.25+s.chargeLevel*0.5;
          disc.rotation.y=s.spinAngle;disc.rotation.x=s.discVel.y*0.3;

          if(s.discPos.y<-0.5||s.discPos.z<-9){
            s.inFlight=false;
            const dx=Math.abs(s.discPos.x);
            let pts=0;
            if(dx<1.5)pts=5;else if(dx<3)pts=3;else if(dx<5)pts=1;
            const isOptimal=s.chargeLevel>=0.7&&s.chargeLevel<=0.85;
            const isGood=s.chargeLevel>=0.5;
            s.sig.totalAttempts++;
            if(isOptimal)s.sig.perfectAttempts++;else if(isGood)s.sig.goodAttempts++;
            if(pts>0){
              s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;
              const mult=s.sig.streakCurrent>=3?2:1;
              s.sig.score+=pts*mult;setScore(s.sig.score);
              sfx.success();hapticScore();
            } else {sfx.collision();hapticFail();s.sig.streakCurrent=0;}
            hapticImpact();
            const discMat2=disc.children[0].material as THREE.MeshStandardMaterial;
            discMat2.emissive.setHex(pts>=5?0xfbbf24:pts>0?0x22c55e:0xef4444);
            discMat2.emissiveIntensity=2;
            setTimeout(()=>{discMat2.emissive.setHex(0x10b981);discMat2.emissiveIntensity=0.3;disc.position.set(-2.5,0.5,3);},700);
          }
        } else {
          // Idle spin/wobble showing charge
          disc.position.set(-2.5+Math.sin(t*0.8)*0.08,0.5+Math.sin(t*1.5)*0.04,3);
          disc.rotation.y+=0.02+s.chargeLevel*0.15;
          const dMat=disc.children[0].material as THREE.MeshStandardMaterial;
          dMat.emissiveIntensity=0.3+s.chargeLevel*0.8;
        }
      }

      renderer.render(scene,camera);
    };
    render();

    return()=>{
      window.removeEventListener('resize',onResize);
      cancelAnimationFrame(rafRef.current);
      renderer.dispose();mount.removeChild(renderer.domElement);
    };
  },[]);

  const endGame=useCallback(()=>{
    const s=stateRef.current;s.running=false;
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    const pb=parseInt(localStorage.getItem(`pb_${GAME_ID}`)??'0');
    if(s.sig.score>pb)localStorage.setItem(`pb_${GAME_ID}`,String(s.sig.score));
    setFinalSig({...s.sig});setPhase('done');hapticVictory();
  },[]);

  const startLoop=useCallback(()=>{
    const s=stateRef.current;
    s.running=true;s.timeLeft=DURATION;
    s.sig={totalAttempts:0,bestResult:0,maxStreak:0,streakCurrent:0,score:0,goodAttempts:0,perfectAttempts:0};
    s.chargeLevel=0;s.charging=false;s.inFlight=false;s.frame=0;
    setScore(0);setTimeLeft(DURATION);setPhase('playing');
    timerRef.current=setInterval(()=>{const s2=stateRef.current;s2.timeLeft--;setTimeLeft(s2.timeLeft);if(s2.timeLeft<=0){sfx.fail();endGame();}},1000);
  },[endGame]);

  useEffect(()=>{
    const mount=mountRef.current;if(!mount)return;
    const onDown=()=>{if(phase!=='playing')return;const s=stateRef.current;if(s.inFlight)return;s.charging=true;s.chargeStart=Date.now();};
    const onUp=()=>{
      if(phase!=='playing')return;const s=stateRef.current;if(!s.charging)return;s.charging=false;
      const speed=3+s.chargeLevel*10;
      s.discPos.set(-2.5,0.5,3);s.discVel.set(0.1,speed*0.2,-speed);
      s.inFlight=true;s.chargeLevel=0;setCharge(0);
      sfx.whoosh();hapticImpact();
    };
    mount.addEventListener('pointerdown',onDown);mount.addEventListener('pointerup',onUp);
    return()=>{mount.removeEventListener('pointerdown',onDown);mount.removeEventListener('pointerup',onUp);};
  },[phase]);

  useEffect(()=>{const iv=setInterval(()=>{if(phase==='playing')setCharge(stateRef.current.chargeLevel);},50);return()=>clearInterval(iv);},[phase]);
  useEffect(()=>()=>{cancelAnimationFrame(rafRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);

  const handleStart=useCallback(async(name:string,avatar:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);await initAudio();setPhase('countdown');},[]);
  const handleCountdownDone=useCallback(()=>{startLoop();},[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScore(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  const meterColor=chargeLevel>0.8?'#ef4444':chargeLevel>0.5?'#fbbf24':accent;

  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Go! 💿" accentColor={accent} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accent}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <>
          <div ref={mountRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
          {phase==='playing'&&(
            <>
              <GameHUD accentColor={accent} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>
              <div style={{position:'absolute',bottom:80,left:'50%',transform:'translateX(-50%)',width:'min(280px,75%)',display:'flex',flexDirection:'column',gap:6,alignItems:'center'}}>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.5)',fontWeight:700,letterSpacing:'0.1em'}}>HOLD TO SPIN</div>
                <div style={{width:'100%',height:14,borderRadius:7,background:'rgba(255,255,255,0.08)',overflow:'hidden',border:'1px solid rgba(255,255,255,0.1)'}}>
                  <div style={{height:'100%',borderRadius:7,background:meterColor,width:`${chargeLevel*100}%`,transition:'width 50ms',boxShadow:`0 0 8px ${meterColor}`}}/>
                </div>
                <div style={{fontSize:11,color:'rgba(74,222,128,0.7)',fontWeight:600}}>{chargeLevel>=0.7&&chargeLevel<=0.85?'🎯 SWEET SPOT!':''}</div>
              </div>
            </>
          )}
        </>
      )}
      {phase==='done'&&finalSig&&(
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            {label:'Perfect',value:String(finalSig.perfectAttempts),color:'#fbbf24'},
            {label:'Good',value:String(finalSig.goodAttempts),color:accent},
            {label:'Best Streak',value:`x${finalSig.maxStreak}`,color:'#4ade80'},
            {label:'Attempts',value:String(finalSig.totalAttempts),color:'#06b6d4'},
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.perfectAttempts>=3}/>
      )}
    </GameShell>
  );
}
