'use client';
/**
 * LASER GUIDE — 3D laser beams bouncing through space with draggable mirrors.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'laser-guide';
const ACCENT = '#dc2626';
const DURATION = 45;
const GAME_EMOJI = '🔴';
const GAME_TITLE = 'Laser Guide';
const GAME_TAGLINE = 'Reflect the beam. Hit the target.';

interface MirrorObj { mesh: THREE.Mesh; id: number; angle: number; }
interface Signals { puzzlesSolved: number; movesUsed: number; perfectSolves: number; maxStreak: number; streakCurrent: number; score: number; }

function getPersonality(sig: Signals): string {
  if (sig.perfectSolves >= 3 && sig.maxStreak >= 3) return 'Laser Wizard 🔴';
  if (sig.puzzlesSolved >= 5) return 'Optics Expert 🔬';
  if (sig.maxStreak >= 3) return 'Reflective Thinker 🪞';
  if (sig.puzzlesSolved >= 2) return 'Getting in Focus 🎯';
  return 'Learning to Reflect 💡';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function reflectDir(dx: number, dy: number, angle: number): [number, number] {
  const nx = Math.cos(angle + Math.PI / 2), ny = Math.sin(angle + Math.PI / 2);
  const dot = dx * nx + dy * ny;
  return [dx - 2 * dot * nx, dy - 2 * dot * ny];
}

export default function LaserGuideGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { puzzlesSolved: 0, movesUsed: 0, perfectSolves: 0, maxStreak: 0, streakCurrent: 0, score: 0 } as Signals,
    mirrors: [] as MirrorObj[],
    laserPoints: [] as THREE.Vector3[],
    laserLine: null as THREE.Line | null,
    targetMesh: null as THREE.Mesh | null,
    sourceMesh: null as THREE.Mesh | null,
    sourcePos: new THREE.Vector3(-6, 0, 0),
    sourceDir: new THREE.Vector2(1, 0.3).normalize(),
    targetPos: new THREE.Vector3(6, 2, 0),
    hitTarget: false, movesThisRound: 0,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    renderer: null as THREE.WebGLRenderer | null,
    raycaster: new THREE.Raycaster(),
    dragging: null as { id: number; offX: number; offY: number } | null,
    pendingPointer: null as { x: number; y: number; type: 'down' | 'move' | 'up' } | null,
    hitFlash: 0, frame: 0,
    scorePop: 0,
    levelNum: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const generateLevel = useCallback((scene: THREE.Scene, levelNum: number) => {
    const s = stateRef.current;
    // Remove old mirrors
    s.mirrors.forEach(m => scene.remove(m.mesh));
    s.mirrors = [];

    const count = 2 + Math.min(levelNum, 3);
    for (let i = 0; i < count; i++) {
      const mirrorGeo = new THREE.BoxGeometry(2.5, 0.15, 0.15);
      const mirrorMat = new THREE.MeshPhongMaterial({ color: 0x38bdf8, emissive: 0x0c4a6e, shininess: 200 });
      const mirror = new THREE.Mesh(mirrorGeo, mirrorMat);
      const angle = Math.random() * Math.PI;
      mirror.rotation.z = angle;
      mirror.position.set(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 6,
        0,
      );
      scene.add(mirror);
      s.mirrors.push({ mesh: mirror, id: i, angle });
    }

    // New source/target positions
    s.sourcePos.set(-6 + Math.random() * 2, (Math.random() - 0.5) * 4, 0);
    s.targetPos.set(4 + Math.random() * 2, (Math.random() - 0.5) * 4, 0);
    s.sourceDir = new THREE.Vector2(1, (Math.random() - 0.5) * 0.8).normalize();
    s.hitTarget = false; s.movesThisRound = 0;

    if (s.sourceMesh) s.sourceMesh.position.copy(s.sourcePos);
    if (s.targetMesh) s.targetMesh.position.copy(s.targetPos);
  }, []);

  const startLoop = useCallback(() => {
    if (!mountRef.current) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { puzzlesSolved: 0, movesUsed: 0, perfectSolves: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.hitFlash = 0; s.frame = 0; s.levelNum = 0; s.dragging = null;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x030812);
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 200);
    camera.position.set(0, 0, 15);
    // === POLISH: Atmospheric particle field ===
    const _sfCount = 80;
    const _sfGeo = new THREE.BufferGeometry();
    const _sfPos = new Float32Array(_sfCount * 3);
    for (let _i = 0; _i < _sfCount; _i++) {
      _sfPos[_i*3] = (Math.random()-0.5)*20;
      _sfPos[_i*3+1] = (Math.random()-0.5)*15;
      _sfPos[_i*3+2] = (Math.random()-0.5)*8-3;
    }
    _sfGeo.setAttribute('position', new THREE.BufferAttribute(_sfPos, 3));
    scene.add(new THREE.Points(_sfGeo, new THREE.PointsMaterial({ color: 0xaaddff, size: 0.05, transparent: true, opacity: 0.4 })));
    // === END POLISH ===
    // === POLISH: Enhanced rim + fill lighting ===
    const rimLightA = new THREE.PointLight(0x4466ff, 1.2, 20);
    rimLightA.position.set(-6, 5, 3);
    scene.add(rimLightA);
    const fillLightB = new THREE.PointLight(0xff6644, 0.8, 15);
    fillLightB.position.set(6, -3, 5);
    scene.add(fillLightB);
    // === END POLISH ===
    s.camera = camera;

    // Lights
    scene.add(new THREE.AmbientLight(0x0a0a2a, 4));
    const redLight = new THREE.PointLight(0xef4444, 2, 20);
    redLight.position.set(0, 0, 8);
    scene.add(redLight);

    // Grid background
    const gridHelper = new THREE.GridHelper(30, 20, 0x1e1b4b, 0x0f0e2a);
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.z = -0.5;
    scene.add(gridHelper);

    // Source emitter
    const srcGeo = new THREE.SphereGeometry(0.4, 12, 12);
    const srcMat = new THREE.MeshPhongMaterial({ color: 0xef4444, emissive: 0x7f1d1d, shininess: 100 });
    const srcMesh = new THREE.Mesh(srcGeo, srcMat);
    scene.add(srcMesh);
    s.sourceMesh = srcMesh;

    // Target
    const tgtGeo = new THREE.TorusGeometry(0.7, 0.15, 8, 24);
    const tgtMat = new THREE.MeshPhongMaterial({ color: 0xdc2626, emissive: 0x7f1d1d });
    const tgtMesh = new THREE.Mesh(tgtGeo, tgtMat);
    scene.add(tgtMesh);
    s.targetMesh = tgtMesh;

    // Laser line
    const laserGeo = new THREE.BufferGeometry();
    laserGeo.setFromPoints([new THREE.Vector3(0, 0, 0)]);
    const laserMat = new THREE.LineBasicMaterial({ color: 0xff2222, linewidth: 2 });
    const laserLine = new THREE.Line(laserGeo, laserMat);
    scene.add(laserLine);
    s.laserLine = laserLine;

    generateLevel(scene, 0);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
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
      s.frame++;

      // Process pointer input
      if (s.pendingPointer) {
        const pp = s.pendingPointer;
        s.raycaster.setFromCamera(new THREE.Vector2(pp.x, pp.y), camera);

        if (pp.type === 'down') {
          const mirrorMeshes = s.mirrors.map(m => m.mesh);
          const hits = s.raycaster.intersectObjects(mirrorMeshes);
          if (hits.length > 0) {
            const hitMesh = hits[0].object as THREE.Mesh;
            const m = s.mirrors.find(m => m.mesh === hitMesh);
            if (m) {
              s.dragging = { id: m.id, offX: 0, offY: 0 };
              (hitMesh.material as THREE.MeshPhongMaterial).emissive.setHex(0x1e3a5f);
            }
          }
        } else if (pp.type === 'move' && s.dragging !== null) {
          const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
          const target = new THREE.Vector3();
          s.raycaster.ray.intersectPlane(plane, target);
          const m = s.mirrors.find(m => m.id === s.dragging!.id);
          if (m) {
            m.mesh.position.x = target.x;
            m.mesh.position.y = target.y;
            m.angle += 0.04;
            m.mesh.rotation.z = m.angle;
            s.sig.movesUsed++; s.movesThisRound++;
            s.hitTarget = false;
          }
        } else if (pp.type === 'up') {
          if (s.dragging) {
            const m = s.mirrors.find(m => m.id === s.dragging!.id);
            if (m) (m.mesh.material as THREE.MeshPhongMaterial).emissive.setHex(0x0c4a6e);
          }
          s.dragging = null;
        }
        s.pendingPointer = null;
      }

      // Cast laser ray
      const pts: THREE.Vector3[] = [s.sourcePos.clone()];
      let cx = s.sourcePos.x, cy = s.sourcePos.y;
      let dx = s.sourceDir.x, dy = s.sourceDir.y;

      for (let bounce = 0; bounce < 8; bounce++) {
        let tMin = 999, hitMirror: MirrorObj | null = null;

        for (const m of s.mirrors) {
          const mx = m.mesh.position.x, my = m.mesh.position.y;
          const len = 1.25;
          const m1x = mx - Math.cos(m.angle) * len, m1y = my - Math.sin(m.angle) * len;
          const m2x = mx + Math.cos(m.angle) * len, m2y = my + Math.sin(m.angle) * len;

          const denom = (m2x - m1x) * dy - (m2y - m1y) * dx;
          if (Math.abs(denom) < 0.0001) continue;
          const t1 = ((cx - m1x) * dy - (cy - m1y) * dx) / denom;
          const t2 = ((cx - m1x) * (m2y - m1y) - (cy - m1y) * (m2x - m1x)) / denom;
          if (t1 >= 0 && t1 <= 1 && t2 > 0.01 && t2 < tMin) { tMin = t2; hitMirror = m; }
        }

        // Wall bounds
        const walls = [
          dx > 0 ? (16 - cx) / dx : 999,
          dx < 0 ? (-16 - cx) / dx : 999,
          dy > 0 ? (10 - cy) / dy : 999,
          dy < 0 ? (-10 - cy) / dy : 999,
        ];
        const wallT = Math.min(...walls.filter(v => v > 0.01));

        if (hitMirror && tMin < wallT) {
          cx += dx * tMin; cy += dy * tMin;
          pts.push(new THREE.Vector3(cx, cy, 0));
          const ref = reflectDir(dx, dy, hitMirror.angle);
          dx = ref[0]; dy = ref[1];
        } else {
          cx += dx * wallT; cy += dy * wallT;
          pts.push(new THREE.Vector3(cx, cy, 0));
          break;
        }
      }

      // Update laser line
      if (s.laserLine) {
        s.laserLine.geometry.setFromPoints(pts);
        // geometry is rebuilt via setFromPoints � no needsUpdate needed
      }

      // Check if hitting target
      const lastPt = pts[pts.length - 1];
      const hitDist = lastPt.distanceTo(s.targetPos);
      const isHitting = hitDist < 1.0;

      if (isHitting && !s.hitTarget) {
        s.hitTarget = true;
        s.sig.puzzlesSolved++;
        const isPerfect = s.movesThisRound <= 2;
        if (isPerfect) s.sig.perfectSolves++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
        const pts2 = (isPerfect ? 5 : 3) * mult;
        s.sig.score += pts2;
        s.hitFlash = 30;
        setScoreDisplay(s.sig.score);
        sfx.success(); hapticScore();
        s.levelNum++;
        setTimeout(() => { if (s.running && s.scene) generateLevel(s.scene, s.levelNum); }, 800);
      }

      // Laser color & glow
      const laserColor = isHitting ? 0xff4444 : 0xdc2626;
      (s.laserLine?.material as THREE.LineBasicMaterial).color.setHex(laserColor);

      // Target pulse
      if (s.targetMesh) {
        (s.targetMesh.material as THREE.MeshPhongMaterial).color.setHex(isHitting ? 0xfbbf24 : 0xdc2626);
        s.targetMesh.rotation.z += 0.03;
        const tScale = 1 + Math.sin(t * 4) * 0.05;
        s.targetMesh.scale.setScalar(tScale);
      }

      // Source pulse
      if (s.sourceMesh) {
        const sScale = 1 + Math.sin(t * 6) * 0.1;
        s.sourceMesh.scale.setScalar(sScale);
      }

      // Hit flash
      if (s.hitFlash > 0) {
        redLight.intensity = 2 + (s.hitFlash / 30) * 4;
        s.hitFlash--;
      } else {
        redLight.intensity = 2;
      }

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      s.running = false;
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [endGame, generateLevel]);

  const toNDC = useCallback((clientX: number, clientY: number): THREE.Vector2 => {
    const s = stateRef.current;
    if (!s.renderer) return new THREE.Vector2();
    const rect = s.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }, []);

  useEffect(() => {
    const el = mountRef.current; if (!el) return;
    const onDown = (e: PointerEvent) => { if (phase !== 'playing') return; const p = toNDC(e.clientX, e.clientY); stateRef.current.pendingPointer = { x: p.x, y: p.y, type: 'down' }; };
    const onMove = (e: PointerEvent) => { if (phase !== 'playing') return; const p = toNDC(e.clientX, e.clientY); stateRef.current.pendingPointer = { x: p.x, y: p.y, type: 'move' }; };
    const onUp = (e: PointerEvent) => { if (phase !== 'playing') return; const p = toNDC(e.clientX, e.clientY); stateRef.current.pendingPointer = { x: p.x, y: p.y, type: 'up' }; };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); };
  }, [phase, toNDC]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    stateRef.current.renderer?.dispose();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg,#030812 0%,#050a1a 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Drag mirrors to reflect the 3D laser beam into the target!" ctaLabel="Reflect! 🔴" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none', touchAction: 'none' }} />
      {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Puzzles Solved', value: String(finalSig.puzzlesSolved), color: ACCENT },
            { label: 'Efficient Solves', value: String(finalSig.perfectSolves), color: '#fbbf24' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' },
            { label: 'Mirror Moves', value: String(finalSig.movesUsed), color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.puzzlesSolved >= 3} />
      )}
    </GameShell>
  );
}
