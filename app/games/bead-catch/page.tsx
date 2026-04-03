'use client';
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

const GAME_ID = 'bead-catch';
const ACCENT = '#a855f7';
const DURATION = 30;
const GAME_EMOJI = '📿';
const GAME_TITLE = 'Bead Catch';
const GAME_TAGLINE = 'Slide the net. Catch the beads!';

const BEAD_HEX = [0xa855f7, 0x22c55e, 0xeab308, 0xd946ef, 0x4ade80, 0xfbbf24];
const NET_WIDTH = 1.8;
const NET_SPEED = 0.18;

interface BeadObj {
  mesh: THREE.Mesh; vx: number; vy: number; isBad: boolean;
  caught: boolean; missed: boolean;
}
interface Signals {
  beadsCaught: number; bottlesHit: number; maxCombo: number;
  comboCurrent: number; score: number;
}
function getPersonality(s: Signals): string {
  if (s.beadsCaught >= 20 && s.bottlesHit === 0) return 'Mardi Gras Queen 👑';
  if (s.maxCombo >= 8) return 'Bead Magnet 🧲';
  if (s.bottlesHit >= 5) return 'Party Crasher 🍾';
  if (s.beadsCaught >= 12) return 'Parade Pro 🎊';
  return 'Street Dancer 🎭';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  netMesh: THREE.Mesh | null; netX: number; targetNetX: number;
  beads: BeadObj[]; frame: number;
  particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; life: number }>;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

