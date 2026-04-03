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

const GAME_ID = 'speed-sort';
const ACCENT = '#facc15';
const DURATION = 30;
const GAME_EMOJI = '⚡';
const GAME_TITLE = 'Speed Sort';
const GAME_TAGLINE = 'Left or right. Think fast.';

type Category = { name: string; colorHex: number; icon: string };
type Item = { name: string; category: 0 | 1; emoji: string };

const ROUND_SETS: Array<{ left: Category; right: Category; items: Item[] }> = [
  {
    left: { name: 'FRUIT', colorHex: 0x4ade80, icon: '🍎' },
    right: { name: 'VEG', colorHex: 0xf97316, icon: '🥦' },
    items: [
      { name: 'Apple', emoji: '🍎', category: 0 }, { name: 'Broccoli', emoji: '🥦', category: 1 },
      { name: 'Banana', emoji: '🍌', category: 0 }, { name: 'Carrot', emoji: '🥕', category: 1 },
      { name: 'Grape', emoji: '🍇', category: 0 }, { name: 'Onion', emoji: '🧅', category: 1 },
      { name: 'Mango', emoji: '🥭', category: 0 }, { name: 'Spinach', emoji: '🥬', category: 1 },
    ],
  },
  {
    left: { name: 'HOT', colorHex: 0xef4444, icon: '🔥' },
    right: { name: 'COLD', colorHex: 0x06b6d4, icon: '❄️' },
    items: [
      { name: 'Coffee', emoji: '☕', category: 0 }, { name: 'Ice Cream', emoji: '🍦', category: 1 },
      { name: 'Soup', emoji: '🍲', category: 0 }, { name: 'Soda', emoji: '🥤', category: 1 },
      { name: 'Tea', emoji: '🍵', category: 0 }, { name: 'Snow', emoji: '❄️', category: 1 },
      { name: 'Fire', emoji: '🔥', category: 0 }, { name: 'Penguin', emoji: '🐧', category: 1 },
    ],
  },
  {
    left: { name: 'LAND', colorHex: 0x22c55e, icon: '🦁' },
    right: { name: 'SEA', colorHex: 0x3b82f6, icon: '🐟' },
    items: [
      { name: 'Elephant', emoji: '🐘', category: 0 }, { name: 'Dolphin', emoji: '🐬', category: 1 },
      { name: 'Tiger', emoji: '🐯', category: 0 }, { name: 'Shark', emoji: '🦈', category: 1 },
      { name: 'Rabbit', emoji: '🐰', category: 0 }, { name: 'Octopus', emoji: '🐙', category: 1 },
      { name: 'Horse', emoji: '🐴', category: 0 }, { name: 'Crab', emoji: '🦀', category: 1 },
    ],
  },
];

