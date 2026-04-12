'use client';
/**
 * COUNTDOWN CRUSH — 3D: tap numbered 3D orbs in countdown order before midnight.
 * Golden New Year theme — dark background, glowing gold orbs with numbers.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';

const GAME_ID      = 'countdown-crush';
const PB_KEY       = 'pb_countdown-crush';
const ACCENT       = '#fbbf24';
const GAME_EMOJI   = '🥂';
const GAME_TITLE   = 'Countdown Crush';
const GAME_TAGLINE = 'Score before midnight. Every second counts.';
const DURATION     = 45;
const PTS_PER_ORB  = 10;

interface Orb3D {
  id: number; number: number; mesh: THREE.Mesh;
  vx: number; vy: number; lifespan: number; age: number;
  caught: boolean; flashT: number;
}

interface Signals {
  score: number; tapped: number; missed: number;
  maxStreak: number; streakCurrent: number; roundsCompleted: number;
}

function getPersonality(sig: Signals): string {
  if (sig.roundsCompleted >= 5 && sig.missed <= 2) return 'Party Master 🎆';
  if (sig.roundsCompleted >= 4)                    return 'Countdown King 🥂';
  if (sig.maxStreak >= 8)                          return 'Streak Machine 🔥';
  if (sig.tapped >= 25)                            return 'Fast Finger ⚡';
  return 'New Year Rookie 🎇';
}

type Phase = 'start'|'countdown'|'playing'|'done';

interface GS {
  running:boolean; timeLeft:number; sig:Signals;
  orbs:Orb3D[]; nextId:number; spawnTimer:number;
  nextNumber:number; accentColor:string;
}

const ORB_COLORS = [
  0xfbbf24, 0xf59e0b, 0xfde68a, 0xef4444, 0xec4899,
  0xa855f7, 0x3b82f6, 0x22c55e, 0xf97316, 0xffffff,
];

function CountdownCrushGameInner() {
  const theme = useBrandTheme();
  const accent = theme.colors.accent ?? ACCENT;

  const mountRef    = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer|null>(null);
  const sceneRef    = useRef<THREE.Scene|null>(null);
  const cameraRef   = useRef<THREE.PerspectiveCamera|null>(null);
  const rafRef      = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef= useRef<(()=>void)|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{score:0,tapped:0,missed:0,maxStreak:0,streakCurrent:0,roundsCompleted:0},
    orbs:[],nextId:0,spawnTimer:0,nextNumber:10,accentColor:ACCENT,
  });

  const [phase,setPhase]        = useState<Phase>('start');
  const [timeLeft,setTimeLeft]  = useState(DURATION);
  const [scoreDisplay,setScore] = useState(0);
  const [finalSig,setFinalSig]  = useState<Signals|null>(null);
  const [nextNum,setNextNum]    = useState(10);
  const { pops,triggerPop }     = useScorePop();

  useEffect(()=>{stateRef.current.accentColor=accent;},[accent]);

  // ── Three.js setup ──────────────────────────────────────────────────────
  useEffect(()=>{
    if(!mountRef.current)return;
    const mount=mountRef.current;
    const W=mount.clientWidth||window.innerWidth;const H=mount.clientHeight||window.innerHeight;

    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(W,H);renderer.setClearColor(0x07051a);
    mount.appendChild(renderer.domElement);
    rendererRef.current=renderer;

    const scene=new THREE.Scene();
    sceneRef.current=scene;

    const camera=new THREE.PerspectiveCamera(70,W/H,0.1,50);
    camera.position.set(0,0,9);
    cameraRef.current=camera;

    scene.add(new THREE.AmbientLight(0xffffff,0.35));
    const pl=new THREE.PointLight(0xfbbf24,4,20);
    pl.position.set(0,2,6);scene.add(pl);
    const pl2=new THREE.PointLight(0xec4899,2,15);
    pl2.position.set(-4,-2,4);scene.add(pl2);

    // Confetti-like background particles
    const cgeo=new THREE.BufferGeometry();
    const cp=new Float32Array(400*3);const cc=new Float32Array(400*3);
    for(let i=0;i<400;i++){
      cp[i*3]=(Math.random()-0.5)*18;cp[i*3+1]=(Math.random()-0.5)*18;cp[i*3+2]=(Math.random()-0.5)*6-4;
      const c=new THREE.Color(ORB_COLORS[Math.floor(Math.random()*ORB_COLORS.length)]);
      cc[i*3]=c.r;cc[i*3+1]=c.g;cc[i*3+2]=c.b;
    }
    cgeo.setAttribute('position',new THREE.BufferAttribute(cp,3));
    cgeo.setAttribute('color',new THREE.BufferAttribute(cc,3));
    const cmat=new THREE.PointsMaterial({size:0.08,sizeAttenuation:true,vertexColors:true,transparent:true,opacity:0.6});
    scene.add(new THREE.Points(cgeo,cmat));

    // Midnight/city skyline silhouette
    const skyMat=new THREE.MeshStandardMaterial({color:0x0d0b24});
    for(let i=0;i<8;i++){
      const bw=0.4+Math.random()*0.6; const bh=1+Math.random()*2;
      const geo=new THREE.BoxGeometry(bw,bh,0.1);
      const m=new THREE.Mesh(geo,skyMat);
      m.position.set(-4+i*1.2,-4.5+bh/2,-2);
      scene.add(m);
    }

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

      if(scene2){
        for(let i=s.orbs.length-1;i>=0;i--){
          const orb=s.orbs[i];
          orb.age++;
          if(orb.caught){
            orb.flashT++;
            orb.mesh.scale.setScalar(1+orb.flashT*0.12);
            (orb.mesh.material as THREE.MeshStandardMaterial).opacity=1-orb.flashT/12;
            if(orb.flashT>12){scene2.remove(orb.mesh);s.orbs.splice(i,1);}
            continue;
          }
          orb.mesh.position.x+=orb.vx;
          orb.mesh.position.y+=orb.vy;
          orb.mesh.rotation.y+=0.03;
          // Bounce off edges
          const px=orb.mesh.position.x;
          if(px>4.5||px<-4.5)orb.vx*=-1;
          if(orb.mesh.position.y<-5.5||orb.mesh.position.y>5.5)orb.vy*=-1;
          // Twinkle
          const li=orb.age/orb.lifespan;
          const fade=li>0.8?(1-(li-0.8)/0.2):1;
          const mat=orb.mesh.material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity=(0.6+Math.sin(t*5+orb.id)*0.3)*fade;
          mat.opacity=fade*0.9;
          if(orb.age>=orb.lifespan){
            scene2.remove(orb.mesh);s.orbs.splice(i,1);
            if(s.running){s.sig.missed++;s.sig.streakCurrent=0;}
          }
        }
      }

      // Sparkle in bg particles
      const positions=cgeo.attributes.position as THREE.BufferAttribute;
      for(let i=0;i<20;i++){
        const idx=Math.floor(Math.random()*400);
        (positions.array as Float32Array)[idx*3+1]-=0.01;
        if((positions.array as Float32Array)[idx*3+1]<-9)
          (positions.array as Float32Array)[idx*3+1]=9;
      }
      positions.needsUpdate=true;

      camera.position.x=Math.sin(t*0.2)*0.3;
      renderer.render(scene,camera);
    };
    render();

    return()=>{
      window.removeEventListener('resize',onResize);
      cancelAnimationFrame(rafRef.current);
      renderer.dispose();mount.removeChild(renderer.domElement);
    };
  },[]);

  const spawnOrb=useCallback((num:number)=>{
    const scene=sceneRef.current;if(!scene)return;
    const s=stateRef.current;
    const geo=new THREE.SphereGeometry(0.5,20,20);
    const color=ORB_COLORS[(num-1)%ORB_COLORS.length];
    const mat=new THREE.MeshStandardMaterial({
      color,metalness:0.4,roughness:0.3,
      emissive:color,emissiveIntensity:0.6,
      transparent:true,opacity:0.9,
    });
    const mesh=new THREE.Mesh(geo,mat);
    mesh.position.set((Math.random()-0.5)*7,(Math.random()-0.5)*4,Math.random()*1.5);
    mesh.userData.isOrb=true;mesh.userData.number=num;
    scene.add(mesh);
    s.orbs.push({
      id:s.nextId++,number:num,mesh,
      vx:(Math.random()-0.5)*0.025,vy:(Math.random()-0.5)*0.02,
      lifespan:200+Math.floor(Math.random()*100),age:0,
      caught:false,flashT:0,
    });
  },[]);

  const spawnRound=useCallback(()=>{
    for(let n=10;n>=1;n--) spawnOrb(n);
    setNextNum(10);
    stateRef.current.nextNumber=10;
  },[spawnOrb]);

  const endGame=useCallback(()=>{
    const s=stateRef.current;s.running=false;
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    const sig={...s.sig};
    const pb=parseInt(localStorage.getItem(PB_KEY)??'0');
    if(sig.score>pb)localStorage.setItem(PB_KEY,String(sig.score));
    setFinalSig(sig);setPhase('done');hapticVictory();
  },[]);

  const startLoop=useCallback(()=>{
    const s=stateRef.current;
    s.running=true;s.timeLeft=DURATION;
    s.sig={score:0,tapped:0,missed:0,maxStreak:0,streakCurrent:0,roundsCompleted:0};
    s.orbs=[];s.nextId=0;s.nextNumber=10;
    setScore(0);setTimeLeft(DURATION);setNextNum(10);setPhase('playing');
    stopMusicRef.current=startMusic('pulse');
    spawnRound();

    timerRef.current=setInterval(()=>{
      const s2=stateRef.current;s2.timeLeft--;setTimeLeft(s2.timeLeft);
      if(s2.timeLeft<=10&&s2.timeLeft>0)sfx.tick();
      if(s2.timeLeft<=0)endGame();
    },1000);
  },[endGame,spawnRound]);

  // Touch to catch orbs
  useEffect(()=>{
    const mount=mountRef.current;if(!mount)return;
    const onPointerDown=(e:PointerEvent)=>{
      if(phase!=='playing')return;
      const s=stateRef.current;if(!s.running)return;
      const renderer=rendererRef.current;const camera=cameraRef.current;const scene=sceneRef.current;
      if(!renderer||!camera||!scene)return;
      const rect=mount.getBoundingClientRect();
      const x=((e.clientX-rect.left)/rect.width)*2-1;
      const y=-((e.clientY-rect.top)/rect.height)*2+1;
      const raycaster=new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(x,y),camera);
      const meshes=s.orbs.filter(o=>!o.caught).map(o=>o.mesh);
      const hits=raycaster.intersectObjects(meshes);
      if(hits.length>0){
        const hitMesh=hits[0].object as THREE.Mesh;
        const orb=s.orbs.find(o=>o.mesh===hitMesh);
        if(orb&&!orb.caught){
          if(orb.number===s.nextNumber){
            // Correct!
            orb.caught=true;
            s.sig.tapped++;s.sig.streakCurrent++;
            if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;
            s.sig.score+=PTS_PER_ORB*(s.sig.streakCurrent>=5?2:1);
            setScore(s.sig.score);
            s.nextNumber--;setNextNum(s.nextNumber);
            sfx.collect();hapticScore();
            triggerPop(`+${PTS_PER_ORB}`,e.clientX,e.clientY);
            const mat=hitMesh.material as THREE.MeshStandardMaterial;
            mat.emissive.setHex(0xffffff);mat.emissiveIntensity=3;
            // Check round complete
            if(s.nextNumber===0){
              s.sig.roundsCompleted++;
              sfx.success();hapticVictory();
              s.orbs.filter(o=>!o.caught).forEach(o=>{
                scene.remove(o.mesh);
              });
              s.orbs=[];
              setTimeout(()=>{
                s.nextNumber=10;setNextNum(10);
                spawnRound();
              },1000);
            }
          } else {
            // Wrong order
            sfx.collision();hapticFail();
            s.sig.streakCurrent=0;
            const mat=hitMesh.material as THREE.MeshStandardMaterial;
            mat.emissive.setHex(0xff0000);mat.emissiveIntensity=2;
            setTimeout(()=>{ mat.emissive.setHex(orb.mesh.userData.originalColor||0xfbbf24);mat.emissiveIntensity=0.6; },300);
          }
        }
      }
    };
    mount.addEventListener('pointerdown',onPointerDown);
    return()=>mount.removeEventListener('pointerdown',onPointerDown);
  },[phase,spawnRound,triggerPop]);

  useEffect(()=>()=>{cancelAnimationFrame(rafRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  const handleStart=useCallback(async(name:string,avatar:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);await initAudio();setPhase('countdown');
  },[]);
  const handleCountdownDone=useCallback(()=>{startLoop();},[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScore(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Let's Go! 🥂" accentColor={accent} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accent}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <>
          <div ref={mountRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
          {phase==='playing'&&(
            <>
              <GameHUD accentColor={accent} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>
              {/* Next number indicator */}
              <div style={{position:'absolute',top:80,left:'50%',transform:'translateX(-50%)',
                display:'flex',flexDirection:'column',alignItems:'center',gap:4,pointerEvents:'none'}}>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',fontWeight:600,letterSpacing:'0.1em'}}>TAP NEXT</div>
                <div style={{width:64,height:64,borderRadius:'50%',
                  background:`radial-gradient(circle, ${ACCENT}88, ${ACCENT}22)`,
                  border:`2px solid ${ACCENT}`,display:'flex',alignItems:'center',justifyContent:'center',
                  fontSize:32,fontWeight:900,color:ACCENT,
                  boxShadow:`0 0 20px ${ACCENT}66`}}>
                  {nextNum}
                </div>
              </div>
              {/* Number labels on orbs - floating UI overlay */}
              <ScorePopEffect pops={pops} accentColor={accent}/>
            </>
          )}
        </>
      )}
      {phase==='done'&&finalSig&&(
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            {label:'Rounds Done',value:String(finalSig.roundsCompleted),color:finalSig.roundsCompleted>=4?'#4ade80':'#facc15'},
            {label:'Tapped',value:String(finalSig.tapped),color:accent},
            {label:'Max Streak',value:`×${finalSig.maxStreak}`,color:'#fbbf24'},
            {label:'Missed',value:String(finalSig.missed),color:finalSig.missed===0?'#4ade80':'#ef4444'},
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.roundsCompleted>=2}/>
      )}
      {phase==='done'&&finalSig&&<WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>}
    </GameShell>
  );
}

function WebhookEmitter({theme,sig,personality,player}:{theme:ReturnType<typeof useBrandTheme>;sig:Signals;personality:string;player:PlayerSession|null;}) {
  const fired=useRef(false);
  useEffect(()=>{if(fired.current)return;fired.current=true;postWebhook(theme,GAME_ID,{personality,score:sig.score,roundsCompleted:sig.roundsCompleted},player);},[theme,sig,personality,player]);
  return null;
}

import dynamic from 'next/dynamic';
const CountdownCrushGame = dynamic(() => Promise.resolve({ default: CountdownCrushGameInner }), { ssr: false });
export default CountdownCrushGame;
