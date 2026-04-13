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

const GAME_ID = 'symbol-scan';
const ACCENT = '#818cf8';
const DURATION = 45;
const GAME_EMOJI = '🔣';
const GAME_TITLE = 'Symbol Scan';
const GAME_TAGLINE = 'Find the matching symbol. Tap fast!';

interface Signals { total: number; found: number; missed: number; falseAlarms: number; avgReactionMs: number; totalMs: number; score: number; maxStreak: number; streakCurrent: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.total > 0 ? sig.found / sig.total : 0;
  const avg = sig.found > 0 ? sig.totalMs / sig.found : 9999;
  if (acc >= 0.9 && avg < 600) return 'Symbol Master 👁️';
  if (acc >= 0.8) return 'Pattern Reader 🔣';
  if (avg < 700) return 'Quick Scanner ⚡';
  if (sig.found >= 12) return 'Diligent Seeker 🔍';
  return 'Learning Symbols 📚';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

const SHAPES = ['sphere', 'box', 'cone', 'torus', 'octahedron', 'tetrahedron', 'cylinder', 'ring'];
const SHAPE_COLORS = [0x818cf8, 0xa855f7, 0x38bdf8, 0x34d399, 0xfbbf24, 0xf97316, 0xef4444, 0xec4899];

function SymbolScanGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    sig: { total: 0, found: 0, missed: 0, falseAlarms: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 } as Signals,
    gridMeshes: [] as { mesh: THREE.Mesh; shapeIdx: number; isTarget: boolean }[],
    targetShapeIdx: 0,
    roundStart: 0, frame: 0,
    flashTimer: 0, flashSuccess: true,
    hintMesh: null as THREE.Mesh | null,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [pbBeaten, setPbBeaten] = useState(false);
  const [targetHint, setTargetHint] = useState('');
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
        const _pbKey = 'pb_symbol-scan';
    const _finalScore = stateRef.current.sig.score;
    const _prevPb = parseInt(typeof window !== 'undefined' ? localStorage.getItem(_pbKey) ?? '0' : '0', 10);
    if (_finalScore > _prevPb) { if (typeof window !== 'undefined') localStorage.setItem(_pbKey, String(_finalScore)); setPbBeaten(true); }
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { total: 0, found: 0, missed: 0, falseAlarms: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.gridMeshes = []; s.flashTimer = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a1a);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 14);
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
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x111133, 2));
    const pLight = new THREE.PointLight(0x818cf8, 4, 30);
    pLight.position.set(0, 5, 5);
    scene.add(pLight);
    const sLight = new THREE.PointLight(0xa855f7, 2, 20);
    sLight.position.set(-5, 3, 3);
    scene.add(sLight);

    // Background grid
    for (let i = -6; i <= 6; i++) {
      const g1 = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-8, i, -3), new THREE.Vector3(8, i, -3)]);
      scene.add(new THREE.Line(g1, new THREE.LineBasicMaterial({ color: 0x818cf8, transparent: true, opacity: 0.05 })));
    }

    // Flash sphere
    const flashGeo = new THREE.SphereGeometry(10, 16, 16);
    const flashMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.BackSide });
    scene.add(new THREE.Mesh(flashGeo, flashMat));

    // Stars
    const starPos = new Float32Array(400 * 3);
    for (let i = 0; i < 400; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 60; starPos[i * 3 + 1] = (Math.random() - 0.5) * 40; starPos[i * 3 + 2] = -20 + (Math.random() - 0.5) * 10;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06 })));

    const makeGeo = (idx: number): THREE.BufferGeometry => {
      const r = 0.38;
      switch (SHAPES[idx]) {
        case 'sphere': return new THREE.SphereGeometry(r, 12, 12);
        case 'box': return new THREE.BoxGeometry(r * 1.8, r * 1.8, r * 0.6);
        case 'cone': return new THREE.ConeGeometry(r, r * 2.2, 8);
        case 'torus': return new THREE.TorusGeometry(r, r * 0.28, 8, 20);
        case 'octahedron': return new THREE.OctahedronGeometry(r * 1.2);
        case 'tetrahedron': return new THREE.TetrahedronGeometry(r * 1.35);
        case 'cylinder': return new THREE.CylinderGeometry(r * 0.6, r * 0.6, r * 1.8, 10);
        case 'ring': return new THREE.TorusGeometry(r * 0.9, r * 0.12, 8, 32);
        default: return new THREE.SphereGeometry(r, 12, 12);
      }
    };

    // Hint display mesh (top center)
    const hintGeo = makeGeo(0);
    const hintMat = new THREE.MeshStandardMaterial({ color: SHAPE_COLORS[0], emissive: SHAPE_COLORS[0], emissiveIntensity: 0.8, roughness: 0.3 });
    const hintMesh = new THREE.Mesh(hintGeo, hintMat);
    hintMesh.position.set(0, 5.5, 0);
    hintMesh.scale.setScalar(1.3);
    scene.add(hintMesh);
    s.hintMesh = hintMesh;

    const spawnGrid = () => {
      s.gridMeshes.forEach(gm => scene.remove(gm.mesh));
      s.gridMeshes = [];
      scene.remove(hintMesh);

      const targetIdx = Math.floor(Math.random() * SHAPES.length);
      s.targetShapeIdx = targetIdx;

      // Rebuild hint mesh with new shape
      const newHintGeo = makeGeo(targetIdx);
      hintMesh.geometry.dispose();
      hintMesh.geometry = newHintGeo;
      (hintMesh.material as THREE.MeshStandardMaterial).color.setHex(SHAPE_COLORS[targetIdx]);
      (hintMesh.material as THREE.MeshStandardMaterial).emissive.setHex(SHAPE_COLORS[targetIdx]);
      scene.add(hintMesh);

      setTargetHint(`Find: ${SHAPES[targetIdx]}`);

      // Grid: 4x4 = 16 items with 1 target
      const cols = 4, rows = 4;
      const cellW = 2.8, cellH = 2.0;
      const startX = -((cols - 1) / 2) * cellW;
      const startY = -((rows - 1) / 2) * cellH + 0;

      const positions: number[] = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) positions.push(r * cols + c);

      // Pick one target position
      const targetPos = Math.floor(Math.random() * positions.length);
      const distractorCount = 4 + Math.floor(s.sig.score * 0.3);

      positions.forEach((posIdx, i) => {
        const r = Math.floor(posIdx / cols), c = posIdx % cols;
        const x = startX + c * cellW + (Math.random() - 0.5) * 0.3;
        const y = startY + r * cellH + (Math.random() - 0.5) * 0.3;
        const isTarget = i === targetPos;
        let shapeIdx = isTarget ? targetIdx : Math.floor(Math.random() * SHAPES.length);
        while (!isTarget && shapeIdx === targetIdx && SHAPES.length > 1) shapeIdx = Math.floor(Math.random() * SHAPES.length);

        const geo = makeGeo(shapeIdx);
        const dim = 0.4 + Math.random() * 0.15;
        const mat = new THREE.MeshStandardMaterial({
          color: isTarget ? SHAPE_COLORS[shapeIdx] : 0x1e293b,
          emissive: isTarget ? SHAPE_COLORS[shapeIdx] : 0x0f172a,
          emissiveIntensity: isTarget ? 0.15 : 0.05,
          roughness: 0.5, metalness: 0.2,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, 0);
        mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        scene.add(mesh);
        s.gridMeshes.push({ mesh, shapeIdx, isTarget });
      });

      s.sig.total++;
      s.roundStart = Date.now();
    };

    spawnGrid();

    const raycaster = new THREE.Raycaster();
    const onTap = (e: PointerEvent) => {
      if (!s.running) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
      const meshes = s.gridMeshes.map(gm => gm.mesh);
      const intersects = raycaster.intersectObjects(meshes);
      if (!intersects.length) return;
      const tapped = s.gridMeshes.find(gm => gm.mesh === intersects[0].object);
      if (!tapped) return;
      const elapsed = Date.now() - s.roundStart;
      if (tapped.isTarget) {
        s.sig.found++; s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        s.sig.totalMs += elapsed;
        s.sig.avgReactionMs = s.sig.totalMs / s.sig.found;
        const pts = (elapsed < 700 ? 2 : 1) + (s.sig.streakCurrent >= 3 ? 1 : 0);
        s.sig.score += pts; setScoreDisplay(s.sig.score);
        sfx.collect(); hapticScore();
        s.flashTimer = 18; s.flashSuccess = true;
        flashMat.color.setHex(0x10b981);
        spawnGrid();
      } else {
        s.sig.falseAlarms++; s.sig.streakCurrent = 0;
        sfx.nearMiss(); hapticFail();
        s.flashTimer = 14; s.flashSuccess = false;
        flashMat.color.setHex(0xef4444);
        (tapped.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0xef4444);
        (tapped.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5;
      }
    };
    renderer.domElement.addEventListener('pointerdown', onTap);

    const ROUND_TIMEOUT = 5000;

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Rotate meshes
      s.gridMeshes.forEach((gm, i) => {
        gm.mesh.rotation.y += 0.01;
        gm.mesh.rotation.x += 0.005;
        if (gm.isTarget) {
          const pulse = 1 + Math.sin(s.frame * 0.1 + i) * 0.05;
          gm.mesh.scale.setScalar(pulse);
          (gm.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + Math.sin(s.frame * 0.1) * 0.1;
        }
      });

      // Hint rotation
      hintMesh.rotation.y += 0.02;
      hintMesh.rotation.x += 0.01;

      // Flash decay
      if (s.flashTimer > 0) {
        s.flashTimer--;
        flashMat.opacity = (s.flashTimer / 18) * 0.15;
      } else {
        flashMat.opacity = 0;
      }

      // Auto advance
      if (Date.now() - s.roundStart > ROUND_TIMEOUT) {
        s.sig.missed++; s.sig.streakCurrent = 0;
        sfx.fail(); hapticFail();
        spawnGrid();
      }

      pLight.intensity = 4 + Math.sin(s.frame * 0.05) * 0.7;

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => () => {
    const s = stateRef.current; s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    if (stateRef.current.renderer) { stateRef.current.renderer.dispose(); stateRef.current.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start Scanning!" accentColor={accent} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} aria-label="Game area. Use touch or pointer to interact." role="application" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <>
        <div aria-live="polite" style={{position:'absolute',left:'-9999px',width:'1px',height:'1px',overflow:'hidden'}}>Score: {scoreDisplay}</div>
          <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />
        <div style={{ position: 'fixed', bottom: '8%', left: '50%', transform: 'translateX(-50%)', zIndex: 50, background: 'rgba(0,0,0,0.6)', borderRadius: 20, padding: '8px 20px', border: `1px solid ${accent}44`, color: accent, fontWeight: 700, fontSize: 14 }}>
          {targetHint}
        </div>
      </>}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Found', value: `${finalSig.found}/${finalSig.total}`, color: '#4ade80' }, { label: 'False Alarms', value: String(finalSig.falseAlarms), color: finalSig.falseAlarms === 0 ? '#4ade80' : '#ef4444' }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: accent }, { label: 'Avg React', value: finalSig.avgReactionMs > 0 ? `${Math.round(finalSig.avgReactionMs)}ms` : '—', color: '#fbbf24' }]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 12} />
      )}
      {phase === 'done' && pbBeaten && (
        <div style={{position:'fixed',top:'16px',left:'50%',transform:'translateX(-50%)',background:'#fbbf24',color:'#000',padding:'8px 20px',borderRadius:'999px',fontWeight:700,fontSize:'1rem',zIndex:9999,boxShadow:'0 4px 12px rgba(0,0,0,0.3)',animation:'none'}}>🏆 New Personal Best!</div>
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const SymbolScanGame = dynamic(() => Promise.resolve({ default: SymbolScanGameInner }), { ssr: false });
export default SymbolScanGame;
