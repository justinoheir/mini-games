'use client';
/**
 * MORSE DECODE — 3D flashing signal orb + letter selection UI.
 * Read the flashing code, tap the correct letter.
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

const GAME_ID = 'morse-decode';
const ACCENT = '#facc15';
const DURATION = 60;
const GAME_EMOJI = '💡';
const GAME_TITLE = 'Morse Decode';
const GAME_TAGLINE = 'Read the flashing code — tap the correct letter.';

const MORSE_TABLE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
};
const LETTERS = Object.keys(MORSE_TABLE);

interface Signals { correctAnswers: number; wrongAnswers: number; avgDecodeTime: number; longestStreak: number; streakCurrent: number; score: number; }

function getPersonality(sig: Signals): string {
  const acc = (sig.correctAnswers + sig.wrongAnswers) > 0 ? sig.correctAnswers / (sig.correctAnswers + sig.wrongAnswers) : 0;
  if (acc >= 0.85 && sig.longestStreak >= 5) return 'Telegraph Master 📟';
  if (sig.longestStreak >= 6) return 'Code Streak ⚡';
  if (acc >= 0.7) return 'Signal Reader 💡';
  return 'Static Noise 📻';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface PuzzleState { letter: string; options: string[]; feedback: number | null; shownAt: number; flashing: boolean; flashIdx: number; flashTimer: number; }

export default function MorseDecodeGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const bgAnimRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bgRendererRef = useRef<THREE.WebGLRenderer | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { correctAnswers: 0, wrongAnswers: 0, avgDecodeTime: 0, longestStreak: 0, streakCurrent: 0, score: 0 } as Signals,
    puzzle: null as PuzzleState | null,
    flashTimeouts: [] as ReturnType<typeof setTimeout>[],
    orbMesh: null as THREE.Mesh | null,
    orbLight: null as THREE.PointLight | null,
    isFlashing: false,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [puzzleDisplay, setPuzzleDisplay] = useState<{ letter: string; options: string[]; feedback: number | null; morseDisplay: string; isFlashing: boolean }>({ letter: '', options: [], feedback: null, morseDisplay: '', isFlashing: false });
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const flashMorse = useCallback((letter: string) => {
    const s = stateRef.current;
    s.flashTimeouts.forEach(t => clearTimeout(t));
    s.flashTimeouts = [];
    const morse = MORSE_TABLE[letter];
    const DOT_MS = 200, DASH_MS = 500, GAP_MS = 200, LETTER_GAP = 600;
    let t = 0;
    for (const sym of morse) {
      const dur = sym === '.' ? DOT_MS : DASH_MS;
      const t1 = setTimeout(() => {
        s.isFlashing = true;
        if (s.orbMesh) (s.orbMesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 2;
        if (s.orbLight) s.orbLight.intensity = 6;
        sfx.tick(); haptic([10]);
      }, t);
      const t2 = setTimeout(() => {
        s.isFlashing = false;
        if (s.orbMesh) (s.orbMesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 0.2;
        if (s.orbLight) s.orbLight.intensity = 0.5;
      }, t + dur);
      s.flashTimeouts.push(t1, t2);
      t += dur + GAP_MS;
    }
    // Show answer UI after flashing complete
    const t3 = setTimeout(() => { setPuzzleDisplay(prev => ({ ...prev, isFlashing: false })); }, t + LETTER_GAP);
    s.flashTimeouts.push(t3);
  }, []);

  const nextPuzzle = useCallback(() => {
    const s = stateRef.current;
    const letter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
    const wrongLetters = LETTERS.filter(l => l !== letter).sort(() => Math.random() - 0.5).slice(0, 3);
    const options = [letter, ...wrongLetters].sort(() => Math.random() - 0.5);
    const morse = MORSE_TABLE[letter];
    const puzzle: PuzzleState = { letter, options, feedback: null, shownAt: Date.now(), flashing: true, flashIdx: 0, flashTimer: 0 };
    s.puzzle = puzzle;
    setPuzzleDisplay({ letter, options, feedback: null, morseDisplay: morse, isFlashing: true });
    flashMorse(letter);
  }, [flashMorse]);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    s.flashTimeouts.forEach(t => clearTimeout(t));
    cancelAnimationFrame(bgAnimRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  // 3D background: telegraph/signal atmosphere
  useEffect(() => {
    if (phase !== 'playing') return;
    if (!mountRef.current) return;
    const mount = mountRef.current;

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setClearColor(0x08060a, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    bgRendererRef.current = renderer;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 200);
    camera.position.set(0, 0, 10);

    scene.add(new THREE.AmbientLight(0x1a1400, 5));
    const goldLight = new THREE.PointLight(0xfacc15, 1.5, 20);
    goldLight.position.set(0, 3, 5);
    scene.add(goldLight);

    // Signal orb (main visual)
    const orbGeo = new THREE.SphereGeometry(1.2, 24, 24);
    const orbMat = new THREE.MeshPhongMaterial({ color: 0xfacc15, emissive: 0xf59e0b, emissiveIntensity: 0.2, transparent: true, opacity: 0.85, shininess: 100 });
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.y = 1;
    scene.add(orb);
    stateRef.current.orbMesh = orb;

    const orbLight = new THREE.PointLight(0xfacc15, 0.5, 8);
    orbLight.position.set(0, 1, 2);
    scene.add(orbLight);
    stateRef.current.orbLight = orbLight;

    // Rings around orb
    for (let i = 0; i < 3; i++) {
      const ringGeo = new THREE.TorusGeometry(1.4 + i * 0.3, 0.03, 8, 32);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.2 - i * 0.05 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = (i * Math.PI) / 4;
      orb.add(ring);
    }

    // Signal wave particles
    const waveNodes: { mesh: THREE.Mesh; angle: number; speed: number; radius: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const geo = new THREE.SphereGeometry(0.04, 6, 6);
      const mat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.5 });
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      waveNodes.push({ mesh, angle: (i / 12) * Math.PI * 2, speed: 0.02 + Math.random() * 0.02, radius: 2.5 + Math.random() * 1 });
    }

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    let t = 0;
    const loop = () => {
      bgAnimRef.current = requestAnimationFrame(loop);
      t += 0.01;

      const isFlashing = stateRef.current.isFlashing;
      orbMat.emissiveIntensity = isFlashing ? 2 + Math.sin(t * 30) * 0.5 : 0.15 + Math.sin(t * 2) * 0.1;
      goldLight.intensity = isFlashing ? 4 : 1 + Math.sin(t * 2) * 0.3;
      orb.rotation.y += 0.005;
      orb.rotation.x += 0.002;

      waveNodes.forEach(n => {
        n.angle += n.speed;
        const r = n.radius + Math.sin(t * 3 + n.angle) * 0.3;
        n.mesh.position.set(Math.cos(n.angle) * r, Math.sin(n.angle) * r * 0.4 + 1, Math.sin(n.angle * 2) * r * 0.5);
        (n.mesh.material as THREE.MeshBasicMaterial).opacity = isFlashing ? 0.8 : 0.3 + Math.sin(t + n.angle) * 0.2;
      });

      renderer.render(scene, camera);
    };
    loop();

    return () => {
      stateRef.current.orbMesh = null; stateRef.current.orbLight = null;
      cancelAnimationFrame(bgAnimRef.current);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      bgRendererRef.current = null;
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { correctAnswers: 0, wrongAnswers: 0, avgDecodeTime: 0, longestStreak: 0, streakCurrent: 0, score: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION);
    setTimeout(() => { if (s.running) nextPuzzle(); }, 500);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    return () => { s.running = false; if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [phase, endGame, nextPuzzle]);

  const handleOptionTap = useCallback((optIdx: number) => {
    const s = stateRef.current;
    if (!s.puzzle || s.puzzle.feedback !== null || s.isFlashing) return;
    const ms = Date.now() - s.puzzle.shownAt;
    const isCorrect = s.puzzle.options[optIdx] === s.puzzle.letter;
    s.puzzle.feedback = optIdx;
    setPuzzleDisplay(prev => ({ ...prev, feedback: optIdx }));

    if (isCorrect) {
      s.sig.correctAnswers++; s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.longestStreak) s.sig.longestStreak = s.sig.streakCurrent;
      const speedPts = ms < 3000 ? 3 : ms < 6000 ? 2 : 1;
      s.sig.score += speedPts; setScoreDisplay(s.sig.score);
      sfx.collect(); haptic([20]);
    } else {
      s.sig.wrongAnswers++; s.sig.streakCurrent = 0;
      sfx.collision(); haptic([30]);
    }
    setTimeout(() => { if (s.running) nextPuzzle(); }, 700);
  }, [nextPuzzle]);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg,#08060a 0%,#0d0a12 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Decode! 💡" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={() => setPhase('playing')} accentColor={theme.colors.accent ?? ACCENT} />}

      <div ref={mountRef} style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none' }} />

      {phase === 'playing' && (
        <>
          <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', padding: '0 20px 60px', pointerEvents: 'none', zIndex: 10 }}>
            {/* Morse display */}
            <div style={{ background: 'rgba(250,204,21,0.1)', border: '1px solid rgba(250,204,21,0.3)', borderRadius: 12, padding: '10px 20px', marginBottom: 16, textAlign: 'center' }}>
              <div style={{ color: 'rgba(250,204,21,0.6)', fontSize: 11, marginBottom: 4 }}>MORSE CODE</div>
              <div style={{ color: '#facc15', fontSize: 28, fontFamily: 'monospace', letterSpacing: 4, textShadow: '0 0 10px #facc15' }}>
                {puzzleDisplay.morseDisplay.split('').map((s, i) => (
                  <span key={i} style={{ marginRight: 4 }}>{s === '.' ? '●' : '—'}</span>
                ))}
              </div>
            </div>
            {/* Option buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, width: '100%', maxWidth: 320, pointerEvents: 'auto' }}>
              {puzzleDisplay.options.map((opt, i) => {
                const isSelected = puzzleDisplay.feedback === i;
                const isCorrect = opt === puzzleDisplay.letter;
                let bg = 'rgba(250,204,21,0.1)';
                let border = 'rgba(250,204,21,0.4)';
                if (puzzleDisplay.feedback !== null) {
                  if (isSelected) { bg = isCorrect ? 'rgba(74,222,128,0.3)' : 'rgba(239,68,68,0.3)'; border = isCorrect ? '#4ade80' : '#ef4444'; }
                  else if (isCorrect) { bg = 'rgba(74,222,128,0.15)'; border = '#4ade80'; }
                }
                return (
                  <button key={i} onClick={() => handleOptionTap(i)} disabled={puzzleDisplay.feedback !== null || puzzleDisplay.isFlashing}
                    style={{ background: bg, border: `2px solid ${border}`, borderRadius: 12, padding: '20px', color: '#facc15', fontWeight: 900, fontSize: 28, cursor: 'pointer', boxShadow: `0 0 8px ${border}44` }}>
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Accuracy', value: `${(finalSig.correctAnswers + finalSig.wrongAnswers) > 0 ? Math.round(finalSig.correctAnswers / (finalSig.correctAnswers + finalSig.wrongAnswers) * 100) : 0}%`, color: ACCENT },
            { label: 'Best Streak', value: `×${finalSig.longestStreak}`, color: '#4ade80' },
            { label: 'Correct', value: `${finalSig.correctAnswers}`, color: '#06b6d4' },
            { label: 'Score', value: `${finalSig.score}`, color: 'var(--color-text)' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.correctAnswers >= 8} />
      )}
      {phase === 'done' && finalSig && <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, correctAnswers: sig.correctAnswers }, player);
  }, [theme, sig, personality, player]);
  return null;
}
