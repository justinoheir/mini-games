'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';

const GAME_ID = 'stack-drop';
const PB_KEY = 'pb_stack-drop';
const ACCENT = '#f97316';
const DURATION = 60;
const GAME_EMOJI = '🧱';
const GAME_TITLE = 'Stack Drop';
const GAME_TAGLINE = "Drop it. Stack it. Don't tip it.";
const BLOCK_H = 0.35;
const INITIAL_W = 2.2;
const PERFECT_TOL = 0.12;

interface Block3D { mesh: THREE.Mesh; x: number; w: number; y: number; color: number; }
interface Signals { score: number; perfectDrops: number; goodDrops: number; missDrops: number; maxStack: number; maxStreak: number; streakCurrent: number; }
function getPersonality(sig: Signals): string {
  const total = sig.perfectDrops + sig.goodDrops + sig.missDrops;
  const perfRate = total > 0 ? sig.perfectDrops / total : 0;
  if (perfRate >= 0.5 && sig.maxStack >= 12) return 'Tower Master 🏰';
  if (sig.maxStack >= 15) return 'Sky Builder 🌆';
  if (sig.perfectDrops >= 8) return 'Precision Stacker 🎯';
  if (sig.maxStreak >= 5) return 'Steady Hands 🤲';
  return 'Block Dropper 🧱';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function StackDropGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    sliderMesh: null as THREE.Mesh | null,
    sliderLight: null as THREE.PointLight | null,
    stackLight: null as THREE.PointLight | null,
    stack: [] as Block3D[],
    sliderX: 0, sliderDir: 1, sliderSpeed: 0.03,
    sliderW: INITIAL_W,
    running: false, timeLeft: DURATION,
    sig: { score: 0, perfectDrops: 0, goodDrops: 0, missDrops: 0, maxStack: 0, maxStreak: 0, streakCurrent: 0 } as Signals,
    missPaused: false, pauseUntil: 0,
    flashTimer: 0, flashColor: 0xffffff,
    particles: [] as { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }[],
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
    if (scoreDisplay > prevScoreRef.current) triggerPop(`+${scoreDisplay - prevScoreRef.current}`, window.innerWidth / 2, 200);
    prevScoreRef.current = scoreDisplay;
  }, [scoreDisplay, triggerPop]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    stopMusicRef.current?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    playVictoryFanfare(); hapticVictory();
    try { const pb = parseInt(localStorage.getItem(PB_KEY) || '0', 10); if (s.sig.score > pb) { localStorage.setItem(PB_KEY, String(s.sig.score)); setIsNewBest(true); } } catch { /* ignore */ }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const dropBlock = useCallback(() => {
    const s = stateRef.current;
    if (!s.running || s.missPaused) return;
    const topBlock = s.stack.length > 0 ? s.stack[s.stack.length - 1] : { x: 0, w: INITIAL_W, y: -2.5 };
    const sliderX = s.sliderX, sliderW = s.sliderW;
    const topX = topBlock.x, topW = topBlock.w;
    const overlap = Math.min(sliderX + sliderW / 2, topX + topW / 2) - Math.max(sliderX - sliderW / 2, topX - topW / 2);
    if (overlap <= 0) {
      // Complete miss
      s.sig.missDrops++; s.sig.streakCurrent = 0; setStreak(0);
      sfx.collision(); hapticFail();
      s.missPaused = true; s.pauseUntil = Date.now() + 1000;
      s.flashTimer = 15; s.flashColor = 0xef4444;
      return;
    }
    const newX = Math.max(sliderX - sliderW / 2, topX - topW / 2) + overlap / 2;
    const newW = overlap;
    const newY = topBlock.y + BLOCK_H;
    const isPerfect = Math.abs(sliderX - topX) < PERFECT_TOL;
    if (isPerfect) { s.sig.perfectDrops++; } else { s.sig.goodDrops++; }
    s.sig.streakCurrent++;
    if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
    const stackHeight = s.stack.length + 1;
    if (stackHeight > s.sig.maxStack) s.sig.maxStack = stackHeight;
    const pts = 1 + (isPerfect ? 2 : 0) + Math.floor(s.sig.streakCurrent / 5);
    s.sig.score += pts; setScoreDisplay(s.sig.score); setStreak(s.sig.streakCurrent);
    playScoreHit?.(); hapticScore();
    s.flashTimer = 10; s.flashColor = isPerfect ? 0x22c55e : 0xf97316;

    // Create block mesh
    const blockColors = [0xf97316, 0xfbbf24, 0xef4444, 0xa855f7, 0x06b6d4, 0x22c55e];
    const color = blockColors[s.stack.length % blockColors.length];
    const geo = new THREE.BoxGeometry(newW, BLOCK_H, 0.8);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: isPerfect ? 0.5 : 0.1, roughness: 0.4, metalness: 0.2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(newX, newY, 0);
    s.scene!.add(mesh);
    s.stack.push({ mesh, x: newX, w: newW, y: newY, color });

    // Burst particles for perfect
    if (isPerfect && s.scene) {
      for (let i = 0; i < 12; i++) {
        const pGeo = new THREE.SphereGeometry(0.06, 4, 4);
        const pMat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 1 });
        const pMesh = new THREE.Mesh(pGeo, pMat);
        pMesh.position.set(newX, newY + BLOCK_H / 2, 0);
        s.scene.add(pMesh);
        const angle = Math.random() * Math.PI * 2;
        s.particles.push({ mesh: pMesh, vx: Math.cos(angle) * 0.08, vy: 0.08 + Math.random() * 0.06, vz: (Math.random() - 0.5) * 0.05, life: 25 });
      }
    }

    // Slider gets narrower on miss, stays same on hit (classic stack behavior)
    s.sliderW = isPerfect ? newW : Math.max(0.4, newW - 0.05);
    s.sliderSpeed = Math.min(0.06, 0.03 + stackHeight * 0.001);

    // Scroll camera up
    if (s.camera) {
      const targetY = Math.max(0, newY - 1);
      s.camera.position.y += (targetY - s.camera.position.y) * 0.1;
    }
    if (s.stackLight) s.stackLight.position.y = newY + 1;
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, perfectDrops: 0, goodDrops: 0, missDrops: 0, maxStack: 0, maxStreak: 0, streakCurrent: 0 };
    s.stack = []; s.particles = []; s.sliderX = 0; s.sliderDir = 1; s.sliderSpeed = 0.03;
    s.sliderW = INITIAL_W; s.missPaused = false;
    setScoreDisplay(0); setTimeLeft(DURATION); setStreak(0);
    stopMusicRef.current = startMusic('minimal');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a1a);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0a1a, 15, 35);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 7);
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x0a0a1a, 3));
    const topLight = new THREE.PointLight(0xf97316, 2, 20);
    topLight.position.set(0, 10, 3);
    scene.add(topLight);
    const stackLight = new THREE.PointLight(0xf97316, 2, 12);
    stackLight.position.set(0, 0, 2);
    scene.add(stackLight);
    s.stackLight = stackLight;
    const sliderLight = new THREE.PointLight(0xfbbf24, 2, 6);
    scene.add(sliderLight);
    s.sliderLight = sliderLight;

    // Base platform
    const basePlatGeo = new THREE.BoxGeometry(INITIAL_W + 0.2, BLOCK_H, 0.9);
    const basePlatMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
    const basePlat = new THREE.Mesh(basePlatGeo, basePlatMat);
    basePlat.position.set(0, -2.5, 0);
    scene.add(basePlat);
    s.stack.push({ mesh: basePlat, x: 0, w: INITIAL_W, y: -2.5, color: 0x222222 });

    // Stars
    const sp = new Float32Array(300*3);
    for (let i=0;i<300;i++){sp[i*3]=(Math.random()-.5)*50;sp[i*3+1]=(Math.random()-.5)*50;sp[i*3+2]=(Math.random()-.5)*50;}
    const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(sp,3));
    scene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0xffffff,size:0.05})));

    // Slider block
    const sliderGeo = new THREE.BoxGeometry(INITIAL_W, BLOCK_H, 0.8);
    const sliderMat = new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0xf97316, emissiveIntensity: 0.5, roughness: 0.3 });
    const sliderMesh = new THREE.Mesh(sliderGeo, sliderMat);
    sliderMesh.position.set(0, -2.5 + BLOCK_H, 0);
    scene.add(sliderMesh);
    s.sliderMesh = sliderMesh;

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
      const t = Date.now() * 0.001;

      // Pause on miss
      if (s.missPaused && Date.now() > s.pauseUntil) {
        s.missPaused = false;
        sfx.tick();
      }

      // Move slider
      if (!s.missPaused) {
        s.sliderX += s.sliderDir * s.sliderSpeed;
        const topBlock = s.stack[s.stack.length - 1];
        const limit = topBlock.w / 2 + s.sliderW / 2 + 0.5;
        if (Math.abs(s.sliderX) > limit) s.sliderDir *= -1;
      }

      // Update slider mesh
      const topBlock = s.stack[s.stack.length - 1];
      const sliderY = topBlock.y + BLOCK_H;
      sliderMesh.position.set(s.sliderX, sliderY, 0);
      sliderMesh.scale.x = s.sliderW / INITIAL_W;
      sliderLight.position.set(s.sliderX, sliderY + 0.5, 1);
      const sliderMat2 = sliderMesh.material as THREE.MeshStandardMaterial;
      sliderMat2.emissiveIntensity = 0.3 + Math.sin(t * 4) * 0.2;

      // Flash
      if (s.flashTimer > 0) {
        s.flashTimer--;
        renderer.setClearColor(new THREE.Color(s.flashColor).lerp(new THREE.Color(0x0a0a1a), 1 - s.flashTimer / 15));
      } else {
        renderer.setClearColor(0x0a0a1a);
      }

      // Particles
      for (let pi = s.particles.length - 1; pi >= 0; pi--) {
        const p = s.particles[pi];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.vy -= 0.005; p.life--;
        (p.mesh.material as THREE.MeshStandardMaterial).opacity = p.life / 25;
        if (p.life <= 0) { scene.remove(p.mesh); s.particles.splice(pi, 1); }
      }

      // Camera track stack height
      const stackTopY = s.stack.length > 1 ? s.stack[s.stack.length - 1].y : -2.5;
      const cameraTargetY = Math.max(0, stackTopY - 1.5);
      camera.position.y += (cameraTargetY - camera.position.y) * 0.04;
      camera.lookAt(0, cameraTargetY, 0);

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    if (mountRef.current) mountRef.current.addEventListener('pointerdown', dropBlock);
    (s as any)._tapCleanup = () => mountRef.current?.removeEventListener('pointerdown', dropBlock);
  }, [endGame, dropBlock]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    stopMusicRef.current?.();
    const s = stateRef.current;
    if (s.renderer) s.renderer.dispose();
    (s as any)._cleanup?.(); (s as any)._tapCleanup?.();
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false); setStreak(0); prevScoreRef.current = 0; }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #0a0a1a 0%, #05050d 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Tap to drop the sliding 3D block. Stack them perfectly!"
          ctaLabel="Stack! 🧱" accentColor={accent} onStart={handleStart} />
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
              { label: 'Max Stack', value: `${finalSig.maxStack} blocks`, color: accent },
              { label: 'Perfects', value: String(finalSig.perfectDrops), color: '#4ade80' },
              { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
              { label: 'Misses', value: String(finalSig.missDrops), color: '#ef4444' },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.maxStack >= 10} />
          <WebhookHelper theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

function WebhookHelper({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score, maxStack: sig.maxStack, perfectDrops: sig.perfectDrops }, player); }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const StackDropGame = dynamic(() => Promise.resolve({ default: StackDropGameInner }), { ssr: false });
export default StackDropGame;
