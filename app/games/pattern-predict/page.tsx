'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'pattern-predict';
const ACCENT = '#14b8a6';
const DURATION = 45;
const GAME_EMOJI = '📈';
const GAME_TITLE = 'Pattern Predict';
const GAME_TAGLINE = "What comes next? You tell me.";

interface Signals { total: number; correct: number; wrong: number; avgReactionMs: number; totalMs: number; level: number; score: number; maxStreak: number; streakCurrent: number; }
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const acc = sig.total > 0 ? sig.correct / sig.total : 0;
  if (acc >= 0.9 && sig.level >= 5) return 'Pattern Oracle 🔮';
  if (sig.level >= 6) return 'Sequence Sage 📈';
  if (acc >= 0.8) return 'Logic Pro 💡';
  if (sig.avgReactionMs < 1500) return 'Quick Thinker ⚡';
  return 'Pattern Learner 🌱';
}

const SHAPE_TYPES = ['sphere', 'box', 'cone', 'octahedron', 'torus'];
const PALETTE = [0x14b8a6, 0xa855f7, 0xf97316, 0xef4444, 0x3b82f6, 0xfacc15];

interface Pattern { sequenceTypes: string[]; answerType: string; options: string[]; }

function genPattern(level: number): Pattern {
  const n = Math.min(4, 2 + Math.floor(level / 2));
  const base = SHAPE_TYPES[Math.floor(Math.random() * SHAPE_TYPES.length)];
  const alt = SHAPE_TYPES[(SHAPE_TYPES.indexOf(base) + 1 + Math.floor(Math.random()*(SHAPE_TYPES.length-1))) % SHAPE_TYPES.length];
  let seq: string[];
  if (level < 2) { seq = [base, base, base, alt].slice(0, n + 1); }
  else if (level < 4) { seq = [base, alt, base, alt, base].slice(0, n + 1); }
  else { seq = [base, alt, base, base, alt].slice(0, n + 1); }
  const answer = seq[seq.length - 1];
  const others = SHAPE_TYPES.filter(s => s !== answer);
  const opts = [answer, others[0], others[1]].sort(() => Math.random() - 0.5);
  return { sequenceTypes: seq.slice(0, -1), answerType: answer, options: opts };
}

function makeGeometry(type: string): THREE.BufferGeometry {
  switch (type) {
    case 'box': return new THREE.BoxGeometry(0.5, 0.5, 0.5);
    case 'cone': return new THREE.ConeGeometry(0.3, 0.65, 8);
    case 'octahedron': return new THREE.OctahedronGeometry(0.35);
    case 'torus': return new THREE.TorusGeometry(0.25, 0.1, 8, 16);
    default: return new THREE.SphereGeometry(0.32, 16, 16);
  }
}

function PatternPredictInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seqMeshesRef = useRef<THREE.Mesh[]>([]);
  const optMeshesRef = useRef<THREE.Mesh[]>([]);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { total: 0, correct: 0, wrong: 0, avgReactionMs: 0, totalMs: 0, level: 1, score: 0, maxStreak: 0, streakCurrent: 0 } as Signals,
    pattern: null as Pattern | null, probStart: 0, answered: false,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [pbBeaten, setPbBeaten] = useState(false);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (s.sig.total > 0) s.sig.avgReactionMs = s.sig.totalMs / s.sig.total;
    hapticVictory();
        const _pbKey = 'pb_pattern-predict';
    const _finalScore = stateRef.current.sig.score;
    const _prevPb = parseInt(typeof window !== 'undefined' ? localStorage.getItem(_pbKey) ?? '0' : '0', 10);
    if (_finalScore > _prevPb) { if (typeof window !== 'undefined') localStorage.setItem(_pbKey, String(_finalScore)); setPbBeaten(true); }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const buildQuestion = useCallback(() => {
    const s = stateRef.current;
    const scene = sceneRef.current; if (!scene) return;
    seqMeshesRef.current.forEach(m => scene.remove(m)); seqMeshesRef.current = [];
    optMeshesRef.current.forEach(m => scene.remove(m)); optMeshesRef.current = [];
    const p = genPattern(s.sig.level);
    s.pattern = p; s.probStart = Date.now(); s.answered = false;
    // Sequence items (top row)
    const seqN = p.sequenceTypes.length;
    p.sequenceTypes.forEach((type, i) => {
      const x = -3 + i * (6 / Math.max(seqN-1, 1));
      const col = PALETTE[i % PALETTE.length];
      const geo = makeGeometry(type);
      const mat = new THREE.MeshStandardMaterial({ color: col, emissive: new THREE.Color(col).multiplyScalar(0.2), roughness: 0.3, metalness: 0.5 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 2, 0);
      scene.add(mesh); seqMeshesRef.current.push(mesh);
    });
    // Question mark placeholder
    const qGeo = new THREE.TorusGeometry(0.3, 0.05, 8, 32);
    const qMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x888888, roughness: 0.5 });
    const qMesh = new THREE.Mesh(qGeo, qMat);
    qMesh.position.set(3.5, 2, 0);
    scene.add(qMesh); seqMeshesRef.current.push(qMesh);
    // Options (bottom row)
    p.options.forEach((type, i) => {
      const x = -2.5 + i * 2.5;
      const col = PALETTE[(i + 2) % PALETTE.length];
      const geo = makeGeometry(type);
      const mat = new THREE.MeshStandardMaterial({ color: col, emissive: new THREE.Color(col).multiplyScalar(0.2), roughness: 0.3, metalness: 0.5 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, -1.5, 0);
      mesh.userData = { type, idx: i };
      scene.add(mesh); optMeshesRef.current.push(mesh);
    });
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { total: 0, correct: 0, wrong: 0, avgReactionMs: 0, totalMs: 0, level: 1, score: 0, maxStreak: 0, streakCurrent: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060c10);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 60);
    camera.position.set(0, 0, 9);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x082020, 3));
    scene.add(Object.assign(new THREE.PointLight(0x14b8a6, 60, 20), { position: new THREE.Vector3(2, 4, 7) }));
    scene.add(Object.assign(new THREE.PointLight(0xa855f7, 40, 15), { position: new THREE.Vector3(-3, -3, 5) }));

    // Stars
    const sg = new THREE.BufferGeometry();
    const sp = new Float32Array(400);
    for (let i = 0; i < 400; i += 3) { sp[i] = (Math.random()-0.5)*40; sp[i+1] = (Math.random()-0.5)*40; sp[i+2] = (Math.random()-0.5)*10-8; }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x14b8a6, size: 0.05 })));

    // Divider line
    const divGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-5, 0, 0), new THREE.Vector3(5, 0, 0)]);
    scene.add(new THREE.Line(divGeo, new THREE.LineBasicMaterial({ color: 0x14b8a6, transparent: true, opacity: 0.3 })));

    buildQuestion();

    const raycaster = new THREE.Raycaster();
    const onTap = (e: PointerEvent) => {
      if (!s.running || s.answered || !s.pattern) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(((e.clientX - rect.left)/rect.width)*2-1, -((e.clientY - rect.top)/rect.height)*2+1);
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(optMeshesRef.current);
      if (!hits.length) return;
      const { type, idx } = hits[0].object.userData as { type: string; idx: number };
      s.answered = true;
      const correct = type === s.pattern.answerType;
      const rt = Date.now() - s.probStart;
      s.sig.total++; s.sig.totalMs += rt;
      if (correct) {
        s.sig.correct++; s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const pts = Math.max(1, 5 - Math.floor(rt / 1500)) * (s.sig.streakCurrent >= 3 ? 2 : 1);
        s.sig.score += pts; setScoreDisplay(s.sig.score);
        s.sig.level = Math.min(7, s.sig.level + 1);
        ((hits[0].object as THREE.Mesh).material as THREE.MeshStandardMaterial).emissive.set(0x4ade80);
        ((hits[0].object as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 3;
        sfx.collect(); hapticScore();
      } else {
        s.sig.wrong++; s.sig.streakCurrent = 0;
        s.sig.level = Math.max(1, s.sig.level - 1);
        ((hits[0].object as THREE.Mesh).material as THREE.MeshStandardMaterial).emissive.set(0xef4444);
        ((hits[0].object as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 3;
        sfx.collision(); hapticFail();
      }
      setTimeout(() => { if (s.running) buildQuestion(); }, 600);
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
      seqMeshesRef.current.forEach((m, i) => { m.rotation.y += 0.015; m.position.y = 2 + Math.sin(t + i * 0.8) * 0.08; });
      optMeshesRef.current.forEach((m, i) => { m.rotation.y += 0.02; m.position.y = -1.5 + Math.sin(t * 1.2 + i) * 0.1; });
      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => { renderer.domElement.removeEventListener('pointerdown', onTap); };
  }, [endGame, buildQuestion]);

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
      background="radial-gradient(ellipse at 50% 30%, rgba(20,184,166,0.1) 0%, transparent 60%), linear-gradient(180deg, #060c10 0%, #030608 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Predict! 📈" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} aria-label="Game area. Use touch or pointer to interact." role="application" style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <>
              <div aria-live="polite" style={{position:'absolute',left:'-9999px',width:'1px',height:'1px',overflow:'hidden'}}>Score: {scoreDisplay}</div>
          <GameHUD accentColor={accent} items={[
                { label: 'TIME', value: timeLeft, danger: timeLeft <= 10, testId: 'timer' },
                { label: 'SCORE', value: scoreDisplay, testId: 'score' },
              ]} />
              <div style={{ position: 'absolute', top: '13%', left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.4)', fontSize: 12, pointerEvents: 'none' }}>SEQUENCE ↑ · TAP WHAT COMES NEXT ↓</div>
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Correct', value: `${finalSig.correct}/${finalSig.total}`, color: '#4ade80' },
            { label: 'Avg Speed', value: finalSig.total > 0 ? `${Math.round(finalSig.totalMs/finalSig.total)}ms` : '—', color: accent },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
            { label: 'Level', value: `${finalSig.level}`, color: accent },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.correct >= 6} />
      )}
      {phase === 'done' && pbBeaten && (
        <div style={{position:'fixed',top:'16px',left:'50%',transform:'translateX(-50%)',background:'#fbbf24',color:'#000',padding:'8px 20px',borderRadius:'999px',fontWeight:700,fontSize:'1rem',zIndex:9999,boxShadow:'0 4px 12px rgba(0,0,0,0.3)',animation:'none'}}>🏆 New Personal Best!</div>
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const PatternPredict = dynamic(() => Promise.resolve({ default: PatternPredictInner }), { ssr: false });
export default PatternPredict;
