'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'number-path';
const ACCENT = '#22c55e';
const DURATION = 45;
const GAME_EMOJI = '🔢';
const GAME_TITLE = 'Number Path';
const GAME_TAGLINE = '1 to N. Fastest finger wins.';

interface Signals {
  sequencesCompleted: number; highestN: number; totalNumbers: number;
  wrongTaps: number; avgSequenceMs: number; totalSequenceMs: number;
  score: number; maxStreak: number; streakCurrent: number;
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  if (sig.highestN >= 10 && sig.sequencesCompleted >= 4) return 'Number Ninja 🥷';
  if (sig.sequencesCompleted >= 5) return 'Sequential Pro 📊';
  if (sig.highestN >= 8) return 'Pattern Spotter 🔢';
  if (sig.wrongTaps === 0 && sig.sequencesCompleted >= 2) return 'Perfect Order ✨';
  return 'Counting Up 💡';
}

interface NumberSphere { mesh: THREE.Mesh; value: number; tapped: boolean; isCurrent: boolean; }

function NumberPathGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const spheresRef = useRef<NumberSphere[]>([]);
  const connLinesRef = useRef<THREE.Line[]>([]);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { sequencesCompleted: 0, highestN: 0, totalNumbers: 0, wrongTaps: 0, avgSequenceMs: 0, totalSequenceMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 } as Signals,
    currentIndex: 0, n: 5, seqStart: 0,
    accentColor: ACCENT,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    hapticVictory();
    if (s.sig.sequencesCompleted > 0) s.sig.avgSequenceMs = s.sig.totalSequenceMs / s.sig.sequencesCompleted;
    try { const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0'); if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score)); } catch { /**/ }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const buildSequence = useCallback(() => {
    const s = stateRef.current;
    const scene = sceneRef.current; if (!scene) return;
    // Remove old spheres
    spheresRef.current.forEach(ns => scene.remove(ns.mesh));
    spheresRef.current = [];
    connLinesRef.current.forEach(l => scene.remove(l));
    connLinesRef.current = [];
    // Generate n random positions
    const positions: THREE.Vector3[] = [];
    const used: THREE.Vector3[] = [];
    for (let i = 0; i < s.n; i++) {
      let pos: THREE.Vector3;
      let tries = 0;
      do {
        pos = new THREE.Vector3((Math.random()-0.5)*8, (Math.random()-0.5)*6, (Math.random()-0.5)*2);
        tries++;
      } while (used.some(u => u.distanceTo(pos) < 2.0) && tries < 20);
      used.push(pos);
      positions.push(pos);
    }
    // Create sphere meshes
    positions.forEach((pos, i) => {
      const value = i + 1;
      const geo = new THREE.SphereGeometry(0.45, 24, 24);
      const mat = new THREE.MeshStandardMaterial({ color: 0x1a3a2a, emissive: 0x0a1a10, roughness: 0.4, metalness: 0.5 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.userData = { value, idx: i };
      scene.add(mesh);
      spheresRef.current.push({ mesh, value, tapped: false, isCurrent: i === 0 });
    });
    // Highlight first
    if (spheresRef.current[0]) {
      const mat = spheresRef.current[0].mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(0x22c55e); mat.emissive.set(0x114420); mat.emissiveIntensity = 1;
    }
    s.currentIndex = 0; s.seqStart = Date.now();
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.n = 5;
    s.sig = { sequencesCompleted: 0, highestN: 0, totalNumbers: 0, wrongTaps: 0, avgSequenceMs: 0, totalSequenceMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050f08);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 60);
    camera.position.set(0, 0, 11);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x0a1f10, 3));
    scene.add(Object.assign(new THREE.PointLight(0x22c55e, 60, 20), { position: new THREE.Vector3(2, 3, 8) }));
    scene.add(Object.assign(new THREE.PointLight(0x14b8a6, 40, 15), { position: new THREE.Vector3(-3, -2, 6) }));

    // Stars
    const sg = new THREE.BufferGeometry();
    const sp = new Float32Array(400);
    for (let i = 0; i < 400; i += 3) { sp[i] = (Math.random()-0.5)*40; sp[i+1] = (Math.random()-0.5)*40; sp[i+2] = (Math.random()-0.5)*10-10; }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x22c55e, size: 0.05 })));

    buildSequence();

    const raycaster = new THREE.Raycaster();
    const onTap = (e: PointerEvent) => {
      if (!s.running) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(((e.clientX - rect.left)/rect.width)*2-1, -((e.clientY - rect.top)/rect.height)*2+1);
      raycaster.setFromCamera(mouse, camera);
      const meshes = spheresRef.current.filter(ns => !ns.tapped).map(ns => ns.mesh);
      const hits = raycaster.intersectObjects(meshes);
      if (!hits.length) return;
      const hit = hits[0].object as THREE.Mesh;
      const { value, idx } = hit.userData as { value: number; idx: number };
      const expected = s.currentIndex + 1;
      if (value === expected) {
        // Correct tap
        const ns = spheresRef.current[idx];
        ns.tapped = true;
        const mat = hit.material as THREE.MeshStandardMaterial;
        mat.color.set(0x4ade80); mat.emissive.set(0x1a5f2a); mat.emissiveIntensity = 1.5;
        s.currentIndex++;
        s.sig.totalNumbers++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        sfx.collect();
        if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent); else hapticScore();
        // Draw connection line to next
        if (s.currentIndex < spheresRef.current.length) {
          const nextNs = spheresRef.current[s.currentIndex];
          nextNs.isCurrent = true;
          const nextMat = nextNs.mesh.material as THREE.MeshStandardMaterial;
          nextMat.color.set(0x22c55e); nextMat.emissive.set(0x114420); nextMat.emissiveIntensity = 1;
          const lineGeo = new THREE.BufferGeometry().setFromPoints([hit.position.clone(), nextNs.mesh.position.clone()]);
          const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.5 }));
          scene.add(line); connLinesRef.current.push(line);
        }
        // Sequence complete
        if (s.currentIndex >= s.n) {
          const elapsed = Date.now() - s.seqStart;
          s.sig.sequencesCompleted++;
          s.sig.totalSequenceMs += elapsed;
          if (s.n > s.sig.highestN) s.sig.highestN = s.n;
          const pts = Math.max(5, 20 - Math.floor(elapsed / 500));
          s.sig.score += pts; setScoreDisplay(s.sig.score);
          sfx.success(); hapticVictory();
          s.n = Math.min(12, s.n + 1);
          setTimeout(() => { if (s.running) buildSequence(); }, 600);
        }
      } else {
        s.sig.wrongTaps++; s.sig.streakCurrent = 0;
        const mat = hit.material as THREE.MeshStandardMaterial;
        const prev = mat.color.getHex();
        mat.color.set(0xef4444); mat.emissive.set(0x5f1a1a); mat.emissiveIntensity = 1;
        sfx.collision(); hapticFail();
        setTimeout(() => { mat.color.setHex(prev); mat.emissive.set(0x0a1a10); mat.emissiveIntensity = 0; }, 400);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onTap);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    let t = 0;
    const loop = () => {
      if (!s.running) return;
      animRef.current = requestAnimationFrame(loop);
      t += 0.012;
      spheresRef.current.forEach((ns, i) => {
        if (!ns.tapped) {
          ns.mesh.position.z = Math.sin(t + i * 0.8) * 0.2;
          ns.mesh.rotation.y += 0.012;
        }
      });
      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => { renderer.domElement.removeEventListener('pointerdown', onTap); };
  }, [endGame, buildSequence]);

  useEffect(() => {
    const onResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      const W = window.innerWidth, H = window.innerHeight;
      cameraRef.current.aspect = W / H; cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(W, H);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (rendererRef.current && mountRef.current) {
        try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
        rendererRef.current.dispose();
      }
    };
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    stateRef.current.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (rendererRef.current && mountRef.current) {
      try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
      rendererRef.current.dispose(); rendererRef.current = null;
    }
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
    setPhase('countdown');
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 30%, rgba(34,197,94,0.1) 0%, transparent 60%), linear-gradient(180deg, #050f08 0%, #020605 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Count! 🔢" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <>
              <GameHUD accentColor={accent} items={[
                { label: 'TIME', value: timeLeft, danger: timeLeft <= 10, testId: 'timer' },
                { label: 'SCORE', value: scoreDisplay, testId: 'score' },
              ]} />
              {/* Number labels overlay */}
              {phase === 'playing' && sceneRef.current && cameraRef.current && spheresRef.current.map((ns, i) => {
                if (ns.tapped) return null;
                return (
                  <div key={i} style={{ position: 'absolute', pointerEvents: 'none', zIndex: 10,
                    transform: 'translate(-50%,-50%)',
                    color: ns.isCurrent ? accent : 'rgba(255,255,255,0.7)',
                    fontSize: '18px', fontWeight: 900,
                    textShadow: ns.isCurrent ? `0 0 15px ${accent}` : 'none',
                    // Cannot easily project 3D to 2D without extra work; show as hint only
                  }}>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Sequences', value: String(finalSig.sequencesCompleted), color: '#4ade80' },
            { label: 'Highest N', value: String(finalSig.highestN), color: '#fbbf24' },
            { label: 'Wrong Taps', value: String(finalSig.wrongTaps), color: finalSig.wrongTaps === 0 ? '#4ade80' : '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: accent },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.sequencesCompleted >= 3} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const NumberPathGame = dynamic(() => Promise.resolve({ default: NumberPathGameInner }), { ssr: false });
export default NumberPathGame;
