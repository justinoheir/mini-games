'use client';
/**
 * DODGE BLITZ — 3D: tilt to survive incoming 3D diamond obstacles in a speed corridor.
 * Vibrant cyan player orb, dark space tunnel, escalating speed.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, increaseMusicTempo } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { createTiltController } from '@/lib/tilt';

const GAME_ID  = 'dodge-blitz';
const PB_KEY   = 'pb_dodge-blitz';
const ACCENT   = '#06b6d4';
const DURATION = 45;
const GAME_EMOJI  = '💨';
const GAME_TITLE  = 'Dodge Blitz';
const GAME_TAGLINE = "Tilt to survive. Don't stop moving.";

const MAX_LIVES     = 5;
const PLAYER_RADIUS = 0.35;

function getSpeedParams(elapsed:number):{speed:number;spawnMs:number} {
  if(elapsed<15) return {speed:0.18,spawnMs:2800};
  if(elapsed<20){const t=(elapsed-15)/5;return{speed:0.18+(0.35-0.18)*t,spawnMs:Math.round(2800-(2800-1800)*t)};}
  if(elapsed<28) return {speed:0.35,spawnMs:1800};
  if(elapsed<33){const t=(elapsed-28)/5;return{speed:0.35+(0.65-0.35)*t,spawnMs:Math.round(1800-(1800-1100)*t)};}
  return {speed:0.65,spawnMs:1100};
}

interface Signals {
  obstaclesAvoided:number; collisions:number; tiltMagnitudes:number[];
  survivalTime:number; dodgesLeft:number; dodgesRight:number; score:number;
}

function getPersonality(sig:Signals):string {
  if(sig.collisions===0||(sig.collisions<=1&&sig.obstaclesAvoided>=20)) return 'Ghost 👻';
  const avg=sig.tiltMagnitudes.length>0?sig.tiltMagnitudes.reduce((a,b)=>a+b,0)/sig.tiltMagnitudes.length:0;
  if(avg>12&&sig.obstaclesAvoided>=15) return 'Reactive 🔥';
  if(avg<8&&sig.collisions<=3) return 'Controlled 🧘';
  return 'Survivor 🌊';
}

interface Obstacle3D {
  id:number; mesh:THREE.Mesh; speed:number; size:number; hit:boolean; passed:boolean;
}

type Phase='start'|'countdown'|'playing'|'done';

interface GS {
  running:boolean; lives:number; timeLeft:number; sig:Signals;
  playerX:number; obstacles:Obstacle3D[]; nextObstacleId:number; lastSpawnTime:number;
  screenFlash:number; tiltX:number; tiltRaw:number; touchDirection:number;
  gameStartTime:number; firstCollisionTime:number; tiltSampleFrame:number;
  accentColor:string;
}

export default function DodgeBlitzGame() {
  const theme        = useBrandTheme();
  const accent       = theme.colors.accent ?? ACCENT;

  const mountRef     = useRef<HTMLDivElement>(null);
  const rendererRef  = useRef<THREE.WebGLRenderer|null>(null);
  const sceneRef     = useRef<THREE.Scene|null>(null);
  const cameraRef    = useRef<THREE.PerspectiveCamera|null>(null);
  const rafRef       = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const tiltRef      = useRef<ReturnType<typeof createTiltController>|null>(null);
  const touchRef     = useRef(false);
  const endCalledRef = useRef(false);
  const playerMeshRef= useRef<THREE.Mesh|null>(null);
  const flashPlaneRef= useRef<THREE.Mesh|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const stateRef = useRef<GS>({
    running:false,lives:MAX_LIVES,timeLeft:DURATION,
    sig:{obstaclesAvoided:0,collisions:0,tiltMagnitudes:[],survivalTime:DURATION*1000,dodgesLeft:0,dodgesRight:0,score:0},
    playerX:0,obstacles:[],nextObstacleId:0,lastSpawnTime:0,
    screenFlash:0,tiltX:0,tiltRaw:0,touchDirection:0,
    gameStartTime:0,firstCollisionTime:0,tiltSampleFrame:0,accentColor:ACCENT,
  });

  const [phase,setPhase]               = useState<Phase>('start');
  const [timeLeft,setTimeLeft]         = useState(DURATION);
  const [scoreDisplay,setScoreDisplay] = useState(0);
  const [livesDisplay,setLivesDisplay] = useState(MAX_LIVES);
  const [finalSig,setFinalSig]         = useState<Signals|null>(null);
  const [isNewBest,setIsNewBest]       = useState(false);

  useEffect(()=>{stateRef.current.accentColor=accent;},[accent]);

  // ── Three.js setup ──────────────────────────────────────────────────────
  useEffect(()=>{
    if(!mountRef.current)return;
    const mount=mountRef.current;
    const W=mount.clientWidth||window.innerWidth;const H=mount.clientHeight||window.innerHeight;

    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(W,H);renderer.setClearColor(0x000d18);
    mount.appendChild(renderer.domElement);
    rendererRef.current=renderer;

    const scene=new THREE.Scene();
    scene.fog=new THREE.FogExp2(0x000d18,0.04);
    sceneRef.current=scene;

    const camera=new THREE.PerspectiveCamera(70,W/H,0.1,60);
    camera.position.set(0,1.5,6);camera.lookAt(0,0.5,0);
    cameraRef.current=camera;

    scene.add(new THREE.AmbientLight(0x001525,1));
    const pl=new THREE.PointLight(0x06b6d4,4,20);pl.position.set(0,3,4);scene.add(pl);
    const pl2=new THREE.PointLight(0xf97316,2,12);pl2.position.set(0,0,-3);scene.add(pl2);

    // Tunnel walls (speed corridor)
    const wallGeo=new THREE.BoxGeometry(0.15,20,60);
    const wallMat=new THREE.MeshStandardMaterial({color:0x001525,metalness:0.5,roughness:0.6,emissive:0x001a2e,emissiveIntensity:0.3});
    [-4.5,4.5].forEach(x=>{const w=new THREE.Mesh(wallGeo,wallMat.clone());w.position.set(x,0,-24);scene.add(w);});
    // Floor
    const floorGeo=new THREE.PlaneGeometry(9,60);
    const floorMat=new THREE.MeshStandardMaterial({color:0x000d18,metalness:0.8,roughness:0.2});
    const floorMesh=new THREE.Mesh(floorGeo,floorMat);floorMesh.rotation.x=-Math.PI/2;floorMesh.position.y=-0.8;floorMesh.position.z=-24;
    scene.add(floorMesh);

    // Speed lines (lane markers)
    for(let i=0;i<8;i++){
      const lg=new THREE.PlaneGeometry(0.04,60);
      const lm=new THREE.MeshStandardMaterial({color:0x0e7490,transparent:true,opacity:0.2});
      const lm2=new THREE.Mesh(lg,lm);lm2.rotation.x=-Math.PI/2;lm2.position.set(-3+i,-.79,-24);
      scene.add(lm2);
    }

    // Background stars/particles
    const pGeo=new THREE.BufferGeometry();
    const pp=new Float32Array(300*3);
    for(let i=0;i<300;i++){pp[i*3]=(Math.random()-0.5)*10;pp[i*3+1]=(Math.random()-0.5)*8;pp[i*3+2]=-(Math.random()*50);}
    pGeo.setAttribute('position',new THREE.BufferAttribute(pp,3));
    scene.add(new THREE.Points(pGeo,new THREE.PointsMaterial({color:0x0891b2,size:0.06,sizeAttenuation:true,transparent:true,opacity:0.4})));

    // Player orb
    const playerGeo=new THREE.SphereGeometry(PLAYER_RADIUS,16,16);
    const playerMat=new THREE.MeshStandardMaterial({color:0x06b6d4,metalness:0.3,roughness:0.3,emissive:0x06b6d4,emissiveIntensity:0.6});
    const playerMesh=new THREE.Mesh(playerGeo,playerMat);
    playerMesh.position.set(0,0,1);
    scene.add(playerMesh);playerMeshRef.current=playerMesh;

    // Flash plane (red hit indicator)
    const fpGeo=new THREE.PlaneGeometry(20,30);
    const fpMat=new THREE.MeshBasicMaterial({color:0xef4444,transparent:true,opacity:0,side:THREE.DoubleSide});
    const fp=new THREE.Mesh(fpGeo,fpMat);fp.position.set(0,0,5.5);
    scene.add(fp);flashPlaneRef.current=fp;

    const onResize=()=>{
      const W2=mount.clientWidth||window.innerWidth;const H2=mount.clientHeight||window.innerHeight;
      renderer.setSize(W2,H2);camera.aspect=W2/H2;camera.updateProjectionMatrix();
    };
    window.addEventListener('resize',onResize);

    let frame=0;
    const render=()=>{
      rafRef.current=requestAnimationFrame(render);
      frame++;
      const s=stateRef.current;
      const elapsed=(Date.now()-s.gameStartTime)/1000;

      // Player movement
      let moveDir=0;
      if(!touchRef.current)moveDir=s.tiltX*1.1;
      else moveDir=s.touchDirection*0.85;
      const speedF=0.016+elapsed*0.00008;
      s.playerX=Math.max(-3.8,Math.min(3.8,s.playerX+moveDir*speedF));
      const player=playerMeshRef.current;
      if(player){
        player.position.x+=(s.playerX-player.position.x)*0.2;
        player.position.y=0+Math.sin(frame*0.08)*0.04;
        // Glow intensity based on tilt
        (player.material as THREE.MeshStandardMaterial).emissiveIntensity=0.6+Math.abs(moveDir)*0.5;
      }

      // Spawn obstacles
      if(s.running){
        const{speed,spawnMs}=getSpeedParams(elapsed);
        const now=Date.now();
        if(s.lives>0&&now-s.lastSpawnTime>=spawnMs){
          s.lastSpawnTime=now;
          let count=1;
          if(elapsed>=30&&Math.random()<0.55)count=2;
          else if(elapsed>=15&&Math.random()<0.45)count=2;
          for(let c=0;c<count;c++){
            let ox:number;
            if(count===1)ox=(Math.random()-0.5)*7;
            else{const seg=7/count;ox=-3.5+seg*c+Math.random()*seg;}
            const geo=new THREE.OctahedronGeometry(0.3+Math.random()*0.2,0);
            const mat=new THREE.MeshStandardMaterial({color:0xdc2626,metalness:0.4,roughness:0.4,emissive:0xf97316,emissiveIntensity:0.5});
            const mesh=new THREE.Mesh(geo,mat);
            mesh.position.set(ox,0,-18);
            scene.add(mesh);
            s.obstacles.push({id:s.nextObstacleId++,mesh,speed:speed+Math.random()*0.15,size:0.3+Math.random()*0.1,hit:false,passed:false});
          }
        }
      }

      // Update obstacles
      for(let i=s.obstacles.length-1;i>=0;i--){
        const obs=s.obstacles[i];
        if(obs.hit){scene.remove(obs.mesh);s.obstacles.splice(i,1);continue;}
        obs.mesh.position.z+=obs.speed;
        obs.mesh.rotation.x+=0.05;obs.mesh.rotation.y+=0.04;

        // Passed player row
        if(!obs.passed&&obs.mesh.position.z>1.5){
          obs.passed=true;
          s.sig.obstaclesAvoided++;
          const bonus=elapsed>20?1:0;s.sig.score+=2+bonus;
          if(player&&obs.mesh.position.x<player.position.x)s.sig.dodgesLeft++;else s.sig.dodgesRight++;
          setScoreDisplay(s.sig.obstaclesAvoided);sfx.collect();
          s.tiltSampleFrame++;
          if(s.tiltSampleFrame%20===0)s.sig.tiltMagnitudes.push(Math.abs(s.tiltRaw));
        }

        if(obs.mesh.position.z>8){scene.remove(obs.mesh);s.obstacles.splice(i,1);continue;}

        // Collision
        if(!obs.passed&&!obs.hit&&s.lives>0&&player){
          const dx=player.position.x-obs.mesh.position.x;
          const dy=player.position.y-obs.mesh.position.y;
          const dz=player.position.z-obs.mesh.position.z;
          const dist=Math.sqrt(dx*dx+dy*dy+dz*dz);
          if(dist<obs.size*0.9+PLAYER_RADIUS*0.85){
            obs.hit=true;s.lives--;s.sig.collisions++;s.sig.score=Math.max(0,s.sig.score-5);
            s.screenFlash=1;
            if(s.firstCollisionTime===0)s.firstCollisionTime=s.sig.survivalTime=Date.now()-s.gameStartTime;
            sfx.collision();hapticFail();
            (player.material as THREE.MeshStandardMaterial).emissive.setHex(0xff0000);
            setTimeout(()=>{if(player)(player.material as THREE.MeshStandardMaterial).emissive.setHex(0x06b6d4);},300);
            setLivesDisplay(s.lives);
            if(s.lives<=0){setTimeout(()=>{if(!endCalledRef.current)endGame(true);},350);}
          }
        }
      }

      // Flash
      if(flashPlaneRef.current){
        (flashPlaneRef.current.material as THREE.MeshBasicMaterial).opacity=s.screenFlash*0.25;
        s.screenFlash=Math.max(0,s.screenFlash-0.06);
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

  const endGame=useCallback((forcedEnd:boolean)=>{
    if(endCalledRef.current)return;endCalledRef.current=true;
    const s=stateRef.current;s.running=false;
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    if(tiltRef.current){tiltRef.current.stop();}
    if(s.firstCollisionTime===0)s.sig.survivalTime=DURATION*1000;
    if(forcedEnd){sfx.fail();hapticFail();}else{sfx.success();hapticVictory();}
    try{
      const prev=parseInt(localStorage.getItem(PB_KEY)||'0',10);
      if(s.sig.obstaclesAvoided>prev){localStorage.setItem(PB_KEY,String(s.sig.obstaclesAvoided));setIsNewBest(true);}
    }catch{}
    if(forcedEnd)setTimeLeft(0);
    setFinalSig({...s.sig});setPhase('done');
  },[]);

  const startLoop=useCallback(()=>{
    const s=stateRef.current;
    endCalledRef.current=false;
    s.running=true;s.lives=MAX_LIVES;s.timeLeft=DURATION;
    s.sig={obstaclesAvoided:0,collisions:0,tiltMagnitudes:[],survivalTime:DURATION*1000,dodgesLeft:0,dodgesRight:0,score:0};
    s.playerX=0;s.obstacles=[];s.nextObstacleId=0;s.lastSpawnTime=0;
    s.screenFlash=0;s.tiltX=0;s.touchDirection=0;s.gameStartTime=Date.now();s.firstCollisionTime=0;s.tiltSampleFrame=0;
    setScoreDisplay(0);setTimeLeft(DURATION);setLivesDisplay(MAX_LIVES);setPhase('playing');
    stopMusicRef.current=startMusic('drive');

    timerRef.current=setInterval(()=>{
      const s2=stateRef.current;s2.timeLeft--;setTimeLeft(s2.timeLeft);
      sfx.tick();
      if(s2.timeLeft===30)increaseMusicTempo(162);
      if(s2.timeLeft===15)increaseMusicTempo(178);
      if(s2.timeLeft===10)sfx.warning();
      if(s2.timeLeft<=0){haptic([300]);endGame(false);}
    },1000);
  },[endGame]);

  // Touch + tilt input
  useEffect(()=>{
    const mount=mountRef.current;if(!mount)return;
    const onPointerDown=(e:PointerEvent)=>{
      if(phase!=='playing'||!touchRef.current)return;
      const rect=mount.getBoundingClientRect();
      stateRef.current.touchDirection=(e.clientX-rect.left)<rect.width/2?-1:1;
    };
    const onPointerMove=(e:PointerEvent)=>{
      if(phase!=='playing'||!touchRef.current||!stateRef.current.screenFlash)return;
      const rect=mount.getBoundingClientRect();
      stateRef.current.touchDirection=(e.clientX-rect.left)<rect.width/2?-1:1;
    };
    const onPointerUp=()=>{if(touchRef.current){stateRef.current.touchDirection=0;}};
    mount.addEventListener('pointerdown',onPointerDown);mount.addEventListener('pointermove',onPointerMove);
    mount.addEventListener('pointerup',onPointerUp);window.addEventListener('pointerup',onPointerUp);
    return()=>{
      mount.removeEventListener('pointerdown',onPointerDown);mount.removeEventListener('pointermove',onPointerMove);
      mount.removeEventListener('pointerup',onPointerUp);window.removeEventListener('pointerup',onPointerUp);
    };
  },[phase]);

  useEffect(()=>()=>{
    cancelAnimationFrame(rafRef.current);if(timerRef.current)clearInterval(timerRef.current);
    if(stopMusicRef.current)stopMusicRef.current();if(tiltRef.current)tiltRef.current.stop();
  },[]);

  const handleStart=useCallback(async(name:string,avatar:string)=>{
    initAudio();playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);
    const ctrl=createTiltController((x,_y)=>{stateRef.current.tiltX=x;stateRef.current.tiltRaw=x*30;},{sensitivity:1.2,smoothing:0.4,deadzone:2,clamp:30});
    const granted=await ctrl.start();
    if(granted){tiltRef.current=ctrl;touchRef.current=false;}else{ctrl.stop();touchRef.current=true;}
    setPhase('countdown');
  },[]);
  const handleCountdownDone=useCallback(()=>{startLoop();},[startLoop]);
  const handlePlayAgain=useCallback(async()=>{
    if(tiltRef.current){tiltRef.current.stop();tiltRef.current=null;}
    endCalledRef.current=false;setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);setIsNewBest(false);setLivesDisplay(MAX_LIVES);
    const ctrl=createTiltController((x,_y)=>{stateRef.current.tiltX=x;stateRef.current.tiltRaw=x*30;},{sensitivity:1.2,smoothing:0.4,deadzone:2,clamp:30});
    const granted=await ctrl.start();
    if(granted){tiltRef.current=ctrl;touchRef.current=false;}else{ctrl.stop();touchRef.current=true;}
    setPhase('countdown');
  },[]);

  const buildInsights=(sig:Signals)=>{
    const avg=sig.tiltMagnitudes.length>0?Math.round(sig.tiltMagnitudes.reduce((a,b)=>a+b,0)/sig.tiltMagnitudes.length):0;
    const survSec=Math.round(sig.survivalTime/1000);
    return[
      {label:'Dodges',value:`${sig.obstaclesAvoided}`,color:sig.obstaclesAvoided>=25?'#4ade80':sig.obstaclesAvoided>=15?'#facc15':'#ef4444'},
      {label:'Collisions',value:`${sig.collisions}`,color:sig.collisions===0?'#4ade80':sig.collisions<=2?'#facc15':'#ef4444'},
      {label:'Avg Tilt',value:`${avg}°`,color:accent},
      {label:'Survived',value:`${survSec}s`,color:survSec>20?'#4ade80':survSec>=10?'#facc15':'#ef4444'},
    ];
  };

  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start →" accentColor={accent} sensorNote="Tilt your phone or hold left/right side." onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accent}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <>
          <div ref={mountRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
          {phase==='playing'&&(
            <>
              <GameHUD accentColor={accent} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10,testId:'timer'},{label:'DODGES',value:scoreDisplay,testId:'score'}]}/>
              {/* Lives dots */}
              <div style={{position:'absolute',top:82,left:'50%',transform:'translateX(-50%)',display:'flex',gap:10,pointerEvents:'none'}}>
                {Array.from({length:MAX_LIVES}).map((_,i)=>(
                  <div key={i} style={{width:12,height:12,borderRadius:'50%',background:i<livesDisplay?accent:'rgba(255,255,255,0.15)',boxShadow:i<livesDisplay?`0 0 8px ${accent}`:undefined,transition:'background 200ms'}}/>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {phase==='done'&&finalSig&&(
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.obstaclesAvoided)} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.obstaclesAvoided>=20}/>
      )}
      {phase==='done'&&finalSig&&<WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>}
    </GameShell>
  );
}

function WebhookEmitter({theme,gameId,sig,personality,player}:{theme:ReturnType<typeof useBrandTheme>;gameId:string;sig:Signals;personality:string;player:PlayerSession|null;}){
  const fired=useRef(false);
  useEffect(()=>{
    if(fired.current)return;fired.current=true;
    const avg=sig.tiltMagnitudes.length>0?parseFloat((sig.tiltMagnitudes.reduce((a,b)=>a+b,0)/sig.tiltMagnitudes.length).toFixed(2)):0;
    postWebhook(theme,gameId,{personality,score:sig.obstaclesAvoided,collisions:sig.collisions,avgTiltMagnitude:avg},player);
  },[theme,gameId,sig,personality,player]);
  return null;
}
