'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCelebration, hapticCombo } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'boo-blast';
const PB_KEY = 'pb_boo-blast';
const ACCENT = '#7c3aed';
const DURATION = 45;
const GAME_EMOJI = '👻';
const GAME_TITLE = 'Boo Blast';
const GAME_TAGLINE = "Tap the ghosts. They won't wait.";

interface GhostObj {
  id: number; mesh: THREE.Group; x: number; y: number; z: number;
  vx: number; vy: number; spawnTime: number; lifespan: number;
  popping: boolean; popTimer: number; isBomb: boolean; points: number;
}
interface Signals {
  score: number; ghosts: number; missed: number; bombs: number;
  maxStreak: number; streakCurrent: number; lives: number;
}
function getPersonality(sig: Signals): string {
  const acc = (sig.ghosts + sig.missed) > 0 ? sig.ghosts / (sig.ghosts + sig.missed) : 0;
  if (acc >= 0.85 && sig.maxStreak >= 8) return 'Ghost Slayer 👻';
  if (sig.maxStreak >= 10) return 'Spectral Pro ⚡';
  if (acc >= 0.7) return 'Boo Buster 💥';
  if (sig.bombs > 3) return 'Reckless Blaster 💣';
  return 'Haunted Rookie 🕯️';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  ghosts: GhostObj[]; nextId: number; frame: number;
  particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }>;
  fogLights: THREE.PointLight[];
  stopMusic: (() => void) | null;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

function makeGhostMesh(isBomb: boolean): THREE.Group {
  const g = new THREE.Group();
  const color = isBomb ? 0xff2200 : (Math.random() < 0.5 ? 0xffffff : 0xccaaff);
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 16, 16),
    new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.5,
      transparent: true, opacity: 0.88, roughness: 0.3
    })
  );
  g.add(body);
  // Ghost tail (flattened spheres)
  if (!isBomb) {
    for (let i = 0; i < 3; i++) {
      const bump = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 8, 8),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, transparent: true, opacity: 0.7 })
      );
      bump.position.set(-0.3 + i * 0.3, -0.55, 0);
      bump.scale.y = 0.6;
      g.add(bump);
    }
    // Eyes
    [-0.15, 0.15].forEach(ex => {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0x000000 })
      );
      eye.position.set(ex, 0.1, 0.45);
      g.add(eye);
    });
  } else {
    // Bomb — skull shape
    const skull = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff0000, emissiveIntensity: 0.3 })
    );
    skull.position.y = 0.1;
    g.add(skull);
    // Fuse
    const fuse = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.3, 4),
      new THREE.MeshBasicMaterial({ color: 0x888800 })
    );
    fuse.position.set(0, 0.55, 0);
    g.add(fuse);
  }
  return g;
}

function BooBlastInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, ghosts: 0, missed: 0, bombs: 0, maxStreak: 0, streakCurrent: 0, lives: 3 },
    renderer: null, scene: null, camera: null, animId: 0,
    ghosts: [], nextId: 0, frame: 0, particles: [], fogLights: [],
    stopMusic: null, intervalId: null, resizeCleanup: null,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (s.stopMusic) { s.stopMusic(); s.stopMusic = null; }
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

  const spawnGhost = useCallback((scene: THREE.Scene, s: GS) => {
    const progress = 1 - s.timeLeft / DURATION;
    const isBomb = Math.random() < 0.15 + progress * 0.1;
    const mesh = makeGhostMesh(isBomb);
    const x = (Math.random() - 0.5) * 8;
    const y = (Math.random() - 0.5) * 5;
    const z = (Math.random() - 0.5) * 3;
    mesh.position.set(x, y, z);
    scene.add(mesh);
    const lifespan = Math.max(1500, 3000 - progress * 1500);
    s.ghosts.push({
      id: s.nextId++, mesh, x, y, z,
      vx: (Math.random() - 0.5) * 0.02,
      vy: Math.sin(s.nextId) * 0.01,
      spawnTime: Date.now(), lifespan,
      popping: false, popTimer: 0,
      isBomb, points: isBomb ? -5 : (Math.random() < 0.1 ? 5 : 2),
    });
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { score: 0, ghosts: 0, missed: 0, bombs: 0, maxStreak: 0, streakCurrent: 0, lives: 3 };
    s.ghosts = []; s.nextId = 0; s.particles = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0510);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x1a0a2e, 0.04);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 10);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x220033, 2));
    const purpleLight = new THREE.PointLight(0x7c3aed, 2, 25);
    purpleLight.position.set(0, 3, 5);
    scene.add(purpleLight);
    const redLight = new THREE.PointLight(0xff2200, 1, 20);
    redLight.position.set(-5, -2, 3);
    scene.add(redLight);

    // Haunted background — gravestones
    [-3, -1, 1, 3].forEach((x, i) => {
      const stone = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 1.0, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x444455, roughness: 0.9 })
      );
      stone.position.set(x, -3.5, -3 - i % 2);
      scene.add(stone);
      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 0.3, 8, 1, false, 0, Math.PI),
        new THREE.MeshStandardMaterial({ color: 0x444455, roughness: 0.9 })
      );
      top.position.set(x, -3, -3 - i % 2);
      top.rotation.z = Math.PI;
      scene.add(top);
    });

    // Moon
    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 32),
      new THREE.MeshBasicMaterial({ color: 0xfffadd })
    );
    moon.position.set(3, 4, -8);
    scene.add(moon);

    // Star field
    const sPos = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) {
      sPos[i * 3] = (Math.random() - 0.5) * 30;
      sPos[i * 3 + 1] = (Math.random() - 0.5) * 15;
      sPos[i * 3 + 2] = -10 - Math.random() * 10;
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0xaaaaff, size: 0.05, transparent: true, opacity: 0.5 })));

    s.stopMusic = startMusic('ambient');
    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    s.resizeCleanup = () => window.removeEventListener('resize', handleResize);

    // Initial ghosts
    for (let i = 0; i < 3; i++) spawnGhost(scene, s);

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--; setTimeLeft(s.timeLeft);
      const progress = 1 - s.timeLeft / DURATION;
      // Spawn more ghosts as time goes on
      const toSpawn = 1 + Math.floor(progress * 3);
      for (let i = 0; i < toSpawn && s.ghosts.filter(g => !g.popping).length < 8; i++) {
        spawnGhost(scene, s);
      }
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;
      const now = Date.now();

      // Update ghosts
      for (let i = s.ghosts.length - 1; i >= 0; i--) {
        const g = s.ghosts[i];
        if (g.popping) {
          g.popTimer++;
          g.mesh.scale.setScalar(1 + g.popTimer * 0.1);
          g.mesh.children.forEach(c => {
            if (c instanceof THREE.Mesh) {
              const mat = c.material as THREE.MeshStandardMaterial;
              mat.opacity = Math.max(0, 1 - g.popTimer / 12);
            }
          });
          if (g.popTimer > 12) {
            scene.remove(g.mesh); s.ghosts.splice(i, 1);
          }
          continue;
        }
        // Float animation
        g.mesh.position.x += g.vx;
        g.mesh.position.y += g.vy + Math.sin(now * 0.002 + g.id) * 0.005;
        g.mesh.rotation.y += 0.02;

        // Pulse glow
        g.mesh.children.forEach(c => {
          if (c instanceof THREE.Mesh && c.material instanceof THREE.MeshStandardMaterial) {
            c.material.emissiveIntensity = 0.3 + Math.sin(now * 0.004 + g.id) * 0.2;
          }
        });

        // Timeout
        if (now - g.spawnTime > g.lifespan) {
          if (!g.isBomb) {
            s.sig.missed++; s.sig.streakCurrent = 0;
          }
          scene.remove(g.mesh); s.ghosts.splice(i, 1);
        }
      }

      // Particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.mesh.position.x += p.vx;
        p.mesh.position.y += p.vy;
        p.mesh.position.z += p.vz;
        p.vy -= 0.008;
        p.life--;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life / 20;
        if (p.life <= 0) { scene.remove(p.mesh); s.particles.splice(i, 1); }
      }

      // Camera subtle sway
      camera.position.x = Math.sin(now * 0.0005) * 0.2;

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, spawnGhost]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.camera) return;
      const rect = mount.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(nx, ny), s.camera);

      let hit = false;
      for (const g of s.ghosts) {
        if (g.popping) continue;
        const intersects = raycaster.intersectObject(g.mesh, true);
        if (intersects.length > 0) {
          hit = true;
          g.popping = true; g.popTimer = 0;
          if (g.isBomb) {
            s.sig.bombs++;
            s.sig.score = Math.max(0, s.sig.score + g.points);
            s.sig.streakCurrent = 0;
            sfx.collision(); hapticFail();
            renderer: { }
          } else {
            s.sig.ghosts++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const mult = s.sig.streakCurrent >= 5 ? 3 : s.sig.streakCurrent >= 3 ? 2 : 1;
            s.sig.score += g.points * mult;
            setScoreDisplay(s.sig.score);
            sfx.collect(); hapticScore();
            if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
            // Pop particles
            const scene = s.scene!;
            for (let pi = 0; pi < 8; pi++) {
              const pm = new THREE.Mesh(
                new THREE.SphereGeometry(0.07, 4, 4),
                new THREE.MeshBasicMaterial({ color: 0xaa88ff, transparent: true, opacity: 1 })
              );
              pm.position.copy(g.mesh.position);
              scene.add(pm);
              s.particles.push({ mesh: pm, vx: (Math.random() - 0.5) * 0.15, vy: Math.random() * 0.12, vz: (Math.random() - 0.5) * 0.1, life: 20 });
            }
          }
          break;
        }
      }
      if (!hit) {
        hapticFail?.();
      }
    };
    mount.addEventListener('pointerdown', onPointerDown);
    return () => mount.removeEventListener('pointerdown', onPointerDown);
  }, [phase]);

  useEffect(() => () => {
    const s = stateRef.current;
    s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.stopMusic) s.stopMusic();
    s.resizeCleanup?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Boo! 👻" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{
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
            { label: 'Ghosts Blasted', value: String(finalSig.ghosts), color: ACCENT },
            { label: 'Missed', value: String(finalSig.missed), color: '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
            { label: 'Bombs Hit', value: String(finalSig.bombs), color: '#ff4400' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.ghosts >= 15} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const BooBlast = dynamic(() => Promise.resolve({ default: BooBlastInner }), { ssr: false });
export default BooBlast;