interface Signals { correct: number; wrong: number; score: number; maxStreak: number; streakCurrent: number; avgReactionMs: number; totalReactionMs: number; totalDecisions: number; }
function getPersonality(sig: Signals): string {
  const acc = (sig.correct + sig.wrong) > 0 ? sig.correct / (sig.correct + sig.wrong) : 0;
  const avg = sig.totalDecisions > 0 ? sig.totalReactionMs / sig.totalDecisions : 9999;
  if (acc >= 0.9 && avg < 500) return 'Lightning Sorter ⚡';
  if (acc >= 0.85) return 'Sharp Classifier 🎯';
  if (sig.maxStreak >= 6) return 'Streak Machine 🔥';
  if (acc >= 0.7) return 'Quick Thinker 💡';
  return 'Still Learning ⚡';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

export default function SpeedSortGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    cardMesh: null as THREE.Mesh | null,
    cardLight: null as THREE.PointLight | null,
    leftBin: null as THREE.Mesh | null,
    rightBin: null as THREE.Mesh | null,
    flyingCard: null as { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number } | null,
    running: false, timeLeft: DURATION,
    sig: { correct: 0, wrong: 0, score: 0, maxStreak: 0, streakCurrent: 0, avgReactionMs: 0, totalReactionMs: 0, totalDecisions: 0 } as Signals,
    currentSetIdx: 0,
    currentItemIdx: 0,
    currentItem: null as Item | null,
    itemStartMs: 0,
    pointerStart: null as { x: number; y: number; time: number } | null,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [currentEmoji, setCurrentEmoji] = useState('');
  const [currentName, setCurrentName] = useState('');
  const [leftLabel, setLeftLabel] = useState('');
  const [rightLabel, setRightLabel] = useState('');
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const loadNextItem = useCallback(() => {
    const s = stateRef.current;
    const set = ROUND_SETS[s.currentSetIdx];
    if (s.currentItemIdx >= set.items.length) {
      s.currentSetIdx = (s.currentSetIdx + 1) % ROUND_SETS.length;
      s.currentItemIdx = 0;
    }
    const item = set.items[s.currentItemIdx];
    s.currentItem = item; s.currentItemIdx++;
    s.itemStartMs = Date.now();
    setCurrentEmoji(item.emoji); setCurrentName(item.name);
    setLeftLabel(set.left.name); setRightLabel(set.right.name);
    // Update card color
    if (s.cardMesh) {
      const mat = s.cardMesh.material as THREE.MeshStandardMaterial;
      mat.color.setHex(0x1a1a2e); mat.emissive.setHex(0x000000);
    }
  }, []);

  const handleSort = useCallback((direction: 0 | 1) => {
    const s = stateRef.current;
    if (!s.running || !s.currentItem) return;
    const reactionMs = Date.now() - s.itemStartMs;
    s.sig.totalReactionMs += reactionMs; s.sig.totalDecisions++;
    const isCorrect = direction === s.currentItem.category;
    if (isCorrect) {
      s.sig.correct++; s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const speedBonus = Math.max(0, Math.floor((800 - reactionMs) / 200));
      const streakBonus = Math.floor(s.sig.streakCurrent / 3);
      const pts = 1 + speedBonus + streakBonus;
      s.sig.score += pts; setScoreDisplay(s.sig.score);
      sfx.collect(); hapticScore();
      setFeedback('correct');
      const set = ROUND_SETS[s.currentSetIdx];
      if (s.cardMesh) (s.cardMesh.material as THREE.MeshStandardMaterial).emissive.setHex(direction === 0 ? set.left.colorHex : set.right.colorHex);
    } else {
      s.sig.wrong++; s.sig.streakCurrent = 0;
      sfx.collision(); hapticFail();
      setFeedback('wrong');
      if (s.cardMesh) (s.cardMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0xef4444);
    }
    setTimeout(() => { setFeedback(null); loadNextItem(); }, 300);
  }, [loadNextItem]);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { correct: 0, wrong: 0, score: 0, maxStreak: 0, streakCurrent: 0, avgReactionMs: 0, totalReactionMs: 0, totalDecisions: 0 };
    s.currentSetIdx = 0; s.currentItemIdx = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a1a);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 5);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x0a0a1a, 3));
    const mainLight = new THREE.PointLight(0xfacc15, 2, 20);
    mainLight.position.set(0, 5, 3);
    scene.add(mainLight);
    const cardLight = new THREE.PointLight(0xfacc15, 3, 6);
    scene.add(cardLight);
    s.cardLight = cardLight;

    // Stars
    const sp = new Float32Array(300*3);
    for (let i=0;i<300;i++){sp[i*3]=(Math.random()-.5)*50;sp[i*3+1]=(Math.random()-.5)*50;sp[i*3+2]=(Math.random()-.5)*50;}
    const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(sp,3));
    scene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0xffffff,size:0.05})));

    // Left bin
    const leftBinGeo = new THREE.BoxGeometry(1.5, 2, 0.2);
    const set0 = ROUND_SETS[0];
    const leftBin = new THREE.Mesh(leftBinGeo, new THREE.MeshStandardMaterial({ color: set0.left.colorHex, transparent: true, opacity: 0.3, emissive: set0.left.colorHex, emissiveIntensity: 0.3 }));
    leftBin.position.set(-3, 0, -1);
    scene.add(leftBin);
    s.leftBin = leftBin;
    // Right bin
    const rightBin = new THREE.Mesh(leftBinGeo.clone(), new THREE.MeshStandardMaterial({ color: set0.right.colorHex, transparent: true, opacity: 0.3, emissive: set0.right.colorHex, emissiveIntensity: 0.3 }));
    rightBin.position.set(3, 0, -1);
    scene.add(rightBin);
    s.rightBin = rightBin;

    // Center card
    const cardGeo = new THREE.BoxGeometry(2, 2.5, 0.15);
    const cardMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, emissive: 0x000000, emissiveIntensity: 0, roughness: 0.3, metalness: 0.5 });
    const cardMesh = new THREE.Mesh(cardGeo, cardMat);
    scene.add(cardMesh);
    s.cardMesh = cardMesh;
    cardLight.position.set(0, 0, 0.5);

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    (s as any)._cleanup = () => window.removeEventListener('resize', handleResize);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    loadNextItem();

    const loop = () => {
      if (!s.running) return;
      const t = Date.now() * 0.001;
      // Card breathe
      cardMesh.rotation.y = Math.sin(t * 0.8) * 0.05;
      cardMesh.rotation.x = Math.sin(t * 0.5) * 0.02;
      cardMesh.position.y = Math.sin(t * 1.5) * 0.05;
      cardLight.intensity = 2 + Math.sin(t * 3) * 0.5;
      // Bins glow
      (leftBin.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + Math.sin(t * 2) * 0.1;
      (rightBin.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + Math.sin(t * 2 + 1) * 0.1;
      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    // Swipe detection
    const onDown = (e: PointerEvent) => { stateRef.current.pointerStart = { x: e.clientX, y: e.clientY, time: Date.now() }; };
    const onUp = (e: PointerEvent) => {
      const s2 = stateRef.current;
      if (!s2.pointerStart || !s2.running) { s2.pointerStart = null; return; }
      const dx = e.clientX - s2.pointerStart.x;
      const dy = e.clientY - s2.pointerStart.y;
      const dt = Date.now() - s2.pointerStart.time;
      s2.pointerStart = null;
      if (Math.abs(dx) > 30 && Math.abs(dx) / Math.max(1, Math.abs(dy)) > 1 && dt < 800) {
        handleSort(dx < 0 ? 0 : 1);
      }
    };
    if (mountRef.current) {
      mountRef.current.addEventListener('pointerdown', onDown);
      mountRef.current.addEventListener('pointerup', onUp);
    }
    (s as any)._inputCleanup = () => {
      mountRef.current?.removeEventListener('pointerdown', onDown);
      mountRef.current?.removeEventListener('pointerup', onUp);
    };
  }, [endGame, loadNextItem, handleSort]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    const s = stateRef.current;
    if (s.renderer) s.renderer.dispose();
    (s as any)._cleanup?.(); (s as any)._inputCleanup?.();
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #0a0a1a 0%, #050510 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Swipe LEFT or RIGHT to sort items into categories — fast!"
          ctaLabel="Sort It! ⚡" sensorNote="Swipe left = left category. Swipe right = right category."
          accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <>
          <GameHUD accentColor={accent} items={[
            { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
            { label: 'SCORE', value: scoreDisplay },
          ]} />
          {/* Overlay item display */}
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 50, pointerEvents: 'none', textAlign: 'center' }}>
            <div style={{ fontSize: 64, lineHeight: 1 }}>{currentEmoji}</div>
            <div style={{ color: 'white', fontWeight: 700, fontSize: 18, marginTop: 6 }}>{currentName}</div>
          </div>
          {/* Category labels */}
          <div style={{ position: 'fixed', bottom: '15%', left: '8%', zIndex: 50, pointerEvents: 'none', color: accent, fontWeight: 900, fontSize: 14, letterSpacing: 2 }}>← {leftLabel}</div>
          <div style={{ position: 'fixed', bottom: '15%', right: '8%', zIndex: 50, pointerEvents: 'none', color: accent, fontWeight: 900, fontSize: 14, letterSpacing: 2 }}>{rightLabel} →</div>
          {feedback && (
            <div style={{ position: 'fixed', top: '35%', left: '50%', transform: 'translateX(-50%)', zIndex: 80, pointerEvents: 'none', fontSize: 40, textShadow: '0 0 20px currentColor', color: feedback === 'correct' ? '#4ade80' : '#ef4444' }}>
              {feedback === 'correct' ? '✓' : '✗'}
            </div>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Correct', value: String(finalSig.correct), color: '#4ade80' },
            { label: 'Wrong', value: String(finalSig.wrong), color: '#ef4444' },
            { label: 'Avg Speed', value: finalSig.totalDecisions > 0 ? `${Math.round(finalSig.totalReactionMs / finalSig.totalDecisions)}ms` : '—', color: accent },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.correct >= 20} />
      )}
    </GameShell>
  );
}
