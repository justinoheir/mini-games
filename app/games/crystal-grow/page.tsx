'use client';
/**
 * CRYSTAL GROW — 3D: breathe steadily into the mic to grow a 3D crystal.
 * Erratic breathing shatters it. Dark violet environment with glowing crystal.
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

const GAME_ID      = 'crystal-grow';
const ACCENT       = '#e879f9';
const DURATION     = 45;
const GAME_EMOJI   = '💎';
const GAME_TITLE   = 'Crystal Grow';
const GAME_TAGLINE = 'Breathe slowly and steadily to grow a crystal — erratic breath shatters it.';

interface Signals {
  maxCrystalSize:number; shatters:number; steadyBreathSeconds:number; avgBreathRate:number; score:number;
}

function getPersonality(sig:Signals):string {
  if(sig.shatters===0&&sig.maxCrystalSize>=0.8) return 'Crystal Sage 💎';
  if(sig.shatters<=1&&sig.steadyBreathSeconds>=25) return 'Gentle Grower 🌿';
  if(sig.maxCrystalSize>=0.6) return 'Fragile Beauty 🔮';
  if(sig.shatters>=4) return 'Shatter Artist 💥';
  return 'Breath Apprentice 🌬️';
}

type Phase = 'start'|'countdown'|'playing'|'done';

const MIN_VOL = 0.08;
const MAX_VOL = 0.55;
const ERRATIC_THRESHOLD = 0.25;

interface GS {
  running:boolean; timeLeft:number; sig:Signals;
  volume:number; smoothVolume:number; breathRate:number; prevVolume:number;
  crystalSize:number; crystalTarget:number; isGrowing:boolean;
  glowPulse:number; accentColor:string;
  analyser:AnalyserNode|null; micStream:MediaStream|null; dataArray:Uint8Array<ArrayBuffer>|null;
  steadyTicks:number;
}

export default function CrystalGrowGame() {
  const theme        = useBrandTheme();
  const accent       = theme.colors.accent ?? ACCENT;

  const mountRef     = useRef<HTMLDivElement>(null);
  const rendererRef  = useRef<THREE.WebGLRenderer|null>(null);
  const sceneRef     = useRef<THREE.Scene|null>(null);
  const cameraRef    = useRef<THREE.PerspectiveCamera|null>(null);
  const rafRef       = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  // 3D crystal branches
  const crystalGroupRef = useRef<THREE.Group|null>(null);
  const branchMeshesRef = useRef<THREE.Mesh[]>([]);
  const shardMeshesRef  = useRef<THREE.Mesh[]>([]);
  const plRef           = useRef<THREE.PointLight|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{maxCrystalSize:0,shatters:0,steadyBreathSeconds:0,avgBreathRate:0,score:0},
    volume:0,smoothVolume:0,breathRate:0,prevVolume:0,
    crystalSize:0.05,crystalTarget:0.05,isGrowing:false,
    glowPulse:0,accentColor:ACCENT,
    analyser:null,micStream:null,dataArray:null,steadyTicks:0,
  });

  const [phase,setPhase]               = useState<Phase>('start');
  const [timeLeft,setTimeLeft]         = useState(DURATION);
  const [scoreDisplay,setScoreDisplay] = useState(0);
  const [finalSig,setFinalSig]         = useState<Signals|null>(null);
  const playerNameRef = useRef('');
  const playerAvatarRef = useRef('💎');

  useEffect(()=>{stateRef.current.accentColor=accent;},[accent]);

  // ── Three.js setup ──────────────────────────────────────────────────────
  useEffect(()=>{
    if(!mountRef.current)return;
    const mount=mountRef.current;
    const W=mount.clientWidth||window.innerWidth;const H=mount.clientHeight||window.innerHeight;

    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(W,H);renderer.setClearColor(0x0d0015);
    mount.appendChild(renderer.domElement);
    rendererRef.current=renderer;

    const scene=new THREE.Scene();
    sceneRef.current=scene;

    const camera=new THREE.PerspectiveCamera(65,W/H,0.1,50);
    camera.position.set(0,0,8);
    cameraRef.current=camera;

    scene.add(new THREE.AmbientLight(0xffffff,0.25));
    const pl=new THREE.PointLight(0xe879f9,4,20);
    pl.position.set(0,2,5);scene.add(pl);
    plRef.current=pl;
    scene.add(new THREE.DirectionalLight(0xd8b4fe,0.4));

    // Base platform
    const basGeo=new THREE.CylinderGeometry(0.8,1.0,0.2,16);
    const basMat=new THREE.MeshStandardMaterial({color:0x2d0040,metalness:0.5,roughness:0.5});
    scene.add(new THREE.Mesh(basGeo,basMat));

    // Crystal group (grows/shrinks)
    const crystalGroup=new THREE.Group();
    scene.add(crystalGroup);
    crystalGroupRef.current=crystalGroup;

    // Build crystal arms (6 main + smaller branches)
    const armAngles=[0,60,120,180,240,300].map(d=>d*Math.PI/180);
    armAngles.forEach((angle,i)=>{
      const armLen=1.8;
      const geo=new THREE.ConeGeometry(0.1,armLen,6);
      const mat=new THREE.MeshStandardMaterial({color:0xe879f9,emissive:0xe879f9,emissiveIntensity:0.5,metalness:0.4,roughness:0.3,transparent:true,opacity:0.85});
      const mesh=new THREE.Mesh(geo,mat);
      mesh.rotation.z=Math.PI/2-angle; // point outward
      mesh.position.set(Math.cos(angle)*armLen*0.5,Math.sin(angle)*armLen*0.5*0.3,0);
      crystalGroup.add(mesh);
      branchMeshesRef.current.push(mesh);
    });
    // Vertical spike
    const topGeo=new THREE.ConeGeometry(0.08,2.5,6);
    const topMat=new THREE.MeshStandardMaterial({color:0xf0abfc,emissive:0xe879f9,emissiveIntensity:1,metalness:0.3,roughness:0.2,transparent:true,opacity:0.9});
    const topMesh=new THREE.Mesh(topGeo,topMat);
    topMesh.position.y=1.25;
    crystalGroup.add(topMesh);
    branchMeshesRef.current.push(topMesh);

    // Background floaters
    const fgeo=new THREE.BufferGeometry();
    const fp=new Float32Array(200*3);
    for(let i=0;i<200;i++){fp[i*3]=(Math.random()-0.5)*16;fp[i*3+1]=(Math.random()-0.5)*16;fp[i*3+2]=(Math.random()-0.5)*6-4;}
    fgeo.setAttribute('position',new THREE.BufferAttribute(fp,3));
    scene.add(new THREE.Points(fgeo,new THREE.PointsMaterial({color:0xd8b4fe,size:0.06,sizeAttenuation:true})));

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
      const vol=s.smoothVolume;

      // Grow/shrink crystal
      const targetScale=0.1+s.crystalSize*3.5;
      if(crystalGroupRef.current){
        crystalGroupRef.current.scale.lerp(new THREE.Vector3(targetScale,targetScale,targetScale),0.06);
        crystalGroupRef.current.rotation.y+=0.008+vol*0.02;
      }

      // Color/emission based on state
      branchMeshesRef.current.forEach(m=>{
        const mat=m.material as THREE.MeshStandardMaterial;
        if(s.isGrowing){
          mat.emissive.setHex(0xe879f9);
          mat.emissiveIntensity=0.5+s.crystalSize*1.5+Math.sin(t*4)*0.2;
          mat.opacity=0.85+s.crystalSize*0.1;
        } else {
          mat.emissiveIntensity=0.2+Math.sin(t*2)*0.1;
          mat.opacity=0.6;
        }
      });

      // Point light
      if(plRef.current){
        plRef.current.intensity=2+vol*6+s.crystalSize*3;
        plRef.current.color.setHSL(0.84-s.crystalSize*0.05,1,0.5+s.crystalSize*0.1);
      }

      // Shards animation
      for(let i=shardMeshesRef.current.length-1;i>=0;i--){
        const sh=shardMeshesRef.current[i];
        sh.position.x+=sh.userData.vx;sh.position.y+=sh.userData.vy;sh.position.z+=sh.userData.vz;
        sh.userData.vy-=0.003;sh.userData.alpha-=0.025;
        const mat=sh.material as THREE.MeshStandardMaterial;
        mat.opacity=Math.max(0,sh.userData.alpha);
        if(sh.userData.alpha<=0){sceneRef.current?.remove(sh);shardMeshesRef.current.splice(i,1);}
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

  const stopMic=useCallback(()=>{
    const s=stateRef.current;
    if(s.micStream){s.micStream.getTracks().forEach(t=>t.stop());s.micStream=null;}
    s.analyser=null;s.dataArray=null;
  },[]);

  const shatterCrystal=useCallback(()=>{
    const s=stateRef.current;
    s.sig.shatters++;
    // Spawn shards
    const scene=sceneRef.current;
    if(scene){
      for(let i=0;i<16;i++){
        const geo=new THREE.OctahedronGeometry(0.1+Math.random()*0.1,0);
        const mat=new THREE.MeshStandardMaterial({color:0xe879f9,emissive:0xe879f9,emissiveIntensity:1.5,transparent:true,opacity:1});
        const sh=new THREE.Mesh(geo,mat);
        const speed=0.06+Math.random()*0.1;
        const angle=Math.random()*Math.PI*2;const elev=(Math.random()-0.5)*Math.PI;
        sh.userData={vx:Math.cos(angle)*Math.cos(elev)*speed,vy:Math.sin(elev)*speed+0.04,vz:Math.sin(angle)*Math.cos(elev)*speed,alpha:1};
        scene.add(sh);shardMeshesRef.current.push(sh);
      }
    }
    s.crystalSize=0.05;s.crystalTarget=0.05;
    sfx.fail();haptic([100,50,100]);
  },[]);

  const endGame=useCallback(()=>{
    const s=stateRef.current;s.running=false;
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    stopMic();
    setFinalSig({...s.sig});setPhase('done');
  },[stopMic]);

  const startLoop=useCallback(async()=>{
    const s=stateRef.current;
    s.running=true;s.timeLeft=DURATION;
    s.sig={maxCrystalSize:0,shatters:0,steadyBreathSeconds:0,avgBreathRate:0,score:0};
    s.crystalSize=0.05;s.crystalTarget=0.05;s.smoothVolume=0;s.breathRate=0;s.prevVolume=0;
    setScoreDisplay(0);setTimeLeft(DURATION);setPhase('playing');
    stopMusicRef.current=startMusic('ambient');

    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      s.micStream=stream;
      const audioCtx=new AudioContext();
      const analyser=audioCtx.createAnalyser();analyser.fftSize=256;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      s.analyser=analyser;
      s.dataArray=new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    }catch{/* no mic fallback */}

    timerRef.current=setInterval(()=>{
      const s2=stateRef.current;s2.timeLeft--;setTimeLeft(s2.timeLeft);
      if(s2.isGrowing){s2.sig.steadyBreathSeconds++;s2.sig.score+=Math.ceil(s2.crystalSize*3);setScoreDisplay(s2.sig.score);}
      if(s2.crystalSize>s2.sig.maxCrystalSize)s2.sig.maxCrystalSize=s2.crystalSize;
      if(s2.timeLeft<=0){sfx.fail();endGame();}
    },1000);

    // Audio loop (separate from render)
    const audioLoop=()=>{
      if(!stateRef.current.running)return;
      const s2=stateRef.current;
      if(s2.analyser&&s2.dataArray){
        s2.analyser.getByteFrequencyData(s2.dataArray);
        let sum=0;for(let i=0;i<s2.dataArray.length;i++)sum+=s2.dataArray[i];
        s2.volume=sum/(s2.dataArray.length*255);
      }
      const prev=s2.smoothVolume;
      s2.smoothVolume+=(s2.volume-s2.smoothVolume)*0.12;
      const rate=Math.abs(s2.smoothVolume-prev);
      s2.breathRate=s2.breathRate*0.9+rate*0.1;
      const vol=s2.smoothVolume;
      const isSteady=vol>=MIN_VOL&&vol<=MAX_VOL&&s2.breathRate<ERRATIC_THRESHOLD;
      s2.isGrowing=isSteady;
      if(isSteady){s2.crystalTarget=Math.min(1,s2.crystalTarget+0.003);}
      else if(s2.breathRate>ERRATIC_THRESHOLD*2){shatterCrystal();}
      else{s2.crystalTarget=Math.max(0.05,s2.crystalTarget-0.002);}
      s2.crystalSize+=(s2.crystalTarget-s2.crystalSize)*0.05;
      requestAnimationFrame(audioLoop);
    };
    audioLoop();
  },[endGame,shatterCrystal]);

  useEffect(()=>()=>{
    cancelAnimationFrame(rafRef.current);
    if(timerRef.current)clearInterval(timerRef.current);
    if(stopMusicRef.current)stopMusicRef.current();
    stopMic();
  },[stopMic]);

  const handleStart=useCallback((name:string,avatar:string)=>{
    playerNameRef.current=name;playerAvatarRef.current=avatar;
    playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);
    initAudio();setPhase('countdown');
  },[]);
  const handleCountdownDone=useCallback(()=>{startLoop();},[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  const buildInsights=(sig:Signals)=>[
    {label:'Max Size',    value:`${Math.round(sig.maxCrystalSize*100)}%`, color:sig.maxCrystalSize>=0.7?'#4ade80':'#facc15'},
    {label:'Steady Time', value:`${sig.steadyBreathSeconds}s`,             color:accent},
    {label:'Shatters',    value:`${sig.shatters}`,                         color:sig.shatters===0?'#4ade80':'#ef4444'},
    {label:'Score',       value:`${sig.score}`,                            color:'var(--color-text)'},
  ];

  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Allow Mic & Breathe" accentColor={accent} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accent}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <>
          <div ref={mountRef} style={{position:'absolute',inset:0,width:'100%',height:'100%'}}/>
          {phase==='playing'&&(
            <>
              <GameHUD accentColor={accent} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>
              <div style={{position:'absolute',bottom:60,left:'50%',transform:'translateX(-50%)',
                fontSize:14,fontWeight:700,textAlign:'center',color:stateRef.current.isGrowing?'#4ade80':'rgba(255,255,255,0.5)',
                letterSpacing:'0.05em',transition:'color 300ms'}}>
                {stateRef.current.isGrowing?'CRYSTAL GROWING ✨':'BREATHE STEADILY INTO MIC 🎤'}
              </div>
            </>
          )}
        </>
      )}
      {phase==='done'&&finalSig&&(
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={accent}
          onPlayAgain={handlePlayAgain} didWin={finalSig.maxCrystalSize>=0.6}/>
      )}
      {phase==='done'&&finalSig&&<WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>}
    </GameShell>
  );
}

function WebhookEmitter({theme,sig,personality,player}:{theme:ReturnType<typeof useBrandTheme>;sig:Signals;personality:string;player:PlayerSession|null;}){
  const fired=useRef(false);
  useEffect(()=>{if(fired.current)return;fired.current=true;postWebhook(theme,GAME_ID,{personality,score:sig.score,maxCrystalSize:sig.maxCrystalSize,shatters:sig.shatters,steadyBreathSeconds:sig.steadyBreathSeconds},player);},[theme,sig,personality,player]);
  return null;
}
