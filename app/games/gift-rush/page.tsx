'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { Gift, Trophy, Gem, Cookie, Trash2, Star, Snowflake } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const GAME_ID      = 'gift-rush';
const ACCENT       = '#ef4444';
const DURATION     = 45;
const GAME_EMOJI   = '🎁';
const GAME_TITLE   = 'Gift Rush';
const GAME_TAGLINE = "Swipe right for gifts, left for coal. Fast. Santa's watching.";
const SWIPE_THRESHOLD = 60;

type ItemIconType = 'gift' | 'trophy' | 'gem' | 'cookie' | 'trash' | 'star';
interface GameItem { id: string; iconType: ItemIconType; iconColor: string; correct: 'right' | 'left'; points: number; label: string; rare: boolean; }

const ITEMS: GameItem[] = [
  { id: 'gift_red',  iconType: 'gift',   iconColor: '#ef4444', correct: 'right', points: 1, label: 'Gift',        rare: false },
  { id: 'gift_gold', iconType: 'trophy', iconColor: '#facc15', correct: 'right', points: 2, label: 'Golden Gift', rare: true  },
  { id: 'coal',      iconType: 'gem',    iconColor: '#6b7280', correct: 'left',  points: 1, label: 'Coal',        rare: false },
  { id: 'cookie',    iconType: 'cookie', iconColor: '#d97706', correct: 'right', points: 1, label: 'Cookie',      rare: false },
  { id: 'rotten',    iconType: 'trash',  iconColor: '#65a30d', correct: 'left',  points: 1, label: 'Rotten',      rare: false },
  { id: 'star',      iconType: 'star',   iconColor: '#facc15', correct: 'right', points: 3, label: 'Star',        rare: true  },
];

function ItemIcon({ type, color, size = 68 }: { type: ItemIconType; color: string; size?: number }) {
  const p = { size, color, strokeWidth: 1.8 };
  switch (type) {
    case 'gift':   return <Gift   {...p} />;
    case 'trophy': return <Trophy {...p} />;
    case 'gem':    return <Gem    {...p} />;
    case 'cookie': return <Cookie {...p} />;
    case 'trash':  return <Trash2 {...p} />;
    case 'star':   return <Star   {...p} fill={color} />;
    default:       return <Gift   {...p} />;
  }
}

function pickItem(): GameItem {
  const r = Math.random();
  if (r < 0.07) return ITEMS[1];
  if (r < 0.14) return ITEMS[5];
  return [ITEMS[0], ITEMS[2], ITEMS[3], ITEMS[4]][Math.floor(Math.random() * 4)];
}

function getIntervalMs(elapsed: number): number {
  if (elapsed >= 30) return 1000;
  if (elapsed >= 15) return 1400;
  return 1800;
}

interface Signals { score: number; wrongSwipes: number; streakCurrent: number; maxStreak: number; decisionTimes: number[]; specialItemsCaught: number; }
function getPersonality(sig: Signals): string {
  const avg = sig.decisionTimes.length > 0 ? sig.decisionTimes.reduce((a,b)=>a+b,0)/sig.decisionTimes.length : 9999;
  if (sig.score >= 30 && sig.wrongSwipes <= 2) return "Santa's MVP 🎅";
  if (sig.maxStreak >= 10)                     return 'The Elf 🧝';
  if (avg < 600 && sig.score >= 20)            return 'Quick Sorter ⚡';
  if (sig.wrongSwipes === 0)                   return 'Coal Dodger 🪨';
  if (sig.score >= 20)                         return 'Gift Giver 🎁';
  return 'Still Learning 🌱';
}
type GamePhase = 'start' | 'countdown' | 'playing' | 'done';
type CardPhase = 'entering' | 'idle' | 'exiting-right' | 'exiting-left';

