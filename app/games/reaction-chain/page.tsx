'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, playComboSfx, playSuccess, playFail, playMusic, stopMusicFile, preloadGameAudio } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import StreakBadge from '@/components/StreakBadge';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';

const GAME_ID      = 'reaction-chain';
const ACCENT       = '#facc15';
const DURATION     = 45;
const GAME_EMOJI   = '⚡';
const GAME_TITLE   = 'Reaction Chain';
const GAME_TAGLINE = 'Tap fast. Keep the chain alive.';
const NODE_RADIUS_3D = 0.7;

function getWindowMs(elapsed: number): number {
  const t = Math.min(elapsed / 45, 1);
  return Math.round(1100 - t * (1100 - 420));
}

interface Signals { reactionTimes: number[]; longestChain: number; chainBreaks: number; totalNodes: number; tappedNodes: number; currentChain: number; score: number; }
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const avgRT = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length : 9999;
  const accuracy = sig.totalNodes > 0 ? sig.tappedNodes / sig.totalNodes : 0;
  if (avgRT < 350 && sig.longestChain >= 10) return 'Lightning Reflex ⚡';
  if (accuracy >= 0.70 && sig.chainBreaks <= 4 && sig.longestChain >= 8) return 'Chain Keeper 🔗';
  if (sig.tappedNodes > 20 && sig.chainBreaks > 4) return 'Sprinter 💨';
  return 'Steady Reactor 🎯';
}

