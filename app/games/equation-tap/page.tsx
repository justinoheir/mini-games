'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'equation-tap';
const ACCENT = '#facc15';
const DURATION = 45;
const GAME_EMOJI = '🔢';
const GAME_TITLE = 'Equation Tap';
const GAME_TAGLINE = 'Math at the speed of thought.';

interface Signals { score: number; hits: number; attempts: number; reactionTimes: number[]; maxStreak: number; streakCurrent: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  const avg = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length : 9999;
  if (acc >= 0.75 && avg < 700) return 'Math Genius 🧮';
  if (acc >= 0.55) return 'Calculator 🔢';
  if (sig.maxStreak >= 4) return 'Getting There ✏️';
  return 'Still Counting 🧩';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

const QUESTIONS = [
  { q: '3 + 8', ans: 11, opts: [9, 10, 11, 12] },
  { q: '15 - 7', ans: 8, opts: [6, 7, 8, 9] },
  { q: '4 × 4', ans: 16, opts: [12, 14, 16, 18] },
  { q: '20 ÷ 5', ans: 4, opts: [3, 4, 5, 6] },
  { q: '9 + 6', ans: 15, opts: [13, 14, 15, 16] },
  { q: '7 × 3', ans: 21, opts: [18, 20, 21, 24] },
  { q: '36 ÷ 6', ans: 6, opts: [4, 5, 6, 7] },
  { q: '13 - 5', ans: 8, opts: [7, 8, 9, 10] },
  { q: '8 × 6', ans: 48, opts: [40, 44, 48, 56] },
  { q: '25 + 17', ans: 42, opts: [40, 42, 44, 45] },
];

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  correctIdx: number; opts: number[]; q: string;
  answered: boolean; qSpawnTime: number;
  qTimeout: ReturnType<typeof setTimeout> | null;
}

