'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, playScoreHit, playVictoryFanfare, playNearMiss, playComboSfx, playUrgentTick } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'breath-rider';
const PB_KEY = 'pb_breath-rider';
const GAME_DURATION = 45;
const BASE_SCROLL_SPEED = 1.5;
const MAX_SCROLL_SPEED = 3.2;
const GAME_EMOJI = '🌬️';
const GAME_TITLE = 'Breath Rider';

interface Signals { score: number; gapsCleared: number; collisions: number; maxStreak: number; streakCurrent: number; highestCombo: number; }
function getPersonality(sig: Signals): string {
  if (sig.gapsCleared >= 15 && sig.collisions <= 2) return 'Wind Rider 🌪️';
  if (sig.gapsCleared >= 10) return 'Breath Master 🌬️';
  if (sig.collisions <= 1) return 'Precision Flier ✈️';
  return 'Gust Learner 🌱';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface Obstacle { mesh: THREE.Mesh; topMesh: THREE.Mesh; gapY: number; z: number; passed: boolean; }
interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  birdMesh: THREE.Group | null; birdY: number; birdVY: number;
  obstacles: Obstacle[]; scrollZ: number; scrollSpeed: number;
  micLevel: number; prevMicLevel: number;
  micRef: { stream: MediaStream; analyser: AnalyserNode; data: Uint8Array } | null;
  particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; life: number }>;
  frame: number; gameElapsed: number;
  stopMusic: (() => void) | null;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

function makeBird(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.3, roughness: 0.3 })
  );
  g.add(body);
  const wingL = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.08, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.4 })
  );
  wingL.position.set(-0.4, 0.1, 0);
  wingL.rotation.z = 0.3;
  g.add(wingL);
  const wingR = wingL.clone();
  wingR.position.x = 0.4;
  wingR.rotation.z = -0.3;
  g.add(wingR);
  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(0.06, 0.2, 6),
    new THREE.MeshStandardMaterial({ color: 0xff6600 })
  );
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.28, 0.05, 0);
  g.add(beak);
  return g;
}

