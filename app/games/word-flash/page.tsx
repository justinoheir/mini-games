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

const GAME_ID = 'word-flash';
const ACCENT = '#ec4899';
const DURATION = 60;
const GAME_EMOJI = '📚';
const GAME_TITLE = 'Word Flash';
const GAME_TAGLINE = 'Read it. Remember it. Recall it.';

interface Signals { total: number; hits: number; correctRejections: number; falseAlarms: number; misses: number; avgReactionMs: number; totalMs: number; score: number; maxStreak: number; streakCurrent: number; }
function getPersonality(sig: Signals): string {
  const hitRate = sig.total > 0 ? (sig.hits + sig.correctRejections) / sig.total : 0;
  if (hitRate >= 0.9 && sig.falseAlarms === 0) return 'Photographic 📸';
  if (sig.hits >= 15) return 'Memory Palace 🏛️';
  if (hitRate >= 0.8) return 'Sharp Recall 📚';
  if (sig.falseAlarms <= 1) return 'Careful Thinker 🧠';
  return 'Still Encoding 💭';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
type SubPhase = 'flash' | 'probe';

const WORD_POOL = [
  'CLOUD', 'RIVER', 'FLAME', 'STONE', 'LIGHT', 'STORM', 'GLASS', 'BLADE', 'SWIFT', 'DREAM',
  'FOCUS', 'LASER', 'TOWER', 'SPARK', 'GHOST', 'EAGLE', 'FROST', 'PEARL', 'SURGE', 'PRISM',
  'BLOOM', 'COMET', 'ORBIT', 'PULSE', 'QUARTZ', 'RAVEN', 'SOLAR', 'TITAN', 'ULTRA', 'VIVID',
];

function WordFlashGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    sig: { total: 0, hits: 0, correctRejections: 0, falseAlarms: 0, misses: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 } as Signals,
    flashWords: [] as string[],
    probeWord: '',
    probeIsSeen: false,
    subPhase: 'flash' as SubPhase,
    flashIdx: 0,
    probeStart: 0, frame: 0,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [displayWord, setDisplayWord] = useState('');
  const [subPhaseDisplay, setSubPhaseDisplay] = useState<'flash' | 'probe'>('flash');
  const [flashGlow, setFlashGlow] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (phaseTimerRef.current) { clearTimeout(phaseTimerRef.current); phaseTimerRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const startRound = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    // Pick 3-5 words to flash
    const pool = [...WORD_POOL].sort(() => Math.random() - 0.5);
    const count = 2 + Math.floor(s.sig.score / 10);
    s.flashWords = pool.slice(0, Math.min(count, 5));
    s.flashIdx = 0;
    s.subPhase = 'flash';
    setSubPhaseDisplay('flash');

    const showNextWord = () => {
      if (!s.running) return;
      if (s.flashIdx < s.flashWords.length) {
        setDisplayWord(s.flashWords[s.flashIdx]);
        setFlashGlow(true);
        setTimeout(() => setFlashGlow(false), 200);
        s.flashIdx++;
        phaseTimerRef.current = setTimeout(showNextWord, 900);
      } else {
        // Switch to probe phase
        s.subPhase = 'probe';
        setSubPhaseDisplay('probe');
        s.sig.total++;
        const isSeen = Math.random() > 0.4;
        s.probeIsSeen = isSeen;
        if (isSeen) {
          s.probeWord = s.flashWords[Math.floor(Math.random() * s.flashWords.length)];
        } else {
          const unseen = WORD_POOL.filter(w => !s.flashWords.includes(w));
          s.probeWord = unseen[Math.floor(Math.random() * unseen.length)];
        }
        setDisplayWord(s.probeWord);
        s.probeStart = Date.now();
      }
    };
    showNextWord();
  }, []);

  const handleAnswer = useCallback((seenAnswer: boolean) => {
    const s = stateRef.current;
    if (s.subPhase !== 'probe' || !s.running) return;
    const elapsed = Date.now() - s.probeStart;
    const correct = seenAnswer === s.probeIsSeen;

    if (correct) {
      const pts = elapsed < 1000 ? 3 : elapsed < 2000 ? 2 : 1;
      if (s.probeIsSeen) s.sig.hits++; else s.sig.correctRejections++;
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      s.sig.score += pts + (s.sig.streakCurrent >= 3 ? 1 : 0);
      s.sig.totalMs += elapsed;
      s.sig.avgReactionMs = s.sig.totalMs / (s.sig.hits + s.sig.correctRejections || 1);
      setScoreDisplay(s.sig.score);
      sfx.collect(); hapticScore();
      setFeedbackMsg('✓ Correct!');
    } else {
      if (s.probeIsSeen) s.sig.misses++; else s.sig.falseAlarms++;
      s.sig.streakCurrent = 0;
      s.sig.score = Math.max(0, s.sig.score - 1);
      setScoreDisplay(s.sig.score);
      sfx.nearMiss(); hapticFail();
      setFeedbackMsg('✗ Wrong');
    }
    setTimeout(() => {
      setFeedbackMsg(null);
      if (s.running) startRound();
    }, 600);
  }, [startRound]);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { total: 0, hits: 0, correctRejections: 0, falseAlarms: 0, misses: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0014);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 12);
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

    scene.add(new THREE.AmbientLight(0x110022, 2));
    const pLight = new THREE.PointLight(0xec4899, 4, 25);
    pLight.position.set(0, 3, 5);
    scene.add(pLight);
    const sLight = new THREE.PointLight(0xa855f7, 2, 20);
    sLight.position.set(-4, -2, 3);
    scene.add(sLight);

    // Floating 3D letter orbs as background decoration
    const orbColors = [0xec4899, 0xa855f7, 0x818cf8, 0xf0abfc, 0x7c3aed];
    const orbs: { mesh: THREE.Mesh; vx: number; vy: number; vz: number }[] = [];
    for (let i = 0; i < 15; i++) {
      const r = 0.15 + Math.random() * 0.25;
      const geo = new THREE.IcosahedronGeometry(r, 1);
      const mat = new THREE.MeshStandardMaterial({ color: orbColors[i % 5], roughness: 0.4, metalness: 0.3, emissive: orbColors[i % 5], emissiveIntensity: 0.2, transparent: true, opacity: 0.4 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6 - 2);
      scene.add(mesh);
      orbs.push({ mesh, vx: (Math.random() - 0.5) * 0.005, vy: (Math.random() - 0.5) * 0.005, vz: 0 });
    }

    // Central glow sphere (pulses with words)
    const glowGeo = new THREE.SphereGeometry(1.2, 16, 16);
    const glowMat = new THREE.MeshStandardMaterial({ color: 0xec4899, transparent: true, opacity: 0.08, emissive: 0xec4899, emissiveIntensity: 0.3 });
    const glowSphere = new THREE.Mesh(glowGeo, glowMat);
    scene.add(glowSphere);

    // Pulsing rings
    const ringMeshes: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const rGeo = new THREE.TorusGeometry(1.5 + i * 0.8, 0.04, 8, 32);
      const rMat = new THREE.MeshStandardMaterial({ color: 0xec4899, emissive: 0xec4899, emissiveIntensity: 0.4, transparent: true, opacity: 0.25 });
      const r = new THREE.Mesh(rGeo, rMat);
      r.rotation.x = Math.PI / 4 + i * 0.4;
      scene.add(r); ringMeshes.push(r);
    }

    // Stars
    const starCount = 500;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 60;
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 60;
      starPos[i * 3 + 2] = -10 + (Math.random() - 0.5) * 30;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06 })));

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Float orbs
      orbs.forEach(orb => {
        orb.mesh.position.x += orb.vx;
        orb.mesh.position.y += orb.vy;
        if (Math.abs(orb.mesh.position.x) > 7) orb.vx *= -1;
        if (Math.abs(orb.mesh.position.y) > 5) orb.vy *= -1;
        orb.mesh.rotation.x += 0.01;
        orb.mesh.rotation.y += 0.015;
      });

      // Pulse rings
      ringMeshes.forEach((r, i) => {
        r.rotation.z += 0.005 + i * 0.002;
        r.rotation.x += 0.002;
        (r.material as THREE.MeshStandardMaterial).opacity = 0.15 + Math.sin(s.frame * 0.04 + i * 1.2) * 0.1;
      });

      // Glow pulse
      (glowMat as THREE.MeshStandardMaterial).opacity = 0.06 + Math.sin(s.frame * 0.06) * 0.04;
      glowSphere.scale.setScalar(1 + Math.sin(s.frame * 0.04) * 0.05);

      pLight.intensity = 4 + Math.sin(s.frame * 0.06) * 0.8;
      pLight.color.setHSL(0.9 + Math.sin(s.frame * 0.005) * 0.05, 0.9, 0.6);

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);

    setTimeout(() => { if (s.running) startRound(); }, 300);
  }, [endGame, startRound]);

  useEffect(() => () => {
    const s = stateRef.current; s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    if (stateRef.current.renderer) { stateRef.current.renderer.dispose(); stateRef.current.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setDisplayWord(''); setFeedbackMsg(null);
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 0%, rgba(236,72,153,0.15) 0%, transparent 55%), linear-gradient(180deg,#0a0014 0%,#050008 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={accent} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <>
        <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />
        {/* Word display overlay */}
        <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 30 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.15em', color: accent, opacity: 0.8, marginBottom: 12 }}>
            {subPhaseDisplay === 'flash' ? 'MEMORIZE' : 'SEEN BEFORE?'}
          </div>
          <div style={{
            fontSize: 52, fontWeight: 900, letterSpacing: '0.06em',
            color: flashGlow ? '#ffffff' : (subPhaseDisplay === 'probe' ? '#fbbf24' : accent),
            textShadow: `0 0 ${flashGlow ? 40 : 20}px ${accent}`,
            transition: 'all 150ms',
            background: 'rgba(0,0,0,0.4)', padding: '12px 28px', borderRadius: 16,
            border: `2px solid ${subPhaseDisplay === 'probe' ? '#fbbf24' : accent}44`,
          }}>
            {displayWord || '...'}
          </div>
          {feedbackMsg && (
            <div style={{ marginTop: 20, fontSize: 24, fontWeight: 800, color: feedbackMsg.startsWith('✓') ? '#4ade80' : '#ef4444', textShadow: '0 0 12px currentColor' }}>
              {feedbackMsg}
            </div>
          )}
        </div>
        {/* YES / NO buttons */}
        {subPhaseDisplay === 'probe' && !feedbackMsg && (
          <div style={{ position: 'fixed', bottom: '12%', left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 24, zIndex: 40 }}>
            <button onClick={() => handleAnswer(true)} style={{ padding: '16px 48px', fontSize: 22, fontWeight: 800, background: '#4ade80', color: '#000', border: 'none', borderRadius: 16, cursor: 'pointer', boxShadow: '0 0 20px #4ade8066' }}>
              YES ✓
            </button>
            <button onClick={() => handleAnswer(false)} style={{ padding: '16px 48px', fontSize: 22, fontWeight: 800, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 16, cursor: 'pointer', boxShadow: '0 0 20px #ef444466' }}>
              NO ✗
            </button>
          </div>
        )}
      </>}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Correct', value: `${finalSig.hits + finalSig.correctRejections}/${finalSig.total}`, color: '#4ade80' }, { label: 'False Alarms', value: String(finalSig.falseAlarms), color: finalSig.falseAlarms === 0 ? '#4ade80' : '#ef4444' }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: accent }, { label: 'Avg React', value: finalSig.avgReactionMs > 0 ? `${Math.round(finalSig.avgReactionMs)}ms` : '—', color: '#fbbf24' }]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.hits >= 10} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const WordFlashGame = dynamic(() => Promise.resolve({ default: WordFlashGameInner }), { ssr: false });
export default WordFlashGame;
