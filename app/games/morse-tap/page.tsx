'use client';
/**
 * MORSE TAP — 3D telegraph. Tap dots and dashes to spell the letter.
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

const GAME_ID = 'morse-tap';
const PB_KEY = 'mg_pb_morse-tap';
const ACCENT = '#fbbf24';
const DURATION = 60;
const GAME_EMOJI = '📡';
const GAME_TITLE = 'Morse Tap';
const GAME_TAGLINE = 'Tap dots and dashes to spell the letter in Morse code.';
const PER_LETTER_MS = 5000;

const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
};
const EASY = ['E', 'T', 'I', 'A', 'N', 'M', 'S'];
const MEDIUM = ['D', 'K', 'G', 'W', 'H', 'B', 'C', 'F'];
const HARD = ['Q', 'X', 'Y', 'Z', 'J', 'V'];

interface Signals { score: number; lettersCompleted: number; wrongSubmits: number; avgMs: number; maxStreak: number; streakCurrent: number; }

function getPersonality(sig: Signals): string {
  if (sig.lettersCompleted >= 12 && sig.wrongSubmits <= 2) return 'Morse Maestro 📡';
  if (sig.maxStreak >= 5) return 'Signal Pro ⚡';
  if (sig.lettersCompleted >= 8) return 'Code Sender 🔑';
  if (sig.lettersCompleted >= 4) return 'Learning Morse 📻';
  return 'Static Noise 🔊';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

export default function MorseTapGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const bgAnimRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const letterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { score: 0, lettersCompleted: 0, wrongSubmits: 0, avgMs: 0, maxStreak: 0, streakCurrent: 0 } as Signals,
    currentLetter: '',
    targetMorse: '',
    enteredMorse: '',
    letterStartMs: 0,
    totalMs: 0,
    level: 0,
    orbMesh: null as THREE.Mesh | null,
    orbLight: null as THREE.PointLight | null,
    pulseNodes: [] as { mesh: THREE.Mesh; angle: number; phase: number }[],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [letterDisplay, setLetterDisplay] = useState('');
  const [enteredDisplay, setEnteredDisplay] = useState('');
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const nextLetter = useCallback(() => {
    const s = stateRef.current;
    const pool = s.sig.lettersCompleted < 5 ? EASY : s.sig.lettersCompleted < 10 ? [...EASY, ...MEDIUM] : Object.keys(MORSE);
    const letter = pool[Math.floor(Math.random() * pool.length)];
    s.currentLetter = letter;
    s.targetMorse = MORSE[letter];
    s.enteredMorse = '';
    s.letterStartMs = Date.now();
    setLetterDisplay(letter);
    setEnteredDisplay('');
    setFeedback(null);
    if (letterTimerRef.current) clearTimeout(letterTimerRef.current);
    letterTimerRef.current = setTimeout(() => {
      if (s.running) {
        s.sig.wrongSubmits++;
        setFeedback('wrong');
        sfx.fail(); haptic([40]);
        s.sig.streakCurrent = 0;
        setTimeout(() => { if (s.running) nextLetter(); }, 500);
      }
    }, PER_LETTER_MS);
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    if (letterTimerRef.current) clearTimeout(letterTimerRef.current);
    cancelAnimationFrame(bgAnimRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  // 3D background: telegraph machine atmosphere
  useEffect(() => {
    if (phase !== 'playing') return;
    if (!mountRef.current) return;
    const mount = mountRef.current;

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setClearColor(0x0a0800, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 200);
    camera.position.set(0, 0, 10);

    scene.add(new THREE.AmbientLight(0x2a2000, 5));
    const warmLight = new THREE.PointLight(0xfbbf24, 2, 20);
    warmLight.position.set(0, 4, 5);
    scene.add(warmLight);

    // Telegraph orb
    const orbGeo = new THREE.SphereGeometry(0.8, 20, 20);
    const orbMat = new THREE.MeshPhongMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 0.3, shininess: 100 });
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.y = 1.5;
    scene.add(orb);
    stateRef.current.orbMesh = orb;

    const orbLight = new THREE.PointLight(0xfbbf24, 1, 6);
    orbLight.position.set(0, 1.5, 2);
    scene.add(orbLight);
    stateRef.current.orbLight = orbLight;

    // Telegraph machine body
    const bodyGeo = new THREE.BoxGeometry(2.5, 0.8, 1.5);
    const bodyMat = new THREE.MeshPhongMaterial({ color: 0x3d2b1f, emissive: 0x1a1008 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = -2;
    scene.add(body);

    // Signal wave nodes orbiting
    const pulseNodes: { mesh: THREE.Mesh; angle: number; phase: number }[] = [];
    for (let i = 0; i < 16; i++) {
      const geo = new THREE.SphereGeometry(0.06, 6, 6);
      const mat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.4 });
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      pulseNodes.push({ mesh, angle: (i / 16) * Math.PI * 2, phase: Math.random() * Math.PI * 2 });
    }
    stateRef.current.pulseNodes = pulseNodes;

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

      const s = stateRef.current;
      const hasInput = s.enteredMorse.length > 0;
      orbMat.emissiveIntensity = hasInput ? 1.5 + Math.sin(t * 15) * 0.5 : 0.2 + Math.sin(t * 2) * 0.1;
      warmLight.intensity = hasInput ? 4 : 1.5 + Math.sin(t * 1.5) * 0.3;
      orb.rotation.y += 0.01;

      pulseNodes.forEach((n, i) => {
        n.angle += 0.015;
        const r = 2 + Math.sin(t * 3 + n.phase) * 0.4;
        n.mesh.position.set(Math.cos(n.angle) * r, Math.sin(n.angle * 0.5) * r * 0.3 + 1.5, Math.sin(n.angle) * r * 0.6);
        (n.mesh.material as THREE.MeshBasicMaterial).opacity = hasInput ? 0.7 : 0.2 + Math.sin(t * 2 + n.phase) * 0.15;
      });

      renderer.render(scene, camera);
    };
    loop();

    return () => {
      stateRef.current.orbMesh = null; stateRef.current.orbLight = null; stateRef.current.pulseNodes = [];
      cancelAnimationFrame(bgAnimRef.current);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, lettersCompleted: 0, wrongSubmits: 0, avgMs: 0, maxStreak: 0, streakCurrent: 0 };
    s.level = 0; setScoreDisplay(0); setTimeLeft(DURATION);
    setTimeout(() => { if (s.running) nextLetter(); }, 400);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) endGame();
    }, 1000);
    return () => { s.running = false; if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [phase, endGame, nextLetter]);

  const handleTap = useCallback((sym: '.' | '-') => {
    const s = stateRef.current;
    if (!s.running) return;
    s.enteredMorse += sym;
    setEnteredDisplay(s.enteredMorse);
    sfx.click(); haptic([15]);

    if (s.orbMesh) {
      (s.orbMesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 2;
      setTimeout(() => { if (s.orbMesh) (s.orbMesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 0.3; }, 150);
    }
  }, []);

  const handleSubmit = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    if (letterTimerRef.current) clearTimeout(letterTimerRef.current);

    const correct = s.enteredMorse === s.targetMorse;
    const ms = Date.now() - s.letterStartMs;
    s.totalMs += ms;

    if (correct) {
      s.sig.lettersCompleted++; s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const speedPts = ms < 3000 ? 3 : 2;
      s.sig.score += speedPts; setScoreDisplay(s.sig.score);
      s.sig.avgMs = Math.round(s.totalMs / s.sig.lettersCompleted);
      sfx.success(); haptic([30, 20, 50]);
      setFeedback('correct');
    } else {
      s.sig.wrongSubmits++; s.sig.streakCurrent = 0;
      sfx.fail(); haptic([40]);
      setFeedback('wrong');
    }
    setTimeout(() => { if (s.running) nextLetter(); }, 500);
  }, [nextLetter]);

  const handleClear = useCallback(() => {
    stateRef.current.enteredMorse = '';
    setEnteredDisplay('');
    sfx.click();
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const enteredSymbols = enteredDisplay.split('').map((s, i) => (
    <span key={i} style={{ fontSize: 28, margin: '0 4px', color: '#fbbf24' }}>{s === '.' ? '●' : '—'}</span>
  ));

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg,#0a0800 0%,#0f0c00 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start Tapping 📡" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={() => setPhase('playing')} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none' }} />

      {phase === 'playing' && (
        <>
          <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', padding: '0 20px 40px', pointerEvents: 'none', zIndex: 10 }}>
            {/* Letter display */}
            <div style={{ marginBottom: 8, textAlign: 'center' }}>
              <div style={{ color: 'rgba(251,191,36,0.6)', fontSize: 13, marginBottom: 4 }}>SEND THIS LETTER</div>
              <div style={{ color: '#fbbf24', fontSize: 72, fontWeight: 900, textShadow: '0 0 20px #fbbf24', lineHeight: 1 }}>{letterDisplay}</div>
              <div style={{ color: 'rgba(251,191,36,0.5)', fontSize: 16, fontFamily: 'monospace', marginTop: 4 }}>{(MORSE[letterDisplay] || '').split('').map(s => s === '.' ? '·' : '—').join(' ')}</div>
            </div>
            {/* Entered morse */}
            <div style={{ background: 'rgba(251,191,36,0.08)', border: `1px solid rgba(251,191,36,0.3)`, borderRadius: 12, padding: '10px 20px', marginBottom: 16, minHeight: 60, minWidth: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: feedback === 'correct' ? '#4ade80' : feedback === 'wrong' ? '#ef4444' : '#fbbf24' }}>
              {enteredSymbols.length > 0 ? enteredSymbols : <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>tap below…</span>}
            </div>
            {/* Buttons */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 12, pointerEvents: 'auto' }}>
              <button onClick={() => handleTap('.')} style={{ background: 'rgba(251,191,36,0.15)', border: '2px solid rgba(251,191,36,0.5)', borderRadius: 16, padding: '18px 28px', color: '#fbbf24', fontSize: 28, fontWeight: 900, cursor: 'pointer' }}>●</button>
              <button onClick={() => handleTap('-')} style={{ background: 'rgba(251,191,36,0.15)', border: '2px solid rgba(251,191,36,0.5)', borderRadius: 16, padding: '18px 40px', color: '#fbbf24', fontSize: 28, fontWeight: 900, cursor: 'pointer' }}>—</button>
            </div>
            <div style={{ display: 'flex', gap: 10, pointerEvents: 'auto' }}>
              <button onClick={handleClear} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '10px 20px', color: '#ef4444', fontSize: 14, cursor: 'pointer' }}>⌫ Clear</button>
              <button onClick={handleSubmit} style={{ background: 'rgba(74,222,128,0.15)', border: '2px solid rgba(74,222,128,0.5)', borderRadius: 10, padding: '10px 24px', color: '#4ade80', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>✓ Send</button>
            </div>
          </div>
        </>
      )}

      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Letters Sent', value: `${finalSig.lettersCompleted}`, color: ACCENT },
            { label: 'Wrong Submits', value: `${finalSig.wrongSubmits}`, color: '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' },
            { label: 'Avg Time', value: `${finalSig.avgMs}ms`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.lettersCompleted >= 8} />
      )}
      {phase === 'done' && finalSig && <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, lettersCompleted: sig.lettersCompleted }, player);
  }, [theme, sig, personality, player]);
  return null;
}
