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

const GAME_ID = 'type-speed';
const PB_KEY = 'mg_pb_type-speed';
const ACCENT = '#34d399';
const DURATION = 45;
const GAME_EMOJI = '⌨️';
const GAME_TITLE = 'Type Speed';
const GAME_TAGLINE = 'Tap the letters in order as fast as you can.';

const WORDS = [
  'BLAZE', 'SHARP', 'QUICK', 'FROST', 'STORM', 'FLASH', 'DRIVE', 'SPARK', 'LIGHT', 'POWER',
  'BRAVE', 'CRAFT', 'BOUND', 'CLIMB', 'DREAM', 'ELITE', 'FOCUS', 'GRASP', 'HASTE', 'IGNITE',
  'JUMP', 'KEEN', 'LEAN', 'MOVE', 'NEXT', 'OPEN', 'PUSH', 'RUSH', 'SWIFT', 'THINK',
];
const KEY_ROWS = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['Z','X','C','V','B','N','M','⌫'],
];

interface Signals { score: number; wordsCompleted: number; totalLetters: number; wrongTaps: number; avgWordMs: number; }
function getPersonality(sig: Signals): string {
  const total = sig.totalLetters + sig.wrongTaps;
  const acc = total > 0 ? sig.totalLetters / total : 0;
  if (sig.wordsCompleted >= 10 && acc >= 0.90) return 'Speed Typist ⌨️';
  if (sig.wordsCompleted >= 7 && acc >= 0.80) return 'Fast Fingers 🤙';
  if (sig.wordsCompleted >= 5) return 'Rapid Tapper ⚡';
  return 'Finding the Rhythm 🌊';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function pickWord(prev: string): string {
  const pool = WORDS.filter(w => w !== prev);
  return pool[Math.floor(Math.random() * pool.length)];
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function TypeSpeedGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const bgAnimRef = useRef(0);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const sigRef = useRef<Signals>({ score: 0, wordsCompleted: 0, totalLetters: 0, wrongTaps: 0, avgWordMs: 0 });
  const wordTimesRef = useRef<number[]>([]);
  const wordStartRef = useRef(0);
  const letterIdxRef = useRef(0);
  const streakRef = useRef(0);

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [currentWord, setCurrentWord] = useState('');
  const [letterIdx, setLetterIdx] = useState(0);
  const [keyFlash, setKeyFlash] = useState<{ key: string; type: 'hit' | 'miss' } | null>(null);
  const [wordFlash, setWordFlash] = useState<'correct' | null>(null);
  const [streak, setStreak] = useState(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bgOrbs = useRef<{ mesh: THREE.Mesh; vx: number; vy: number }[]>([]);

  const nextWord = useCallback((prev = '') => {
    const w = pickWord(prev);
    setCurrentWord(w); setLetterIdx(0); letterIdxRef.current = 0;
    wordStartRef.current = Date.now();
  }, []);

  const endGame = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.success(); haptic([100]);
    const avg = wordTimesRef.current.length > 0 ? Math.round(wordTimesRef.current.reduce((a, b) => a + b, 0) / wordTimesRef.current.length) : 0;
    sigRef.current.avgWordMs = avg;
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0', 10);
      if (sigRef.current.score > pb) { localStorage.setItem(PB_KEY, String(sigRef.current.score)); setIsNewBest(true); }
    } catch { }
    setFinalSig({ ...sigRef.current }); setPhase('done');
  }, []);

  const startGame = useCallback(() => {
    sigRef.current = { score: 0, wordsCompleted: 0, totalLetters: 0, wrongTaps: 0, avgWordMs: 0 };
    streakRef.current = 0; wordTimesRef.current = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setStreak(0); setPhase('playing');
    stopMusicRef.current = startMusic('minimal');
    nextWord('');
    let t = DURATION;
    timerRef.current = setInterval(() => {
      t--; setTimeLeft(t);
      if (t === 10) sfx.warning();
      if (t > 0 && t < 10) sfx.tick();
      if (t <= 0) endGame();
    }, 1000);
  }, [endGame, nextWord]);

  const handleKey = useCallback((key: string) => {
    if (flashTimer.current) { clearTimeout(flashTimer.current); flashTimer.current = null; }
    if (key === '⌫') {
      if (letterIdxRef.current > 0) { letterIdxRef.current--; setLetterIdx(letterIdxRef.current); setKeyFlash({ key, type: 'hit' }); flashTimer.current = setTimeout(() => setKeyFlash(null), 150); }
      return;
    }
    const word = currentWord; const idx = letterIdxRef.current;
    if (idx >= word.length) return;
    const expected = word[idx];
    if (key === expected) {
      letterIdxRef.current++; setLetterIdx(letterIdxRef.current);
      setKeyFlash({ key, type: 'hit' }); sigRef.current.totalLetters++;
      sfx.click(); haptic([30]);
      if (letterIdxRef.current >= word.length) {
        const wordMs = Date.now() - wordStartRef.current;
        wordTimesRef.current.push(wordMs); sigRef.current.wordsCompleted++;
        streakRef.current++;
        const speedBonus = wordMs < 2500 ? 15 : wordMs < 4000 ? 8 : 0;
        const pts = word.length * 4 + speedBonus + (streakRef.current >= 3 ? 10 : 0);
        sigRef.current.score += pts; setScoreDisplay(sigRef.current.score);
        setStreak(streakRef.current); setWordFlash('correct');
        sfx.collect(); haptic([30, 50, 30]);
        // Flash background orbs
        bgOrbs.current.forEach(o => {
          (o.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8;
          setTimeout(() => { if (o.mesh.material) (o.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2; }, 300);
        });
        setTimeout(() => { setWordFlash(null); nextWord(word); }, 300);
      }
    } else {
      setKeyFlash({ key, type: 'miss' }); sigRef.current.wrongTaps++;
      streakRef.current = 0; setStreak(0);
      sigRef.current.score = Math.max(0, sigRef.current.score - 2);
      setScoreDisplay(sigRef.current.score);
      sfx.nearMiss(); haptic([20, 30, 20]);
    }
    flashTimer.current = setTimeout(() => setKeyFlash(null), 150);
  }, [currentWord, nextWord]);

  // 3D background setup (runs once, lives behind UI)
  useEffect(() => {
    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x030d09, 1);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.inset = '0';
    renderer.domElement.style.zIndex = '0';
    renderer.domElement.style.pointerEvents = 'none';
    rendererRef.current = renderer;
    if (mountRef.current) mountRef.current.appendChild(renderer.domElement);

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
    // === POLISH: Enhanced rim + fill lighting ===
    const rimLightA = new THREE.PointLight(0x4466ff, 1.2, 20);
    rimLightA.position.set(-6, 5, 3);
    scene.add(rimLightA);
    const fillLightB = new THREE.PointLight(0xff6644, 0.8, 15);
    fillLightB.position.set(6, -3, 5);
    scene.add(fillLightB);
    // === END POLISH ===
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x051a0f, 2));
    const pLight = new THREE.PointLight(0x34d399, 3, 25);
    pLight.position.set(0, 3, 5);
    scene.add(pLight);

    // Stars
    const starPos = new Float32Array(400 * 3);
    for (let i = 0; i < 400; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 50; starPos[i * 3 + 1] = (Math.random() - 0.5) * 50; starPos[i * 3 + 2] = -15 + (Math.random() - 0.5) * 5;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06 })));

    // Floating letter-orbs
    const orbColors = [0x34d399, 0x10b981, 0x059669, 0x6ee7b7, 0x4ade80];
    const orbs: { mesh: THREE.Mesh; vx: number; vy: number }[] = [];
    for (let i = 0; i < 20; i++) {
      const r = 0.12 + Math.random() * 0.22;
      const geo = new THREE.IcosahedronGeometry(r, 1);
      const mat = new THREE.MeshStandardMaterial({ color: orbColors[i % 5], emissive: orbColors[i % 5], emissiveIntensity: 0.2, transparent: true, opacity: 0.35 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 8 - 3);
      scene.add(mesh);
      orbs.push({ mesh, vx: (Math.random() - 0.5) * 0.005, vy: (Math.random() - 0.5) * 0.005 });
    }
    bgOrbs.current = orbs;

    // Pulsing rings
    const rings: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const rGeo = new THREE.TorusGeometry(2 + i, 0.04, 8, 32);
      const rMat = new THREE.MeshStandardMaterial({ color: 0x34d399, emissive: 0x34d399, emissiveIntensity: 0.3, transparent: true, opacity: 0.15 });
      const r = new THREE.Mesh(rGeo, rMat);
      r.rotation.x = Math.PI / 4 + i * 0.5;
      scene.add(r); rings.push(r);
    }

    let frame = 0;
    const bgLoop = () => {
      frame++;
      orbs.forEach(o => {
        o.mesh.position.x += o.vx; o.mesh.position.y += o.vy;
        if (Math.abs(o.mesh.position.x) > 7) o.vx *= -1;
        if (Math.abs(o.mesh.position.y) > 5) o.vy *= -1;
        o.mesh.rotation.x += 0.01; o.mesh.rotation.y += 0.015;
      });
      rings.forEach((r, i) => {
        r.rotation.z += 0.004 + i * 0.002;
        r.rotation.x += 0.002;
        (r.material as THREE.MeshStandardMaterial).opacity = 0.1 + Math.sin(frame * 0.04 + i * 1.2) * 0.07;
      });
      pLight.intensity = 3 + Math.sin(frame * 0.05) * 0.7;
      renderer.render(scene, camera);
      bgAnimRef.current = requestAnimationFrame(bgLoop);
    };
    bgAnimRef.current = requestAnimationFrame(bgLoop);

    return () => {
      cancelAnimationFrame(bgAnimRef.current);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false);
    setCurrentWord(''); setLetterIdx(0); setStreak(0); setWordFlash(null); setKeyFlash(null);
    setPhase('countdown');
  }, []);

  const buildInsights = useCallback((sig: Signals) => {
    const total = sig.totalLetters + sig.wrongTaps;
    const acc = total > 0 ? Math.round(sig.totalLetters / total * 100) : 0;
    const ac = theme.colors.accent ?? ACCENT;
    return [
      { label: 'Words Done', value: String(sig.wordsCompleted), color: sig.wordsCompleted >= 8 ? '#4ade80' : ac },
      { label: 'Accuracy', value: `${acc}%`, color: acc >= 90 ? '#4ade80' : acc >= 75 ? '#facc15' : '#ef4444' },
      { label: 'Letters Typed', value: String(sig.totalLetters), color: ac },
      { label: 'Avg Word', value: sig.avgWordMs > 0 ? `${(sig.avgWordMs / 1000).toFixed(1)}s` : '—', color: ac },
    ];
  }, [theme]);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 0%, rgba(52,211,153,0.12) 0%, transparent 55%), linear-gradient(180deg, #030d09 0%, #010503 100%)">
      {/* 3D background canvas */}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }} />

      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={accent} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startGame} accentColor={accent} />}

      {phase === 'playing' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 10 }}>
          <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10, testId: 'timer' }, { label: 'SCORE', value: scoreDisplay, testId: 'score' }]} />

          {/* Word display */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '0 16px' }}>
            {streak >= 3 && (
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fbbf24', textShadow: '0 0 10px #fbbf2488', letterSpacing: '0.05em' }}>×{streak} STREAK!</div>
            )}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
              {currentWord.split('').map((letter, i) => (
                <div key={i} style={{
                  width: 38, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 8, border: '2px solid',
                  borderColor: i < letterIdx ? '#4ade80' : i === letterIdx ? accent : 'rgba(255,255,255,0.15)',
                  background: i < letterIdx ? 'rgba(74,222,128,0.15)' : i === letterIdx ? `${accent}22` : 'rgba(255,255,255,0.04)',
                  fontSize: 22, fontWeight: 800,
                  color: i < letterIdx ? '#4ade80' : i === letterIdx ? accent : 'rgba(255,255,255,0.3)',
                  transition: 'all 120ms',
                  transform: i === letterIdx && wordFlash !== 'correct' ? 'scale(1.1)' : 'scale(1)',
                  boxShadow: i === letterIdx ? `0 0 12px ${accent}66` : 'none',
                }}>{letter}</div>
              ))}
            </div>
            {wordFlash === 'correct' && (
              <div style={{ fontSize: 18, fontWeight: 800, color: '#4ade80', textShadow: '0 0 16px #4ade8088' }}>✓ NICE!</div>
            )}
          </div>

          {/* QWERTY keyboard */}
          <div style={{ width: '100%', maxWidth: 460, padding: '0 6px 16px', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {KEY_ROWS.map((row, ri) => (
              <div key={ri} style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>
                {row.map(key => {
                  const isFlash = keyFlash?.key === key;
                  const isNext = currentWord[letterIdx] === key;
                  const isBackspace = key === '⌫';
                  return (
                    <button key={key} onClick={() => handleKey(key)} aria-label={key === '⌫' ? 'backspace' : key}
                      style={{ width: isBackspace ? 50 : 32, height: 44, borderRadius: 7, cursor: 'pointer', fontSize: isBackspace ? 16 : 14, fontWeight: 700,
                        background: isFlash ? (keyFlash?.type === 'hit' ? accent : '#ef4444') : isNext ? `${accent}22` : 'rgba(255,255,255,0.09)',
                        color: isFlash ? '#fff' : isNext ? accent : 'rgba(255,255,255,0.75)',
                        boxShadow: isNext ? `0 0 8px ${accent}55` : 'none',
                        border: `1px solid ${isNext ? accent : 'rgba(255,255,255,0.1)'}`,
                        transition: 'background 100ms, transform 80ms', transform: isFlash ? 'scale(0.92)' : 'scale(1)',
                        WebkitTapHighlightColor: 'transparent',
                      } as React.CSSProperties}>{key}</button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {isNewBest && phase === 'done' && (
        <div style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)', zIndex: 90, background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', borderRadius: 20, padding: '8px 20px', fontSize: 20, fontWeight: 900, color: '#000', whiteSpace: 'nowrap' }}>🏆 New Best!</div>
      )}

      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.wordsCompleted >= 5} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}
