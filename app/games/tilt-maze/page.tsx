'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, startMusic } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticImpact } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { createTiltController } from '@/lib/tilt';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

type MazeCell = { top: number; right: number; bottom: number; left: number };
const GRID = 5;
const GAME_ID = 'tilt-maze';
const ACCENT = '#a78bfa';
const DURATION = 60;
const GAME_EMOJI = '🌀';
const GAME_TITLE = 'Tilt Maze';
const GAME_TAGLINE = 'Tilt to roll the ball to the exit!';
const PB_KEY = 'mg_pb_tilt-maze';

function generateMaze(grid: number): MazeCell[][] {
  const cells: MazeCell[][] = Array.from({ length: grid }, () =>
    Array.from({ length: grid }, () => ({ top: 1, right: 1, bottom: 1, left: 1 }))
  );
  const visited = Array.from({ length: grid }, () => new Array<boolean>(grid).fill(false));
  function carve(r: number, c: number) {
    visited[r][c] = true;
    const dirs: [number, number, keyof MazeCell, keyof MazeCell][] = ([
      [0, 1, 'right', 'left'], [-1, 0, 'top', 'bottom'],
      [0, -1, 'left', 'right'], [1, 0, 'bottom', 'top'],
    ] as [number, number, keyof MazeCell, keyof MazeCell][]).sort(() => Math.random() - 0.5);
    for (const [dr, dc, wall, opposite] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < grid && nc >= 0 && nc < grid && !visited[nr][nc]) {
        cells[r][c][wall] = 0; cells[nr][nc][opposite] = 0; carve(nr, nc);
      }
    }
  }
  carve(0, 0);
  return cells;
}

interface Signals { mazesSolved: number; totalTime: number; avgMazeTime: number; wallBumps: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(sig: Signals): string {
  if (sig.mazesSolved >= 4 && sig.wallBumps === 0) return 'Perfect Navigator 🧭';
  if (sig.mazesSolved >= 3 && sig.avgMazeTime < 10) return 'Speed Solver ⚡';
  if (sig.mazesSolved >= 2) return 'Maze Runner 🌀';
  if (sig.wallBumps < 5) return 'Careful Trekker 🎯';
  return 'Getting Lost 🤔';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

const CELL_SIZE = 1.8;
const WALL_H = 0.6, WALL_T = 0.12;

export default function TiltMazeGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const tiltCtrlRef = useRef<ReturnType<typeof createTiltController> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    sig: { mazesSolved: 0, totalTime: 0, avgMazeTime: 0, wallBumps: 0, maxStreak: 0, streakCurrent: 0, score: 0 } as Signals,
    ballX: 0, ballZ: 0, ballVX: 0, ballVZ: 0,
    tiltX: 0, tiltZ: 0,
    maze: [] as MazeCell[][],
    mazeGroup: null as THREE.Group | null,
    ballMesh: null as THREE.Mesh | null,
    exitMesh: null as THREE.Mesh | null,
    mazeStartTime: 0, frame: 0,
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
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    tiltCtrlRef.current?.stop();
    if (s.sig.mazesSolved > 0) s.sig.avgMazeTime = s.sig.totalTime / s.sig.mazesSolved;
    try { const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0', 10); if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score)); } catch { }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const buildMaze3D = useCallback((scene: THREE.Scene, group: THREE.Group, maze: MazeCell[][]) => {
    // Clear group
    while (group.children.length > 0) group.remove(group.children[0]);

    const WALL_MAT = new THREE.MeshStandardMaterial({ color: 0x4c1d95, roughness: 0.6, emissive: 0xa78bfa, emissiveIntensity: 0.15 });
    const FLOOR_MAT = new THREE.MeshStandardMaterial({ color: 0x0f0a1a, roughness: 0.9 });

    // Floor
    const floorGeo = new THREE.PlaneGeometry(GRID * CELL_SIZE + WALL_T, GRID * CELL_SIZE + WALL_T);
    const floor = new THREE.Mesh(floorGeo, FLOOR_MAT);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    group.add(floor);

    // Exit highlight
    const exitGeo = new THREE.PlaneGeometry(CELL_SIZE * 0.7, CELL_SIZE * 0.7);
    const exitMat = new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x4ade80, emissiveIntensity: 0.8 });
    const exitMesh = new THREE.Mesh(exitGeo, exitMat);
    exitMesh.rotation.x = -Math.PI / 2;
    const exitX = (GRID - 1 - GRID / 2 + 0.5) * CELL_SIZE;
    const exitZ = (GRID - 1 - GRID / 2 + 0.5) * CELL_SIZE;
    exitMesh.position.set(exitX, 0.02, exitZ);
    group.add(exitMesh);
    stateRef.current.exitMesh = exitMesh;