export default function BeadCatch() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { beadsCaught: 0, bottlesHit: 0, maxCombo: 0, comboCurrent: 0, score: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    netMesh: null, netX: 0, targetNetX: 0,
    beads: [], frame: 0, particles: [],
    intervalId: null, resizeCleanup: null,
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
    s.resizeCleanup?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done'); hapticVictory();
  }, []);

  const spawnBead = useCallback((scene: THREE.Scene, s: GS) => {
    const isBad = Math.random() < 0.2;
    const colorHex = isBad ? 0x44ff44 : BEAD_HEX[Math.floor(Math.random() * BEAD_HEX.length)];
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(isBad ? 0.22 : 0.15, 12, 12),
      new THREE.MeshStandardMaterial({
        color: colorHex, emissive: colorHex, emissiveIntensity: 0.4,
        roughness: 0.3, metalness: 0.4
      })
    );
    const startX = (Math.random() - 0.5) * 8;
    mesh.position.set(startX, 5, 0);
    scene.add(mesh);
    s.beads.push({
      mesh, vx: (Math.random() - 0.5) * 0.05,
      vy: -(0.06 + Math.random() * 0.06),
      isBad, caught: false, missed: false,
    });
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { beadsCaught: 0, bottlesHit: 0, maxCombo: 0, comboCurrent: 0, score: 0 };
    s.beads = []; s.netX = 0; s.targetNetX = 0; s.particles = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1a0030);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 12);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x442266, 3));
    const pLight = new THREE.PointLight(0xa855f7, 2, 30);
    pLight.position.set(0, 5, 5);
    scene.add(pLight);
    const pLight2 = new THREE.PointLight(0xffcc00, 1.5, 25);
    pLight2.position.set(-5, 3, 5);
    scene.add(pLight2);

    // Background — parade street
    const bgPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 15),
      new THREE.MeshBasicMaterial({ color: 0x1a0030 })
    );
    bgPanel.position.z = -5;
    scene.add(bgPanel);

    // Street lights
    [-4, 0, 4].forEach(x => {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 4, 6),
        new THREE.MeshStandardMaterial({ color: 0x444444 })
      );
      pole.position.set(x, -1, -2);
      scene.add(pole);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffee44 })
      );
      bulb.position.set(x, 1.1, -2);
      scene.add(bulb);
    });

    // Net mesh
    const netMesh = new THREE.Mesh(
      new THREE.BoxGeometry(NET_WIDTH * 2, 0.15, 0.3),
      new THREE.MeshStandardMaterial({
        color: 0xa855f7, emissive: 0xa855f7, emissiveIntensity: 0.4,
        metalness: 0.3, roughness: 0.4, transparent: true, opacity: 0.85
      })
    );
    netMesh.position.set(0, -3.5, 0);
    scene.add(netMesh);
    s.netMesh = netMesh;

    // Decorative particles
    const pPos = new Float32Array(150 * 3);
    const pCols = new Float32Array(150 * 3);
    for (let i = 0; i < 150; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 15;
      pPos[i * 3 + 1] = (Math.random() - 0.5) * 12;
      pPos[i * 3 + 2] = -3 - Math.random() * 3;
      const col = new THREE.Color(BEAD_HEX[i % BEAD_HEX.length]);
      pCols[i * 3] = col.r; pCols[i * 3 + 1] = col.g; pCols[i * 3 + 2] = col.b;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pCols, 3));
    scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.06, vertexColors: true, transparent: true, opacity: 0.5 })));

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    s.resizeCleanup = () => window.removeEventListener('resize', handleResize);

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Spawn beads
      const spawnRate = Math.max(15, 40 - s.frame * 0.2);
      if (s.frame % Math.floor(spawnRate) === 0) spawnBead(scene, s);

      // Smooth net to target
      s.netX += (s.targetNetX - s.netX) * NET_SPEED;
      const clampedX = Math.max(-4.5, Math.min(4.5, s.netX));
      if (s.netMesh) s.netMesh.position.x = clampedX;

      // Net glow pulse
      if (s.netMesh) {
        const mat = s.netMesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.3 + Math.sin(Date.now() * 0.005) * 0.1;
      }

      // Update beads
      for (let i = s.beads.length - 1; i >= 0; i--) {
        const b = s.beads[i];
        b.mesh.position.y += b.vy;
        b.mesh.position.x += b.vx;
        b.mesh.rotation.x += 0.05;

        // Check net collision
        if (!b.caught && !b.missed) {
          const netY = s.netMesh ? s.netMesh.position.y : -3.5;
          const dx = b.mesh.position.x - (s.netMesh ? s.netMesh.position.x : 0);
          const dy = b.mesh.position.y - netY;
          if (Math.abs(dx) < NET_WIDTH && Math.abs(dy) < 0.4) {
            b.caught = true;
            if (b.isBad) {
              s.sig.bottlesHit++; s.sig.comboCurrent = 0;
              sfx.collision(); hapticFail();
              (b.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0xff2200);
              (b.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 1;
            } else {
              s.sig.beadsCaught++; s.sig.comboCurrent++;
              if (s.sig.comboCurrent > s.sig.maxCombo) s.sig.maxCombo = s.sig.comboCurrent;
              const mult = s.sig.comboCurrent >= 5 ? 3 : s.sig.comboCurrent >= 3 ? 2 : 1;
              s.sig.score += 2 * mult; setScoreDisplay(s.sig.score);
              sfx.collect(); hapticScore();
              if (s.sig.comboCurrent >= 3) hapticCombo(s.sig.comboCurrent);
              // Pop particles
              const col = (b.mesh.material as THREE.MeshStandardMaterial).color;
              for (let pi = 0; pi < 6; pi++) {
                const pm = new THREE.Mesh(
                  new THREE.SphereGeometry(0.05, 4, 4),
                  new THREE.MeshBasicMaterial({ color: col.clone(), transparent: true, opacity: 1 })
                );
                pm.position.copy(b.mesh.position);
                scene.add(pm);
                s.particles.push({ mesh: pm, vx: (Math.random() - 0.5) * 0.12, vy: 0.06 + Math.random() * 0.06, life: 20 });
              }
            }
            setTimeout(() => {
              if (!stateRef.current.running) return;
              if (b.mesh.parent) scene.remove(b.mesh);
              const idx = stateRef.current.beads.indexOf(b);
              if (idx >= 0) stateRef.current.beads.splice(idx, 1);
            }, 200);
          }
        }

        // Missed
        if (b.mesh.position.y < -6) {
          b.missed = true;
          if (!b.isBad) { s.sig.comboCurrent = 0; hapticFail?.(); }
          scene.remove(b.mesh); s.beads.splice(i, 1);
        }
      }

      // Particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.mesh.position.x += p.vx;
        p.mesh.position.y += p.vy;
        p.vy -= 0.003;
        p.life--;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life / 20;
        if (p.life <= 0) { scene.remove(p.mesh); s.particles.splice(i, 1); }
      }

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, spawnBead]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const onPointerMove = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const rect = mount.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      stateRef.current.targetNetX = (nx - 0.5) * 10;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const rect = mount.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      stateRef.current.targetNetX = (nx - 0.5) * 10;
    };
    mount.addEventListener('pointermove', onPointerMove);
    mount.addEventListener('pointerdown', onPointerDown);
    return () => {
      mount.removeEventListener('pointermove', onPointerMove);
      mount.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase]);

  useEffect(() => () => {
    const s = stateRef.current;
    s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
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
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="Slide your finger to move the net. Catch colorful beads, avoid the bottles!"
          ctaLabel="Catch! 📿" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        display: phase === 'playing' ? 'block' : 'none', touchAction: 'none',
      }} />
      {phase === 'playing' && (
        <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 5 },
          { label: 'SCORE', value: scoreDisplay },
        ]} />
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Beads Caught', value: String(finalSig.beadsCaught), color: ACCENT },
            { label: 'Bottles Hit', value: String(finalSig.bottlesHit), color: '#ef4444' },
            { label: 'Max Combo', value: `×${finalSig.maxCombo}`, color: '#fbbf24' },
            { label: 'Score', value: String(finalSig.score), color: '#4ade80' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.beadsCaught >= 10} />
      )}
    </GameShell>
  );
}
