﻿﻿﻿'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, increaseMusicTempo, playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'whisper-bomb';
const GAME_ACCENT = '#ef4444';
const PB_KEY = 'pb_whisper-bomb';

type GameState = 'start' | 'requesting' | 'countdown' | 'playing' | 'done';
interface BehaviorData { avgVolume: number; noiseSpikes: number; dangerSeconds: number; defused: boolean; fuseRemaining: number; }
function getProfile(b: BehaviorData) {
  if (b.defused && b.noiseSpikes < 3) return 'Calm 🧘';
  if (b.noiseSpikes > 10) return 'Explosive 💥';
  return 'Reactive ⚡';
}

function WhisperBombInner() {
  const theme = useBrandTheme();
  const accent = theme.id !== 'ether' ? theme.colors.accent : GAME_ACCENT;
  const mountRef = useRef<HTMLDivElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef({
    fuse: 100, timeLeft: 45, volumeSamples: [] as number[],
    noiseSpikes: 0, dangerFrames: 0, quietStreak: 0,
    animId: 0, timerIntervalId: null as ReturnType<typeof setInterval> | null,
    stream: null as MediaStream | null,
    analyser: null as AnalyserNode | null,
    audioCtx: null as AudioContext | null,
    running: false, musicSped: false,
    lastSpikeTime: 0,
    fuseParticles: [] as { mesh: THREE.Mesh; vx: number; vy: number; life: number; color: number }[],
    frame: 0,
    bombMesh: null as THREE.Mesh | null,
    fuseMesh: null as THREE.Mesh | null,
    fuseGlowMesh: null as THREE.Mesh | null,
    scene: null as THREE.Scene | null,
    renderer: null as THREE.WebGLRenderer | null,
  });
  const touchVolumeRef = useRef<number>(0);
  const [micFallback, setMicFallback] = useState(false);
  const [gameState, setGameState] = useState<GameState>('start');
  const [displayTime, setDisplayTime] = useState(45);
  const [fuseDisplay, setFuseDisplay] = useState(100);
  const [streak, setStreak] = useState(0);
  const [behavior, setBehavior] = useState<BehaviorData | null>(null);
  const [micError, setMicError] = useState(false);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const getVolume = useCallback((): number => {
    const s = stateRef.current;
    if (!s.analyser) return touchVolumeRef.current;
    const data = new Uint8Array(s.analyser.frequencyBinCount);
    s.analyser.getByteFrequencyData(data);
    const sumSq = data.reduce((acc, v) => acc + v * v, 0);
    return Math.min(100, (Math.sqrt(sumSq / data.length) / 128) * 100);
  }, []);

  const endGame = useCallback((defused: boolean) => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.timerIntervalId) { clearInterval(s.timerIntervalId); s.timerIntervalId = null; }
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {});
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }

    const avgVol = s.volumeSamples.length > 0 ? s.volumeSamples.reduce((a, b) => a + b, 0) / s.volumeSamples.length : 0;
    const bData: BehaviorData = {
      avgVolume: avgVol,
      noiseSpikes: s.noiseSpikes,
      dangerSeconds: Math.round(s.dangerFrames / 60),
      defused,
      fuseRemaining: s.fuse,
    };
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      const score = defused ? 100 : Math.round(s.fuse);
      if (score > pb) localStorage.setItem(PB_KEY, String(score));
    } catch { }
    setBehavior(bData);
    setGameState('done');
    if (defused) hapticVictory(); else hapticFail();
  }, []);

  const startLoop = useCallback(async () => {
    const s = stateRef.current;
    // Request mic
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      s.stream = stream; s.analyser = analyser; s.audioCtx = ctx;
    } catch {
      setMicFallback(true); setMicError(true);
    }

    s.running = true; s.timeLeft = 45; s.fuse = 100;
    s.volumeSamples = []; s.noiseSpikes = 0; s.dangerFrames = 0;
    s.quietStreak = 0; setStreak(0); s.musicSped = false; s.lastSpikeTime = 0;
    s.fuseParticles = []; s.frame = 0;
    setFuseDisplay(100); setDisplayTime(45); setGameState('playing');
    stopMusicRef.current = startMusic('tense');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0d0800);
    s.renderer = renderer;
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 10);
    // === POLISH: Responsive resize handler ===
    const _onResizeHandler = () => {
      const _W = (mountRef.current?.clientWidth || window.innerWidth);
      const _H = (mountRef.current?.clientHeight || window.innerHeight);
      renderer.setSize(_W, _H);
      if (camera instanceof THREE.PerspectiveCamera) { (camera as THREE.PerspectiveCamera).aspect = _W / _H; camera.updateProjectionMatrix(); }
    };
    window.addEventListener('resize', _onResizeHandler);
    // === END POLISH ===
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x220000, 2));
    const dangerLight = new THREE.PointLight(0xef4444, 3, 20);
    dangerLight.position.set(0, 0, 5);
    scene.add(dangerLight);
    const coolLight = new THREE.PointLight(0x4ade80, 0, 15);
    coolLight.position.set(0, 3, 3);
    scene.add(coolLight);

    // Stars
    const starPos = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 40; starPos[i * 3 + 1] = (Math.random() - 0.5) * 30; starPos[i * 3 + 2] = -15 + (Math.random() - 0.5) * 10;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.08 })));

    // Bomb body
    const bombGeo = new THREE.SphereGeometry(1.4, 20, 20);
    const bombMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.3, metalness: 0.9, emissive: 0x220000, emissiveIntensity: 0.2 });
    const bombMesh = new THREE.Mesh(bombGeo, bombMat);
    bombMesh.castShadow = true;
    scene.add(bombMesh);
    s.bombMesh = bombMesh;

    // Spiral ring around bomb
    const spiralGeo = new THREE.TorusGeometry(1.7, 0.08, 8, 32);
    const spiralMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 0.5 });
    const spiral = new THREE.Mesh(spiralGeo, spiralMat);
    scene.add(spiral);

    // Fuse (cylinder that shrinks)
    const fuseGeo = new THREE.CylinderGeometry(0.08, 0.08, 2, 8);
    const fuseMat = new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.8 });
    const fuseMesh = new THREE.Mesh(fuseGeo, fuseMat);
    fuseMesh.position.set(0.8, 1.6, 0);
    fuseMesh.rotation.z = -0.5;
    scene.add(fuseMesh);
    s.fuseMesh = fuseMesh;

    // Fuse glow (spark at tip)
    const sparkGeo = new THREE.SphereGeometry(0.18, 10, 10);
    const sparkMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 1 });
    const spark = new THREE.Mesh(sparkGeo, sparkMat);
    spark.position.set(1.5, 2.5, 0);
    scene.add(spark);
    s.fuseGlowMesh = spark;

    const sparkLight = new THREE.PointLight(0xfbbf24, 3, 5);
    spark.add(sparkLight);

    // Defuse progress ring
    const defuseRingGeo = new THREE.TorusGeometry(2.0, 0.1, 8, 64);
    const defuseRingMat = new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x4ade80, emissiveIntensity: 0.5, transparent: true, opacity: 0.0 });
    const defuseRing = new THREE.Mesh(defuseRingGeo, defuseRingMat);
    defuseRing.rotation.x = Math.PI / 2;
    scene.add(defuseRing);

    // Touch events for mic fallback
    renderer.domElement.addEventListener('pointerdown', () => { touchVolumeRef.current = 70; });
    renderer.domElement.addEventListener('pointerup', () => { touchVolumeRef.current = 0; });

    s.timerIntervalId = setInterval(() => {
      s.timeLeft--; setDisplayTime(s.timeLeft);
      if (s.timeLeft <= 0) endGame(false);
    }, 1000);

    const NOISE_THRESHOLD = 20, SPIKE_THRESHOLD = 40;
    const FUSE_DRAIN_RATE = 0.8, FUSE_RECOVER_RATE = 0.3;

    const loop = () => {
      if (!s.running) return;
      s.frame++;
      const vol = getVolume();
      s.volumeSamples.push(vol);

      // Fuse logic
      const isNoise = vol > NOISE_THRESHOLD;
      const isSpike = vol > SPIKE_THRESHOLD;

      if (isSpike && Date.now() - s.lastSpikeTime > 300) {
        s.noiseSpikes++;
        s.lastSpikeTime = Date.now();
        sfx.tick(); hapticFail();
        // Spark burst
        for (let i = 0; i < 5; i++) {
          const pg = new THREE.SphereGeometry(0.08, 6, 6);
          const pm = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 1 });
          const pMesh = new THREE.Mesh(pg, pm);
          pMesh.position.copy(spark.position);
          scene.add(pMesh);
          const angle = Math.random() * Math.PI * 2;
          s.fuseParticles.push({ mesh: pMesh, vx: Math.cos(angle) * 0.1, vy: 0.05 + Math.random() * 0.1, life: 1, color: 0xfbbf24 });
        }
      }

      if (isNoise) {
        s.fuse -= FUSE_DRAIN_RATE;
        s.quietStreak = 0; setStreak(0);
        s.dangerFrames++;
      } else {
        s.fuse = Math.min(100, s.fuse + FUSE_RECOVER_RATE);
        s.quietStreak++; setStreak(Math.floor(s.quietStreak/60));
      }
      s.fuse = Math.max(0, Math.min(100, s.fuse));
      setFuseDisplay(Math.round(s.fuse));

      if (s.fuse <= 0) { sfx.fail(); haptic([100, 50, 200]); endGame(false); return; }

      // Check defuse (very quiet for a long time)
      if (s.quietStreak > 300) {
        sfx.success(); haptic([50, 30, 50, 30, 100]); endGame(true); return;
      }

      // Update bomb visuals
      const fusePct = s.fuse / 100;
      if (bombMesh) {
        (bombMat as THREE.MeshStandardMaterial).emissiveIntensity = 0.1 + (1 - fusePct) * 0.5;
        (bombMat as THREE.MeshStandardMaterial).emissive.setHex(fusePct > 0.5 ? 0x220000 : 0x440000);
        bombMesh.rotation.y += (1 - fusePct) * 0.02;
      }

      // Fuse shrinks
      if (fuseMesh) {
        fuseMesh.scale.y = Math.max(0.1, fusePct);
        fuseMesh.position.y = 1.6 * fusePct;
      }
      if (spark) {
        spark.position.set(0.8 + Math.sin(s.frame * 0.1) * 0.05, 0.5 + 2 * fusePct, 0);
        sparkLight.intensity = 2 + Math.sin(s.frame * 0.2) * 1;
      }

      // Spiral ring
      spiral.rotation.y += 0.02;
      spiral.rotation.z += 0.01;
      (spiralMat as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + (1 - fusePct) * 0.7;
      (spiralMat as THREE.MeshStandardMaterial).color.setHSL((1 - fusePct) * 0.02, 0.9, 0.5);

      // Defuse ring (shows when quiet)
      const quietPct = Math.min(1, s.quietStreak / 300);
      (defuseRingMat as THREE.MeshStandardMaterial).opacity = quietPct * 0.7;
      defuseRing.rotation.z += 0.02;
      defuseRing.scale.setScalar(1 + quietPct * 0.1);

      // Lights
      dangerLight.intensity = 3 + (1 - fusePct) * 3 + Math.sin(s.frame * 0.1) * 0.5;
      dangerLight.color.setHSL((1 - fusePct) * 0.02, 0.9, 0.5);
      coolLight.intensity = isNoise ? 0 : s.quietStreak / 100;

      // Fuse particles
      for (let i = s.fuseParticles.length - 1; i >= 0; i--) {
        const p = s.fuseParticles[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy;
        p.vy -= 0.003; p.life -= 0.04;
        (p.mesh.material as THREE.MeshStandardMaterial).opacity = p.life;
        (p.mesh.material as THREE.MeshStandardMaterial).transparent = true;
        if (p.life <= 0) { scene.remove(p.mesh); s.fuseParticles.splice(i, 1); }
      }

      // Camera shake when fuse low
      if (fusePct < 0.3 && isNoise) {
        camera.position.x = (Math.random() - 0.5) * 0.05 * (1 - fusePct);
        camera.position.y = (Math.random() - 0.5) * 0.05 * (1 - fusePct);
      } else {
        camera.position.x *= 0.9;
        camera.position.y *= 0.9;
      }

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, getVolume]);

  useEffect(() => () => {
    const s = stateRef.current; s.running = false; cancelAnimationFrame(s.animId);
    if (s.timerIntervalId) clearInterval(s.timerIntervalId);
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {});
    if (stopMusicRef.current) stopMusicRef.current();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setGameState('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    if (stateRef.current.renderer) { stateRef.current.renderer.dispose(); stateRef.current.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setGameState('start'); setFuseDisplay(100); setDisplayTime(45); setBehavior(null); setMicError(false); setMicFallback(false);
  }, []);

  return (
    <GameShell title="Whisper Bomb" emoji="💣" accentColor={accent} background="radial-gradient(ellipse at 50% 50%, #220000 0%, #0d0800 100%)">
      {gameState === 'start' && <GameStartScreen emoji="💣" title="Whisper Bomb" description="Stay SILENT to defuse the bomb. Any noise drains the fuse!" ctaLabel="Arm the Bomb 💣" accentColor={accent} onStart={handleStart} sensorNote="Uses microphone" />}
      {gameState === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(gameState === 'playing' || gameState === 'countdown') && (
        <div ref={mountRef} role="application" aria-label="Game area - tap to play" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {gameState === 'playing' && <>
        <GameHUD accentColor={accent} items={[{ label: 'TIME', value: displayTime, danger: displayTime <= 10 }, { label: 'FUSE', value: `${fuseDisplay}%`, danger: fuseDisplay <= 20 }, { label: 'SCORE', value: fuseDisplay }]} />
        <div style={{ position: 'fixed', bottom: '8%', left: '50%', transform: 'translateX(-50%)', color: fuseDisplay < 40 ? '#ef4444' : 'rgba(255,255,255,0.5)', fontSize: 15, fontWeight: 700, zIndex: 50 }}>
          {micFallback ? '🤫 Hold to make noise' : fuseDisplay < 40 ? '⚠️ STAY QUIET!' : '🤫 Shh...'}
        </div>
      </>}
            {gameState === 'playing' && streak >= 3 && (
        <div style={{ position: 'fixed', top: 128, left: '50%', transform: 'translateX(-50%)', zIndex: 25, pointerEvents: 'none', fontSize: 20, fontWeight: 900, color: '#fbbf24', textShadow: '0 0 16px #fbbf2488', letterSpacing: 1, whiteSpace: 'nowrap' }} aria-live="polite" aria-atomic="true">
          ⚡ x{Math.max(1,Math.floor(streak/3)+1)} Streak!
        </div>
      )}
      {gameState === 'done' && behavior && (
        <EndScreen gameId={GAME_ID} title={getProfile(behavior)} emoji={behavior.defused ? '✅' : '💥'} score={behavior.defused ? '100' : String(Math.round(behavior.fuseRemaining))}
          personality={getProfile(behavior)}
          insights={[{ label: 'Status', value: behavior.defused ? 'Defused! ✅' : 'BOOM! 💥', color: behavior.defused ? '#4ade80' : '#ef4444' }, { label: 'Noise Spikes', value: String(behavior.noiseSpikes), color: behavior.noiseSpikes < 3 ? '#4ade80' : '#ef4444' }, { label: 'Danger Seconds', value: `${behavior.dangerSeconds}s`, color: '#fbbf24' }, { label: 'Fuse Left', value: `${Math.round(behavior.fuseRemaining)}%`, color: accent }]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={behavior.defused} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const WhisperBomb = dynamic(() => Promise.resolve({ default: WhisperBombInner }), { ssr: false });
export default WhisperBomb;
