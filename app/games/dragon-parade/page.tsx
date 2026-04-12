'use client';
/**
 * DRAGON PARADE — 3D: guide a 3D segmented dragon through gates.
 * Red and gold festival atmosphere. Follow pointer to steer the dragon.
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

const GAME_ID    = 'dragon-parade';
const ACCENT     = '#ef4444';
const DURATION   = 60;
const GAME_EMOJI = '🐉';
const GAME_TITLE = 'Dragon Parade';
const GAME_TAGLINE = 'Guide the dragon. Make it dance!';

const SEGMENT_COUNT = 14;
const SEGMENT_DIST  = 0.6;
const DRAGON_R      = 0.35;

interface Gate3D { mesh:THREE.Group; passed:boolean; z:number; }
interface Segment3D { mesh:THREE.Mesh; x:number; y:number; z:number; }

interface Signals {
  gatesPassed:number; bodyCollisions:number; maxStreak:number; streakCurrent:number; score:number;
}

function getPersonality(s:Signals):string {
  if(s.gatesPassed>=20&&s.bodyCollisions===0) return 'Dragon Master 🐉';
  if(s.gatesPassed>=15)                        return 'Parade Champion 🎊';
  if(s.bodyCollisions>=8)                      return 'Wiggly Dragon 🌀';
  if(s.maxStreak>=8)                           return 'Rhythm Dancer 🎵';
  return 'Festival Starter 🏮';
}

type Phase='start'|'countdown'|'playing'|'done';

interface GS {
  running:boolean; timeLeft:number; sig:Signals; frame:number;
  segments:Segment3D[]; headX:number; headY:number; targetX:number; targetY:number;
  gates:Gate3D[]; gateTimer:number; gateSpeed:number;
  accentColor:string;
}

const BODY_COLORS=[0xef4444,0xfbbf24,0xf97316,0xdc2626,0xfde68a];

function DragonParadeGameInner() {
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
    sig:{gatesPassed:0,bodyCollisions:0,maxStreak:0,streakCurrent:0,score:0},
    frame:0,accentColor:ACCENT,
    segments:[],headX:0,headY:0,targetX:0,targetY:0,
    gates:[],gateTimer:0,gateSpeed:0.08,
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
    renderer.setSize(W,H);renderer.setClearColor(0x0d0200);
    mount.appendChild(renderer.domElement);
    rendererRef.current=renderer;

    const scene=new THREE.Scene();
    sceneRef.current=scene;

    const camera=new THREE.PerspectiveCamera(65,W/H,0.1,50);
    camera.position.set(0,0,10);camera.lookAt(0,0,0);
    cameraRef.current=camera;

    scene.add(new THREE.AmbientLight(0xff4400,0.4));
    const pl=new THREE.PointLight(0xff6600,4,20);pl.position.set(0,3,6);scene.add(pl);
    scene.add(new THREE.DirectionalLight(0xffd6a0,0.3));

    // Background lanterns
    for(let i=0;i<8;i++){
      const geo=new THREE.SphereGeometry(0.25,8,8);
      const mat=new THREE.MeshStandardMaterial({color:0xef4444,emissive:0xef4444,emissiveIntensity:0.9,transparent:true,opacity:0.8});
      const m=new THREE.Mesh(geo,mat);
      m.position.set(-4+i,-2.5+Math.sin(i)*0.5,-5);
      scene.add(m);
    }

    // Ground
    const floorGeo=new THREE.PlaneGeometry(12,20);
    const floorMat=new THREE.MeshStandardMaterial({color:0x1a0500,roughness:0.9});
    const floor=new THREE.Mesh(floorGeo,floorMat);floor.rotation.x=-Math.PI/2;floor.position.y=-2;
    scene.add(floor);

    // Build dragon segments
    const buildDragon=(s:GS)=>{
      s.segments.forEach(seg=>scene.remove(seg.mesh));
      s.segments=[];
      for(let i=0;i<SEGMENT_COUNT;i++){
        const isHead=i===0;
        const geo=isHead?new THREE.SphereGeometry(DRAGON_R*1.3,12,12):new THREE.SphereGeometry(DRAGON_R*(1-i/SEGMENT_COUNT*0.4),10,10);
        const col=BODY_COLORS[i%BODY_COLORS.length];
        const mat=new THREE.MeshStandardMaterial({color:col,metalness:0.2,roughness:0.5,emissive:col,emissiveIntensity:0.3});
        const mesh=new THREE.Mesh(geo,mat);
        const x=-i*SEGMENT_DIST;
        mesh.position.set(x,0,0);
        scene.add(mesh);
        s.segments.push({mesh,x,y:0,z:0});
      }
      // Horns on head
      const hornGeo=new THREE.ConeGeometry(0.06,0.3,6);
      const hornMat=new THREE.MeshStandardMaterial({color:0xfbbf24,emissive:0xf59e0b,emissiveIntensity:0.8});
      [-0.2,0.2].forEach(ox=>{const h=new THREE.Mesh(hornGeo,hornMat.clone());h.position.set(ox,0.4,0);if(s.segments[0])s.segments[0].mesh.add(h);});
      // Eyes
      const eyeGeo=new THREE.SphereGeometry(0.07,6,6);
      const eyeMat=new THREE.MeshStandardMaterial({color:0xfbbf24,emissive:0xfbbf24,emissiveIntensity:3});
      [-0.18,0.18].forEach(ox=>{const e=new THREE.Mesh(eyeGeo,eyeMat.clone());e.position.set(ox,0.1,0.3);if(s.segments[0])s.segments[0].mesh.add(e);});
    };

    const s=stateRef.current;
    buildDragon(s);

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
      const s2=stateRef.current;
      const scene2=sceneRef.current;if(!scene2)return;

      // Move head toward target
      const dx=s2.targetX-s2.headX;const dy=s2.targetY-s2.headY;
      const spd=0.08;
      s2.headX+=dx*spd;s2.headY+=dy*spd;

      // Snake body
      if(s2.segments.length>0){
        s2.segments[0].x=s2.headX;s2.segments[0].y=s2.headY;s2.segments[0].z=0;
        s2.segments[0].mesh.position.set(s2.headX,s2.headY,0);
        s2.segments[0].mesh.rotation.z=Math.atan2(dy,dx)-Math.PI/2;
        for(let i=1;i<s2.segments.length;i++){
          const prev=s2.segments[i-1];const curr=s2.segments[i];
          const sdx=curr.x-prev.x;const sdy=curr.y-prev.y;
          const dist=Math.sqrt(sdx*sdx+sdy*sdy);
          if(dist>SEGMENT_DIST){
            curr.x=prev.x+sdx/dist*SEGMENT_DIST;curr.y=prev.y+sdy/dist*SEGMENT_DIST;
          }
          curr.mesh.position.set(curr.x,curr.y,0);
        }
      }

      // Spawn gates (moving toward camera)
      s2.gateTimer--;
      if(s2.gateTimer<=0&&s2.running){
        s2.gateTimer=Math.max(50,100-frame/120);
        const gateGroup=new THREE.Group();
        const gateWidth=1.8+Math.random()*0.5;
        const gateX=(Math.random()-0.5)*4;
        // Gate posts
        [-(gateWidth/2),gateWidth/2].forEach(ox=>{
          const geo=new THREE.CylinderGeometry(0.1,0.1,4,6);
          const mat=new THREE.MeshStandardMaterial({color:0xdc2626,emissive:0xef4444,emissiveIntensity:0.5});
          const m=new THREE.Mesh(geo,mat);m.position.set(ox,0,0);gateGroup.add(m);
        });
        // Top bar
        const topGeo=new THREE.CylinderGeometry(0.08,0.08,gateWidth,6);
        const topMat=new THREE.MeshStandardMaterial({color:0xfbbf24,emissive:0xf59e0b,emissiveIntensity:0.5});
        const topB=new THREE.Mesh(topGeo,topMat);topB.rotation.z=Math.PI/2;topB.position.y=2;gateGroup.add(topB);
        gateGroup.position.set(gateX,0,-15);
        scene2.add(gateGroup);
        s2.gates.push({mesh:gateGroup,passed:false,z:gateX});
      }

      // Move gates
      for(let i=s2.gates.length-1;i>=0;i--){
        const g=s2.gates[i];
        g.mesh.position.z+=s2.gateSpeed;
        // Check pass
        if(!g.passed&&g.mesh.position.z>-0.5){
          g.passed=true;
          // Check if dragon head inside gate
          const gx=g.mesh.position.x;const hw=1.8/2;
          const headInGate=Math.abs(s2.headX-gx)<hw;
          if(headInGate){
            s2.sig.gatesPassed++;s2.sig.streakCurrent++;
            if(s2.sig.streakCurrent>s2.sig.maxStreak)s2.sig.maxStreak=s2.sig.streakCurrent;
            s2.sig.score+=s2.sig.streakCurrent>=3?3:1;setScore(s2.sig.score);
            sfx.collect();if(s2.sig.streakCurrent>=3)hapticCombo();else hapticScore();
          } else {
            s2.sig.bodyCollisions++;s2.sig.streakCurrent=0;
            sfx.collision();hapticFail();
          }
        }
        if(g.mesh.position.z>6){scene2.remove(g.mesh);s2.gates.splice(i,1);}
      }

      // Animate body colors
      s2.segments.forEach((seg,i)=>{
        const mat=seg.mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity=0.3+Math.sin(t*4+i*0.5)*0.2;
      });

      // Increase gate speed
      s2.gateSpeed=0.08+frame/6000;

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
    s.running=true;s.timeLeft=DURATION;s.frame=0;s.gateSpeed=0.08;
    s.sig={gatesPassed:0,bodyCollisions:0,maxStreak:0,streakCurrent:0,score:0};
    s.headX=0;s.headY=0;s.targetX=0;s.targetY=0;s.gates=[];s.gateTimer=60;
    setScore(0);setTimeLeft(DURATION);setPhase('playing');

    timerRef.current=setInterval(()=>{
      const s2=stateRef.current;s2.timeLeft--;setTimeLeft(s2.timeLeft);
      if(s2.timeLeft<=0){sfx.fail();endGame();}
      if(s2.timeLeft===40||s2.timeLeft===20)s2.gateSpeed+=0.015;
    },1000);
  },[endGame]);

  // Pointer controls
  useEffect(()=>{
    const mount=mountRef.current;if(!mount)return;
    const onMove=(e:PointerEvent)=>{
      if(phase!=='playing')return;
      const rect=mount.getBoundingClientRect();
      const nx=(e.clientX-rect.left)/rect.width;
      const ny=(e.clientY-rect.top)/rect.height;
      stateRef.current.targetX=(nx-0.5)*8;
      stateRef.current.targetY=-(ny-0.5)*6;
    };
    const onTouch=(e:TouchEvent)=>{
      if(phase!=='playing')return;
      const rect=mount.getBoundingClientRect();
      const nx=(e.touches[0].clientX-rect.left)/rect.width;
      const ny=(e.touches[0].clientY-rect.top)/rect.height;
      stateRef.current.targetX=(nx-0.5)*8;
      stateRef.current.targetY=-(ny-0.5)*6;
    };
    mount.addEventListener('pointermove',onMove);
    mount.addEventListener('touchmove',onTouch,{passive:true});
    return()=>{mount.removeEventListener('pointermove',onMove);mount.removeEventListener('touchmove',onTouch);};
  },[phase]);

  useEffect(()=>()=>{cancelAnimationFrame(rafRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);
  const handleStart=useCallback((name:string,avatar:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);initAudio();setPhase('countdown');},[]);
  const handleCountdownDone=useCallback(()=>{startLoop();},[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScore(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Let's Parade! 🐉" accentColor={accent} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accent}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <>
          <div ref={mountRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
          {phase==='playing'&&(
            <>
              <GameHUD accentColor={accent} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>
              <div style={{position:'absolute',bottom:40,left:'50%',transform:'translateX(-50%)',fontSize:12,color:'rgba(255,255,255,0.4)',fontWeight:600,letterSpacing:'0.1em'}}>DRAG TO GUIDE THE DRAGON</div>
            </>
          )}
        </>
      )}
      {phase==='done'&&finalSig&&(
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            {label:'Gates Passed',value:String(finalSig.gatesPassed),color:finalSig.gatesPassed>=15?'#4ade80':'#facc15'},
            {label:'Body Hits',value:String(finalSig.bodyCollisions),color:finalSig.bodyCollisions===0?'#4ade80':'#ef4444'},
            {label:'Best Streak',value:`×${finalSig.maxStreak}`,color:'#fbbf24'},
            {label:'Score',value:String(finalSig.score),color:accent},
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.gatesPassed>=12}/>
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const DragonParadeGame = dynamic(() => Promise.resolve({ default: DragonParadeGameInner }), { ssr: false });
export default DragonParadeGame;
