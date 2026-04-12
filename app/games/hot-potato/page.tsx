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

const GAME_ID      = 'hot-potato';
const ACCENT       = '#f97316';
const DURATION     = 30;
const GAME_EMOJI   = '🥔';
const GAME_TITLE   = 'Hot Potato';
const GAME_TAGLINE = 'Tap the potato before it burns! It gets faster every 5 seconds!';

interface Signals {
  totalTaps: number; burnCount: number; maxSpeedLevel: number;
  avgReactionMs: number; reactionTimes: number[]; score: number;
}
function getPersonality(sig: Signals): string {
  const avgR = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length : 9999;
  if (sig.burnCount === 0 && sig.maxSpeedLevel >= 4)    return 'Ice Hands 🧊';
  if (avgR < 250 && sig.totalTaps >= 10)                return 'Lightning Reflexes ⚡';
  if (sig.maxSpeedLevel >= 5)                           return 'Speed Level 6 🔥';
  if (sig.burnCount >= 5)                               return 'Burn Ward Regular 🏥';
  return 'Warm-Handed 🥔';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface PotatoState {
  x: number; y: number; vx: number; vy: number; heat: number;
  burnTimer: number; maxBurnTimer: number; spawnTime: number;
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  potato: PotatoState | null; speedLevel: number;
}

function makePotato(speedLevel: number): PotatoState {
  const angle = Math.random() * Math.PI * 2;
  const spd = 0.04 + speedLevel * 0.012;
  const maxBurnTimer = Math.max(80, 180 - speedLevel * 18);
  return {
    x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 6,
    vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd,
    heat: 0, burnTimer: 0, maxBurnTimer, spawnTime: Date.now(),
  };
}

function HotPotatoGameInner() {
  const theme        = useBrandTheme();
  const mountRef     = useRef<HTMLDivElement>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { totalTaps: 0, burnCount: 0, maxSpeedLevel: 1, avgReactionMs: 0, reactionTimes: [], score: 0 },
    potato: null, speedLevel: 1,
  });
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    potato: THREE.Mesh; heatLight: THREE.PointLight; burnParticles: THREE.Points | null;
    animId: number;
  } | null>(null);

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    if (s.sig.reactionTimes.length > 0) {
      s.sig.avgReactionMs = Math.round(s.sig.reactionTimes.reduce((a, b) => a + b, 0) / s.sig.reactionTimes.length);
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalTaps: 0, burnCount: 0, maxSpeedLevel: 1, avgReactionMs: 0, reactionTimes: [], score: 0 };
    s.speedLevel = 1;
    s.potato = makePotato(1);
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1a0800);
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 10);

    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const ambOrange = new THREE.AmbientLight(0xf97316, 0.2);
    scene.add(ambOrange);
    const heatLight = new THREE.PointLight(0xff3300, 0, 15);
    scene.add(heatLight);

    // Background embers grid
    const gridCount = 200;
    const gPos = new Float32Array(gridCount * 3);
    for (let i = 0; i < gridCount; i++) {
      gPos[i*3] = (Math.random()-0.5)*20; gPos[i*3+1] = (Math.random()-0.5)*20; gPos[i*3+2] = (Math.random()-0.5)*5;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xf97316, size: 0.04, transparent: true, opacity: 0.3 })));

    // Potato mesh (ellipsoid approximated with scaled sphere)
    const potatoGeo = new THREE.SphereGeometry(0.7, 20, 16);
    const potatoMat = new THREE.MeshStandardMaterial({ color: 0xc87941, roughness: 0.6, metalness: 0.1 });
    const potato = new THREE.Mesh(potatoGeo, potatoMat);
    potato.scale.set(1.2, 0.9, 0.85);
    scene.add(potato);

    // Heat ring
    const ringGeo = new THREE.TorusGeometry(0.9, 0.06, 8, 32);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xff3300, emissive: 0xff1100, emissiveIntensity: 0.5, transparent: true, opacity: 0.0 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    scene.add(ring);

    const obj = { renderer, scene, camera, potato, heatLight, burnParticles: null, animId: 0 };
    threeRef.current = obj;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      s.speedLevel = 1 + Math.floor((DURATION - s.timeLeft) / 5);
      if (s.speedLevel > s.sig.maxSpeedLevel) s.sig.maxSpeedLevel = s.speedLevel;
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const BOUNDS_X = 4.5, BOUNDS_Y = 7;
    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      if (!s.running || !s.potato) return;
      const p = s.potato;
      p.x += p.vx; p.y += p.vy;
      if (Math.abs(p.x) > BOUNDS_X) { p.vx *= -1; p.x = Math.sign(p.x) * BOUNDS_X; }
      if (Math.abs(p.y) > BOUNDS_Y) { p.vy *= -1; p.y = Math.sign(p.y) * BOUNDS_Y; }
      p.burnTimer++;
      p.heat = p.burnTimer / p.maxBurnTimer;

      if (p.burnTimer >= p.maxBurnTimer) {
        s.sig.burnCount++;
        sfx.fail(); haptic([100, 50, 100]);
        s.potato = makePotato(s.speedLevel);
      }

      potato.position.set(p.x, p.y, 0);
      ring.position.set(p.x, p.y, 0);
      const heatR = 0.58 + p.heat * 0.35;
      const heatG = 0.42 - p.heat * 0.35;
      const heatB = 0.16 - p.heat * 0.15;
      const potatoMat = potato.material as THREE.MeshStandardMaterial;
      potatoMat.color.setRGB(heatR, heatG, heatB);
      potatoMat.emissive.setRGB(heatR * 0.4 * p.heat, 0, 0);
      potatoMat.emissiveIntensity = p.heat * 0.8;

      const ringMat2 = ring.material as THREE.MeshStandardMaterial;
      ringMat2.opacity = p.heat * 0.85;
      ringMat2.emissiveIntensity = 0.4 + p.heat * 0.6;
      ring.scale.setScalar(0.9 + Math.sin(Date.now() * 0.015) * 0.08 + p.heat * 0.2);
      ring.rotation.z += 0.03;

      heatLight.intensity = p.heat * 4;
      heatLight.position.set(p.x, p.y, 2);
      heatLight.color.setRGB(1, 0.2 + 0.2 * (1 - p.heat), 0);

      potato.rotation.y += 0.01;

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
  }, [endGame]);

  useEffect(() => {
    const mount = mountRef.current; if (!mount || phase !== 'playing') return;
    const onTap = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running || !s.potato) return;
      const t = threeRef.current; if (!t) return;
      const rect = mount.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), t.camera);
      const hits = raycaster.intersectObject(t.potato);
      if (hits.length > 0) {
        const p = s.potato!;
        const rx = p.x - (ndcX * 5); const ry = p.y - (ndcY * 8);
        const len = Math.sqrt(rx*rx+ry*ry)||1;
        const spd = 0.05 + s.speedLevel * 0.01;
        p.vx = (rx/len)*spd*2; p.vy = (ry/len)*spd*2;
        p.burnTimer = Math.max(0, p.burnTimer - p.maxBurnTimer * 0.4);
        p.heat = p.burnTimer / p.maxBurnTimer;
        p.spawnTime = Date.now();
        s.sig.reactionTimes.push(Date.now() - p.spawnTime);
        s.sig.totalTaps++;
        s.sig.score++;
        setScoreDisplay(s.sig.score);
        sfx.collect(); haptic([30]);
      }
    };
    mount.addEventListener('pointerdown', onTap);
    return () => mount.removeEventListener('pointerdown', onTap);
  }, [phase]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const buildInsights = (sig: Signals) => [
    { label: 'Taps',      value: `${sig.totalTaps}`,    color: ACCENT },
    { label: 'Burns',     value: `${sig.burnCount}`,    color: sig.burnCount === 0 ? '#4ade80' : '#ef4444' },
    { label: 'Max Speed', value: `Lv.${sig.maxSpeedLevel}`, color: ACCENT },
    { label: 'Avg React', value: sig.avgReactionMs > 0 ? `${sig.avgReactionMs}ms` : '-', color: 'var(--color-text)' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Touch the Potato" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.burnCount === 0} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, gameId, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>; gameId: string; sig: Signals; personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, gameId, { personality, score: sig.score, totalTaps: sig.totalTaps, burnCount: sig.burnCount, maxSpeedLevel: sig.maxSpeedLevel, avgReactionMs: sig.avgReactionMs }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const HotPotatoGame = dynamic(() => Promise.resolve({ default: HotPotatoGameInner }), { ssr: false });
export default HotPotatoGame;