export default function BreathRiderGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: GAME_DURATION,
    sig: { score: 0, gapsCleared: 0, collisions: 0, maxStreak: 0, streakCurrent: 0, highestCombo: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    birdMesh: null, birdY: 0, birdVY: 0,
    obstacles: [], scrollZ: 0, scrollSpeed: BASE_SCROLL_SPEED,
    micLevel: 0, prevMicLevel: 0, micRef: null, particles: [],
    frame: 0, gameElapsed: 0,
    stopMusic: null, intervalId: null, resizeCleanup: null,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
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
    try {
      const prev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (s.sig.score > prev) localStorage.setItem(PB_KEY, String(s.sig.score));
    } catch { /* */ }
    setFinalSig({ ...s.sig });
    setPhase('done'); hapticVictory(); playVictoryFanfare();
  }, []);

  const spawnObstacle = useCallback((scene: THREE.Scene, s: GS) => {
    const gapY = (Math.random() - 0.5) * 3;
    const gapH = 1.8;
    const wallColor = 0x1e40af;
    const botH = 4 + gapY - gapH / 2;
    const topH = 4 - gapY - gapH / 2;

    const botMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, Math.max(0.1, botH), 0.5),
      new THREE.MeshStandardMaterial({ color: wallColor, emissive: wallColor, emissiveIntensity: 0.2, roughness: 0.4 })
    );
    botMesh.position.set(0, -4 + botH / 2, s.scrollZ - 20);
    scene.add(botMesh);

    const topMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, Math.max(0.1, topH), 0.5),
      new THREE.MeshStandardMaterial({ color: wallColor, emissive: wallColor, emissiveIntensity: 0.2, roughness: 0.4 })
    );
    topMesh.position.set(0, 4 - topH / 2, s.scrollZ - 20);
    scene.add(topMesh);

    s.obstacles.push({ mesh: botMesh, topMesh, gapY, z: s.scrollZ - 20, passed: false });
  }, []);

  const startLoop = useCallback(async () => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    // Mic
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ac = new AudioContext();
      const analyser = ac.createAnalyser();
      analyser.fftSize = 512;
      ac.createMediaStreamSource(stream).connect(analyser);
      s.micRef = { stream, analyser, data: new Uint8Array(analyser.frequencyBinCount) };
    } catch { /* fallback */ }

    s.running = true; s.timeLeft = GAME_DURATION; s.frame = 0; s.gameElapsed = 0;
    s.sig = { score: 0, gapsCleared: 0, collisions: 0, maxStreak: 0, streakCurrent: 0, highestCombo: 0 };
    s.birdY = 0; s.birdVY = 0; s.obstacles = []; s.scrollZ = 0;
    s.micLevel = 0; s.particles = [];
    setScoreDisplay(0); setTimeLeft(GAME_DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a2e);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a2e, 0.02);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 6);
    // === POLISH: Enhanced rim + fill lighting ===
    const rimLightA = new THREE.PointLight(0x4466ff, 1.2, 20);
    rimLightA.position.set(-6, 5, 3);
    scene.add(rimLightA);
    const fillLightB = new THREE.PointLight(0xff6644, 0.8, 15);
    fillLightB.position.set(6, -3, 5);
    scene.add(fillLightB);
    // === END POLISH ===
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x223366, 2.5));
    const sunLight = new THREE.PointLight(0xfbbf24, 2, 25);
    sunLight.position.set(0, 3, 4);
    scene.add(sunLight);

    // Scrolling background clouds
    const cloudPositions: THREE.Mesh[] = [];
    for (let i = 0; i < 15; i++) {
      const cloud = new THREE.Mesh(
        new THREE.SphereGeometry(0.5 + Math.random() * 0.5, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x334466, transparent: true, opacity: 0.3 })
      );
      cloud.position.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 5, -5 - Math.random() * 10);
      scene.add(cloud);
      cloudPositions.push(cloud);
    }

    // Star field
    const sPos = new Float32Array(400 * 3);
    for (let i = 0; i < 400; i++) {
      sPos[i * 3] = (Math.random() - 0.5) * 30;
      sPos[i * 3 + 1] = (Math.random() - 0.5) * 15;
      sPos[i * 3 + 2] = -12 - Math.random() * 15;
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0xaaccff, size: 0.05, transparent: true, opacity: 0.6 })));

    // Bird
    const bird = makeBird();
    bird.position.set(-2, 0, 0);
    scene.add(bird);
    s.birdMesh = bird;

    s.stopMusic = startMusic('drive');
    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    s.resizeCleanup = () => window.removeEventListener('resize', handleResize);

    // Initial obstacles
    for (let i = 0; i < 3; i++) {
      s.scrollZ = -i * 6;
      spawnObstacle(scene, s);
    }
    s.scrollZ = 0;

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--; setTimeLeft(s.timeLeft);
      const prog = 1 - s.timeLeft / GAME_DURATION;
      s.scrollSpeed = BASE_SCROLL_SPEED + prog * (MAX_SCROLL_SPEED - BASE_SCROLL_SPEED);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;
      const dt = 1 / 60;

      // Mic
      let breathLevel = 0.04 + Math.sin(Date.now() / 2000) * 0.03; // fallback
      if (s.micRef) {
        const { analyser, data } = s.micRef;
        analyser.getByteTimeDomainData(data as Uint8Array<ArrayBuffer>);
        let sum = 0;
        for (const v of data) sum += Math.abs(v - 128);
        const raw = sum / data.length / 128;
        breathLevel = s.micLevel * 0.7 + raw * 0.3;
        s.micLevel = breathLevel;
      }

      // Bird physics: breath = lift
      const lift = Math.max(0, breathLevel - 0.02) * 15;
      s.birdVY += (lift - 9.8 * dt * 0.15);
      s.birdVY *= 0.92;
      s.birdY += s.birdVY * dt;
      s.birdY = Math.max(-4, Math.min(4, s.birdY));
      if (s.birdMesh) {
        s.birdMesh.position.y = s.birdY;
        // Wing flap
        const wing = s.birdMesh.children[1] as THREE.Mesh;
        if (wing) wing.rotation.z = 0.3 + Math.sin(Date.now() * 0.01 + lift * 0.5) * 0.3;
        const wingR2 = s.birdMesh.children[2] as THREE.Mesh;
        if (wingR2) wingR2.rotation.z = -0.3 - Math.sin(Date.now() * 0.01 + lift * 0.5) * 0.3;
        // Bird tilt
        s.birdMesh.rotation.z = s.birdVY * 0.15;
        const mat = (s.birdMesh.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.2 + breathLevel * 2;
      }

      // Scroll obstacles
      s.scrollZ += s.scrollSpeed * dt;
      // Spawn new if needed
      const lastObs = s.obstacles[s.obstacles.length - 1];
      if (!lastObs || (s.scrollZ - lastObs.z) > 6) {
        spawnObstacle(scene, s);
      }

      // Update obstacles
      for (let i = s.obstacles.length - 1; i >= 0; i--) {
        const obs = s.obstacles[i];
        const relZ = obs.z + s.scrollZ;
        obs.mesh.position.z = relZ;
        obs.topMesh.position.z = relZ;

        // Passed check
        if (!obs.passed && relZ > 1) {
          obs.passed = true;
          s.sig.gapsCleared++;
          s.sig.streakCurrent++;
          if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
          s.sig.score += 5 * (s.sig.streakCurrent >= 3 ? 2 : 1);
          setScoreDisplay(s.sig.score);
          sfx.collect?.(); hapticScore?.();
          playScoreHit('default', s.sig.score);
        }

        // Collision check (bird at x=-2, y=birdY)
        if (relZ > -1 && relZ < 0.5) {
          const birdY = s.birdY;
          const gapTop = obs.gapY + 0.9;
          const gapBot = obs.gapY - 0.9;
          if (birdY > gapTop || birdY < gapBot) {
            // Collision!
            if (s.sig.streakCurrent > 0) {
              s.sig.collisions++;
              s.sig.streakCurrent = 0;
              sfx.collision?.(); haptic([50]);
              // Flash
              renderer.setClearColor(new THREE.Color(0.2, 0.03, 0.03));
              setTimeout(() => { renderer.setClearColor(0x0a0a2e); }, 150);
              // Push bird
              s.birdVY = -1.5;
            }
          }
        }

        // Remove far behind
        if (relZ > 8) {
          scene.remove(obs.mesh); obs.mesh.geometry.dispose();
          scene.remove(obs.topMesh); obs.topMesh.geometry.dispose();
          s.obstacles.splice(i, 1);
        }
      }

      // Trail particles
      if (s.birdMesh && s.frame % 3 === 0) {
        const pm = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 4, 4),
          new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.8 })
        );
        pm.position.copy(s.birdMesh.position);
        pm.position.x += (Math.random() - 0.5) * 0.1;
        scene.add(pm);
        s.particles.push({ mesh: pm, vx: -0.02, vy: (Math.random() - 0.5) * 0.02, life: 15 });
      }
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.mesh.position.x += p.vx;
        p.mesh.position.y += p.vy;
        p.life--;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life / 15 * 0.6;
        if (p.life <= 0) { scene.remove(p.mesh); s.particles.splice(i, 1); }
      }

      // Cloud scroll
      cloudPositions.forEach(c => {
        c.position.z += dt * 0.3;
        if (c.position.z > 2) c.position.z = -15;
      });

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, spawnObstacle]);

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
    setPhase('start'); setScoreDisplay(0); setTimeLeft(GAME_DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? '#fbbf24'}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="Breathe into the mic to fly the bird through gaps. Steady breath = steady flight!"
          ctaLabel="Allow Mic & Fly! 🌬️" accentColor={theme.colors.accent ?? '#fbbf24'} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? '#fbbf24'} />}
      <div ref={mountRef} style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        display: phase === 'playing' ? 'block' : 'none', touchAction: 'none',
      }} />
      {phase === 'playing' && (
        <GameHUD accentColor={theme.colors.accent ?? '#fbbf24'} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
          { label: 'SCORE', value: scoreDisplay },
        ]} />
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Gaps Cleared', value: String(finalSig.gapsCleared), color: '#fbbf24' },
            { label: 'Collisions', value: String(finalSig.collisions), color: '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' },
            { label: 'Score', value: String(finalSig.score), color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? '#fbbf24'} onPlayAgain={handlePlayAgain}
          didWin={finalSig.gapsCleared >= 10} />
      )}
    </GameShell>
  );
}
