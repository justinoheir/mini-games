'use client';
/**
 * CURLING SWEEP — 3D: swipe to throw a stone, tilt/drag to sweep it on ice.
 * Beautiful 3D ice rink with perspective, granite stone, and glowing target rings.
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
import { createTiltController } from '@/lib/tilt';

const GAME_ID = 'curling-sweep';
const ACCENT = '#67e8f9';
const DURATION = 45;
const GAME_EMOJI = '🥌';
const GAME_TITLE = 'Curling Sweep';
const GAME_TAGLINE = 'Flick to throw. Tilt to sweep!';
const PB_KEY = 'mg_pb_curling-sweep';

interface Signals {
  score:number; hits:number; attempts:number; reactionTimes:number[];
  maxStreak:number; streakCurrent:number;
}
function getPersonality(sig:Signals):string {
  if(sig.score>=20) return '🥌 Olympic Curler';
  if(sig.score>=12) return '🎯 Skip Champion';
  if(sig.maxStreak>=3) return '🌀 Sweep Master';
  return '🧹 The Sweeper';
}

type Phase = 'start'|'countdown'|'playing'|'done';
type StoneState = 'aim'|'sliding'|'scoring'|'resetting';

interface GS {
  running:boolean; timeLeft:number; sig:Signals;
  stoneState:StoneState;
  stoneX:number; stoneY:number; stoneVX:number; stoneVY:number;
  stoneSpin:number; stoneSpinV:number;
  targetX:number; sweepX:number;
  resetTimer:number; scoreResult:string;
  throwTime:number;
}

const RINGS = [0.22,0.16,0.10,0.05];
const RING_COLORS = [0xef4444,0xffffff,0xef4444,0x1d4ed8];

export default function CurlingSweepGame() {
  const theme = useBrandTheme();
  const accent = theme.colors.accent ?? ACCENT;

  const mountRef    = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer|null>(null);
  const sceneRef    = useRef<THREE.Scene|null>(null);
  const cameraRef   = useRef<THREE.PerspectiveCamera|null>(null);
  const rafRef      = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef= useRef<(()=>void)|null>(null);
  const tiltCtrlRef = useRef<ReturnType<typeof createTiltController>|null>(null);
  const tiltXRef    = useRef(0);
  const stoneMeshRef= useRef<THREE.Group|null>(null);
  const trailRef    = useRef<THREE.Points|null>(null);
  const trailPos    = useRef<Float32Array>(new Float32Array(60*3));
  const trailCt     = useRef(0);
  const iceParticlesRef = useRef<THREE.Points|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0},
    stoneState:'aim',stoneX:0,stoneY:-3.5,stoneVX:0,stoneVY:0,stoneSpin:0,stoneSpinV:0,
    targetX:0,sweepX:0,resetTimer:0,scoreResult:'',throwTime:0,
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
    renderer.setSize(W,H);renderer.setClearColor(0x040d14);
    mount.appendChild(renderer.domElement);
    rendererRef.current=renderer;

    const scene=new THREE.Scene();
    scene.fog=new THREE.Fog(0x040d14,20,40);
    sceneRef.current=scene;

    const camera=new THREE.PerspectiveCamera(60,W/H,0.1,50);
    camera.position.set(0,5,8);
    camera.lookAt(0,0,-1);
    cameraRef.current=camera;

    scene.add(new THREE.AmbientLight(0x99e6f0,0.5));
    const pl=new THREE.PointLight(0x67e8f9,3,25);
    pl.position.set(0,8,2);scene.add(pl);
    scene.add(new THREE.DirectionalLight(0xffffff,0.3));

    // Ice surface
    const iceGeo=new THREE.PlaneGeometry(10,20);
    const iceMat=new THREE.MeshStandardMaterial({color:0x0a1e2e,metalness:0.6,roughness:0.2});
    const ice=new THREE.Mesh(iceGeo,iceMat);
    ice.rotation.x=-Math.PI/2;
    scene.add(ice);

    // Ice sheen lines
    for(let i=0;i<12;i++){
      const geo=new THREE.PlaneGeometry(10,0.02);
      const mat=new THREE.MeshStandardMaterial({color:0xffffff,transparent:true,opacity:0.04+Math.random()*0.03});
      const m=new THREE.Mesh(geo,mat);
      m.rotation.x=-Math.PI/2;m.position.z=-8+i*1.5;m.position.y=0.001;
      scene.add(m);
    }

    // Target house rings
    const houseGroup=new THREE.Group();
    houseGroup.position.set(0,0.005,-6);
    RINGS.forEach((r,i)=>{
      const geo=new THREE.RingGeometry(i>0?RINGS[i-1]*5.5:0,r*5.5,48);
      const mat=new THREE.MeshStandardMaterial({color:RING_COLORS[i],side:THREE.DoubleSide,transparent:true,opacity:0.85});
      const ring=new THREE.Mesh(geo,mat);
      ring.rotation.x=-Math.PI/2;
      houseGroup.add(ring);
    });
    scene.add(houseGroup);

    // Delivery line
    const dlGeo=new THREE.PlaneGeometry(0.04,6);
    const dlMat=new THREE.MeshStandardMaterial({color:0x67e8f9,transparent:true,opacity:0.3});
    const dl=new THREE.Mesh(dlGeo,dlMat);
    dl.rotation.x=-Math.PI/2;dl.position.set(0,0.002,-3);
    scene.add(dl);

    // Stone mesh (granite with handle)
    const stoneGroup=new THREE.Group();
    // Granite body
    const bodyGeo=new THREE.CylinderGeometry(0.5,0.5,0.3,24);
    const bodyMat=new THREE.MeshStandardMaterial({color:0x94a3b8,metalness:0.3,roughness:0.7});
    stoneGroup.add(new THREE.Mesh(bodyGeo,bodyMat));
    // Team ring
    const ringGeo=new THREE.TorusGeometry(0.38,0.04,6,24);
    const ringMat=new THREE.MeshStandardMaterial({color:0xef4444,emissive:0xef4444,emissiveIntensity:0.3});
    const ringMesh=new THREE.Mesh(ringGeo,ringMat);
    ringMesh.position.y=0.02;
    stoneGroup.add(ringMesh);
    // Handle
    const handleGeo=new THREE.CylinderGeometry(0.06,0.06,0.4,8);
    const handleMat=new THREE.MeshStandardMaterial({color:0xfbbf24,metalness:0.6,roughness:0.3});
    const handle=new THREE.Mesh(handleGeo,handleMat);
    handle.position.y=0.35;stoneGroup.add(handle);
    stoneGroup.position.set(0,0.15,-3.5);
    scene.add(stoneGroup);
    stoneMeshRef.current=stoneGroup;

    // Trail
    const trailGeo=new THREE.BufferGeometry();
    const tp=new Float32Array(60*3);trailPos.current=tp;
    trailGeo.setAttribute('position',new THREE.BufferAttribute(tp,3));
    trailGeo.setDrawRange(0,0);
    const trail=new THREE.Points(trailGeo,new THREE.PointsMaterial({color:0x67e8f9,size:0.1,transparent:true,opacity:0.5}));
    scene.add(trail);trailRef.current=trail;

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
      const stone=stoneMeshRef.current;if(!stone)return;

      if(s.stoneState==='sliding'){
        // Tilt sweeping
        const sweepF=tiltXRef.current*0.00015;
        s.stoneVX+=sweepF;
        s.stoneVX*=0.994;s.stoneVY*=0.994;
        s.stoneX+=s.stoneVX;s.stoneY+=s.stoneVY;
        s.stoneX=Math.max(-4.5,Math.min(4.5,s.stoneX));
        s.stoneSpin+=s.stoneSpinV;s.stoneSpinV*=0.98;

        // Trail
        const tc=trailCt.current;
        if(tc<60){
          trailPos.current[tc*3]=s.stoneX;trailPos.current[tc*3+1]=0.05;trailPos.current[tc*3+2]=s.stoneY;
          trailCt.current++;
          (trailRef.current?.geometry.attributes.position as THREE.BufferAttribute).needsUpdate=true;
          trailRef.current?.geometry.setDrawRange(0,tc+1);
        }

        const speed=Math.sqrt(s.stoneVX**2+s.stoneVY**2);
        if(speed<0.0003||s.stoneY<-7){
          s.stoneState='scoring';
          scoreShot();
        }
      } else if(s.stoneState==='resetting'){
        s.resetTimer--;
        if(s.resetTimer<=0)resetStone();
      }

      // Animate stone
      stone.position.set(s.stoneX,0.15,s.stoneY);
      stone.rotation.y=s.stoneSpin;

      // Update target X
      scene.children.find(c=>c.position.y===0.005)?.position?.set?.(s.targetX,0.005,-6);

      renderer.render(scene,camera);
    };
    render();

    return()=>{
      window.removeEventListener('resize',onResize);
      cancelAnimationFrame(rafRef.current);
      renderer.dispose();mount.removeChild(renderer.domElement);
    };
  },[]);

  const resetStone=useCallback(()=>{
    const s=stateRef.current;
    s.stoneX=0;s.stoneY=-3.5;s.stoneVX=0;s.stoneVY=0;
    s.stoneSpinV=0;s.stoneSpin=0;s.stoneState='aim';
    trailCt.current=0;
    if(trailRef.current)trailRef.current.geometry.setDrawRange(0,0);
    s.targetX=-1.5+Math.random()*3;
    s.sig.attempts++;s.throwTime=Date.now();
  },[]);

  const scoreShot=useCallback(()=>{
    const s=stateRef.current;
    const dx=Math.abs(s.stoneX-s.targetX);
    let pts=0;
    if(dx<0.27)pts=4;
    else if(dx<0.55)pts=3;
    else if(dx<0.88)pts=2;
    else if(dx<1.2)pts=1;

    if(pts>0){
      s.sig.hits++;s.sig.streakCurrent++;
      if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;
      const bonus=s.sig.streakCurrent>=3?pts+1:pts;
      s.sig.score+=bonus;setScore(s.sig.score);
      s.scoreResult=pts===4?`BULLSEYE! +${bonus}⭐`:`GREAT! +${bonus}`;
      sfx.success();haptic([40,20,80]);
    } else {
      s.sig.streakCurrent=0;s.scoreResult='OUT!';
      sfx.nearMiss();haptic([20,30,20]);
    }
    s.stoneState='resetting';s.resetTimer=90;
  },[]);

  const endGame=useCallback(()=>{
    const s=stateRef.current;s.running=false;
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    if(tiltCtrlRef.current){tiltCtrlRef.current.stop();tiltCtrlRef.current=null;}
    const pb=parseInt(localStorage.getItem(PB_KEY)??'0');
    if(s.sig.score>pb)localStorage.setItem(PB_KEY,String(s.sig.score));
    setFinalSig({...s.sig});setPhase('done');
  },[]);

  const startLoop=useCallback(()=>{
    const s=stateRef.current;
    s.running=true;s.timeLeft=DURATION;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    setScore(0);setTimeLeft(DURATION);setPhase('playing');
    stopMusicRef.current=startMusic('calm');
    const tiltCtrl=createTiltController(x=>{tiltXRef.current=x;},{sensitivity:1.0,clamp:20});
    tiltCtrl.start();tiltCtrlRef.current=tiltCtrl;
    resetStone();

    timerRef.current=setInterval(()=>{
      const s2=stateRef.current;s2.timeLeft--;setTimeLeft(s2.timeLeft);
      if(s2.timeLeft<=0){sfx.fail();haptic([100]);endGame();}
    },1000);
  },[endGame,resetStone]);

  // Pointer input
  useEffect(()=>{
    const mount=mountRef.current;if(!mount)return;
    const resize=()=>{
      const c=rendererRef.current?.domElement;if(!c)return;
    };
    let startY=0,startX=0,startT=0;
    const onDown=(e:PointerEvent)=>{
      startY=e.clientY;startX=e.clientX;startT=Date.now();
    };
    const onUp=(e:PointerEvent)=>{
      const s=stateRef.current;if(s.stoneState!=='aim')return;
      const dy=(e.clientY)-startY; const dx=(e.clientX)-startX;
      const dt=Math.max(Date.now()-startT,50);
      if(dy<-20){
        const velY=Math.min(Math.abs(dy)/dt*0.012,0.02);
        const velX=(dx/dt)*0.006;
        s.stoneVX=velX;s.stoneVY=-velY;s.stoneSpinV=dx/dt*0.05;
        s.stoneState='sliding';sfx.whoosh();haptic([30]);
      }
    };
    const onMove=(e:PointerEvent)=>{
      const s=stateRef.current;
      if(s.stoneState==='sliding'){
        const rect=mount.getBoundingClientRect();
        tiltXRef.current=((e.clientX-rect.left)/rect.width-0.5)*2;
      }
    };
    mount.addEventListener('pointerdown',onDown);
    mount.addEventListener('pointerup',onUp);
    mount.addEventListener('pointermove',onMove);
    return()=>{mount.removeEventListener('pointerdown',onDown);mount.removeEventListener('pointerup',onUp);mount.removeEventListener('pointermove',onMove);};
  },[]);

  useEffect(()=>()=>{
    cancelAnimationFrame(rafRef.current);if(timerRef.current)clearInterval(timerRef.current);
    if(stopMusicRef.current)stopMusicRef.current();if(tiltCtrlRef.current)tiltCtrlRef.current.stop();
  },[]);

  const handleStart=useCallback((name:string,avatar:string)=>{
    initAudio();playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);setPhase('countdown');
  },[]);
  const handleCountdownDone=useCallback(()=>{startLoop();},[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScore(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  const buildInsights=(sig:Signals)=>{
    const acc=sig.attempts>0?Math.round(sig.hits/sig.attempts*100):0;
    const pb=parseInt(localStorage.getItem(PB_KEY)??'0');
    if(sig.score>pb)localStorage.setItem(PB_KEY,String(sig.score));
    return[
      {label:'On Target',value:`${acc}%`,color:acc>=70?'#4ade80':acc>=40?'#facc15':'#ef4444'},
      {label:'Shots',value:String(sig.hits),color:accent},
      {label:'Best Run',value:`🥌${sig.maxStreak}`,color:accent},
      {label:'Score',value:String(sig.score),color:'var(--color-text)'},
    ];
  };

  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={accent} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accent}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <>
          <div ref={mountRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
          {phase==='playing'&&<GameHUD accentColor={accent} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5},{label:'SCORE',value:scoreDisplay}]}/>}
          {phase==='playing'&&(
            <div style={{position:'absolute',bottom:50,left:'50%',transform:'translateX(-50%)',
              fontSize:13,color:'rgba(255,255,255,0.5)',fontWeight:600,letterSpacing:'0.08em',textAlign:'center'}}>
              {stateRef.current.stoneState==='aim'?'SWIPE UP TO THROW':'DRAG LEFT/RIGHT TO SWEEP'}
            </div>
          )}
        </>
      )}
      {phase==='done'&&finalSig&&(
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.score>=10}/>
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
