'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, increaseMusicTempo } from '@/lib/audio';
import { playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { createTiltController } from '@/lib/tilt';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import PlayerNameInput from '@/components/PlayerNameInput';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY_ACCENT = CATEGORY_THEMES.sports.primaryAccent;

const GAME_ID = 'tunnel';
const PB_KEY  = 'pb_tunnel';

type GameState = 'start' | 'countdown' | 'playing' | 'done';
type ObstacleType = 'ring' | 'cross' | 'blade' | 'asteroid';

interface ObstacleInfo {
  type: ObstacleType;
  group: THREE.Group;
}

interface BehaviorData { collisions: number; avgTiltMagnitude: number; distance: number; nearMisses: number; }

function getProfile(b: BehaviorData) {
  if (b.collisions === 0 && b.avgTiltMagnitude < 0.3) return 'Precise 🎯';
  if (b.avgTiltMagnitude > 0.7) return 'Aggressive 🔥';
  return 'Zen Pilot 🧊';
}

// ─── Gap fraction based on elapsed time ───────────────────────────────────────
function getGapFraction(timeLeft: number): number {
  const elapsed = 60 - timeLeft;
  if (elapsed < 20) return 0.55;
  if (elapsed < 35) return 0.50;
  if (elapsed < 50) return 0.45;
  return 0.40;
}

// ─── Obstacle type selection by phase ─────────────────────────────────────────
function pickObstacleType(timeLeft: number): ObstacleType {
  const elapsed = 60 - timeLeft;
  if (elapsed < 20) return 'ring';
  if (elapsed < 35) return Math.random() < 0.55 ? 'ring' : 'cross';
  const r = Math.random();
  if (elapsed < 50) {
    if (r < 0.35) return 'ring';
    if (r < 0.60) return 'cross';
    if (r < 0.82) return 'blade';
    return 'asteroid';
  }
  // 50-60s: max chaos
  if (r < 0.25) return 'ring';
  if (r < 0.50) return 'cross';
  if (r < 0.75) return 'blade';
  return 'asteroid';
}

// ─── Obstacle factory ─────────────────────────────────────────────────────────
function createObstacle(scene: THREE.Scene, z: number, type: ObstacleType, gapFraction: number): THREE.Group {
  const group = new THREE.Group();

  if (type === 'ring') {
    const gapAngle = Math.PI * 2 * gapFraction;
    const startAngle = Math.random() * Math.PI * 2;
    const segments = 12;
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const normAngle = ((angle - startAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      if (normAngle < gapAngle) continue;
      const arcLen = (Math.PI * 2 / segments) * 0.90;
      const geo = new THREE.TorusGeometry(3, 0.12, 6, 12, arcLen);
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0x00ffff : 0xa855f7,
        transparent: true, opacity: 0.95,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.z = angle + arcLen / 2;
      group.add(mesh);
    }
    group.userData.gapStart = startAngle;
    group.userData.gapEnd = startAngle + gapAngle;

  } else if (type === 'cross') {
    // Two bars forming + shape, leaving corner gaps
    const hGeo = new THREE.BoxGeometry(5.2, 0.55, 0.2);
    const hMat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
    group.add(new THREE.Mesh(hGeo, hMat));
    const vGeo = new THREE.BoxGeometry(0.55, 5.2, 0.2);
    const vMat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
    group.add(new THREE.Mesh(vGeo, vMat));
    // Glow edges
    const edgeGeo = new THREE.EdgesGeometry(hGeo);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xff8844 });
    group.add(new THREE.LineSegments(edgeGeo, edgeMat));

  } else if (type === 'blade') {
    // Spinning blade — flat rectangle
    const bladeGeo = new THREE.BoxGeometry(5.2, 0.35, 0.15);
    const bladeMat = new THREE.MeshBasicMaterial({ color: 0xff1100 });
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    group.add(blade);
    // Glow edge
    const edgeGeo = new THREE.EdgesGeometry(bladeGeo);
    group.add(new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0xff6600 })));
    group.userData.rotAngle = Math.random() * Math.PI * 2;

  } else if (type === 'asteroid') {
    const count = 5 + Math.floor(Math.random() * 4);
    const asteroids: { vx: number; vy: number; r: number }[] = [];
    for (let i = 0; i < count; i++) {
      const r = 0.18 + Math.random() * 0.22;
      const geo = new THREE.SphereGeometry(r, 6, 5);
      const mat = new THREE.MeshBasicMaterial({ color: 0x997755 });
      const mesh = new THREE.Mesh(geo, mat);
      const angle = Math.random() * Math.PI * 2;
      const dist = 0.5 + Math.random() * 1.9;
      mesh.position.x = Math.cos(angle) * dist;
      mesh.position.y = Math.sin(angle) * dist;
      group.add(mesh);
      asteroids.push({ vx: (Math.random() - 0.5) * 0.014, vy: (Math.random() - 0.5) * 0.014, r });
    }
    group.userData.asteroids = asteroids;
  }

  group.userData.type = type;
  group.position.z = z;
  scene.add(group);
  return group;
}

