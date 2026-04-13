﻿﻿'use client';
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
import { motion, AnimatePresence } from 'framer-motion';

const GAME_ID = 'sound-waves';
const ACCENT = '#22d3ee';
const DURATION = 45;
const GAME_EMOJI = '🌊';
const GAME_TITLE = 'Sound Waves';
const GAME_TAGLINE = 'Shout to shatter. Louder waves hit harder.';
const PB_KEY = 'mg_pb_sound-waves';

interface Signals { score: number; targetsDestroyed: number; peakVolume: number; wavesFired: number; }
function getPersonality(sig: Signals): string {
  if (sig.targetsDestroyed >= 20 && sig.peakVolume > 0.75) return 'Sonic Destroyer 💥';
  if (sig.targetsDestroyed >= 14) return 'Wave Master 🌊';
  if (sig.peakVolume > 0.8) return 'Peak Screamer 🔊';
  if (sig.wavesFired >= 20) return 'Steady Pulsar 🔵';
  return 'Echo Chamber 🔇';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function SoundWavesGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const micRef = useRef<{ stream: MediaStream; analyser: AnalyserNode; data: Uint8Array } | null>(null);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    playerMesh: null as THREE.Mesh | null,
    playerLight: null as THREE.PointLight | null,
    waveRings: [] as { mesh: THREE.Mesh; r: number; maxR: number; power: number; life: number }[],
    targets: [] as { mesh: THREE.Mesh; light: THREE.PointLight; x: number; y: number; z: number; r: number; color: number; hp: number }[],
    running: false, streak: 0, timeLeft: DURATION,
    sig: { score: 0, targetsDestroyed: 0, peakVolume: 0, wavesFired: 0 } as Signals,
    micLevel: 0, smoothLevel: 0,
    lastWaveTime: 0, waveThreshold: 0.12,
    spawnTimer: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streak, setStreak] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stopMic = useCallback(() => {
    if (micRef.current) { micRef.current.stream.getTracks().forEach(t => t.stop()); micRef.current = null; }
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    stopMic();
    try { const pb = parseInt(localStorage.getItem(PB_KEY) || '0', 10); if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score)); } catch { /* ignore */ }
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, [stopMic]);

  const spawnTarget = useCallback((scene: THREE.Scene) => {
    const s = stateRef.current;
    const colors = [0xef4444, 0xf97316, 0xfbbf24, 0xa855f7, 0xec4899];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const angle = Math.random() * Math.PI * 2;
    const dist = 2 + Math.random() * 3;
    const x = Math.cos(angle) * dist;
    const y = (Math.random() - 0.5) * 3;
    const z = Math.sin(angle) * dist - 2;
    const r = 0.2 + Math.random() * 0.25;
    const geo = new THREE.IcosahedronGeometry(r, 1);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    const light = new THREE.PointLight(color, 1.5, 4);
    light.position.set(x, y, z);
    scene.add(light);
    s.targets.push({ mesh, light, x, y, z, r, color, hp: 1 });
  }, []);

  const startLoop = useCallback(async () => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, targetsDestroyed: 0, peakVolume: 0, wavesFired: 0 };
    s.waveRings = []; s.targets = []; s.spawnTimer = 0;
    setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x020a1a);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x020a1a, 12, 30);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0.5, 5);
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x020a1a, 3));
    const mainLight = new THREE.PointLight(0x22d3ee, 2, 20);
    mainLight.position.set(0, 5, 0);
    scene.add(mainLight);
    const playerLight = new THREE.PointLight(0x22d3ee, 3, 8);
    playerLight.position.set(0, 0, 2);
    scene.add(playerLight);
    s.playerLight = playerLight;

    // Stars
    const sp = new Float32Array(500*3);
    for (let i=0;i<500;i++){sp[i*3]=(Math.random()-.5)*60;sp[i*3+1]=(Math.random()-.5)*60;sp[i*3+2]=(Math.random()-.5)*60;}
    const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(sp,3));
    scene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0xffffff,size:0.05})));

    // Player (mic emitter sphere)
    const playerGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const playerMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 0.5, roughness: 0.2 });
    const playerMesh = new THREE.Mesh(playerGeo, playerMat);
    playerMesh.position.set(0, 0, 2);
    scene.add(playerMesh);
    s.playerMesh = playerMesh;

    // Spawn initial targets
    for (let i = 0; i < 5; i++) spawnTarget(scene);

    // Setup mic
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256; source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      micRef.current = { stream, analyser, data };
    } catch { /* no mic, use tap */ }

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    (s as any)._cleanup = () => window.removeEventListener('resize', handleResize);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const fireWave = (power: number) => {
      const s2 = stateRef.current;
      if (!s2.scene) return;
      const geo = new THREE.SphereGeometry(0.1, 12, 12);
      const mat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 1, transparent: true, opacity: 0.8, wireframe: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, 0, 2);
      s2.scene.add(mesh);
      s2.sig.wavesFired++;
      s2.waveRings.push({ mesh, r: 0.1, maxR: 5 + power * 3, power, life: 1 });
    };

    const loop = () => {
      if (!s.running) return;
      const t = Date.now() * 0.001;
      s.spawnTimer++;

      // Read mic
      if (micRef.current) {
        micRef.current.analyser.getByteFrequencyData(micRef.current.data as Uint8Array<ArrayBuffer>);
        let sum = 0;
        for (let i = 0; i < micRef.current.data.length; i++) sum += micRef.current.data[i];
        s.micLevel = sum / (micRef.current.data.length * 255);
        s.smoothLevel += (s.micLevel - s.smoothLevel) * 0.3;
        if (s.micLevel > s.sig.peakVolume) s.sig.peakVolume = s.micLevel;
        // Fire wave on loud sound
        if (s.smoothLevel > s.waveThreshold && Date.now() - s.lastWaveTime > 400) {
          s.lastWaveTime = Date.now();
          fireWave(Math.min(1, s.smoothLevel * 3));
          haptic([20]);
        }
      }

      // Spawn targets
      if (s.spawnTimer % 90 === 0 && s.targets.length < 8) spawnTarget(scene);

      // Player pulse
      const playerMat = playerMesh.material as THREE.MeshStandardMaterial;
      playerMat.emissiveIntensity = 0.3 + s.smoothLevel * 3 + Math.sin(t * 4) * 0.1;
      playerLight.intensity = 2 + s.smoothLevel * 5;

      // Wave rings expand
      for (let wi = s.waveRings.length - 1; wi >= 0; wi--) {
        const w = s.waveRings[wi];
        w.r += 0.08 + w.power * 0.04;
        w.mesh.scale.setScalar(w.r);
        const mat = w.mesh.material as THREE.MeshStandardMaterial;
        mat.opacity = (1 - w.r / w.maxR) * 0.8;
        // Check target hits
        for (let ti = s.targets.length - 1; ti >= 0; ti--) {
          const tgt = s.targets[ti];
          const dx = tgt.x - 0, dy = tgt.y - 0, dz = tgt.z - 2;
          const dist = Math.sqrt(dx*dx+dy*dy+dz*dz);
          if (Math.abs(dist - w.r) < tgt.r + 0.15) {
            tgt.hp -= w.power * 0.7;
            if (tgt.hp <= 0) {
              scene.remove(tgt.mesh); scene.remove(tgt.light);
              s.targets.splice(ti, 1);
              s.sig.targetsDestroyed++;
              const pts = Math.round(2 + w.power * 4);
              s.sig.score += pts; setScoreDisplay(s.sig.score); s.streak=(s.streak||0)+1; setStreak(s.streak); const _sw=Math.max(1,Math.floor(s.streak/3)+1); if(_sw>1){s.sig.score+=pts*(_sw-1); setScoreDisplay(s.sig.score);}
              sfx.success(); hapticScore();
            }
          }
        }
        if (w.r >= w.maxR) { scene.remove(w.mesh); s.waveRings.splice(wi, 1); }
      }

      // Targets float
      s.targets.forEach(tgt => {
        tgt.mesh.rotation.x = t * 0.4; tgt.mesh.rotation.y = t * 0.6;
        const mat = tgt.mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.4 + Math.sin(t * 2 + tgt.x) * 0.2;
      });

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    // Tap fallback
    const onTap = () => {
      const s2 = stateRef.current;
      if (!s2.running) return;
      if (!micRef.current) {
        s2.lastWaveTime = Date.now();
        fireWave(0.5);
      }
    };
    if (mountRef.current) mountRef.current.addEventListener('pointerdown', onTap);
    (s as any)._tapCleanup = () => mountRef.current?.removeEventListener('pointerdown', onTap);
  }, [endGame, spawnTarget, stopMic]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    const s = stateRef.current;
    if (s.renderer) s.renderer.dispose();
    stopMic();
    (s as any)._cleanup?.(); (s as any)._tapCleanup?.();
  }, [stopMic]);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Allow Mic & Shout! 🔊" sensorNote="Uses microphone — tap as fallback"
          accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} role="application" aria-label="Game area - tap to play" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <GameHUD accentColor={accent} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
          { label: 'SCORE', value: scoreDisplay },
        ]} />
      )}
      {phase === 'playing' && streak >= 3 && (
        <div style={{ position: 'fixed', top: 128, left: '50%', transform: 'translateX(-50%)', zIndex: 25, pointerEvents: 'none', fontSize: 20, fontWeight: 900, color: '#fbbf24', textShadow: '0 0 16px #fbbf2488', letterSpacing: 1, whiteSpace: 'nowrap' }} aria-live="polite" aria-atomic="true">
          ⚡ x{Math.max(1,Math.floor(streak/3)+1)} Streak!
        </div>
      )}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Destroyed', value: String(finalSig.targetsDestroyed), color: accent },
              { label: 'Peak Volume', value: `${Math.round(finalSig.peakVolume * 100)}%`, color: '#fbbf24' },
              { label: 'Waves Fired', value: String(finalSig.wavesFired), color: '#a855f7' },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.targetsDestroyed >= 10} />
          <WebhookHelper theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

function WebhookHelper({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score, targetsDestroyed: sig.targetsDestroyed, peakVolume: sig.peakVolume }, player); }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const SoundWavesGame = dynamic(() => Promise.resolve({ default: SoundWavesGameInner }), { ssr: false });
export default SoundWavesGame;
