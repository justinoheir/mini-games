'use client';
/**
 * COSMIC CATCH — 3D: float through space and swipe glowing stars before they fade.
 * Deep space environment with nebula clouds, planets in background, and 3D stars.
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

const GAME_ID    = 'cosmic-catch';
const ACCENT     = '#6366f1';
const DURATION   = 30;
const GAME_EMOJI = '⭐';
const GAME_TITLE = 'Cosmic Catch';
const GAME_TAGLINE = 'Swipe the stars before they fade.';

type StarType = 'common'|'rare'|'super';
const STAR_CONFIG: Record<StarType,{pts:number;threeColor:number;r:number}> = {
  common: {pts:1,threeColor:0xa5b4fc,r:0.25},
  rare:   {pts:3,threeColor:0xfbbf24,r:0.38},
  super:  {pts:5,threeColor:0xf472b6,r:0.55},
};
const STAR_TYPES: StarType[] = ['common','rare','super'];

interface Star3D {
  id:number; type:StarType; mesh:THREE.Mesh; lifespan:number; age:number;
  caught:boolean; flashT:number; vx:number; vy:number;
}

interface Signals {
  starsCaught:number; raresCaught:number; supersCaught:number;
  missed:number; maxStreak:number; streakCurrent:number; score:number;
}

function getPersonality(s:Signals):string {
  if(s.supersCaught>=3&&s.raresCaught>=5) return 'Cosmic Champion 🌌';
  if(s.starsCaught>=20)                   return 'Star Collector ⭐';
  if(s.missed>=10)                        return 'Too Slow! 🐢';
  if(s.maxStreak>=8)                      return 'Constellation King 👑';
  return 'Space Cadet 🚀';
}

type Phase = 'start'|'countdown'|'playing'|'done';
interface GS {
  running:boolean;timeLeft:number;sig:Signals;
  stars:Star3D[];nextId:number;spawnTimer:number;
  accentColor:string;
}

export default function CosmicCatchGame() {
  const theme = useBrandTheme();
  const accent = theme.colors.accent ?? ACCENT;

  const mountRef    = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer|null>(null);
  const sceneRef    = useRef<THREE.Scene|null>(null);
  const cameraRef   = useRef<THREE.PerspectiveCamera|null>(null);
  const rafRef      = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setInterval>|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{starsCaught:0,raresCaught:0,supersCaught:0,missed:0,maxStreak:0,streakCurrent:0,score:0},
    stars:[],nextId:0,spawnTimer:0,accentColor:ACCENT,
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
    renderer.setSize(W,H);renderer.setClearColor(0x020612);
    mount.appendChild(renderer.domElement);
    rendererRef.current=renderer;

    const scene=new THREE.Scene();
    sceneRef.current=scene;

    const camera=new THREE.PerspectiveCamera(70,W/H,0.1,100);
    camera.position.set(0,0,8);
    cameraRef.current=camera;

    scene.add(new THREE.AmbientLight(0xffffff,0.3));
    const pl=new THREE.PointLight(0x6366f1,4,20);
    pl.position.set(0,3,5);scene.add(pl);
    const pl2=new THREE.PointLight(0xf472b6,2,15);
    pl2.position.set(-3,-2,3);scene.add(pl2);

    // Background nebula spheres
    const nebColors=[0x312e81,0x4c1d95,0x1e1b4b,0x0c4a6e];
    for(let i=0;i<8;i++){
      const geo=new THREE.SphereGeometry(1.5+Math.random()*2,16,16);
      const mat=new THREE.MeshStandardMaterial({color:nebColors[i%nebColors.length],transparent:true,opacity:0.08+Math.random()*0.08,roughness:1});
      const m=new THREE.Mesh(geo,mat);
      m.position.set((Math.random()-0.5)*14,(Math.random()-0.5)*10,(Math.random()-0.5)*4-5);
      scene.add(m);
    }

    // Background planets
    const planetColors=[0x4338ca,0x7c3aed,0xbe185d];
    for(let i=0;i<3;i++){
      const geo=new THREE.SphereGeometry(0.6+Math.random()*0.5,20,20);
      const mat=new THREE.MeshStandardMaterial({color:planetColors[i],metalness:0.2,roughness:0.6,emissive:planetColors[i],emissiveIntensity:0.2});
      const m=new THREE.Mesh(geo,mat);
      m.position.set(-4+i*4,(Math.random()-0.5)*3,-(Math.random()*3+2));
      scene.add(m);
    }

    // Star field
    const sgeo=new THREE.BufferGeometry();
    const sp=new Float32Array(500*3);
    for(let i=0;i<500;i++){sp[i*3]=(Math.random()-0.5)*24;sp[i*3+1]=(Math.random()-0.5)*24;sp[i*3+2]=(Math.random()-0.5)*8-5;}
    sgeo.setAttribute('position',new THREE.BufferAttribute(sp,3));
    scene.add(new THREE.Points(sgeo,new THREE.PointsMaterial({color:0xc7d2fe,size:0.06,sizeAttenuation:true})));

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

      // Update stars
      const scene2=sceneRef.current;
      if(scene2){
        for(let i=s.stars.length-1;i>=0;i--){
          const star=s.stars[i];
          star.age++;
          if(star.caught){
            star.flashT++;
            star.mesh.scale.setScalar(1+star.flashT*0.08);
            (star.mesh.material as THREE.MeshStandardMaterial).opacity=1-star.flashT/15;
            if(star.flashT>15){scene2.remove(star.mesh);s.stars.splice(i,1);}
            continue;
          }
          // Float
          star.mesh.position.x+=star.vx;
          star.mesh.position.y+=star.vy;
          star.mesh.rotation.y+=0.04;
          star.mesh.rotation.x+=0.02;
          // Fade
          const life=star.age/star.lifespan;
          const alpha=life<0.15?life/0.15:life>0.75?1-(life-0.75)/0.25:1;
          (star.mesh.material as THREE.MeshStandardMaterial).opacity=alpha*0.9;
          (star.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity=0.5+Math.sin(t*4+i)*0.3;
          if(star.age>=star.lifespan){
            scene2.remove(star.mesh);s.stars.splice(i,1);
            if(s.running){s.sig.missed++;s.sig.streakCurrent=0;}
          }
        }
      }

      // Camera drift
      camera.position.x=Math.sin(t*0.18)*0.4;
      camera.position.y=Math.cos(t*0.12)*0.25;
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
    const sig={...s.sig};
    const pb=parseInt(localStorage.getItem(`pb_${GAME_ID}`)??'0');
    if(sig.score>pb)localStorage.setItem(`pb_${GAME_ID}`,String(sig.score));
    setFinalSig(sig);setPhase('done');hapticVictory();
  },[]);

  const spawnStar=useCallback(()=>{
    const scene=sceneRef.current;if(!scene)return;
    const s=stateRef.current;
    const r=Math.random();
    const type:StarType=r<0.6?'common':r<0.9?'rare':'super';
    const cfg=STAR_CONFIG[type];
    const geo=new THREE.SphereGeometry(cfg.r,14,14);
    const mat=new THREE.MeshStandardMaterial({
      color:cfg.threeColor,metalness:0.3,roughness:0.35,
      emissive:cfg.threeColor,emissiveIntensity:0.6,
      transparent:true,opacity:0.9,
    });
    const mesh=new THREE.Mesh(geo,mat);
    mesh.position.set((Math.random()-0.5)*7,(Math.random()-0.5)*5,Math.random()*1.5);
    mesh.userData.isStar=true;
    scene.add(mesh);
    s.stars.push({
      id:s.nextId++,type,mesh,
      lifespan:90+Math.floor(Math.random()*60),age:0,
      caught:false,flashT:0,
      vx:(Math.random()-0.5)*0.015,vy:(Math.random()-0.5)*0.015,
    });
  },[]);

  const startLoop=useCallback(()=>{
    const s=stateRef.current;
    s.running=true;s.timeLeft=DURATION;
    s.sig={starsCaught:0,raresCaught:0,supersCaught:0,missed:0,maxStreak:0,streakCurrent:0,score:0};
    s.stars=[];s.nextId=0;s.spawnTimer=0;
    setScore(0);setTimeLeft(DURATION);setPhase('playing');

    timerRef.current=setInterval(()=>{
      const s2=stateRef.current;s2.timeLeft--;setTimeLeft(s2.timeLeft);
      if(s2.timeLeft<=0){sfx.fail();endGame();}
    },1000);

    // Spawn loop
    let spawnF=0;
    const spawnLoop=()=>{
      if(!stateRef.current.running)return;
      spawnF++;
      if(spawnF%50===0)spawnStar();
      requestAnimationFrame(spawnLoop);
    };
    spawnLoop();
  },[endGame,spawnStar]);

  // Swipe/tap to catch stars
  useEffect(()=>{
    const mount=mountRef.current;if(!mount)return;
    let swipeStartX=0,swipeStartY=0;

    const catchAt=(cx:number,cy:number)=>{
      const s=stateRef.current;if(!s.running)return;
      const renderer=rendererRef.current;const camera=cameraRef.current;const scene=sceneRef.current;
      if(!renderer||!camera||!scene)return;
      const rect=mount.getBoundingClientRect();
      const x=((cx-rect.left)/rect.width)*2-1;
      const y=-((cy-rect.top)/rect.height)*2+1;
      const raycaster=new THREE.Raycaster();
      raycaster.params.Points={threshold:0.5};
      raycaster.setFromCamera(new THREE.Vector2(x,y),camera);
      const meshes=s.stars.filter(st=>!st.caught).map(st=>st.mesh);
      const hits=raycaster.intersectObjects(meshes);
      if(hits.length>0){
        const hitMesh=hits[0].object as THREE.Mesh;
        const star=s.stars.find(st=>st.mesh===hitMesh);
        if(star&&!star.caught){
          star.caught=true;
          s.sig.starsCaught++;
          if(star.type==='rare')s.sig.raresCaught++;
          if(star.type==='super')s.sig.supersCaught++;
          s.sig.streakCurrent++;
          if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;
          const mult=s.sig.streakCurrent>=5?2:1;
          const pts=STAR_CONFIG[star.type].pts*mult;
          s.sig.score+=pts;setScore(s.sig.score);
          sfx.collect();if(star.type==='super')hapticCombo();else hapticScore();
          const mat=hitMesh.material as THREE.MeshStandardMaterial;
          mat.emissive.setHex(0xffffff);mat.emissiveIntensity=3;
          mat.transparent=true;
        }
      }
    };

    const onPointerDown=(e:PointerEvent)=>{
      if(phase!=='playing')return;
      swipeStartX=e.clientX;swipeStartY=e.clientY;
      catchAt(e.clientX,e.clientY);
    };
    const onPointerMove=(e:PointerEvent)=>{
      if(phase!=='playing'||!(e.buttons&1))return;
      catchAt(e.clientX,e.clientY);
    };

    mount.addEventListener('pointerdown',onPointerDown);
    mount.addEventListener('pointermove',onPointerMove);
    return()=>{
      mount.removeEventListener('pointerdown',onPointerDown);
      mount.removeEventListener('pointermove',onPointerMove);
    };
  },[phase]);

  useEffect(()=>()=>{cancelAnimationFrame(rafRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);

  const handleStart=useCallback((name:string,avatar:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);initAudio();setPhase('countdown');
  },[]);
  const handleCountdownDone=useCallback(()=>{startLoop();},[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScore(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Launch! 🚀" accentColor={accent} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accent}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <>
          <div ref={mountRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
          {phase==='playing'&&<GameHUD accentColor={accent} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5},{label:'SCORE',value:scoreDisplay}]}/>}
        </>
      )}
      {phase==='done'&&finalSig&&(
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            {label:'Stars Caught',value:String(finalSig.starsCaught),color:finalSig.starsCaught>=15?'#4ade80':'#facc15'},
            {label:'Supers',value:String(finalSig.supersCaught),color:'#f472b6'},
            {label:'Max Streak',value:`×${finalSig.maxStreak}`,color:'#fbbf24'},
            {label:'Missed',value:String(finalSig.missed),color:finalSig.missed<=3?'#4ade80':'#ef4444'},
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.starsCaught>=10}/>
      )}
    </GameShell>
  );
}
