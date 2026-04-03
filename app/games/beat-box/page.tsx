'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, playScoreHit, playVictoryFanfare } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'beat-box';
const PB_KEY = 'mg_pb_beat-box';
const ACCENT = '#f97316';
const DURATION = 60;
const GAME_EMOJI = '🥁';
const GAME_TITLE = 'Beat Box';

const NUM_LANES = 4;
const LANE_HEX = [0xf97316, 0x06b6d4, 0xa855f7, 0x22c55e];
const HIT_Z = 3.5;
const HIT_WIN = 0.7;
const PERFECT_WIN = 0.25;

interface Tile3D { lane: number; mesh: THREE.Mesh; z: number; speed: number; hit: boolean; missed: boolean; }
interface Signals { score: number; hits: number; perfectHits: number; misses: number; maxStreak: number; }
function getPersonality(s: Signals): string {
  const acc = (s.hits + s.misses) > 0 ? s.hits / (s.hits + s.misses) : 0;
  if (acc >= 0.85 && s.perfectHits >= 10) return 'Human Drum Machine 🥁';
  if (acc >= 0.70) return 'Groove Master 🎵';
  if (s.perfectHits >= 8) return 'Beat Surgeon 🎯';
  return 'Rhythm Apprentice 🎶';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  tiles: Tile3D[]; laneButtons: THREE.Mesh[]; hitFlash: number[];
  beatTimer: number; bpm: number; frame: number; streak: number;
  stopMusic: (() => void) | null;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

const LANE_SPACING = 1.8;

export default function BeatBoxGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, hits: 0, perfectHits: 0, misses: 0, maxStreak: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    tiles: [], laneButtons: [], hitFlash: [0, 0, 0, 0],
    beatTimer: 0, bpm: 120, frame: 0, streak: 0,
    stopMusic: null, intervalId: null, resizeCleanup: null,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (s.stopMusic) { s.stopMusic(); s.stopMusic = null; }
    s.resizeCleanup?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    try {
      const prev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (s.sig.score > prev) localStorage.setItem(PB_KEY, String(s.sig.score));
    } catch { /* */ }
    setFinalSig({ ...s.sig });
    setPhase('done'); hapticVictory(); playVictoryFanfare();
  }, []);

  const spawnTile = useCallback((scene: THREE.Scene, s: GS) => {
    const lane = Math.floor(Math.random() * NUM_LANES);
    const speed = 0.08 + (s.bpm - 120) / 1000;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_SPACING * 0.85, 0.18, 0.5),
      new THREE.MeshStandardMaterial({
        color: LANE_HEX[lane], emissive: LANE_HEX[lane],
        emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.3
      })
    );
    const laneX = (lane - 1.5) * LANE_SPACING;
    mesh.position.set(laneX, 0.15, -12);
    scene.add(mesh);
    s.tiles.push({ lane, mesh, z: -12, speed, hit: false, missed: false });
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { score: 0, hits: 0, perfectHits: 0, misses: 0, maxStreak: 0 };
    s.tiles = []; s.hitFlash = [0, 0, 0, 0]; s.bpm = 120; s.streak = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a1a);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a1a, 0.025);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 3.5, 7);
    // === POLISH: Enhanced rim + fill lighting ===
    const rimLightA = new THREE.PointLight(0x4466ff, 1.2, 20);
    rimLightA.position.set(-6, 5, 3);
    scene.add(rimLightA);
    const fillLightB = new THREE.PointLight(0xff6644, 0.8, 15);
    fillLightB.position.set(6, -3, 5);
    scene.add(fillLightB);
    // === END POLISH ===
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x111133, 2.5));
    LANE_HEX.forEach((hex, i) => {
      const l = new THREE.PointLight(hex, 0.8, 15);
      l.position.set((i - 1.5) * LANE_SPACING, 3, HIT_Z);
      scene.add(l);
    });

    // Lane tracks
    LANE_HEX.forEach((hex, i) => {
      const laneX = (i - 1.5) * LANE_SPACING;
      const track = new THREE.Mesh(
        new THREE.BoxGeometry(LANE_SPACING * 0.9, 0.05, 20),
        new THREE.MeshStandardMaterial({ color: hex, transparent: true, opacity: 0.15, roughness: 0.8 })
      );
      track.position.set(laneX, 0, -3);
      scene.add(track);

      // Lane dividers
      const divider = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.1, 20),
        new THREE.MeshBasicMaterial({ color: 0x333355, transparent: true, opacity: 0.5 })
      );
      divider.position.set(laneX + LANE_SPACING / 2, 0.08, -3);
      scene.add(divider);
    });

    // Hit zone line
    const hitLine = new THREE.Mesh(
      new THREE.BoxGeometry(NUM_LANES * LANE_SPACING + 0.2, 0.08, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 })
    );
    hitLine.position.set(0, 0.1, HIT_Z);
    scene.add(hitLine);

    // Hit buttons
    s.laneButtons = [];
    LANE_HEX.forEach((hex, i) => {
      const btn = new THREE.Mesh(
        new THREE.BoxGeometry(LANE_SPACING * 0.85, 0.2, 0.6),
        new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.3, roughness: 0.4, metalness: 0.3 })
      );
      btn.position.set((i - 1.5) * LANE_SPACING, 0.12, HIT_Z + 0.1);
      scene.add(btn);
      s.laneButtons.push(btn);
    });

    // Star background
    const sPos = new Float32Array(400 * 3);
    for (let i = 0; i < 400; i++) {
      sPos[i * 3] = (Math.random() - 0.5) * 30;
      sPos[i * 3 + 1] = Math.random() * 15;
      sPos[i * 3 + 2] = -15 - Math.random() * 15;
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0x8888ff, size: 0.06, transparent: true, opacity: 0.6 })));

    s.stopMusic = startMusic('drive');
    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    s.resizeCleanup = () => window.removeEventListener('resize', handleResize);

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--; setTimeLeft(s.timeLeft);
      s.bpm = Math.min(180, 120 + (DURATION - s.timeLeft) * 1);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const BEAT_INTERVAL_FRAMES = 30;
    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Spawn tiles on beat
      s.beatTimer++;
      const beatFrames = Math.max(15, BEAT_INTERVAL_FRAMES - (s.bpm - 120) / 4);
      if (s.beatTimer >= beatFrames) {
        s.beatTimer = 0;
        spawnTile(scene, s);
        if (Math.random() < 0.4) spawnTile(scene, s); // occasional double
      }

      // Update tiles
      for (let i = s.tiles.length - 1; i >= 0; i--) {
        const t = s.tiles[i];
        if (t.hit) {
          const mat = t.mesh.material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity -= 0.05;
          mat.opacity = (mat.opacity ?? 1) - 0.08;
          if (mat.emissiveIntensity <= 0) {
            scene.remove(t.mesh); s.tiles.splice(i, 1);
          }
          continue;
        }
        t.z += t.speed;
        t.mesh.position.z = t.z;

        // Missed
        if (t.z > HIT_Z + HIT_WIN + 1 && !t.missed) {
          t.missed = true;
          s.sig.misses++; s.streak = 0;
          const mat = t.mesh.material as THREE.MeshStandardMaterial;
          mat.color.setHex(0x333333); mat.emissive.setHex(0x111111);
          setTimeout(() => { if (t.mesh.parent) scene.remove(t.mesh); }, 300);
          s.tiles.splice(i, 1);
        }
      }

      // Hit flash update
      s.hitFlash = s.hitFlash.map(f => Math.max(0, f - 1));
      s.laneButtons.forEach((btn, i) => {
        const mat = btn.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = s.hitFlash[i] > 0 ? 1.0 : 0.25 + Math.sin(Date.now() * 0.003 + i) * 0.05;
      });

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, spawnTile]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      const rect = mount.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      // Map screen x to 4 lanes
      const lane = Math.min(3, Math.floor(nx * NUM_LANES));
      // Find closest tile in this lane near hit zone
      let bestTile: Tile3D | null = null;
      let bestDist = Infinity;
      for (const t of s.tiles) {
        if (t.lane !== lane || t.hit || t.missed) continue;
        const dist = Math.abs(t.z - HIT_Z);
        if (dist < HIT_WIN && dist < bestDist) {
          bestDist = dist; bestTile = t;
        }
      }
      if (bestTile) {
        bestTile.hit = true;
        const isPerfect = bestDist < PERFECT_WIN;
        const pts = isPerfect ? 3 : 1;
        s.sig.hits++;
        if (isPerfect) s.sig.perfectHits++;
        s.streak++;
        if (s.streak > s.sig.maxStreak) s.sig.maxStreak = s.streak;
        const mult = s.streak >= 5 ? 2 : 1;
        s.sig.score += pts * mult; setScoreDisplay(s.sig.score);
        sfx.collect(); hapticScore();
        if (isPerfect) playScoreHit('default', s.sig.score);
        const mat = bestTile.mesh.material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(0xffffff); mat.emissiveIntensity = 1;
        s.hitFlash[lane] = 8;
      } else {
        s.sig.misses++; s.streak = 0;
        sfx.collision?.(); hapticFail?.();
        s.hitFlash[lane] = 4;
      }
    };
    mount.addEventListener('pointerdown', onPointerDown);
    return () => mount.removeEventListener('pointerdown', onPointerDown);
  }, [phase]);

  useEffect(() => () => {
    const s = stateRef.current;
    s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.stopMusic) s.stopMusic();
    s.resizeCleanup?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="Tap the colored lanes as tiles reach the hit zone. Perfect timing = max points!"
          ctaLabel="Drop the beat! 🥁" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        display: phase === 'playing' ? 'block' : 'none', touchAction: 'none',
      }} />
      {phase === 'playing' && (
        <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
          { label: 'SCORE', value: scoreDisplay },
        ]} />
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Hits', value: String(finalSig.hits), color: ACCENT },
            { label: 'Perfect', value: String(finalSig.perfectHits), color: '#fbbf24' },
            { label: 'Misses', value: String(finalSig.misses), color: '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.hits >= 20} />
      )}
    </GameShell>
  );
}
