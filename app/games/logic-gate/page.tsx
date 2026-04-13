'use client';
/**
 * LOGIC GATE — 3D circuit board with glowing gates. Solve boolean logic puzzles.
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

const GAME_ID = 'logic-gate';
const ACCENT = '#64748b';
const DURATION = 60;
const GAME_EMOJI = '⚙️';
const GAME_TITLE = 'Logic Gate';
const GAME_TAGLINE = 'Wire the circuit. Get the output.';

type GateType = 'AND' | 'OR' | 'NOT' | 'NAND' | 'NOR' | 'XOR';

interface Gate { type: GateType; inputs: boolean[]; output: boolean; }
interface Signals { total: number; correct: number; wrong: number; andGates: number; orGates: number; notGates: number; avgSolveMs: number; totalMs: number; score: number; maxStreak: number; streakCurrent: number; }

function evalGate(type: GateType, inputs: boolean[]): boolean {
  switch (type) {
    case 'AND': return inputs.every(Boolean);
    case 'OR': return inputs.some(Boolean);
    case 'NOT': return !inputs[0];
    case 'NAND': return !inputs.every(Boolean);
    case 'NOR': return !inputs.some(Boolean);
    case 'XOR': return inputs.filter(Boolean).length % 2 === 1;
  }
}

function makeGatePuzzle(level: number): Gate {
  const types: GateType[] = level >= 4 ? ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR'] : level >= 2 ? ['AND', 'OR', 'NOT', 'NAND'] : ['AND', 'OR', 'NOT'];
  const type = types[Math.floor(Math.random() * types.length)];
  const inputs = type === 'NOT' ? [Math.random() > 0.5] : [Math.random() > 0.5, Math.random() > 0.5];
  return { type, inputs, output: evalGate(type, inputs) };
}

function getPersonality(sig: Signals): string {
  const acc = sig.total > 0 ? sig.correct / sig.total : 0;
  if (acc >= 0.9 && sig.total >= 15) return 'Logic Engineer ⚡';
  if (sig.total >= 12) return 'Circuit Master 🔌';
  if (acc >= 0.8) return 'Boolean Brain ⚙️';
  return 'Learning Logic 🔧';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function LogicGateGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const bgAnimRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { total: 0, correct: 0, wrong: 0, andGates: 0, orGates: 0, notGates: 0, avgSolveMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 } as Signals,
    gate: null as Gate | null, shownAt: 0, feedback: null as boolean | null,
    level: 1,
    gateMesh: null as THREE.Mesh | null, gateLight: null as THREE.PointLight | null,
    wireMeshes: [] as THREE.Mesh[],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [pbBeaten, setPbBeaten] = useState(false);
  const [gateDisplay, setGateDisplay] = useState<{ gate: Gate | null; feedback: boolean | null }>({ gate: null, feedback: null });
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const nextGate = useCallback(() => {
    const s = stateRef.current;
    const g = makeGatePuzzle(s.level);
    s.gate = g; s.shownAt = Date.now(); s.feedback = null;
    setGateDisplay({ gate: g, feedback: null });
    if (g.type === 'AND') s.sig.andGates++;
    else if (g.type === 'OR') s.sig.orGates++;
    else if (g.type === 'NOT') s.sig.notGates++;
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(bgAnimRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        const _pbKey = 'pb_logic-gate';
    const _finalScore = stateRef.current.sig.score;
    const _prevPb = parseInt(typeof window !== 'undefined' ? localStorage.getItem(_pbKey) ?? '0' : '0', 10);
    if (_finalScore > _prevPb) { if (typeof window !== 'undefined') localStorage.setItem(_pbKey, String(_finalScore)); setPbBeaten(true); }
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  // 3D circuit board background
  useEffect(() => {
    if (phase !== 'playing') return;
    if (!mountRef.current) return;
    const mount = mountRef.current;

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setClearColor(0x050a10, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 200);
    camera.position.set(0, 4, 10);
    // === POLISH: Atmospheric particle field ===
    const _sfCount = 80;
    const _sfGeo = new THREE.BufferGeometry();
    const _sfPos = new Float32Array(_sfCount * 3);
    for (let _i = 0; _i < _sfCount; _i++) {
      _sfPos[_i*3] = (Math.random()-0.5)*20;
      _sfPos[_i*3+1] = (Math.random()-0.5)*15;
      _sfPos[_i*3+2] = (Math.random()-0.5)*8-3;
    }
    _sfGeo.setAttribute('position', new THREE.BufferAttribute(_sfPos, 3));
    scene.add(new THREE.Points(_sfGeo, new THREE.PointsMaterial({ color: 0xaaddff, size: 0.05, transparent: true, opacity: 0.4 })));
    // === END POLISH ===
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x0a1020, 5));
    const blueLight = new THREE.PointLight(0x3b82f6, 2, 20);
    blueLight.position.set(0, 5, 5);
    scene.add(blueLight);
    const greenLight = new THREE.PointLight(0x10b981, 1.5, 15);
    greenLight.position.set(-5, 3, 3);
    scene.add(greenLight);
    stateRef.current.gateLight = blueLight;

    // Circuit board surface
    const boardGeo = new THREE.PlaneGeometry(20, 14);
    const boardMat = new THREE.MeshPhongMaterial({ color: 0x0d2137, emissive: 0x051020 });
    const board = new THREE.Mesh(boardGeo, boardMat);
    board.rotation.x = -Math.PI / 4;
    board.position.y = -2;
    scene.add(board);

    // Circuit traces
    for (let i = 0; i < 12; i++) {
      const traceGeo = new THREE.BoxGeometry(0.05, 8 + Math.random() * 4, 0.02);
      const traceMat = new THREE.MeshBasicMaterial({ color: 0x065f46, transparent: true, opacity: 0.4 });
      const trace = new THREE.Mesh(traceGeo, traceMat);
      trace.rotation.x = -Math.PI / 4;
      trace.position.set((Math.random() - 0.5) * 16, -1 + Math.random() * 2, Math.random() * -2);
      scene.add(trace);
    }

    // Gate shape (hexagonal chip)
    const gateGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.4, 6);
    const gateMat = new THREE.MeshPhongMaterial({ color: 0x1e3a5f, emissive: 0x0c2040, shininess: 100 });
    const gateMesh = new THREE.Mesh(gateGeo, gateMat);
    gateMesh.position.y = 1;
    scene.add(gateMesh);
    stateRef.current.gateMesh = gateMesh;

    // Gate connection nodes
    for (let i = -1; i <= 1; i += 2) {
      const nodeGeo = new THREE.SphereGeometry(0.15, 10, 10);
      const nodeMat = new THREE.MeshPhongMaterial({ color: 0x3b82f6, emissive: 0x1e3a5f });
      const node = new THREE.Mesh(nodeGeo, nodeMat);
      node.position.set(i * 2, 1, 0);
      scene.add(node);
    }

    // Floating bit particles
    const bits: { mesh: THREE.Mesh; vy: number; life: number }[] = [];

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    let t = 0;
    const loop = () => {
      bgAnimRef.current = requestAnimationFrame(loop);
      t += 0.012;

      gateMesh.rotation.y += 0.01;
      const s = stateRef.current;
      const correct = s.feedback === true;
      const wrong = s.feedback === false;
      gateMat.color.setHex(correct ? 0x065f46 : wrong ? 0x7f1d1d : 0x1e3a5f);
      gateMat.emissive.setHex(correct ? 0x022c22 : wrong ? 0x450a0a : 0x0c2040);
      blueLight.intensity = 1.5 + Math.sin(t * 2) * 0.5;
      blueLight.color.setHex(correct ? 0x22c55e : wrong ? 0xef4444 : 0x3b82f6);

      // Spawn bit particles occasionally
      if (Math.random() < 0.05) {
        const bGeo = new THREE.BoxGeometry(0.1, 0.1, 0.05);
        const bMat = new THREE.MeshBasicMaterial({ color: Math.random() > 0.5 ? 0x22c55e : 0xef4444, transparent: true, opacity: 0.8 });
        const bm = new THREE.Mesh(bGeo, bMat);
        bm.position.set((Math.random() - 0.5) * 8, -2, (Math.random() - 0.5) * 4);
        scene.add(bm);
        bits.push({ mesh: bm, vy: 0.02 + Math.random() * 0.03, life: 1 });
      }
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i];
        b.mesh.position.y += b.vy; b.life -= 0.015;
        (b.mesh.material as THREE.MeshBasicMaterial).opacity = b.life * 0.8;
        if (b.life <= 0) { scene.remove(b.mesh); bits.splice(i, 1); }
      }

      renderer.render(scene, camera);
    };
    loop();

    return () => {
      stateRef.current.gateMesh = null; stateRef.current.gateLight = null;
      cancelAnimationFrame(bgAnimRef.current);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.level = 1;
    s.sig = { total: 0, correct: 0, wrong: 0, andGates: 0, orGates: 0, notGates: 0, avgSolveMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION);
    nextGate();

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);
    return () => { s.running = false; if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [phase, endGame, nextGate]);

  const handleAnswer = useCallback((answer: boolean) => {
    const s = stateRef.current;
    if (!s.gate || s.feedback !== null) return;
    const ms = Date.now() - s.shownAt;
    s.sig.total++; s.sig.totalMs += ms;
    const correct = answer === s.gate.output;
    s.feedback = correct;
    setGateDisplay(prev => ({ ...prev, feedback: correct }));

    if (correct) {
      s.sig.correct++; s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const speedPts = ms < 2000 ? 3 : ms < 4000 ? 2 : 1;
      s.sig.score += speedPts; setScoreDisplay(s.sig.score);
      s.sig.avgSolveMs = Math.round(s.sig.totalMs / s.sig.correct);
      s.level = Math.min(5, 1 + Math.floor(s.sig.correct / 4));
      sfx.collect(); hapticScore();
      if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
    } else {
      s.sig.wrong++; s.sig.streakCurrent = 0;
      sfx.collision(); hapticFail();
    }
    setTimeout(() => { if (s.running) nextGate(); }, 600);
  }, [nextGate]);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const { gate, feedback } = gateDisplay;
  const gateColor = feedback === true ? '#22c55e' : feedback === false ? '#ef4444' : '#64748b';

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg,#050a10 0%,#08101a 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Wire Up! ⚙️" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={() => setPhase('playing')} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} aria-label="Game area. Use touch or pointer to interact." role="application" style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none' }} />

      {phase === 'playing' && (
        <>
          <div aria-live="polite" style={{position:'absolute',left:'-9999px',width:'1px',height:'1px',overflow:'hidden'}}>Score: {scoreDisplay}</div>
          <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', padding: '0 20px 60px', pointerEvents: 'none', zIndex: 10 }}>
            {gate && (
              <div style={{ width: '100%', maxWidth: 360, pointerEvents: 'auto' }}>
                {/* Gate visual */}
                <div style={{ background: 'rgba(30,58,95,0.3)', border: `2px solid rgba(59,130,246,0.3)`, borderRadius: 16, padding: '20px', marginBottom: 16, textAlign: 'center' }}>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginBottom: 8 }}>LOGIC GATE</div>
                  <div style={{ color: gateColor, fontSize: 32, fontWeight: 900, textShadow: `0 0 12px ${gateColor}`, fontFamily: 'monospace', marginBottom: 12 }}>{gate.type}</div>
                  {/* Inputs */}
                  <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 8 }}>
                    {gate.inputs.map((input, i) => (
                      <div key={i} style={{ background: input ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)', border: `1px solid ${input ? '#22c55e' : '#ef4444'}`, borderRadius: 10, padding: '8px 16px', color: input ? '#4ade80' : '#f87171', fontWeight: 700, fontFamily: 'monospace', fontSize: 18 }}>
                        {`IN${i + 1}: ${input ? '1' : '0'}`}
                      </div>
                    ))}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>→ OUTPUT = ?</div>
                </div>
                {/* Answer buttons */}
                <div style={{ display: 'flex', gap: 12 }}>
                  <button onClick={() => handleAnswer(true)} disabled={feedback !== null}
                    style={{ flex: 1, background: feedback !== null && gate.output ? 'rgba(34,197,94,0.4)' : 'rgba(34,197,94,0.15)', border: '2px solid #22c55e', borderRadius: 14, padding: '20px', color: '#4ade80', fontWeight: 900, fontSize: 28, cursor: 'pointer', boxShadow: '0 0 10px rgba(34,197,94,0.2)' }}>
                    1 (TRUE)
                  </button>
                  <button onClick={() => handleAnswer(false)} disabled={feedback !== null}
                    style={{ flex: 1, background: feedback !== null && !gate.output ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.15)', border: '2px solid #ef4444', borderRadius: 14, padding: '20px', color: '#f87171', fontWeight: 900, fontSize: 28, cursor: 'pointer', boxShadow: '0 0 10px rgba(239,68,68,0.2)' }}>
                    0 (FALSE)
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Accuracy', value: `${finalSig.total > 0 ? Math.round(finalSig.correct / finalSig.total * 100) : 0}%`, color: '#4ade80' },
            { label: 'Total Solved', value: `${finalSig.total}`, color: ACCENT },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
            { label: 'Avg Speed', value: finalSig.correct > 0 ? `${finalSig.avgSolveMs}ms` : '—', color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.correct >= 10} />
      )}
      {phase === 'done' && pbBeaten && (
        <div style={{position:'fixed',top:'16px',left:'50%',transform:'translateX(-50%)',background:'#fbbf24',color:'#000',padding:'8px 20px',borderRadius:'999px',fontWeight:700,fontSize:'1rem',zIndex:9999,boxShadow:'0 4px 12px rgba(0,0,0,0.3)',animation:'none'}}>🏆 New Personal Best!</div>
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const LogicGateGame = dynamic(() => Promise.resolve({ default: LogicGateGameInner }), { ssr: false });
export default LogicGateGame;