// ─── Per-frame obstacle update (blades spin, asteroids drift) ─────────────────
function updateObstacle(obstacle: ObstacleInfo, speed: number): void {
  const g = obstacle.group;
  if (obstacle.type === 'blade') {
    g.userData.rotAngle = (g.userData.rotAngle || 0) + 0.04 * (speed / 0.08);
    g.rotation.z = g.userData.rotAngle;
  } else if (obstacle.type === 'asteroid') {
    const asteroids = g.userData.asteroids as { vx: number; vy: number; r: number }[];
    g.children.forEach((child, i) => {
      const a = asteroids[i]; if (!a) return;
      child.position.x += a.vx;
      child.position.y += a.vy;
      const d = Math.sqrt(child.position.x ** 2 + child.position.y ** 2);
      if (d > 2.6) {
        const nx = child.position.x / d, ny = child.position.y / d;
        const dot = a.vx * nx + a.vy * ny;
        a.vx -= 2 * dot * nx;
        a.vy -= 2 * dot * ny;
      }
    });
  }
}

// ─── Collision detection per type ─────────────────────────────────────────────
function checkObstacleCollision(
  px: number, py: number, pz: number,
  obstacle: ObstacleInfo
): boolean {
  const g = obstacle.group;
  const dz = Math.abs(pz - g.position.z);

  if (obstacle.type === 'ring') {
    if (dz > 0.7) return false;
    const dist = Math.sqrt(px ** 2 + py ** 2);
    if (dist > 2.65) {
      const norm = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const camAngle = Math.atan2(py, px);
      const gs = norm(g.userData.gapStart);
      const ge = norm(g.userData.gapEnd);
      const ca = norm(camAngle);
      const inGap = gs < ge ? (ca >= gs && ca <= ge) : (ca >= gs || ca <= ge);
      if (!inGap) return true;
    }
  } else if (obstacle.type === 'cross') {
    if (dz > 0.5) return false;
    const H_LEN = 2.6, H_THICK = 0.28;
    const V_LEN = 2.6, V_THICK = 0.28;
    const inH = Math.abs(py) < H_THICK && Math.abs(px) < H_LEN;
    const inV = Math.abs(px) < V_THICK && Math.abs(py) < V_LEN;
    if (inH || inV) return true;
  } else if (obstacle.type === 'blade') {
    if (dz > 0.4) return false;
    const angle = g.userData.rotAngle || 0;
    const cos = Math.cos(-angle), sin = Math.sin(-angle);
    const lx = cos * px - sin * py;
    const ly = sin * px + cos * py;
    if (Math.abs(lx) < 2.6 && Math.abs(ly) < 0.22) return true;
  } else if (obstacle.type === 'asteroid') {
    if (dz > 1.0) return false;
    const asteroids = g.userData.asteroids as { r: number }[];
    g.children.forEach((child, i) => {
      const a = asteroids[i]; if (!a) return;
      const dx = px - child.position.x, dy = py - child.position.y;
      if (Math.sqrt(dx * dx + dy * dy) < a.r + 0.18) {
        // Mark collision via group userData
        g.userData._collision = true;
      }
    });
    if (g.userData._collision) {
      g.userData._collision = false;
      return true;
    }
  }
  return false;
}

