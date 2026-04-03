'use client';
/**
 * FREQUENCY TUNE 3D — Tone plays, tap the matching 3D frequency tile.
 * Each tile shows a unique 3D sine-wave-like ripple visual.
 */
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

const GAME_ID   = 'frequency-tune';
const ACCENT    = '#a78bfa';
const DURATION  = 45;
const GAME_EMOJI   = '🎵';
const GAME_TITLE   = 'Frequency Tune';
const GAME_TAGLINE = 'Hear the tone. Tap the matching frequency tile.';
const Q_TIMEOUT_MS = 4000;

const FREQS = [
  { hz: 220, label: '220 Hz', color: 0x3b82f6 },
  { hz: 330, label: '330 Hz', color: 0x06b6d4 },
  { hz: 440, label: '440 Hz', color: 0x4ade80 },
  { hz: 550, label: '550 Hz', color: 0xfacc15 },
  { hz: 660, label: '660 Hz', color: 0xf97316 },
  { hz: 880, label: '880 Hz', color: 0xef4444 },
];
const NF = FREQS.length;

async function playToneHz(hz: number, durationS = 0.7) {
  try {
    const T = await import('tone');
    if (T.context.state !== 'running') await T.start();
    const synth = new T.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.02, decay: 0.05, sustain: 0.9, release: 0.3 }, volume: -8 }).toDestination();
    synth.triggerAttackRelease(hz, durationS);
    setTimeout(() => synth.dispose(), (durationS + 0.5) * 1000);
  } catch { /**/ }
}

interface Signals { score: number; correctTaps: number; wrongTaps: number; maxStreak: number; streakCurrent: number; avgReactionMs: number; reactionTimes: number[]; }
function getPersonality(s: Signals): string {
  const acc = (s.correctTaps + s.wrongTaps) > 0 ? s.correctTaps / (s.correctTaps + s.wrongTaps) : 0;
  if (acc >= 0.85 && s.maxStreak >= 5) return 'Frequency Master 🎵';
  if (acc >= 0.7) return 'Pitch Perfect 🎶';
  if (s.maxStreak >= 6) return 'Streak Listener 🔥';
  return 'Tuning Up 📻';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  correctIdx: number; answered: boolean; qSpawnTime: number;
  questionTimeout: ReturnType<typeof setTimeout> | null;
}

