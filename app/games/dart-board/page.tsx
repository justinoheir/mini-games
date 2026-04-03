'use client';
/**
 * DART BOARD — 3D: hold to charge power, release to throw a dart at a 3D bullseye.
 * Green stadium night atmosphere. Red dart flies through 3D space.
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

const GAME_ID = 'dart-board';
const ACCENT = '#dc2626';
const DURATION = 45;
const GAME_EMOJI = '🎯';
const GAME_TITLE = 'Dart Board';
const GAME_TAGLINE = 'Flick straight. Hit the bull.';

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

type Phase = 'start'|'countdown'|'playing'|'done';

interface GS {
  running:boolean; timeLeft:number; sig:Signals;
  chargeLevel:number; charging:boolean; chargeStart:number;
  inFlight:boolean; dartPos:THREE.Vector3; dartVel:THREE.Vector3;
  resultFlash:number; frame:number;
}

export default function GameDartboard() {
  const theme = useBrandTheme();
  const accent = theme.colors.accent ?? ACCENT;

  const mountRef    = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer|null>(null);
  const sceneRef    = useRef<THREE.Scene|null>(null);
  const cameraRef   = useRef<THREE.PerspectiveCamera|null>(null);
  const rafRef      = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setInterval>|null>(null);
  const dartMeshRef = useRef<THREE.Group|null>(null);
  const playerRef   = useRef<THREE.Group|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{totalAttempts:0,bestResult:0,maxStreak:0,streakCurrent:0,score:0,goodAttempts:0,perfectAttempts:0},
    chargeLevel:0,charging:false,chargeStart:0,inFlight:false,
    dartPos:new THREE.Vector3(),dartVel:new THREE.Vector3(),
    resultFlash:0,frame:0,
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
    scene.fog=new THREE.Fog(0x0a1008,15,35);
    sceneRef.current=scene;

    const camera=new THREE.PerspectiveCamera(65,W/H,0.1,50);
    camera.position.set(0,1,7);
    camera.lookAt(0,0,-5);
    cameraRef.current=camera;

    scene.add(new THREE.AmbientLight(0xffffff,0.35));
    const pl=new THREE.PointLight(0xdc2626,3,20);
    pl.position.set(0,4,5);scene.add(pl);
    scene.add(new THREE.DirectionalLight(0xffffff,0.4));

    // Stadium grass floor
    const floorGeo=new THREE.PlaneGeometry(20,30);
    const floorMat=new THREE.MeshStandardMaterial({color:0x1a4a10,roughness:0.9,metalness:0.05});
    const floor=new THREE.Mesh(floorGeo,floorMat);
    floor.rotation.x=-Math.PI/2;floor.position.y=-1;
    scene.add(floor);

    // Dartboard (bullseye rings) — far end
    const boardGroup=new THREE.Group();
    boardGroup.position.set(0,0,-10);
    const ringColors=[0x22c55e,0xff0000,0x22c55e,0xff0000,0xfbbf24];
    const radii=[1.0,0.85,0.65,0.45,0.18];
    radii.forEach((r,i)=>{
      const geo=new THREE.CircleGeometry(r,32);
      const mat=new THREE.MeshStandardMaterial({color:ringColors[i],side:THREE.FrontSide,roughness:0.5});
      const m=new THREE.Mesh(geo,mat);
      m.position.z=i*0.01;
      boardGroup.add(m);
    });
    // Board backing
    const backGeo=new THREE.CylinderGeometry(1.1,1.1,0.15,24);
    const backMat=new THREE.MeshStandardMaterial({color:0x1a1a1a,metalness:0.3});
    const back=new THREE.Mesh(backGeo,backMat);
    back.rotation.x=Math.PI/2;back.position.z=-0.1;
    boardGroup.add(back);
    scene.add(boardGroup);

    // Landing zones (colored bars on floor)
    const zones=[{x:-2,color:0x3b82f6,pts:1},{x:0,color:0x22c55e,pts:3},{x:2,color:0xfbbf24,pts:5}];
    zones.forEach(z=>{
      const geo=new THREE.PlaneGeometry(1.5,0.2);
      const mat=new THREE.MeshStandardMaterial({color:z.color,transparent:true,opacity:0.6});
      const m=new THREE.Mesh(geo,mat);
      m.rotation.x=-Math.PI/2;m.position.set(z.x,-0.99,-5);
      scene.add(m);
    });

    // Dart mesh
    const dartGroup=new THREE.Group();
    const bodyGeo=new THREE.CylinderGeometry(0.04,0.04,0.7,8);
    const bodyMat=new THREE.MeshStandardMaterial({color:0xef4444,metalness:0.7,roughness:0.3});
    dartGroup.add(new THREE.Mesh(bodyGeo,bodyMat));
    const tipGeo=new THREE.ConeGeometry(0.04,0.25,8);
    const tipMat=new THREE.MeshStandardMaterial({color:0xfbbf24,metalness:0.8,roughness:0.2});
    const tip=new THREE.Mesh(tipGeo,tipMat);tip.position.y=0.47;dartGroup.add(tip);
    const finGeo=new THREE.ConeGeometry(0.12,0.3,4);
    const finMat=new THREE.MeshStandardMaterial({color:0x1e40af,metalness:0.4,roughness:0.5,transparent:true,opacity:0.8});
    const fin=new THREE.Mesh(finGeo,finMat);fin.position.y=-0.5;fin.rotation.z=Math.PI;dartGroup.add(fin);
    dartGroup.position.set(-2.5,0.5,4);
    dartGroup.rotation.z=-Math.PI/4;
    scene.add(dartGroup);
    dartMeshRef.current=dartGroup;

    // Player silhouette
    const playerGroup=new THREE.Group();
    const bodyMat2=new THREE.MeshStandardMaterial({color:0xfed7aa});
    // body
    playerGroup.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.3,1.4,8),bodyMat2),{position:{set:()=>{}}}) );
    playerGroup.position.set(-2.5,0,3);
    scene.add(playerGroup);
    playerRef.current=playerGroup;

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

      // Update charge
      if(s.charging)s.chargeLevel=Math.min(1,(Date.now()-s.chargeStart)/1500);

      // Animate dart
      const dart=dartMeshRef.current;
      if(dart&&s.inFlight){
        s.dartPos.x+=s.dartVel.x;s.dartPos.y+=s.dartVel.y;s.dartPos.z+=s.dartVel.z;
        s.dartVel.y-=0.01;
        dart.position.copy(s.dartPos);
        dart.rotation.z=Math.atan2(s.dartVel.y,Math.abs(s.dartVel.z));
        if(s.dartPos.z<-9){
          s.inFlight=false;
          // Score hit
          const dx=Math.abs(s.dartPos.x-0);
          let pts=0;
          if(dx<0.2)pts=5;else if(dx<0.45)pts=3;else if(dx<0.75)pts=1;
          const isOptimal=s.chargeLevel>=0.7&&s.chargeLevel<=0.85;
          const isGood=s.chargeLevel>=0.5;
          s.sig.totalAttempts++;
          if(isOptimal)s.sig.perfectAttempts++;else if(isGood)s.sig.goodAttempts++;
          if(pts>0){
            s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;
            const mult=s.sig.streakCurrent>=3?2:1;
            s.sig.score+=pts*mult;setScore(s.sig.score);
            if(pts>=5){sfx.success();hapticScore();s.resultFlash=30;}else{sfx.collect();hapticScore();}
          } else {
            sfx.collision();hapticFail();s.sig.streakCurrent=0;
          }
          hapticImpact();
          // Reset dart position
          setTimeout(()=>{ if(dart)dart.position.set(-2.5,0.5,4);},800);
        }
      }

      // Aim drift
      if(!s.inFlight&&!s.charging&&dart){
        dart.position.x=-2.5+Math.sin(t*0.8)*0.1;
        dart.position.y=0.5+Math.sin(t*1.2)*0.05;
      }

      // Result flash
      if(s.resultFlash>0){s.resultFlash--;
        const flashMat=new THREE.MeshBasicMaterial({color:0xfbbf24,transparent:true,opacity:s.resultFlash/30*0.3});
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
    timerRef.current=setInterval(()=>{
      const s2=stateRef.current;s2.timeLeft--;setTimeLeft(s2.timeLeft);
      if(s2.timeLeft<=0){sfx.fail();endGame();}
    },1000);
  },[endGame]);

  useEffect(()=>{
    const mount=mountRef.current;if(!mount)return;
    const onDown=()=>{
      if(phase!=='playing')return;
      const s=stateRef.current;if(s.inFlight)return;
      s.charging=true;s.chargeStart=Date.now();
    };
    const onUp=()=>{
      if(phase!=='playing')return;
      const s=stateRef.current;if(!s.charging)return;
      s.charging=false;
      const dart=dartMeshRef.current;if(!dart)return;
      const speed=4+s.chargeLevel*10;
      s.dartPos.set(-2.5,0.5,4);
      s.dartVel.set(0.15,speed*0.15,-speed);
      s.inFlight=true;
      s.chargeLevel=0;setCharge(0);
      sfx.whoosh();hapticImpact();
    };
    const onMove=()=>{
      if(phase==='playing')setCharge(stateRef.current.chargeLevel);
    };
    mount.addEventListener('pointerdown',onDown);
    mount.addEventListener('pointerup',onUp);
    mount.addEventListener('pointermove',onMove);
    return()=>{mount.removeEventListener('pointerdown',onDown);mount.removeEventListener('pointerup',onUp);mount.removeEventListener('pointermove',onMove);};
  },[phase]);

  // Charge level display update
  useEffect(()=>{
    const iv=setInterval(()=>{
      if(phase==='playing')setCharge(stateRef.current.chargeLevel);
    },50);
    return()=>clearInterval(iv);
  },[phase]);

  useEffect(()=>()=>{cancelAnimationFrame(rafRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);
  const handleStart=useCallback(async(name:string,avatar:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);await initAudio();setPhase('countdown');},[]);
  const handleCountdownDone=useCallback(()=>{startLoop();},[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScore(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  const meterColor=chargeLevel>0.8?'#ef4444':chargeLevel>0.5?'#fbbf24':accent;

  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Go! 🎯" accentColor={accent} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accent}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <>
          <div ref={mountRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
          {phase==='playing'&&(
            <>
              <GameHUD accentColor={accent} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>
              {/* Charge meter */}
              <div style={{position:'absolute',bottom:80,left:'50%',transform:'translateX(-50%)',width:'min(280px,75%)',display:'flex',flexDirection:'column',gap:6,alignItems:'center'}}>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.5)',fontWeight:700,letterSpacing:'0.1em'}}>HOLD TO CHARGE</div>
                <div style={{width:'100%',height:14,borderRadius:7,background:'rgba(255,255,255,0.08)',overflow:'hidden',border:'1px solid rgba(255,255,255,0.1)'}}>
                  <div style={{height:'100%',borderRadius:7,background:meterColor,width:`${chargeLevel*100}%`,transition:'width 50ms',boxShadow:`0 0 8px ${meterColor}`}}/>
                </div>
                <div style={{fontSize:11,color:'rgba(74,222,128,0.7)',fontWeight:600}}>
                  {chargeLevel>=0.7&&chargeLevel<=0.85?'🎯 SWEET SPOT!':''}
                </div>
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