    const makeWall = (x: number, y: number, w: number, h: number, horizontal: boolean) => {
      const geo = horizontal ? new THREE.BoxGeometry(w, WALL_H, WALL_T) : new THREE.BoxGeometry(WALL_T, WALL_H, h);
      const mesh = new THREE.Mesh(geo, WALL_MAT);
      mesh.position.set(x, WALL_H / 2, y);
      mesh.castShadow = true;
      group.add(mesh);
    };

    const originX = -GRID / 2 * CELL_SIZE;
    const originZ = -GRID / 2 * CELL_SIZE;

    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const cx = originX + c * CELL_SIZE + CELL_SIZE / 2;
        const cz = originZ + r * CELL_SIZE + CELL_SIZE / 2;
        const cell = maze[r][c];
        if (cell.top) makeWall(cx, cz - CELL_SIZE / 2, CELL_SIZE + WALL_T, WALL_T, true);
        if (cell.left) makeWall(cx - CELL_SIZE / 2, cz, WALL_T, CELL_SIZE + WALL_T, false);
        if (r === GRID - 1 && cell.bottom) makeWall(cx, cz + CELL_SIZE / 2, CELL_SIZE + WALL_T, WALL_T, true);
        if (c === GRID - 1 && cell.right) makeWall(cx + CELL_SIZE / 2, cz, WALL_T, CELL_SIZE + WALL_T, false);
      }
    }
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { mazesSolved: 0, totalTime: 0, avgMazeTime: 0, wallBumps: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.ballX = -(GRID / 2 - 0.5) * CELL_SIZE;
    s.ballZ = -(GRID / 2 - 0.5) * CELL_SIZE;
    s.ballVX = 0; s.ballVZ = 0; s.tiltX = 0; s.tiltZ = 0;
    s.mazeStartTime = Date.now();
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a1a);
    renderer.shadowMap.enabled = true;
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0a1a, 20, 50);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 10, 8);
    // === POLISH: Responsive resize handler ===
    const _onResizeHandler = () => {
      const _W = (mountRef.current?.clientWidth || window.innerWidth);
      const _H = (mountRef.current?.clientHeight || window.innerHeight);
      renderer.setSize(_W, _H);
      if (camera instanceof THREE.PerspectiveCamera) { (camera as THREE.PerspectiveCamera).aspect = _W / _H; camera.updateProjectionMatrix(); }
    };
    window.addEventListener('resize', _onResizeHandler);
    // === END POLISH ===
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x110a22, 2));
    const topLight = new THREE.PointLight(0xa78bfa, 4, 25);
    topLight.position.set(0, 8, 0);
    topLight.castShadow = true;
    scene.add(topLight);
    const sideLight = new THREE.PointLight(0x4ade80, 1, 15);
    sideLight.position.set(3, 5, 3);
    scene.add(sideLight);

    // Stars
    const starPos = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 50; starPos[i * 3 + 1] = 15 + Math.random() * 20; starPos[i * 3 + 2] = (Math.random() - 0.5) * 50;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.08 })));

    // Maze group
    const mazeGroup = new THREE.Group();
    scene.add(mazeGroup);
    s.mazeGroup = mazeGroup;

    const maze = generateMaze(GRID);
    s.maze = maze;
    buildMaze3D(scene, mazeGroup, maze);

    // Ball
    const ballGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xa78bfa, roughness: 0.3, metalness: 0.5, emissive: 0xa78bfa, emissiveIntensity: 0.6 });
    const ball = new THREE.Mesh(ballGeo, ballMat);
    ball.castShadow = true;
    scene.add(ball);
    s.ballMesh = ball;

    // Ball light
    const ballLight = new THREE.PointLight(0xa78bfa, 2, 4);
    ball.add(ballLight);

    // Tilt controls
    const tiltCtrl = createTiltController((x, z) => { s.tiltX = x; s.tiltZ = z ?? 0; }, { sensitivity: 1.2, clamp: 20 });
    tiltCtrl.start();
    tiltCtrlRef.current = tiltCtrl;

    // Touch fallback
    const onMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 20;
      const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 20;
      if (!tiltCtrl || !s.running) { s.tiltX = nx; s.tiltZ = ny; }
    };
    renderer.domElement.addEventListener('pointermove', onMove);

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 5) sfx.tick();
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const BALL_SPEED = 0.025, FRICTION = 0.85, BALL_R = 0.3;
    const MAZE_MIN = -(GRID / 2) * CELL_SIZE, MAZE_MAX = (GRID / 2) * CELL_SIZE;

    const checkWallCollision = (nx: number, nz: number): boolean => {
      const col = Math.floor((nx - MAZE_MIN) / CELL_SIZE);
      const row = Math.floor((nz - MAZE_MIN) / CELL_SIZE);
      if (col < 0 || col >= GRID || row < 0 || row >= GRID) return true;
      const cell = s.maze[row][col];
      const cx = MAZE_MIN + col * CELL_SIZE + CELL_SIZE / 2;
      const cz = MAZE_MIN + row * CELL_SIZE + CELL_SIZE / 2;
      if (nx - cx < -CELL_SIZE / 2 + BALL_R && cell.left) return true;
      if (nx - cx > CELL_SIZE / 2 - BALL_R && cell.right) return true;
      if (nz - cz < -CELL_SIZE / 2 + BALL_R && cell.top) return true;
      if (nz - cz > CELL_SIZE / 2 - BALL_R && cell.bottom) return true;
      return false;
    };

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      s.ballVX += s.tiltX * BALL_SPEED;
      s.ballVZ += s.tiltZ * BALL_SPEED;
      s.ballVX *= FRICTION; s.ballVZ *= FRICTION;
      s.ballVX = Math.max(-0.15, Math.min(0.15, s.ballVX));
      s.ballVZ = Math.max(-0.15, Math.min(0.15, s.ballVZ));

      let nx = s.ballX + s.ballVX;
      let nz = s.ballZ + s.ballVZ;

      // Wall collision
      if (checkWallCollision(nx, s.ballZ)) { s.ballVX = -s.ballVX * 0.3; nx = s.ballX; s.sig.wallBumps++; hapticImpact(); sfx.collision(); }
      if (checkWallCollision(s.ballX, nz)) { s.ballVZ = -s.ballVZ * 0.3; nz = s.ballZ; s.sig.wallBumps++; hapticImpact(); sfx.collision(); }

      s.ballX = Math.max(MAZE_MIN + BALL_R, Math.min(MAZE_MAX - BALL_R, nx));
      s.ballZ = Math.max(MAZE_MIN + BALL_R, Math.min(MAZE_MAX - BALL_R, nz));

      if (ball) {
        ball.position.set(s.ballX, 0.3, s.ballZ);
        ball.rotation.x += s.ballVZ * 2;
        ball.rotation.z -= s.ballVX * 2;
      }

      // Exit check
      const exitX = (GRID - 1 - GRID / 2 + 0.5) * CELL_SIZE;
      const exitZ = (GRID - 1 - GRID / 2 + 0.5) * CELL_SIZE;
      if (Math.hypot(s.ballX - exitX, s.ballZ - exitZ) < CELL_SIZE * 0.5) {
        const elapsed = (Date.now() - s.mazeStartTime) / 1000;
        s.sig.mazesSolved++; s.sig.totalTime += elapsed;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const pts = Math.max(1, Math.round(10 - elapsed));
        s.sig.score += pts; setScoreDisplay(s.sig.score);
        sfx.success(); hapticVictory();
        // New maze
        const newMaze = generateMaze(GRID);
        s.maze = newMaze;
        buildMaze3D(scene, mazeGroup, newMaze);
        s.ballX = -(GRID / 2 - 0.5) * CELL_SIZE;
        s.ballZ = -(GRID / 2 - 0.5) * CELL_SIZE;
        s.ballVX = 0; s.ballVZ = 0;
        s.mazeStartTime = Date.now();
      }

      // Exit pulse
      if (s.exitMesh) {
        s.exitMesh.rotation.y += 0.04;
        (s.exitMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + Math.sin(s.frame * 0.08) * 0.3;
      }

      topLight.intensity = 4 + Math.sin(s.frame * 0.05) * 0.5;

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, buildMaze3D]);

  useEffect(() => () => {
    const s = stateRef.current; s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (stopMusicRef.current) stopMusicRef.current();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    tiltCtrlRef.current?.stop();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    if (stateRef.current.renderer) { stateRef.current.renderer.dispose(); stateRef.current.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    tiltCtrlRef.current?.stop();
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start Tilting!" accentColor={accent} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
      {phase === 'done' && finalSig && <>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Mazes Solved', value: String(finalSig.mazesSolved), color: '#4ade80' }, { label: 'Avg Time', value: finalSig.avgMazeTime > 0 ? `${finalSig.avgMazeTime.toFixed(1)}s` : '—', color: accent }, { label: 'Wall Bumps', value: String(finalSig.wallBumps), color: finalSig.wallBumps === 0 ? '#4ade80' : '#ef4444' }, { label: 'Score', value: String(finalSig.score), color: 'var(--color-text)' }]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.mazesSolved >= 2} />
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      </>}
    </GameShell>
  );
}