export default function FrequencyTuneGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, correctTaps: 0, wrongTaps: 0, maxStreak: 0, streakCurrent: 0, avgReactionMs: 0, reactionTimes: [] },
    correctIdx: 0, answered: false, qSpawnTime: 0, questionTimeout: null,
  });
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    tiles: THREE.Mesh[]; tileLights: THREE.PointLight[];
    tileWaves: Array<{ points: THREE.Points; positions: Float32Array }>;
    animId: number; frame: number;
  } | null>(null);

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    if (s.questionTimeout) { clearTimeout(s.questionTimeout); s.questionTimeout = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
    try {
      const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
      if (s.sig.score > pb) { localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score)); setIsNewBest(true); }
    } catch { /**/ }
    if (s.sig.reactionTimes.length > 0) s.sig.avgReactionMs = Math.round(s.sig.reactionTimes.reduce((a,b)=>a+b,0)/s.sig.reactionTimes.length);
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const nextQuestion = useCallback(() => {
    const s = stateRef.current; if (!s.running) return;
    if (s.questionTimeout) clearTimeout(s.questionTimeout);
    s.correctIdx = Math.floor(Math.random() * NF);
    s.answered = false;
    s.qSpawnTime = Date.now();
    // Reset tile dim
    const t = threeRef.current;
    if (t) {
      t.tiles.forEach((tile, i) => {
        (tile.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2;
        t.tileLights[i].intensity = 0.5;
      });
    }
    void playToneHz(FREQS[s.correctIdx].hz);
    s.questionTimeout = setTimeout(() => {
      if (!s.running || s.answered) return;
      s.sig.streakCurrent = 0; s.answered = true;
      sfx.fail?.(); hapticFail();
      setTimeout(() => { if (s.running) nextQuestion(); }, 600);
    }, Q_TIMEOUT_MS);
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, correctTaps: 0, wrongTaps: 0, maxStreak: 0, streakCurrent: 0, avgReactionMs: 0, reactionTimes: [] };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x06020f);
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06020f);
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 8);
    // === POLISH: Enhanced rim + fill lighting ===
    const rimLightA = new THREE.PointLight(0x4466ff, 1.2, 20);
    rimLightA.position.set(-6, 5, 3);
    scene.add(rimLightA);
    const fillLightB = new THREE.PointLight(0xff6644, 0.8, 15);
    fillLightB.position.set(6, -3, 5);
    scene.add(fillLightB);
    // === END POLISH ===

    scene.add(new THREE.AmbientLight(0xffffff, 0.25));

    // Stars
    const starPos = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) { starPos[i*3] = (Math.random()-0.5)*30; starPos[i*3+1] = (Math.random()-0.5)*20; starPos[i*3+2] = -8 - Math.random()*12; }
    const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xa78bfa, size: 0.07, transparent: true, opacity: 0.5 })));

    // 6 tiles in 3x2 grid
    const TILE_POSITIONS = [[-2.2, 1.5, 0], [0, 1.5, 0], [2.2, 1.5, 0], [-2.2, -0.6, 0], [0, -0.6, 0], [2.2, -0.6, 0]];
    const tiles: THREE.Mesh[] = [];
    const tileLights: THREE.PointLight[] = [];
    const tileWaves: Array<{ points: THREE.Points; positions: Float32Array }> = [];

    FREQS.forEach((freq, i) => {
      const geo = new THREE.BoxGeometry(1.8, 1.8, 0.18);
      const mat = new THREE.MeshStandardMaterial({ color: freq.color, emissive: freq.color, emissiveIntensity: 0.2, metalness: 0.3, roughness: 0.4 });
      const tile = new THREE.Mesh(geo, mat);
      tile.position.set(TILE_POSITIONS[i][0], TILE_POSITIONS[i][1], TILE_POSITIONS[i][2]);
      scene.add(tile);
      tiles.push(tile);

      // Frequency wave on tile face (particles)
      const waveCount = 40;
      const wPos = new Float32Array(waveCount * 3);
      const wGeo = new THREE.BufferGeometry();
      wGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3));
      const wave = new THREE.Points(wGeo, new THREE.PointsMaterial({ color: freq.color, size: 0.05, transparent: true, opacity: 0.8 }));
      wave.position.copy(tile.position);
      wave.position.z += 0.1;
      scene.add(wave);
      tileWaves.push({ points: wave, positions: wPos });

      const tl = new THREE.PointLight(freq.color, 0.5, 5);
      tl.position.set(TILE_POSITIONS[i][0], TILE_POSITIONS[i][1], 1);
      scene.add(tl);
      tileLights.push(tl);
    });

    const obj = { renderer, scene, camera, tiles, tileLights, tileWaves, animId: 0, frame: 0 };
    threeRef.current = obj;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    setTimeout(() => { if (s.running) nextQuestion(); }, 500);

    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      obj.frame++;
      const t0 = obj.frame * 0.05;

      // Animate sine wave on each tile face
      tileWaves.forEach((tw, ti) => {
        const freq = FREQS[ti];
        const waveFreqMult = (ti + 1) * 0.8;
        const pos = tw.positions;
        for (let j = 0; j < 40; j++) {
          pos[j*3]   = -0.75 + (j / 39) * 1.5;
          pos[j*3+1] = Math.sin((j / 39) * Math.PI * 2 * waveFreqMult + t0 * (1 + ti * 0.3)) * 0.3;
          pos[j*3+2] = 0;
        }
        tw.points.geometry.attributes.position.needsUpdate = true;
        // Wave amplitude scales with tile activation
        const mat = tiles[ti].material as THREE.MeshStandardMaterial;
        const isLit = mat.emissiveIntensity > 0.5;
        (tw.points.material as THREE.PointsMaterial).opacity = isLit ? 1.0 : 0.5;
        (tw.points.material as THREE.PointsMaterial).size = isLit ? 0.08 : 0.04;
      });

      // Tile idle animation
      tiles.forEach((tile, i) => {
        tile.position.z = TILE_POSITIONS[i][2] + Math.sin(t0 * 0.5 + i * 0.7) * 0.05;
      });

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
  }, [endGame, nextQuestion]);

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
      const hits = raycaster.intersectObjects(t.tiles);
      if (hits.length === 0) return;
      const tileIdx = t.tiles.indexOf(hits[0].object as THREE.Mesh);
      if (tileIdx < 0) return;

      s.answered = true;
      if (s.questionTimeout) clearTimeout(s.questionTimeout);

      // Light up the tapped tile
      (t.tiles[tileIdx].material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2;
      t.tileLights[tileIdx].intensity = 5;

      if (tileIdx === s.correctIdx) {
        s.sig.correctTaps++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const rt = Date.now() - s.qSpawnTime; s.sig.reactionTimes.push(rt);
        const pts = 2 * (s.sig.streakCurrent >= 3 ? 2 : 1);
        s.sig.score += pts;
        setScoreDisplay(s.sig.score);
        sfx.success?.(); hapticScore();
      } else {
        s.sig.wrongTaps++;
        s.sig.streakCurrent = 0;
        // Flash wrong tile red
        (t.tiles[tileIdx].material as THREE.MeshStandardMaterial).emissive.set(0xef4444);
        setTimeout(() => {
          (t.tiles[tileIdx].material as THREE.MeshStandardMaterial).emissive.set(FREQS[tileIdx].color);
          (t.tiles[tileIdx].material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2;
          t.tileLights[tileIdx].intensity = 0.5;
        }, 400);
        // Show correct
        (t.tiles[s.correctIdx].material as THREE.MeshStandardMaterial).emissiveIntensity = 1.0;
        sfx.fail?.(); hapticFail();
      }
      setTimeout(() => { if (s.running) nextQuestion(); }, 700);
    };
    mount.addEventListener('pointerdown', onTap);
    return () => mount.removeEventListener('pointerdown', onTap);
  }, [phase, nextQuestion]);

  useEffect(() => () => {
    const s = stateRef.current;
    if (s.questionTimeout) clearTimeout(s.questionTimeout);
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
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false); }, []);
  const buildInsights = (sig: Signals) => [
    { label: 'Correct', value: String(sig.correctTaps), color: '#4ade80' },
    { label: 'Wrong', value: String(sig.wrongTaps), color: '#ef4444' },
    { label: 'Best Streak', value: `×${sig.maxStreak}`, color: ACCENT },
    { label: 'Avg React', value: sig.avgReactionMs > 0 ? `${sig.avgReactionMs}ms` : '-', color: 'var(--color-text)' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Tune In 🎵" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.correctTaps >= 10} />
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
    postWebhook(theme, GAME_ID, { personality, score: sig.score, correctTaps: sig.correctTaps, wrongTaps: sig.wrongTaps, maxStreak: sig.maxStreak, avgReactionMs: sig.avgReactionMs }, player);
  }, [theme, sig, personality, player]);
  return null;
}
