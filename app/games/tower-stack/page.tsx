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

const GAME_ID = 'tower-stack';
const ACCENT = '#818cf8';
const DURATION = 45;
const GAME_EMOJI = '🧱';
const GAME_TITLE = 'Tower Stack';
const GAME_TAGLINE = 'Tap to stack. Build it sky-high!';
const PB_KEY = 'mg_pb_tower-stack';
const BLOCK_H = 0.4;
const COLORS = [0x6366f1, 0x8b5cf6, 0xa855f7, 0xc084fc, 0x818cf8, 0x38bdf8, 0x34d399, 0xfb923c];

interface Signals { score: number; hits: number; attempts: number; reactionTimes: number[]; maxStreak: number; streakCurrent: number; }
function getPersonality(sig: Signals): string {
  if (sig.score >= 15) return '🏆 Sky Architect';
  if (sig.score >= 10) return '🧱 Master Stacker';
  if (sig.maxStreak >= 5) return '🎯 Precision Builder';
  if (sig.hits < 3) return '💥 Demo Expert';
  return '🏗️ Steady Builder';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

interface Block3D { mesh: THREE.Mesh; x: number; width: number; color: number; }

function TowerStackGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    sig: { score: 0, hits: 0, attempts: 0, reactionTimes: [] as number[], maxStreak: 0, streakCurrent: 0 },
    blocks: [] as Block3D[],
    movingMesh: null as THREE.Mesh | null,
    movingX: 0, movingWidth: 2.5, movingDir: 1, movingSpeed: 0.06,
    cameraTargetY: 0, blockTime: 0, gameOver: false, frame: 0,
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
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const dropBlock = useCallback(() => {
    const s = stateRef.current;
    if (!s.running || s.blocks.length === 0 || s.gameOver) return;
    const top = s.blocks[s.blocks.length - 1];
    const overlap = Math.min(top.x + top.width / 2, s.movingX + s.movingWidth / 2) - Math.max(top.x - top.width / 2, s.movingX - s.movingWidth / 2);
    s.sig.attempts++;
    s.sig.reactionTimes.push(Date.now() - s.blockTime);

    if (overlap <= 0.1) {
      sfx.fail(); haptic([80, 40, 80]);
      s.gameOver = true; s.sig.streakCurrent = 0;
      setTimeout(() => { if (s.running) endGame(); }, 800);
      return;
    }

    const newX = (Math.max(top.x - top.width / 2, s.movingX - s.movingWidth / 2) + Math.min(top.x + top.width / 2, s.movingX + s.movingWidth / 2)) / 2;
    const newW = overlap;
    const colorIdx = s.blocks.length % COLORS.length;
    const yPos = s.blocks.length * BLOCK_H;

    const geo = new THREE.BoxGeometry(newW, BLOCK_H - 0.05, 1.2);
    const mat = new THREE.MeshStandardMaterial({ color: COLORS[colorIdx], roughness: 0.5, metalness: 0.1, emissive: COLORS[colorIdx], emissiveIntensity: 0.15 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(newX, yPos, 0);
    mesh.castShadow = true;
    s.scene?.add(mesh);
    s.blocks.push({ mesh, x: newX, width: newW, color: COLORS[colorIdx] });

    const center = top.x;
    const movingCenter = s.movingX;
    const perfect = Math.abs(center - movingCenter) < top.width * 0.07;
    const pts = perfect ? 2 : 1;
    s.sig.hits++; s.sig.streakCurrent++;
    if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
    s.sig.score += s.sig.streakCurrent >= 3 ? pts + 1 : pts;
    setScoreDisplay(s.sig.score);
    sfx.collect(); haptic([30]);

    // Update moving block
    s.movingWidth = Math.max(0.6, newW);
    s.movingX = newX;
    s.movingSpeed = Math.min(0.03 + s.blocks.length * 0.003, 0.1);
    s.cameraTargetY = Math.max(0, (s.blocks.length - 5) * BLOCK_H);
    s.blockTime = Date.now();

    // Update moving mesh geometry
    if (s.movingMesh) {
      s.scene?.remove(s.movingMesh);
      const mGeo = new THREE.BoxGeometry(s.movingWidth, BLOCK_H - 0.05, 1.2);
      const mMat = new THREE.MeshStandardMaterial({ color: COLORS[s.blocks.length % COLORS.length], emissive: COLORS[s.blocks.length % COLORS.length], emissiveIntensity: 0.4 });
      s.movingMesh = new THREE.Mesh(mGeo, mMat);
      s.movingMesh.position.set(s.movingX, (s.blocks.length) * BLOCK_H + 0.1, 0);
      s.scene?.add(s.movingMesh);
    }
  }, [endGame]);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.gameOver = false; s.frame = 0;
    s.sig = { score: 0, hits: 0, attempts: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 };
    s.blocks = []; s.movingX = 0; s.movingWidth = 2.5; s.movingDir = 1; s.movingSpeed = 0.06;
    s.cameraTargetY = 0; s.blockTime = Date.now();
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0b0c1a);
    renderer.shadowMap.enabled = true;
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b0c1a, 20, 50);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 4, 12);
    // === POLISH: Responsive resize handler ===
    const _onResizeHandler = () => {
      const _W = (mountRef.current?.clientWidth || window.innerWidth);
      const _H = (mountRef.current?.clientHeight || window.innerHeight);
      renderer.setSize(_W, _H);
      if (camera instanceof THREE.PerspectiveCamera) { (camera as THREE.PerspectiveCamera).aspect = _W / _H; camera.updateProjectionMatrix(); }
    };
    window.addEventListener('resize', _onResizeHandler);
    // === END POLISH ===
    camera.lookAt(0, 2, 0);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x111133, 2));
    const topLight = new THREE.PointLight(0x818cf8, 4, 30);
    topLight.position.set(0, 15, 5);
    scene.add(topLight);
    const sideLight = new THREE.PointLight(0x38bdf8, 2, 20);
    sideLight.position.set(5, 5, 5);
    scene.add(sideLight);

    // Ground / base
    const groundGeo = new THREE.BoxGeometry(4, 0.3, 1.5);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.y = -0.15;
    ground.receiveShadow = true;
    scene.add(ground);

    // Stars
    const starCount = 300;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 60;
      starPos[i * 3 + 1] = Math.random() * 40;
      starPos[i * 3 + 2] = -10 + (Math.random() - 0.5) * 20;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.1 })));

    // First block
    const initW = 2.5;
    const geo0 = new THREE.BoxGeometry(initW, BLOCK_H - 0.05, 1.2);
    const mat0 = new THREE.MeshStandardMaterial({ color: COLORS[0], roughness: 0.5, metalness: 0.1, emissive: COLORS[0], emissiveIntensity: 0.15 });
    const mesh0 = new THREE.Mesh(geo0, mat0);
    mesh0.position.set(0, 0, 0);
    mesh0.castShadow = true; mesh0.receiveShadow = true;
    scene.add(mesh0);
    s.blocks.push({ mesh: mesh0, x: 0, width: initW, color: COLORS[0] });

    // Moving block
    const mGeo = new THREE.BoxGeometry(s.movingWidth, BLOCK_H - 0.05, 1.2);
    const mMat = new THREE.MeshStandardMaterial({ color: COLORS[1], emissive: COLORS[1], emissiveIntensity: 0.4 });
    s.movingMesh = new THREE.Mesh(mGeo, mMat);
    s.movingMesh.position.set(s.movingX, BLOCK_H + 0.1, 0);
    scene.add(s.movingMesh);

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 5) sfx.tick();
      if (s.timeLeft <= 0) { sfx.fail(); haptic([100]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Sweep moving block
      if (!s.gameOver && s.movingMesh) {
        s.movingX += s.movingDir * s.movingSpeed;
        const maxX = 3.5;
        if (s.movingX > maxX) { s.movingX = maxX; s.movingDir = -1; }
        if (s.movingX < -maxX) { s.movingX = -maxX; s.movingDir = 1; }
        const movY = s.blocks.length * BLOCK_H + 0.1;
        s.movingMesh.position.set(s.movingX, movY, 0);
      }

      // Camera smooth follow
      if (camera) {
        camera.position.y += (4 + s.cameraTargetY - camera.position.y) * 0.06;
        camera.lookAt(0, 2 + s.cameraTargetY, 0);
      }

      // Pulse top light
      topLight.intensity = 4 + Math.sin(s.frame * 0.05) * 0.5;

      renderer.render(scene, camera!);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);

    renderer.domElement.addEventListener('pointerdown', () => {
      if (phase === 'playing') dropBlock();
    });
  }, [endGame, dropBlock]);

  useEffect(() => () => {
    const s = stateRef.current; s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (stopMusicRef.current) stopMusicRef.current();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    if (stateRef.current.renderer) { stateRef.current.renderer.dispose(); stateRef.current.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const buildInsights = (sig: Signals) => {
    const acc = sig.attempts > 0 ? Math.round((sig.hits / sig.attempts) * 100) : 0;
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    if (sig.score > pb) localStorage.setItem(PB_KEY, String(sig.score));
    return [
      { label: 'Precision', value: acc + '%', color: acc >= 70 ? '#4ade80' : acc >= 40 ? '#facc15' : '#ef4444' },
      { label: 'Height', value: `${sig.hits} blk`, color: ACCENT },
      { label: 'Best Run', value: '🔥' + sig.maxStreak, color: ACCENT },
      { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
    ];
  };

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={accent} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5 }, { label: 'SCORE', value: scoreDisplay }]} />}
      {phase === 'done' && finalSig && <>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 8} />
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      </>}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const TowerStackGame = dynamic(() => Promise.resolve({ default: TowerStackGameInner }), { ssr: false });
export default TowerStackGame;
