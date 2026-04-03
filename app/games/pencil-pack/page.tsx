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

const GAME_ID   = 'pencil-pack';
const PB_KEY    = 'mg_pb_pencil-pack';
const ACCENT    = '#f59e0b';
const DURATION  = 60;
const GAME_EMOJI   = '✏️';
const GAME_TITLE   = 'Pencil Pack';
const GAME_TAGLINE = 'Pack the pencils into the box. No overflow allowed.';

const ROW_CAP = 5;
const NUM_ROWS = 4;
const PENCIL_COLORS_HEX = [0xfcd34d, 0xef4444, 0x3b82f6, 0x4ade80, 0xa855f7, 0xf97316];
const PUZZLES: number[][] = [
  [3, 2, 4, 1, 3, 2],
  [5, 2, 3, 2, 3],
  [4, 1, 3, 2, 4, 1],
  [2, 3, 5, 1, 4],
  [3, 3, 2, 2, 5],
  [1, 2, 3, 4, 5],
];

interface Signals { score: number; roundsCompleted: number; pencilsPlaced: number; overflowAttempts: number; }
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const total = sig.pencilsPlaced + sig.overflowAttempts;
  const eff = total > 0 ? sig.pencilsPlaced / total : 0;
  if (sig.roundsCompleted >= 5 && eff >= 0.9)  return 'Master Packer 📦';
  if (sig.roundsCompleted >= 3 && eff >= 0.75) return 'Spatial Thinker 🧠';
  if (sig.pencilsPlaced >= 12)                  return 'Determined Stacker ✏️';
  return 'Learning to Pack 🌊';
}

interface PencilMesh { mesh: THREE.Group; len: number; colorIdx: number; placed: boolean; row: number; trayIdx: number; }

