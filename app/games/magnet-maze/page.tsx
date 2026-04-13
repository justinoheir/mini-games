'use client';
/**
 * MAGNET MAZE — 3D maze with magnetic particle effects.
 * Tilt or drag to steer a metal ball through a maze with attracting magnets.
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
import { motion, AnimatePresence } from 'framer-motion';

const GAME_ID = 'magnet-maze';
const ACCENT = '#a78bfa';
const DURATION = 60;
const GAME_EMOJI = '🧲';
const GAME_TITLE = 'Magnet Maze';
const GAME_TAGLINE = 'Tilt to steer. Magnets will try to stop you.';
const PB_KEY = 'mg_pb_magnet-maze';

const GRID = 5;
const CELL_SIZE = 2.5;

interface MazeCell { top: boolean; right: boolean; bottom: boolean; left: boolean; }
interface MagnetObj { mesh: THREE.Mesh; light: THREE.PointLight; x: number; z: number; strength: number; polarity: 1 | -1; }

interface Signals { score: number; completionTime: number | null; collisions: number; timedOut: boolean; }

function getPersonality(sig: Signals): string {
  if (sig.completionTime && sig.completionTime < 20000) return 'Magnetic Genius 🧲';
  if (sig.completionTime && sig.completionTime < 35000) return 'Field Navigator 🧭';
  if (sig.completionTime) return 'Persistent Explorer 🔍';
  if (sig.collisions < 8) return 'Careful Crawler 🐢';
  return 'Pinball Wizard 🎰';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function generateMaze(rows: number, cols: number): MazeCell[][] {
  const grid: MazeCell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ top: true, right: true, bottom: true, left: true }))
  );
  const visited = new Set<string>();

  function dfs(r: number, c: number) {
    visited.add(`${r},${c}`);
    const dirs = [[-1, 0, 'top', 'bottom'], [1, 0, 'bottom', 'top'], [0, -1, 'left', 'right'], [0, 1, 'right', 'left']].sort(() => Math.random() - 0.5);
    for (const [dr, dc, w1, w2] of dirs as [number, number, keyof MazeCell, keyof MazeCell][]) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited.has(`${nr},${nc}`)) {
        grid[r][c][w1] = false;
        grid[nr][nc][w2] = false;
        dfs(nr, nc);
      }
    }
  }
  dfs(0, 0);
  return grid;
}

function MagnetMazeGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, streak: 0, timeLeft: DURATION,
    sig: { score: 0, completionTime: null, collisions: 0, timedOut: false } as Signals,
    ballPos: new THREE.Vector3(0, 0.4, 0),
    ballVel: new THREE.Vector3(0, 0, 0),
    ball: null as THREE.Mesh | null,
    magnets: [] as MagnetObj[],
    mazeWalls: [] as THREE.Mesh[],
    goalMesh: null as THREE.Mesh | null,
    tiltX: 0, tiltZ: 0,
    lastTouchX: null as number | null, lastTouchZ: null as number | null,
    orientation: { gamma: 0, beta: 0 },
    startTime: 0,
    mazeCells: [] as MazeCell[][],
    fieldParticles: [] as { mesh: THREE.Mesh; angle: number; radius: number; magnetIdx: number }[],
    scene: null as THREE.Scene | null,
    renderer: null as THREE.WebGLRenderer | null,
    camera: null as THREE.PerspectiveCamera | null,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streak, setStreak] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [wonDisplay, setWonDisplay] = useState(false);

  const endGame = useCallback((won: boolean) => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (!won) s.sig.timedOut = true;
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    if (!mountRef.current) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, completionTime: null, collisions: 0, timedOut: false };
    s.ballPos.set(0, 0.4, 0); s.ballVel.set(0, 0, 0);
    s.tiltX = 0; s.tiltZ = 0; s.startTime = Date.now();
    s.magnets = []; s.fieldParticles = [];
    setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setWonDisplay(false); setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x030110);
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x030110, 0.04);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 200);
    camera.position.set(0, 14, 12);
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    // Lights
    scene.add(new THREE.AmbientLight(0x110025, 4));
    const topLight = new THREE.PointLight(0xa78bfa, 2, 30);
    topLight.position.set(0, 10, 0);
    scene.add(topLight);

    // Floor
    const floorGeo = new THREE.PlaneGeometry(GRID * CELL_SIZE + 1, GRID * CELL_SIZE + 1);
    const floorMat = new THREE.MeshPhongMaterial({ color: 0x0a0520, emissive: 0x050210 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Maze generation
    const maze = generateMaze(GRID, GRID);
    s.mazeCells = maze;
    const wallMat = new THREE.MeshPhongMaterial({ color: 0x4c1d95, emissive: 0x1e0066, transparent: true, opacity: 0.9 });
    const wallH = 0.8, wallT = 0.15;
    const offsetX = -(GRID * CELL_SIZE) / 2;
    const offsetZ = -(GRID * CELL_SIZE) / 2;

    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const cx = offsetX + c * CELL_SIZE + CELL_SIZE / 2;
        const cz = offsetZ + r * CELL_SIZE + CELL_SIZE / 2;
        const cell = maze[r][c];

        // Top wall
        if (cell.top && r === 0) {
          const wGeo = new THREE.BoxGeometry(CELL_SIZE + wallT, wallH, wallT);
          const w = new THREE.Mesh(wGeo, wallMat.clone());
          w.position.set(cx, wallH / 2, offsetZ + r * CELL_SIZE);
          scene.add(w); s.mazeWalls.push(w);
        }
        if (cell.bottom) {
          const wGeo = new THREE.BoxGeometry(CELL_SIZE + wallT, wallH, wallT);
          const w = new THREE.Mesh(wGeo, wallMat.clone());
          w.position.set(cx, wallH / 2, offsetZ + (r + 1) * CELL_SIZE);
          scene.add(w); s.mazeWalls.push(w);
        }
        if (cell.left && c === 0) {
          const wGeo = new THREE.BoxGeometry(wallT, wallH, CELL_SIZE + wallT);
          const w = new THREE.Mesh(wGeo, wallMat.clone());
          w.position.set(offsetX + c * CELL_SIZE, wallH / 2, cz);
          scene.add(w); s.mazeWalls.push(w);
        }
        if (cell.right) {
          const wGeo = new THREE.BoxGeometry(wallT, wallH, CELL_SIZE + wallT);
          const w = new THREE.Mesh(wGeo, wallMat.clone());
          w.position.set(offsetX + (c + 1) * CELL_SIZE, wallH / 2, cz);
          scene.add(w); s.mazeWalls.push(w);
        }
      }
    }

    // Goal at far corner
    const goalX = offsetX + (GRID - 0.5) * CELL_SIZE;
    const goalZ = offsetZ + (GRID - 0.5) * CELL_SIZE;
    const goalGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 16);
    const goalMat = new THREE.MeshPhongMaterial({ color: 0xfbbf24, emissive: 0x92400e });
    const goalMesh = new THREE.Mesh(goalGeo, goalMat);
    goalMesh.position.set(goalX, 0.05, goalZ);
    scene.add(goalMesh);
    s.goalMesh = goalMesh;
    const goalLight = new THREE.PointLight(0xfbbf24, 3, 5);
    goalLight.position.set(goalX, 1, goalZ);
    scene.add(goalLight);

    // Magnets (2-3 scattered in maze)
    const magnetCount = 2 + Math.floor(Math.random() * 2);
    for (let m = 0; m < magnetCount; m++) {
      const mc = Math.floor(1 + Math.random() * (GRID - 2));
      const mr = Math.floor(1 + Math.random() * (GRID - 2));
      const mx = offsetX + mc * CELL_SIZE + CELL_SIZE / 2;
      const mz = offsetZ + mr * CELL_SIZE + CELL_SIZE / 2;
      const polarity: 1 | -1 = Math.random() > 0.5 ? 1 : -1;

      const magnetGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.5, 8);
      const magnetMat = new THREE.MeshPhongMaterial({
        color: polarity === 1 ? 0xef4444 : 0x3b82f6,
        emissive: polarity === 1 ? 0x7f1d1d : 0x1e3a5f,
        shininess: 100,
      });
      const magnetMesh = new THREE.Mesh(magnetGeo, magnetMat);
      magnetMesh.position.set(mx, 0.25, mz);
      scene.add(magnetMesh);

      const magnetLight = new THREE.PointLight(polarity === 1 ? 0xff4444 : 0x4488ff, 2, 4);
      magnetLight.position.set(mx, 0.5, mz);
      scene.add(magnetLight);

      s.magnets.push({ mesh: magnetMesh, light: magnetLight, x: mx, z: mz, strength: 1 + Math.random(), polarity });

      // Field particles orbiting magnet
      for (let fp = 0; fp < 6; fp++) {
        const fpGeo = new THREE.SphereGeometry(0.06, 6, 6);
        const fpMat = new THREE.MeshBasicMaterial({ color: polarity === 1 ? 0xff6666 : 0x6688ff, transparent: true, opacity: 0.8 });
        const fpMesh = new THREE.Mesh(fpGeo, fpMat);
        scene.add(fpMesh);
        s.fieldParticles.push({ mesh: fpMesh, angle: (fp / 6) * Math.PI * 2, radius: 0.8 + Math.random() * 0.4, magnetIdx: s.magnets.length - 1 });
      }
    }

    // Ball
    const ballGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const ballMat = new THREE.MeshPhongMaterial({ color: 0xc0c0c0, emissive: 0x303030, shininess: 200 });
    const ball = new THREE.Mesh(ballGeo, ballMat);
    ball.position.copy(s.ballPos);
    scene.add(ball);
    s.ball = ball;
    const ballLight = new THREE.PointLight(0xa78bfa, 1.5, 3);
    scene.add(ballLight);

    // Tilt via device orientation
    const onOrient = (e: DeviceOrientationEvent) => {
      s.orientation.gamma = e.gamma ?? 0;
      s.orientation.beta = e.beta ?? 0;
    };
    window.addEventListener('deviceorientation', onOrient);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) endGame(false);
    }, 1000);

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    const BOUNDS = (GRID * CELL_SIZE) / 2 - 0.35;
    let t = 0;
    const loop = () => {
      if (!s.running) { renderer.dispose(); return; }
      t += 0.016;

      // Physics: tilt drives ball
      const tiltX = s.tiltX + (s.orientation.gamma ?? 0) * 0.005;
      const tiltZ = s.tiltZ + (s.orientation.beta ?? 0) * 0.003;

      s.ballVel.x += tiltX * 0.01;
      s.ballVel.z += tiltZ * 0.01;

      // Magnet forces
      for (const mag of s.magnets) {
        const dx = mag.x - s.ballPos.x;
        const dz = mag.z - s.ballPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 3 && dist > 0.3) {
          const force = (mag.polarity * mag.strength * 0.008) / (dist * dist);
          s.ballVel.x += (dx / dist) * force;
          s.ballVel.z += (dz / dist) * force;
        }
      }

      // Damping
      s.ballVel.multiplyScalar(0.88);

      // Clamp velocity
      const speed = s.ballVel.length();
      if (speed > 0.12) s.ballVel.multiplyScalar(0.12 / speed);

      // Move
      s.ballPos.x += s.ballVel.x;
      s.ballPos.z += s.ballVel.z;

      // Wall bounds (simple)
      s.ballPos.x = Math.max(-BOUNDS, Math.min(BOUNDS, s.ballPos.x));
      s.ballPos.z = Math.max(-BOUNDS, Math.min(BOUNDS, s.ballPos.z));

      if (s.ball) {
        s.ball.position.copy(s.ballPos);
        s.ball.rotation.x += s.ballVel.z * 5;
        s.ball.rotation.z -= s.ballVel.x * 5;
        ballLight.position.copy(s.ballPos).y += 0.5;
      }

      // Check goal
      if (s.goalMesh) {
        const gdx = s.ballPos.x - s.goalMesh.position.x;
        const gdz = s.ballPos.z - s.goalMesh.position.z;
        if (Math.sqrt(gdx * gdx + gdz * gdz) < 0.6) {
          s.sig.completionTime = Date.now() - s.startTime;
          s.sig.score = Math.max(0, 100 - Math.floor(s.sig.completionTime / 500));
          setScoreDisplay(s.sig.score);
          sfx.success(); haptic([50, 30, 80]);
          setWonDisplay(true);
          endGame(true);
          return;
        }
        s.goalMesh.rotation.y += 0.03;
      }

      // Field particles orbit magnets
      s.fieldParticles.forEach(fp => {
        fp.angle += 0.05;
        const mag = s.magnets[fp.magnetIdx];
        fp.mesh.position.set(
          mag.x + Math.cos(fp.angle) * fp.radius,
          0.4,
          mag.z + Math.sin(fp.angle) * fp.radius,
        );
      });

      // Pulse magnets
      s.magnets.forEach((mag, i) => {
        const scale = 1 + Math.sin(t * 3 + i) * 0.1;
        mag.mesh.scale.setScalar(scale);
        mag.light.intensity = 1.5 + Math.sin(t * 2 + i) * 0.5;
      });

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      s.running = false;
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('deviceorientation', onOrient);
      renderer.dispose();
    };
  }, [endGame]);

  // Touch drag fallback
  useEffect(() => {
    const el = mountRef.current; if (!el) return;
    let lastX = 0, lastY = 0;
    const onPD = (e: PointerEvent) => { lastX = e.clientX; lastY = e.clientY; };
    const onPM = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      s.tiltX = dx * 0.008;
      s.tiltZ = dy * 0.008;
      lastX = e.clientX; lastY = e.clientY;
    };
    const onPU = () => { const s = stateRef.current; s.tiltX = 0; s.tiltZ = 0; };
    el.addEventListener('pointerdown', onPD);
    el.addEventListener('pointermove', onPM);
    el.addEventListener('pointerup', onPU);
    return () => { el.removeEventListener('pointerdown', onPD); el.removeEventListener('pointermove', onPM); el.removeEventListener('pointerup', onPU); };
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    stateRef.current.renderer?.dispose();
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setFinalSig(null); setWonDisplay(false); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg,#030110 0%,#060225 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Enter the Maze 🧲" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} role="application" aria-label="Game area - tap to play" style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none', touchAction: 'none' }} />
      {phase === 'playing' && (
        <>
          <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />
          <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', color: 'rgba(167,139,250,0.6)', fontSize: 12, pointerEvents: 'none', zIndex: 50 }}>
            Drag to steer — reach the ✨ goal
          </div>
        </>
      )}
      <AnimatePresence>
        {wonDisplay && (
          <motion.div key="won" initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: '30%', left: '50%', transform: 'translateX(-50%)', zIndex: 90, pointerEvents: 'none', fontSize: 32, fontWeight: 900, color: '#fbbf24', textShadow: '0 0 20px #fbbf24' }}>
            🏆 YOU MADE IT!
          </motion.div>
        )}
      </AnimatePresence>
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Completed', value: finalSig.completionTime ? `${(finalSig.completionTime / 1000).toFixed(1)}s` : 'Not yet', color: finalSig.completionTime ? '#4ade80' : '#ef4444' },
            { label: 'Collisions', value: `${finalSig.collisions}`, color: '#fbbf24' },
            { label: 'Score', value: `${finalSig.score}`, color: ACCENT },
            { label: 'Timed Out', value: finalSig.timedOut ? 'Yes' : 'No', color: finalSig.timedOut ? '#ef4444' : '#4ade80' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={!!finalSig.completionTime} />
      )}
      {phase === 'done' && finalSig && <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const MagnetMazeGame = dynamic(() => Promise.resolve({ default: MagnetMazeGameInner }), { ssr: false });
export default MagnetMazeGame;
