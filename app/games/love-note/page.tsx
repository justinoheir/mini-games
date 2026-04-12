'use client';
/**
 * LOVE NOTE — 3D hearts floating in space. Simon Says with glowing 3D hearts.
 */
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

const GAME_ID = 'love-note';
const PB_KEY = 'pb_love-note';
const ACCENT = '#ec4899';
const GAME_EMOJI = '💌';
const GAME_TITLE = 'Love Note';
const GAME_TAGLINE = 'Remember the sequence. Tap it back. From the heart.';
const MAX_LIVES = 3;

type HeartId = 'red' | 'pink' | 'purple' | 'gold';

const HEART_DATA: Record<HeartId, { color: number; emissive: number; css: string }> = {
  red:    { color: 0xef4444, emissive: 0x7f1d1d, css: '#ef4444' },
  pink:   { color: 0xec4899, emissive: 0x831843, css: '#ec4899' },
  purple: { color: 0xa855f7, emissive: 0x581c87, css: '#a855f7' },
  gold:   { color: 0xfbbf24, emissive: 0x92400e, css: '#fbbf24' },
};
const HEART_IDS: HeartId[] = ['red', 'pink', 'purple', 'gold'];

interface HeartMesh { mesh: THREE.Mesh; light: THREE.PointLight; id: HeartId; }
interface Signals { score: number; roundsCompleted: number; maxSequenceLength: number; totalErrors: number; maxStreak: number; perfectRounds: number; }

function getPersonality(sig: Signals): string {
  if (sig.perfectRounds >= 5 && sig.maxSequenceLength >= 7) return 'Heart Whisperer 💖';
  if (sig.roundsCompleted >= 8) return 'Love Note Master 💌';
  if (sig.maxSequenceLength >= 6) return 'Memory of Love 💝';
  if (sig.roundsCompleted >= 4) return 'Romantic Recall 💕';
  return 'Learning to Love 🌸';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function createHeart3D(color: number, emissive: number): THREE.Group {
  // Approximate heart with two spheres + a cone
  const group = new THREE.Group();
  const mat = new THREE.MeshPhongMaterial({ color, emissive, emissiveIntensity: 0.4, shininess: 80 });

  const leftSphere = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 14), mat);
  leftSphere.position.set(-0.38, 0.25, 0);
  group.add(leftSphere);

  const rightSphere = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 14), mat);
  rightSphere.position.set(0.38, 0.25, 0);
  group.add(rightSphere);

  const bottomCone = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.1, 4), mat);
  bottomCone.rotation.z = Math.PI;
  bottomCone.position.set(0, -0.1, 0);
  group.add(bottomCone);

  return group;
}

function LoveNoteGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, lives: MAX_LIVES,
    sig: { score: 0, roundsCompleted: 0, maxSequenceLength: 0, totalErrors: 0, maxStreak: 0, perfectRounds: 0 } as Signals,
    sequence: [] as HeartId[],
    playerInput: [] as HeartId[],
    roundPhase: 'watch' as 'watch' | 'recall',
    hearts: [] as HeartMesh[],
    streakCurrent: 0,
    roundErrors: 0,
    scene: null as THREE.Scene | null,
    renderer: null as THREE.WebGLRenderer | null,
    camera: null as THREE.PerspectiveCamera | null,
    raycaster: new THREE.Raycaster(),
    pendingClick: null as THREE.Vector2 | null,
    flashTimeouts: [] as ReturnType<typeof setTimeout>[],
    particles: [] as { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number; color: number }[],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [lives, setLives] = useState(MAX_LIVES);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [roundPhaseDisplay, setRoundPhaseDisplay] = useState<'watch' | 'recall'>('watch');
  const [isNewBest, setIsNewBest] = useState(false);
  const { pops, triggerPop } = useScorePop();

  const flashHeart = useCallback((id: HeartId, duration = 400) => {
    const s = stateRef.current;
    const hm = s.hearts.find(h => h.id === id);
    if (!hm) return;
    const data = HEART_DATA[id];
    (hm.mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 2;
    hm.light.intensity = 5;
    setTimeout(() => {
      (hm.mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 0.4;
      hm.light.intensity = 0.5;
    }, duration);
  }, []);

  const endGame = useCallback((outOfLives = false) => {
    const s = stateRef.current;
    s.running = false;
    s.flashTimeouts.forEach(t => clearTimeout(t));
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
      if (s.sig.score > pb) { localStorage.setItem(PB_KEY, String(s.sig.score)); setIsNewBest(true); }
    } catch { /**/ }
    setFinalSig({ ...s.sig }); setPhase('done');
    hapticVictory(); playVictoryFanfare();
  }, []);

  const startRound = useCallback((seqLen: number) => {
    const s = stateRef.current;
    const seq = Array.from({ length: seqLen }, () => HEART_IDS[Math.floor(Math.random() * 4)]);
    s.sequence = seq; s.playerInput = []; s.roundPhase = 'watch'; s.roundErrors = 0;
    if (seq.length > s.sig.maxSequenceLength) s.sig.maxSequenceLength = seq.length;
    setRoundPhaseDisplay('watch');

    s.flashTimeouts.forEach(t => clearTimeout(t));
    s.flashTimeouts = [];

    let delay = 400;
    seq.forEach((id, i) => {
      const t = setTimeout(() => {
        if (s.running) { flashHeart(id, 400); sfx.countdown(); haptic([20]); }
      }, delay + i * 650);
      s.flashTimeouts.push(t);
    });
    const totalDelay = delay + seq.length * 650 + 200;
    const t2 = setTimeout(() => {
      if (s.running) { s.roundPhase = 'recall'; setRoundPhaseDisplay('recall'); }
    }, totalDelay);
    s.flashTimeouts.push(t2);
  }, [flashHeart]);

  const startLoop = useCallback(() => {
    if (!mountRef.current) return;
    const s = stateRef.current;
    s.running = true; s.lives = MAX_LIVES;
    s.sig = { score: 0, roundsCompleted: 0, maxSequenceLength: 0, totalErrors: 0, maxStreak: 0, perfectRounds: 0 };
    s.streakCurrent = 0; s.hearts = []; s.particles = [];
    setLives(MAX_LIVES); setScoreDisplay(0); setPhase('playing');
    stopMusicRef.current = startMusic('chill');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0510);
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0510, 0.04);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 200);
    camera.position.set(0, 0, 10);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x1a0818, 5));
    const pinkLight = new THREE.PointLight(0xec4899, 2, 20);
    pinkLight.position.set(0, 5, 5);
    scene.add(pinkLight);

    // Star field
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(500 * 3);
    for (let i = 0; i < 500; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 40;
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 30;
      starPos[i * 3 + 2] = (Math.random() - 0.5) * 20 - 5;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffc0cb, size: 0.04, transparent: true, opacity: 0.4 })));

    // Place 4 hearts in a 2x2 grid
    const positions = [[-2.5, 2], [2.5, 2], [-2.5, -1.5], [2.5, -1.5]];
    HEART_IDS.forEach((id, i) => {
      const data = HEART_DATA[id];
      const group = createHeart3D(data.color, data.emissive);
      group.position.set(positions[i][0], positions[i][1], 0);
      scene.add(group);

      // Find mesh for raycasting (use first child)
      const mesh = group.children[0] as THREE.Mesh;
      mesh.userData.heartId = id;

      const light = new THREE.PointLight(data.color, 0.5, 5);
      light.position.set(positions[i][0], positions[i][1], 2);
      scene.add(light);

      s.hearts.push({ mesh, light, id });
    });

    setTimeout(() => { if (s.running) startRound(3); }, 600);

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

      // Process click
      if (s.pendingClick && s.roundPhase === 'recall') {
        s.raycaster.setFromCamera(s.pendingClick, camera);
        const heartMeshes = s.hearts.map(h => h.mesh);
        const hits = s.raycaster.intersectObjects(heartMeshes);
        if (hits.length > 0) {
          const hitMesh = hits[0].object as THREE.Mesh;
          const heartId = hitMesh.userData.heartId as HeartId;
          const expectedId = s.sequence[s.playerInput.length];

          flashHeart(heartId, 300);

          if (heartId === expectedId) {
            s.playerInput.push(heartId);
            sfx.collect(); haptic([20]);

            if (s.playerInput.length === s.sequence.length) {
              // Round complete!
              s.sig.roundsCompleted++;
              s.streakCurrent++;
              if (s.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.streakCurrent;
              if (s.roundErrors === 0) s.sig.perfectRounds++;
              const pts = s.sequence.length * 15;
              s.sig.score += pts; setScoreDisplay(s.sig.score);
              playScoreHit(); hapticScore();
              triggerPop(`+${pts}`, window.innerWidth / 2, 150);
              // Burst particles from all hearts
              s.hearts.forEach(hm => {
                const data = HEART_DATA[hm.id];
                for (let p = 0; p < 5; p++) {
                  const pm = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), new THREE.MeshBasicMaterial({ color: data.color, transparent: true, opacity: 1 }));
                  pm.position.copy(hm.mesh.position);
                  scene.add(pm);
                  s.particles.push({ mesh: pm, vx: (Math.random() - 0.5) * 0.12, vy: 0.08, vz: 0.05, life: 1, color: data.color });
                }
              });
              setTimeout(() => { if (s.running) startRound(Math.min(3 + Math.floor(s.sig.roundsCompleted / 2), 8)); }, 700);
            }
          } else {
            s.sig.totalErrors++; s.roundErrors++; s.streakCurrent = 0;
            sfx.collision(); hapticFail();
            s.lives--;
            setLives(s.lives);
            s.playerInput = [];
            if (s.lives <= 0) { endGame(); return; }
            setTimeout(() => { if (s.running) startRound(s.sequence.length); }, 600);
          }
        }
        s.pendingClick = null;
      }

      // Pulse hearts
      s.hearts.forEach((hm, i) => {
        const mat = hm.mesh.material as THREE.MeshPhongMaterial;
        if (s.roundPhase === 'recall') {
          mat.emissiveIntensity = 0.3 + Math.sin(t * 3 + i * 1.5) * 0.15;
        }
      });

      // Particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.vy -= 0.004; p.life -= 0.03;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life;
        if (p.life <= 0) { scene.remove(p.mesh); s.particles.splice(i, 1); }
      }

      pinkLight.intensity = 1.5 + Math.sin(t * 2) * 0.5;
      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      s.running = false;
      s.flashTimeouts.forEach(t2 => clearTimeout(t2));
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [endGame, startRound, flashHeart, triggerPop]);

  useEffect(() => {
    const el = mountRef.current; if (!el) return;
    const onDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current; if (!s.renderer) return;
      const rect = s.renderer.domElement.getBoundingClientRect();
      s.pendingClick = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    };
    el.addEventListener('pointerdown', onDown);
    return () => el.removeEventListener('pointerdown', onDown);
  }, [phase]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    stateRef.current.flashTimeouts.forEach(t => clearTimeout(t));
    stateRef.current.renderer?.dispose();
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); sfx.click(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setFinalSig(null); setLives(MAX_LIVES); setIsNewBest(false); }, []);

  const livesHtml = Array.from({ length: MAX_LIVES }, (_, i) => (
    <span key={i} style={{ fontSize: 18, opacity: i < lives ? 1 : 0.3 }}>💖</span>
  ));

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="radial-gradient(ellipse 80% 70% at 50% 30%,#1a0510 0%,#0e030a 60%,#050108 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Tap From the Heart 💖" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none', touchAction: 'none' }} />
      {phase === 'playing' && (
        <>
          <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'SCORE', value: scoreDisplay }]} />
          <div style={{ position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 50, display: 'flex', gap: 4 }}>{livesHtml}</div>
          <div style={{ position: 'fixed', top: 100, left: '50%', transform: 'translateX(-50%)', zIndex: 50, pointerEvents: 'none', background: roundPhaseDisplay === 'watch' ? 'rgba(236,72,153,0.2)' : 'rgba(74,222,128,0.2)', border: `1px solid ${roundPhaseDisplay === 'watch' ? '#ec4899' : '#4ade80'}`, borderRadius: 20, padding: '5px 16px', color: roundPhaseDisplay === 'watch' ? '#fbcfe8' : '#86efac', fontSize: 13, fontWeight: 700 }}>
            {roundPhaseDisplay === 'watch' ? '💖 WATCH' : '✋ REPEAT'}
          </div>
          <ScorePopEffect pops={pops} accentColor={ACCENT} />
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Rounds Done', value: `${finalSig.roundsCompleted}`, color: ACCENT },
            { label: 'Max Length', value: `${finalSig.maxSequenceLength}`, color: '#fbbf24' },
            { label: 'Perfect Rounds', value: `${finalSig.perfectRounds}`, color: '#4ade80' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#a855f7' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.roundsCompleted >= 5} />
      )}
      {phase === 'done' && finalSig && <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />}
      <AnimatePresence>
        {isNewBest && (
          <motion.div key="pb" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)', zIndex: 90, pointerEvents: 'none', background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', borderRadius: 20, padding: '8px 20px', fontSize: 20, fontWeight: 900, color: '#000' }}>
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, roundsCompleted: sig.roundsCompleted }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const LoveNoteGame = dynamic(() => Promise.resolve({ default: LoveNoteGameInner }), { ssr: false });
export default LoveNoteGame;