function GiftRushGameInner() {
  const theme       = useBrandTheme();
  const bgRef       = useRef<HTMLDivElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoAdvRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardSpawnRef = useRef<number>(0);
  const runningRef   = useRef(false);
  const elapsedRef   = useRef(0);
  const threeRef     = useRef<{ renderer: THREE.WebGLRenderer; animId: number } | null>(null);

  const sigRef = useRef<Signals>({ score: 0, wrongSwipes: 0, streakCurrent: 0, maxStreak: 0, decisionTimes: [], specialItemsCaught: 0 });

  const [phase, setPhase]               = useState<GamePhase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streakDisplay, setStreakDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [currentCard, setCurrentCard]   = useState<GameItem | null>(null);
  const [cardPhase, setCardPhase]       = useState<CardPhase>('entering');
  const [cardDx, setCardDx]             = useState(0);
  const [feedback, setFeedback]         = useState<'correct' | 'wrong' | null>(null);
  const playerSessionRef                = useRef<PlayerSession | null>(null);
  const pointerStartRef                 = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef                   = useRef(false);

  // ── Three.js background ───────────────────────────────────────────────────
  const startBg = useCallback(() => {
    const bg = bgRef.current; if (!bg) return;
    const W = bg.clientWidth, H = bg.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    bg.innerHTML = ''; bg.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0020);
    const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 100);
    camera.position.set(0, 0, 12);

    scene.add(new THREE.AmbientLight(0x442244, 2));
    const redLight = new THREE.PointLight(0xef4444, 2, 20);
    redLight.position.set(-4, 4, 5);
    scene.add(redLight);
    const greenLight = new THREE.PointLight(0x22c55e, 1.5, 18);
    greenLight.position.set(4, -3, 4);
    scene.add(greenLight);

    // Snowflakes
    const snowCount = 300;
    const snowPos = new Float32Array(snowCount * 3);
    const snowVel = new Float32Array(snowCount);
    for (let i = 0; i < snowCount; i++) {
      snowPos[i*3] = (Math.random()-0.5)*16;
      snowPos[i*3+1] = (Math.random()-0.5)*20 + 5;
      snowPos[i*3+2] = (Math.random()-0.5)*8;
      snowVel[i] = 0.01 + Math.random() * 0.02;
    }
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
    const snowMesh = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.7 }));
    scene.add(snowMesh);

    // Floating 3D gift boxes
    const giftColors = [0xef4444, 0x22c55e, 0xfbbf24, 0x3b82f6, 0xa855f7, 0xec4899];
    const gifts: Array<{ mesh: THREE.Group; vy: number; ry: number }> = [];
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group();
      const color = giftColors[i % giftColors.length];
      const boxMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.5, metalness: 0.2 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.5), boxMat);
      g.add(box);
      const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.55), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3 }));
      g.add(ribbon);
      const ribbon2 = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 0.08), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3 }));
      g.add(ribbon2);
      const lidGeo = new THREE.BoxGeometry(0.66, 0.12, 0.56);
      const lid = new THREE.Mesh(lidGeo, boxMat.clone());
      lid.position.y = 0.31;
      g.add(lid);

      g.position.set((Math.random()-0.5)*14, (Math.random()-0.5)*16, (Math.random()-0.5)*6 - 3);
      g.scale.setScalar(0.6 + Math.random() * 0.6);
      g.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
      scene.add(g);
      gifts.push({ mesh: g, vy: -0.01 - Math.random() * 0.015, ry: (Math.random()-0.5) * 0.012 });
    }

    let frame = 0;
    const animate = () => {
      const animId = requestAnimationFrame(animate);
      frame++;

      // Snow fall
      for (let i = 0; i < snowCount; i++) {
        snowPos[i*3+1] -= snowVel[i];
        snowPos[i*3]   += Math.sin(frame * 0.01 + i * 0.3) * 0.002;
        if (snowPos[i*3+1] < -12) { snowPos[i*3+1] = 12; snowPos[i*3] = (Math.random()-0.5)*16; }
      }
      snowGeo.attributes.position.needsUpdate = true;

      // Gifts float
      for (const g of gifts) {
        g.mesh.position.y += g.vy;
        g.mesh.rotation.y += g.ry;
        g.mesh.rotation.x += g.ry * 0.5;
        if (g.mesh.position.y < -12) g.mesh.position.y = 12;
      }

      // Lights pulse
      redLight.intensity = 1.5 + Math.sin(frame * 0.04) * 0.5;
      greenLight.intensity = 1.0 + Math.sin(frame * 0.06 + 1) * 0.5;

      renderer.render(scene, camera);
      threeRef.current = { renderer, animId };
    };
    animate();
  }, []);

  const stopBg = useCallback(() => {
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); threeRef.current = null; }
  }, []);

  // ── Game logic ────────────────────────────────────────────────────────────
  const clearAutoAdv = useCallback(() => { if (autoAdvRef.current) { clearTimeout(autoAdvRef.current); autoAdvRef.current = null; } }, []);

  const spawnCard = useCallback(() => {
    if (!runningRef.current) return;
    const item = pickItem();
    setCurrentCard(item); setCardPhase('entering'); setCardDx(0);
    cardSpawnRef.current = Date.now();
    clearAutoAdv();
    autoAdvRef.current = setTimeout(() => {
      if (!runningRef.current) return;
      sigRef.current.streakCurrent = 0; setStreakDisplay(0);
      setCardPhase('exiting-left');
      setTimeout(() => { if (runningRef.current) spawnCard(); }, 320);
    }, getIntervalMs(elapsedRef.current));
  }, [clearAutoAdv]);

  const endGame = useCallback(() => {
    runningRef.current = false; clearAutoAdv();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    try {
      const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) || '0', 10);
      if (sigRef.current.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(sigRef.current.score));
    } catch { /**/ }
    setFinalSig({ ...sigRef.current }); setPhase('done'); hapticVictory();
  }, [clearAutoAdv]);

  const startGame = useCallback(() => {
    runningRef.current = true; elapsedRef.current = 0;
    sigRef.current = { score: 0, wrongSwipes: 0, streakCurrent: 0, maxStreak: 0, decisionTimes: [], specialItemsCaught: 0 };
    setScoreDisplay(0); setStreakDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('holiday');

    timerRef.current = setInterval(() => {
      elapsedRef.current++;
      setTimeLeft(t => {
        if (t <= 1) { sfx.success?.(); endGame(); return 0; }
        return t - 1;
      });
    }, 1000);
    spawnCard();
  }, [endGame, spawnCard]);

  const handleSwipe = useCallback((direction: 'right' | 'left', card: GameItem) => {
    if (!runningRef.current) return;
    clearAutoAdv();
    const decisionMs = Date.now() - cardSpawnRef.current;
    sigRef.current.decisionTimes.push(decisionMs);
    const isCorrect = direction === card.correct;
    if (isCorrect) {
      sigRef.current.score += card.points;
      sigRef.current.streakCurrent++;
      if (sigRef.current.streakCurrent > sigRef.current.maxStreak) sigRef.current.maxStreak = sigRef.current.streakCurrent;
      if (card.rare) sigRef.current.specialItemsCaught++;
      setScoreDisplay(sigRef.current.score); setStreakDisplay(sigRef.current.streakCurrent);
      setFeedback('correct'); sfx.success?.(); hapticScore();
    } else {
      sigRef.current.wrongSwipes++; sigRef.current.streakCurrent = 0;
      setStreakDisplay(0); setFeedback('wrong'); sfx.fail?.(); hapticFail();
    }
    setCardPhase(direction === 'right' ? 'exiting-right' : 'exiting-left');
    setTimeout(() => { setFeedback(null); if (runningRef.current) spawnCard(); }, 340);
  }, [clearAutoAdv, spawnCard]);

  // Pointer events for swipe
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (cardPhase !== 'idle' && cardPhase !== 'entering') return;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    isDraggingRef.current = true;
    setCardPhase('idle');
  }, [cardPhase]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current || !pointerStartRef.current) return;
    const dx = e.clientX - pointerStartRef.current.x;
    setCardDx(dx);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current || !pointerStartRef.current || !currentCard) return;
    isDraggingRef.current = false;
    const dx = e.clientX - pointerStartRef.current.x;
    pointerStartRef.current = null;
    setCardDx(0);
    if (Math.abs(dx) >= SWIPE_THRESHOLD) {
      handleSwipe(dx > 0 ? 'right' : 'left', currentCard);
    } else {
      setCardPhase('idle');
    }
  }, [currentCard, handleSwipe]);

  useEffect(() => {
    if (phase === 'playing') startBg();
    return () => { if (phase !== 'playing') stopBg(); };
  }, [phase, startBg, stopBg]);

  useEffect(() => () => {
    clearAutoAdv();
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    stopBg();
  }, [clearAutoAdv, stopBg]);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { stopBg(); setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); sigRef.current = { score: 0, wrongSwipes: 0, streakCurrent: 0, maxStreak: 0, decisionTimes: [], specialItemsCaught: 0 }; }, [stopBg]);
  const buildInsights = (sig: Signals) => {
    const avg = sig.decisionTimes.length > 0 ? Math.round(sig.decisionTimes.reduce((a,b)=>a+b,0)/sig.decisionTimes.length) : 0;
    return [
      { label: 'Score', value: String(sig.score), color: ACCENT },
      { label: 'Best Streak', value: `×${sig.maxStreak}`, color: '#fbbf24' },
      { label: 'Wrong Swipes', value: String(sig.wrongSwipes), color: sig.wrongSwipes === 0 ? '#4ade80' : '#ef4444' },
      { label: 'Avg Speed', value: avg > 0 ? `${avg}ms` : '-', color: '#06b6d4' },
    ];
  };

  const cardVariants: import("framer-motion").Variants = {
    entering: { x: 0, y: -30, rotate: 0, opacity: 0, scale: 0.85 },
    idle: { x: cardDx, y: 0, rotate: cardDx * 0.04, opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 300, damping: 25 } },
    'exiting-right': { x: 400, y: -30, rotate: 20, opacity: 0, transition: { duration: 0.32 } },
    'exiting-left':  { x: -400, y: -30, rotate: -20, opacity: 0, transition: { duration: 0.32 } },
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Sort Gifts! 🎁" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startGame} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          {/* 3D background */}
          <div ref={bgRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
          {phase === 'playing' && (
            <>
              <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />
              {/* Direction hints */}
              <div style={{ position: 'absolute', top: '18%', left: 0, right: 0, display: 'flex', justifyContent: 'space-between', padding: '0 24px', pointerEvents: 'none' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(239,68,68,0.7)', letterSpacing: 1 }}>← COAL</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(34,197,94,0.7)', letterSpacing: 1 }}>GIFTS →</div>
              </div>
              {/* Card */}
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
                <AnimatePresence mode="wait">
                  {currentCard && (
                    <motion.div key={currentCard.id + cardSpawnRef.current} variants={cardVariants} initial="entering" animate={cardPhase} exit="exiting-left"
                      onAnimationComplete={() => { if (cardPhase === 'entering') setCardPhase('idle'); }}
                      style={{ position: 'relative', width: 220, height: 260, background: feedback === 'correct' ? 'rgba(34,197,94,0.15)' : feedback === 'wrong' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.08)', backdropFilter: 'blur(16px)', borderRadius: 24, border: `2px solid ${feedback === 'correct' ? '#22c55e' : feedback === 'wrong' ? '#ef4444' : 'rgba(255,255,255,0.15)'}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, cursor: 'grab', userSelect: 'none', boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 40px ${feedback === 'correct' ? 'rgba(34,197,94,0.3)' : feedback === 'wrong' ? 'rgba(239,68,68,0.3)' : 'transparent'}` }}>
                      <ItemIcon type={currentCard.iconType} color={currentCard.iconColor} size={72} />
                      <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: 0.5 }}>{currentCard.label}</div>
                      {currentCard.rare && <div style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(251,191,36,0.2)', border: '1px solid #fbbf24', borderRadius: 8, padding: '2px 8px', fontSize: 10, fontWeight: 800, color: '#fbbf24', letterSpacing: 1 }}>RARE</div>}
                      {cardDx !== 0 && (
                        <div style={{ position: 'absolute', fontSize: 28, fontWeight: 900, color: cardDx > 0 ? '#22c55e' : '#ef4444', opacity: Math.min(1, Math.abs(cardDx) / 80) }}>
                          {cardDx > 0 ? '→ KEEP' : '← DITCH'}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {/* Streak */}
              {streakDisplay >= 3 && (
                <div style={{ position: 'absolute', bottom: '18%', left: '50%', transform: 'translateX(-50%)', fontSize: 14, fontWeight: 800, color: '#fbbf24', letterSpacing: 2, textShadow: '0 0 12px #fbbf24' }}>
                  🔥 {streakDisplay}x STREAK
                </div>
              )}
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 15} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, wrongSwipes: sig.wrongSwipes, maxStreak: sig.maxStreak, specialItemsCaught: sig.specialItemsCaught }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const GiftRushGame = dynamic(() => Promise.resolve({ default: GiftRushGameInner }), { ssr: false });
export default GiftRushGame;
