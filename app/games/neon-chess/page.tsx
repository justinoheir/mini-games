'use client';
/**
 * NEON CHESS — 3D chessboard with glowing neon pieces.
 * Tap the correct piece and destination to solve checkmate puzzles.
 */
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

const GAME_ID = 'neon-chess';
const ACCENT = '#00ffff';
const DURATION = 60;
const GAME_EMOJI = '♟️';
const GAME_TITLE = 'Neon Chess';
const GAME_TAGLINE = 'One move. Best move. Neon style.';

type PieceType = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P' | 'k' | 'q' | 'r' | 'b' | 'n' | 'p' | null;

interface Puzzle {
  board: PieceType[][];
  correctFrom: [number, number];
  correctTo: [number, number];
  hint: string;
}

const PUZZLES: Puzzle[] = [
  {
    board: [
      [null, null, null, null, 'k', null, null, null],
      [null, null, null, null, 'p', 'p', null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, 'Q', null, null],
      [null, null, null, null, 'K', null, null, null],
    ],
    correctFrom: [6, 5], correctTo: [0, 5], hint: 'Queen to f8#',
  },
  {
    board: [
      ['k', null, null, null, null, null, null, null],
      ['p', null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, 'R', null, null, null, null, null, null],
      ['K', null, null, null, null, null, null, null],
    ],
    correctFrom: [6, 1], correctTo: [0, 1], hint: 'Rook to b8#',
  },
  {
    board: [
      [null, null, null, null, 'k', null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      ['K', null, null, null, 'Q', null, null, null],
    ],
    correctFrom: [7, 4], correctTo: [0, 4], hint: 'Queen to e8#',
  },
];

interface Signals { score: number; solved: number; wrong: number; maxStreak: number; streakCurrent: number; }

function getPersonality(sig: Signals): string {
  if (sig.solved >= 8 && sig.wrong === 0) return 'Grand Master ♟️';
  if (sig.solved >= 6) return 'Chess Wizard 🔮';
  if (sig.maxStreak >= 4) return 'Tactical Mind 🧠';
  if (sig.solved >= 3) return 'Opening Scholar 📖';
  return 'Pawn Pusher ♙';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPieceColor(p: PieceType): number {
  if (p === null) return 0;
  return p === p.toUpperCase() ? 0x00ffff : 0xff6666;
}
function getPieceLabel(p: PieceType): string {
  if (!p) return '';
  const labels: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  return labels[p] ?? p;
}

export default function NeonChessGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { score: 0, solved: 0, wrong: 0, maxStreak: 0, streakCurrent: 0 } as Signals,
    puzzleIdx: 0,
    selectedFrom: null as [number, number] | null,
    pieceMeshes: [] as Array<{ mesh: THREE.Mesh; row: number; col: number; piece: PieceType }>,
    highlightMeshes: [] as THREE.Mesh[],
    feedback: null as 'correct' | 'wrong' | null,
    feedbackTimer: 0,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    renderer: null as THREE.WebGLRenderer | null,
    raycaster: new THREE.Raycaster(),
    pendingClick: null as THREE.Vector2 | null,
    boardGroup: null as THREE.Group | null,
    hintText: '',
    particles: [] as { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }[],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [hintDisplay, setHintDisplay] = useState('');

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const buildBoard = useCallback((scene: THREE.Scene, puzzle: Puzzle): THREE.Group => {
    const s = stateRef.current;
    // Remove old board
    if (s.boardGroup) scene.remove(s.boardGroup);
    s.pieceMeshes = [];
    s.highlightMeshes = [];

    const group = new THREE.Group();
    const CELL = 1.2;

    // Board squares
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const isLight = (r + c) % 2 === 0;
        const geo = new THREE.BoxGeometry(CELL, 0.12, CELL);
        const mat = new THREE.MeshPhongMaterial({
          color: isLight ? 0x1a1a3e : 0x0d0d2b,
          emissive: isLight ? 0x080828 : 0x040414,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set((c - 3.5) * CELL, 0, (r - 3.5) * CELL);
        group.add(mesh);

        // Border glow
        const borderGeo = new THREE.EdgesGeometry(geo);
        const borderMat = new THREE.LineBasicMaterial({ color: 0x001a40, transparent: true, opacity: 0.3 });
        const border = new THREE.LineSegments(borderGeo, borderMat);
        border.position.copy(mesh.position);
        group.add(border);

        // Piece
        const piece = puzzle.board[r]?.[c] ?? null;
        if (piece) {
          const isWhite = piece === piece.toUpperCase();
          const pieceGeo = new THREE.CylinderGeometry(0.3, 0.35, isWhite ? 0.6 : 0.5, 12);
          const pieceMat = new THREE.MeshPhongMaterial({
            color: isWhite ? 0x00ffff : 0xff4444,
            emissive: isWhite ? 0x006666 : 0x660000,
            shininess: 100,
          });
          const pieceMesh = new THREE.Mesh(pieceGeo, pieceMat);
          pieceMesh.position.set((c - 3.5) * CELL, 0.35, (r - 3.5) * CELL);
          // Top sphere
          const topGeo = new THREE.SphereGeometry(isWhite ? 0.22 : 0.18, 10, 10);
          const topMesh = new THREE.Mesh(topGeo, pieceMat.clone());
          topMesh.position.set((c - 3.5) * CELL, isWhite ? 0.75 : 0.65, (r - 3.5) * CELL);
          group.add(pieceMesh);
          group.add(topMesh);
          s.pieceMeshes.push({ mesh: pieceMesh, row: r, col: c, piece });
        }
      }
    }

    group.rotation.x = -Math.PI / 6;
    group.position.y = -1;
    scene.add(group);
    s.boardGroup = group;
    return group;
  }, []);

  const startLoop = useCallback(() => {
    if (!mountRef.current) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, solved: 0, wrong: 0, maxStreak: 0, streakCurrent: 0 };
    s.puzzleIdx = 0; s.selectedFrom = null; s.feedback = null; s.feedbackTimer = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x050515);
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 200);
    camera.position.set(0, 6, 8);
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    // Lights
    scene.add(new THREE.AmbientLight(0x001a3a, 5));
    const topLight = new THREE.PointLight(0x00ffff, 3, 25);
    topLight.position.set(0, 8, 0);
    scene.add(topLight);
    const sideLight = new THREE.PointLight(0x0055ff, 2, 20);
    sideLight.position.set(5, 3, 5);
    scene.add(sideLight);

    // Star field
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(800 * 3);
    for (let i = 0; i < 800; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 60;
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 40;
      starPos[i * 3 + 2] = (Math.random() - 0.5) * 40 - 5;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.04, transparent: true, opacity: 0.5 })));

    const puzzle = PUZZLES[s.puzzleIdx % PUZZLES.length];
    buildBoard(scene, puzzle);
    setHintDisplay(puzzle.hint);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      sfx.tick();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    let t = 0;
    const loop = () => {
      if (!s.running) { renderer.dispose(); return; }
      t += 0.016;

      // Feedback flash
      if (s.feedbackTimer > 0) s.feedbackTimer--;

      // Process click
      if (s.pendingClick && s.camera && s.boardGroup) {
        s.raycaster.setFromCamera(s.pendingClick, s.camera);
        const pieceMeshes = s.pieceMeshes.map(pm => pm.mesh);
        const hits = s.raycaster.intersectObjects(pieceMeshes);

        const puzzle2 = PUZZLES[s.puzzleIdx % PUZZLES.length];

        if (hits.length > 0) {
          const hitMesh = hits[0].object as THREE.Mesh;
          const pm = s.pieceMeshes.find(p => p.mesh === hitMesh);
          if (pm) {
            const isWhite = pm.piece !== null && pm.piece === pm.piece.toUpperCase();
            if (s.selectedFrom === null && isWhite) {
              // Select white piece
              s.selectedFrom = [pm.row, pm.col];
              (pm.mesh.material as THREE.MeshPhongMaterial).emissive.setHex(0x00aaaa);
              (pm.mesh.material as THREE.MeshPhongMaterial).color.setHex(0xffffff);
              sfx.click();
            } else if (s.selectedFrom !== null) {
              // Try move to this piece's square
              const [fr, fc] = s.selectedFrom;
              const [tr, tc] = [pm.row, pm.col];
              const [cfr, cfc] = puzzle2.correctFrom;
              const [ctr, ctc] = puzzle2.correctTo;
              const isCorrect = fr === cfr && fc === cfc && tr === ctr && tc === ctc;

              if (isCorrect) {
                s.sig.solved++; s.sig.streakCurrent++;
                if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
                s.sig.score += 3 + (s.sig.streakCurrent >= 3 ? 2 : 0);
                setScoreDisplay(s.sig.score);
                sfx.success(); hapticScore();
                if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
                s.feedback = 'correct'; s.feedbackTimer = 20;
                topLight.color.setHex(0xfbbf24);

                setTimeout(() => {
                  if (!s.running || !s.scene) return;
                  s.puzzleIdx++;
                  const nextPuzzle = PUZZLES[s.puzzleIdx % PUZZLES.length];
                  buildBoard(s.scene, nextPuzzle);
                  setHintDisplay(nextPuzzle.hint);
                  s.selectedFrom = null;
                  s.feedback = null;
                  topLight.color.setHex(0x00ffff);
                }, 700);
              } else {
                s.sig.wrong++; s.sig.streakCurrent = 0;
                sfx.collision(); hapticFail();
                s.feedback = 'wrong'; s.feedbackTimer = 20;
              }
              // Deselect
              const selPm = s.pieceMeshes.find(p => p.row === s.selectedFrom![0] && p.col === s.selectedFrom![1]);
              if (selPm) {
                (selPm.mesh.material as THREE.MeshPhongMaterial).emissive.setHex(0x006666);
                (selPm.mesh.material as THREE.MeshPhongMaterial).color.setHex(0x00ffff);
              }
              s.selectedFrom = null;
            }
          }
        }
        s.pendingClick = null;
      }

      // Pulse white pieces
      s.pieceMeshes.forEach(pm => {
        if (pm.piece && pm.piece === pm.piece.toUpperCase()) {
          const mat = pm.mesh.material as THREE.MeshPhongMaterial;
          const isSelected = s.selectedFrom && s.selectedFrom[0] === pm.row && s.selectedFrom[1] === pm.col;
          if (!isSelected) {
            mat.emissiveIntensity = 0.5 + Math.sin(t * 3 + pm.col) * 0.3;
          } else {
            mat.emissiveIntensity = 1.0 + Math.sin(t * 8) * 0.5;
          }
        }
      });

      // Particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.life -= 0.03;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life;
        if (p.life <= 0) { scene.remove(p.mesh); s.particles.splice(i, 1); }
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
  }, [endGame, buildBoard]);

  useEffect(() => {
    const el = mountRef.current; if (!el) return;
    const onDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.renderer) return;
      const rect = s.renderer.domElement.getBoundingClientRect();
      s.pendingClick = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };
    el.addEventListener('pointerdown', onDown);
    return () => el.removeEventListener('pointerdown', onDown);
  }, [phase]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    stateRef.current.renderer?.dispose();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg,#050515 0%,#080825 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Enter the Board ♟️" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none', touchAction: 'none' }} />
      {phase === 'playing' && (
        <>
          <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />
          <div style={{ position: 'fixed', bottom: 30, left: '50%', transform: 'translateX(-50%)', color: 'rgba(0,255,255,0.7)', fontSize: 14, fontWeight: 700, textAlign: 'center', pointerEvents: 'none', zIndex: 50 }}>
            💡 Hint: {hintDisplay} — Tap white piece, then destination
          </div>
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Puzzles Solved', value: `${finalSig.solved}`, color: ACCENT },
            { label: 'Wrong Moves', value: `${finalSig.wrong}`, color: '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
            { label: 'Score', value: `${finalSig.score}`, color: 'var(--color-text)' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.solved >= 5} />
      )}
    </GameShell>
  );
}
