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
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';

const GAME_ID = 'breath-sculpt';
const ACCENT = '#a78bfa';
const DURATION = 45;
const GAME_EMOJI = '🌬️';
const GAME_TITLE = 'Breath Sculpt';
const GAME_TAGLINE = 'Your breath shapes the swarm. Guide it through the gaps.';
const PB_KEY = 'mg_pb_breath-sculpt';
const PARTICLE_COUNT = 28;
const SCROLL_SPEED_BASE = 1.2;
const SCROLL_SPEED_MAX = 2.4;
const GAP_HEIGHT = 2.5;

interface Signals { score: number; gapsCleared: number; collisions: number; breathVariance: number; }
function getPersonality(sig: Signals): string {
  if (sig.gapsCleared >= 12 && sig.collisions <= 2) return 'Sculpt Master 🎨';
  if (sig.gapsCleared >= 8) return 'Flow Rider 🌊';
  if (sig.collisions <= 1) return 'Phantom Breath 👻';
  if (sig.gapsCleared >= 5) return 'Shape Shifter 🌀';
  return 'First Breath 🌱';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface WallPair { meshBot: THREE.Mesh; meshTop: THREE.Mesh; gapY: number; z: number; passed: boolean; }
interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  swarmMeshes: THREE.Mesh[]; swarmPositions: Array<{ x: number; y: number; vx: number; vy: number }>;
  swarmCenterY: number; targetY: number;
  walls: WallPair[]; scrollZ: number; scrollSpeed: number;
  micLevel: number;
  micRef: { stream: MediaStream; analyser: AnalyserNode; data: Uint8Array } | null;
  breathVariances: number[]; prevMicLevel: number;
  frame: number;
  stopMusic: (() => void) | null;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

function BreathSculptGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, streak: 0, timeLeft: DURATION,
    sig: { score: 0, gapsCleared: 0, collisions: 0, breathVariance: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    swarmMeshes: [], swarmPositions: [], swarmCenterY: 0, targetY: 0,
    walls: [], scrollZ: 0, scrollSpeed: SCROLL_SPEED_BASE,
    micLevel: 0, micRef: null, breathVariances: [], prevMicLevel: 0,
    frame: 0, stopMusic: null, intervalId: null, resizeCleanup: null,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streak, setStreak] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (s.stopMusic) { s.stopMusic(); s.stopMusic = null; }
    if (s.micRef) { s.micRef.stream.getTracks().forEach(t => t.stop()); s.micRef = null; }
    s.resizeCleanup?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    const avgVar = s.breathVariances.length > 0 ? s.breathVariances.reduce((a, b) => a + b, 0) / s.breathVariances.length : 0;
    s.sig.breathVariance = avgVar;
    try {
      const prev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (s.sig.score > prev) localStorage.setItem(PB_KEY, String(s.sig.score));
    } catch { /* */ }
    setFinalSig({ ...s.sig });
    setPhase('done'); hapticVictory();
  }, []);

  const spawnWall = useCallback((scene: THREE.Scene, s: GS) => {
    const gapY = (Math.random() - 0.5) * 3;
    const wallColor = 0x7c3aed;
    const botH = Math.max(0.5, 4 + gapY - GAP_HEIGHT / 2);
    const topH = Math.max(0.5, 4 - gapY - GAP_HEIGHT / 2);
    const mBot = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, botH, 0.4),
      new THREE.MeshStandardMaterial({ color: wallColor, emissive: wallColor, emissiveIntensity: 0.3, roughness: 0.4 })
    );
    mBot.position.set(0, -4 + botH / 2, s.scrollZ - 25);
    scene.add(mBot);
    const mTop = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, topH, 0.4),
      new THREE.MeshStandardMaterial({ color: wallColor, emissive: wallColor, emissiveIntensity: 0.3, roughness: 0.4 })
    );
    mTop.position.set(0, 4 - topH / 2, s.scrollZ - 25);
    scene.add(mTop);
    s.walls.push({ meshBot: mBot, meshTop: mTop, gapY, z: s.scrollZ - 25, passed: false });
  }, []);

  const startLoop = useCallback(async () => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ac = new AudioContext();
      const analyser = ac.createAnalyser();
      analyser.fftSize = 512;
      ac.createMediaStreamSource(stream).connect(analyser);
      s.micRef = { stream, analyser, data: new Uint8Array(analyser.frequencyBinCount) };
    } catch { /* fallback */ }

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { score: 0, gapsCleared: 0, collisions: 0, breathVariance: 0 };
    s.swarmCenterY = 0; s.targetY = 0; s.walls = []; s.scrollZ = 0;
    s.micLevel = 0; s.prevMicLevel = 0; s.breathVariances = [];
    s.scrollSpeed = SCROLL_SPEED_BASE;
    setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0e0820);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0e0820, 0.02);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 8);
    // === POLISH: Enhanced rim + fill lighting ===
    const rimLightA = new THREE.PointLight(0x4466ff, 1.2, 20);
    rimLightA.position.set(-6, 5, 3);
    scene.add(rimLightA);
    const fillLightB = new THREE.PointLight(0xff6644, 0.8, 15);
    fillLightB.position.set(6, -3, 5);
    scene.add(fillLightB);
    // === END POLISH ===
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x221133, 2.5));
    const purpleLight = new THREE.PointLight(0xa78bfa, 2, 20);
    purpleLight.position.set(0, 2, 4);
    scene.add(purpleLight);

    // Star field
    const sPos = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) {
      sPos[i * 3] = (Math.random() - 0.5) * 20;
      sPos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      sPos[i * 3 + 2] = -15 - Math.random() * 15;
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0x886699, size: 0.05, transparent: true, opacity: 0.5 })));

    // Swarm particles
    s.swarmMeshes = [];
    s.swarmPositions = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xa78bfa, emissive: 0xa78bfa, emissiveIntensity: 0.6, roughness: 0.2 })
      );
      mesh.position.set(-2 + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, 0);
      scene.add(mesh);
      s.swarmMeshes.push(mesh);
      s.swarmPositions.push({ x: mesh.position.x, y: mesh.position.y, vx: 0, vy: 0 });
    }

    s.stopMusic = startMusic('chill');
    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    s.resizeCleanup = () => window.removeEventListener('resize', handleResize);

    for (let i = 0; i < 3; i++) { s.scrollZ = -i * 8; spawnWall(scene, s); }
    s.scrollZ = 0;

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--; setTimeLeft(s.timeLeft);
      const prog = 1 - s.timeLeft / DURATION;
      s.scrollSpeed = SCROLL_SPEED_BASE + prog * (SCROLL_SPEED_MAX - SCROLL_SPEED_BASE);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;
      const dt = 1 / 60;

      // Mic
      let breathLevel = 0.05 + Math.sin(Date.now() / 2500) * 0.04;
      if (s.micRef) {
        const { analyser, data } = s.micRef;
        analyser.getByteTimeDomainData(data as Uint8Array<ArrayBuffer>);
        let sum = 0;
        for (const v of data) sum += Math.abs(v - 128);
        const raw = sum / data.length / 128;
        breathLevel = s.micLevel * 0.7 + raw * 0.3;
        s.micLevel = breathLevel;
      }
      const variance = Math.abs(breathLevel - s.prevMicLevel);
      s.breathVariances.push(variance);
      s.prevMicLevel = breathLevel;

      // Target Y based on breath level (louder = up)
      s.targetY = (breathLevel - 0.06) * 20;
      s.targetY = Math.max(-3.5, Math.min(3.5, s.targetY));
      s.swarmCenterY += (s.targetY - s.swarmCenterY) * 0.08;

      // Update swarm particles
      s.swarmPositions.forEach((p, i) => {
        const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + Date.now() * 0.002;
        const orbitR = 0.4 + Math.sin(i * 1.3) * 0.2;
        const tx = -2 + Math.cos(angle) * orbitR;
        const ty = s.swarmCenterY + Math.sin(angle) * orbitR;
        p.vx = (tx - p.x) * 0.1;
        p.vy = (ty - p.y) * 0.1;
        p.x += p.vx;
        p.y += p.vy;
        const mesh = s.swarmMeshes[i];
        mesh.position.x = p.x;
        mesh.position.y = p.y;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.4 + breathLevel * 3;
        mat.color.setHSL(0.73 + breathLevel * 0.3, 0.8, 0.65);
      });

      // Scroll walls
      s.scrollZ += s.scrollSpeed * dt;
      const lastWall = s.walls[s.walls.length - 1];
      if (!lastWall || s.scrollZ - lastWall.z > 7) spawnWall(scene, s);

      for (let i = s.walls.length - 1; i >= 0; i--) {
        const w = s.walls[i];
        const relZ = w.z + s.scrollZ;
        w.meshBot.position.z = relZ;
        w.meshTop.position.z = relZ;

        if (!w.passed && relZ > -1) {
          w.passed = true;
          // Check if swarm center passed through gap
          const inGap = Math.abs(s.swarmCenterY - w.gapY) < GAP_HEIGHT / 2;
          if (inGap) {
            s.streak=(s.streak||0)+1; setStreak(s.streak);
            const _bs=Math.max(1,Math.floor(s.streak/3)+1);
            s.sig.gapsCleared++; s.sig.score += 5 * _bs;
            setScoreDisplay(s.sig.score);
            sfx.collect?.(); hapticScore?.();
          } else {
            s.streak=0; setStreak(0);
            s.sig.collisions++;
            sfx.collision?.(); haptic([40]);
          }
        }

        if (relZ > 10) {
          scene.remove(w.meshBot); scene.remove(w.meshTop);
          s.walls.splice(i, 1);
        }
      }

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, spawnWall]);

  useEffect(() => () => {
    const s = stateRef.current;
    s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.stopMusic) s.stopMusic();
    if (s.micRef) s.micRef.stream.getTracks().forEach(t => t.stop());
    s.resizeCleanup?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Allow Mic & Sculpt" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} role="application" aria-label="Game area - tap to play" style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        display: phase === 'playing' ? 'block' : 'none', touchAction: 'none',
      }} />
      {phase === 'playing' && (
        <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
          { label: 'SCORE', value: scoreDisplay },
        ]} />
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Gaps Cleared', value: String(finalSig.gapsCleared), color: ACCENT },
            { label: 'Collisions', value: String(finalSig.collisions), color: '#ef4444' },
            { label: 'Breath Control', value: finalSig.breathVariance < 0.03 ? 'Excellent' : finalSig.breathVariance < 0.06 ? 'Good' : 'Turbulent', color: finalSig.breathVariance < 0.03 ? '#4ade80' : '#facc15' },
            { label: 'Score', value: String(finalSig.score), color: '#fbbf24' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.gapsCleared >= 8} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const BreathSculptGame = dynamic(() => Promise.resolve({ default: BreathSculptGameInner }), { ssr: false });
export default BreathSculptGame;
