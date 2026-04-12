'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic } from '@/lib/audio';
import { playVictoryFanfare } from '@/lib/audio';
import { hapticScore, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';

const GAME_ID = 'shadow-tap';
const PB_KEY = 'pb_shadow-tap';
const ACCENT = '#64748b';
const DURATION = 45;
const GAME_EMOJI = '👁️';
const GAME_TITLE = 'Shadow Tap';
const GAME_TAGLINE = "Tap what you see. Before it's gone.";

type ShapeType = 'sphere' | 'cone' | 'octahedron';
const SHAPE_TYPES: ShapeType[] = ['sphere', 'cone', 'octahedron'];

interface Signals {
  hitsOnFirst: number; misses: number; flashReactionTimes: number[];
  wrongAreaTaps: number; hits: number; streak: number; maxStreak: number; score: number;
}

function getPersonality(sig: Signals): string {
  const totalVisible = sig.hits + sig.misses;
  const acc = totalVisible > 0 ? sig.hits / totalVisible : 0;
  const avg = sig.flashReactionTimes.length > 0 ? sig.flashReactionTimes.reduce((a, b) => a + b, 0) / sig.flashReactionTimes.length : 9999;
  if (acc > 0.80 && avg < 400 && sig.misses < 5) return 'Sharp Processor';
  if (sig.hitsOnFirst > 15 && avg < 350) return 'Gut Reader';
  if (avg > 500 && sig.wrongAreaTaps <= 3 && sig.misses < 8) return 'Overthinker';
  return 'The Hunter';
}

function randomDarkDuration(): number { return 400 + Math.random() * 400; }

function getShapeWindowMs(elapsedMs: number): number {
  return Math.max(550, 950 - (elapsedMs / 45000) * 400);
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';
type ShapePhase = 'visible' | 'dark';

function ShadowTapGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    shapeMesh: null as THREE.Mesh | null,
    shapeLight: null as THREE.PointLight | null,
    hitFlash: null as THREE.PointLight | null,
    missFlash: null as THREE.PointLight | null,
    running: false, timeLeft: DURATION,
    sig: { hitsOnFirst: 0, misses: 0, flashReactionTimes: [], wrongAreaTaps: 0, hits: 0, streak: 0, maxStreak: 0, score: 0 } as Signals,
    shapeType: 'sphere' as ShapeType,
    shapeX: 0, shapeY: 0, shapeSize: 0.5,
    shapePhase: 'dark' as ShapePhase,
    shapeSpawnTime: 0,
    shapeWindowMs: 900,
    darkStartTime: 0, darkDurationMs: 600,
    hitFlashTime: 0, missFlashTime: 0,
    reactionLabel: '', reactionLabelTime: 0,
    comboFlashTime: 0, comboMult: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [streak, setStreak] = useState(0);
  const { pops, triggerPop } = useScorePop();
  const prevScoreRef = useRef(0);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => {
    if (scoreDisplay > prevScoreRef.current) {
      triggerPop(`+${scoreDisplay - prevScoreRef.current}`, window.innerWidth / 2, 200);
      setStreak(stateRef.current.sig.streak);
    }
    prevScoreRef.current = scoreDisplay;
  }, [scoreDisplay]);

  const spawnShape = useCallback(() => {
    const s = stateRef.current;
    if (!s.scene) return;
    const elapsed = (DURATION - s.timeLeft) * 1000;
    s.shapeType = SHAPE_TYPES[Math.floor(Math.random() * SHAPE_TYPES.length)];
    s.shapeWindowMs = getShapeWindowMs(elapsed);
    s.shapeSpawnTime = Date.now();
    s.shapePhase = 'visible';

    // Random world position
    const W = window.innerWidth, H = window.innerHeight;
    const aspect = W / H;
    const halfH = Math.tan((65 / 2) * Math.PI / 180) * 5;
    const halfW = halfH * aspect;
    const margin = 0.8;
    const wx = (Math.random() * 2 - 1) * (halfW - margin);
    const wy = (Math.random() * 2 - 1) * (halfH - margin) * 0.6;
    s.shapeX = wx; s.shapeY = wy;
    s.shapeSize = 0.3 + Math.random() * 0.2;

    // Remove old shape
    if (s.shapeMesh) { s.scene.remove(s.shapeMesh); s.shapeMesh = null; }

    // Create new shape mesh
    let geo: THREE.BufferGeometry;
    switch (s.shapeType) {
      case 'sphere': geo = new THREE.SphereGeometry(s.shapeSize, 16, 16); break;
      case 'cone': geo = new THREE.ConeGeometry(s.shapeSize, s.shapeSize * 2, 8); break;
      case 'octahedron': default: geo = new THREE.OctahedronGeometry(s.shapeSize); break;
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0x0d1117, emissive: 0x1e293b, emissiveIntensity: 0.8, roughness: 0.4, metalness: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(wx, wy, 0);
    s.scene.add(mesh);
    s.shapeMesh = mesh;
    if (s.shapeLight) { s.shapeLight.position.set(wx, wy, 1); s.shapeLight.intensity = 2; }
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    hapticVictory(); playVictoryFanfare();
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (s.sig.score > pb) { localStorage.setItem(PB_KEY, String(s.sig.score)); setIsNewBest(true); }
    } catch { /* ignore */ }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { hitsOnFirst: 0, misses: 0, flashReactionTimes: [], wrongAreaTaps: 0, hits: 0, streak: 0, maxStreak: 0, score: 0 };
    s.shapePhase = 'dark'; s.darkStartTime = Date.now(); s.darkDurationMs = randomDarkDuration();
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x02030a);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 5);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x050810, 2));
    const shapeLight = new THREE.PointLight(0x64748b, 0, 10);
    shapeLight.position.set(0, 0, 1);
    scene.add(shapeLight);
    s.shapeLight = shapeLight;
    const hitFlash = new THREE.PointLight(0x4ade80, 0, 15);
    hitFlash.position.set(0, 0, 2);
    scene.add(hitFlash);
    s.hitFlash = hitFlash;
    const missFlash = new THREE.PointLight(0xef4444, 0, 15);
    missFlash.position.set(0, 0, 2);
    scene.add(missFlash);
    s.missFlash = missFlash;

    // Dark particle field
    const darkPos = new Float32Array(200 * 3);
    for (let i = 0; i < 200; i++) { darkPos[i*3] = (Math.random()-0.5)*20; darkPos[i*3+1] = (Math.random()-0.5)*20; darkPos[i*3+2] = (Math.random()-0.5)*20; }
    const dpGeo = new THREE.BufferGeometry();
    dpGeo.setAttribute('position', new THREE.BufferAttribute(darkPos, 3));
    scene.add(new THREE.Points(dpGeo, new THREE.PointsMaterial({ color: 0x1e293b, size: 0.04 })));

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    (s as any)._cleanup = () => window.removeEventListener('resize', handleResize);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 10 && s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const now = Date.now();
      const t = now * 0.001;

      if (s.shapePhase === 'dark') {
        if (now - s.darkStartTime >= s.darkDurationMs) spawnShape();
        if (s.shapeMesh) { s.scene!.remove(s.shapeMesh); s.shapeMesh = null; }
        shapeLight.intensity = 0;
      } else {
        const age = now - s.shapeSpawnTime;
        if (age >= s.shapeWindowMs) {
          s.sig.misses++; s.sig.streak = 0;
          sfx.collision(); haptic([40]);
          missFlash.intensity = 4;
          s.shapePhase = 'dark';
          s.darkStartTime = now;
          s.darkDurationMs = randomDarkDuration();
          if (s.shapeMesh) { scene.remove(s.shapeMesh); s.shapeMesh = null; }
        } else if (s.shapeMesh) {
          s.shapeMesh.rotation.y = t * 1.5;
          s.shapeMesh.rotation.x = t * 0.8;
          const fadeRatio = Math.min(1, (s.shapeWindowMs - age) / 150);
          shapeLight.intensity = 2 * fadeRatio;
        }
      }

      // Flash decay
      if (hitFlash.intensity > 0) hitFlash.intensity = Math.max(0, hitFlash.intensity - 0.15);
      if (missFlash.intensity > 0) missFlash.intensity = Math.max(0, missFlash.intensity - 0.15);

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    const onTap = (e: PointerEvent) => {
      const s2 = stateRef.current;
      if (!s2.running) return;
      if (s2.shapePhase === 'visible' && s2.shapeMesh) {
        const rect = mountRef.current?.getBoundingClientRect();
        if (!rect) return;
        const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
        const hits = raycaster.intersectObject(s2.shapeMesh);
        if (hits.length > 0) {
          const reactionMs = Date.now() - s2.shapeSpawnTime;
          s2.sig.hits++; s2.sig.flashReactionTimes.push(reactionMs);
          if (reactionMs < 350) s2.sig.hitsOnFirst++;
          s2.sig.streak++;
          if (s2.sig.streak > s2.sig.maxStreak) s2.sig.maxStreak = s2.sig.streak;
          let pts = reactionMs < 200 ? 10 : reactionMs < 400 ? 5 : 2;
          if (s2.sig.streak > 0 && s2.sig.streak % 5 === 0) { pts += 15; sfx.shimmer(); }
          s2.sig.score += pts; setScoreDisplay(s2.sig.score);
          if (hitFlash) { hitFlash.position.set(s2.shapeX, s2.shapeY, 2); hitFlash.intensity = 5; }
          sfx.collect(); hapticScore();
          s2.shapePhase = 'dark';
          s2.darkStartTime = Date.now();
          s2.darkDurationMs = randomDarkDuration();
          if (s2.shapeMesh) { scene.remove(s2.shapeMesh); s2.shapeMesh = null; }
        } else {
          s2.sig.wrongAreaTaps++; s2.sig.streak = 0;
          if (missFlash) { missFlash.position.set(s2.shapeX, s2.shapeY, 2); missFlash.intensity = 3; }
          sfx.nearMiss(); haptic([40]);
        }
      } else {
        s2.sig.wrongAreaTaps++; s2.sig.streak = 0;
        sfx.nearMiss(); haptic([40]);
      }
    };
    if (mountRef.current) mountRef.current.addEventListener('pointerdown', onTap);
    (s as any)._tapCleanup = () => mountRef.current?.removeEventListener('pointerdown', onTap);
  }, [endGame, spawnShape]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    const s = stateRef.current;
    if (s.renderer) s.renderer.dispose();
    (s as any)._cleanup?.(); (s as any)._tapCleanup?.();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); sfx.click(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false); setStreak(0); prevScoreRef.current = 0; }, []);

  const accent = theme.colors.accent ?? ACCENT;

  const buildInsights = (sig: Signals) => {
    const totalVisible = sig.hits + sig.misses;
    const accuracyPct = totalVisible > 0 ? Math.round((sig.hits / totalVisible) * 100) : 0;
    const avgReaction = sig.flashReactionTimes.length > 0 ? Math.round(sig.flashReactionTimes.reduce((a, b) => a + b, 0) / sig.flashReactionTimes.length) : 0;
    return [
      { label: 'Avg Reaction', value: avgReaction > 0 ? `${avgReaction}ms` : '—', color: avgReaction < 350 ? '#4ade80' : avgReaction <= 600 ? '#facc15' : '#ef4444' },
      { label: 'Accuracy', value: `${accuracyPct}%`, color: accuracyPct >= 75 ? '#4ade80' : '#facc15' },
      { label: 'Gut Reads', value: `${sig.hitsOnFirst}`, color: accent },
      { label: 'False Taps', value: `${sig.wrongAreaTaps}`, color: sig.wrongAreaTaps <= 3 ? '#4ade80' : '#ef4444' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #040303 0%, #060404 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start" accentColor={accent} onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #0a0d18 0%, #060810 55%, #020308 100%)" />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <>
          <GameHUD accentColor={accent} items={[
            { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
            { label: 'SCORE', value: scoreDisplay },
          ]} />
          <ScorePopEffect pops={pops} accentColor={accent} />
          <StreakBadge streak={streak} accentColor={accent} />
        </>
      )}
      <AnimatePresence>
        {isNewBest && phase === 'done' && (
          <motion.div key="nb" initial={{ opacity: 0, y: -20, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)', zIndex: 90, background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', borderRadius: 20, padding: '8px 20px', fontSize: 20, fontWeight: 900, color: '#000', whiteSpace: 'nowrap' }}>
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={buildInsights(finalSig)} accentColor={accent}
            onPlayAgain={handlePlayAgain} didWin={finalSig.hits >= 8} />
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
    const totalVisible = sig.hits + sig.misses;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, hits: sig.hits, misses: sig.misses, accuracyBySpeed: totalVisible > 0 ? sig.hits / totalVisible : 0, maxStreak: sig.maxStreak }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const ShadowTapGame = dynamic(() => Promise.resolve({ default: ShadowTapGameInner }), { ssr: false });
export default ShadowTapGame;
