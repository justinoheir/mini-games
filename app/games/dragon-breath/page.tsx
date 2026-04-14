'use client';
/**
 * DRAGON BREATH — 3D: blow into the mic to breathe fire. Enemies approach from the front.
 * Volcanic 3D environment with particle fire system. Roar = destruction.
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
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';

const GAME_ID = 'dragon-breath';
const ACCENT = '#ff6b35';
const DURATION = 45;
const GAME_EMOJI = '🐉';
const GAME_TITLE = 'Dragon Breath';
const GAME_TAGLINE = 'Blow fire. Burn your enemies!';
const PB_KEY = 'mg_pb_dragon-breath';

interface Signals {
  score:number; enemiesKilled:number; breathSeconds:number; maxStreak:number;
}
function getPersonality(sig:Signals):string {
  if(sig.enemiesKilled>=18&&sig.breathSeconds>22) return 'Inferno Dragon 🔥';
  if(sig.enemiesKilled>=12) return 'Fire Breather 🐉';
  if(sig.breathSeconds>28) return 'Smoldering Beast 🌋';
  if(sig.enemiesKilled>=6) return 'Ember Guardian ⚔️';
  return 'Young Dragon 🥚';
}

interface Enemy3D { mesh:THREE.Mesh; speed:number; size:number; }
interface FireParticle3D { mesh:THREE.Mesh; vx:number; vy:number; vz:number; life:number; maxLife:number; }

type Phase='start'|'countdown'|'playing'|'done';

interface GS {
  running:boolean; timeLeft:number; score:number; streak:number; maxStreak:number;
  breathFrames:number; enemies:Enemy3D[]; fireParticles:FireParticle3D[];
  analyser:AnalyserNode|null; audioCtx:AudioContext|null; stream:MediaStream|null;
  timerIntervalId:ReturnType<typeof setInterval>|null;
  nextEnemyIn:number; enemyCounter:number; lives:number; flashUntil:number; smoothVol:number;
}

function DragonBreathInner() {
  const theme = useBrandTheme();
  const accent = theme.colors.accent ?? ACCENT;

  const mountRef     = useRef<HTMLDivElement>(null);
  const rendererRef  = useRef<THREE.WebGLRenderer|null>(null);
  const sceneRef     = useRef<THREE.Scene|null>(null);
  const cameraRef    = useRef<THREE.PerspectiveCamera|null>(null);
  const rafRef       = useRef(0);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const dragonHeadRef= useRef<THREE.Group|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,score:0,streak:0,maxStreak:0,breathFrames:0,
    enemies:[],fireParticles:[],analyser:null,audioCtx:null,stream:null,timerIntervalId:null,
    nextEnemyIn:80,enemyCounter:0,lives:3,flashUntil:0,smoothVol:0,
  });

  const [phase,setPhase]        = useState<Phase>('start');
  const [timeLeft,setTimeLeft]  = useState(DURATION);
  const [scoreDisplay,setScore] = useState(0);
  const [finalSig,setFinalSig]  = useState<Signals|null>(null);
  const [permError,setPermError]= useState('');
  const [lives,setLivesDisplay] = useState(3);

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
    scene.fog=new THREE.FogExp2(0x0d0200,0.035);
    sceneRef.current=scene;

    const camera=new THREE.PerspectiveCamera(70,W/H,0.1,60);
    camera.position.set(0,1,8);camera.lookAt(0,0.5,0);
    cameraRef.current=camera;

    scene.add(new THREE.AmbientLight(0xff4400,0.3));
    const pl=new THREE.PointLight(0xff6600,4,20);pl.position.set(0,3,5);scene.add(pl);
    const pl2=new THREE.PointLight(0xff0000,2,10);pl2.position.set(-2,0,3);scene.add(pl2);

    // Volcanic floor
    const floorGeo=new THREE.PlaneGeometry(20,30);
    const floorMat=new THREE.MeshStandardMaterial({color:0x1a0500,metalness:0.2,roughness:0.9});
    const floor=new THREE.Mesh(floorGeo,floorMat);floor.rotation.x=-Math.PI/2;floor.position.y=-1;scene.add(floor);

    // Lava cracks on floor
    for(let i=0;i<8;i++){
      const lg=new THREE.CylinderGeometry(0.05,0.05,2+Math.random()*3,4);
      const lm=new THREE.MeshStandardMaterial({color:0xff4400,emissive:0xff2200,emissiveIntensity:1.5});
      const lv=new THREE.Mesh(lg,lm);
      lv.rotation.z=Math.random()*Math.PI;lv.rotation.x=Math.PI/2;
      lv.position.set((Math.random()-0.5)*8,-0.99,-(Math.random()*8));
      scene.add(lv);
    }

    // Dragon head silhouette
    const dragonGroup=new THREE.Group();
    // Snout
    const snoutGeo=new THREE.ConeGeometry(0.4,1.2,6);
    const dragonMat=new THREE.MeshStandardMaterial({color:0x7c2d12,metalness:0.3,roughness:0.6,emissive:0x451004,emissiveIntensity:0.3});
    const snout=new THREE.Mesh(snoutGeo,dragonMat.clone());snout.rotation.x=Math.PI/2;snout.position.z=0.8;dragonGroup.add(snout);
    // Eyes
    const eyeGeo=new THREE.SphereGeometry(0.08,8,8);
    const eyeMat=new THREE.MeshStandardMaterial({color:0xfbbf24,emissive:0xf59e0b,emissiveIntensity:3});
    [-0.25,0.25].forEach(ex=>{const eye=new THREE.Mesh(eyeGeo,eyeMat.clone());eye.position.set(ex,0.15,0.3);dragonGroup.add(eye);});
    dragonGroup.position.set(0,0.3,4);
    scene.add(dragonGroup);dragonHeadRef.current=dragonGroup;

    // Background volcano
    const volGeo=new THREE.ConeGeometry(3,5,8);
    const volMat=new THREE.MeshStandardMaterial({color:0x1c0900,roughness:0.9});
    const vol=new THREE.Mesh(volGeo,volMat);vol.position.set(0,1.5,-14);scene.add(vol);
    // Lava top
    const lavaGeo=new THREE.CircleGeometry(0.6,12);
    const lavaMat=new THREE.MeshStandardMaterial({color:0xff4400,emissive:0xff2200,emissiveIntensity:2});
    const lava=new THREE.Mesh(lavaGeo,lavaMat);lava.rotation.x=-Math.PI/2;lava.position.set(0,4.1,-14);scene.add(lava);

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

      const vol2=s.smoothVol;
      const isBreathing=vol2>0.15;

      // Fire particles
      if(isBreathing&&s.running){
        const numPart=Math.floor(vol2*12);
        for(let i=0;i<numPart;i++){
          const geo=new THREE.SphereGeometry(0.1+Math.random()*0.15,4,4);
          const hue=Math.random()*0.08;
          const mat=new THREE.MeshStandardMaterial({color:new THREE.Color().setHSL(hue,1,0.5+Math.random()*0.3),emissive:new THREE.Color().setHSL(hue,1,0.4),emissiveIntensity:2,transparent:true,opacity:0.9});
          const mesh=new THREE.Mesh(geo,mat);
          mesh.position.set((Math.random()-0.5)*0.6,0.3+(Math.random()-0.5)*0.4,4);
          scene2.add(mesh);
          const speed=0.2+vol2*0.3;
          s.fireParticles.push({mesh,vx:(Math.random()-0.5)*0.08,vy:(Math.random()-0.5)*0.06,vz:-(speed+Math.random()*0.1),life:1,maxLife:1});
        }
      }

      // Update fire particles
      for(let i=s.fireParticles.length-1;i>=0;i--){
        const fp=s.fireParticles[i];
        fp.mesh.position.x+=fp.vx;fp.mesh.position.y+=fp.vy;fp.mesh.position.z+=fp.vz;
        fp.life-=0.028;fp.mesh.scale.setScalar(1+fp.life*0.5);
        const mat=fp.mesh.material as THREE.MeshStandardMaterial;
        mat.opacity=fp.life*0.9;
        if(fp.life<=0){scene2.remove(fp.mesh);s.fireParticles.splice(i,1);}
      }

      // Spawn enemies
      if(s.running){
        s.nextEnemyIn--;
        if(s.nextEnemyIn<=0){
          s.nextEnemyIn=Math.max(35,80-s.enemyCounter*3);s.enemyCounter++;
          const geo=new THREE.OctahedronGeometry(0.4+Math.random()*0.25,0);
          const mat=new THREE.MeshStandardMaterial({color:0x4a1942,metalness:0.4,roughness:0.5,emissive:0x6b21a8,emissiveIntensity:0.5});
          const mesh=new THREE.Mesh(geo,mat);
          mesh.position.set((Math.random()-0.5)*5,0.3+Math.random()*1,-15);
          scene2.add(mesh);
          s.enemies.push({mesh,speed:0.04+Math.random()*0.025,size:0.45});
        }
      }

      // Update enemies
      for(let i=s.enemies.length-1;i>=0;i--){
        const en=s.enemies[i];
        en.mesh.position.z+=en.speed;
        en.mesh.rotation.x+=0.04;en.mesh.rotation.y+=0.03;

        // Check fire collision
        if(isBreathing){
          const fp2=s.fireParticles.find(fp=>fp.mesh.position.distanceTo(en.mesh.position)<en.size*1.5);
          if(fp2){
            // Hit!
            scene2.remove(en.mesh);s.enemies.splice(i,1);
            s.streak++;if(s.streak>s.maxStreak)s.maxStreak=s.streak;
            s.score+=2+(s.streak>=3?1:0);s.breathFrames++;
            setScore(s.score);sfx.collect();hapticScore();
            if(fp2.mesh.parent)scene2.remove(fp2.mesh);s.fireParticles.splice(s.fireParticles.indexOf(fp2),1);
            continue;
          }
        }

        // Enemy reached player
        if(en.mesh.position.z>5){
          scene2.remove(en.mesh);s.enemies.splice(i,1);
          if(s.running){
            s.lives--;s.streak=0;setLivesDisplay(s.lives);
            sfx.collision();hapticFail();
            if(s.lives<=0){sfx.fail();hapticFail();endGame();}
          }
        }
      }

      // Dragon head bob with volume
      if(dragonHeadRef.current){
        dragonHeadRef.current.position.y=0.3+Math.sin(t*3)*0.04+vol2*0.15;
        dragonHeadRef.current.rotation.x=vol2*0.08;
      }

      // Animate eyes
      dragonGroup.children.filter((_,i)=>i>0).forEach((eye,i)=>{
        (eye as THREE.Mesh).rotation.x=t*0.5+i;
        ((eye as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity=2+vol2*3;
      });

      renderer.render(scene,camera);
    };
    render();

    return()=>{
      window.removeEventListener('resize',onResize);
      cancelAnimationFrame(rafRef.current);
      renderer.dispose();mount.removeChild(renderer.domElement);
    };
  },[]);

  const getVolume=useCallback(()=>{
    const s=stateRef.current;if(!s.analyser)return 0;
    const data=new Uint8Array(s.analyser.frequencyBinCount);
    s.analyser.getByteFrequencyData(data);
    let sum=0;for(let i=0;i<data.length;i++)sum+=data[i]**2;
    return Math.min(1,Math.sqrt(sum/data.length)/128);
  },[]);

  const endGame=useCallback(()=>{
    const s=stateRef.current;s.running=false;
    if(s.timerIntervalId){clearInterval(s.timerIntervalId);s.timerIntervalId=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    if(s.audioCtx){s.audioCtx.close().catch(()=>{});s.audioCtx=null;}
    if(s.stream){s.stream.getTracks().forEach(t=>t.stop());s.stream=null;}
    const sig:Signals={score:s.score,enemiesKilled:s.score/2,breathSeconds:Math.round(s.breathFrames/60),maxStreak:s.maxStreak};
    const pb=parseInt(localStorage.getItem(PB_KEY)??'0');
    if(sig.score>pb)localStorage.setItem(PB_KEY,String(sig.score));
    sfx.success();hapticVictory();
    setFinalSig(sig);setPhase('done');
  },[]);

  const startLoop=useCallback(async()=>{
    const s=stateRef.current;
    s.running=true;s.timeLeft=DURATION;s.score=0;s.streak=0;s.maxStreak=0;s.breathFrames=0;
    s.enemies=[];s.fireParticles=[];s.nextEnemyIn=80;s.enemyCounter=0;s.lives=3;s.flashUntil=0;s.smoothVol=0;
    setScore(0);setTimeLeft(DURATION);setLivesDisplay(3);setPhase('playing');
    stopMusicRef.current=startMusic('pulse');

    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      s.stream=stream;
      const audioCtx=new AudioContext();s.audioCtx=audioCtx;
      const analyser=audioCtx.createAnalyser();analyser.fftSize=256;
      audioCtx.createMediaStreamSource(stream).connect(analyser);s.analyser=analyser;
    }catch{setPermError('Mic access denied — blow harder!😅');}

    s.timerIntervalId=setInterval(()=>{
      s.timeLeft--;setTimeLeft(s.timeLeft);
      if(s.timeLeft<=10&&s.timeLeft>0)sfx.tick();
      if(s.timeLeft<=0)endGame();
    },1000);

    const audioLoop=()=>{
      if(!stateRef.current.running)return;
      const raw=getVolume();
      stateRef.current.smoothVol=stateRef.current.smoothVol*0.75+raw*0.25;
      requestAnimationFrame(audioLoop);
    };
    audioLoop();
  },[endGame,getVolume]);

  useEffect(()=>()=>{
    cancelAnimationFrame(rafRef.current);
    const s=stateRef.current;
    if(s.timerIntervalId)clearInterval(s.timerIntervalId);
    if(stopMusicRef.current)stopMusicRef.current();
    if(s.audioCtx)s.audioCtx.close().catch(()=>{});
    if(s.stream)s.stream.getTracks().forEach(t=>t.stop());
  },[]);

  const handleStart=useCallback((name:string,avatar:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);initAudio();setPhase('countdown');
  },[]);
  const handleCountdownDone=useCallback(()=>{void startLoop();},[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScore(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Allow Mic & Breathe Fire!" accentColor={accent} onStart={handleStart} sensorNote="🎤 Blow into mic to fire"/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accent}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <>
          <div ref={mountRef} style={{position:'absolute',inset:0,width:'100%',height:'100%'}}/>
          {phase==='playing'&&(
            <>
              <GameHUD accentColor={accent} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>
              <div style={{position:'absolute',top:82,left:'50%',transform:'translateX(-50%)',display:'flex',gap:10,pointerEvents:'none'}}>
                {Array.from({length:3}).map((_,i)=>(
                  <div key={i} style={{fontSize:18,filter:i<lives?'none':'grayscale(1) opacity(0.3)'}}>❤️</div>
                ))}
              </div>
              <div style={{position:'absolute',bottom:50,left:'50%',transform:'translateX(-50%)',fontSize:13,color:'rgba(255,255,255,0.4)',fontWeight:600,letterSpacing:'0.1em',textAlign:'center',pointerEvents:'none'}}>
                BLOW INTO MIC TO BREATHE FIRE 🎤
              </div>
            </>
          )}
        </>
      )}
      {phase==='done'&&finalSig&&(
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            {label:'Enemies Killed',value:String(Math.round(finalSig.enemiesKilled)),color:finalSig.enemiesKilled>=12?'#4ade80':'#facc15'},
            {label:'Breath Time',value:`${finalSig.breathSeconds}s`,color:accent},
            {label:'Best Streak',value:`×${finalSig.maxStreak}`,color:'#fbbf24'},
            {label:'Score',value:String(finalSig.score),color:'var(--color-text)'},
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.enemiesKilled>=6}/>
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
const DragonBreath = dynamic(() => Promise.resolve({ default: DragonBreathInner }), { ssr: false });
export default DragonBreath;
