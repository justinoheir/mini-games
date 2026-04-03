'use client';
/**
 * CRYSTAL CATCH — 3D: tilt/drag a glowing basket to catch falling 3D crystals.
 * Avoid the red ones! Deep indigo space cave environment.
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

const GAME_ID = 'crystal-catch';
const ACCENT = '#818cf8';
const DURATION = 45;
const GAME_EMOJI = '💎';
const GAME_TITLE = 'Crystal Catch';
const GAME_TAGLINE = "Tilt and collect. Don't shatter them.";

interface Signals {
  totalCrystals:number; caught:number; shattered:number; dangerous:number;
  maxStreak:number; streakCurrent:number; score:number; maxTiltAngle:number;
}

function getPersonality(sig:Signals):string {
  const acc=sig.totalCrystals>0?sig.caught/sig.totalCrystals:0;
  if(acc>=0.9&&sig.shattered===0) return 'Crystal Guardian 💎';
  if(sig.caught>=30)              return 'Gem Collector 💜';
  if(sig.maxStreak>=8)            return 'Combo Catcher ✨';
  if(acc>=0.6)                    return 'Careful Handler 🤲';
  return 'Clumsy Gatherer 🙈';
}

type Phase = 'start'|'countdown'|'playing'|'done';

const CRYSTAL_COLORS = [0x818cf8, 0xa78bfa, 0xc084fc, 0xe879f9, 0x38bdf8];
const DANGER_COLOR   = 0xef4444;

interface Crystal3D {
  id:number; dangerous:boolean; mesh:THREE.Mesh; speed:number; caught:boolean; flashT:number;
}

interface GS {
  running:boolean; timeLeft:number; sig:Signals;
  crystals:Crystal3D[]; nextId:number; frame:number;
  basketX:number; tiltX:number;
  floats:Array<{x:number;y:number;text:string;alpha:number;vy:number}>;
}

export default function CrystalCatch() {
  const theme = useBrandTheme();
  const accent = theme.colors.accent ?? ACCENT;

  const mountRef    = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer|null>(null);
  const sceneRef    = useRef<THREE.Scene|null>(null);
  const cameraRef   = useRef<THREE.PerspectiveCamera|null>(null);
  const basketRef   = useRef<THREE.Group|null>(null);
  const rafRef      = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setInterval>|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{totalCrystals:0,caught:0,shattered:0,dangerous:0,maxStreak:0,streakCurrent:0,score:0,maxTiltAngle:0},
    crystals:[],nextId:0,frame:0,
    basketX:0,tiltX:0,floats:[],
  });

  const [phase,setPhase]        = useState<Phase>('start');
  const [timeLeft,setTimeLeft]  = useState(DURATION);
  const [scoreDisplay,setScore] = useState(0);
  const [finalSig,setFinalSig]  = useState<Signals|null>(null);

  // ── Three.js setup ──────────────────────────────────────────────────────
  useEffect(()=>{
    if(!mountRef.current)return;
    const mount=mountRef.current;
    const W=mount.clientWidth||window.innerWidth;const H=mount.clientHeight||window.innerHeight;

    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(W,H);renderer.setClearColor(0x020212);
    mount.appendChild(renderer.domElement);
    rendererRef.current=renderer;

    const scene=new THREE.Scene();
    sceneRef.current=scene;

    const camera=new THREE.PerspectiveCamera(70,W/H,0.1,50);
    camera.position.set(0,0,10);
    cameraRef.current=camera;

    scene.add(new THREE.AmbientLight(0xffffff,0.3));
    const pl=new THREE.PointLight(0x818cf8,4,20);
    pl.position.set(0,4,6);scene.add(pl);
    const pl2=new THREE.PointLight(0xe879f9,2,15);
    pl2.position.set(3,-2,4);scene.add(pl2);

    // Cave stalactites
    for(let i=0;i<10;i++){
      const h=0.8+Math.random()*1.2;
      const geo=new THREE.ConeGeometry(0.15,h,6);
      const mat=new THREE.MeshStandardMaterial({color:CRYSTAL_COLORS[i%CRYSTAL_COLORS.length],emissive:CRYSTAL_COLORS[i%CRYSTAL_COLORS.length],emissiveIntensity:0.2,metalness:0.3,roughness:0.5});
      const m=new THREE.Mesh(geo,mat);
      m.position.set(-4.5+i*1,(6-h/2),(Math.random()-0.5)*2-2);
      m.rotation.z=Math.PI;
      scene.add(m);
    }

    // Background stars
    const sg=new THREE.BufferGeometry();
    const sp=new Float32Array(300*3);
    for(let i=0;i<300;i++){sp[i*3]=(Math.random()-0.5)*20;sp[i*3+1]=(Math.random()-0.5)*20;sp[i*3+2]=(Math.random()-0.5)*6-5;}
    sg.setAttribute('position',new THREE.BufferAttribute(sp,3));
    scene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0xc7d2fe,size:0.05,sizeAttenuation:true})));

    // Basket
    const basket=new THREE.Group();
    const rimGeo=new THREE.TorusGeometry(1,0.06,6,20);
    const rimMat=new THREE.MeshStandardMaterial({color:0x818cf8,emissive:0x818cf8,emissiveIntensity:0.8,metalness:0.5,roughness:0.3});
    basket.add(new THREE.Mesh(rimGeo,rimMat));
    // Basket net lines
    for(let i=0;i<6;i++){
      const lineGeo=new THREE.CylinderGeometry(0.02,0.02,0.7,4);
      const lineMat=new THREE.MeshStandardMaterial({color:0x818cf8,transparent:true,opacity:0.6});
      const line=new THREE.Mesh(lineGeo,lineMat);
      const angle=(i/6)*Math.PI*2;
      line.position.set(Math.cos(angle)*0.7,-0.35,Math.sin(angle)*0.7);
      basket.add(line);
    }
    basket.position.set(0,-4,1);
    scene.add(basket);
    basketRef.current=basket;

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
      const scene2=sceneRef.current;

      // Move basket
      const targetX=s.basketX*5;
      if(basketRef.current){
        basketRef.current.position.x+=(targetX-basketRef.current.position.x)*0.15;
        basketRef.current.rotation.z=s.tiltX*0.15;
        basketRef.current.position.y=-4+Math.sin(t*2)*0.05;
      }

      if(scene2){
        // Update crystals
        for(let i=s.crystals.length-1;i>=0;i--){
          const c=s.crystals[i];
          if(c.caught){
            c.flashT++;
            c.mesh.scale.setScalar(1+c.flashT*0.1);
            (c.mesh.material as THREE.MeshStandardMaterial).opacity=1-c.flashT/14;
            if(c.flashT>14){scene2.remove(c.mesh);s.crystals.splice(i,1);}
            continue;
          }
          c.mesh.position.y-=c.speed;
          c.mesh.rotation.y+=0.05;c.mesh.rotation.x+=0.03;

          // Collision with basket
          const bx=basketRef.current?.position.x??0;
          const dx=Math.abs(c.mesh.position.x-bx);
          if(c.mesh.position.y<-3.5&&c.mesh.position.y>-4.8&&dx<1.2){
            c.caught=true;
            if(c.dangerous){
              s.sig.dangerous++;s.sig.shattered++;s.sig.streakCurrent=0;
              sfx.collision();hapticFail();
              const mat=c.mesh.material as THREE.MeshStandardMaterial;
              mat.emissive.setHex(0xff0000);mat.emissiveIntensity=3;
            } else {
              s.sig.caught++;s.sig.streakCurrent++;
              if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;
              const mult=s.sig.streakCurrent>=3?2:1;
              s.sig.score+=mult;setScore(s.sig.score);
              sfx.collect();hapticScore();
              const mat=c.mesh.material as THREE.MeshStandardMaterial;
              mat.emissive.setHex(0xffffff);mat.emissiveIntensity=3;
            }
            continue;
          }
          if(c.mesh.position.y<-6.5){
            if(!c.dangerous){s.sig.shattered++;s.sig.streakCurrent=0;hapticImpact();}
            scene2.remove(c.mesh);s.crystals.splice(i,1);
          }
        }

        // Spawn crystals
        if(frame%Math.max(18,55-Math.floor(frame/120)*4)===0&&s.running){
          const isDangerous=Math.random()<0.25;
          const color=isDangerous?DANGER_COLOR:CRYSTAL_COLORS[Math.floor(Math.random()*CRYSTAL_COLORS.length)];
          const geo=new THREE.OctahedronGeometry(0.25+Math.random()*0.2,0);
          const mat=new THREE.MeshStandardMaterial({
            color,metalness:0.4,roughness:0.3,emissive:color,emissiveIntensity:0.6,
            transparent:true,opacity:0.9,
          });
          const mesh=new THREE.Mesh(geo,mat);
          mesh.position.set((Math.random()-0.5)*8,6.5,(Math.random()-0.5)*2);
          scene2.add(mesh);
          s.crystals.push({id:s.nextId++,dangerous:isDangerous,mesh,speed:0.055+Math.random()*0.03+frame*0.000025,caught:false,flashT:0});
          s.sig.totalCrystals++;
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
    s.sig={totalCrystals:0,caught:0,shattered:0,dangerous:0,maxStreak:0,streakCurrent:0,score:0,maxTiltAngle:0};
    s.crystals=[];s.nextId=0;s.frame=0;s.basketX=0;s.tiltX=0;
    // Remove old crystal meshes
    const scene=sceneRef.current;
    if(scene)scene.children.filter(c=>c.userData.isCrystal).forEach(c=>scene.remove(c));
    setScore(0);setTimeLeft(DURATION);setPhase('playing');

    timerRef.current=setInterval(()=>{
      const s2=stateRef.current;s2.timeLeft--;setTimeLeft(s2.timeLeft);
      if(s2.timeLeft<=0){sfx.fail();endGame();}
    },1000);
  },[endGame]);

  // Motion + pointer input
  useEffect(()=>{
    const handleMotion=(e:DeviceMotionEvent)=>{
      if(phase!=='playing')return;
      const s=stateRef.current;if(!s.running)return;
      const x=e.accelerationIncludingGravity?.x??0;
      s.tiltX=-x/10;s.basketX=Math.max(-1,Math.min(1,s.basketX-x*0.008));
      if(Math.abs(x)>s.sig.maxTiltAngle)s.sig.maxTiltAngle=Math.abs(x);
    };
    window.addEventListener('devicemotion',handleMotion);

    const mount=mountRef.current;if(!mount)return;
    let touchX=0;
    const onDown=(e:PointerEvent)=>{
      if(phase!=='playing')return;
      const rect=mount.getBoundingClientRect();
      touchX=(e.clientX-rect.left)/rect.width;
    };
    const onMove=(e:PointerEvent)=>{
      if(phase!=='playing'||!(e.buttons&1))return;
      const s=stateRef.current;if(!s.running)return;
      const rect=mount.getBoundingClientRect();
      const nx=(e.clientX-rect.left)/rect.width;
      const dx=nx-touchX;
      s.basketX=Math.max(-1,Math.min(1,s.basketX+dx*2));
      s.tiltX=dx*3;
      touchX=nx;
    };
    mount.addEventListener('pointerdown',onDown);
    mount.addEventListener('pointermove',onMove);
    return()=>{
      window.removeEventListener('devicemotion',handleMotion);
      mount.removeEventListener('pointerdown',onDown);
      mount.removeEventListener('pointermove',onMove);
    };
  },[phase]);

  useEffect(()=>()=>{cancelAnimationFrame(rafRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);

  const handleStart=useCallback(async(name:string,avatar:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);await initAudio();setPhase('countdown');
  },[]);
  const handleCountdownDone=useCallback(()=>{startLoop();},[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScore(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Collect! 💎" accentColor={accent} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accent}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <>
          <div ref={mountRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
          {phase==='playing'&&<GameHUD accentColor={accent} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}
        </>
      )}
      {phase==='done'&&finalSig&&(
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            {label:'Crystals Caught',value:String(finalSig.caught),color:accent},
            {label:'Shattered',value:String(finalSig.shattered),color:finalSig.shattered===0?'#4ade80':'#ef4444'},
            {label:'Best Streak',value:`×${finalSig.maxStreak}`,color:'#fbbf24'},
            {label:'Dangerous Caught',value:String(finalSig.dangerous),color:'#f97316'},
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.caught>=15}/>
      )}
    </GameShell>
  );
}
