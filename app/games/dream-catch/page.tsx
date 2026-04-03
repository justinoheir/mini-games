'use client';
/**
 * DREAM CATCH — 3D: guide a glowing dreamcatcher through a nebula.
 * Catch drifting dream fragments: stars, moons, feathers, bubbles.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID    = 'dream-catch';
const ACCENT     = '#818cf8';
const DURATION   = 60;
const GAME_EMOJI = '🌙';
const GAME_TITLE = 'Dream Catch';
const GAME_TAGLINE = 'Float through. Catch the fragments.';

type FragType='star'|'moon'|'cloud'|'feather'|'bubble';
const FRAG_CONFIG:Record<FragType,{pts:number;threeColor:number;r:number}> = {
  star:    {pts:3,threeColor:0xfbbf24,r:0.28},
  moon:    {pts:2,threeColor:0x818cf8,r:0.26},
  cloud:   {pts:1,threeColor:0x94a3b8,r:0.22},
  feather: {pts:2,threeColor:0xa5f3fc,r:0.18},
  bubble:  {pts:1,threeColor:0x7dd3fc,r:0.24},
};
const FRAG_TYPES:FragType[]=['star','moon','cloud','feather','bubble'];

interface Frag3D {
  id:number; type:FragType; mesh:THREE.Mesh; vx:number; vy:number;
  age:number; lifespan:number; caught:boolean; flashT:number;
}

interface Signals {
  fragmentsCaught:number; starsCaught:number; missed:number;
  maxStreak:number; streakCurrent:number; score:number;
}

function getPersonality(s:Signals):string {
  if(s.starsCaught>=8&&s.missed<=3) return 'Dream Weaver 🌟';
  if(s.fragmentsCaught>=25)         return 'Night Collector 🌙';
  if(s.missed>=15)                  return 'Heavy Sleeper 😴';
  if(s.maxStreak>=8)                return 'Lucid Dreamer ✨';
  return 'Dream Walker 🌀';
}

type Phase='start'|'countdown'|'playing'|'done';
interface GS {
  running:boolean; timeLeft:number; sig:Signals;
  frags:Frag3D[]; nextId:number; spawnTimer:number;
  catcherX:number; catcherY:number;
  targetCatcherX:number; targetCatcherY:number;
  accentColor:string;
}

export default function DreamCatchGame() {
  const theme = useBrandTheme();
  const accent = theme.colors.accent ?? ACCENT;

  const mountRef      = useRef<HTMLDivElement>(null);
  const rendererRef   = useRef<THREE.WebGLRenderer|null>(null);
  const sceneRef      = useRef<THREE.Scene|null>(null);
  const cameraRef     = useRef<THREE.PerspectiveCamera|null>(null);
  const rafRef        = useRef(0);
  const timerRef      = useRef<ReturnType<typeof setInterval>|null>(null);
  const catcherMeshRef= useRef<THREE.Group|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{fragmentsCaught:0,starsCaught:0,missed:0,maxStreak:0,streakCurrent:0,score:0},
    frags:[],nextId:0,spawnTimer:0,
    catcherX:0,catcherY:0,targetCatcherX:0,targetCatcherY:0,
    accentColor:ACCENT,
  });

  const [phase,setPhase]        = useState<Phase>('start');
  const [timeLeft,setTimeLeft]  = useState(DURATION);
  const [scoreDisplay,setScore] = useState(0);
  const [finalSig,setFinalSig]  = useState<Signals|null>(null);

  useEffect(()=>{stateRef.current.accentColor=accent;},[accent]);

  // ── Three.js setup ──────────────────────────────────────────────────────
  useEffect(()=>{
    if(!mountRef.current)return;
    const mount=mountRef.current;
    const W=mount.clientWidth||window.innerWidth;const H=mount.clientHeight||window.innerHeight;

    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(W,H);renderer.setClearColor(0x02000f);
    mount.appendChild(renderer.domElement);
    rendererRef.current=renderer;

    const scene=new THREE.Scene();
    sceneRef.current=scene;

    const camera=new THREE.PerspectiveCamera(65,W/H,0.1,50);
    camera.position.set(0,0,10);
    cameraRef.current=camera;

    scene.add(new THREE.AmbientLight(0xffffff,0.25));
    const pl=new THREE.PointLight(0x818cf8,3,20);pl.position.set(0,3,6);scene.add(pl);
    const pl2=new THREE.PointLight(0xc084fc,2,12);pl2.position.set(-3,-2,4);scene.add(pl2);

    // Nebula clouds
    for(let i=0;i<10;i++){
      const geo=new THREE.SphereGeometry(1+Math.random()*2,8,8);
      const mat=new THREE.MeshStandardMaterial({
        color:new THREE.Color().setHSL(0.72+Math.random()*0.1,0.7,0.3),
        transparent:true,opacity:0.06+Math.random()*0.06,roughness:1,
      });
      const m=new THREE.Mesh(geo,mat);
      m.position.set((Math.random()-0.5)*14,(Math.random()-0.5)*10,(Math.random()-0.5)*4-5);
      scene.add(m);
    }

    // Star field
    const sg=new THREE.BufferGeometry();const sp=new Float32Array(400*3);
    for(let i=0;i<400;i++){sp[i*3]=(Math.random()-0.5)*22;sp[i*3+1]=(Math.random()-0.5)*22;sp[i*3+2]=(Math.random()-0.5)*8-5;}
    sg.setAttribute('position',new THREE.BufferAttribute(sp,3));
    scene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0xc7d2fe,size:0.05,sizeAttenuation:true,transparent:true,opacity:0.7})));

    // Dreamcatcher
    const catcherGroup=new THREE.Group();
    // Ring
    const ringGeo=new THREE.TorusGeometry(0.7,0.06,8,32);
    const ringMat=new THREE.MeshStandardMaterial({color:0x818cf8,emissive:0x818cf8,emissiveIntensity:0.8,metalness:0.4,roughness:0.3});
    catcherGroup.add(new THREE.Mesh(ringGeo,ringMat));
    // Web lines
    for(let i=0;i<8;i++){
      const angle=(i/8)*Math.PI*2;
      const lg=new THREE.CylinderGeometry(0.015,0.015,0.65,4);
      const lm=new THREE.MeshStandardMaterial({color:0xc084fc,transparent:true,opacity:0.5});
      const line=new THREE.Mesh(lg,lm);
      line.rotation.z=angle;line.position.set(Math.cos(angle)*0.33,Math.sin(angle)*0.33,0);
      catcherGroup.add(line);
    }
    // Feathers
    for(let i=0;i<3;i++){
      const fGeo=new THREE.ConeGeometry(0.08,0.4,6);
      const fMat=new THREE.MeshStandardMaterial({color:0xa5f3fc,emissive:0x818cf8,emissiveIntensity:0.5,transparent:true,opacity:0.8});
      const f=new THREE.Mesh(fGeo,fMat);
      f.position.set(-0.2+i*0.2,-0.9-i*0.2,0);f.rotation.z=Math.PI;catcherGroup.add(f);
    }
    scene.add(catcherGroup);catcherMeshRef.current=catcherGroup;

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
      const scene2=sceneRef.current;if(!scene2)return;

      // Move catcher
      s.catcherX+=(s.targetCatcherX-s.catcherX)*0.12;
      s.catcherY+=(s.targetCatcherY-s.catcherY)*0.12;
      if(catcherMeshRef.current){
        catcherMeshRef.current.position.set(s.catcherX,s.catcherY,1);
        catcherMeshRef.current.rotation.y+=0.02;
        catcherMeshRef.current.rotation.z=Math.sin(t*1.5)*0.08;
      }

      // Spawn fragments
      s.spawnTimer--;
      if(s.spawnTimer<=0&&s.running){
        s.spawnTimer=Math.max(20,60-frame/100);
        const type=FRAG_TYPES[Math.floor(Math.random()*FRAG_TYPES.length)];
        const cfg=FRAG_CONFIG[type];
        let geo:THREE.BufferGeometry;
        if(type==='star')geo=new THREE.OctahedronGeometry(cfg.r,0);
        else if(type==='moon')geo=new THREE.TorusGeometry(cfg.r,cfg.r*0.4,6,12);
        else if(type==='feather')geo=new THREE.ConeGeometry(cfg.r*0.5,cfg.r*2,6);
        else geo=new THREE.SphereGeometry(cfg.r,10,10);
        const mat=new THREE.MeshStandardMaterial({color:cfg.threeColor,emissive:cfg.threeColor,emissiveIntensity:0.7,transparent:true,opacity:0.9,metalness:0.2,roughness:0.4});
        const mesh=new THREE.Mesh(geo,mat);
        mesh.position.set((Math.random()-0.5)*8,(Math.random()-0.5)*6,Math.random());
        scene2.add(mesh);
        s.frags.push({id:s.nextId++,type,mesh,vx:(Math.random()-0.5)*0.02,vy:(Math.random()-0.5)*0.015,age:0,lifespan:150+Math.floor(Math.random()*80),caught:false,flashT:0});
      }

      // Update fragments
      for(let i=s.frags.length-1;i>=0;i--){
        const f=s.frags[i];
        f.age++;
        if(f.caught){
          f.flashT++;f.mesh.scale.setScalar(1+f.flashT*0.08);
          (f.mesh.material as THREE.MeshStandardMaterial).opacity=1-f.flashT/14;
          if(f.flashT>14){scene2.remove(f.mesh);s.frags.splice(i,1);}
          continue;
        }
        f.mesh.position.x+=f.vx;f.mesh.position.y+=f.vy;
        f.mesh.rotation.y+=0.04;f.mesh.rotation.x+=0.03;
        const life=f.age/f.lifespan;
        const alpha=life<0.15?life/0.15:life>0.75?1-(life-0.75)/0.25:1;
        (f.mesh.material as THREE.MeshStandardMaterial).opacity=alpha*0.9;
        (f.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity=0.7+Math.sin(t*3+f.id)*0.3;

        // Collision with catcher
        const cx=s.catcherX;const cy=s.catcherY;
        const fdx=f.mesh.position.x-cx;const fdy=f.mesh.position.y-cy;
        const dist=Math.sqrt(fdx*fdx+fdy*fdy);
        if(dist<0.9&&s.running){
          f.caught=true;s.sig.fragmentsCaught++;
          if(f.type==='star')s.sig.starsCaught++;
          s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;
          const mult=s.sig.streakCurrent>=5?2:1;
          s.sig.score+=FRAG_CONFIG[f.type].pts*mult;setScore(s.sig.score);
          sfx.collect();if(f.type==='star')hapticCombo();else hapticScore();
          const mat=f.mesh.material as THREE.MeshStandardMaterial;
          mat.emissive.setHex(0xffffff);mat.emissiveIntensity=3;
          continue;
        }

        if(f.age>=f.lifespan){
          scene2.remove(f.mesh);s.frags.splice(i,1);
          if(s.running){s.sig.missed++;s.sig.streakCurrent=0;}
        }
      }

      // Camera gentle drift
      camera.position.x=Math.sin(t*0.15)*0.3;camera.position.y=Math.cos(t*0.1)*0.2;
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
    s.sig={fragmentsCaught:0,starsCaught:0,missed:0,maxStreak:0,streakCurrent:0,score:0};
    s.frags=[];s.nextId=0;s.spawnTimer=30;s.catcherX=0;s.catcherY=0;
    setScore(0);setTimeLeft(DURATION);setPhase('playing');

    timerRef.current=setInterval(()=>{
      const s2=stateRef.current;s2.timeLeft--;setTimeLeft(s2.timeLeft);
      if(s2.timeLeft<=0){sfx.fail();endGame();}
    },1000);
  },[endGame]);

  // Pointer input
  useEffect(()=>{
    const mount=mountRef.current;if(!mount)return;
    const onMove=(e:PointerEvent)=>{
      if(phase!=='playing')return;
      const rect=mount.getBoundingClientRect();
      stateRef.current.targetCatcherX=((e.clientX-rect.left)/rect.width-0.5)*9;
      stateRef.current.targetCatcherY=-((e.clientY-rect.top)/rect.height-0.5)*7;
    };
    const onTouch=(e:TouchEvent)=>{
      if(phase!=='playing')return;
      const rect=mount.getBoundingClientRect();
      stateRef.current.targetCatcherX=((e.touches[0].clientX-rect.left)/rect.width-0.5)*9;
      stateRef.current.targetCatcherY=-((e.touches[0].clientY-rect.top)/rect.height-0.5)*7;
    };
    mount.addEventListener('pointermove',onMove);mount.addEventListener('touchmove',onTouch,{passive:true});
    return()=>{mount.removeEventListener('pointermove',onMove);mount.removeEventListener('touchmove',onTouch);};
  },[phase]);

  useEffect(()=>()=>{cancelAnimationFrame(rafRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);
  const handleStart=useCallback((name:string,avatar:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);initAudio();setPhase('countdown');},[]);
  const handleCountdownDone=useCallback(()=>{startLoop();},[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScore(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Float In 🌙" accentColor={accent} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accent}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <>
          <div ref={mountRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
          {phase==='playing'&&(
            <>
              <GameHUD accentColor={accent} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>
              <div style={{position:'absolute',bottom:40,left:'50%',transform:'translateX(-50%)',fontSize:12,color:'rgba(255,255,255,0.4)',fontWeight:600,letterSpacing:'0.1em'}}>DRAG TO FLOAT THE DREAMCATCHER</div>
            </>
          )}
        </>
      )}
      {phase==='done'&&finalSig&&(
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            {label:'Fragments',value:String(finalSig.fragmentsCaught),color:finalSig.fragmentsCaught>=20?'#4ade80':'#facc15'},
            {label:'Stars',value:String(finalSig.starsCaught),color:'#fbbf24'},
            {label:'Max Streak',value:`×${finalSig.maxStreak}`,color:accent},
            {label:'Missed',value:String(finalSig.missed),color:finalSig.missed<=5?'#4ade80':'#ef4444'},
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.fragmentsCaught>=20}/>
      )}
    </GameShell>
  );
}