export default function ReactionChain() {
  const theme = useBrandTheme();
  const accentColor = (theme.id !== 'ether') ? theme.colors.accent : ACCENT;
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const respawnRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodeMeshRef = useRef<THREE.Mesh | null>(null);
  const timerArcRef = useRef<THREE.Mesh | null>(null);
  const glowLightRef = useRef<THREE.PointLight | null>(null);
  const particlesRef = useRef<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }[]>([]);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { reactionTimes: [], longestChain: 0, chainBreaks: 0, totalNodes: 0, tappedNodes: 0, currentChain: 0, score: 0 } as Signals,
    nodeX: 0, nodeY: 0, nodeZ: 0,
    nodeSpawnTime: 0, nodeAlive: false, nodeWindowMs: 800,
    chainBreakFlash: 0, accentColor: ACCENT,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streakDisplay, setStreakDisplay] = useState(0);
  const { pops, triggerPop } = useScorePop();
  const triggerPopRef = useRef(triggerPop);
  triggerPopRef.current = triggerPop;
  const [finalSig, setFinalSig] = useState<Signals | null>(null);

  useEffect(() => { stateRef.current.accentColor = accentColor ?? ACCENT; }, [theme]);

  const spawnNode = useCallback(() => {
    const s = stateRef.current;
    const elapsed = DURATION - s.timeLeft;
    s.nodeWindowMs = getWindowMs(elapsed);
    s.nodeX = (Math.random() - 0.5) * 7;
    s.nodeY = (Math.random() - 0.5) * 5;
    s.nodeZ = (Math.random() - 0.5) * 2;
    s.nodeSpawnTime = Date.now();
    s.nodeAlive = true;
    s.sig.totalNodes++;
    if (nodeMeshRef.current) {
      nodeMeshRef.current.position.set(s.nodeX, s.nodeY, s.nodeZ);
      nodeMeshRef.current.visible = true;
      nodeMeshRef.current.scale.setScalar(1);
    }
    if (glowLightRef.current) glowLightRef.current.position.set(s.nodeX, s.nodeY, s.nodeZ + 1);
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    stopMusicFile();
    if (respawnRef.current) { clearTimeout(respawnRef.current); respawnRef.current = null; }
    if (s.sig.currentChain > s.sig.longestChain) s.sig.longestChain = s.sig.currentChain;
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { reactionTimes: [], longestChain: 0, chainBreaks: 0, totalNodes: 0, tappedNodes: 0, currentChain: 0, score: 0 };
    s.nodeAlive = false; s.chainBreakFlash = 0;
    setScoreDisplay(0); setStreakDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('drive');
    playMusic(GAME_ID);
    preloadGameAudio(GAME_ID);

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0700);
    scene.fog = new THREE.Fog(0x0d0700, 15, 30);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 60);
    camera.position.set(0, 0, 12);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x1a0e00, 3));
    const gLight = new THREE.PointLight(0xfacc15, 80, 15);
    gLight.position.set(0, 0, 3);
    scene.add(gLight);
    glowLightRef.current = gLight;

    // Stars
    const sg = new THREE.BufferGeometry();
    const sp = new Float32Array(500);
    for (let i = 0; i < 500; i += 3) { sp[i] = (Math.random()-0.5)*50; sp[i+1] = (Math.random()-0.5)*40; sp[i+2] = -12 - Math.random()*8; }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xfacc15, size: 0.05 })));

    // Node mesh (single reusable)
    const nodeGeo = new THREE.SphereGeometry(NODE_RADIUS_3D, 24, 24);
    const nodeMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xfacc15, emissiveIntensity: 0.5, roughness: 0.2, metalness: 0.6, transparent: true, opacity: 0.9 });
    const node = new THREE.Mesh(nodeGeo, nodeMat);
    node.visible = false;
    scene.add(node);
    nodeMeshRef.current = node;

    // Timer arc (torus that shrinks)
    const arcGeo = new THREE.TorusGeometry(NODE_RADIUS_3D + 0.25, 0.06, 8, 64);
    const arcMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xfacc15, emissiveIntensity: 0.8 });
    const arc = new THREE.Mesh(arcGeo, arcMat);
    arc.visible = false;
    scene.add(arc);
    timerArcRef.current = arc;

    // Raycaster
    const raycaster = new THREE.Raycaster();
    const onTap = (e: PointerEvent) => {
      if (!s.running || !s.nodeAlive) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(((e.clientX - rect.left)/rect.width)*2-1, -((e.clientY - rect.top)/rect.height)*2+1);
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObject(node);
      if (!hits.length) return;
      const reactionMs = Date.now() - s.nodeSpawnTime;
      s.sig.tappedNodes++; s.sig.reactionTimes.push(reactionMs); s.sig.currentChain++;
      if (s.sig.currentChain > s.sig.longestChain) s.sig.longestChain = s.sig.currentChain;
      s.sig.score += 1 + (reactionMs < 300 ? 5 : 0);
      // Particle burst
      for (let i = 0; i < 12; i++) {
        const geo = new THREE.SphereGeometry(0.08, 6, 6);
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xfacc15, emissiveIntensity: 0.5 }));
        mesh.position.set(s.nodeX, s.nodeY, s.nodeZ);
        scene.add(mesh);
        particlesRef.current.push({ mesh, vx: (Math.random()-0.5)*0.15, vy: (Math.random()-0.5)*0.15, vz: (Math.random()-0.5)*0.1, life: 1 });
      }
      node.visible = false;
      s.nodeAlive = false;
      setScoreDisplay(s.sig.currentChain); setStreakDisplay(s.sig.currentChain);
      triggerPopRef.current(reactionMs < 300 ? '+6' : '+1', e.clientX, e.clientY, { milestone: s.sig.currentChain >= 5, huge: s.sig.currentChain >= 10 });
      if (s.sig.currentChain >= 3) playComboSfx(s.sig.currentChain); else sfx.collect();
      haptic(s.sig.currentChain >= 5 ? [20, 10, 20] : [20]);
      spawnNode();
    };
    renderer.domElement.addEventListener('pointerdown', onTap);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 5 && s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) { sfx.success(); playSuccess(GAME_ID); haptic([30, 50, 30, 50, 100]); endGame(); }
    }, 1000);

    spawnNode();

    let t = 0;
    const loop = () => {
      if (!s.running) return;
      animRef.current = requestAnimationFrame(loop);
      t += 0.012;

      if (s.nodeAlive && node.visible) {
        const age = Date.now() - s.nodeSpawnTime;
        const progress = Math.min(1, age / s.nodeWindowMs);
        if (progress >= 1) {
          s.nodeAlive = false; node.visible = false;
          if (s.sig.currentChain > s.sig.longestChain) s.sig.longestChain = s.sig.currentChain;
          s.sig.currentChain = 0; s.sig.chainBreaks++;
          s.chainBreakFlash = 30;
          sfx.collision(); haptic([80]);
          setScoreDisplay(0); setStreakDisplay(0);
          respawnRef.current = setTimeout(() => { if (s.running) spawnNode(); }, 500);
        } else {
          const mat = node.material as THREE.MeshStandardMaterial;
          mat.opacity = 1 - progress * 0.5;
          node.scale.setScalar(1 - progress * 0.3);
          if (timerArcRef.current) {
            timerArcRef.current.position.copy(node.position);
            timerArcRef.current.visible = true;
            timerArcRef.current.scale.setScalar(1 - progress * 0.3);
            timerArcRef.current.rotation.z = -progress * Math.PI * 2;
          }
        }
        // Gentle float
        node.position.y = s.nodeY + Math.sin(t * 2) * 0.08;
        node.rotation.y += 0.02;
        if (glowLightRef.current) glowLightRef.current.position.set(s.nodeX, node.position.y, s.nodeZ + 1);
      } else if (timerArcRef.current) {
        timerArcRef.current.visible = false;
      }

      // Chain break flash (red tint via bg color shift)
      if (s.chainBreakFlash > 0) { s.chainBreakFlash--; scene.background = new THREE.Color(s.chainBreakFlash > 15 ? 0x1a0500 : 0x0d0700); }

      // Particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.vy -= 0.002; p.life -= 0.025;
        (p.mesh.material as THREE.MeshStandardMaterial).opacity = p.life;
        (p.mesh.material as THREE.MeshStandardMaterial).transparent = true;
        if (p.life <= 0.05) { scene.remove(p.mesh); particlesRef.current.splice(i, 1); }
      }

      gLight.intensity = 40 + Math.sin(t * 4) * 20;
      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => { renderer.domElement.removeEventListener('pointerdown', onTap); };
  }, [endGame, spawnNode]);

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
      if (respawnRef.current) clearTimeout(respawnRef.current);
      if (rendererRef.current && mountRef.current) {
        try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
        rendererRef.current.dispose();
      }
    };
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); sfx.click(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    stateRef.current.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (respawnRef.current) { clearTimeout(respawnRef.current); respawnRef.current = null; }
    if (rendererRef.current && mountRef.current) {
      try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
      rendererRef.current.dispose(); rendererRef.current = null;
    }
    particlesRef.current = [];
    setScoreDisplay(0); setStreakDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
    setPhase('start');
  }, []);

  const buildInsights = useCallback((sig: Signals) => {
    const avgRT = sig.reactionTimes.length > 0 ? Math.round(sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length) : 0;
    const accuracy = sig.totalNodes > 0 ? Math.round((sig.tappedNodes/sig.totalNodes)*100) : 0;
    const ac = accentColor ?? ACCENT;
    return [
      { label: 'Longest Chain', value: `${sig.longestChain}`, color: sig.longestChain >= 20 ? '#4ade80' : sig.longestChain >= 10 ? '#facc15' : '#ef4444' },
      { label: 'Avg Reaction', value: avgRT > 0 ? `${avgRT}ms` : '—', color: avgRT > 0 && avgRT < 350 ? '#4ade80' : '#facc15' },
      { label: 'Chain Breaks', value: `${sig.chainBreaks}`, color: sig.chainBreaks <= 2 ? '#4ade80' : '#ef4444' },
      { label: 'Nodes Hit', value: `${accuracy}%`, color: ac },
    ];
  }, [accentColor]);

  const ac = accentColor ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={ac} gameId={GAME_ID}
      background="radial-gradient(ellipse at 50% 50%, rgba(250,204,21,0.07) 0%, transparent 60%), linear-gradient(180deg, #0d0700 0%, #060300 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start" accentColor={ac} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={ac} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <>
              <GameHUD accentColor={ac} items={[
                { label: 'TIME', value: timeLeft, danger: timeLeft <= 10, testId: 'timer' },
                { label: 'CHAIN', value: scoreDisplay, testId: 'score' },
              ]} />
              <StreakBadge streak={streakDisplay} accentColor={ac} position="bottom-center" />
              <ScorePopEffect pops={pops} accentColor={ac} />
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.longestChain)} personality={getPersonality(finalSig)}
            insights={buildInsights(finalSig)} accentColor={ac}
            onPlayAgain={handlePlayAgain} didWin={finalSig.longestChain >= 10} />
          <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, gameId, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; gameId: string; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, gameId, { personality, score: sig.score, longestChain: sig.longestChain, chainBreaks: sig.chainBreaks }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