export default function EquationTapGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, hits: 0, attempts: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 },
    correctIdx: 0, opts: [], q: '', answered: false, qSpawnTime: 0, qTimeout: null,
  });
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    answerTiles: THREE.Mesh[]; tileLights: THREE.PointLight[];
    questionCanvas: HTMLCanvasElement; questionTexture: THREE.CanvasTexture;
    questionMesh: THREE.Mesh;
    particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }>;
    animId: number; frame: number;
  } | null>(null);

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);

  const updateQuestionTexture = useCallback((q: string, opts: number[]) => {
    const t = threeRef.current; if (!t) return;
    const canvas = t.questionCanvas;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 512, 256);
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 80px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#facc15';
    ctx.fillText(`${q} = ?`, 256, 128);
    t.questionTexture.needsUpdate = true;
  }, []);

  const updateAnswerLabels = useCallback((opts: number[], correctIdx: number) => {
    const t = threeRef.current; if (!t) return;
    t.answerTiles.forEach((tile, i) => {
      const mat = tile.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.2;
      t.tileLights[i].intensity = 0.5;
      // Store answer index for raycasting
      (tile.userData as Record<string, unknown>).optIdx = i;
      (tile.userData as Record<string, unknown>).correct = (i === correctIdx);
    });
  }, []);

  const nextQ = useCallback(() => {
    const s = stateRef.current; if (!s.running) return;
    if (s.qTimeout) clearTimeout(s.qTimeout);
    const q = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
    const opts = [...q.opts].sort(() => Math.random() - 0.5);
    const correctIdx = opts.indexOf(q.ans);
    s.correctIdx = correctIdx; s.opts = opts; s.q = q.q;
    s.answered = false; s.qSpawnTime = Date.now(); s.sig.attempts++;
    updateQuestionTexture(q.q, opts);
    updateAnswerLabels(opts, correctIdx);

    // Update answer tile text labels via userData
    const t = threeRef.current;
    if (t) {
      t.answerTiles.forEach((tile, i) => {
        (tile.userData as Record<string, unknown>).label = String(opts[i]);
      });
    }

    s.qTimeout = setTimeout(() => {
      if (!s.running || s.answered) return;
      s.sig.streakCurrent = 0; s.answered = true;
      sfx.fail?.(); hapticFail();
      setTimeout(() => { if (s.running) nextQ(); }, 500);
    }, 5000);
  }, [updateQuestionTexture, updateAnswerLabels]);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    if (s.qTimeout) clearTimeout(s.qTimeout);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, hits: 0, attempts: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('minimal');

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x14120a);
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14120a);
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 9);

    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const yellowLight = new THREE.PointLight(0xfacc15, 2, 15);
    yellowLight.position.set(0, 3, 5);
    scene.add(yellowLight);

    // Stars
    const starPos = new Float32Array(200 * 3);
    for (let i = 0; i < 200; i++) { starPos[i*3] = (Math.random()-0.5)*20; starPos[i*3+1] = (Math.random()-0.5)*15; starPos[i*3+2] = -5 - Math.random()*10; }
    const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xfacc15, size: 0.06, transparent: true, opacity: 0.3 })));

    // Question panel (top)
    const qCanvas = document.createElement('canvas');
    qCanvas.width = 512; qCanvas.height = 256;
    const qTexture = new THREE.CanvasTexture(qCanvas);
    const qPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(5.5, 2.2),
      new THREE.MeshBasicMaterial({ map: qTexture, transparent: true })
    );
    qPanel.position.set(0, 2.2, 0);
    scene.add(qPanel);

    // 4 answer tiles in 2x2
    const TILE_COLS = [0xef4444, 0x06b6d4, 0xa855f7, 0x22c55e];
    const TILE_POS = [[-1.4, 0.2, 0], [1.4, 0.2, 0], [-1.4, -1.5, 0], [1.4, -1.5, 0]];
    const answerTiles: THREE.Mesh[] = [];
    const tileLights: THREE.PointLight[] = [];

    TILE_COLS.forEach((color, i) => {
      const geo = new THREE.BoxGeometry(2.2, 1.2, 0.2);
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2, metalness: 0.3, roughness: 0.4 });
      const tile = new THREE.Mesh(geo, mat);
      tile.position.set(TILE_POS[i][0], TILE_POS[i][1], TILE_POS[i][2]);
      tile.userData = { optIdx: i, correct: false, label: '?' };
      scene.add(tile);
      answerTiles.push(tile);

      const tl = new THREE.PointLight(color, 0.5, 5);
      tl.position.set(TILE_POS[i][0], TILE_POS[i][1], 1);
      scene.add(tl);
      tileLights.push(tl);
    });

    const particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }> = [];
    const obj = { renderer, scene, camera, answerTiles, tileLights, questionCanvas: qCanvas, questionTexture: qTexture, questionMesh: qPanel, particles, animId: 0, frame: 0 };
    threeRef.current = obj;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    setTimeout(() => { if (s.running) nextQ(); }, 400);

    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      obj.frame++;
      const t0 = obj.frame * 0.05;
      // Tile idle animation
      answerTiles.forEach((tile, i) => {
        tile.rotation.y = Math.sin(t0 * 0.4 + i * 0.8) * 0.03;
        tile.position.z = TILE_POS[i][2] + Math.sin(t0 * 0.6 + i * 0.5) * 0.05;
      });

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.vy -= 0.004; p.life -= 0.03;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, p.life);
        if (p.life <= 0) { scene.remove(p.mesh); particles.splice(i, 1); }
      }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
  }, [endGame, nextQ]);

  useEffect(() => {
    const mount = mountRef.current; if (!mount || phase !== 'playing') return;
    const onTap = (e: PointerEvent) => {
      e.preventDefault();
      const t = threeRef.current; if (!t) return;
      const s = stateRef.current; if (!s.running || s.answered) return;
      const rect = mount.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), t.camera);
      const hits = raycaster.intersectObjects(t.answerTiles);
      if (hits.length === 0) return;
      const tile = hits[0].object as THREE.Mesh;
      const { correct, optIdx } = tile.userData as { correct: boolean; optIdx: number; label: string };
      s.answered = true;
      if (s.qTimeout) clearTimeout(s.qTimeout);

      const mat = tile.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.2;
      t.tileLights[optIdx].intensity = 5;

      if (correct) {
        s.sig.hits++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const rt = Date.now() - s.qSpawnTime; s.sig.reactionTimes.push(rt);
        const pts = s.sig.streakCurrent >= 3 ? 3 : 2;
        s.sig.score += pts;
        setScoreDisplay(s.sig.score);
        sfx.success?.(); hapticScore();
        // Particle burst
        for (let i = 0; i < 8; i++) {
          const pMesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 1 }));
          pMesh.position.copy(tile.position);
          t.scene.add(pMesh);
          const angle = (i / 8) * Math.PI * 2;
          t.particles.push({ mesh: pMesh, vx: Math.cos(angle)*0.08, vy: Math.abs(Math.sin(angle))*0.08+0.02, vz: 0.02, life: 1 });
        }
      } else {
        s.sig.streakCurrent = 0;
        mat.emissive.set(0xef4444);
        setTimeout(() => { mat.emissive.set((tile.material as THREE.MeshStandardMaterial).color); mat.emissiveIntensity = 0.2; }, 400);
        // Show correct
        const correctTile = t.answerTiles.find(tl => tl.userData.correct);
        if (correctTile) (correctTile.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.0;
        sfx.fail?.(); hapticFail();
      }
      setTimeout(() => { if (s.running) nextQ(); }, 600);
    };
    mount.addEventListener('pointerdown', onTap);
    return () => mount.removeEventListener('pointerdown', onTap);
  }, [phase, nextQ]);

  useEffect(() => () => {
    const s = stateRef.current;
    if (s.qTimeout) clearTimeout(s.qTimeout);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);
  const buildInsights = (sig: Signals) => {
    const acc = sig.attempts > 0 ? Math.round((sig.hits/sig.attempts)*100) : 0;
    const avg = sig.reactionTimes.length > 0 ? Math.round(sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length) : 0;
    return [
      { label: 'Accuracy', value: `${acc}%`, color: acc >= 70 ? '#4ade80' : '#facc15' },
      { label: 'Best Streak', value: `×${sig.maxStreak}`, color: ACCENT },
      { label: 'Avg Speed', value: avg > 0 ? `${avg}ms` : '-', color: '#06b6d4' },
      { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start Solving 🔢" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <>
              <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />
              {/* Answer labels overlaid */}
              {threeRef.current && stateRef.current.opts.length === 4 && stateRef.current.opts.map((opt, i) => (
                <div key={i} style={{ position: 'absolute', pointerEvents: 'none', fontWeight: 900, fontSize: 28, color: '#fff', textShadow: '0 0 10px rgba(0,0,0,0.8)', ...([
                  { bottom: '53%', left: '18%' },
                  { bottom: '53%', right: '18%' },
                  { bottom: '29%', left: '18%' },
                  { bottom: '29%', right: '18%' },
                ][i]) }}>{opt}</div>
              ))}
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.hits >= 10} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score }, player);
  }, [theme, sig, personality, player]);
  return null;
}
