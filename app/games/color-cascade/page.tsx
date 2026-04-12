'use client';
/**
 * COLOR CASCADE — 3D: match falling colored spheres to the target color.
 * Vibrant spheres rain from above in a glowing 3D arena.
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

const GAME_ID      = 'color-cascade';
const PB_KEY       = 'pb_color-cascade';
const ACCENT       = '#f43f5e';
const DURATION     = 45;
const GAME_EMOJI   = '🌈';
const GAME_TITLE   = 'Color Cascade';
const GAME_TAGLINE = 'Match the color. Match the speed.';

const COLORS = [
  { name:'red',    hex:'#ef4444', threeHex:0xef4444, label:'RED'    },
  { name:'blue',   hex:'#3b82f6', threeHex:0x3b82f6, label:'BLUE'   },
  { name:'green',  hex:'#22c55e', threeHex:0x22c55e, label:'GREEN'  },
  { name:'yellow', hex:'#eab308', threeHex:0xeab308, label:'YELLOW' },
  { name:'purple', hex:'#a855f7', threeHex:0xa855f7, label:'PURPLE' },
];

interface Drop3D {
  id: number;
  colorIndex: number;
  mesh: THREE.Mesh;
  speed: number;
  caught: boolean;
  flashT: number;
}

interface Signals {
  correctTaps: number; wrongTaps: number; reactionTimes: number[];
  accuracy: number; maxStreak: number; streakCurrent: number; score: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.correctTaps + sig.wrongTaps > 0 ? sig.correctTaps / (sig.correctTaps + sig.wrongTaps) : 0;
  if (acc >= 0.85 && sig.maxStreak >= 8) return 'Chromatic Hawk 🦅';
  if (sig.correctTaps >= 20)             return 'Speed Demon 🔥';
  if (acc >= 0.75)                       return 'Deliberate Eye 🔭';
  return 'Casual Tapper 🌊';
}

type Phase = 'start'|'countdown'|'playing'|'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  targetColorIndex: number; targetTimer: number;
  drops: Drop3D[]; nextId: number; spawnTimer: number; spawnRate: number;
  accentColor: string;
}

function ColorCascadeGameInner() {
  const theme = useBrandTheme();
  const accent = theme.colors.accent ?? ACCENT;

  const mountRef    = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer|null>(null);
  const sceneRef    = useRef<THREE.Scene|null>(null);
  const cameraRef   = useRef<THREE.PerspectiveCamera|null>(null);
  const rafRef      = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const plRef       = useRef<THREE.PointLight|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const stateRef = useRef<GS>({
    running:false, timeLeft:DURATION,
    sig:{ correctTaps:0, wrongTaps:0, reactionTimes:[], accuracy:0, maxStreak:0, streakCurrent:0, score:0 },
    targetColorIndex:0, targetTimer:600, drops:[], nextId:0, spawnTimer:0, spawnRate:60,
    accentColor:ACCENT,
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals|null>(null);
  const [targetColorIdx, setTargetColorIdx] = useState(0);
  const [isNewBest, setIsNewBest]       = useState(false);
  const { pops, triggerPop }            = useScorePop();

  useEffect(() => { stateRef.current.accentColor = accent; }, [accent]);

  // ── Three.js setup ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    const W = mount.clientWidth||window.innerWidth; const H = mount.clientHeight||window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias:true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(W,H); renderer.setClearColor(0x0a0010);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(70, W/H, 0.1, 50);
    camera.position.set(0, 0, 8);
    cameraRef.current = camera;

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const pl = new THREE.PointLight(0xf43f5e, 3, 20);
    pl.position.set(0, 3, 5);
    scene.add(pl);
    plRef.current = pl;
    scene.add(new THREE.DirectionalLight(0xfda4af, 0.5));

    // Background rainbow streaks
    for (let i = 0; i < 30; i++) {
      const geo = new THREE.CylinderGeometry(0.02, 0.02, 8, 4);
      const mat = new THREE.MeshStandardMaterial({
        color: COLORS[i % COLORS.length].threeHex,
        emissive: COLORS[i % COLORS.length].threeHex,
        emissiveIntensity: 0.3, transparent: true, opacity: 0.15,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set((Math.random()-0.5)*12, 0, (Math.random()-0.5)*3-3);
      scene.add(m);
    }

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(300*3);
    for (let i = 0; i < 300; i++) { starPos[i*3]=(Math.random()-0.5)*20; starPos[i*3+1]=(Math.random()-0.5)*20; starPos[i*3+2]=(Math.random()-0.5)*6-4; }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos,3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color:0xfda4af, size:0.05, sizeAttenuation:true })));

    // Floor
    const floorGeo = new THREE.PlaneGeometry(12, 1);
    const floorMat = new THREE.MeshStandardMaterial({ color:0x1a0020, metalness:0.5, roughness:0.5 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(0, -4.5, 0);
    scene.add(floor);

    const onResize = () => {
      const W2=mount.clientWidth||window.innerWidth; const H2=mount.clientHeight||window.innerHeight;
      renderer.setSize(W2,H2); camera.aspect=W2/H2; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(rafRef.current);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const total = s.sig.correctTaps + s.sig.wrongTaps;
    s.sig.accuracy = total > 0 ? Math.round(s.sig.correctTaps / total * 100) : 0;
    const sig = { ...s.sig };
    const pb = parseInt(localStorage.getItem(PB_KEY)??'0');
    if (sig.score > pb) { localStorage.setItem(PB_KEY,String(sig.score)); setIsNewBest(true); }
    setFinalSig(sig); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const scene = sceneRef.current; const renderer = rendererRef.current; const camera = cameraRef.current;
    if (!scene||!renderer||!camera) return;
    const s = stateRef.current;
    s.running=true; s.timeLeft=DURATION;
    s.sig={ correctTaps:0, wrongTaps:0, reactionTimes:[], accuracy:0, maxStreak:0, streakCurrent:0, score:0 };
    s.targetColorIndex=0; s.targetTimer=600; s.drops=[]; s.nextId=0; s.spawnTimer=0; s.spawnRate=60;
    // Clear old drop meshes
    scene.children.filter(c=>c.userData.isDrop).forEach(c=>scene.remove(c));
    setScoreDisplay(0); setTimeLeft(DURATION); setTargetColorIdx(0); setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    timerRef.current = setInterval(() => {
      const s2=stateRef.current; s2.timeLeft--; setTimeLeft(s2.timeLeft);
      if (s2.timeLeft<=10&&s2.timeLeft>0) sfx.tick();
      if (s2.timeLeft<=0) endGame();
    },1000);

    let frame = 0;
    const loop = () => {
      if (!s.running) return;
      frame++;
      const t = frame * 0.016;

      // Target color cycle
      s.targetTimer--;
      if (s.targetTimer <= 0) {
        s.targetColorIndex = (s.targetColorIndex + 1) % COLORS.length;
        s.targetTimer = 600;
        setTargetColorIdx(s.targetColorIndex);
        const pl = plRef.current;
        if (pl) pl.color.setHex(COLORS[s.targetColorIndex].threeHex);
      }

      // Spawn drops
      s.spawnTimer++;
      s.spawnRate = Math.max(22, 60 - Math.floor(frame/300) * 5);
      if (s.spawnTimer >= s.spawnRate) {
        s.spawnTimer = 0;
        const ci = Math.random() < 0.45 ? s.targetColorIndex : Math.floor(Math.random()*COLORS.length);
        const geo = new THREE.SphereGeometry(0.35, 14, 14);
        const mat = new THREE.MeshStandardMaterial({
          color: COLORS[ci].threeHex, metalness:0.3, roughness:0.4,
          emissive: COLORS[ci].threeHex, emissiveIntensity:0.5,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set((Math.random()-0.5)*7, 5.5, (Math.random()-0.5)*1.5);
        mesh.userData.isDrop = true;
        scene.add(mesh);
        s.drops.push({ id:s.nextId++, colorIndex:ci, mesh, speed:0.04+Math.random()*0.025, caught:false, flashT:0 });
      }

      // Update drops
      for (let i=s.drops.length-1;i>=0;i--) {
        const d=s.drops[i];
        if (d.caught) {
          d.flashT++;
          d.mesh.scale.setScalar(1+d.flashT*0.04);
          (d.mesh.material as THREE.MeshStandardMaterial).opacity = 1-d.flashT/18;
          if (d.flashT>18) { scene.remove(d.mesh); s.drops.splice(i,1); }
          continue;
        }
        d.mesh.position.y -= d.speed * (1+frame/1800);
        d.mesh.rotation.y += 0.03;
        d.mesh.rotation.x += 0.02;
        if (d.mesh.position.y < -5.5) { scene.remove(d.mesh); s.drops.splice(i,1); }
      }

      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  // Touch/click input
  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    const onPointerDown = (e: PointerEvent) => {
      if (phase!=='playing') return;
      const s = stateRef.current; if (!s.running) return;
      const renderer = rendererRef.current; const camera = cameraRef.current; const scene = sceneRef.current;
      if (!renderer||!camera||!scene) return;
      const rect = mount.getBoundingClientRect();
      const x = ((e.clientX-rect.left)/rect.width)*2-1;
      const y = -((e.clientY-rect.top)/rect.height)*2+1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(x,y), camera);
      const meshes = s.drops.filter(d=>!d.caught).map(d=>d.mesh);
      const hits = raycaster.intersectObjects(meshes);
      if (hits.length>0) {
        const hitMesh = hits[0].object as THREE.Mesh;
        const drop = s.drops.find(d=>d.mesh===hitMesh);
        if (drop&&!drop.caught) {
          drop.caught = true;
          const isMatch = drop.colorIndex === s.targetColorIndex;
          if (isMatch) {
            s.sig.correctTaps++; s.sig.streakCurrent++;
            if (s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
            const mult = s.sig.streakCurrent>=4?2:1;
            s.sig.score += 2*mult; setScoreDisplay(s.sig.score);
            sfx.collect(); hapticScore();
            triggerPop(`+${2*mult}`, e.clientX, e.clientY);
            const mat = hitMesh.material as THREE.MeshStandardMaterial;
            mat.emissive.setHex(0xffffff); mat.emissiveIntensity=2;
          } else {
            s.sig.wrongTaps++; s.sig.streakCurrent=0;
            sfx.collision(); hapticFail();
            const mat = hitMesh.material as THREE.MeshStandardMaterial;
            mat.emissive.setHex(0xff0000); mat.emissiveIntensity=2;
          }
        }
      }
    };
    mount.addEventListener('pointerdown', onPointerDown);
    return () => mount.removeEventListener('pointerdown', onPointerDown);
  }, [phase, triggerPop]);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
  }, []);

  const handleStart = useCallback(async (name:string, avatar:string) => {
    playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar); await initAudio(); setPhase('countdown');
  },[]);
  const handleCountdownDone = useCallback(() => { startLoop(); },[startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);setIsNewBest(false); },[]);

  const tc = COLORS[targetColorIdx];
  const buildInsights = (sig: Signals) => {
    const total=sig.correctTaps+sig.wrongTaps;
    const acc=total>0?Math.round(sig.correctTaps/total*100):0;
    return [
      {label:'Correct',value:String(sig.correctTaps),color:sig.correctTaps>=15?'#4ade80':'#facc15'},
      {label:'Accuracy',value:`${acc}%`,color:acc>=80?'#4ade80':acc>=60?'#facc15':'#ef4444'},
      {label:'Max Streak',value:`×${sig.maxStreak}`,color:'#fbbf24'},
      {label:'Wrong',value:String(sig.wrongTaps),color:sig.wrongTaps===0?'#4ade80':'#ef4444'},
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start! 🌈" accentColor={accent} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={accent}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <>
          <div ref={mountRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
          {phase==='playing'&&(
            <>
              <GameHUD accentColor={accent} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>
              <div style={{position:'absolute',top:80,left:'50%',transform:'translateX(-50%)',display:'flex',flexDirection:'column',alignItems:'center',gap:6,pointerEvents:'none'}}>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',fontWeight:600,letterSpacing:'0.1em'}}>TAP THE</div>
                <div style={{width:64,height:64,borderRadius:12,background:tc.hex,boxShadow:`0 0 20px ${tc.hex}88`,border:'3px solid rgba(255,255,255,0.3)'}}/>
                <div style={{fontSize:18,fontWeight:900,color:tc.hex,letterSpacing:'0.05em'}}>{tc.label}</div>
              </div>
              <ScorePopEffect pops={pops} accentColor={accent}/>
            </>
          )}
        </>
      )}
      <AnimatePresence>
        {isNewBest&&(
          <motion.div key="nb" initial={{opacity:0,y:-20,scale:0.8}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:-20}} transition={{duration:0.4,delay:0.5}}
            style={{position:'fixed',top:'10%',left:'50%',transform:'translateX(-50%)',zIndex:90,pointerEvents:'none',background:'linear-gradient(135deg,#fbbf24,#f59e0b)',borderRadius:20,padding:'8px 20px',fontSize:20,fontWeight:900,color:'#000',whiteSpace:'nowrap'}}>
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>
      {phase==='done'&&finalSig&&(
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.correctTaps>=15}/>
      )}
      {phase==='done'&&finalSig&&<WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>}
    </GameShell>
  );
}

function WebhookEmitter({theme,sig,personality,player}:{theme:ReturnType<typeof useBrandTheme>;sig:Signals;personality:string;player:PlayerSession|null;}) {
  const fired=useRef(false);
  useEffect(()=>{if(fired.current)return;fired.current=true;postWebhook(theme,GAME_ID,{personality,score:sig.score,correctTaps:sig.correctTaps,accuracy:sig.accuracy},player);},[theme,sig,personality,player]);
  return null;
}

import dynamic from 'next/dynamic';
const ColorCascadeGame = dynamic(() => Promise.resolve({ default: ColorCascadeGameInner }), { ssr: false });
export default ColorCascadeGame;
