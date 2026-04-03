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
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';

const GAME_ID = 'whistle-launch';
const ACCENT = '#f59e0b';
const DURATION = 45;
const GAME_EMOJI = '🎯';
const GAME_TITLE = 'Whistle Launch';
const GAME_TAGLINE = 'Sharp spike fires. Hit every target!';
const PB_KEY = 'mg_pb_whistle-launch';
const SPIKE_MIN = 0.45, SPIKE_DELTA = 0.22;
const TARGET_COUNT = 6;

interface Signals { score: number; hits: number; misses: number; maxStreak: number; peakVolume: number; }
function getPersonality(sig: Signals): string {
  const acc = (sig.hits + sig.misses) > 0 ? sig.hits / (sig.hits + sig.misses) : 0;
  if (acc >= 0.85 && sig.maxStreak >= 4) return 'Dead Eye 🎯';
  if (sig.hits >= 18) return 'Marksman 🏹';
  if (acc >= 0.75) return 'Sharpshooter ⚡';
  if (sig.peakVolume > 0.85) return 'Thundervoice 🌩️';
  return 'Training Day 🌱';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

interface Target3D { mesh: THREE.Mesh; glowMesh: THREE.Mesh; x: number; y: number; r: number; hp: number; hitAt: number; }
interface Projectile3D { mesh: THREE.Mesh; x: number; y: number; vx: number; vy: number; }

export default function WhistleLaunchGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    sig: { score: 0, hits: 0, misses: 0, maxStreak: 0, peakVolume: 0 } as Signals,
    analyser: null as AnalyserNode | null,
    audioCtx: null as AudioContext | null,
    stream: null as MediaStream | null,
    lastVol: 0, streakCurrent: 0,
    targets: [] as Target3D[],
    projectiles: [] as Projectile3D[],
    aimX: 0, aimY: 0,
    frame: 0,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [micError, setMicError] = useState(false);
  const [isNewBest, setIsNewBest] = useState(false);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const getVolume = useCallback((): number => {
    const s = stateRef.current;
    if (!s.analyser) return 0;
    const data = new Uint8Array(s.analyser.frequencyBinCount);
    s.analyser.getByteFrequencyData(data);
    return data.reduce((a, b) => a + b, 0) / data.length / 255;
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {});
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0', 10);
      if (s.sig.score > pb) { localStorage.setItem(PB_KEY, String(s.sig.score)); setIsNewBest(true); }
    } catch { }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(async () => {
    const s = stateRef.current;
    // Request mic
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      s.stream = stream; s.analyser = analyser; s.audioCtx = ctx;
    } catch { setMicError(true); }

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { score: 0, hits: 0, misses: 0, maxStreak: 0, peakVolume: 0 };
    s.lastVol = 0; s.streakCurrent = 0; s.targets = []; s.projectiles = []; s.aimX = 0; s.aimY = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a1a);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0a1a, 20, 50);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 14);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x111122, 2));
    const pLight = new THREE.PointLight(0xf59e0b, 4, 25);
    pLight.position.set(0, 3, 5);
    scene.add(pLight);
    const sLight = new THREE.PointLight(0xfbbf24, 2, 20);
    sLight.position.set(-4, -2, 3);
    scene.add(sLight);

    // Background (shooting range)
    const bgGeo = new THREE.PlaneGeometry(20, 12);
    const bgMat = new THREE.MeshStandardMaterial({ color: 0x0f0f1a, roughness: 0.9 });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    bg.position.z = -2;
    scene.add(bg);

    // Stars
    const starPos = new Float32Array(400 * 3);
    for (let i = 0; i < 400; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 50; starPos[i * 3 + 1] = (Math.random() - 0.5) * 30; starPos[i * 3 + 2] = -15 + (Math.random() - 0.5) * 5;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07 })));

    // Crosshair (aim indicator)
    const crossGroup = new THREE.Group();
    const hLine = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.3, 0, 0), new THREE.Vector3(0.3, 0, 0)]);
    const vLine = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, 0.3, 0)]);
    crossGroup.add(new THREE.Line(hLine, new THREE.LineBasicMaterial({ color: 0xfbbf24 })));
    crossGroup.add(new THREE.Line(vLine, new THREE.LineBasicMaterial({ color: 0xfbbf24 })));
    const crossRingGeo = new THREE.RingGeometry(0.18, 0.22, 20);
    const crossRingMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, side: THREE.DoubleSide });
    crossGroup.add(new THREE.Mesh(crossRingGeo, crossRingMat));
    scene.add(crossGroup);

    // Target colors
    const TARGET_COLORS = [0xef4444, 0xf97316, 0xec4899, 0xa855f7, 0x38bdf8, 0x4ade80];

    const spawnTargets = () => {
      s.targets.forEach(t => { scene.remove(t.mesh); scene.remove(t.glowMesh); });
      s.targets = [];
      for (let i = 0; i < TARGET_COUNT; i++) {
        const color = TARGET_COLORS[i % TARGET_COLORS.length];
        const r = 0.55 + Math.random() * 0.3;
        const geo = new THREE.TorusGeometry(r, r * 0.15, 8, 32);
        const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, roughness: 0.4 });
        const mesh = new THREE.Mesh(geo, mat);
        const x = (Math.random() - 0.5) * 12;
        const y = (Math.random() - 0.5) * 7;
        mesh.position.set(x, y, 0);
        scene.add(mesh);

        // Glow
        const glowGeo = new THREE.SphereGeometry(r * 0.6, 10, 10);
        const glowMat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.15, emissive: color, emissiveIntensity: 0.5 });
        const glowMesh = new THREE.Mesh(glowGeo, glowMat);
        glowMesh.position.copy(mesh.position);
        scene.add(glowMesh);

        s.targets.push({ mesh, glowMesh, x, y, r, hp: 1, hitAt: 0 });
      }
    };
    spawnTargets();

    // Touch to aim
    const onMove = (e: PointerEvent) => {
      if (!s.running) return;
      const rect = renderer.domElement.getBoundingClientRect();
      s.aimX = ((e.clientX - rect.left) / rect.width - 0.5) * 13;
      s.aimY = -((e.clientY - rect.top) / rect.height - 0.5) * 9;
    };
    // Touch fire (fallback for no mic)
    const onDown = (e: PointerEvent) => {
      if (!s.running || !s.analyser) {
        // No mic: tap to fire
        fireProjectile();
      }
      const rect = renderer.domElement.getBoundingClientRect();
      s.aimX = ((e.clientX - rect.left) / rect.width - 0.5) * 13;
      s.aimY = -((e.clientY - rect.top) / rect.height - 0.5) * 9;
    };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerdown', onDown);

    const fireProjectile = () => {
      const geo = new THREE.SphereGeometry(0.18, 8, 8);
      const mat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 1 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(-6, 0, 0.5);
      scene.add(mesh);
      const dx = s.aimX - (-6), dy = s.aimY - 0;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      s.projectiles.push({ mesh, x: -6, y: 0, vx: (dx / len) * 0.4, vy: (dy / len) * 0.4 });
      const pLight2 = new THREE.PointLight(0xfbbf24, 3, 3);
      mesh.add(pLight2);
    };

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      const vol = getVolume();
      if (vol > s.sig.peakVolume) s.sig.peakVolume = vol;

      // Detect spike = fire
      const isSpike = vol > SPIKE_MIN && vol - s.lastVol > SPIKE_DELTA;
      if (isSpike) {
        fireProjectile();
        sfx.tick(); hapticScore();
      }
      s.lastVol = vol;

      // Aim follows touch or smoothly
      crossGroup.position.set(s.aimX, s.aimY, 0.5);
      crossGroup.rotation.z += 0.01;

      // Projectiles
      for (let i = s.projectiles.length - 1; i >= 0; i--) {
        const p = s.projectiles[i];
        p.x += p.vx; p.y += p.vy;
        p.mesh.position.set(p.x, p.y, 0.5);

        if (Math.abs(p.x) > 10 || Math.abs(p.y) > 8) {
          scene.remove(p.mesh); s.projectiles.splice(i, 1);
          s.sig.misses++; s.streakCurrent = 0;
          continue;
        }

        // Check target hits
        let hit = false;
        for (let j = s.targets.length - 1; j >= 0; j--) {
          const t = s.targets[j];
          if (t.hp <= 0) continue;
          const dist = Math.hypot(p.x - t.x, p.y - t.y);
          if (dist < t.r + 0.2) {
            t.hp--; hit = true;
            if (t.hp <= 0) {
              t.hitAt = Date.now();
              s.sig.hits++; s.streakCurrent++;
              if (s.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.streakCurrent;
              const pts = s.streakCurrent >= 3 ? 2 : 1;
              s.sig.score += pts; setScoreDisplay(s.sig.score);
              sfx.collect(); hapticScore();
              // Flash target
              (t.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 2;
              (t.glowMesh.material as THREE.MeshStandardMaterial).opacity = 0.6;
              setTimeout(() => {
                scene.remove(t.mesh); scene.remove(t.glowMesh);
                s.targets.splice(s.targets.indexOf(t), 1);
                if (s.targets.length === 0) spawnTargets();
              }, 200);
            }
            scene.remove(p.mesh); s.projectiles.splice(i, 1);
            break;
          }
        }
      }

      // Pulse targets
      s.targets.forEach((t, i) => {
        if (t.hp <= 0) return;
        t.mesh.rotation.z += 0.015;
        (t.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + Math.sin(s.frame * 0.05 + i * 1.2) * 0.15;
        (t.glowMesh.material as THREE.MeshStandardMaterial).opacity = 0.1 + Math.sin(s.frame * 0.05 + i) * 0.06;
      });

      pLight.intensity = 4 + vol * 3;

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, getVolume]);

  useEffect(() => () => {
    const s = stateRef.current; s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {});
    if (stopMusicRef.current) stopMusicRef.current();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    if (stateRef.current.renderer) { stateRef.current.renderer.dispose(); stateRef.current.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false); setMicError(false);
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Lock & Load 🎯" accentColor={accent} onStart={handleStart} sensorNote="Uses microphone" />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <>
        <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />
        <div style={{ position: 'fixed', bottom: '8%', left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.5)', fontSize: 13, zIndex: 50 }}>
          {micError ? '📱 Tap to shoot!' : '🎤 Whistle to shoot!'}
        </div>
      </>}
      {phase === 'done' && finalSig && <>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Hits', value: String(finalSig.hits), color: '#4ade80' }, { label: 'Misses', value: String(finalSig.misses), color: finalSig.misses === 0 ? '#4ade80' : '#ef4444' }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: accent }, { label: 'Peak Volume', value: `${Math.round(finalSig.peakVolume * 100)}%`, color: '#fbbf24' }]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.hits >= 10} />
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      </>}
    </GameShell>
  );
}
