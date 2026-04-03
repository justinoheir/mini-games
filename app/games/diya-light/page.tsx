'use client';
/**
 * DIYA LIGHT — 3D: tilt/drag to pour oil into a 3D diya, tap to ignite the flame.
 * Warm festival night environment with star field and glowing lanterns.
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

const GAME_ID   = 'diya-light';
const ACCENT    = '#f59e0b';
const DURATION  = 45;
const GAME_EMOJI = '🪔';
const GAME_TITLE = 'Diya Light';
const GAME_TAGLINE = 'Tilt to pour oil, then tap to light at the perfect level!';
const PB_KEY    = 'mg_pb_diya-light';
const FILL_LO   = 0.58;
const FILL_HI   = 0.82;
const FILL_OVERFLOW = 0.92;

interface Signals {
  score:number; diyas:number; perfectLights:number; overfills:number; underfills:number;
}

function getPersonality(sig:Signals):string {
  if(sig.perfectLights>=4) return 'Diya Devotee 🪔';
  if(sig.perfectLights>=2&&sig.overfills<=1) return 'Careful Pourer 🫗';
  if(sig.overfills>=3) return 'Overflow Artist 💧';
  if(sig.diyas>=3) return 'Festival Lighter ✨';
  return 'Cautious Flame 🕯️';
}

type Phase='start'|'countdown'|'playing'|'done';

interface GS {
  running:boolean; timeLeft:number; sig:Signals;
  fillLevel:number; pourRate:number; lit:boolean; litTimer:number; flamePower:number;
  tiltX:number; dragActive:boolean; dragStartX:number; dragBaseX:number;
  lightFlash:number; overflowFlash:number; accentColor:string;
}

export default function DiyaLightGame() {
  const theme = useBrandTheme();
  const accentColor = theme.id!=='ether'?theme.colors.accent:ACCENT;
  const accent = accentColor??ACCENT;

  const mountRef     = useRef<HTMLDivElement>(null);
  const rendererRef  = useRef<THREE.WebGLRenderer|null>(null);
  const sceneRef     = useRef<THREE.Scene|null>(null);
  const cameraRef    = useRef<THREE.PerspectiveCamera|null>(null);
  const rafRef       = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  // 3D objects
  const diyaMeshRef  = useRef<THREE.Group|null>(null);
  const jugMeshRef   = useRef<THREE.Group|null>(null);
  const oilLevelRef  = useRef<THREE.Mesh|null>(null);
  const flameLightRef= useRef<THREE.PointLight|null>(null);
  const flameMeshRef = useRef<THREE.Mesh|null>(null);
  const oilDropsRef  = useRef<Array<{mesh:THREE.Mesh;vy:number;alpha:number}>>([]);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{score:0,diyas:0,perfectLights:0,overfills:0,underfills:0},
    fillLevel:0,pourRate:0,lit:false,litTimer:0,flamePower:0,
    tiltX:0,dragActive:false,dragStartX:0,dragBaseX:0,
    lightFlash:0,overflowFlash:0,accentColor:ACCENT,
  });

  const [phase,setPhase]        = useState<Phase>('start');
  const [timeLeft,setTimeLeft]  = useState(DURATION);
  const [scoreDisplay,setScore] = useState(0);
  const [finalSig,setFinalSig]  = useState<Signals|null>(null);
  const [fillDisplay,setFill]   = useState(0);
  const [litDisplay,setLit]     = useState(false);

  // ── Three.js setup ──────────────────────────────────────────────────────
  useEffect(()=>{
    if(!mountRef.current)return;
    const mount=mountRef.current;
    const W=mount.clientWidth||window.innerWidth;const H=mount.clientHeight||window.innerHeight;

    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(W,H);renderer.setClearColor(0x0d0500);
    mount.appendChild(renderer.domElement);
    rendererRef.current=renderer;

    const scene=new THREE.Scene();
    sceneRef.current=scene;

    const camera=new THREE.PerspectiveCamera(65,W/H,0.1,50);
    camera.position.set(0,1,7);camera.lookAt(0,0,0);
    cameraRef.current=camera;

    scene.add(new THREE.AmbientLight(0xff8c00,0.25));
    const ambLight=new THREE.AmbientLight(0xffffff,0.1);scene.add(ambLight);
    const flameLight=new THREE.PointLight(0xf59e0b,0,10);
    flameLight.position.set(0,2,1);scene.add(flameLight);
    flameLightRef.current=flameLight;

    // Stars
    const sg=new THREE.BufferGeometry();const sp=new Float32Array(200*3);
    for(let i=0;i<200;i++){sp[i*3]=(Math.random()-0.5)*20;sp[i*3+1]=(Math.random()-0.5)*10+2;sp[i*3+2]=(Math.random()-0.5)*8-4;}
    sg.setAttribute('position',new THREE.BufferAttribute(sp,3));
    scene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0xfff9c4,size:0.05,sizeAttenuation:true,transparent:true,opacity:0.7})));

    // Background lanterns
    for(let i=0;i<5;i++){
      const geo=new THREE.SphereGeometry(0.2,8,8);
      const mat=new THREE.MeshStandardMaterial({color:0xef4444,emissive:0xef4444,emissiveIntensity:0.8,transparent:true,opacity:0.7});
      const m=new THREE.Mesh(geo,mat);
      m.position.set(-4+i*2,1.5+Math.sin(i)*0.5,-3);
      scene.add(m);
      // String
      const sGeo=new THREE.CylinderGeometry(0.01,0.01,0.5,4);
      const sMat=new THREE.MeshStandardMaterial({color:0x4a2800});
      const s2=new THREE.Mesh(sGeo,sMat);s2.position.set(-4+i*2,2.05,-3);scene.add(s2);
    }

    // Table surface
    const tableGeo=new THREE.BoxGeometry(4,0.1,2);
    const tableMat=new THREE.MeshStandardMaterial({color:0x3a1800,metalness:0.1,roughness:0.8});
    scene.add(new THREE.Mesh(tableGeo,tableMat));

    // Diya group
    const diyaGroup=new THREE.Group();diyaGroup.position.set(0,0.2,0);
    // Bowl
    const bowlGeo=new THREE.SphereGeometry(0.65,16,8,0,Math.PI*2,0,Math.PI*0.55);
    const bowlMat=new THREE.MeshStandardMaterial({color:0xc2612a,metalness:0.1,roughness:0.7,side:THREE.DoubleSide});
    diyaGroup.add(new THREE.Mesh(bowlGeo,bowlMat));
    // Wick
    const wickGeo=new THREE.CylinderGeometry(0.02,0.02,0.4,6);
    const wickMat=new THREE.MeshStandardMaterial({color:0x8b6914});
    const wick=new THREE.Mesh(wickGeo,wickMat);wick.position.y=0.2;diyaGroup.add(wick);
    // Oil level (dynamic)
    const oilGeo=new THREE.CylinderGeometry(0.5,0.5,0.1,16);
    const oilMat=new THREE.MeshStandardMaterial({color:0xb8860b,transparent:true,opacity:0.8,metalness:0.4,roughness:0.3});
    const oilLevel=new THREE.Mesh(oilGeo,oilMat);oilLevel.position.y=-0.1;diyaGroup.add(oilLevel);
    oilLevelRef.current=oilLevel;
    // Flame
    const flameGeo=new THREE.ConeGeometry(0.08,0.4,8);
    const flameMat=new THREE.MeshStandardMaterial({color:0xfbbf24,emissive:0xf59e0b,emissiveIntensity:2,transparent:true,opacity:0});
    const flame=new THREE.Mesh(flameGeo,flameMat);flame.position.y=0.45;diyaGroup.add(flame);
    flameMeshRef.current=flame;
    scene.add(diyaGroup);diyaMeshRef.current=diyaGroup;

    // Oil jug
    const jugGroup=new THREE.Group();jugGroup.position.set(-2,0.8,0.5);
    const jugGeo=new THREE.SphereGeometry(0.35,12,8);
    const jugMat=new THREE.MeshStandardMaterial({color:0x7c4f28,metalness:0.1,roughness:0.8});
    jugGroup.add(new THREE.Mesh(jugGeo,jugMat));
    // Spout
    const spoutGeo=new THREE.CylinderGeometry(0.05,0.05,0.4,6);
    const spoutMat=new THREE.MeshStandardMaterial({color:0xa8783a});
    const spout=new THREE.Mesh(spoutGeo,spoutMat);
    spout.rotation.z=-Math.PI/4;spout.position.set(0.25,0.15,0);
    jugGroup.add(spout);
    scene.add(jugGroup);jugMeshRef.current=jugGroup;

    // Good zone markers
    const loGeo=new THREE.TorusGeometry(0.52,0.015,6,24);
    const loMat=new THREE.MeshStandardMaterial({color:0x22c55e,emissive:0x22c55e,emissiveIntensity:0.8});
    const loMark=new THREE.Mesh(loGeo,loMat);loMark.position.set(0,FILL_LO*0.3-0.1,0);loMark.rotation.x=Math.PI/2;
    diyaGroup.add(loMark);
    const hiMark=new THREE.Mesh(loGeo,loMat.clone());hiMark.position.set(0,FILL_HI*0.3-0.1,0);hiMark.rotation.x=Math.PI/2;
    diyaGroup.add(hiMark);

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

      // Jug tilt
      const jug=jugMeshRef.current;
      if(jug){
        jug.rotation.z=s.tiltX*0.5;
        const pouringX=Math.max(0,s.tiltX)*0.3;

        // Spawn oil drops when pouring
        if(pouringX>0.05&&s.running&&!s.lit&&Math.random()<pouringX*2){
          const dropGeo=new THREE.SphereGeometry(0.04,6,6);
          const dropMat=new THREE.MeshStandardMaterial({color:0xf59e0b,transparent:true,opacity:0.85});
          const drop=new THREE.Mesh(dropGeo,dropMat);
          drop.position.set(-1.5+Math.random()*0.2,0.8,0.5);
          scene.add(drop);
          oilDropsRef.current.push({mesh:drop,vy:0,alpha:0.9});
        }
      }

      // Animate oil drops
      for(let i=oilDropsRef.current.length-1;i>=0;i--){
        const d=oilDropsRef.current[i];
        d.mesh.position.y-=0.06+d.vy*0.1;d.vy+=0.02;d.alpha-=0.025;
        (d.mesh.material as THREE.MeshStandardMaterial).opacity=d.alpha;
        if(d.mesh.position.y<0.15&&s.running&&!s.lit){
          s.fillLevel=Math.min(1,s.fillLevel+0.006);
          setFill(Math.round(s.fillLevel*100));
        }
        if(d.alpha<=0||(d.mesh.position.y<0)){scene.remove(d.mesh);oilDropsRef.current.splice(i,1);}
      }

      // Pour rate from tilt
      if(s.running&&!s.lit){
        s.pourRate=Math.max(0,s.tiltX)*0.25;
        if(s.fillLevel>=FILL_OVERFLOW){
          s.fillLevel=0;s.overflowFlash=1;s.sig.overfills++;
          sfx.nearMiss();haptic([20,30,20]);setFill(0);
        }
      }

      // Oil level visual
      if(oilLevelRef.current){
        const oilH=Math.max(0.02,s.fillLevel*0.35);
        oilLevelRef.current.scale.y=oilH*10;
        oilLevelRef.current.position.y=-0.3+oilH*0.5;
        const inZone=s.fillLevel>=FILL_LO&&s.fillLevel<=FILL_HI;
        (oilLevelRef.current.material as THREE.MeshStandardMaterial).color.setHex(inZone?0x22c55e:0xb8860b);
        (oilLevelRef.current.material as THREE.MeshStandardMaterial).emissive.setHex(inZone?0x22c55e:0xf59e0b);
        (oilLevelRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity=inZone?0.5:0.1;
      }

      // Lit animation
      if(s.lit){
        s.litTimer-=0.016;s.flamePower=Math.min(1,s.flamePower+0.05);
        if(flameMeshRef.current){
          const fm=flameMeshRef.current.material as THREE.MeshStandardMaterial;
          fm.opacity=s.flamePower*0.9;
          flameMeshRef.current.scale.set(1+Math.sin(t*8)*0.1,1+Math.sin(t*6)*0.15,1+Math.sin(t*7)*0.1);
          flameMeshRef.current.position.y=0.45+Math.sin(t*5)*0.05;
        }
        if(flameLightRef.current)flameLightRef.current.intensity=2+s.flamePower*3+Math.sin(t*8)*0.5;
        if(s.litTimer<=0){s.lit=false;s.fillLevel=0;s.flamePower=0;if(flameMeshRef.current)(flameMeshRef.current.material as THREE.MeshStandardMaterial).opacity=0;if(flameLightRef.current)flameLightRef.current.intensity=0;setFill(0);setLit(false);}
      }

      // Diya gentle glow when filled
      if(diyaMeshRef.current){
        diyaMeshRef.current.rotation.y=Math.sin(t*0.3)*0.05;
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
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    const pb=parseInt(localStorage.getItem(PB_KEY)??'0');
    if(s.sig.score>pb)localStorage.setItem(PB_KEY,String(s.sig.score));
    setFinalSig({...s.sig});setPhase('done');
  },[]);

  const startLoop=useCallback(()=>{
    const s=stateRef.current;
    s.running=true;s.timeLeft=DURATION;
    s.sig={score:0,diyas:0,perfectLights:0,overfills:0,underfills:0};
    s.fillLevel=0;s.pourRate=0;s.lit=false;s.litTimer=0;s.flamePower=0;
    s.tiltX=0;s.dragActive=false;s.lightFlash=0;s.overflowFlash=0;
    setScore(0);setTimeLeft(DURATION);setFill(0);setLit(false);setPhase('playing');
    stopMusicRef.current=startMusic('chill');

    timerRef.current=setInterval(()=>{
      const s2=stateRef.current;s2.timeLeft--;setTimeLeft(s2.timeLeft);
      if(s2.timeLeft<=5&&s2.timeLeft>0)sfx.collect();
      if(s2.timeLeft<=0)endGame();
    },1000);
  },[endGame]);

  // Device orientation
  useEffect(()=>{
    if(phase!=='playing')return;
    const onOrientation=(e:DeviceOrientationEvent)=>{
      const s=stateRef.current;if(!s.running)return;
      const g=e.gamma??0;s.tiltX=Math.max(-1,Math.min(1,g/45));
    };
    window.addEventListener('deviceorientation',onOrientation);
    return()=>window.removeEventListener('deviceorientation',onOrientation);
  },[phase]);

  // Canvas pointer events
  useEffect(()=>{
    const mount=mountRef.current;if(!mount)return;
    const onDown=(e:PointerEvent)=>{
      const s=stateRef.current;if(!s.running)return;
      s.dragActive=true;s.dragStartX=e.clientX;s.dragBaseX=s.tiltX;
      // Try to light diya (tap in center)
      const rect=mount.getBoundingClientRect();
      const cx=e.clientX-rect.left;const cy=e.clientY-rect.top;
      const centerX=rect.width/2;const centerY=rect.height*0.5;
      if(!s.lit&&Math.hypot(cx-centerX,cy-centerY)<80){
        if(s.fillLevel>=FILL_LO&&s.fillLevel<=FILL_HI){
          s.lit=true;s.litTimer=1.8;s.lightFlash=1;
          s.sig.diyas++;s.sig.perfectLights++;s.sig.score+=10;
          sfx.collect();haptic([30,20,30,20,60]);
          setScore(s.sig.score);setLit(true);
        } else if(s.fillLevel<FILL_LO){
          s.sig.underfills++;s.sig.score=Math.max(0,s.sig.score-1);
          sfx.nearMiss();haptic([20,30,20]);setScore(s.sig.score);
        }
      }
    };
    const onMove=(e:PointerEvent)=>{
      const s=stateRef.current;if(!s.running||!s.dragActive)return;
      const dx=(e.clientX-s.dragStartX)/100;
      s.tiltX=Math.max(-1,Math.min(1,s.dragBaseX+dx));
    };
    const onUp=()=>{const s=stateRef.current;s.dragActive=false;s.tiltX=0;};
    mount.addEventListener('pointerdown',onDown);mount.addEventListener('pointermove',onMove);mount.addEventListener('pointerup',onUp);mount.addEventListener('pointercancel',onUp);
    return()=>{mount.removeEventListener('pointerdown',onDown);mount.removeEventListener('pointermove',onMove);mount.removeEventListener('pointerup',onUp);mount.removeEventListener('pointercancel',onUp);};
  },[]);

  useEffect(()=>()=>{cancelAnimationFrame(rafRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  const handleStart=useCallback(async(name:string,avatar:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);await initAudio();sfx.click();setPhase('countdown');
  },[]);
  const handleCountdownDone=useCallback(()=>{startLoop();},[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScore(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  const inZone=fillDisplay>=Math.round(FILL_LO*100)&&fillDisplay<=Math.round(FILL_HI*100);

  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent} gameId={GAME_ID}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Light the Diyas!" accentColor={accent} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accent}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <>
          <div ref={mountRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
          {phase==='playing'&&(
            <>
              <GameHUD accentColor={accent} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5,testId:'timer'},{label:'SCORE',value:scoreDisplay,testId:'score'}]}/>
              {!litDisplay&&(
                <div style={{position:'absolute',bottom:60,left:'50%',transform:'translateX(-50%)',
                  fontSize:14,fontWeight:700,textAlign:'center',color:inZone?'#4ade80':accent,letterSpacing:'0.05em',pointerEvents:'none'}}>
                  {fillDisplay}% oil {inZone?'✓ TAP TO LIGHT! 🪔':''}
                  {!inZone&&<div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginTop:2}}>← DRAG RIGHT TO POUR →</div>}
                </div>
              )}
            </>
          )}
        </>
      )}
      {phase==='done'&&finalSig&&(
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            {label:'Diyas Lit',value:String(finalSig.diyas),color:finalSig.diyas>=4?'#4ade80':finalSig.diyas>=2?'#facc15':'#ef4444'},
            {label:'Perfect Lights',value:String(finalSig.perfectLights),color:finalSig.perfectLights>=3?'#4ade80':'#facc15'},
            {label:'Overflows',value:String(finalSig.overfills),color:finalSig.overfills===0?'#4ade80':finalSig.overfills<=2?'#facc15':'#ef4444'},
            {label:'Score',value:String(finalSig.score),color:'var(--color-text)'},
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.diyas>=3}/>
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
