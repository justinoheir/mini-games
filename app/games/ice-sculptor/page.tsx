'use client';
/**
 * ICE SCULPTOR — 3D ice block with chip-away particles.
 * Tap ice cubes to crack and shatter them, revealing hidden shape.
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

const GAME_ID = 'ice-sculptor';
const ACCENT = '#93c5fd';
const DURATION = 45;
const GAME_EMOJI = '🧊';
const GAME_TITLE = 'Ice Sculptor';
const GAME_TAGLINE = 'Tap rapidly to chip away ice and reveal the hidden shape.';

const COLS = 6, ROWS = 5;

interface IceCell {
  mesh: THREE.Mesh; cracks: number; revealed: boolean;
  isShape: boolean; row: number; col: number;
}

interface Signals {
  totalTaps: number; tapsPerSecond: number; maxTapBurst: number;
  percentRevealed: number; score: number;
}

function getPersonality(sig: Signals): string {
  if (sig.percentRevealed >= 90 && sig.tapsPerSecond >= 5) return 'Master Sculptor 🗿';
  if (sig.maxTapBurst >= 15) return 'Furious Chipper ⚡';
  if (sig.percentRevealed >= 75) return 'Detail Artist 🖌️';
  if (sig.tapsPerSecond >= 4) return 'Speed Tapper 🔨';
  return 'Block of Potential 🧊';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

export default function IceSculptorGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { totalTaps: 0, tapsPerSecond: 0, maxTapBurst: 0, percentRevealed: 0, score: 0 } as Signals,
    cells: [] as IceCell[],
    burstWindow: [] as number[],
    particles: [] as { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }[],
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    renderer: null as THREE.WebGLRenderer | null,
    raycaster: new THREE.Raycaster(),
    clickPos: new THREE.Vector2(),
    pendingClick: null as THREE.Vector2 | null,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);

  // Shape patterns (which cells are the hidden shape)
  const SHAPE_PATTERNS = [
    // Diamond
    (r: number, c: number) => {
      const cx = (COLS - 1) / 2, cy = (ROWS - 1) / 2;
      return Math.abs(c - cx) / (COLS * 0.35) + Math.abs(r - cy) / (ROWS * 0.35) <= 1;
    },
    // Plus
    (r: number, c: number) => {
      const cx = Math.floor(COLS / 2), cy = Math.floor(ROWS / 2);
      return (Math.abs(c - cx) <= 1 && Math.abs(r - cy) <= 2) || (Math.abs(r - cy) <= 1 && Math.abs(c - cx) <= 2);
    },
    // Heart
    (r: number, c: number) => {
      const x = (c - COLS / 2) / (COLS * 0.3);
      const y = -(r - ROWS * 0.55) / (ROWS * 0.3);
      return (x * x + y * y - 1) ** 3 - x * x * y * y * y <= 0;
    },
  ];

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const revealed = s.cells.filter(c => c.revealed).length;
    s.sig.percentRevealed = Math.round((revealed / s.cells.length) * 100);
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    if (!mountRef.current) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalTaps: 0, tapsPerSecond: 0, maxTapBurst: 0, percentRevealed: 0, score: 0 };
    s.burstWindow = []; s.cells = []; s.particles = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('pulse');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a1628);
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 200);
    camera.position.set(0, 0, 12);
    s.camera = camera;

    // Lights
    scene.add(new THREE.AmbientLight(0x1e40af, 3));
    const topLight = new THREE.DirectionalLight(0x93c5fd, 3);
    topLight.position.set(0, 10, 10);
    scene.add(topLight);
    const pointLight = new THREE.PointLight(0x60a5fa, 4, 30);
    pointLight.position.set(0, 5, 8);
    scene.add(pointLight);

    // Background particles (snow/dust)
    const bgGeo = new THREE.BufferGeometry();
    const bgPos = new Float32Array(500 * 3);
    for (let i = 0; i < 500; i++) {
      bgPos[i * 3] = (Math.random() - 0.5) * 30;
      bgPos[i * 3 + 1] = (Math.random() - 0.5) * 30;
      bgPos[i * 3 + 2] = (Math.random() - 0.5) * 20 - 5;
    }
    bgGeo.setAttribute('position', new THREE.BufferAttribute(bgPos, 3));
    scene.add(new THREE.Points(bgGeo, new THREE.PointsMaterial({ color: 0x93c5fd, size: 0.05, transparent: true, opacity: 0.4 })));

    // Build ice grid
    const patternFn = SHAPE_PATTERNS[Math.floor(Math.random() * SHAPE_PATTERNS.length)];
    const cellW = 1.4, cellH = 1.4, cellD = 0.8;
    const offsetX = -(COLS * cellW) / 2 + cellW / 2;
    const offsetY = -(ROWS * cellH) / 2 + cellH / 2;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const isShape = patternFn(r, c);
        const geo = new THREE.BoxGeometry(cellW - 0.08, cellH - 0.08, cellD);
        const mat = new THREE.MeshPhongMaterial({
          color: isShape ? 0x7dd3fc : 0xbae6fd,
          emissive: isShape ? 0x1e3a5f : 0x0c1f3f,
          transparent: true,
          opacity: 0.85,
          shininess: 120,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(offsetX + c * cellW, offsetY + (ROWS - 1 - r) * cellH, 0);
        scene.add(mesh);
        s.cells.push({ mesh, cracks: 0, revealed: false, isShape, row: r, col: c });
      }
    }

    // Shape outline glow (shown after revealing)
    const shapeGroup = new THREE.Group();
    scene.add(shapeGroup);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      s.sig.tapsPerSecond = parseFloat((s.sig.totalTaps / Math.max(1, DURATION - s.timeLeft)).toFixed(1));
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    let t = 0;
    const loop = () => {
      if (!s.running) { renderer.dispose(); return; }
      t += 0.016;

      // Process pending click via raycasting
      if (s.pendingClick) {
        s.raycaster.setFromCamera(s.pendingClick, camera);
        const meshes = s.cells.filter(c => !c.revealed).map(c => c.mesh);
        const hits = s.raycaster.intersectObjects(meshes);
        if (hits.length > 0) {
          const hitMesh = hits[0].object as THREE.Mesh;
          const cell = s.cells.find(c => c.mesh === hitMesh);
          if (cell && !cell.revealed) {
            cell.cracks++;
            s.sig.totalTaps++;
            const now = Date.now();
            s.burstWindow = s.burstWindow.filter(tm => now - tm < 2000);
            s.burstWindow.push(now);
            if (s.burstWindow.length > s.sig.maxTapBurst) s.sig.maxTapBurst = s.burstWindow.length;

            // Crack visual effect
            const mat = cell.mesh.material as THREE.MeshPhongMaterial;
            mat.opacity = Math.max(0.2, 0.85 - cell.cracks * 0.2);
            mat.color.setHex(cell.cracks >= 2 ? 0xdbeafe : 0xbae6fd);

            // Shake mesh
            cell.mesh.position.x += (Math.random() - 0.5) * 0.1;
            cell.mesh.position.y += (Math.random() - 0.5) * 0.1;

            if (cell.cracks >= 3) {
              // Shatter: spawn particles
              for (let p = 0; p < 8; p++) {
                const pGeo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
                const pMat = new THREE.MeshPhongMaterial({ color: cell.isShape ? 0x60a5fa : 0xbae6fd, transparent: true, opacity: 1 });
                const pm = new THREE.Mesh(pGeo, pMat);
                pm.position.copy(cell.mesh.position);
                scene.add(pm);
                s.particles.push({
                  mesh: pm,
                  vx: (Math.random() - 0.5) * 0.2,
                  vy: Math.random() * 0.15 + 0.05,
                  vz: Math.random() * 0.1 + 0.05,
                  life: 1,
                });
              }

              // Reveal
              scene.remove(cell.mesh);
              cell.revealed = true;

              if (cell.isShape) {
                // Show glowing shape cell
                const revGeo = new THREE.BoxGeometry(cellW - 0.08, cellH - 0.08, 0.2);
                const revMat = new THREE.MeshPhongMaterial({ color: 0x93c5fd, emissive: 0x1d4ed8, transparent: true, opacity: 0.6 });
                const revMesh = new THREE.Mesh(revGeo, revMat);
                revMesh.position.copy(cell.mesh.position);
                revMesh.position.z = -0.3;
                shapeGroup.add(revMesh);
              }

              const pts = cell.isShape ? 2 : 1;
              s.sig.score += pts;
              setScoreDisplay(s.sig.score);
              sfx.collect(); haptic([30]);
            } else {
              sfx.collision(); haptic([20]);
            }
          }
        }
        s.pendingClick = null;
      }

      // Update particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.mesh.position.x += p.vx;
        p.mesh.position.y += p.vy;
        p.mesh.position.z += p.vz;
        p.vy -= 0.008;
        p.life -= 0.03;
        (p.mesh.material as THREE.MeshPhongMaterial).opacity = p.life;
        if (p.life <= 0) {
          scene.remove(p.mesh);
          s.particles.splice(i, 1);
        }
      }

      // Pulse shape cells
      shapeGroup.children.forEach((child, i) => {
        (child as THREE.Mesh).material && ((child as THREE.Mesh).material as THREE.MeshPhongMaterial).color
          .setHSL(0.6, 0.8, 0.5 + Math.sin(t * 3 + i) * 0.2);
      });

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      s.running = false;
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [endGame]);

  const handleTap = useCallback((clientX: number, clientY: number) => {
    const s = stateRef.current;
    if (!s.running || !s.renderer) return;
    const rect = s.renderer.domElement.getBoundingClientRect();
    s.pendingClick = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }, []);

  useEffect(() => {
    const el = mountRef.current; if (!el) return;
    const onDown = (e: PointerEvent) => { if (phase === 'playing') handleTap(e.clientX, e.clientY); };
    el.addEventListener('pointerdown', onDown);
    return () => el.removeEventListener('pointerdown', onDown);
  }, [phase, handleTap]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    stateRef.current.renderer?.dispose();
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
  }, []);

  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg, #0a1628 0%, #0d1a2e 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Grab Chisel" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none', touchAction: 'none' }} />
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
            { label: 'Revealed', value: `${finalSig.percentRevealed}%`, color: finalSig.percentRevealed >= 75 ? '#4ade80' : '#facc15' },
            { label: 'Taps/sec', value: `${finalSig.tapsPerSecond}`, color: ACCENT },
            { label: 'Max Burst', value: `${finalSig.maxTapBurst} taps`, color: ACCENT },
            { label: 'Total Taps', value: `${finalSig.totalTaps}`, color: 'var(--color-text)' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.percentRevealed >= 70} />
      )}
      {phase === 'done' && finalSig && <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, tapsPerSecond: sig.tapsPerSecond, percentRevealed: sig.percentRevealed }, player);
  }, [theme, sig, personality, player]);
  return null;
}
