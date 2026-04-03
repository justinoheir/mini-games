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
import { motion, AnimatePresence } from 'framer-motion';

const GAME_ID = 'shamrock-shuffle';
const ACCENT = '#22c55e';
const DURATION = 45;
const GAME_EMOJI = '🍀';
const GAME_TITLE = 'Shamrock Shuffle';
const GAME_TAGLINE = 'Track the shamrock. No peeking.';
const PB_KEY = 'mg_pb_shamrock-shuffle';

interface Signals { score: number; correct: number; wrong: number; maxStreak: number; streakCurrent: number; roundsPlayed: number; }

function getPersonality(sig: Signals): string {
  const acc = sig.roundsPlayed > 0 ? sig.correct / sig.roundsPlayed : 0;
  if (acc >= 0.85 && sig.score >= 6) return 'Mind Like a Steel Trap 🧠';
  if (acc >= 0.7) return 'Sharp Eyes 👀';
  if (sig.maxStreak >= 4) return 'Hot Streak 🔥';
  if (acc >= 0.5) return 'Lucky Guesser 🍀';
  return 'Needs More Practice 🎲';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';
type SubPhase = 'reveal' | 'shuffle' | 'choose' | 'result';

export default function ShamrockShuffleGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subPhaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    cupMeshes: [] as THREE.Group[],
    shamrockMesh: null as THREE.Mesh | null,
    tableMesh: null as THREE.Mesh | null,
    groundLight: null as THREE.PointLight | null,
    running: false, timeLeft: DURATION,
    sig: { score: 0, correct: 0, wrong: 0, maxStreak: 0, streakCurrent: 0, roundsPlayed: 0 } as Signals,
    shamrockCupIdx: 0,    // which cup (0,1,2) hides shamrock
    subPhase: 'reveal' as SubPhase,
    swaps: [] as [number, number][],
    swapProgress: 0, swapDuration: 600,
    swapStartTime: 0, resultUntil: 0,
    roundSpeed: 1,
    cupPositions: [0, 0, 0] as [number, number, number], // x positions for cups 0,1,2
    liftOffset: [0, 0, 0] as [number, number, number],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streakDisplay, setStreakDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [subPhaseDisplay, setSubPhaseDisplay] = useState<SubPhase>('reveal');
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (subPhaseTimerRef.current) { clearTimeout(subPhaseTimerRef.current); subPhaseTimerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    sfx.gameOver(); haptic([100]);
    try { const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0', 10); if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score)); } catch { /* noop */ }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const startRound = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    s.subPhase = 'reveal';
    s.liftOffset = [0, 0, 0];
    setSubPhaseDisplay('reveal');
    // Lift shamrock cup during reveal
    subPhaseTimerRef.current = setTimeout(() => {
      if (!s.running) return;
      s.liftOffset = [0, 0, 0];
      s.subPhase = 'shuffle';
      setSubPhaseDisplay('shuffle');
      // Generate swaps
      const numSwaps = 3 + Math.floor(s.roundSpeed * 1.5);
      const swaps: [number, number][] = [];
      for (let i = 0; i < numSwaps; i++) {
        let a = Math.floor(Math.random() * 3), b = Math.floor(Math.random() * 2);
        if (b >= a) b++; swaps.push([a, b]);
      }
      s.swaps = swaps;
      s.swapProgress = 0;
      s.swapDuration = Math.max(200, 600 - s.roundSpeed * 40);
      s.swapStartTime = Date.now();
      const totalSwapTime = (swaps.length + 0.5) * s.swapDuration;
      subPhaseTimerRef.current = setTimeout(() => {
        if (!s.running) return;
        s.subPhase = 'choose';
        setSubPhaseDisplay('choose');
      }, totalSwapTime);
    }, 1200);
  }, []);

  const handleCupTap = useCallback((cupIdx: number) => {
    const s = stateRef.current;
    if (!s.running || s.subPhase !== 'choose') return;
    const correct = cupIdx === s.shamrockCupIdx;
    s.sig.roundsPlayed++;
    s.subPhase = 'result';
    s.resultUntil = Date.now() + 1200;
    setSubPhaseDisplay('result');
    // Lift shamrock cup to reveal
    const newLift = [0, 0, 0] as [number, number, number];
    newLift[s.shamrockCupIdx] = 1.5;
    s.liftOffset = newLift;
    if (correct) {
      s.sig.correct++; s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const bonus = s.sig.streakCurrent >= 3 ? 2 : 1;
      s.sig.score += bonus; setScoreDisplay(s.sig.score); setStreakDisplay(s.sig.streakCurrent);
      sfx.collect(); haptic([30]);
      setResultMsg(s.sig.streakCurrent >= 3 ? `✅ +${bonus} 🔥` : '✅ +1');
    } else {
      s.sig.wrong++; s.sig.streakCurrent = 0; setStreakDisplay(0);
      sfx.nearMiss(); haptic([20, 30, 20]);
      setResultMsg('❌ Nope!');
    }
    setTimeout(() => setResultMsg(null), 1000);
    subPhaseTimerRef.current = setTimeout(() => {
      if (!s.running) return;
      s.liftOffset = [0, 0, 0];
      s.shamrockCupIdx = Math.floor(Math.random() * 3);
      s.roundSpeed = Math.min(6, 1 + s.sig.score * 0.15);
      startRound();
    }, 1400);
  }, [startRound]);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, correct: 0, wrong: 0, maxStreak: 0, streakCurrent: 0, roundsPlayed: 0 };
    s.roundSpeed = 1; s.shamrockCupIdx = Math.floor(Math.random() * 3);
    s.cupPositions = [-2.2, 0, 2.2];
    setScoreDisplay(0); setStreakDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('minimal');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x061206);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 2.5, 6);
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x0a1f0a, 4));
    const overLight = new THREE.DirectionalLight(0x22c55e, 2);
    overLight.position.set(0, 8, 5);
    scene.add(overLight);
    const groundLight = new THREE.PointLight(0x22c55e, 1.5, 12);
    groundLight.position.set(0, 3, 0);
    scene.add(groundLight);
    s.groundLight = groundLight;

    // Table (felt surface)
    const tableGeo = new THREE.BoxGeometry(9, 0.15, 4);
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x0f2e0f, roughness: 0.9 });
    const table = new THREE.Mesh(tableGeo, tableMat);
    table.position.y = -0.6;
    scene.add(table);
    // Table edge
    const edgeGeo = new THREE.BoxGeometry(9, 0.08, 0.1);
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x166534 });
    const edge = new THREE.Mesh(edgeGeo, edgeMat);
    edge.position.set(0, -0.52, 2);
    scene.add(edge);

    // Shamrock mesh (flat disc with emissive green)
    const shamrockGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.05, 16);
    const shamrockMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 0.8 });
    const shamrock = new THREE.Mesh(shamrockGeo, shamrockMat);
    scene.add(shamrock);
    s.shamrockMesh = shamrock;

    // Create 3 cups (cylinder + dome cap)
    const cupGroups: THREE.Group[] = [];
    for (let i = 0; i < 3; i++) {
      const group = new THREE.Group();
      const bodyGeo = new THREE.CylinderGeometry(0.4, 0.5, 1.0, 16);
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.4, metalness: 0.3 });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 0.5;
      group.add(body);
      // Rim
      const rimGeo = new THREE.TorusGeometry(0.42, 0.05, 6, 16);
      const rimMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 0.3 });
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 1.0;
      group.add(rim);
      group.position.set(s.cupPositions[i], -0.52, 0);
      scene.add(group);
      cupGroups.push(group);
    }
    s.cupMeshes = cupGroups;

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    (s as any)._cleanup = () => window.removeEventListener('resize', handleResize);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) { sfx.warning(); haptic([50, 30, 50]); }
      else if (s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    startRound();

    const loop = () => {
      if (!s.running) return;
      const now = Date.now();
      const t = now * 0.001;

      // Process cup swaps in shuffle phase
      if (s.subPhase === 'shuffle' && s.swaps.length > 0) {
        const swapIdx = Math.min(s.swaps.length - 1, Math.floor((now - s.swapStartTime) / s.swapDuration));
        const progress = Math.min(1, ((now - s.swapStartTime) % s.swapDuration) / s.swapDuration);
        const [slotA, slotB] = s.swaps[swapIdx];
        // Find which cup positions are in slotA and slotB
        // Cup positions stored by cup index, slot is position index
        // We need to find cup at position slotA and swap with slotB
        const xA = s.cupPositions[slotA], xB = s.cupPositions[slotB];
        // Interpolate
        cupGroups[slotA].position.x = xA + (xB - xA) * progress;
        cupGroups[slotB].position.x = xB + (xA - xB) * progress;
        if (progress >= 0.99) {
          // Commit swap in positions array
          const tmp = s.cupPositions[slotA];
          s.cupPositions[slotA] = s.cupPositions[slotB];
          s.cupPositions[slotB] = tmp;
          // Also track shamrock cup position
          if (s.shamrockCupIdx === slotA) s.shamrockCupIdx = slotB;
          else if (s.shamrockCupIdx === slotB) s.shamrockCupIdx = slotA;
        }
      }

      // Reveal phase: lift shamrock cup
      if (s.subPhase === 'reveal') {
        const revealProgress = Math.min(1, (now - s.swapStartTime + 500) / 600);
        const liftAmt = revealProgress * 1.5;
        cupGroups[s.shamrockCupIdx].position.y = -0.52 + liftAmt;
      } else if (s.subPhase === 'result') {
        const targetLift = s.liftOffset[s.shamrockCupIdx] || 0;
        cupGroups[s.shamrockCupIdx].position.y = -0.52 + targetLift;
      } else {
        // Reset cup Y
        cupGroups.forEach(c => { c.position.y = -0.52; });
      }

      // Update shamrock position under shamrock cup
      if (s.shamrockMesh) {
        const cupX = cupGroups[s.shamrockCupIdx].position.x;
        const cupLiftY = cupGroups[s.shamrockCupIdx].position.y;
        s.shamrockMesh.position.set(cupX, cupLiftY - 0.45, 0.01);
        const showShamrock = s.subPhase === 'reveal' || s.subPhase === 'result';
        const mat = s.shamrockMesh.material as THREE.MeshStandardMaterial;
        mat.opacity = showShamrock ? 1 : 0;
        mat.transparent = !showShamrock;
        s.shamrockMesh.rotation.y = t * 2;
      }

      // Choose phase: highlight cups
      if (s.subPhase === 'choose') {
        cupGroups.forEach((g, i) => {
          const mat = (g.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
          mat.emissive.setHex(0x22c55e);
          mat.emissiveIntensity = 0.1 + Math.sin(t * 3 + i) * 0.05;
        });
      } else {
        cupGroups.forEach(g => {
          const mat = (g.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        });
      }

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    // Cup tap detection
    const onTap = (e: PointerEvent) => {
      const s2 = stateRef.current;
      if (!s2.running || s2.subPhase !== 'choose') return;
      const rect = mountRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const allObjs: THREE.Object3D[] = [];
      cupGroups.forEach(g => g.traverse(c => { if ((c as THREE.Mesh).isMesh) allObjs.push(c); }));
      const hits = raycaster.intersectObjects(allObjs);
      if (hits.length > 0) {
        let hitCupIdx = -1;
        cupGroups.forEach((g, i) => { g.traverse(c => { if (c === hits[0].object) hitCupIdx = i; }); });
        if (hitCupIdx >= 0) handleCupTap(hitCupIdx);
      }
    };
    if (mountRef.current) mountRef.current.addEventListener('pointerdown', onTap);
    (s as any)._tapCleanup = () => mountRef.current?.removeEventListener('pointerdown', onTap);
  }, [endGame, startRound, handleCupTap]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (subPhaseTimerRef.current) clearTimeout(subPhaseTimerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    const s = stateRef.current;
    if (s.renderer) s.renderer.dispose();
    (s as any)._cleanup?.(); (s as any)._tapCleanup?.();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setStreakDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #0a1f0a 0%, #061206 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start Shuffling →" accentColor={accent} onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #0a1f0a 0%, #040d04 100%)" />
      )}
      {phase === 'countdown' && <Countdown onComplete={() => startLoop()} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <GameHUD accentColor={accent} items={[
          { label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 10 },
          { label: 'SCORE', value: scoreDisplay },
          { label: 'STREAK', value: streakDisplay },
        ]} />
      )}
      <AnimatePresence>
        {resultMsg && (
          <motion.div key="result" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1.2 }} exit={{ opacity: 0, y: -30 }} transition={{ duration: 0.4 }}
            style={{ position: 'fixed', top: '28%', left: '50%', transform: 'translateX(-50%)', zIndex: 80, pointerEvents: 'none', fontSize: 44, fontWeight: 900, color: resultMsg.startsWith('✅') ? '#4ade80' : '#ef4444', textShadow: '0 0 20px currentColor', whiteSpace: 'nowrap' }}>
            {resultMsg}
          </motion.div>
        )}
      </AnimatePresence>
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Correct', value: `${finalSig.correct} / ${finalSig.roundsPlayed}`, color: accent },
              { label: 'Accuracy', value: finalSig.roundsPlayed > 0 ? `${Math.round(finalSig.correct / finalSig.roundsPlayed * 100)}%` : '—', color: '#4ade80' },
              { label: 'Best Streak', value: `${finalSig.maxStreak}x`, color: '#fbbf24' },
              { label: 'Score', value: String(finalSig.score), color: accent },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.correct >= 4} />
          <WebhookHelper theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

function WebhookHelper({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}
