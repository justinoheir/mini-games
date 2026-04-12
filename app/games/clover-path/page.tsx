'use client';
/**
 * CLOVER PATH — 3D: trace a 4-leaf clover path floating in 3D space.
 * Green neon path on a dark emerald background. Particles burst on completion.
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

const GAME_ID    = 'clover-path';
const ACCENT     = '#22c55e';
const DURATION   = 45;
const GAME_EMOJI = '🍀';
const GAME_TITLE = 'Clover Path';
const GAME_TAGLINE = "Trace the lucky path. Don't stray!";

interface Signals {
  pathCoverage: number;
  strays: number;
  completedLeaves: number;
  bestCoverage: number;
  score: number;
}

function getPersonality(s: Signals): string {
  if (s.pathCoverage>=90&&s.strays===0) return 'Lucky Legend 🍀';
  if (s.completedLeaves>=3)             return 'Clover Master 🌿';
  if (s.strays>=8)                      return 'Path Wanderer 🧭';
  if (s.pathCoverage>=70)               return 'Almost Lucky ✨';
  return 'First Leaf 🌱';
}

type Phase = 'start'|'countdown'|'playing'|'done';

interface GS {
  running:boolean; timeLeft:number; sig:Signals;
  drawing:boolean; lastX:number; lastY:number;
  offPath:boolean; offPathFrames:number;
  completions:number; showCelebration:number;
  coverageSet: Set<number>;
  accentColor:string;
}

function CloverPathGameInner() {
  const theme = useBrandTheme();
  const accent = theme.colors.accent ?? ACCENT;

  const mountRef    = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer|null>(null);
  const sceneRef    = useRef<THREE.Scene|null>(null);
  const cameraRef   = useRef<THREE.PerspectiveCamera|null>(null);
  const rafRef      = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setInterval>|null>(null);

  // 3D path objects
  const cloverLineRef  = useRef<THREE.Line|null>(null);
  const trailLineRef   = useRef<THREE.Line|null>(null);
  const trailPositions = useRef<Float32Array>(new Float32Array(2000 * 3));
  const trailCount     = useRef(0);
  const particlesRef   = useRef<THREE.Points|null>(null);
  const leafMeshesRef  = useRef<THREE.Mesh[]>([]);
  const pathPointsRef  = useRef<THREE.Vector3[]>([]);

  const playerSessionRef = useRef<PlayerSession|null>(null);

  const stateRef = useRef<GS>({
    running:false, timeLeft:DURATION,
    sig:{pathCoverage:0,strays:0,completedLeaves:0,bestCoverage:0,score:0},
    drawing:false, lastX:0, lastY:0,
    offPath:false, offPathFrames:0,
    completions:0, showCelebration:0,
    coverageSet: new Set(),
    accentColor:ACCENT,
  });

  const [phase,setPhase]        = useState<Phase>('start');
  const [timeLeft,setTimeLeft]  = useState(DURATION);
  const [scoreDisplay,setScore] = useState(0);
  const [finalSig,setFinalSig]  = useState<Signals|null>(null);

  useEffect(() => { stateRef.current.accentColor = accent; }, [accent]);

  // ── Three.js setup ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    const W = mount.clientWidth || window.innerWidth;
    const H = mount.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x011c0a);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(65, W/H, 0.1, 100);
    camera.position.set(0, 0, 6);
    cameraRef.current = camera;

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const pl = new THREE.PointLight(0x22c55e, 4, 15);
    pl.position.set(0, 0, 4);
    scene.add(pl);
    const dl = new THREE.DirectionalLight(0x86efac, 0.8);
    dl.position.set(2, 3, 2);
    scene.add(dl);

    // Build 4-leaf clover path in 3D
    const STEPS = 200;
    const R = 2.0;
    const pts3D: THREE.Vector3[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = (i / STEPS) * Math.PI * 2;
      const dist = R * Math.abs(Math.sin(2 * t));
      pts3D.push(new THREE.Vector3(dist * Math.cos(t), dist * Math.sin(t), 0));
    }
    pathPointsRef.current = pts3D;

    // Clover path line (dashed-like with segments)
    const pathGeo = new THREE.BufferGeometry().setFromPoints(pts3D);
    const pathMat = new THREE.LineBasicMaterial({ color: 0x22c55e, linewidth: 2 });
    pathMat.transparent = true; pathMat.opacity = 0.3;
    const cloverLine = new THREE.Line(pathGeo, pathMat);
    scene.add(cloverLine);
    cloverLineRef.current = cloverLine;

    // Leaf outlines (glow spheres at the tips)
    const leafPositions = [
      new THREE.Vector3(0, R, 0),
      new THREE.Vector3(R, 0, 0),
      new THREE.Vector3(0, -R, 0),
      new THREE.Vector3(-R, 0, 0),
    ];
    leafPositions.forEach(pos => {
      const geo = new THREE.SphereGeometry(0.15, 8, 8);
      const mat = new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x22c55e, emissiveIntensity: 2, metalness: 0.1, roughness: 0.4 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      scene.add(mesh);
      leafMeshesRef.current.push(mesh);
    });

    // Center clover body
    const centerGeo = new THREE.SphereGeometry(0.2, 12, 12);
    const centerMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, emissive: 0x22c55e, emissiveIntensity: 1.5, metalness: 0.3, roughness: 0.3 });
    scene.add(new THREE.Mesh(centerGeo, centerMat));

    // User trail line
    const trailGeo = new THREE.BufferGeometry();
    const trailBuf = new Float32Array(2000 * 3);
    trailPositions.current = trailBuf;
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailBuf, 3));
    trailGeo.setDrawRange(0, 0);
    const trailMat = new THREE.LineBasicMaterial({ color: 0x86efac, linewidth: 3, transparent: true, opacity: 0.9 });
    const trailLine = new THREE.Line(trailGeo, trailMat);
    scene.add(trailLine);
    trailLineRef.current = trailLine;

    // Background stars
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(200 * 3);
    for (let i = 0; i < 200; i++) {
      starPos[i*3]   = (Math.random()-0.5)*20;
      starPos[i*3+1] = (Math.random()-0.5)*20;
      starPos[i*3+2] = (Math.random()-0.5)*8-5;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x86efac, size: 0.05, sizeAttenuation: true })));

    // Particle system for celebrations
    const partGeo = new THREE.BufferGeometry();
    const partPos = new Float32Array(300 * 3);
    partGeo.setAttribute('position', new THREE.BufferAttribute(partPos, 3));
    partGeo.setDrawRange(0, 0);
    const partMat = new THREE.PointsMaterial({ color: 0x4ade80, size: 0.15, sizeAttenuation: true, transparent: true, opacity: 0.9 });
    const parts = new THREE.Points(partGeo, partMat);
    scene.add(parts);
    particlesRef.current = parts;

    const onResize = () => {
      const W2 = mount.clientWidth||window.innerWidth; const H2 = mount.clientHeight||window.innerHeight;
      renderer.setSize(W2, H2); camera.aspect = W2/H2; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    // rAF loop
    let frame = 0;
    const render = () => {
      rafRef.current = requestAnimationFrame(render);
      frame++;
      const t = frame * 0.016;

      // Animate leaf orbs
      leafMeshesRef.current.forEach((m, i) => {
        m.rotation.y += 0.02;
        m.position.z = Math.sin(t * 1.5 + i * 1.2) * 0.15;
        const mat = m.material as THREE.MeshStandardMaterial;
        const s = stateRef.current;
        mat.emissiveIntensity = s.running ? (1.5 + Math.sin(t * 3 + i) * 0.5) : 1;
      });

      // Camera slight breathe
      camera.position.z = 6 + Math.sin(t * 0.4) * 0.1;

      renderer.render(scene, camera);
    };
    render();

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(rafRef.current);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  const worldToCanvas = useCallback((wx: number, wy: number) => {
    // Convert Three.js world coords to canvas pointer space
    // world range ~-3..3 → canvas 0..W
    const W = mountRef.current?.clientWidth || window.innerWidth;
    const H = mountRef.current?.clientHeight || window.innerHeight;
    return { x: (wx + 3) / 6 * W, y: (1 - (wy + 3) / 6) * H };
  }, []);

  const canvasToWorld = useCallback((cx: number, cy: number) => {
    const W = mountRef.current?.clientWidth || window.innerWidth;
    const H = mountRef.current?.clientHeight || window.innerHeight;
    return new THREE.Vector3(
      (cx / W) * 6 - 3,
      -((cy / H) * 6 - 3),
      0,
    );
  }, []);

  const isNearPath = useCallback((worldPos: THREE.Vector3) => {
    const pts = pathPointsRef.current;
    if (!pts.length) return false;
    const TOLERANCE = 0.35;
    for (const p of pts) {
      if (worldPos.distanceTo(p) < TOLERANCE) return true;
    }
    return false;
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const coverage = Math.round((s.coverageSet.size / 200) * 100);
    s.sig.pathCoverage = coverage;
    if (coverage > s.sig.bestCoverage) s.sig.bestCoverage = coverage;
    const sig = { ...s.sig };
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(sig.score));
    setFinalSig(sig); setPhase('done'); hapticVictory();
  }, []);

  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current; if (!s.running) return;
      const rect = mount.getBoundingClientRect();
      const cx = e.clientX - rect.left; const cy = e.clientY - rect.top;
      s.drawing = true; s.lastX = cx; s.lastY = cy;
      s.offPath = false; s.offPathFrames = 0;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current; if (!s.running || !s.drawing) return;
      const rect = mount.getBoundingClientRect();
      const cx = e.clientX - rect.left; const cy = e.clientY - rect.top;
      const worldPos = canvasToWorld(cx, cy);
      const onPath = isNearPath(worldPos);

      // Add to trail
      const trail = trailPositions.current;
      const idx = trailCount.current;
      if (idx < 2000) {
        trail[idx*3] = worldPos.x; trail[idx*3+1] = worldPos.y; trail[idx*3+2] = worldPos.z;
        trailCount.current++;
        const tLine = trailLineRef.current;
        if (tLine) {
          (tLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
          tLine.geometry.setDrawRange(0, trailCount.current);
        }
      }

      // Track coverage
      const snapAngle = Math.atan2(worldPos.y, worldPos.x);
      const snapDist = Math.sqrt(worldPos.x**2 + worldPos.y**2);
      if (onPath) {
        const bucket = Math.round((snapAngle + Math.PI) / (Math.PI * 2) * 200);
        s.coverageSet.add(Math.max(0, Math.min(199, bucket)));
        setScore(s.sig.score + 1);
        s.sig.score++;
      } else {
        s.offPathFrames++;
        if (s.offPathFrames === 10) {
          s.sig.strays++;
          sfx.nearMiss(); hapticFail();
        }
      }
      s.lastX = cx; s.lastY = cy;

      // Check completion
      const coverage = (s.coverageSet.size / 200);
      if (coverage >= 0.85) {
        s.sig.completedLeaves++;
        s.sig.score += 50;
        s.showCelebration = 60;
        s.coverageSet.clear();
        trailCount.current = 0;
        if (trailLineRef.current) trailLineRef.current.geometry.setDrawRange(0, 0);
        sfx.success(); hapticVictory();
        setScore(s.sig.score);
      }
    };

    const onPointerUp = () => { stateRef.current.drawing = false; stateRef.current.offPathFrames = 0; };

    mount.addEventListener('pointerdown', onPointerDown);
    mount.addEventListener('pointermove', onPointerMove);
    mount.addEventListener('pointerup', onPointerUp);
    mount.addEventListener('pointercancel', onPointerUp);
    return () => {
      mount.removeEventListener('pointerdown', onPointerDown);
      mount.removeEventListener('pointermove', onPointerMove);
      mount.removeEventListener('pointerup', onPointerUp);
      mount.removeEventListener('pointercancel', onPointerUp);
    };
  }, [phase, canvasToWorld, isNearPath]);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = {pathCoverage:0,strays:0,completedLeaves:0,bestCoverage:0,score:0};
    s.drawing = false; s.offPath = false; s.offPathFrames = 0; s.completions = 0; s.showCelebration = 0;
    s.coverageSet.clear();
    trailCount.current = 0;
    if (trailLineRef.current) trailLineRef.current.geometry.setDrawRange(0, 0);
    setScore(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      const s2 = stateRef.current;
      s2.timeLeft--; setTimeLeft(s2.timeLeft);
      if (s2.timeLeft <= 0) endGame();
    }, 1000);
  }, [endGame]);

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); if (timerRef.current) clearInterval(timerRef.current); }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScore(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start 🍀" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={accent} items={[
              { label:'TIME',  value:timeLeft, danger:timeLeft<=10 },
              { label:'SCORE', value:scoreDisplay },
            ]} />
          )}
          {phase === 'playing' && (
            <div style={{ position:'absolute',bottom:40,left:'50%',transform:'translateX(-50%)',
              fontSize:13,color:'rgba(255,255,255,0.5)',fontWeight:600,letterSpacing:'0.1em',textAlign:'center' }}>
              TRACE THE CLOVER PATH
            </div>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label:'Leaves Done', value:String(finalSig.completedLeaves), color:finalSig.completedLeaves>=3?'#4ade80':'#facc15' },
            { label:'Coverage',    value:`${finalSig.pathCoverage}%`,      color:finalSig.pathCoverage>=80?'#4ade80':'#f97316' },
            { label:'Strays',      value:String(finalSig.strays),          color:finalSig.strays===0?'#4ade80':'#ef4444' },
            { label:'Score',       value:String(finalSig.score),           color:accent },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.completedLeaves >= 2} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const CloverPathGame = dynamic(() => Promise.resolve({ default: CloverPathGameInner }), { ssr: false });
export default CloverPathGame;
