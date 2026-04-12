'use client';
/**
 * DOMINO CHAIN — 3D: tap the first domino at the perfect moment to cascade a full chain.
 * Orange-lit dark room with glowing white 3D dominoes falling in sequence.
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

const GAME_ID      = 'domino-chain';
const ACCENT       = '#f97316';
const DURATION     = 60;
const GAME_EMOJI   = '🁣';
const GAME_TITLE   = 'Domino Chain';
const GAME_TAGLINE = 'Tap the first domino at the perfect moment. Watch the chain fall!';

const CHAIN_SIZE = 15;
const TAP_WINDOW = 600;

interface Signals {
  totalRounds:number; perfectTaps:number; earlyTaps:number; lateTaps:number;
  maxChainFall:number; score:number; bestChain:number;
}
function getPersonality(sig:Signals):string {
  const acc=(sig.perfectTaps+sig.earlyTaps+sig.lateTaps)>0?sig.perfectTaps/(sig.perfectTaps+sig.earlyTaps+sig.lateTaps):0;
  if(acc>=0.80&&sig.bestChain>=CHAIN_SIZE) return 'Chain Master 🏆';
  if(sig.bestChain>=CHAIN_SIZE) return 'Full Cascade 🌊';
  if(acc>=0.70) return 'Precision Tipper 🎯';
  if(sig.totalRounds>=5) return 'Rapid Resetter ⚡';
  return 'Careful Observer 🔍';
}

type Phase='start'|'countdown'|'playing'|'done';

interface Domino3D {
  mesh:THREE.Group; fallen:boolean; fallAngle:number; fallProgress:number; x:number;
}

interface GS {
  running:boolean; timeLeft:number; sig:Signals;
  dominoes:Domino3D[];
  chainFalling:boolean; fallIndex:number;
  tapReady:boolean; tapWindowOpen:boolean; tapWindowTime:number;
  phaseTimer:number; phaseDuration:number;
  currentChainFall:number; accentColor:string;
  feedbackText:string; feedbackAlpha:number; fallSpeed:number;
}

function DominoChainGameInner() {
  const theme = useBrandTheme();
  const accent = theme.colors.accent ?? ACCENT;

  const mountRef     = useRef<HTMLDivElement>(null);
  const rendererRef  = useRef<THREE.WebGLRenderer|null>(null);
  const sceneRef     = useRef<THREE.Scene|null>(null);
  const cameraRef    = useRef<THREE.PerspectiveCamera|null>(null);
  const rafRef       = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);
  const [phase,setPhase]        = useState<Phase>('start');
  const [timeLeft,setTimeLeft]  = useState(DURATION);
  const [scoreDisplay,setScore] = useState(0);
  const [finalSig,setFinalSig]  = useState<Signals|null>(null);
  const [feedback,setFeedback]  = useState('');

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{totalRounds:0,perfectTaps:0,earlyTaps:0,lateTaps:0,maxChainFall:0,score:0,bestChain:0},
    dominoes:[],chainFalling:false,fallIndex:0,
    tapReady:false,tapWindowOpen:false,tapWindowTime:0,
    phaseTimer:0,phaseDuration:180,
    currentChainFall:0,accentColor:ACCENT,
    feedbackText:'',feedbackAlpha:0,fallSpeed:0.04,
  });

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

    const camera=new THREE.PerspectiveCamera(65,W/H,0.1,50);
    camera.position.set(0,2.5,10);camera.lookAt(0,0,0);
    cameraRef.current=camera;

    scene.add(new THREE.AmbientLight(0xffffff,0.25));
    const pl=new THREE.PointLight(0xf97316,4,20);pl.position.set(0,5,5);scene.add(pl);
    scene.add(new THREE.DirectionalLight(0xffd6a0,0.3));

    // Table surface
    const tableGeo=new THREE.BoxGeometry(20,0.15,4);
    const tableMat=new THREE.MeshStandardMaterial({color:0x1a0a00,metalness:0.2,roughness:0.8});
    scene.add(Object.assign(new THREE.Mesh(tableGeo,tableMat),{position:{x:0,y:-0.8,z:0,set:()=>{}}}));
    const tableM=new THREE.Mesh(tableGeo,tableMat);tableM.position.y=-0.8;scene.add(tableM);

    // Create dominoes
    const buildDominoes=(s:GS)=>{
      // Remove old
      s.dominoes.forEach(d=>scene.remove(d.mesh));
      s.dominoes=[];
      const spacing=1.0;
      const startX=-(CHAIN_SIZE-1)*spacing/2;
      for(let i=0;i<CHAIN_SIZE;i++){
        const group=new THREE.Group();
        const bodyGeo=new THREE.BoxGeometry(0.3,1,0.55);
        const hue=i/CHAIN_SIZE;
        const col=new THREE.Color().setHSL(0.06+hue*0.1,0.9,0.6);
        const bodyMat=new THREE.MeshStandardMaterial({color:col,metalness:0.3,roughness:0.5,emissive:col,emissiveIntensity:0.2});
        group.add(new THREE.Mesh(bodyGeo,bodyMat));
        // Dots
        const dotGeo=new THREE.SphereGeometry(0.04,6,6);
        const dotMat=new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xffffff,emissiveIntensity:1});
        for(let d=0;d<3;d++){const dot=new THREE.Mesh(dotGeo,dotMat);dot.position.set(0.16,0.2-d*0.2,0);group.add(dot);}
        group.position.set(startX+i*spacing,0,0);
        scene.add(group);
        s.dominoes.push({mesh:group,fallen:false,fallAngle:0,fallProgress:0,x:startX+i*spacing});
      }
    };

    const s=stateRef.current;
    buildDominoes(s);

    // Glow indicator for first domino
    const glowGeo=new THREE.SphereGeometry(0.4,8,8);
    const glowMat=new THREE.MeshStandardMaterial({color:0xf97316,emissive:0xf97316,emissiveIntensity:0.5,transparent:true,opacity:0.3});
    const glow=new THREE.Mesh(glowGeo,glowMat);
    glow.userData.isGlow=true;
    scene.add(glow);

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

      // Phase timer (wait → tap window)
      if(s2.running&&!s2.chainFalling){
        s2.phaseTimer++;
        if(!s2.tapWindowOpen&&s2.phaseTimer>=s2.phaseDuration-60){
          s2.tapWindowOpen=true;s2.tapWindowTime=Date.now();
        }
        if(s2.phaseTimer>=s2.phaseDuration){
          // Auto-reset if not tapped
          if(!s2.chainFalling){
            s2.phaseTimer=0;s2.tapWindowOpen=false;s2.tapReady=false;
            s2.sig.lateTaps++;
            setFeedback('⏱️ TOO LATE!');
            setTimeout(()=>setFeedback(''),800);
            // Reset dominoes
            s2.dominoes.forEach(d=>{d.fallen=false;d.fallAngle=0;d.fallProgress=0;d.mesh.rotation.z=0;});
          }
        }
      }

      // Chain falling
      if(s2.chainFalling&&s2.running){
        while(s2.fallIndex<s2.dominoes.length){
          const d=s2.dominoes[s2.fallIndex];
          if(!d.fallen){
            d.fallProgress+=s2.fallSpeed;
            d.fallAngle=Math.min(Math.PI/2,d.fallProgress*Math.PI/2);
            d.mesh.rotation.z=-d.fallAngle;
            d.mesh.position.y=Math.cos(d.fallAngle)*0.5;
            if(d.fallAngle>=Math.PI/2*0.85){
              d.fallen=true;s2.fallIndex++;s2.currentChainFall++;
              sfx.click();haptic([10]);
            }
            break;
          } else {s2.fallIndex++;}
        }
        if(s2.fallIndex>=s2.dominoes.length){
          // Chain complete!
          s2.chainFalling=false;
          if(s2.currentChainFall>s2.sig.maxChainFall)s2.sig.maxChainFall=s2.currentChainFall;
          if(s2.currentChainFall>=CHAIN_SIZE){
            if(s2.currentChainFall>s2.sig.bestChain)s2.sig.bestChain=s2.currentChainFall;
            sfx.success();haptic([50,30,80]);
            setFeedback('🎉 FULL CHAIN!');
          }
          // Reset for next round
          setTimeout(()=>{
            s2.dominoes.forEach(d=>{d.fallen=false;d.fallAngle=0;d.fallProgress=0;d.mesh.rotation.z=0;d.mesh.position.y=0;});
            s2.fallIndex=0;s2.currentChainFall=0;s2.phaseTimer=0;s2.tapWindowOpen=false;s2.tapReady=true;
            s2.sig.totalRounds++;setFeedback('');
          },1200);
        }
      }

      // Glow pulse on first domino
      const glowMesh=scene.children.find(c=>c.userData.isGlow) as THREE.Mesh;
      if(glowMesh&&s2.dominoes.length>0){
        const fd=s2.dominoes[0];
        glowMesh.position.copy(fd.mesh.position);
        glowMesh.position.y+=0.5;
        const pulse=s2.tapWindowOpen?1+Math.sin(t*8)*0.3:0.3+Math.sin(t*2)*0.1;
        (glowMesh.material as THREE.MeshStandardMaterial).opacity=s2.tapWindowOpen?0.3*pulse:0.1;
        (glowMesh.material as THREE.MeshStandardMaterial).emissiveIntensity=pulse;
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

  const triggerChain=useCallback(()=>{
    const s=stateRef.current;
    if(s.chainFalling||!s.running)return;
    const now=Date.now();
    const windowAge=now-s.tapWindowTime;
    if(s.tapWindowOpen&&windowAge>=0&&windowAge<=TAP_WINDOW){
      s.sig.perfectTaps++;s.sig.score+=CHAIN_SIZE*5;setScore(s.sig.score);
      sfx.success();setFeedback('✨ PERFECT!');
    } else if(!s.tapWindowOpen){
      s.sig.earlyTaps++;s.sig.score+=CHAIN_SIZE*2;setScore(s.sig.score);
      sfx.collect();setFeedback('⚡ EARLY');
    } else {
      s.sig.lateTaps++;s.sig.score+=CHAIN_SIZE;setScore(s.sig.score);
      sfx.collect();setFeedback('⏱️ LATE');
    }
    s.chainFalling=true;s.fallIndex=0;s.tapWindowOpen=false;
  },[]);

  const endGame=useCallback(()=>{
    const s=stateRef.current;s.running=false;
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    const sig={...s.sig};
    const pb=parseInt(localStorage.getItem(`pb_${GAME_ID}`)??'0');
    if(sig.score>pb)localStorage.setItem(`pb_${GAME_ID}`,String(sig.score));
    setFinalSig(sig);setPhase('done');
  },[]);

  const startLoop=useCallback(()=>{
    const s=stateRef.current;
    s.running=true;s.timeLeft=DURATION;
    s.sig={totalRounds:0,perfectTaps:0,earlyTaps:0,lateTaps:0,maxChainFall:0,score:0,bestChain:0};
    s.chainFalling=false;s.fallIndex=0;s.tapReady=true;s.tapWindowOpen=false;s.phaseTimer=0;s.currentChainFall=0;
    setScore(0);setTimeLeft(DURATION);setPhase('playing');
    stopMusicRef.current=startMusic('calm');

    timerRef.current=setInterval(()=>{
      const s2=stateRef.current;s2.timeLeft--;setTimeLeft(s2.timeLeft);
      if(s2.timeLeft<=0)endGame();
    },1000);
  },[endGame]);

  // Tap handler
  useEffect(()=>{
    const mount=mountRef.current;if(!mount)return;
    const onPointerDown=(e:PointerEvent)=>{if(phase==='playing')triggerChain();};
    mount.addEventListener('pointerdown',onPointerDown);
    return()=>mount.removeEventListener('pointerdown',onPointerDown);
  },[phase,triggerChain]);

  useEffect(()=>()=>{cancelAnimationFrame(rafRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);
  const handleStart=useCallback(async(name:string,avatar:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);await initAudio();setPhase('countdown');},[]);
  const handleCountdownDone=useCallback(()=>{startLoop();},[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScore(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Set Up Chain!" accentColor={accent} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accent}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <>
          <div ref={mountRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
          {phase==='playing'&&(
            <>
              <GameHUD accentColor={accent} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>
              {feedback&&<div style={{position:'absolute',top:'30%',left:'50%',transform:'translateX(-50%)',fontSize:26,fontWeight:900,color:accent,textShadow:`0 0 20px ${accent}`,pointerEvents:'none',letterSpacing:'0.05em'}}>{feedback}</div>}
              <div style={{position:'absolute',bottom:50,left:'50%',transform:'translateX(-50%)',fontSize:13,color:'rgba(255,255,255,0.5)',fontWeight:600,letterSpacing:'0.1em',textAlign:'center'}}>
                TAP WHEN DOMINO GLOWS BRIGHT
              </div>
            </>
          )}
        </>
      )}
      {phase==='done'&&finalSig&&(
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            {label:'Perfect Taps',value:String(finalSig.perfectTaps),color:finalSig.perfectTaps>=5?'#4ade80':'#facc15'},
            {label:'Best Chain',value:`${finalSig.bestChain}/${CHAIN_SIZE}`,color:finalSig.bestChain>=CHAIN_SIZE?'#4ade80':accent},
            {label:'Early Taps',value:String(finalSig.earlyTaps),color:'#fbbf24'},
            {label:'Late Taps',value:String(finalSig.lateTaps),color:'#ef4444'},
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.bestChain>=CHAIN_SIZE}/>
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

import dynamic from 'next/dynamic';
const DominoChainGame = dynamic(() => Promise.resolve({ default: DominoChainGameInner }), { ssr: false });
export default DominoChainGame;
