'use client';
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

const GAME_ID      = 'volcano-tap';
const ACCENT       = '#ef4444';
const DURATION     = 45;
const GAME_EMOJI   = '🌋';
const GAME_TITLE   = 'Volcano Tap';
const GAME_TAGLINE = 'Tap rising lava bubbles before they overflow. Miss three — eruption!';
const MAX_MISSES   = 3;

interface Signals {
  bubblesPopped: number;
  missed: number;
  maxStreak: number;
  streakCurrent: number;
  fastestPop: number;
  score: number;
}

function getPersonality(sig: Signals): string {
  if (sig.missed === 0 && sig.bubblesPopped >= 15)    return 'Volcano Tamer 🌋';
  if (sig.maxStreak >= 10)                             return 'Lava Legend ⚡';
  if (sig.bubblesPopped >= 20)                         return 'Bubble Blaster 💥';
  if (sig.missed >= 3)                                 return 'Eruption Survivor 😤';
  return 'Magma Rookie 🔴';
}

interface BubbleObj {
  id: number;
  mesh: THREE.Mesh;
  vy: number;
  maxY: number;
  spawnTime: number;
  popping: boolean;
  popTimer: number;
  heat: number;
  particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }>;
}

interface GS {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  animId: number;
  bubbles: BubbleObj[];
  nextId: number;
  missCount: number;
  spawnInterval: number;
  spawnTimer: number;
  difficultyLevel: number;
  intervalId: ReturnType<typeof setInterval> | null;
  frame: number;
  lavaLight: THREE.PointLight | null;
  lavaMeshes: THREE.Mesh[];
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function VolcanoTapGameInner() {
  const theme        = useBrandTheme();
  const mountRef     = useRef<HTMLDivElement>(null);
  const stateRef     = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { bubblesPopped: 0, missed: 0, maxStreak: 0, streakCurrent: 0, fastestPop: 9999, score: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    bubbles: [], nextId: 0, missCount: 0,
    spawnInterval: 90, spawnTimer: 0, difficultyLevel: 1,
    intervalId: null, frame: 0,
    lavaLight: null, lavaMeshes: [],
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [pbBeaten, setPbBeaten] = useState(false);
  const [missDisplay, setMissDisplay]   = useState(0);
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
        const _pbKey = 'pb_volcano-tap';
    const _finalScore = stateRef.current.sig.score;
    const _prevPb = parseInt(typeof window !== 'undefined' ? localStorage.getItem(_pbKey) ?? '0' : '0', 10);
    if (_finalScore > _prevPb) { if (typeof window !== 'undefined') localStorage.setItem(_pbKey, String(_finalScore)); setPbBeaten(true); }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const spawnBubble = useCallback(() => {
    const s = stateRef.current;
    if (!s.scene) return;
    const r = 0.3 + Math.random() * 0.3;
    const colorHex = [0xef4444, 0xf97316, 0xff6b35, 0xfbbf24][Math.floor(Math.random() * 4)];
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex, emissive: colorHex, emissiveIntensity: 0.6,
      roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.9,
    });
    const geo = new THREE.SphereGeometry(r, 16, 16);
    const mesh = new THREE.Mesh(geo, mat);
    const wx = (Math.random() - 0.5) * 6;
    const startY = -2.5;
    const maxY = -0.5 + Math.random() * 1.5;
    mesh.position.set(wx, startY, (Math.random() - 0.5) * 2);
    s.scene.add(mesh);
    const speed = (0.015 + Math.random() * 0.015 + s.difficultyLevel * 0.004);
    s.bubbles.push({
      id: s.nextId++, mesh, vy: speed,
      maxY, spawnTime: Date.now(),
      popping: false, popTimer: 0, heat: 0, particles: [],
    });
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = mount.clientWidth || window.innerWidth;
    const H = mount.clientHeight || window.innerHeight;

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { bubblesPopped: 0, missed: 0, maxStreak: 0, streakCurrent: 0, fastestPop: 9999, score: 0 };
    s.bubbles = []; s.nextId = 0; s.missCount = 0;
    s.spawnInterval = 70; s.spawnTimer = 0; s.difficultyLevel = 1;
    setScoreDisplay(0); setMissDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1a0500);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    // Scene
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x1a0500, 8, 20);
    s.scene = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 50);
    camera.position.set(0, 2, 10);
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    // Lighting
    scene.add(new THREE.AmbientLight(0x442211, 2));
    const lavaLight = new THREE.PointLight(0xff4400, 3, 15);
    lavaLight.position.set(0, -2, 3);
    scene.add(lavaLight);
    s.lavaLight = lavaLight;
    const rimLight = new THREE.PointLight(0xff8800, 1.5, 20);
    rimLight.position.set(-5, 3, 2);
    scene.add(rimLight);
    const topLight = new THREE.DirectionalLight(0xff6633, 0.8);
    topLight.position.set(0, 10, 5);
    scene.add(topLight);

    // Volcano / lava pool floor
    const lavaGeo = new THREE.CylinderGeometry(5, 6, 0.3, 32);
    const lavaMat = new THREE.MeshStandardMaterial({
      color: 0xff3300, emissive: 0xff2200, emissiveIntensity: 0.8,
      roughness: 0.8, metalness: 0,
    });
    const lavaFloor = new THREE.Mesh(lavaGeo, lavaMat);
    lavaFloor.position.set(0, -3, 0);
    scene.add(lavaFloor);
    s.lavaMeshes = [lavaFloor];

    // Volcano walls
    const wallGeo = new THREE.CylinderGeometry(4.5, 6, 2.5, 32, 1, true);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x2d0a00, roughness: 0.9, metalness: 0, side: THREE.BackSide,
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(0, -2, 0);
    scene.add(wall);

    // Rock particles / embers background
    const emberCount = 60;
    const emberGeo = new THREE.BufferGeometry();
    const emberPos = new Float32Array(emberCount * 3);
    for (let i = 0; i < emberCount; i++) {
      emberPos[i * 3] = (Math.random() - 0.5) * 10;
      emberPos[i * 3 + 1] = (Math.random() - 0.5) * 8;
      emberPos[i * 3 + 2] = (Math.random() - 0.5) * 4 - 2;
    }
    emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
    const emberMat = new THREE.PointsMaterial({ color: 0xff6600, size: 0.06, transparent: true, opacity: 0.7 });
    scene.add(new THREE.Points(emberGeo, emberMat));

    // Resize handler
    const onResize = () => {
      const W2 = mount.clientWidth || window.innerWidth;
      const H2 = mount.clientHeight || window.innerHeight;
      renderer.setSize(W2, H2);
      camera.aspect = W2 / H2;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      s.difficultyLevel = 1 + Math.floor((DURATION - s.timeLeft) / 10);
      s.spawnInterval = Math.max(35, 70 - s.difficultyLevel * 10);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    spawnBubble();

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Spawn
      s.spawnTimer++;
      if (s.spawnTimer >= s.spawnInterval) {
        s.spawnTimer = 0;
        spawnBubble();
      }

      // Update bubbles
      s.bubbles = s.bubbles.filter(b => {
        if (b.popping) {
          b.popTimer++;
          b.particles.forEach(p => {
            p.mesh.position.x += p.vx;
            p.mesh.position.y += p.vy;
            p.mesh.position.z += p.vz;
            p.vy -= 0.01;
            p.life--;
            (p.mesh.material as THREE.MeshStandardMaterial).opacity = p.life / 20;
          });
          b.particles = b.particles.filter(p => p.life > 0);
          if (b.popTimer > 25 && b.particles.length === 0) {
            scene.remove(b.mesh);
            b.mesh.geometry.dispose();
            (b.mesh.material as THREE.Material).dispose();
            return false;
          }
          // Shrink on pop
          const scale = Math.max(0, 1 - b.popTimer / 15);
          b.mesh.scale.setScalar(scale);
          return true;
        }

        b.mesh.position.y += b.vy;
        b.heat = Math.min(1, (b.mesh.position.y + 2.5) / 3);
        // Pulse glow
        const mat = b.mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.4 + b.heat * 0.8 + Math.sin(s.frame * 0.15 + b.id) * 0.2;

        if (b.mesh.position.y >= b.maxY) {
          // Missed
          scene.remove(b.mesh);
          b.mesh.geometry.dispose();
          (b.mesh.material as THREE.Material).dispose();
          s.sig.missed++;
          s.missCount++;
          setMissDisplay(s.missCount);
          s.sig.streakCurrent = 0;
          sfx.collision();
          haptic([20, 30, 20]);
          if (s.missCount >= MAX_MISSES) {
            setTimeout(() => {
              sfx.fail();
              haptic([100, 50, 100, 50, 200]);
              endGame();
            }, 100);
          }
          return false;
        }
        return true;
      });

      // Lava glow pulse
      if (s.lavaLight) {
        s.lavaLight.intensity = 2.5 + Math.sin(s.frame * 0.08) * 0.8;
      }

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);

    // Cleanup resize on unmount
    const originalCleanup = () => window.removeEventListener('resize', onResize);
    (s as unknown as { _resizeCleanup: () => void })._resizeCleanup = originalCleanup;
  }, [endGame, spawnBubble]);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tap / click to pop bubbles via raycasting
  const handleTap = useCallback((clientX: number, clientY: number) => {
    const s = stateRef.current;
    if (!s.running || !s.renderer || !s.camera || !s.scene) return;
    const rect = s.renderer.domElement.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), s.camera);
    const meshes = s.bubbles.filter(b => !b.popping).map(b => b.mesh);
    const hits = raycaster.intersectObjects(meshes);
    if (hits.length > 0) {
      const hitMesh = hits[0].object as THREE.Mesh;
      const bubble = s.bubbles.find(b => b.mesh === hitMesh);
      if (!bubble || bubble.popping) return;
      bubble.popping = true;

      // Burst particles
      for (let i = 0; i < 8; i++) {
        const pGeo = new THREE.SphereGeometry(0.06, 6, 6);
        const pMat = new THREE.MeshStandardMaterial({
          color: 0xff6600, emissive: 0xff3300, emissiveIntensity: 1,
          transparent: true, opacity: 1,
        });
        const pMesh = new THREE.Mesh(pGeo, pMat);
        pMesh.position.copy(hitMesh.position);
        s.scene!.add(pMesh);
        const angle = (i / 8) * Math.PI * 2;
        bubble.particles.push({
          mesh: pMesh,
          vx: Math.cos(angle) * 0.12,
          vy: 0.1 + Math.random() * 0.1,
          vz: Math.sin(angle) * 0.08,
          life: 20,
        });
      }

      const elapsed = Date.now() - bubble.spawnTime;
      if (elapsed < s.sig.fastestPop) s.sig.fastestPop = elapsed;
      s.sig.bubblesPopped++;
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const pts = s.sig.streakCurrent >= 3 ? 2 : 1;
      s.sig.score += pts;
      setScoreDisplay(s.sig.score);
      sfx.collect();
      haptic([30]);
    }
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      handleTap(e.clientX, e.clientY);
    };
    mount.addEventListener('pointerdown', onPointerDown);
    return () => mount.removeEventListener('pointerdown', onPointerDown);
  }, [phase, handleTap]);

  useEffect(() => () => {
    const s = stateRef.current;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (timerRef.current) clearInterval(timerRef.current);
    if (s.renderer) s.renderer.dispose();
    (s as unknown as { _resizeCleanup?: () => void })._resizeCleanup?.();
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setMissDisplay(0);
  }, []);

  const buildInsights = (sig: Signals) => [
    { label: 'Popped',      value: `${sig.bubblesPopped}`,   color: ACCENT },
    { label: 'Best Streak', value: `×${sig.maxStreak}`,      color: ACCENT },
    { label: 'Missed',      value: `${sig.missed}`,          color: sig.missed === 0 ? '#4ade80' : '#ef4444' },
    { label: 'Fastest',     value: sig.fastestPop < 9000 ? `${sig.fastestPop}ms` : '-', color: 'var(--color-text)' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Enter the Crater" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} aria-label="Game area. Use touch or pointer to interact." role="application" style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (<>
            <div aria-live="polite" style={{position:'absolute',left:'-9999px',width:'1px',height:'1px',overflow:'hidden'}}>Score: {scoreDisplay}</div>
          <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME',  value: timeLeft,    danger: timeLeft <= 10 },
              { label: 'SCORE', value: scoreDisplay },
              { label: 'MISS',  value: missDisplay, danger: missDisplay >= 2 },
            ]} />
          </>)}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain} didWin={finalSig.missed < MAX_MISSES} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig}
          personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
      {phase === 'done' && pbBeaten && (
        <div style={{position:'fixed',top:'16px',left:'50%',transform:'translateX(-50%)',background:'#fbbf24',color:'#000',padding:'8px 20px',borderRadius:'999px',fontWeight:700,fontSize:'1rem',zIndex:9999,boxShadow:'0 4px 12px rgba(0,0,0,0.3)',animation:'none'}}>🏆 New Personal Best!</div>
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, gameId, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>; gameId: string; sig: Signals;
  personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, gameId, {
      personality, score: sig.score,
      bubblesPopped: sig.bubblesPopped, missed: sig.missed, maxStreak: sig.maxStreak,
    }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const VolcanoTapGame = dynamic(() => Promise.resolve({ default: VolcanoTapGameInner }), { ssr: false });
export default VolcanoTapGame;