// ─── Near-miss check ──────────────────────────────────────────────────────────
function checkNearMiss(px: number, py: number, pz: number, obstacle: ObstacleInfo): boolean {
  const g = obstacle.group;
  const dz = Math.abs(pz - g.position.z);
  if (obstacle.type === 'ring' && dz < 0.7) {
    const dist = Math.sqrt(px ** 2 + py ** 2);
    return dist > 2.0 && dist < 2.65;
  }
  return false;
}

export default function TunnelGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const tiltControllerRef = useRef<ReturnType<typeof createTiltController> | null>(null);
  const nearMissFlashRef = useRef<HTMLDivElement>(null);
  const speedBurstRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    animId: 0, running: false,
    speed: 0.08, distance: 0,
    collisions: 0, tiltMagnitudes: [] as number[],
    timeLeft: 60, intervalId: null as ReturnType<typeof setInterval> | null,
    obstacles: [] as ObstacleInfo[],
    invincibleFrames: 0,
    joystickX: 0, joystickY: 0,
    nearMissLastTime: 0,
    nearMissCount: 0,
    // Player trail
    trailPositions: [] as { x: number; y: number; z: number }[],
    trailMeshes: [] as THREE.Mesh[],
    survivedTime: 0,
  });
  const [gameState, setGameState] = useState<GameState>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft] = useState(60);
  const [behavior, setBehavior] = useState<BehaviorData | null>(null);
  const [joystickEnabled, setJoystickEnabled] = useState(false);
  const [joystickThumb, setJoystickThumb] = useState({ x: 0, y: 0 });
  const [survivedDisplay, setSurvivedDisplay] = useState(0);
  const [playerName, setPlayerName]   = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const { pops, triggerPop } = useScorePop();
  const prevScoreRef = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const numScore = typeof survivedDisplay === 'number' ? survivedDisplay : 0;
    if (numScore > prevScoreRef.current) {
      triggerPop(`+${numScore - prevScoreRef.current}`, window.innerWidth / 2, 200);
    }
    prevScoreRef.current = numScore;
  }, [survivedDisplay]); // triggerPop is stable
  const playerSessionRef              = useRef<PlayerSession | null>(null);
  const [scorePop, setScorePop]       = useState<string | null>(null);
  const [nearMissVisible, setNearMissVisible] = useState(false);
  const [isNewBest, setIsNewBest]     = useState(false);
  const nearMissUITimeoutRef          = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMilestoneRef              = useRef(0);

  const endGame = useCallback((capturedTheme: typeof theme) => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    tiltControllerRef.current?.stop();
    // End-game sound — survival is always a win (timer always ends the game)
    sfx.success(); hapticVictory(); playVictoryFanfare();
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    // Dispose Three.js scene objects (geometries + materials) to prevent GPU memory leaks
    // across play-again cycles. renderer.dispose() alone does NOT free scene GPU resources.
    if (s.scene) {
      s.scene.traverse((obj: THREE.Object3D) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach(m => m.dispose()); else mat.dispose();
        }
      });
      s.scene = null;
    }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    const handler = (s as typeof s & { _resizeHandler?: () => void })._resizeHandler;
    if (handler) { window.removeEventListener('resize', handler); (s as typeof s & { _resizeHandler?: () => void })._resizeHandler = undefined; }
    const avgTilt = s.tiltMagnitudes.length > 0 ? s.tiltMagnitudes.reduce((a, b) => a + b, 0) / s.tiltMagnitudes.length : 0;
    const bData: BehaviorData = { collisions: s.collisions, avgTiltMagnitude: Math.round(avgTilt * 100) / 100, distance: Math.round(s.distance), nearMisses: s.nearMissCount };
    // Personal best tracking
    try {
      const prev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (bData.distance > prev) {
        localStorage.setItem(PB_KEY, String(bData.distance));
        setIsNewBest(true);
      }
    } catch { /* ignore */ }
    setBehavior(bData);
    setGameState('done');
    postWebhook(capturedTheme, 'tunnel', { score: `${Math.round(s.distance)}m`, personality: getProfile(bData), signals: { collisions: bData.collisions, avgTiltMagnitude: bData.avgTiltMagnitude, distance: bData.distance, nearMisses: bData.nearMisses } }, playerSessionRef.current);
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.collisions = 0; s.tiltMagnitudes = []; s.distance = 0; s.speed = 0.08;
    s.timeLeft = 60; s.obstacles = []; s.running = true;
    s.invincibleFrames = 0; s.joystickX = 0; s.joystickY = 0;
    s.nearMissCount = 0;
    s.trailPositions = []; s.survivedTime = 0;
    setTimeLeft(60); setGameState('playing'); setSurvivedDisplay(0);
    setScorePop(null); setNearMissVisible(false); setIsNewBest(false);
    lastMilestoneRef.current = 0;
    stopMusicRef.current = startMusic('drive');
    const capturedTheme = theme;

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0d1520);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1520);
    scene.fog = new THREE.FogExp2(0x0d1520, 0.018);

    const camera = new THREE.PerspectiveCamera(75, W / H, 0.1, 100);
    camera.position.set(0, 0, 0);

    // ── Tunnel tube ────────────────────────────────────────────────────────────
    const tubePoints = Array.from({ length: 40 }, (_, i) => new THREE.Vector3(0, 0, -i * 5));
    const curve = new THREE.CatmullRomCurve3(tubePoints);
    const tubeGeo = new THREE.TubeGeometry(curve, 200, 3.5, 8, false);
    const tubeMat = new THREE.MeshBasicMaterial({ color: 0x0d1520, side: THREE.BackSide });
    scene.add(new THREE.Mesh(tubeGeo, tubeMat));

    // ── Neon grid: longitudinal strips ────────────────────────────────────────
    const STRIP_COUNT = 10;
    for (let i = 0; i < STRIP_COUNT; i++) {
      const angle = (i / STRIP_COUNT) * Math.PI * 2;
      const pts = Array.from({ length: 40 }, (_, j) =>
        new THREE.Vector3(Math.cos(angle) * 3.42, Math.sin(angle) * 3.42, -j * 5)
      );
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const col = i % 2 === 0 ? 0x003366 : 0x110033;
      const mat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.45 });
      scene.add(new THREE.Line(geo, mat));
    }

    // ── Neon grid: circular cross-section rings ────────────────────────────────
    const GRID_RING_SPACING = 15;
    const GRID_RING_COUNT = 14;
    for (let k = 0; k < GRID_RING_COUNT; k++) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * 3.42, Math.sin(a) * 3.42, -k * GRID_RING_SPACING));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color: 0x002244, transparent: true, opacity: 0.35 });
      scene.add(new THREE.Line(geo, mat));
    }

    // ── Static speed lines ─────────────────────────────────────────────────────
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 2.8 + Math.random() * 0.5;
      const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
      const zStart = -5 - Math.random() * 190;
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, y, zStart),
        new THREE.Vector3(x, y, zStart - 2.5),
      ]);
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08 + Math.random() * 0.12 });
      scene.add(new THREE.Line(geo, mat));
    }

    // ── Player trail meshes (5 small spheres) ─────────────────────────────────
    s.trailMeshes = [];
    for (let i = 0; i < 5; i++) {
      const r = 0.07 - i * 0.012;
      const tGeo = new THREE.SphereGeometry(Math.max(0.02, r), 5, 4);
      const tMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: (5 - i) / 5 * 0.6,
      });
      const mesh = new THREE.Mesh(tGeo, tMat);
      mesh.visible = false;
      scene.add(mesh);
      s.trailMeshes.push(mesh);
    }

    // ── Initial obstacles ──────────────────────────────────────────────────────
    for (let i = 0; i < 12; i++) {
      const z = -10 - i * 8;
      const type = pickObstacleType(60); // all rings at start
      const gap = getGapFraction(60);
      s.obstacles.push({ type, group: createObstacle(scene, z, type, gap) });
    }

    s.renderer = renderer;
    s.scene = scene;
    s.camera = camera;

    // ── Resize handler ─────────────────────────────────────────────────────────
    const handleResize = () => {
      if (!s.renderer || !s.camera) return;
      const w = window.innerWidth, h = window.innerHeight;
      s.renderer.setSize(w, h);
      (s.camera as THREE.PerspectiveCamera).aspect = w / h;
      (s.camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    (s as typeof s & { _resizeHandler?: () => void })._resizeHandler = handleResize;

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--;
      s.survivedTime = 60 - s.timeLeft;
      const survived = 60 - s.timeLeft;
      setSurvivedDisplay(survived);
      setTimeLeft(s.timeLeft);
      // Score pop on 10s milestones
      if (survived > 0 && survived % 10 === 0 && survived !== lastMilestoneRef.current) {
        lastMilestoneRef.current = survived;
        hapticScore();
        playScoreHit('default', survived);
        setScorePop(`⚡ ${survived}s`);
        setTimeout(() => setScorePop(null), 1500);
      }
      // Near-miss alert: within last 5s of a milestone
      const nextMilestone = Math.ceil(survived / 10) * 10;
      if (nextMilestone - survived === 1 && survived > 0 && survived !== lastMilestoneRef.current) {
        playNearMiss();
        setNearMissVisible(true);
        if (nearMissUITimeoutRef.current) clearTimeout(nearMissUITimeoutRef.current);
        nearMissUITimeoutRef.current = setTimeout(() => setNearMissVisible(false), 1500);
      }
      s.speed = Math.min(0.26, s.speed + 0.003);
      if (s.timeLeft === 30) {
        increaseMusicTempo(162);
        // Speed burst visual — DOM ref safe from setInterval
        if (speedBurstRef.current) {
          speedBurstRef.current.style.opacity = '1';
          setTimeout(() => { if (speedBurstRef.current) speedBurstRef.current.style.opacity = '0'; }, 900);
        }
      }
      // Tick sound every second; warning when ≤10s
      if (s.timeLeft <= 10 && s.timeLeft > 0) {
        sfx.warning();
      } else if (s.timeLeft > 10) {
        sfx.tick();
      }
      if (s.timeLeft <= 0) endGame(capturedTheme);
    }, 1000);

    const loop = () => {
      if (!s.running) return;

      // ── Tilt input ───────────────────────────────────────────────────────────
      const tilt = tiltControllerRef.current?.getValues() ?? { x: 0, y: 0 };
      const inputX = tilt.x + s.joystickX;
      const inputY = tilt.y + s.joystickY;

      // Very snappy direct position mapping — clamp to tunnel safe radius ±2.4
      const targetX = Math.max(-2.4, Math.min(2.4, inputX * 2.5));
      const targetY = Math.max(-2.4, Math.min(2.4, inputY * 2.5));
      camera.position.x += (targetX - camera.position.x) * 0.22;
      camera.position.y += (targetY - camera.position.y) * 0.22;

      const mag = Math.sqrt(inputX * inputX + inputY * inputY);
      s.tiltMagnitudes.push(mag);

      camera.position.z -= s.speed;
      s.distance += s.speed;

      // ── Player trail ─────────────────────────────────────────────────────────
      s.trailPositions.push({ x: camera.position.x, y: camera.position.y, z: camera.position.z });
      if (s.trailPositions.length > 5) s.trailPositions.shift();
      s.trailMeshes.forEach((mesh, i) => {
        const idx = s.trailPositions.length - 1 - i;
        if (idx >= 0) {
          const p = s.trailPositions[idx];
          mesh.position.set(p.x, p.y, p.z + 0.3); // slightly ahead of position
          mesh.visible = true;
        } else {
          mesh.visible = false;
        }
      });

      // ── Obstacle update & collision ───────────────────────────────────────────
      s.obstacles.forEach((obs) => {
        const g = obs.group;

        // Speed blur: stretch ring/cross in Z as speed increases
        if (obs.type === 'ring' || obs.type === 'cross') {
          g.scale.z = 1 + (s.speed - 0.08) * 4;
        }

        // Update blade/asteroid dynamics
        updateObstacle(obs, s.speed);

        // Recycle obstacle when it passes the camera
        if (g.position.z > camera.position.z + 6) {
          // Remove old geometry from scene, create fresh obstacle
          scene.remove(g);
          g.children.forEach(child => {
            if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
            if ((child as THREE.Mesh).material) {
              const mat = (child as THREE.Mesh).material;
              if (Array.isArray(mat)) mat.forEach(m => m.dispose()); else mat.dispose();
            }
          });
          const newZ = camera.position.z - 88 - Math.random() * 10;
          const newType = pickObstacleType(s.timeLeft);
          const newGap = getGapFraction(s.timeLeft);
          const newGroup = createObstacle(scene, newZ, newType, newGap);
          obs.type = newType;
          obs.group = newGroup;
          return;
        }

        // Collision check (skip if invincible)
        if (s.invincibleFrames > 0) { s.invincibleFrames--; return; }

        if (checkObstacleCollision(camera.position.x, camera.position.y, camera.position.z, obs)) {
          s.collisions++;
          s.invincibleFrames = 60;
          sfx.collision(); hapticFail();
          // Flash scene red
          if (scene) {
            scene.background = new THREE.Color(0xff0000);
            setTimeout(() => { if (scene) scene.background = new THREE.Color(0x0d1520); }, 100);
          }
        } else if (checkNearMiss(camera.position.x, camera.position.y, camera.position.z, obs)) {
          const now = Date.now();
          if (now - s.nearMissLastTime > 800) {
            sfx.nearMiss(); s.nearMissLastTime = now;
            s.nearMissCount++;
            // Brief cyan edge-glow flash — DOM ref to avoid setState in rAF
            if (nearMissFlashRef.current) {
              nearMissFlashRef.current.style.opacity = '1';
              setTimeout(() => { if (nearMissFlashRef.current) nearMissFlashRef.current.style.opacity = '0'; }, 350);
            }
          }
        }
      });

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, theme]);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); sfx.click();
    // Max sensitivity: very twitchy and responsive
    const controller = createTiltController(() => {}, { sensitivity: 1.6, smoothing: 0.3, deadzone: 1, clamp: 15 });
    tiltControllerRef.current = controller;
    const success = await controller.start();
    if (!success) {
      setJoystickEnabled(true);
    } else {
      let got = false;
      const check = () => { got = true; };
      window.addEventListener('deviceorientation', check, { once: true });
      setTimeout(() => {
        window.removeEventListener('deviceorientation', check);
        if (!got) setJoystickEnabled(true);
      }, 1500);
    }
    setGameState('countdown');
  }, []);

  const handlePlayAgain = useCallback(() => {
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    tiltControllerRef.current?.stop();
    tiltControllerRef.current = null;
    setJoystickEnabled(false);
    setJoystickThumb({ x: 0, y: 0 });
    setGameState('start');
  
    prevScoreRef.current = 0;
  }, []);

  const handleJoystickTouch = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = touch.clientX - cx;
    const dy = touch.clientY - cy;
    const MAX_RADIUS = 60;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const nx = dist > 0 ? (dx / dist) * Math.min(1, dist / MAX_RADIUS) : 0;
    const ny = dist > 0 ? (dy / dist) * Math.min(1, dist / MAX_RADIUS) : 0;
    stateRef.current.joystickX = nx;
    stateRef.current.joystickY = ny;
    const clampedDist = Math.min(dist, MAX_RADIUS);
    setJoystickThumb({ x: dist > 0 ? (dx / dist) * clampedDist : 0, y: dist > 0 ? (dy / dist) * clampedDist : 0 });
  }, []);

  const handleJoystickEnd = useCallback(() => {
    stateRef.current.joystickX = 0;
    stateRef.current.joystickY = 0;
    setJoystickThumb({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const s = stateRef.current;
    return () => {
      s.running = false; cancelAnimationFrame(s.animId);
      if (s.intervalId) clearInterval(s.intervalId);
      tiltControllerRef.current?.stop();
      if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
      if (stopMusicRef.current) stopMusicRef.current();
      const handler = (s as typeof s & { _resizeHandler?: () => void })._resizeHandler;
      if (handler) window.removeEventListener('resize', handler);
    };
  }, []);

  const accent = theme.colors.accent ?? '#00ffff';

  return (
    <>
      {gameState === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="tunnel"
          steps={[{ icon: "📱", title: "Tilt to steer", body: "Tilt your phone left or right to steer through the tunnel." }, { icon: "⚡", title: "Dodge obstacles", body: "Rings, crosses, blades — stay in the gaps to fly farther." }, { icon: "🔥", title: "Go further", body: "The tunnel speeds up — how far can you fly?" }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title="Infinite Tunnel" emoji="🚀" accentColor={accent} theme={theme}>
      <div ref={mountRef} style={{ width: '100%', height: '100%', display: gameState === 'playing' ? 'block' : 'none', position: 'relative', zIndex: 1, touchAction: 'none' }} />

      {/* Near-miss edge glow — appears via DOM ref, fades out */}
      <div ref={nearMissFlashRef} style={{ position: 'fixed', inset: 0, boxShadow: `inset 0 0 70px ${accent}`, pointerEvents: 'none', zIndex: 5, opacity: 0, transition: 'opacity 0.35s ease-out' }} />

      {/* Speed burst announcement at 30s */}
      <div ref={speedBurstRef} style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 15, opacity: 0, transition: 'opacity 0.15s ease-in, opacity 0.6s ease-out 0.3s' }}>
        <div style={{ color: accent, fontSize: 20, fontWeight: 900, letterSpacing: '0.25em', textTransform: 'uppercase', textShadow: `0 0 24px ${accent}` }}>CRITICAL SPEED</div>
      </div>

      {gameState === 'playing' && (
        <GameHUD
          items={[
            { label: 'SURVIVED', value: `${survivedDisplay}s` },
            { label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 10 },
          ]}
          accentColor={accent}
        />
      )}

      {/* Joystick overlay */}
      {joystickEnabled && gameState === 'playing' && (
        <div
          style={{
            position: 'fixed', bottom: 40, left: '50%', transform: 'translateX(-50%)',
            width: 140, height: 140, borderRadius: '50%',
            border: `3px solid ${accent}4d`,
            backgroundColor: `${accent}0f`,
            zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
            touchAction: 'none',
          }}
          onTouchStart={handleJoystickTouch}
          onTouchMove={handleJoystickTouch}
          onTouchEnd={handleJoystickEnd}
        >
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            backgroundColor: `${accent}26`,
            border: `2px solid ${accent}80`,
            transform: `translate(${joystickThumb.x}px, ${joystickThumb.y}px)`,
            transition: joystickThumb.x === 0 && joystickThumb.y === 0 ? 'transform 0.15s ease' : 'none',
            pointerEvents: 'none',
          }} />
        </div>
      )}

      {/* Score pop overlay */}
      {scorePop && (
        <div style={{
          position: 'fixed', top: '30%', left: '50%', transform: 'translateX(-50%)',
          zIndex: 80, pointerEvents: 'none',
          animation: 'tunnelScorePop 1.5s ease-out forwards',
          fontSize: 44, fontWeight: 900, color: accent,
          textShadow: `0 0 20px ${accent}88`,
          whiteSpace: 'nowrap',
        }}>
          {scorePop}
        </div>
      )}

      {/* Near-miss message */}
      <AnimatePresence>
        {nearMissVisible && (
          <motion.div
            key="near-miss"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            style={{
              position: 'fixed', top: '22%', left: '50%', transform: 'translateX(-50%)',
              zIndex: 80, pointerEvents: 'none',
              fontSize: 22, fontWeight: 800, color: '#fbbf24',
              textShadow: '0 0 12px #fbbf2488',
              whiteSpace: 'nowrap',
            }}
          >
            So close! 🎯
          </motion.div>
        )}
      </AnimatePresence>

      {/* New best banner */}
      <AnimatePresence>
        {isNewBest && gameState === 'done' && (
          <motion.div
            key="new-best"
            initial={{ opacity: 0, y: -20, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, delay: 0.5 }}
            style={{
              position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)',
              zIndex: 90, pointerEvents: 'none',
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
              borderRadius: 20,
              padding: '8px 20px',
              fontSize: 20,
              fontWeight: 900,
              color: '#000',
              whiteSpace: 'nowrap',
              boxShadow: '0 4px 20px rgba(251,191,36,0.5)',
            }}
          >
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {gameState === 'countdown' && (
          <motion.div key="countdown" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Countdown onComplete={startLoop} accentColor={accent} />
          </motion.div>
        )}
        {gameState === 'start' && (
          <motion.div key="start" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ height: '100%' }}>
            <GameStartScreen
              emoji="🚀"
              title="Infinite Tunnel"
              description="Tilt to steer. Dodge rings, crosses, blades and asteroid fields. Survive 60 seconds."
              sensorNote="Uses motion sensors"
              ctaLabel="Enable Motion & Launch →"
              accentColor={accent}
              ctaTextColor="#000"
              onStart={handleStart}
            />
          </motion.div>
        )}
        {gameState === 'done' && behavior && (
          <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ height: '100%' }}>
            <EndScreen
              gameId={GAME_ID}
              title={getProfile(behavior)}
              emoji="🚀"
              score={`${behavior.distance}m`}
              personality={getProfile(behavior)}
              insights={[
                { label: 'Distance', value: `${behavior.distance}m`, color: accent },
                { label: 'Collisions', value: behavior.collisions === 0 ? '0 — flawless!' : `${behavior.collisions} hit${behavior.collisions > 1 ? 's' : ''}`, color: behavior.collisions > 5 ? '#ef4444' : '#00ff88' },
                { label: 'Control Style', value: behavior.avgTiltMagnitude > 0.7 ? 'Aggressive' : behavior.avgTiltMagnitude < 0.3 ? 'Surgical' : 'Balanced', color: accent },
                { label: 'Near Misses', value: behavior.nearMisses === 0 ? '0 — wide clearance' : `${behavior.nearMisses} — edge hugger`, color: behavior.nearMisses > 4 ? '#facc15' : '#a855f7' },
              ]}
              accentColor={accent}
              onPlayAgain={handlePlayAgain}
              didWin={behavior.collisions === 0}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes tunnelScorePop {
          0%   { opacity: 0; transform: translateX(-50%) scale(0.6); }
          15%  { opacity: 1; transform: translateX(-50%) scale(1.5); }
          60%  { opacity: 1; transform: translateX(-50%) scale(1.2); }
          100% { opacity: 0; transform: translateX(-50%) scale(0.9) translateY(-40px); }
        }
      `}</style>
      {gameState === 'playing' && (
        <>
          <ScorePopEffect pops={pops} accentColor={CATEGORY_ACCENT} />
        </>
      )}
    </GameShell>
    </>
  );
}
