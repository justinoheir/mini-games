'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCelebration } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID      = 'path-trace';
const ACCENT       = '#059669';
const DURATION     = 60;
const GAME_EMOJI   = '✏️';
const GAME_TITLE   = 'Path Trace';
const GAME_TAGLINE = "Follow the line. Don't stray.";

interface Pt { x: number; y: number; }
interface PathData { points: Pt[]; totalLength: number; }

function sampleBezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 120): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, mt = 1 - t;
    pts.push({
      x: mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
      y: mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y,
    });
  }
  return pts;
}

function generatePath(W: number, H: number, index: number): PathData {
  const margin = 1.5;
  const scale = Math.min(W, H) / 14;
  const cx = 0, cy = 0;
  const a1 = (index * 1.3) % (Math.PI * 2);
  const a2 = a1 + Math.PI * 0.7 + Math.random();
  const r = 3 + index * 0.4;
  const p0: Pt = { x: Math.cos(a1) * r, y: Math.sin(a1) * r };
  const p3: Pt = { x: Math.cos(a2) * r, y: Math.sin(a2) * r };
  const p1: Pt = { x: cx + (Math.random()-0.5)*4, y: cy + (Math.random()-0.5)*4 };
  const p2: Pt = { x: cx + (Math.random()-0.5)*4, y: cy + (Math.random()-0.5)*4 };
  const pts = sampleBezier(p0, p1, p2, p3);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y);
  return { points: pts, totalLength: len };
}

function closestDistToPath(x: number, y: number, pts: Pt[]): number {
  let best = Infinity;
  for (const p of pts) { const d = Math.hypot(x-p.x, y-p.y); if (d < best) best = d; }
  return best;
}

interface Signals { pathsCompleted: number; avgDeviation: number; perfectPaths: number; totalDeviation: number; deviationSamples: number; score: number; maxStreak: number; streakCurrent: number; }
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const avg = sig.deviationSamples > 0 ? sig.totalDeviation / sig.deviationSamples : 99;
  if (avg < 0.2 && sig.perfectPaths >= 2) return 'Precision Artist ✏️';
  if (sig.pathsCompleted >= 5) return 'Path Master 🎯';
  if (sig.perfectPaths >= 1) return 'Steady Hand 🤝';
  if (sig.pathsCompleted >= 2) return 'Tracing Along 📏';
  return 'Finding the Line 🌱';
}