export default function PencilPackGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const pencilMeshesRef = useRef<PencilMesh[]>([]);
  const rowMeshesRef = useRef<THREE.Mesh[]>([]);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { score: 0, roundsCompleted: 0, pencilsPlaced: 0, overflowAttempts: 0 } as Signals,
    rows: [0, 0, 0, 0] as number[], // used units per row
    puzzleIdx: 0,
    dragIdx: -1, dragStartX: 0, dragStartY: 0,
    selectedPencil: null as PencilMesh | null,
    rowFill: [0, 0, 0, 0] as number[],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState('');

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.gameOver(); haptic([100]);
    try { const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0'); if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score)); } catch { /**/ }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const loadPuzzle = useCallback(() => {
    const s = stateRef.current;
    const scene = sceneRef.current; if (!scene) return;
    // Remove old pencil meshes
    pencilMeshesRef.current.forEach(p => scene.remove(p.mesh));
    pencilMeshesRef.current = [];
    s.rows = [0, 0, 0, 0]; s.rowFill = [0, 0, 0, 0];
    const puzzle = PUZZLES[s.puzzleIdx % PUZZLES.length];
    // Create pencil meshes in tray
    puzzle.forEach((len, i) => {
      const group = new THREE.Group();
      const col = PENCIL_COLORS_HEX[i % PENCIL_COLORS_HEX.length];
      const bodyGeo = new THREE.CylinderGeometry(0.12, 0.12, len * 0.7, 8);
      const bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.4 });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.rotation.z = Math.PI / 2;
      group.add(body);
      const tipGeo = new THREE.ConeGeometry(0.12, 0.25, 8);
      const tipMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7 });
      const tip = new THREE.Mesh(tipGeo, tipMat);
      tip.rotation.z = Math.PI / 2;
      tip.position.x = len * 0.35 + 0.12;
      group.add(tip);
      // Tray position (fan layout at bottom)
      const trayX = -3.5 + i * 1.1;
      group.position.set(trayX, -3.5, 0.5);
      scene.add(group);
      pencilMeshesRef.current.push({ mesh: group, len, colorIdx: i, placed: false, row: -1, trayIdx: i });
    });
    // Update row fill indicators
    rowMeshesRef.current.forEach((m, ri) => {
      (m.material as THREE.MeshStandardMaterial).color.set(0x1a1a2e);
      (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
    });
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.puzzleIdx = 0;
    s.sig = { score: 0, roundsCompleted: 0, pencilsPlaced: 0, overflowAttempts: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('minimal');

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0f);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 60);
    camera.position.set(0, 0, 11);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x1a1a2a, 3));
    scene.add(Object.assign(new THREE.PointLight(0xf59e0b, 60, 20), { position: new THREE.Vector3(2, 4, 8) }));
    scene.add(Object.assign(new THREE.PointLight(0x6366f1, 40, 15), { position: new THREE.Vector3(-3, -2, 6) }));

    // Box frame
    const boxW = 4.4, boxH = 3.5;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x8b5e3c, emissive: 0x3a2010, roughness: 0.6 });
    const sides = [
      [boxW, 0.15, 0.3, 0, boxH / 2, 0], [-boxW / 2 - 0.075, 0, 0.15, 0, boxH / 2], [boxW / 2 + 0.075, 0, 0.15, 0, boxH / 2],
    ];
    [
      { w: boxW + 0.15, h: 0.15, d: 0.3, x: 0, y: boxH/2 + 0.07, z: 0 },
      { w: boxW + 0.15, h: 0.15, d: 0.3, x: 0, y: -boxH/2 - 0.07, z: 0 },
      { w: 0.15, h: boxH, d: 0.3, x: -boxW/2 - 0.07, y: 0, z: 0 },
      { w: 0.15, h: boxH, d: 0.3, x: boxW/2 + 0.07, y: 0, z: 0 },
    ].forEach(({ w, h, d, x, y, z }) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
      m.position.set(x, y, z);
      scene.add(m);
    });

    // Row dividers and fill indicators
    rowMeshesRef.current = [];
    for (let r = 0; r < NUM_ROWS; r++) {
      const rowY = boxH / 2 - (r + 0.5) * (boxH / NUM_ROWS);
      const rowGeo = new THREE.BoxGeometry(boxW * (ROW_CAP / ROW_CAP), 0.01, 0.25);
      const rowMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, transparent: true, opacity: 0.8 });
      const rowMesh = new THREE.Mesh(rowGeo, rowMat);
      rowMesh.position.set(0, rowY, 0.1);
      rowMesh.userData = { row: r };
      scene.add(rowMesh);
      rowMeshesRef.current.push(rowMesh);
      if (r < NUM_ROWS - 1) {
        const divGeo = new THREE.BoxGeometry(boxW, 0.04, 0.3);
        const divMesh = new THREE.Mesh(divGeo, new THREE.MeshStandardMaterial({ color: 0x4a3010, roughness: 0.8 }));
        divMesh.position.set(0, rowY - boxH / NUM_ROWS / 2, 0);
        scene.add(divMesh);
      }
    }

    loadPuzzle();

    // Raycaster for pencil selection
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    let dragging: PencilMesh | null = null;

    const getPencilMeshes = () => pencilMeshesRef.current.filter(p => !p.placed).map(p => p.mesh.children[0] as THREE.Object3D);

    const onDown = (e: PointerEvent) => {
      if (!s.running) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(((e.clientX - rect.left)/rect.width)*2-1, -((e.clientY - rect.top)/rect.height)*2+1);
      raycaster.setFromCamera(mouse, camera);
      // Check pencil children
      const allPencilObjs: THREE.Object3D[] = [];
      pencilMeshesRef.current.filter(p => !p.placed).forEach(p => p.mesh.children.forEach(c => allPencilObjs.push(c)));
      const hits = raycaster.intersectObjects(allPencilObjs);
      if (hits.length) {
        const hitParent = hits[0].object.parent as THREE.Group;
        const pencil = pencilMeshesRef.current.find(p => p.mesh === hitParent);
        if (pencil) { dragging = pencil; sfx.click(); }
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!s.running || !dragging) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(((e.clientX - rect.left)/rect.width)*2-1, -((e.clientY - rect.top)/rect.height)*2+1);
      raycaster.setFromCamera(mouse, camera);
      const target = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, target);
      dragging.mesh.position.set(target.x, target.y, 0.8);
    };
    const onUp = (e: PointerEvent) => {
      if (!s.running || !dragging) return;
      const p = dragging; dragging = null;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(((e.clientX - rect.left)/rect.width)*2-1, -((e.clientY - rect.top)/rect.height)*2+1);
      raycaster.setFromCamera(mouse, camera);
      const target = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, target);
      const boxW = 4.4, boxH = 3.5;
      // Determine target row
      const rowIdx = Math.floor((-target.y + boxH / 2) / (boxH / NUM_ROWS));
      if (rowIdx < 0 || rowIdx >= NUM_ROWS || Math.abs(target.x) > boxW / 2) {
        // Out of box, return to tray
        p.mesh.position.set(-3.5 + p.trayIdx * 1.1, -3.5, 0.5);
        return;
      }
      const available = ROW_CAP - s.rowFill[rowIdx];
      if (p.len > available) {
        s.sig.overflowAttempts++;
        sfx.collision(); haptic([30, 20, 30]);
        setFeedbackMsg('No room! 🚫');
        setTimeout(() => setFeedbackMsg(''), 800);
        // Return to tray
        p.mesh.position.set(-3.5 + p.trayIdx * 1.1, -3.5, 0.5);
        return;
      }
      // Place pencil in row
      const rowY = boxH / 2 - (rowIdx + 0.5) * (boxH / NUM_ROWS);
      const xOffset = -boxW / 2 + s.rowFill[rowIdx] * (boxW / ROW_CAP) + p.len * (boxW / ROW_CAP) / 2;
      p.mesh.position.set(xOffset, rowY, 0.3);
      s.rowFill[rowIdx] += p.len;
      p.placed = true; p.row = rowIdx;
      s.sig.pencilsPlaced++;
      sfx.collect(); haptic([30]);
      // Update row fill indicator
      if (rowMeshesRef.current[rowIdx]) {
        const fillRatio = s.rowFill[rowIdx] / ROW_CAP;
        const mat = rowMeshesRef.current[rowIdx].material as THREE.MeshStandardMaterial;
        mat.color.set(fillRatio >= 1 ? 0x4ade80 : 0xf59e0b);
        mat.emissiveIntensity = 0.5;
      }
      // Check if all pencils placed
      const allPlaced = pencilMeshesRef.current.every(pp => pp.placed);
      if (allPlaced) {
        s.sig.roundsCompleted++; s.sig.score += 10; setScoreDisplay(s.sig.score);
        sfx.success(); haptic([30, 20, 30, 20, 60]);
        setFeedbackMsg('Packed! 🎉');
        setTimeout(() => { setFeedbackMsg(''); s.puzzleIdx++; if (s.running) loadPuzzle(); }, 800);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    let t = 0;
    const loop = () => {
      if (!s.running) return;
      animRef.current = requestAnimationFrame(loop);
      t += 0.01;
      // Gentle float on unplaced pencils
      pencilMeshesRef.current.filter(p => !p.placed && p.mesh !== (dragging?.mesh)).forEach((p, i) => {
        p.mesh.position.y = -3.5 + Math.sin(t + i * 0.7) * 0.08;
      });
      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
    };
  }, [endGame, loadPuzzle]);

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
      if (stopMusicRef.current) stopMusicRef.current();
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
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (rendererRef.current && mountRef.current) {
      try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
      rendererRef.current.dispose(); rendererRef.current = null;
    }
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setFeedbackMsg('');
    setPhase('countdown');
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 30%, rgba(245,158,11,0.1) 0%, transparent 60%), linear-gradient(180deg, #0a0a0f 0%, #050508 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Pack it! ✏️" accentColor={accent} onStart={handleStart} />
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
              {feedbackMsg && <div style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translateX(-50%)',
                color: '#fff', fontSize: 28, fontWeight: 900, pointerEvents: 'none', zIndex: 10,
                textShadow: '0 0 20px #f59e0b' }}>{feedbackMsg}</div>}
              <div style={{ position: 'absolute', bottom: '8%', left: '50%', transform: 'translateX(-50%)',
                color: 'rgba(255,255,255,0.4)', fontSize: 13, pointerEvents: 'none', textAlign: 'center' }}>
                Drag pencils into the box · Fill rows without overflow
              </div>
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Rounds', value: String(finalSig.roundsCompleted), color: '#4ade80' },
              { label: 'Pencils Placed', value: String(finalSig.pencilsPlaced), color: accent },
              { label: 'Overflows', value: String(finalSig.overflowAttempts), color: finalSig.overflowAttempts === 0 ? '#4ade80' : '#ef4444' },
              { label: 'Score', value: String(finalSig.score), color: accent },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.roundsCompleted >= 3} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
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
