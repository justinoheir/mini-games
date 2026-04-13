﻿﻿'use client';
/**
 * SPATIAL MAP — 3D Version
 * 4x4 grid of glowing 3D cubes. Memorize path, then trace it.
 */
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

const GAME_ID = 'spatial-map';
const PB_KEY = 'mg_pb_spatial-map';
const ACCENT = '#06b6d4';
const DURATION = 60;
const GAME_EMOJI = '🗺️';
const GAME_TITLE = 'Spatial Map';
const GRID = 4, CELLS = GRID * GRID;
const WATCH_MS = 2200, FLASH_MS = 300, PAUSE_MS = 600;

interface Signals { score: number; roundsCompleted: number; maxPathLength: number; wrongTaps: number; avgRecallMs: number; totalRecallMs: number; totalRounds: number; }
function getPersonality(sig: Signals): string {
  if (sig.maxPathLength >= 7 && sig.wrongTaps === 0) return 'Spatial Genius 🧭';
  if (sig.maxPathLength >= 6) return 'Path Master 🗺️';
  if (sig.wrongTaps === 0 && sig.roundsCompleted >= 4) return 'Clean Tracer ✅';
  if (sig.roundsCompleted >= 6) return 'Pattern Finder 🔍';
  return 'Mapping Explorer 🌐';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
type SubPhase = 'show' | 'input' | 'result';

function SpatialMapGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    cellMeshes: [] as THREE.Mesh[],
    cellLights: [] as THREE.PointLight[],
    pathLines: [] as THREE.Line[],
    running: false, streak: 0, timeLeft: DURATION,
    sig: { score: 0, roundsCompleted: 0, maxPathLength: 0, wrongTaps: 0, avgRecallMs: 0, totalRecallMs: 0, totalRounds: 0 } as Signals,
    path: [] as number[],
    playerInput: [] as number[],
    subPhase: 'show' as SubPhase,
    pathLength: 3, showStep: 0, showTimer: null as ReturnType<typeof setTimeout> | null,
    inputStartMs: 0, resultTimer: 0, success: false,
    cellWorldPos: [] as THREE.Vector3[],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streak, setStreak] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const clearSubTimers = useCallback(() => {
    if (subTimerRef.current) { clearTimeout(subTimerRef.current); subTimerRef.current = null; }
  }, []);

  const endGame = useCallback(() => {
    clearSubTimers();
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    try { const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0'); if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score)); } catch { /* ignore */ }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, [clearSubTimers]);

  const generatePath = useCallback((length: number): number[] => {
    const path: number[] = [Math.floor(Math.random() * CELLS)];
    while (path.length < length) {
      const last = path[path.length - 1];
      const row = Math.floor(last / GRID), col = last % GRID;
      const neighbors: number[] = [];
      if (row > 0) neighbors.push(last - GRID);
      if (row < GRID - 1) neighbors.push(last + GRID);
      if (col > 0) neighbors.push(last - 1);
      if (col < GRID - 1) neighbors.push(last + 1);
      const unused = neighbors.filter(n => !path.includes(n));
      if (unused.length === 0) break;
      path.push(unused[Math.floor(Math.random() * unused.length)]);
    }
    return path;
  }, []);

  const startRound = useCallback(() => {
    clearSubTimers();
    const s = stateRef.current;
    const path = generatePath(s.pathLength);
    s.path = path; s.playerInput = []; s.subPhase = 'show'; s.showStep = 0;
    s.sig.totalRounds++;
    // Reset cell colors
    s.cellMeshes.forEach(m => { (m.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000); (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 0; });
    s.cellLights.forEach(l => { l.intensity = 0; });

    // Show path step by step
    const showStep = (step: number) => {
      if (!s.running) return;
      if (step > 0) {
        const prevIdx = path[step - 1];
        const mat = s.cellMeshes[prevIdx].material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(0x06b6d4); mat.emissiveIntensity = 0.2;
        s.cellLights[prevIdx].intensity = 0;
      }
      if (step < path.length) {
        const idx = path[step];
        const mat = s.cellMeshes[idx].material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(0x06b6d4); mat.emissiveIntensity = 1.5;
        s.cellLights[idx].intensity = 3;
        sfx.collect(); haptic([20]);
        subTimerRef.current = setTimeout(() => showStep(step + 1), WATCH_MS / path.length);
      } else {
        // Done showing — input phase
        s.subPhase = 'input';
        s.cellMeshes.forEach(m => { (m.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000); (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05; });
        s.cellLights.forEach(l => { l.intensity = 0; });
        s.inputStartMs = Date.now();
        // Timeout for input
        subTimerRef.current = setTimeout(() => {
          if (!s.running || s.subPhase !== 'input') return;
          s.sig.wrongTaps++; s.subPhase = 'result'; s.success = false; s.resultTimer = 40;
          sfx.collision(); haptic([30, 20, 30]);
        }, 5000 + s.pathLength * 1200);
      }
    };
    setTimeout(() => showStep(0), 300);
  }, [clearSubTimers, generatePath]);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, roundsCompleted: 0, maxPathLength: 0, wrongTaps: 0, avgRecallMs: 0, totalRecallMs: 0, totalRounds: 0 };
    s.pathLength = 3;
    setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x020a0a);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 5, 6);
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x010a0a, 3));
    const topLight = new THREE.PointLight(0x06b6d4, 2, 20);
    topLight.position.set(0, 8, 0);
    scene.add(topLight);

    // Stars
    const sp = new Float32Array(300*3);
    for (let i=0;i<300;i++){sp[i*3]=(Math.random()-.5)*50;sp[i*3+1]=(Math.random()-.5)*50;sp[i*3+2]=(Math.random()-.5)*50;}
    const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(sp,3));
    scene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0xffffff,size:0.06})));

    // Grid platform
    const platformGeo = new THREE.BoxGeometry(7, 0.1, 7);
    const platformMat = new THREE.MeshStandardMaterial({ color: 0x0d1117, roughness: 0.8 });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.position.y = -0.35;
    scene.add(platform);

    // Create 4x4 grid cells
    const cellMeshes: THREE.Mesh[] = [];
    const cellLights: THREE.PointLight[] = [];
    const cellWorldPos: THREE.Vector3[] = [];
    const spacing = 1.5;
    const offset = -(GRID - 1) * spacing / 2;
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const idx = r * GRID + c;
        const x = offset + c * spacing;
        const z = offset + r * spacing;
        const cellGeo = new THREE.BoxGeometry(1.1, 0.15, 1.1);
        const cellMat = new THREE.MeshStandardMaterial({ color: 0x0d2433, emissive: 0x000000, emissiveIntensity: 0, roughness: 0.4, metalness: 0.5 });
        const cellMesh = new THREE.Mesh(cellGeo, cellMat);
        cellMesh.position.set(x, -0.2, z);
        scene.add(cellMesh);
        cellMeshes.push(cellMesh);
        cellWorldPos.push(new THREE.Vector3(x, -0.2, z));
        const cellLight = new THREE.PointLight(0x06b6d4, 0, 3);
        cellLight.position.set(x, 0.5, z);
        scene.add(cellLight);
        cellLights.push(cellLight);
        // Cell border
        const borderGeo = new THREE.BoxGeometry(1.12, 0.16, 1.12);
        const borderEdges = new THREE.EdgesGeometry(borderGeo);
        const border = new THREE.LineSegments(borderEdges, new THREE.LineBasicMaterial({ color: 0x06b6d440 }));
        border.position.set(x, -0.2, z);
        scene.add(border);
      }
    }
    s.cellMeshes = cellMeshes;
    s.cellLights = cellLights;
    s.cellWorldPos = cellWorldPos;

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

    startRound();

    const loop = () => {
      if (!s.running) return;
      const t = Date.now() * 0.001;

      // Result phase
      if (s.subPhase === 'result') {
        s.resultTimer--;
        topLight.color.setHex(s.success ? 0x22c55e : 0xef4444);
        topLight.intensity = 3 + Math.sin(t * 8) * 1;
        if (s.resultTimer <= 0) {
          topLight.color.setHex(0x06b6d4);
          topLight.intensity = 2;
          if (s.success) s.pathLength = Math.min(s.pathLength + 1, 9);
          else s.pathLength = Math.max(3, s.pathLength - 1);
          startRound();
        }
      }

      // Idle cell pulse in input phase
      if (s.subPhase === 'input') {
        cellMeshes.forEach((m, i) => {
          if (!s.playerInput.includes(i)) {
            const mat = m.material as THREE.MeshStandardMaterial;
            mat.emissiveIntensity = 0.04 + Math.sin(t * 2 + i * 0.4) * 0.02;
          }
        });
      }

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    // Tap handler
    const onTap = (e: PointerEvent) => {
      const s2 = stateRef.current;
      if (!s2.running || s2.subPhase !== 'input') return;
      const rect = mountRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const hits = raycaster.intersectObjects(cellMeshes);
      if (hits.length > 0) {
        const hitIdx = cellMeshes.indexOf(hits[0].object as THREE.Mesh);
        if (hitIdx < 0) return;
        const expected = s2.path[s2.playerInput.length];
        const mat = cellMeshes[hitIdx].material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(0x06b6d4); mat.emissiveIntensity = 1.2;
        cellLights[hitIdx].intensity = 2.5;
        setTimeout(() => { mat.emissive.setHex(0x000000); mat.emissiveIntensity = 0; cellLights[hitIdx].intensity = 0; }, 300);
        sfx.collect(); haptic([15]);
        if (hitIdx === expected) {
          s2.playerInput.push(hitIdx);
          if (s2.playerInput.length === s2.path.length) {
            clearSubTimers();
            const recallMs = Date.now() - s2.inputStartMs;
            s2.sig.totalRecallMs += recallMs;
            s2.sig.roundsCompleted++;
            if (s2.pathLength > s2.sig.maxPathLength) s2.sig.maxPathLength = s2.pathLength;
            const pts = s2.path.length * 2;
            s2.sig.score += pts; setScoreDisplay(s2.sig.score); s2.streak = (s2.streak||0)+1; setStreak(s2.streak); const streakMult = Math.max(1,Math.floor(s2.streak/3)+1); if(s2.streak>=3){s2.sig.score+=(streakMult-1)*pts;setScoreDisplay(s2.sig.score);}
            sfx.success(); haptic([50, 30, 50]);
            s2.subPhase = 'result'; s2.success = true; s2.resultTimer = 45;
          }
        } else {
          clearSubTimers();
          s2.sig.wrongTaps++; s2.streak=0; setStreak(0);
          sfx.collision(); haptic([30, 20, 30]);
          s2.subPhase = 'result'; s2.success = false; s2.resultTimer = 45;
        }
      }
    };
    if (mountRef.current) mountRef.current.addEventListener('pointerdown', onTap);
    (s as any)._tapCleanup = () => mountRef.current?.removeEventListener('pointerdown', onTap);
  }, [endGame, startRound, clearSubTimers]);

  useEffect(() => () => {
    clearSubTimers();
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    const s = stateRef.current;
    if (s.renderer) s.renderer.dispose();
    (s as any)._cleanup?.(); (s as any)._tapCleanup?.();
  }, [clearSubTimers]);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Memorize the glowing 3D path on the grid, then tap the same cells in order!"
          ctaLabel="Map It! 🗺️" accentColor={accent} onStart={handleStart} />
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
              { label: 'Rounds', value: String(finalSig.roundsCompleted), color: accent },
              { label: 'Max Path', value: `${finalSig.maxPathLength} cells`, color: '#fbbf24' },
              { label: 'Wrong Taps', value: String(finalSig.wrongTaps), color: finalSig.wrongTaps === 0 ? '#4ade80' : '#ef4444' },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.maxPathLength >= 5} />
          <WebhookHelper theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

function WebhookHelper({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score, maxPathLength: sig.maxPathLength, wrongTaps: sig.wrongTaps }, player); }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const SpatialMapGame = dynamic(() => Promise.resolve({ default: SpatialMapGameInner }), { ssr: false });
export default SpatialMapGame;
