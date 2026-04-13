'use client';
/**
 * JIGSAW RUSH — 3D colorful puzzle pieces floating in space. Drag to slot.
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

const GAME_ID = 'jigsaw-rush';
const ACCENT = '#22d3ee';
const DURATION = 45;
const GAME_EMOJI = '🧩';
const GAME_TITLE = 'Jigsaw Rush';
const GAME_TAGLINE = 'Drag each piece to its glowing slot — as fast as you can!';
const PB_KEY = 'mg_pb_jigsaw-rush';

const GRID_COLS = 3, GRID_ROWS = 3;
const PIECE_COLORS = [0x7c3aed, 0x2563eb, 0x059669, 0xd97706, 0xdc2626, 0x0891b2, 0xc026d3, 0x0f766e, 0xb45309];

interface PieceObj {
  mesh: THREE.Mesh; id: number; row: number; col: number;
  homeX: number; homeY: number; placed: boolean;
  glowLight: THREE.PointLight;
}

interface Signals { score: number; piecesPlaced: number; puzzlesCompleted: number; totalAttempts: number; fastestSolveMs: number; }

function getPersonality(sig: Signals): string {
  if (sig.puzzlesCompleted >= 2 && sig.fastestSolveMs < 20000) return 'Jigsaw Prodigy 🧩';
  if (sig.puzzlesCompleted >= 2) return 'Puzzle Master 🔍';
  if (sig.piecesPlaced >= 7) return 'Pattern Seeker 🎯';
  if (sig.piecesPlaced >= 4) return 'Piece Finder 🔎';
  return 'Casual Puzzler 🤔';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function JigsawRushGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, streak: 0, timeLeft: DURATION,
    sig: { score: 0, piecesPlaced: 0, puzzlesCompleted: 0, totalAttempts: 0, fastestSolveMs: Infinity } as Signals,
    pieces: [] as PieceObj[],
    slots: [] as THREE.Mesh[],
    dragging: null as { id: number; offX: number; offY: number } | null,
    puzzleStartTime: 0,
    completionFlash: 0,
    scene: null as THREE.Scene | null,
    renderer: null as THREE.WebGLRenderer | null,
    camera: null as THREE.PerspectiveCamera | null,
    raycaster: new THREE.Raycaster(),
    pendingPointer: null as { x: number; y: number; type: 'down' | 'move' | 'up' } | null,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streak, setStreak] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.gameOver(); haptic([100]);
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score));
    const finalSig2 = { ...s.sig };
    if (finalSig2.fastestSolveMs === Infinity) finalSig2.fastestSolveMs = 0;
    setFinalSig(finalSig2); setPhase('done');
  }, []);

  const buildPuzzle = useCallback((scene: THREE.Scene) => {
    const s = stateRef.current;
    s.pieces.forEach(p => { scene.remove(p.mesh); scene.remove(p.glowLight); });
    s.slots.forEach(sl => scene.remove(sl));
    s.pieces = []; s.slots = []; s.dragging = null;

    const CELL = 1.4, GAP = 0.1;
    const boardW = GRID_COLS * CELL + (GRID_COLS - 1) * GAP;
    const boardOffX = -boardW / 2 + CELL / 2;
    const boardOffY = 1.5;

    // Build board slots
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const x = boardOffX + c * (CELL + GAP);
        const y = boardOffY - r * (CELL + GAP);
        const slotGeo = new THREE.BoxGeometry(CELL, CELL, 0.05);
        const idx = r * GRID_COLS + c;
        const slotMat = new THREE.MeshPhongMaterial({ color: PIECE_COLORS[idx], transparent: true, opacity: 0.15 });
        const slot = new THREE.Mesh(slotGeo, slotMat);
        slot.position.set(x, y, 0);
        scene.add(slot);
        s.slots.push(slot);

        // Slot border
        const edgeGeo = new THREE.EdgesGeometry(slotGeo);
        const edgeMat = new THREE.LineBasicMaterial({ color: PIECE_COLORS[idx], transparent: true, opacity: 0.5 });
        const edge = new THREE.LineSegments(edgeGeo, edgeMat);
        edge.position.copy(slot.position);
        scene.add(edge);
      }
    }

    // Scatter pieces in lower zone
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const idx = r * GRID_COLS + c;
        const homeX = boardOffX + c * (CELL + GAP);
        const homeY = boardOffY - r * (CELL + GAP);

        // Random scatter position at bottom
        let sx: number, sy: number, attempts = 0;
        do {
          sx = (Math.random() - 0.5) * 7;
          sy = -1.5 - Math.random() * 2;
          attempts++;
        } while (attempts < 15 && s.pieces.some(p => Math.hypot(p.mesh.position.x - sx, p.mesh.position.y - sy) < CELL));

        const geo = new THREE.BoxGeometry(CELL - 0.05, CELL - 0.05, 0.25);
        const mat = new THREE.MeshPhongMaterial({ color: PIECE_COLORS[idx], emissive: PIECE_COLORS[idx], emissiveIntensity: 0.2, shininess: 80 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(sx, sy, 0.1);
        mesh.rotation.z = (Math.random() - 0.5) * 0.4;
        scene.add(mesh);

        const glowLight = new THREE.PointLight(PIECE_COLORS[idx], 0.8, 2.5);
        glowLight.position.set(sx, sy, 1);
        scene.add(glowLight);

        s.pieces.push({ mesh, id: idx, row: r, col: c, homeX, homeY, placed: false, glowLight });
      }
    }

    s.puzzleStartTime = Date.now();
  }, []);

  const startLoop = useCallback(() => {
    if (!mountRef.current) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, piecesPlaced: 0, puzzlesCompleted: 0, totalAttempts: 0, fastestSolveMs: Infinity };
    s.completionFlash = 0;
    setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('chill');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a1628);
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a1628, 15, 40);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 200);
    camera.position.set(0, 0, 10);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x1e3a5f, 5));
    const topLight = new THREE.PointLight(0x22d3ee, 2, 20);
    topLight.position.set(0, 5, 5);
    scene.add(topLight);

    // Floating particles background
    const bgGeo = new THREE.BufferGeometry();
    const bgPos = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) {
      bgPos[i * 3] = (Math.random() - 0.5) * 30;
      bgPos[i * 3 + 1] = (Math.random() - 0.5) * 20;
      bgPos[i * 3 + 2] = (Math.random() - 0.5) * 15 - 5;
    }
    bgGeo.setAttribute('position', new THREE.BufferAttribute(bgPos, 3));
    scene.add(new THREE.Points(bgGeo, new THREE.PointsMaterial({ color: 0x22d3ee, size: 0.04, transparent: true, opacity: 0.3 })));

    buildPuzzle(scene);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 5 && s.timeLeft > 0) sfx.collect();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    const toWorld = (nx: number, ny: number) => {
      const v = new THREE.Vector3(nx, ny, 0).unproject(camera);
      const dir = v.sub(camera.position).normalize();
      const dist = -camera.position.z / dir.z;
      return new THREE.Vector3().copy(camera.position).addScaledVector(dir, dist);
    };

    let t = 0;
    const loop = () => {
      if (!s.running) { renderer.dispose(); return; }
      t += 0.016;
      s.completionFlash = Math.max(0, s.completionFlash - 0.03);

      // Process pointer
      if (s.pendingPointer) {
        const pp = s.pendingPointer;
        const ndc = new THREE.Vector2(pp.x, pp.y);
        const world = toWorld(pp.x, pp.y);
        s.raycaster.setFromCamera(ndc, camera);

        if (pp.type === 'down') {
          const pieceMeshes = s.pieces.filter(p => !p.placed).map(p => p.mesh);
          const hits = s.raycaster.intersectObjects(pieceMeshes);
          if (hits.length > 0) {
            const hitMesh = hits[0].object as THREE.Mesh;
            const piece = s.pieces.find(p => p.mesh === hitMesh);
            if (piece) {
              s.dragging = { id: piece.id, offX: world.x - piece.mesh.position.x, offY: world.y - piece.mesh.position.y };
              piece.mesh.position.z = 1;
              s.sig.totalAttempts++;
            }
          }
        } else if (pp.type === 'move' && s.dragging !== null) {
          const piece = s.pieces.find(p => p.id === s.dragging!.id);
          if (piece && !piece.placed) {
            piece.mesh.position.x = world.x - s.dragging.offX;
            piece.mesh.position.y = world.y - s.dragging.offY;
            piece.glowLight.position.set(piece.mesh.position.x, piece.mesh.position.y, 1);
          }
        } else if (pp.type === 'up') {
          if (s.dragging !== null) {
            const piece = s.pieces.find(p => p.id === s.dragging!.id);
            if (piece && !piece.placed) {
              const dx = piece.mesh.position.x - piece.homeX;
              const dy = piece.mesh.position.y - piece.homeY;
              const SNAP = 0.8;
              if (Math.sqrt(dx * dx + dy * dy) < SNAP) {
                // Snap!
                piece.mesh.position.set(piece.homeX, piece.homeY, 0);
                piece.mesh.rotation.z = 0;
                piece.placed = true;
                (piece.mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 0.5;
                piece.glowLight.intensity = 2;
                s.sig.piecesPlaced++; s.sig.score += 2;
                setScoreDisplay(s.sig.score);
                sfx.collect(); haptic([30]);

                // Check complete
                if (s.pieces.every(p => p.placed)) {
                  const solveMs = Date.now() - s.puzzleStartTime;
                  if (solveMs < s.sig.fastestSolveMs) s.sig.fastestSolveMs = solveMs;
                  s.sig.puzzlesCompleted++;
                  const bonus = Math.max(0, 10 - Math.floor(solveMs / 3000));
                  s.sig.score += 15 + bonus;
                  s.completionFlash = 1;
                  sfx.success(); haptic([30, 20, 30, 20, 60]);
                  setScoreDisplay(s.sig.score);
                  topLight.color.setHex(0xfbbf24);
                  setTimeout(() => { topLight.color.setHex(0x22d3ee); if (s.running && s.scene) buildPuzzle(s.scene); }, 800);
                }
              } else {
                piece.mesh.position.z = 0.1;
              }
              piece.glowLight.position.set(piece.mesh.position.x, piece.mesh.position.y, 1);
            }
            s.dragging = null;
          }
        }
        s.pendingPointer = null;
      }

      // Completion flash
      if (s.completionFlash > 0) {
        topLight.intensity = 2 + s.completionFlash * 4;
      } else {
        topLight.intensity = 2;
      }

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      s.running = false;
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [endGame, buildPuzzle]);

  useEffect(() => {
    const el = mountRef.current; if (!el) return;
    const toNDC = (e: PointerEvent): [number, number] => {
      if (!stateRef.current.renderer) return [0, 0];
      const rect = stateRef.current.renderer.domElement.getBoundingClientRect();
      return [((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1];
    };
    const onDown = (e: PointerEvent) => { if (phase !== 'playing') return; const [x, y] = toNDC(e); stateRef.current.pendingPointer = { x, y, type: 'down' }; };
    const onMove = (e: PointerEvent) => { if (phase !== 'playing') return; const [x, y] = toNDC(e); stateRef.current.pendingPointer = { x, y, type: 'move' }; };
    const onUp = (e: PointerEvent) => { if (phase !== 'playing') return; const [x, y] = toNDC(e); stateRef.current.pendingPointer = { x, y, type: 'up' }; };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp); };
  }, [phase]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    stateRef.current.renderer?.dispose();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); sfx.click(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT} gameId={GAME_ID}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start Puzzle!" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} role="application" aria-label="Game area - tap to play" style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none', touchAction: 'none' }} />
      {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5, testId: 'timer' }, { label: 'SCORE', value: scoreDisplay, testId: 'score' }]} />}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Pieces Placed', value: String(finalSig.piecesPlaced), color: finalSig.piecesPlaced >= 7 ? '#4ade80' : '#facc15' },
              { label: 'Puzzles Done', value: String(finalSig.puzzlesCompleted), color: finalSig.puzzlesCompleted >= 2 ? '#4ade80' : '#facc15' },
              { label: 'Fastest Solve', value: finalSig.fastestSolveMs > 0 ? `${(finalSig.fastestSolveMs / 1000).toFixed(1)}s` : '—', color: ACCENT },
              { label: 'Score', value: String(finalSig.score), color: 'var(--color-text)' },
            ]}
            accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.piecesPlaced >= 7} />
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

import dynamic from 'next/dynamic';
const JigsawRushGame = dynamic(() => Promise.resolve({ default: JigsawRushGameInner }), { ssr: false });
export default JigsawRushGame;
