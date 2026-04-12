'use client';
/**
 * NODE CONNECT — 3D network graph. Link colored nodes without crossing wires.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticImpact } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'node-connect';
const ACCENT = '#10b981';
const DURATION = 45;
const GAME_EMOJI = '🔗';
const GAME_TITLE = 'Node Connect';
const GAME_TAGLINE = 'Link the dots. Cross nothing.';

const NODE_COLORS_HEX = [0xef4444, 0x3b82f6, 0xfbbf24, 0x10b981, 0xa855f7];
const NODE_COLORS_CSS = ['#ef4444', '#3b82f6', '#fbbf24', '#10b981', '#a855f7'];

interface NodeObj { mesh: THREE.Mesh; light: THREE.PointLight; x: number; y: number; colorIdx: number; connected: boolean; id: number; }
interface ConnectionObj { line: THREE.Line; from: number; to: number; colorIdx: number; pts: THREE.Vector3[]; }

interface Signals { puzzlesSolved: number; crossings: number; perfectPuzzles: number; maxStreak: number; streakCurrent: number; score: number; totalMoves: number; }

function getPersonality(sig: Signals): string {
  if (sig.perfectPuzzles >= 3 && sig.crossings === 0) return 'Circuit Wizard 🧙';
  if (sig.puzzlesSolved >= 5) return 'Network Pro 🔗';
  if (sig.crossings === 0) return 'Clean Connections ✨';
  if (sig.puzzlesSolved >= 3) return 'Getting Linked 📡';
  return 'Node Novice 🔌';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function linesIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(denom) < 0.0001) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denom;
  return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
}

function NodeConnectGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { puzzlesSolved: 0, crossings: 0, perfectPuzzles: 0, maxStreak: 0, streakCurrent: 0, score: 0, totalMoves: 0 } as Signals,
    nodes: [] as NodeObj[],
    connections: [] as ConnectionObj[],
    puzzlePairs: [] as Array<[number, number]>,
    drawingFrom: null as number | null,
    drawingLine: null as THREE.Line | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    renderer: null as THREE.WebGLRenderer | null,
    raycaster: new THREE.Raycaster(),
    pendingPointer: null as { x: number; y: number; type: 'down' | 'move' | 'up' } | null,
    completionFlash: 0,
    frame: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const buildPuzzle = useCallback((scene: THREE.Scene, puzzleNum: number) => {
    const s = stateRef.current;
    // Remove old nodes/connections
    s.nodes.forEach(n => { scene.remove(n.mesh); scene.remove(n.light); });
    s.connections.forEach(c => scene.remove(c.line));
    if (s.drawingLine) scene.remove(s.drawingLine);
    s.nodes = []; s.connections = []; s.puzzlePairs = []; s.drawingFrom = null; s.drawingLine = null;

    const nodeCount = 3 + Math.min(puzzleNum, 2);
    const R = 3.5 + puzzleNum * 0.3;
    const positions: Array<[number, number]> = [];

    for (let i = 0; i < nodeCount * 2; i++) {
      let x: number, y: number;
      let attempts = 0;
      do {
        const angle = (i / (nodeCount * 2)) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
        const r = R * (0.5 + Math.random() * 0.5);
        x = Math.cos(angle) * r;
        y = Math.sin(angle) * r;
        attempts++;
      } while (attempts < 20 && positions.some(p => Math.hypot(p[0] - x, p[1] - y) < 2));
      positions.push([x, y]);
    }

    // Create paired nodes (same color)
    for (let i = 0; i < nodeCount; i++) {
      const colorIdx = i % NODE_COLORS_HEX.length;
      const pos1 = positions[i * 2];
      const pos2 = positions[i * 2 + 1];

      for (const [px, py] of [pos1, pos2]) {
        const geo = new THREE.SphereGeometry(0.35, 16, 16);
        const mat = new THREE.MeshPhongMaterial({ color: NODE_COLORS_HEX[colorIdx], emissive: NODE_COLORS_HEX[colorIdx], emissiveIntensity: 0.4, shininess: 100 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(px, py, 0);
        scene.add(mesh);

        const light = new THREE.PointLight(NODE_COLORS_HEX[colorIdx], 1.5, 4);
        light.position.set(px, py, 1);
        scene.add(light);

        s.nodes.push({ mesh, light, x: px, y: py, colorIdx, connected: false, id: s.nodes.length });
      }
      s.puzzlePairs.push([i * 2, i * 2 + 1]);
    }
  }, []);

  const startLoop = useCallback(() => {
    if (!mountRef.current) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { puzzlesSolved: 0, crossings: 0, perfectPuzzles: 0, maxStreak: 0, streakCurrent: 0, score: 0, totalMoves: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x030d18);
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 200);
    camera.position.set(0, 0, 12);
    s.camera = camera;

    // Lights
    scene.add(new THREE.AmbientLight(0x0a1a2a, 5));
    const centerLight = new THREE.PointLight(0x10b981, 2, 20);
    centerLight.position.set(0, 0, 5);
    scene.add(centerLight);

    // Background particles
    const bgGeo = new THREE.BufferGeometry();
    const bgPos = new Float32Array(400 * 3);
    for (let i = 0; i < 400; i++) {
      bgPos[i * 3] = (Math.random() - 0.5) * 40;
      bgPos[i * 3 + 1] = (Math.random() - 0.5) * 40;
      bgPos[i * 3 + 2] = (Math.random() - 0.5) * 20 - 5;
    }
    bgGeo.setAttribute('position', new THREE.BufferAttribute(bgPos, 3));
    scene.add(new THREE.Points(bgGeo, new THREE.PointsMaterial({ color: 0x1e3a5f, size: 0.05, transparent: true, opacity: 0.4 })));

    buildPuzzle(scene, 0);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      sfx.tick();
      if (s.timeLeft <= 5 && s.timeLeft > 0) sfx.collect();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    const toWorld = (x: number, y: number) => {
      const v = new THREE.Vector3(x, y, 0);
      v.unproject(camera);
      const dir = v.sub(camera.position).normalize();
      const dist = -camera.position.z / dir.z;
      return new THREE.Vector3().copy(camera.position).addScaledVector(dir, dist);
    };

    let t = 0;
    const loop = () => {
      if (!s.running) { renderer.dispose(); return; }
      t += 0.016;
      s.frame++;
      s.completionFlash = Math.max(0, s.completionFlash - 0.03);

      // Process pointer
      if (s.pendingPointer) {
        const pp = s.pendingPointer;
        const ndc = new THREE.Vector2(pp.x, pp.y);
        s.raycaster.setFromCamera(ndc, camera);
        const worldPos = toWorld(
          (pp.x + 1) / 2 * window.innerWidth,
          (1 - (pp.y + 1) / 2) * window.innerHeight,
        );

        // Recalculate world from NDC
        const wv = new THREE.Vector3(pp.x, pp.y, 0).unproject(camera);
        const wdir = wv.sub(camera.position).normalize();
        const wdist = -camera.position.z / wdir.z;
        const world = new THREE.Vector3().copy(camera.position).addScaledVector(wdir, wdist);

        if (pp.type === 'down') {
          const nodeMeshes = s.nodes.map(n => n.mesh);
          const hits = s.raycaster.intersectObjects(nodeMeshes);
          if (hits.length > 0) {
            const hitNode = s.nodes.find(n => n.mesh === hits[0].object);
            if (hitNode && !hitNode.connected) {
              s.drawingFrom = hitNode.id;
              // Create drawing line
              const lineGeo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(hitNode.x, hitNode.y, 0.1),
                new THREE.Vector3(hitNode.x, hitNode.y, 0.1),
              ]);
              const lineMat = new THREE.LineBasicMaterial({ color: NODE_COLORS_HEX[hitNode.colorIdx], transparent: true, opacity: 0.8 });
              const line = new THREE.Line(lineGeo, lineMat);
              scene.add(line);
              s.drawingLine = line;
            }
          }
        } else if (pp.type === 'move' && s.drawingFrom !== null && s.drawingLine) {
          const fromNode = s.nodes.find(n => n.id === s.drawingFrom);
          if (fromNode) {
            s.drawingLine.geometry.setFromPoints([
              new THREE.Vector3(fromNode.x, fromNode.y, 0.1),
              new THREE.Vector3(world.x, world.y, 0.1),
            ]);
          }
        } else if (pp.type === 'up') {
          if (s.drawingFrom !== null) {
            const nodeMeshes = s.nodes.map(n => n.mesh);
            const hits = s.raycaster.intersectObjects(nodeMeshes);
            const toNode = hits.length > 0 ? s.nodes.find(n => n.mesh === hits[0].object) : null;
            const fromNode = s.nodes.find(n => n.id === s.drawingFrom);

            if (toNode && fromNode && toNode.id !== fromNode.id && !toNode.connected && !fromNode.connected) {
              // Check if same color (valid pair)
              if (fromNode.colorIdx === toNode.colorIdx) {
                // Check crossing
                const newLine = [fromNode.x, fromNode.y, toNode.x, toNode.y] as [number, number, number, number];
                let crosses = false;
                for (const conn of s.connections) {
                  const fn = s.nodes.find(n => n.id === conn.from);
                  const tn = s.nodes.find(n => n.id === conn.to);
                  if (fn && tn && linesIntersect(newLine[0], newLine[1], newLine[2], newLine[3], fn.x, fn.y, tn.x, tn.y)) {
                    crosses = true; break;
                  }
                }

                if (crosses) {
                  s.sig.crossings++;
                  sfx.collision(); hapticFail();
                } else {
                  fromNode.connected = true; toNode.connected = true;
                  s.sig.totalMoves++;

                  const lineGeo = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(fromNode.x, fromNode.y, 0.1),
                    new THREE.Vector3(toNode.x, toNode.y, 0.1),
                  ]);
                  const lineMat = new THREE.LineBasicMaterial({ color: NODE_COLORS_HEX[fromNode.colorIdx], linewidth: 2 });
                  const line = new THREE.Line(lineGeo, lineMat);
                  scene.add(line);
                  s.connections.push({ line, from: fromNode.id, to: toNode.id, colorIdx: fromNode.colorIdx, pts: [] });
                  sfx.collect(); hapticScore();

                  // Pulse node lights
                  fromNode.light.intensity = 4; toNode.light.intensity = 4;
                  setTimeout(() => { fromNode.light.intensity = 1.5; toNode.light.intensity = 1.5; }, 300);

                  // Check puzzle solved
                  if (s.nodes.every(n => n.connected)) {
                    s.sig.puzzlesSolved++;
                    const perfect = s.sig.crossings === 0;
                    if (perfect) s.sig.perfectPuzzles++;
                    s.sig.streakCurrent++;
                    if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
                    const pts = (perfect ? 10 : 6) * (s.sig.streakCurrent >= 3 ? 2 : 1);
                    s.sig.score += pts; setScoreDisplay(s.sig.score);
                    sfx.success(); hapticVictory();
                    s.completionFlash = 1;
                    setTimeout(() => { if (s.running && s.scene) buildPuzzle(s.scene, s.sig.puzzlesSolved); }, 700);
                  }
                }
              } else {
                sfx.click(); hapticImpact();
              }
            }

            if (s.drawingLine) { scene.remove(s.drawingLine); s.drawingLine = null; }
            s.drawingFrom = null;
          }
        }
        s.pendingPointer = null;
      }

      // Flash nodes on completion
      if (s.completionFlash > 0) {
        s.nodes.forEach(n => { n.light.intensity = 2 + s.completionFlash * 3; });
        centerLight.intensity = 2 + s.completionFlash * 4;
      } else {
        s.nodes.forEach((n, i) => { n.light.intensity = 1.2 + Math.sin(t * 2 + i) * 0.3; });
        centerLight.intensity = 2;
      }

      // Pulse unconnected nodes
      s.nodes.forEach((n, i) => {
        if (!n.connected) {
          const mat = n.mesh.material as THREE.MeshPhongMaterial;
          mat.emissiveIntensity = 0.3 + Math.sin(t * 3 + i * 0.8) * 0.2;
        }
      });

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
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); };
  }, [phase]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    stateRef.current.renderer?.dispose();
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); sfx.click(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg,#030d18 0%,#051520 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Connect! 🔗" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none', touchAction: 'none' }} />
      {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5, testId: 'timer' }, { label: 'SCORE', value: scoreDisplay, testId: 'score' }]} />}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Puzzles Solved', value: `${finalSig.puzzlesSolved}`, color: ACCENT },
            { label: 'Crossings', value: `${finalSig.crossings}`, color: finalSig.crossings === 0 ? '#4ade80' : '#ef4444' },
            { label: 'Perfect Puzzles', value: `${finalSig.perfectPuzzles}`, color: '#fbbf24' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.puzzlesSolved >= 3} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const NodeConnectGame = dynamic(() => Promise.resolve({ default: NodeConnectGameInner }), { ssr: false });
export default NodeConnectGame;