export default function PathTraceGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const pathLineRef = useRef<THREE.Line | null>(null);
  const traceLineRef = useRef<THREE.Line | null>(null);
  const cursorRef = useRef<THREE.Mesh | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { pathsCompleted: 0, avgDeviation: 0, perfectPaths: 0, totalDeviation: 0, deviationSamples: 0, score: 0, maxStreak: 0, streakCurrent: 0 } as Signals,
    path: null as PathData | null, pathIndex: 0,
    tracing: false, tracePoints: [] as THREE.Vector3[],
    started: false, // has touched near start point
    traceProgress: 0, // how far along path (0..path.points.length)
    missCount: 0,
    accentColor: ACCENT,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [accuracyDisplay, setAccuracyDisplay] = useState(100);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    s.sig.avgDeviation = s.sig.deviationSamples > 0 ? s.sig.totalDeviation / s.sig.deviationSamples : 0;
    hapticVictory();
    try { const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0'); if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score)); } catch { /**/ }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const loadPath = useCallback(() => {
    const s = stateRef.current;
    const scene = sceneRef.current; if (!scene) return;
    const path = generatePath(window.innerWidth, window.innerHeight, s.pathIndex++);
    s.path = path;
    s.tracing = false; s.started = false; s.tracePoints = []; s.traceProgress = 0; s.missCount = 0;
    // Build path line geometry
    const pts = path.points.map(p => new THREE.Vector3(p.x, p.y, 0));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    if (pathLineRef.current) scene.remove(pathLineRef.current);
    const mat = new THREE.LineBasicMaterial({ color: 0x059669, transparent: true, opacity: 0.7 });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    pathLineRef.current = line;
    // Reset trace line
    if (traceLineRef.current) traceLineRef.current.geometry.setFromPoints([]);
    // Reposition cursor to start
    if (cursorRef.current) cursorRef.current.position.set(path.points[0].x, path.points[0].y, 0.2);
    setAccuracyDisplay(100);
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.pathIndex = 0;
    s.sig = { pathsCompleted: 0, avgDeviation: 0, perfectPaths: 0, totalDeviation: 0, deviationSamples: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('minimal');

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040f0a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 60);
    camera.position.set(0, 0, 10);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x082010, 3));
    scene.add(Object.assign(new THREE.PointLight(0x059669, 50, 20), { position: new THREE.Vector3(0, 3, 7) }));
    scene.add(Object.assign(new THREE.PointLight(0x22d3ee, 30, 15), { position: new THREE.Vector3(-3, -2, 5) }));

    // Trace line
    const traceGeo = new THREE.BufferGeometry();
    const traceLine = new THREE.Line(traceGeo, new THREE.LineBasicMaterial({ color: 0x22d3ee, linewidth: 2 }));
    scene.add(traceLine);
    traceLineRef.current = traceLine;

    // Cursor dot
    const curGeo = new THREE.SphereGeometry(0.18, 16, 16);
    const curMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 1 });
    const cursor = new THREE.Mesh(curGeo, curMat);
    scene.add(cursor);
    cursorRef.current = cursor;

    // Stars
    const sg = new THREE.BufferGeometry();
    const sp = new Float32Array(300);
    for (let i = 0; i < 300; i += 3) { sp[i] = (Math.random()-0.5)*40; sp[i+1] = (Math.random()-0.5)*40; sp[i+2] = (Math.random()-0.5)*10-8; }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x4ade80, size: 0.05 })));

    loadPath();

    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

    const getWorldPos = (e: PointerEvent): THREE.Vector3 | null => {
      if (!rendererRef.current || !cameraRef.current) return null;
      const rect = rendererRef.current.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, cameraRef.current);
      const target = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, target);
      return target;
    };

    const onDown = (e: PointerEvent) => {
      if (!s.running || !s.path) return;
      const pos = getWorldPos(e); if (!pos) return;
      const startPt = s.path.points[0];
      const d = Math.hypot(pos.x - startPt.x, pos.y - startPt.y);
      if (d < 1.0) { s.started = true; s.tracing = true; s.tracePoints = []; }
    };
    const onMove = (e: PointerEvent) => {
      if (!s.running || !s.tracing || !s.path || !s.started) return;
      const pos = getWorldPos(e); if (!pos) return;
      const dev = closestDistToPath(pos.x, pos.y, s.path.points);
      s.sig.totalDeviation += dev; s.sig.deviationSamples++;
      s.tracePoints.push(new THREE.Vector3(pos.x, pos.y, 0.05));
      if (traceLineRef.current && s.tracePoints.length > 1) traceLineRef.current.geometry.setFromPoints(s.tracePoints);
      if (cursorRef.current) { cursorRef.current.position.set(pos.x, pos.y, 0.2); (cursorRef.current.material as THREE.MeshStandardMaterial).color.set(dev < 0.5 ? 0x4ade80 : dev < 1.5 ? 0xfbbf24 : 0xef4444); }
      const acc = Math.max(0, Math.round(100 - dev * 40));
      setAccuracyDisplay(acc);
      if (dev > 2) { s.missCount++; if (s.missCount >= 10) { sfx.collision(); hapticFail(); s.tracing = false; s.started = false; s.tracePoints = []; loadPath(); } }
      // Check if near end
      const endPt = s.path.points[s.path.points.length - 1];
      if (Math.hypot(pos.x - endPt.x, pos.y - endPt.y) < 0.8 && s.tracePoints.length > 10) {
        const avgDev = s.sig.deviationSamples > 0 ? s.sig.totalDeviation / s.sig.deviationSamples : 99;
        const perfect = avgDev < 0.3;
        s.sig.pathsCompleted++;
        if (perfect) { s.sig.perfectPaths++; s.sig.streakCurrent++; } else s.sig.streakCurrent = 0;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const pts = perfect ? 10 : Math.max(1, 10 - Math.round(avgDev * 5));
        s.sig.score += pts; setScoreDisplay(s.sig.score);
        sfx.collect(); hapticScore();
        if (perfect) { hapticCelebration(); sfx.success(); }
        s.tracing = false; s.tracePoints = [];
        setTimeout(() => { if (s.running) loadPath(); }, 500);
      }
    };
    const onUp = () => { s.tracing = false; };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    let t = 0;
    const loop = () => {
      if (!s.running) return;
      animRef.current = requestAnimationFrame(loop);
      t += 0.008;
      if (pathLineRef.current) (pathLineRef.current.material as THREE.LineBasicMaterial).opacity = 0.5 + Math.sin(t*2)*0.2;
      if (cursorRef.current) { cursorRef.current.rotation.y += 0.05; (cursorRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8 + Math.sin(t*4)*0.4; }
      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
    };
  }, [endGame, loadPath]);

  useEffect(() => {
    const onResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      const W = window.innerWidth, H = window.innerHeight;
      cameraRef.current.aspect = W / H; cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(W, H);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
      if (rendererRef.current && mountRef.current) {
        try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
        rendererRef.current.dispose();
      }
    };
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    stateRef.current.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (rendererRef.current && mountRef.current) {
      try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
      rendererRef.current.dispose(); rendererRef.current = null;
    }
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setAccuracyDisplay(100);
    setPhase('countdown');
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 30%, rgba(5,150,105,0.12) 0%, transparent 60%), linear-gradient(180deg, #040f0a 0%, #020806 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Trace! ✏️" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={accent} items={[
              { label: 'TIME', value: timeLeft, danger: timeLeft <= 10, testId: 'timer' },
              { label: 'SCORE', value: scoreDisplay, testId: 'score' },
              { label: 'ACCUR', value: `${accuracyDisplay}%` },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Paths Done', value: String(finalSig.pathsCompleted), color: '#4ade80' },
              { label: 'Perfect', value: String(finalSig.perfectPaths), color: '#fbbf24' },
              { label: 'Avg Deviation', value: finalSig.deviationSamples > 0 ? `${(finalSig.totalDeviation/finalSig.deviationSamples).toFixed(2)}` : '—', color: accent },
              { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#c084fc' },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.pathsCompleted >= 3} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, pathsCompleted: sig.pathsCompleted, avgDeviation: parseFloat(sig.avgDeviation.toFixed(3)) }, player);
  }, [theme, sig, personality, player]);
  return null;
}
