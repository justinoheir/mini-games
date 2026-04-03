'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo, hapticTick } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'rhythm-repeat';
const ACCENT = '#f59e0b';
const DURATION = 60;
const GAME_EMOJI = '🎵';
const GAME_TITLE = 'Rhythm Repeat';

interface Signals {
  roundsCompleted: number; longestPattern: number; avgTimingError: number;
  totalTimingError: number; totalBeats: number; wrongBeats: number;
  score: number; maxStreak: number; streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const avgError = sig.totalBeats > 0 ? sig.totalTimingError / sig.totalBeats : 9999;
  if (avgError < 80 && sig.longestPattern >= 6) return 'Rhythm Master 🎶';
  if (sig.longestPattern >= 7) return 'Beat Keeper 🥁';
  if (avgError < 120) return 'On the Beat 🎵';
  if (sig.wrongBeats === 0 && sig.roundsCompleted >= 4) return 'Clean Rhythm ✨';
  return 'Finding the Groove 🎸';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';
type SubPhase = 'show' | 'input' | 'result';

interface Beat { delay: number; isShort: boolean; }

function makePattern(level: number): Beat[] {
  const count = 3 + Math.min(level, 5);
  const beats: Beat[] = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    const isShort = Math.random() < 0.4;
    beats.push({ delay: t, isShort });
    t += isShort ? 250 : 500;
  }
  return beats;
}

