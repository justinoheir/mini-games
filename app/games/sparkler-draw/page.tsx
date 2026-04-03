'use client';
/**
 * SPARKLER DRAW — 3D Version
 * Trace a glowing 3D star shape with particle trail sparkles.
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

const GAME_ID = 'sparkler-draw';
const ACCENT = '#f59e0b';
const DURATION = 30;
const GAME_EMOJI = '✨';
const GAME_TITLE = 'Sparkler Draw';
const GAME_TAGLINE = 'Trace the firework. Be fast. Be precise.';
const PB_KEY = 'mg_pb_sparkler-draw';

interface Signals { score: number; accuracy: number; completionTime: number | null; tracedPct: number; }
function getPersonality(sig: Signals): string {
  if (sig.accuracy >= 88 && sig.completionTime && sig.completionTime < 8000) return 'Pyrotechnic Pro 🎆';
  if (sig.accuracy >= 80) return 'Star Tracer ⭐';
  if (sig.tracedPct >= 80) return 'Sparkle Chaser ✨';
  if (sig.accuracy >= 60) return 'Firework Fan 🎇';
  return 'Apprentice Lighter 🕯️';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function starPoints3D(n: number, outerR: number, innerR: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < n * 2; i++) {
    const angle = (i * Math.PI) / n - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push(new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, 0));
  }
  pts.push(pts[0].clone()); // close
  return pts;
}

export default function SparklerDrawGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    templateLine: null as THREE.Line | null,
    sparkParticles: [] as { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number; maxLife: number }[],
    trailLine: null as THREE.Line | null,
    trailPoints: [] as THREE.Vector3[],
    cursor: null as THREE.Mesh | null,
    cursorLight: null as THREE.PointLight | null,
    templatePoints: [] as THREE.Vector3[],
    trackedCount: 0,
    hitThreshold: 0.4,
    running: false, timeLeft: DURATION,
    sig: { score: 0, accuracy: 0, completionTime: null as number | null, tracedPct: 0 } as Signals,
    drawing: false, gameStartMs: 0, completionMs: null as number | null,
    totalHits: 0, totalSamples: 0,
    cursorX: 0, cursorY: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    stopMusicRef.current?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    const accuracy = s.totalSamples > 0 ? Math.round((s.totalHits / s.totalSamples) * 100) : 0;
    const tracedPct = s.trackedCount / s.templatePoints.length * 100;
    s.sig.accuracy = accuracy;
    s.sig.tracedPct = tracedPct;
    s.sig.completionTime = s.completionMs;
    if (s.completionMs !== null) { const speed = Math.max(0, 20000 - s.completionMs) / 1000; s.sig.score = Math.round(accuracy * 0.8 + speed * 5); }
    else s.sig.score = Math.round(accuracy * 0.5 + (tracedPct / 100) * 20);
    try { const pb = parseInt(localStorage.getItem(PB_KEY) || '0', 10); if (s.sig.score > pb) { localStorage.setItem(PB_KEY, String(s.sig.score)); setIsNewBest(true); } } catch { /* ignore */ }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, accuracy: 0, completionTime: null, tracedPct: 0 };
    s.sparkParticles = []; s.trailPoints = []; s.drawing = false;
    s.totalHits = 0; s.totalSamples = 0; s.trackedCount = 0; s.completionMs = null;
    s.gameStartMs = Date.now();
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x020a0a);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 6);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x020a0a, 2));
    const bgLight = new THREE.PointLight(0xf59e0b, 1, 20);
    bgLight.position.set(0, 3, 3);
    scene.add(bgLight);
    const cursorLight = new THREE.PointLight(0xfacc15, 0, 5);
    scene.add(cursorLight);
    s.cursorLight = cursorLight;

    // Stars background
    const sp = new Float32Array(400*3);
    for (let i=0;i<400;i++){sp[i*3]=(Math.random()-.5)*50;sp[i*3+1]=(Math.random()-.5)*50;sp[i*3+2]=(Math.random()-.5)*50;}
    const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(sp,3));
    scene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0xffffff,size:0.04})));

    // Star template
    const starPts = starPoints3D(5, 2.2, 0.9);
    s.templatePoints = starPts;
    const templateGeo = new THREE.BufferGeometry().setFromPoints(starPts);
    const templateLine = new THREE.Line(templateGeo, new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.5 }));
    scene.add(templateLine);
    s.templateLine = templateLine;

    // Template vertex markers (guide dots)
    starPts.forEach((pt, i) => {
      if (i % 2 === 0) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.8 }));
        dot.position.copy(pt);
        scene.add(dot);
      }
    });

    // Live trail line
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xfacc15 }));
    scene.add(trailLine);
    s.trailLine = trailLine;

    // Cursor sparkler sphere
    const cursorGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const cursorMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xfacc15, emissiveIntensity: 1 });
    const cursor = new THREE.Mesh(cursorGeo, cursorMat);
    cursor.visible = false;
    scene.add(cursor);
    s.cursor = cursor;

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    (s as any)._cleanup = () => window.removeEventListener('resize', handleResize);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const screenToWorld = (cx: number, cy: number) => {
      const ndcX = (cx / window.innerWidth) * 2 - 1;
      const ndcY = -((cy / window.innerHeight) * 2 - 1);
      const v = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
      const dir = v.sub(camera.position).normalize();
      const t = -camera.position.z / dir.z;
      return camera.position.clone().add(dir.multiplyScalar(t));
    };

    const checkNearTemplate = (worldPt: THREE.Vector3): boolean => {
      return s.templatePoints.some(tp => tp.distanceTo(worldPt) < s.hitThreshold * 1.5);
    };

    const loop = () => {
      if (!s.running) return;
      const t = Date.now() * 0.001;

      // Sparkle particles
      for (let pi = s.sparkParticles.length - 1; pi >= 0; pi--) {
        const p = s.sparkParticles[pi];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.vy -= 0.002; p.life--;
        (p.mesh.material as THREE.MeshStandardMaterial).opacity = p.life / p.maxLife;
        if (p.life <= 0) { scene.remove(p.mesh); s.sparkParticles.splice(pi, 1); }
      }

      // Template pulse
      if (s.templateLine) {
        (s.templateLine.material as THREE.LineBasicMaterial).opacity = 0.3 + Math.sin(t * 3) * 0.2;
      }

      // Cursor light
      if (s.drawing && s.cursor?.visible) {
        cursorLight.intensity = 2 + Math.sin(t * 8) * 0.5;
        cursorLight.position.copy(cursor.position);
      } else {
        cursorLight.intensity = 0;
      }

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    const spawnSparks = (pos: THREE.Vector3, isHit: boolean) => {
      for (let i = 0; i < (isHit ? 5 : 2); i++) {
        const geo = new THREE.SphereGeometry(0.04, 4, 4);
        const color = isHit ? 0xfbbf24 : 0x888800;
        const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1, transparent: true, opacity: 1 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(pos);
        scene.add(mesh);
        const angle = Math.random() * Math.PI * 2;
        const elev = (Math.random() - 0.5) * 0.5;
        const spd = 0.03 + Math.random() * 0.04;
        s.sparkParticles.push({ mesh, vx: Math.cos(angle) * spd, vy: Math.sin(elev) * spd + 0.03, vz: Math.sin(angle) * spd, life: 20 + Math.floor(Math.random() * 15), maxLife: 35 });
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      stateRef.current.drawing = true;
      stateRef.current.trailPoints = [];
      if (cursor) cursor.visible = true;
    };
    const onPointerMove = (e: PointerEvent) => {
      const s2 = stateRef.current;
      if (!s2.running || !s2.drawing) return;
      const worldPt = screenToWorld(e.clientX, e.clientY);
      cursor.position.copy(worldPt);
      s2.trailPoints.push(worldPt.clone());
      if (s2.trailPoints.length > 2) {
        const tGeo = new THREE.BufferGeometry().setFromPoints(s2.trailPoints);
        trailLine.geometry.dispose(); trailLine.geometry = tGeo;
      }
      // Check hit
      s2.totalSamples++;
      if (checkNearTemplate(worldPt)) { s2.totalHits++; spawnSparks(worldPt, true); sfx.tick(); }
      else spawnSparks(worldPt, false);
    };
    const onPointerUp = () => {
      const s2 = stateRef.current;
      s2.drawing = false;
      if (cursor) cursor.visible = false;
      // Check completion
      const covered = s2.templatePoints.filter(tp => s2.trailPoints.some(dp => tp.distanceTo(dp) < s2.hitThreshold * 2));
      s2.trackedCount = covered.length;
      if (covered.length >= s2.templatePoints.length * 0.7 && s2.completionMs === null) {
        s2.completionMs = Date.now() - s2.gameStartMs;
        sfx.success(); haptic([50, 30, 50]);
      }
      setScoreDisplay(Math.round((s2.totalHits / Math.max(1, s2.totalSamples)) * 100));
    };
    if (mountRef.current) {
      mountRef.current.addEventListener('pointerdown', onPointerDown);
      mountRef.current.addEventListener('pointermove', onPointerMove);
      mountRef.current.addEventListener('pointerup', onPointerUp);
    }
    (s as any)._inputCleanup = () => {
      mountRef.current?.removeEventListener('pointerdown', onPointerDown);
      mountRef.current?.removeEventListener('pointermove', onPointerMove);
      mountRef.current?.removeEventListener('pointerup', onPointerUp);
    };
  }, [endGame]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    stopMusicRef.current?.();
    const s = stateRef.current;
    if (s.renderer) s.renderer.dispose();
    (s as any)._cleanup?.(); (s as any)._inputCleanup?.();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false); }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #020a0a 0%, #010505 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Draw! ✨" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <GameHUD accentColor={accent} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
          { label: 'ACC', value: `${scoreDisplay}%` },
        ]} />
      )}
      <AnimatePresence>
        {isNewBest && phase === 'done' && (
          <motion.div key="nb" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)', zIndex: 90, background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', borderRadius: 20, padding: '8px 20px', fontSize: 20, fontWeight: 900, color: '#000', whiteSpace: 'nowrap' }}>
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Accuracy', value: `${finalSig.accuracy}%`, color: accent },
              { label: 'Traced', value: `${Math.round(finalSig.tracedPct)}%`, color: '#fbbf24' },
              { label: 'Time', value: finalSig.completionTime ? `${(finalSig.completionTime / 1000).toFixed(1)}s` : 'Incomplete', color: '#4ade80' },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.accuracy >= 70} />
          <WebhookHelper theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

function WebhookHelper({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score, accuracy: sig.accuracy }, player); }, [theme, sig, personality, player]);
  return null;
}
