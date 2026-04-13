'use client';
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

const GAME_ID      = 'paint-splash';
const ACCENT       = '#f43f5e';
const DURATION     = 45;
const GAME_EMOJI   = '🎨';
const GAME_TITLE   = 'Paint Splash';
const GAME_TAGLINE = 'Tap to splatter paint. Cover the canvas!';

const SPLASH_COLS = [0xf43f5e, 0xf97316, 0xfacc15, 0x4ade80, 0x22d3ee, 0xa855f7, 0xec4899, 0x3b82f6];

interface Signals { totalSplashes: number; coveragePercent: number; maxShakeIntensity: number; score: number; combo: number; maxCombo: number; }
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  if (sig.coveragePercent >= 75 && sig.totalSplashes >= 30) return 'Abstract Master 🎨';
  if (sig.maxShakeIntensity >= 15 && sig.totalSplashes >= 20) return 'Wild Shaker 🌪️';
  if (sig.coveragePercent >= 50) return 'Even Spreader 🖌️';
  if (sig.totalSplashes >= 25) return 'Rapid Tapper 💥';
  return 'Gentle Dabbler 🌸';
}

interface SplashBlob { mesh: THREE.Mesh; life: number; vx: number; vy: number; vz: number; }

function PaintSplashGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const splashesRef = useRef<SplashBlob[]>([]);
  const paintGroupRef = useRef<THREE.Group | null>(null);
  const coverMeshRef = useRef<THREE.Mesh[]>([]);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { totalSplashes: 0, coveragePercent: 0, maxShakeIntensity: 0, score: 0, combo: 0, maxCombo: 0 } as Signals,
    covered: new Set<string>(),
    totalCells: 100, // 10x10 grid
    lastTapTime: 0, colorIdx: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [coverageDisplay, setCoverageDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    s.sig.coveragePercent = Math.round(s.covered.size / s.totalCells * 100);
    setCoverageDisplay(s.sig.coveragePercent);
    sfx.success(); haptic([100]);
    try { const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0'); if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score)); } catch { /**/ }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const spawnSplash = useCallback((x: number, y: number, scene: THREE.Scene) => {
    const s = stateRef.current;
    const col = SPLASH_COLS[s.colorIdx % SPLASH_COLS.length];
    const count = 8 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
      const r = 0.08 + Math.random() * 0.3;
      const geo = new THREE.SphereGeometry(r, 8, 8);
      const mat = new THREE.MeshStandardMaterial({ color: col, emissive: new THREE.Color(col).multiplyScalar(0.3), roughness: 0.8 });
      const mesh = new THREE.Mesh(geo, mat);
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * 1.5;
      mesh.position.set(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.1 + Math.random() * 0.1);
      scene.add(mesh);
      splashesRef.current.push({ mesh, life: 1, vx: Math.cos(a) * 0.04, vy: Math.sin(a) * 0.04, vz: 0.02 + Math.random() * 0.04 });
    }
    // Mark cells covered
    const gx = Math.floor((x + 5) / 10 * 10);
    const gy = Math.floor((y + 5) / 10 * 10);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      s.covered.add(`${gx+dx},${gy+dy}`);
    }
    s.sig.coveragePercent = Math.min(100, Math.round(s.covered.size / s.totalCells * 100));
    setCoverageDisplay(s.sig.coveragePercent);
    s.colorIdx++;
    s.sig.totalSplashes++;
    const now = Date.now();
    if (now - s.lastTapTime < 600) { s.sig.combo++; if (s.sig.combo > s.sig.maxCombo) s.sig.maxCombo = s.sig.combo; }
    else s.sig.combo = 1;
    s.lastTapTime = now;
    const pts = s.sig.combo >= 3 ? 3 : s.sig.combo >= 2 ? 2 : 1;
    s.sig.score += pts; setScoreDisplay(s.sig.score);
    sfx.collect(); haptic([20]);
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalSplashes: 0, coveragePercent: 0, maxShakeIntensity: 0, score: 0, combo: 0, maxCombo: 0 };
    s.covered = new Set(); s.colorIdx = 0; s.lastTapTime = 0;
    setScoreDisplay(0); setCoverageDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('holiday');

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f0a14);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 60);
    camera.position.set(0, 0, 10);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x221133, 3));
    const pl = new THREE.PointLight(0xf43f5e, 60, 20);
    pl.position.set(2, 3, 7);
    scene.add(pl);
    { const _pl2 = new THREE.PointLight(0x3b82f6, 40, 15); _pl2.position.set(-3, -2, 5); scene.add(_pl2); }

    // Canvas plane (target surface)
    const canvasGeo = new THREE.PlaneGeometry(9, 9);
    const canvasMat = new THREE.MeshStandardMaterial({ color: 0x1a1025, roughness: 0.9 });
    const canvasMesh = new THREE.Mesh(canvasGeo, canvasMat);
    scene.add(canvasMesh);

    // Grid outline
    const gridHelper = new THREE.GridHelper(9, 10, 0x333355, 0x222244);
    gridHelper.rotation.x = Math.PI / 2;
    scene.add(gridHelper);

    // Coverage cells as thin planes
    coverMeshRef.current = [];
    for (let gx = 0; gx < 10; gx++) for (let gy = 0; gy < 10; gy++) {
      const cellGeo = new THREE.PlaneGeometry(0.85, 0.85);
      const cellMat = new THREE.MeshStandardMaterial({ color: 0x1a1025, transparent: true, opacity: 0 });
      const cell = new THREE.Mesh(cellGeo, cellMat);
      cell.position.set(-4 + gx * 0.9 + 0.45, -4 + gy * 0.9 + 0.45, 0.01);
      cell.userData = { gx, gy };
      scene.add(cell);
      coverMeshRef.current.push(cell);
    }

    // Raycaster
    const raycaster = new THREE.Raycaster();
    const onTap = (e: PointerEvent) => {
      if (!s.running) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObject(canvasMesh);
      if (hits.length) {
        const p = hits[0].point;
        spawnSplash(p.x, p.y, scene);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onTap);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    let t = 0;
    const loop = () => {
      if (!s.running) return;
      animRef.current = requestAnimationFrame(loop);
      t += 0.01;

      // Update coverage cells
      for (const cell of coverMeshRef.current) {
        const { gx, gy } = cell.userData as { gx: number; gy: number };
        const covered = s.covered.has(`${gx},${gy}`);
        const mat = cell.material as THREE.MeshStandardMaterial;
        if (covered && mat.opacity < 0.8) {
          const col = SPLASH_COLS[(gx * 3 + gy * 7) % SPLASH_COLS.length];
          mat.color.set(col);
          mat.opacity = Math.min(0.8, mat.opacity + 0.05);
        }
      }

      // Splash blobs physics + fade
      splashesRef.current = splashesRef.current.filter(b => b.life > 0.02);
      for (const b of splashesRef.current) {
        b.mesh.position.x += b.vx; b.mesh.position.y += b.vy;
        b.vx *= 0.92; b.vy *= 0.92;
        b.life -= 0.015;
        (b.mesh.material as THREE.MeshStandardMaterial).opacity = b.life;
        (b.mesh.material as THREE.MeshStandardMaterial).transparent = true;
        if (b.life <= 0.02) sceneRef.current?.remove(b.mesh);
      }

      camera.position.x = Math.sin(t * 0.2) * 0.5;
      camera.position.y = Math.cos(t * 0.15) * 0.3;
      camera.lookAt(0, 0, 0);
      pl.position.x = Math.sin(t * 0.7) * 4;
      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => { renderer.domElement.removeEventListener('pointerdown', onTap); };
  }, [endGame, spawnSplash]);

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
    splashesRef.current = []; coverMeshRef.current = [];
    setScoreDisplay(0); setCoverageDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
    setPhase('countdown');
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 30%, rgba(244,63,94,0.12) 0%, transparent 60%), linear-gradient(180deg, #0f0a14 0%, #080610 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Splash! 🎨" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={accent} items={[
              { label: 'TIME', value: timeLeft, danger: timeLeft <= 10, testId: 'timer' },
              { label: 'SCORE', value: scoreDisplay, testId: 'score' },
              { label: 'COVER', value: `${coverageDisplay}%` },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Coverage', value: `${finalSig.coveragePercent}%`, color: finalSig.coveragePercent >= 50 ? '#4ade80' : '#facc15' },
              { label: 'Splashes', value: String(finalSig.totalSplashes), color: accent },
              { label: 'Max Combo', value: `×${finalSig.maxCombo}`, color: '#fbbf24' },
              { label: 'Score', value: String(finalSig.score), color: accent },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.coveragePercent >= 50} />
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
    postWebhook(theme, GAME_ID, { personality, score: sig.score, coveragePercent: sig.coveragePercent }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const PaintSplashGame = dynamic(() => Promise.resolve({ default: PaintSplashGameInner }), { ssr: false });
export default PaintSplashGame;