export default function RhythmRepeatGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scheduleRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    drumMesh: null as THREE.Mesh | null,
    drumLight: null as THREE.PointLight | null,
    beatOrbs: [] as THREE.Mesh[],
    patternRings: [] as THREE.Mesh[],
    running: false, timeLeft: DURATION,
    sig: { roundsCompleted: 0, longestPattern: 0, avgTimingError: 0, totalTimingError: 0, totalBeats: 0, wrongBeats: 0, score: 0, maxStreak: 0, streakCurrent: 0 } as Signals,
    subPhase: 'show' as SubPhase,
    pattern: [] as Beat[],
    playerTaps: [] as number[],
    inputStartMs: 0, showBeatIdx: -1, activeBeat: false, activeBeatTimer: 0,
    level: 1, resultTimer: 0, success: false,
    drumPulse: 0, drumFlash: 0,
    particles: [] as { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }[],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const clearSchedule = useCallback(() => {
    scheduleRef.current.forEach(t => clearTimeout(t));
    scheduleRef.current = [];
  }, []);

  const endGame = useCallback(() => {
    clearSchedule();
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    const pb = parseInt(localStorage.getItem('pb_' + GAME_ID) ?? '0');
    if (s.sig.score > pb) localStorage.setItem('pb_' + GAME_ID, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, [clearSchedule]);

  const evaluateRound = useCallback(() => {
    const s = stateRef.current;
    s.subPhase = 'result';
    const patternTimes = s.pattern.map(b => b.delay);
    const playerTimes = s.playerTaps.slice(0, s.pattern.length);
    let totalError = 0, correct = 0;
    const margin = 300;
    patternTimes.forEach((expected, i) => {
      if (i < playerTimes.length) {
        const err = Math.abs(playerTimes[i] - expected);
        totalError += err;
        if (err <= margin) correct++;
      }
    });
    const accuracy = s.pattern.length > 0 ? correct / s.pattern.length : 0;
    s.success = accuracy >= 0.6;
    if (s.success) {
      s.sig.roundsCompleted++; s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      if (s.pattern.length > s.sig.longestPattern) s.sig.longestPattern = s.pattern.length;
      s.sig.totalBeats += s.pattern.length; s.sig.totalTimingError += totalError;
      const pts = s.pattern.length + (s.sig.streakCurrent >= 3 ? 2 : 0);
      s.sig.score += pts; setScoreDisplay(s.sig.score);
      s.level = Math.min(7, 1 + Math.floor(s.sig.roundsCompleted / 3));
      hapticCombo(s.sig.streakCurrent); sfx.collect();
      // Flash drum green
      if (s.drumMesh) (s.drumMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x00ff88);
    } else {
      s.sig.wrongBeats += s.pattern.length - correct;
      s.sig.streakCurrent = 0;
      sfx.collision(); hapticFail();
      if (s.drumMesh) (s.drumMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0xef4444);
    }
    s.resultTimer = 50;
  }, []);

  const startRound = useCallback(() => {
    const s = stateRef.current;
    clearSchedule();
    s.pattern = makePattern(s.level);
    s.playerTaps = [];
    s.subPhase = 'show';
    s.activeBeat = false;
    // Update beat orbs count
    if (s.scene) {
      s.beatOrbs.forEach(o => s.scene!.remove(o));
      s.beatOrbs = [];
      s.pattern.forEach((beat, i) => {
        const angle = (i / s.pattern.length) * Math.PI * 2 - Math.PI / 2;
        const r = 2.2;
        const geo = new THREE.SphereGeometry(beat.isShort ? 0.12 : 0.2, 8, 8);
        const mat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x000000 });
        const orb = new THREE.Mesh(geo, mat);
        orb.position.set(Math.cos(angle) * r, Math.sin(angle) * r, 0);
        s.scene!.add(orb);
        s.beatOrbs.push(orb);
      });
    }

    s.pattern.forEach((beat, i) => {
      const t = setTimeout(() => {
        if (!s.running) return;
        s.showBeatIdx = i;
        s.activeBeat = true;
        s.activeBeatTimer = beat.isShort ? 8 : 16;
        if (s.beatOrbs[i]) {
          const mat = s.beatOrbs[i].material as THREE.MeshStandardMaterial;
          mat.color.setHex(0xf59e0b); mat.emissive.setHex(0xf59e0b);
        }
        hapticTick(); sfx.collect();
      }, 500 + beat.delay);
      scheduleRef.current.push(t);
    });

    const lastBeat = s.pattern[s.pattern.length - 1];
    const endT = setTimeout(() => {
      if (!s.running) return;
      s.subPhase = 'input';
      s.inputStartMs = Date.now();
      s.activeBeat = false;
      s.beatOrbs.forEach(o => {
        (o.material as THREE.MeshStandardMaterial).color.setHex(0x666666);
        (o.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
      });
      const inputTimeout = setTimeout(() => {
        if (!s.running || s.subPhase !== 'input') return;
        evaluateRound();
      }, lastBeat.delay + lastBeat.delay * 0.3 + 2000);
      scheduleRef.current.push(inputTimeout);
    }, 500 + lastBeat.delay + 600);
    scheduleRef.current.push(endT);
  }, [clearSchedule, evaluateRound]);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { roundsCompleted: 0, longestPattern: 0, avgTimingError: 0, totalTimingError: 0, totalBeats: 0, wrongBeats: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.level = 1; s.particles = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0800);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 8);
    s.camera = camera;

    // Lights
    scene.add(new THREE.AmbientLight(0x221100, 2));
    const pointLight = new THREE.PointLight(0xf59e0b, 4, 20);
    pointLight.position.set(0, 2, 4);
    scene.add(pointLight);
    s.drumLight = new THREE.PointLight(0xf59e0b, 0, 12);
    s.drumLight.position.set(0, 0, 2);
    scene.add(s.drumLight);

    // Stars
    const starPos = new Float32Array(800 * 3);
    for (let i = 0; i < 800; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 60;
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 60;
      starPos[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06 })));

    // Stage lights (cones pointing down)
    for (let i = 0; i < 3; i++) {
      const sl = new THREE.PointLight(0xf59e0b, 0.8, 10);
      sl.position.set((i - 1) * 3, 5, 0);
      scene.add(sl);
    }

    // Drum pad
    const drumGeo = new THREE.CylinderGeometry(1.2, 1.0, 0.25, 32);
    const drumMat = new THREE.MeshStandardMaterial({ color: 0x2a1800, emissive: 0x000000, roughness: 0.3, metalness: 0.7 });
    const drumMesh = new THREE.Mesh(drumGeo, drumMat);
    drumMesh.rotation.x = Math.PI / 2;
    scene.add(drumMesh);
    s.drumMesh = drumMesh;

    // Drum rim ring
    const rimGeo = new THREE.TorusGeometry(1.22, 0.07, 8, 32);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.3 });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    scene.add(rim);

    // Resize
    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    (s as any)._cleanup = () => window.removeEventListener('resize', handleResize);

    startRound();

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 10 && s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const t = Date.now() * 0.001;

      if (s.activeBeatTimer > 0) {
        s.activeBeatTimer--;
        if (s.activeBeatTimer <= 0) {
          s.activeBeat = false;
          if (s.beatOrbs[s.showBeatIdx]) {
            (s.beatOrbs[s.showBeatIdx].material as THREE.MeshStandardMaterial).color.setHex(0x333333);
            (s.beatOrbs[s.showBeatIdx].material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
          }
        }
      }

      // Drum pulse
      if (s.drumFlash > 0) {
        s.drumFlash--;
        const mat = s.drumMesh!.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = s.drumFlash / 8;
        s.drumLight!.intensity = s.drumFlash * 0.5;
      } else {
        const mat = s.drumMesh!.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.05 + Math.sin(t * 2) * 0.02;
        s.drumLight!.intensity = 0;
      }

      // Drum bob
      s.drumMesh!.rotation.z = Math.sin(t * 1.5) * 0.02;

      // Active beat glow
      if (s.activeBeat && s.beatOrbs[s.showBeatIdx]) {
        const orb = s.beatOrbs[s.showBeatIdx];
        const mat = orb.material as THREE.MeshStandardMaterial;
        mat.color.setHex(0xf59e0b); mat.emissive.setHex(0xf59e0b);
        orb.scale.setScalar(1 + Math.sin(t * 10) * 0.15);
      }

      // Result flash on drum
      if (s.subPhase === 'result') {
        s.resultTimer--;
        const mat = s.drumMesh!.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.4 + Math.sin(t * 8) * 0.2;
        if (s.resultTimer <= 0) {
          mat.emissive.setHex(0x000000);
          if (s.success) s.sequenceLen = Math.min(s.sequenceLen + 1, 9);
          else (s as any).level = Math.max(1, (s as any).level - 0);
          startRound();
        }
      }

      // Input phase: drum rim glows cyan
      if (s.subPhase === 'input') {
        const mat = rimMat;
        mat.emissive.setHex(0x06b6d4);
        mat.emissiveIntensity = 0.5 + Math.sin(t * 4) * 0.3;
      } else {
        rimMat.emissive.setHex(0xf59e0b);
        rimMat.emissiveIntensity = 0.3;
      }

      // Orbit beat orbs
      s.beatOrbs.forEach((orb, i) => {
        orb.rotation.y = t * 0.5;
      });

      // Particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.mesh.position.x += p.vx;
        p.mesh.position.y += p.vy;
        p.mesh.position.z += p.vz;
        p.life--;
        const mat = p.mesh.material as THREE.MeshStandardMaterial;
        mat.opacity = p.life / 20;
        if (p.life <= 0) { scene.remove(p.mesh); s.particles.splice(i, 1); }
      }

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    // Drum tap handler
    const onTap = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running || s.subPhase !== 'input') return;
      const ms = Date.now() - s.inputStartMs;
      s.playerTaps.push(ms);
      s.drumFlash = 8;
      hapticTick(); sfx.collect();
      // Spawn particles
      for (let i = 0; i < 8; i++) {
        const geo = new THREE.SphereGeometry(0.06, 4, 4);
        const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, transparent: true, opacity: 1 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(0, 0, 0.5);
        scene.add(mesh);
        const angle = Math.random() * Math.PI * 2;
        s.particles.push({ mesh, vx: Math.cos(angle) * 0.08, vy: Math.sin(angle) * 0.08, vz: 0.03, life: 20 });
      }
      if (s.playerTaps.length >= s.pattern.length) {
        clearSchedule();
        setTimeout(() => { if (s.running) evaluateRound(); }, 200);
      }
    };
    if (mountRef.current) mountRef.current.addEventListener('pointerdown', onTap);
    (s as any)._tapCleanup = () => mountRef.current?.removeEventListener('pointerdown', onTap);
  }, [endGame, startRound, clearSchedule, evaluateRound]);

  useEffect(() => () => {
    clearSchedule();
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    const s = stateRef.current;
    if (s.renderer) s.renderer.dispose();
    (s as any)._cleanup?.();
    (s as any)._tapCleanup?.();
  }, [clearSchedule]);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #0f0800 0%, #0a0500 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="Listen to the beat pattern, then tap the drum to repeat it!"
          ctaLabel="Beat it! 🎵" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <GameHUD accentColor={accent} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
          { label: 'SCORE', value: scoreDisplay },
        ]} />
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Rounds', value: String(finalSig.roundsCompleted), color: accent },
            { label: 'Longest', value: `${finalSig.longestPattern} beats`, color: '#fbbf24' },
            { label: 'Avg Error', value: `${finalSig.totalBeats > 0 ? Math.round(finalSig.totalTimingError / finalSig.totalBeats) : 0}ms`, color: '#4ade80' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.roundsCompleted >= 5} />
      )}
    </GameShell>
  );
}
