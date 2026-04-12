'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticWarning } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'wobble-stack';
const ACCENT = '#fb923c';
const DURATION = 60;
const GAME_EMOJI = '🗼';
const GAME_TITLE = 'Wobble Stack';
const GAME_TAGLINE = 'Keep it balanced. It gets worse.';

interface Block { w: number; h: number; color: number; offsetX: number; angle: number; }
interface Signals { totalBlocks: number; survived: number; dropped: number; maxStack: number; maxStreak: number; streakCurrent: number; score: number; maxTilt: number; }
function getPersonality(sig: Signals): string {
  if (sig.maxStack >= 12 && sig.dropped === 0) return 'Tower Master 🗼';
  if (sig.survived >= 15) return 'Steady Builder 🧱';
  if (sig.maxStreak >= 5) return 'Balanced Genius ⚖️';
  if (sig.dropped <= 2) return 'Careful Constructor 🔧';
  return 'Wobble Apprentice 🌀';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
const BLOCK_COLORS = [0xfb923c, 0xf97316, 0xea580c, 0xfbbf24, 0xf59e0b, 0xef4444, 0xdc2626];

function WobbleStackInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    sig: { totalBlocks: 0, survived: 0, dropped: 0, maxStack: 0, maxStreak: 0, streakCurrent: 0, score: 0, maxTilt: 0 } as Signals,
    stack: [] as Block[],
    blockMeshes: [] as THREE.Mesh[],
    tiltX: 0, tiltVelocity: 0, tiltAngle: 0,
    newBlockTimer: 0, gameOverTimer: 0,
    frame: 0,
    towerGroup: null as THREE.Group | null,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { totalBlocks: 0, survived: 0, dropped: 0, maxStack: 0, maxStreak: 0, streakCurrent: 0, score: 0, maxTilt: 0 };
    s.stack = []; s.blockMeshes = []; s.tiltX = 0; s.tiltVelocity = 0; s.tiltAngle = 0;
    s.newBlockTimer = 80; s.gameOverTimer = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a1a);
    renderer.shadowMap.enabled = true;
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0a1a, 20, 60);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 4, 14);
    // === POLISH: Responsive resize handler ===
    const _onResizeHandler = () => {
      const _W = (mountRef.current?.clientWidth || window.innerWidth);
      const _H = (mountRef.current?.clientHeight || window.innerHeight);
      renderer.setSize(_W, _H);
      if (camera instanceof THREE.PerspectiveCamera) { (camera as THREE.PerspectiveCamera).aspect = _W / _H; camera.updateProjectionMatrix(); }
    };
    window.addEventListener('resize', _onResizeHandler);
    // === END POLISH ===
    camera.lookAt(0, 3, 0);

    scene.add(new THREE.AmbientLight(0x111111, 2));
    const topLight = new THREE.PointLight(0xfb923c, 4, 25);
    topLight.position.set(0, 12, 5);
    topLight.castShadow = true;
    scene.add(topLight);
    const sLight = new THREE.PointLight(0xfbbf24, 2, 20);
    sLight.position.set(5, 5, 5);
    scene.add(sLight);

    // Floor
    const floorGeo = new THREE.PlaneGeometry(20, 20);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Stars
    const starCount = 400;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 80;
      starPos[i * 3 + 1] = 5 + Math.random() * 30;
      starPos[i * 3 + 2] = -20 + (Math.random() - 0.5) * 40;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.08 })));

    // Tower group (wobbles as one)
    const towerGroup = new THREE.Group();
    scene.add(towerGroup);
    s.towerGroup = towerGroup;

    // Base platform
    const baseGeo = new THREE.CylinderGeometry(1.2, 1.4, 0.3, 16);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.15;
    base.receiveShadow = true;
    towerGroup.add(base);

    // Add first block
    const addBlock = () => {
      const idx = s.stack.length;
      const w = 2.2 - idx * 0.05;
      const h = 0.35;
      const color = BLOCK_COLORS[idx % BLOCK_COLORS.length];
      const maxOff = idx * 0.08;
      const offsetX = (Math.random() - 0.5) * maxOff;
      const angle = (Math.random() - 0.5) * idx * 0.04;
      const block: Block = { w, h, color, offsetX, angle };
      s.stack.push(block);

      const geo = new THREE.BoxGeometry(w, h, 1.0);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, emissive: color, emissiveIntensity: 0.2 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(offsetX, 0.3 + idx * h + h / 2, 0);
      mesh.rotation.y = angle;
      mesh.castShadow = true;
      towerGroup.add(mesh);
      s.blockMeshes.push(mesh);

      s.sig.totalBlocks++; s.sig.survived++;
      if (s.stack.length > s.sig.maxStack) s.sig.maxStack = s.stack.length;
      s.sig.streakCurrent++; if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const pts = Math.ceil(s.sig.streakCurrent / 3);
      s.sig.score += pts; setScoreDisplay(s.sig.score);
      sfx.collect(); hapticScore();
    };
    addBlock();

    // Touch tilt
    let lastTX = 0;
    const onDown = (e: PointerEvent) => { lastTX = e.clientX; };
    const onMove = (e: PointerEvent) => {
      if (!s.running) return;
      const dx = (e.clientX - lastTX) / W;
      s.tiltX = dx * 3;
      lastTX = e.clientX;
    };
    const onUp = () => { s.tiltX = 0; };

    // Devicemotion tilt
    const onMotion = (e: DeviceMotionEvent) => {
      const ag = e.accelerationIncludingGravity;
      if (ag) s.tiltX = (ag.x ?? 0) * 0.3;
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    window.addEventListener('devicemotion', onMotion);

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;
      const diff = (DURATION - s.timeLeft) / DURATION;

      // Physics
      const windForce = Math.sin(s.frame * 0.02) * diff * 0.003;
      s.tiltVelocity += (s.tiltX * 0.008 + windForce) - s.tiltAngle * 0.05;
      s.tiltVelocity *= 0.9;
      s.tiltAngle += s.tiltVelocity;
      const maxTilt = 0.6 + s.stack.length * 0.05;
      if (Math.abs(s.tiltAngle) > maxTilt) {
        // TOPPLE
        sfx.fail(); hapticFail();
        s.sig.dropped++; s.sig.streakCurrent = 0;
        // Remove top block
        if (s.blockMeshes.length > 1) {
          const topMesh = s.blockMeshes.pop();
          if (topMesh) towerGroup.remove(topMesh);
          s.stack.pop();
        }
        s.tiltAngle *= 0.3; s.tiltVelocity = 0;
      }
      if (Math.abs(s.tiltAngle) > s.sig.maxTilt) s.sig.maxTilt = Math.abs(s.tiltAngle);

      // Wobble tower group
      if (towerGroup) {
        towerGroup.rotation.z = s.tiltAngle;
        towerGroup.rotation.x = Math.sin(s.frame * 0.05) * diff * 0.05;
      }

      // Add new blocks
      s.newBlockTimer--;
      if (s.newBlockTimer <= 0 && s.stack.length < 20) {
        s.newBlockTimer = Math.max(30, 80 - diff * 50);
        addBlock();
        // Update camera to follow tower height
        const h = s.stack.length * 0.35;
        camera.position.y = 4 + h * 0.3;
        camera.lookAt(0, 3 + h * 0.5, 0);
      }

      // Warning shake when tilting too much
      const tiltPct = Math.abs(s.tiltAngle) / maxTilt;
      if (tiltPct > 0.7 && s.frame % 20 === 0) {
        sfx.tick(); hapticWarning();
      }

      topLight.intensity = 4 + Math.sin(s.frame * 0.08) * 0.5;

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('devicemotion', onMotion);
    };
  }, [endGame]);

  useEffect(() => () => {
    const s = stateRef.current; s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    if (stateRef.current.renderer) { stateRef.current.renderer.dispose(); stateRef.current.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Stack It!" accentColor={accent} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Max Height', value: `${finalSig.maxStack} blk`, color: ACCENT }, { label: 'Survived', value: String(finalSig.survived), color: '#4ade80' }, { label: 'Dropped', value: String(finalSig.dropped), color: finalSig.dropped === 0 ? '#4ade80' : '#ef4444' }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' }]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.maxStack >= 8} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const WobbleStack = dynamic(() => Promise.resolve({ default: WobbleStackInner }), { ssr: false });
export default WobbleStack;
