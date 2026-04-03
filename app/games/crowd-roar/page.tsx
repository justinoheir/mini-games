'use client';
/**
 * CROWD ROAR — 3D stadium with rising crowd energy driven by mic volume.
 * Vibrant amber/orange crowd members that light up and wave when you roar.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Mic } from 'lucide-react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { playVictoryFanfare } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID      = 'crowd-roar';
const ACCENT       = '#f59e0b';
const DURATION     = 45;
const GAME_EMOJI   = '📢';
const GAME_TITLE   = 'Crowd Roar';
const GAME_TAGLINE = "Roar loud. Hold it. Don't fade.";
const ROAR_THRESHOLD = 0.6;
const SILENCE_THRESHOLD = 0.2;
const SILENCE_MS = 500;
const CHALLENGE_MS = 3000;

interface Signals {
  avgVolume: number; peakVolume: number; sustainedRoarTime: number;
  silenceEvents: number; roarBursts: number; volumeSum: number; volumeCount: number;
  roarStartTime: number | null; score: number;
}

function getPersonality(sig: Signals): string {
  const avg = sig.volumeCount > 0 ? sig.volumeSum / sig.volumeCount : 0;
  if (avg > 0.75 && sig.sustainedRoarTime > 20000) return 'Performer 🎭';
  if (sig.roarBursts >= 8 && sig.peakVolume > 0.85) return 'Energizer ⚡';
  if (avg > 0.55 && sig.silenceEvents <= 3)         return 'Connector 🤝';
  if (sig.peakVolume > 0.75 && sig.roarBursts >= 4) return 'Trailblazer 🚀';
  return 'Visionary 🌟';
}

interface CrowdMember3D {
  mesh: THREE.Group;
  colFrac: number;
  row: number;
  excitementCurrent: number;
  phase: number;
}

type Phase = 'start'|'permission'|'countdown'|'playing'|'done';

export default function CrowdRoarGame() {
  const theme = useBrandTheme();
  const accent = theme.colors.accent ?? ACCENT;

  const mountRef     = useRef<HTMLDivElement>(null);
  const rendererRef  = useRef<THREE.WebGLRenderer|null>(null);
  const sceneRef     = useRef<THREE.Scene|null>(null);
  const cameraRef    = useRef<THREE.PerspectiveCamera|null>(null);
  const rafRef       = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const audioCtxRef  = useRef<AudioContext|null>(null);
  const analyserRef  = useRef<AnalyserNode|null>(null);
  const micStreamRef = useRef<MediaStream|null>(null);
  const dataArrRef   = useRef<Uint8Array<ArrayBuffer>|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const crowdRef     = useRef<CrowdMember3D[]>([]);
  const plRef        = useRef<THREE.PointLight|null>(null);

  const sigRef = useRef<Signals>({
    avgVolume:0, peakVolume:0, sustainedRoarTime:0, silenceEvents:0, roarBursts:0,
    volumeSum:0, volumeCount:0, roarStartTime:null, score:0,
  });
  const smoothVolRef = useRef(0);
  const silenceStartRef = useRef<number|null>(null);
  const inSilenceRef = useRef(false);
  const wasAboveRef = useRef(false);
  const runningRef = useRef(false);

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals|null>(null);
  const [permError, setPermError]       = useState('');

  // ── Three.js setup ──────────────────────────────────────────────────────
  useEffect(()=>{
    if(!mountRef.current)return;
    const mount=mountRef.current;
    const W=mount.clientWidth||window.innerWidth;const H=mount.clientHeight||window.innerHeight;

    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(W,H);renderer.setClearColor(0x0d0800);
    mount.appendChild(renderer.domElement);
    rendererRef.current=renderer;

    const scene=new THREE.Scene();
    sceneRef.current=scene;

    const camera=new THREE.PerspectiveCamera(65,W/H,0.1,100);
    camera.position.set(0,2,12);
    camera.lookAt(0,0,0);
    cameraRef.current=camera;

    scene.add(new THREE.AmbientLight(0xffffff,0.3));
    const pl=new THREE.PointLight(0xf59e0b,3,25);
    pl.position.set(0,5,5);scene.add(pl);
    plRef.current=pl;
    scene.add(new THREE.DirectionalLight(0xfbbf24,0.5));

    // Stadium floor
    const floorGeo=new THREE.PlaneGeometry(20,12);
    const floorMat=new THREE.MeshStandardMaterial({color:0x1a1000,metalness:0.2,roughness:0.8});
    const floor=new THREE.Mesh(floorGeo,floorMat);
    floor.rotation.x=-Math.PI/2;floor.position.y=-1;
    scene.add(floor);

    // Stage glow strip
    const stageGeo=new THREE.BoxGeometry(18,0.08,0.5);
    const stageMat=new THREE.MeshStandardMaterial({color:0xef4444,emissive:0xef4444,emissiveIntensity:0.8});
    const stage=new THREE.Mesh(stageGeo,stageMat);
    stage.position.set(0,-0.9,-2);
    scene.add(stage);

    // Build crowd (5 rows x 12 cols)
    const ROWS=5; const COLS=12;
    const headGeo=new THREE.SphereGeometry(0.18,8,8);
    const bodyGeo=new THREE.CylinderGeometry(0.12,0.18,0.5,8);
    for(let row=0;row<ROWS;row++){
      for(let col=0;col<COLS;col++){
        const group=new THREE.Group();
        const hue=0.09+Math.random()*0.04;
        const mat=new THREE.MeshStandardMaterial({color:new THREE.Color().setHSL(hue,0.8,0.35),metalness:0.1,roughness:0.7});
        const headMat=new THREE.MeshStandardMaterial({color:0xfed7aa,metalness:0.05,roughness:0.8});
        const body=new THREE.Mesh(bodyGeo,mat.clone());
        const head=new THREE.Mesh(headGeo,headMat.clone());
        head.position.y=0.4;
        group.add(body);group.add(head);
        const colFrac=col/(COLS-1);
        group.position.set(-5+col*0.9,-0.4+row*0.65,-(row*0.8+1));
        group.userData.row=row;group.userData.colFrac=colFrac;
        scene.add(group);
        crowdRef.current.push({
          mesh:group,colFrac,row,excitementCurrent:0,
          phase:Math.random()*Math.PI*2,
        });
      }
    }

    // Power meter tube
    const meterGeo=new THREE.CylinderGeometry(0.25,0.25,6,16,1,true);
    const meterMat=new THREE.MeshStandardMaterial({color:0x1a0a00,transparent:true,opacity:0.4,side:THREE.DoubleSide});
    const meter=new THREE.Mesh(meterGeo,meterMat);
    meter.position.set(-7,2,2);
    scene.add(meter);

    const fillGeo=new THREE.CylinderGeometry(0.22,0.22,0.1,16);
    const fillMat=new THREE.MeshStandardMaterial({color:0xf59e0b,emissive:0xf59e0b,emissiveIntensity:1});
    const fill=new THREE.Mesh(fillGeo,fillMat);
    fill.position.set(-7,-1,2);
    fill.userData.isMeterFill=true;
    scene.add(fill);

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
      const vol=smoothVolRef.current;

      // Update crowd excitement
      crowdRef.current.forEach((cm,i)=>{
        const stagger=cm.colFrac*0.12+(cm.row/4)*0.08;
        const target=Math.max(0,Math.min(1,vol-stagger*0.15));
        cm.excitementCurrent=cm.excitementCurrent*0.88+target*0.12;
        const exc=cm.excitementCurrent;

        // Sway
        const swayX=exc*0.3*Math.sin(t*2.2+cm.colFrac*6);
        const bobY=exc*0.4*Math.abs(Math.sin(t*2.8+cm.row*1.1));
        cm.mesh.position.x=(-5+(i%12)*0.9)+swayX;
        cm.mesh.position.y=-0.4+(Math.floor(i/12)*0.65)+bobY;

        // Color shift from dark to amber
        cm.mesh.children.forEach((child,ci)=>{
          if(ci===0){// body
            const mat=((child as THREE.Mesh).material as THREE.MeshStandardMaterial);
            const lit=exc>0.3?exc:0;
            mat.color.setHSL(0.09,0.9,0.15+lit*0.35);
            mat.emissive.setHSL(0.09,1,lit*0.2);
            mat.emissiveIntensity=lit;
          }
        });
      });

      // Meter fill
      const fillMesh=scene.children.find(c=>c.userData.isMeterFill) as THREE.Mesh;
      if(fillMesh){
        const h=Math.max(0.05,vol*6);
        fillMesh.scale.y=h*10;
        fillMesh.position.y=-1+h*0.5;
      }

      // Point light intensity
      if(plRef.current){
        plRef.current.intensity=2+vol*8;
        plRef.current.color.setHSL(0.09+vol*0.05,1,0.5+vol*0.1);
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

  const getMicVolume=useCallback(()=>{
    if(!analyserRef.current||!dataArrRef.current)return 0;
    analyserRef.current.getByteFrequencyData(dataArrRef.current);
    let sum=0;
    for(let i=0;i<dataArrRef.current.length;i++)sum+=dataArrRef.current[i]**2;
    return Math.min(1,Math.sqrt(sum/dataArrRef.current.length)/128);
  },[]);

  const endGame=useCallback(()=>{
    runningRef.current=false;
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    if(audioCtxRef.current){audioCtxRef.current.close().catch(()=>{});audioCtxRef.current=null;}
    if(micStreamRef.current){micStreamRef.current.getTracks().forEach(t=>t.stop());micStreamRef.current=null;}
    const sig=sigRef.current;
    if(sig.roarStartTime!==null){sig.sustainedRoarTime+=Date.now()-sig.roarStartTime;sig.roarStartTime=null;}
    sig.avgVolume=sig.volumeCount>0?parseFloat((sig.volumeSum/sig.volumeCount).toFixed(3)):0;
    if(sig.peakVolume>0.9)sig.score+=50;
    sig.score=Math.max(0,sig.score-sig.silenceEvents*20);
    sig.score=Math.round(sig.score);
    sfx.success();hapticVictory();playVictoryFanfare();
    setFinalSig({...sig});setPhase('done');
  },[]);

  const startGameLoop=useCallback(()=>{
    runningRef.current=true;
    sigRef.current={avgVolume:0,peakVolume:0,sustainedRoarTime:0,silenceEvents:0,roarBursts:0,volumeSum:0,volumeCount:0,roarStartTime:null,score:0};
    smoothVolRef.current=0;silenceStartRef.current=null;inSilenceRef.current=false;wasAboveRef.current=false;
    setScoreDisplay(0);setTimeLeft(DURATION);setPhase('playing');
    stopMusicRef.current=startMusic('pulse');

    timerRef.current=setInterval(()=>{
      const sig=sigRef.current;
      sig.avgVolume=sig.volumeCount>0?sig.volumeSum/sig.volumeCount:0;
      const timeVal=--sigRef.current.score;// we use sig tracking separately
      setTimeLeft(prev=>{
        const next=prev-1;
        if(next<=10&&next>0)sfx.tick();
        if(next<=0)endGame();
        return next;
      });
      setScoreDisplay(Math.round(sigRef.current.score));
    },1000);

    // Audio processing loop
    const audioLoop=()=>{
      if(!runningRef.current)return;
      const rawVol=getMicVolume();
      smoothVolRef.current=smoothVolRef.current*0.8+rawVol*0.2;
      const vol=smoothVolRef.current;
      const sig=sigRef.current;
      const now=Date.now();

      sig.volumeSum+=vol;sig.volumeCount++;
      if(vol>sig.peakVolume)sig.peakVolume=vol;

      if(vol>=ROAR_THRESHOLD){
        if(sig.roarStartTime===null)sig.roarStartTime=now;
        sig.score+=vol*(10/60);
        if(!wasAboveRef.current){sig.roarBursts++;wasAboveRef.current=true;}
      } else {
        if(sig.roarStartTime!==null){sig.sustainedRoarTime+=now-sig.roarStartTime;sig.roarStartTime=null;}
        if(vol<ROAR_THRESHOLD-0.08)wasAboveRef.current=false;
      }

      if(vol<SILENCE_THRESHOLD){
        if(silenceStartRef.current===null)silenceStartRef.current=now;
        else if(!inSilenceRef.current&&now-silenceStartRef.current>=SILENCE_MS){
          inSilenceRef.current=true;sig.silenceEvents++;sfx.collision();
        }
      } else {
        silenceStartRef.current=null;inSilenceRef.current=false;
      }

      requestAnimationFrame(audioLoop);
    };
    audioLoop();
  },[endGame,getMicVolume]);

  const handlePermission=useCallback(async()=>{
    setPermError('');
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      micStreamRef.current=stream;
      const audioCtx=new AudioContext();audioCtxRef.current=audioCtx;
      const analyser=audioCtx.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=0.3;
      analyserRef.current=analyser;
      dataArrRef.current=new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      setPhase('countdown');
    }catch{setPermError('Microphone access denied.');}
  },[]);

  const handleStart=useCallback((name:string,avatar:string)=>{
    initAudio();playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);setPhase('permission');
  },[]);
  const handleCountdownDone=useCallback(()=>{startGameLoop();},[startGameLoop]);
  const handlePlayAgain=useCallback(()=>{
    if(audioCtxRef.current){audioCtxRef.current.close().catch(()=>{});audioCtxRef.current=null;}
    if(micStreamRef.current){micStreamRef.current.getTracks().forEach(t=>t.stop());micStreamRef.current=null;}
    setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);setPermError('');
  },[]);

  useEffect(()=>()=>{
    cancelAnimationFrame(rafRef.current);if(timerRef.current)clearInterval(timerRef.current);
    if(stopMusicRef.current)stopMusicRef.current();
    if(audioCtxRef.current)audioCtxRef.current.close().catch(()=>{});
    if(micStreamRef.current)micStreamRef.current.getTracks().forEach(t=>t.stop());
  },[]);

  const buildInsights=(sig:Signals)=>{
    const avg=sig.volumeCount>0?Math.round(sig.volumeSum/sig.volumeCount*100):0;
    return[
      {label:'Max Power',value:`${Math.round(sig.peakVolume*100)}%`,color:sig.peakVolume>=0.8?'#4ade80':'#f97316'},
      {label:'Avg Volume',value:`${avg}%`,color:avg>=60?'#4ade80':'#facc15'},
      {label:'Roar Time',value:`${Math.round(sig.sustainedRoarTime/1000)}s`,color:'#fbbf24'},
      {label:'Silent Moments',value:`${sig.silenceEvents}`,color:sig.silenceEvents===0?'#4ade80':'#ef4444'},
    ];
  };

  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Allow Mic & Start" accentColor={accent} onStart={handleStart} sensorNote="🎤 Microphone"/>}
      {phase==='permission'&&(
        <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#0d0800',gap:24,padding:'32px 24px'}}>
          <div style={{width:96,height:96,borderRadius:'50%',background:'rgba(245,158,11,0.12)',border:`2px solid ${accent}44`,display:'flex',alignItems:'center',justifyContent:'center'}}><Mic size={48} color={accent}/></div>
          <div style={{textAlign:'center',maxWidth:300}}>
            <div style={{fontSize:28,fontWeight:800,color:'#fff',marginBottom:12}}>Mic Access Needed</div>
            <div style={{fontSize:16,color:'rgba(255,255,255,0.6)',lineHeight:1.6}}>Roar into your mic to energize the 3D crowd!</div>
          </div>
          {permError&&<div style={{color:'#ef4444',fontSize:14,textAlign:'center',maxWidth:280}}>{permError}</div>}
          <button onClick={()=>{void handlePermission();}} style={{background:accent,color:'#000',border:'none',borderRadius:14,padding:'0 48px',height:56,fontSize:18,fontWeight:800,cursor:'pointer',minWidth:240}}>Allow &amp; Start</button>
          <button onClick={()=>setPhase('start')} style={{background:'transparent',color:'rgba(255,255,255,0.45)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:10,padding:'10px 24px',fontSize:15,cursor:'pointer'}}>Back</button>
        </div>
      )}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accent}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <>
          <div ref={mountRef} style={{position:'absolute',inset:0,width:'100%',height:'100%'}}/>
          {phase==='playing'&&<GameHUD accentColor={accent} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10,testId:'timer'},{label:'POWER',value:scoreDisplay,testId:'score'}]}/>}
        </>
      )}
      {phase==='done'&&finalSig&&(
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={accent} onPlayAgain={handlePlayAgain}
          didWin={finalSig.peakVolume>=ROAR_THRESHOLD}/>
      )}
      {phase==='done'&&finalSig&&<WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>}
    </GameShell>
  );
}

function WebhookEmitter({theme,sig,personality,player}:{theme:ReturnType<typeof useBrandTheme>;sig:Signals;personality:string;player:PlayerSession|null;}){
  const fired=useRef(false);
  useEffect(()=>{if(fired.current)return;fired.current=true;postWebhook(theme,GAME_ID,{personality,score:sig.score,peakVolume:sig.peakVolume,sustainedRoarTime:sig.sustainedRoarTime,silenceEvents:sig.silenceEvents,roarBursts:sig.roarBursts},player);},[theme,sig,personality,player]);
  return null;
}
