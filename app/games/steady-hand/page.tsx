'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { createTiltController } from '@/lib/tilt';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import PlayerNameInput from '@/components/PlayerNameInput';

const GAME_ID = 'steady-hand';

type GameState = 'start' | 'countdown' | 'playing' | 'done';
interface BehaviorData { pctOnTarget: number; avgDeviation: number; tremorScore: number; }

const RING_RADII = [80, 60, 40, 24];
function getProfile(b: BehaviorData) {
  if (b.tremorScore < 20 && b.pctOnTarget > 70) return 'Steady as a rock 🪨';
  if (b.tremorScore > 50) return 'Anxious energy ⚡';
  return 'Slightly shaky 🤏';
}

export default function SteadyHand() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const shakeRef = useRef({ x: 0, y: 0 });
  const tiltControllerRef = useRef<ReturnType<typeof createTiltController> | null>(null);
  const stateRef = useRef({
    cursorX: 0, cursorY: 0, centerX: 0, centerY: 0,
    ringStage: 0, ringRadius: 80,
    onTargetFrames: 0, totalFrames: 0,
    deviations: [] as number[],
    positionHistory: [] as { x: number; y: number }[],
    onTargetByRing: [0,0,0,0] as number[],
    totalByRing: [0,0,0,0] as number[],
    timeLeft: 60, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    running: false,
    joystickX: 0, joystickY: 0,
    lastHapticTime: 0, lastOffTargetHapticTime: 0,
    onTargetStreak: 0, streakSeconds: 0,
    accentColor: '#eab308',
  });
  const [gameState, setGameState] = useState<GameState>('start');
  const [timeLeft, setTimeLeft] = useState(60);
  const [behavior, setBehavior] = useState<BehaviorData | null>(null);
  const [streakSec, setStreakSec] = useState(0);
  const [shakeOffset, setShakeOffset] = useState({ x: 0, y: 0 });
  const [joystickEnabled, setJoystickEnabled] = useState(false);
  const [joystickThumb, setJoystickThumb] = useState({ x: 0, y: 0 });
  const [playerName, setPlayerName]   = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const playerSessionRef              = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent; }, [theme]);

  const endGame = useCallback((capturedTheme: typeof theme) => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    tiltControllerRef.current?.stop();
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const pct = s.totalFrames > 0 ? (s.onTargetFrames / s.totalFrames) * 100 : 0;
    const avgDev = s.deviations.length > 0 ? s.deviations.reduce((a,b)=>a+b,0)/s.deviations.length : 0;
    let tremorScore = 0;
    if (s.positionHistory.length > 30) {
      const windows = Math.floor(s.positionHistory.length / 30);
      let totalStd = 0;
      for (let w = 0; w < windows; w++) {
        const slice = s.positionHistory.slice(w*30,(w+1)*30);
        const ax = slice.reduce((a,p)=>a+p.x,0)/slice.length;
        const ay = slice.reduce((a,p)=>a+p.y,0)/slice.length;
        totalStd += Math.sqrt(slice.reduce((a,p)=>a+(p.x-ax)**2+(p.y-ay)**2,0)/slice.length);
      }
      tremorScore = Math.min(100, Math.round((totalStd/windows)*2));
    }
    const bData: BehaviorData = { pctOnTarget: Math.round(pct), avgDeviation: Math.round(avgDev), tremorScore };
    setBehavior(bData);
    setGameState('done');
    postWebhook(capturedTheme, 'steady-hand', { score:`${Math.round(pct)}%`, personality: getProfile(bData), signals: bData }, playerSessionRef.current);
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.ringStage = 0; s.onTargetFrames = 0; s.totalFrames = 0;
    s.deviations = []; s.positionHistory = []; s.onTargetByRing = [0,0,0,0]; s.totalByRing = [0,0,0,0];
    s.timeLeft = 60; s.running = true; s.joystickX = 0; s.joystickY = 0;
    s.onTargetStreak = 0; s.streakSeconds = 0;
    setTimeLeft(60); setStreakSec(0); setGameState('playing');
    stopMusicRef.current = startMusic('minimal');
    const capturedTheme = theme;

    const canvas = canvasRef.current; if (!canvas) return;
    // Fix: explicitly size canvas at game start (not just on mount) to prevent 0×0 blank screen
    if (!canvas.width || !canvas.height) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    s.centerX = canvas.width / 2; s.centerY = canvas.height / 2;
    s.cursorX = s.centerX; s.cursorY = s.centerY;
    s.ringRadius = RING_RADII[0];

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      sfx.tick();
      const stage = Math.min(3, Math.floor((60 - s.timeLeft) / 15));
      if (stage !== s.ringStage) {
        s.ringStage = stage; s.ringRadius = RING_RADII[stage];
        sfx.success();
      }
      if (s.timeLeft <= 0) endGame(capturedTheme);
    }, 1000);

    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    const loop = () => {
      if (!s.running) return;
      try {
      const accent = s.accentColor;

      // Tilt input: combine deviceorientation + joystick
      const tilt = tiltControllerRef.current?.getValues() ?? { x: 0, y: 0 };
      const inputX = tilt.x + s.joystickX;
      const inputY = tilt.y + s.joystickY;
      // Floaty cursor: delta += tilt * multiplier per frame
      s.cursorX += inputX * 8;
      s.cursorY += inputY * 8;
      s.cursorX = Math.max(20, Math.min(W-20, s.cursorX));
      s.cursorY = Math.max(20, Math.min(H-20, s.cursorY));

      const dist = Math.sqrt((s.cursorX-s.centerX)**2 + (s.cursorY-s.centerY)**2);
      s.deviations.push(dist); s.positionHistory.push({ x: s.cursorX, y: s.cursorY });
      s.totalFrames++; s.totalByRing[s.ringStage]++;
      const onTarget = dist <= s.ringRadius;
      const now = Date.now();

      if (onTarget) {
        s.onTargetFrames++; s.onTargetByRing[s.ringStage]++;
        s.onTargetStreak++;
        s.streakSeconds = Math.floor(s.onTargetStreak / 60);
        setStreakSec(s.streakSeconds);
        if (now - s.lastHapticTime > 1000) { haptic([10]); s.lastHapticTime = now; }
      } else {
        s.onTargetStreak = 0; s.streakSeconds = 0; setStreakSec(0);
        shakeRef.current = { x: (Math.random()-0.5)*4, y: (Math.random()-0.5)*4 };
        setShakeOffset({ x: shakeRef.current.x, y: shakeRef.current.y });
        if (now - s.lastOffTargetHapticTime > 500) { haptic([50]); s.lastOffTargetHapticTime = now; }
      }

      // Lab / operating room — dark green with subtle grid
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#0a1408');
      bgGrad.addColorStop(1, '#060d05');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(100,160,80,0.05)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 32) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
      for (let gy = 0; gy < H; gy += 32) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

      const pulse = 1 + Math.sin(Date.now() / 500) * 0.04;
      RING_RADII.forEach((r, i) => {
        const alpha = i === s.ringStage ? 1 : 0.2;
        ctx.save();
        ctx.beginPath(); ctx.arc(s.centerX, s.centerY, r * (i === s.ringStage ? pulse : 1), 0, Math.PI*2);
        ctx.strokeStyle = `rgba(234,179,8,${alpha})`;
        ctx.lineWidth = i === s.ringStage ? 3 : 1; ctx.stroke(); ctx.restore();
      });
      ctx.beginPath(); ctx.arc(s.centerX, s.centerY, 8, 0, Math.PI*2);
      ctx.fillStyle = accent; ctx.fill();

      const proximity = 1 - Math.min(1, dist / (s.ringRadius * 2));
      const cursorColor = onTarget ? '#00ff88' : dist < s.ringRadius * 1.5 ? '#ffaa00' : '#ef4444';
      ctx.save();
      ctx.shadowBlur = 16; ctx.shadowColor = cursorColor;
      ctx.beginPath(); ctx.arc(s.cursorX, s.cursorY, 12, 0, Math.PI*2);
      ctx.fillStyle = cursorColor + '88'; ctx.fill();
      ctx.strokeStyle = cursorColor; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = cursorColor + '55'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(s.cursorX-22,s.cursorY); ctx.lineTo(s.cursorX+22,s.cursorY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.cursorX,s.cursorY-22); ctx.lineTo(s.cursorX,s.cursorY+22); ctx.stroke();
      void proximity;

      s.animId = requestAnimationFrame(loop);
      } catch (err) {
        console.error('[SteadyHand] loop error:', err);
        s.animId = requestAnimationFrame(loop);
      }
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, theme]);

  const handleStart = useCallback(async () => {
    playerSessionRef.current = savePlayerSession(GAME_ID, playerName, playerAvatar);
    initAudio(); sfx.click();
    const controller = createTiltController(() => {}, { sensitivity: 0.8, smoothing: 0.55, deadzone: 3, clamp: 18 });
    tiltControllerRef.current = controller;
    const success = await controller.start();
    if (!success) {
      setJoystickEnabled(true);
    } else {
      let got = false;
      const check = () => { got = true; };
      window.addEventListener('deviceorientation', check, { once: true });
      setTimeout(() => {
        window.removeEventListener('deviceorientation', check);
        if (!got) setJoystickEnabled(true);
      }, 1500);
    }
    setGameState('countdown');
  }, [playerName, playerAvatar]);

  const handlePlayAgain = useCallback(() => {
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    tiltControllerRef.current?.stop();
    tiltControllerRef.current = null;
    setJoystickEnabled(false);
    setJoystickThumb({ x: 0, y: 0 });
    setGameState('start');
  }, []);

  // Joystick touch handlers
  const handleJoystickTouch = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = touch.clientX - cx;
    const dy = touch.clientY - cy;
    const MAX_RADIUS = 60;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const nx = dist > 0 ? (dx / dist) * Math.min(1, dist / MAX_RADIUS) : 0;
    const ny = dist > 0 ? (dy / dist) * Math.min(1, dist / MAX_RADIUS) : 0;
    stateRef.current.joystickX = nx;
    stateRef.current.joystickY = ny;
    const clampedDist = Math.min(dist, MAX_RADIUS);
    setJoystickThumb({ x: dist > 0 ? (dx / dist) * clampedDist : 0, y: dist > 0 ? (dy / dist) * clampedDist : 0 });
  }, []);

  const handleJoystickEnd = useCallback(() => {
    stateRef.current.joystickX = 0;
    stateRef.current.joystickY = 0;
    setJoystickThumb({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const onResize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      const s = stateRef.current;
      s.running = false; cancelAnimationFrame(s.animId);
      if (s.intervalId) clearInterval(s.intervalId);
      tiltControllerRef.current?.stop();
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []);

  const accent = theme.colors.accent;

  return (
    <GameShell title="Steady Hand" emoji="🎯" accentColor={accent} theme={theme}>
      <div style={{ transform: `translate(${shakeOffset.x}px,${shakeOffset.y}px)`, width:'100%', height:'100%' }}>
        <canvas ref={canvasRef} style={{ display: gameState==='playing' ? 'block' : 'none', position:'absolute', top:0, left:0 }} />
      </div>
      {gameState==='playing' && (
        <GameHUD
          items={[
            ...(streakSec > 0 ? [{ label: 'STREAK', value: `${streakSec}s` }] : []),
            { label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 10 },
          ]}
          accentColor={accent}
        />
      )}
      {/* Joystick overlay */}
      {joystickEnabled && gameState === 'playing' && (
        <div
          style={{
            position: 'fixed', bottom: 40, left: '50%', transform: 'translateX(-50%)',
            width: 140, height: 140, borderRadius: '50%',
            border: '3px solid rgba(255,255,255,0.25)',
            backgroundColor: 'rgba(255,255,255,0.06)',
            zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
            touchAction: 'none',
          }}
          onTouchStart={handleJoystickTouch}
          onTouchMove={handleJoystickTouch}
          onTouchEnd={handleJoystickEnd}
        >
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            backgroundColor: `${accent}44`,
            border: `2px solid ${accent}99`,
            transform: `translate(${joystickThumb.x}px, ${joystickThumb.y}px)`,
            transition: joystickThumb.x === 0 && joystickThumb.y === 0 ? 'transform 0.15s ease' : 'none',
            pointerEvents: 'none',
          }} />
        </div>
      )}
      {gameState==='countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {gameState==='start' && (
        <GameStartScreen
          emoji="🎯"
          title="Steady Hand"
          description="Tilt to guide the cursor. Hold it inside the shrinking ring as long as you can."
          sensorNote="Uses motion sensors"
          ctaLabel="Enable Motion & Start →"
          accentColor={accent}
          onStart={handleStart}
        >
          <PlayerNameInput
            accentColor={accent}
            onReady={(name, avatar) => { setPlayerName(name); setPlayerAvatar(avatar); }}
          />
        </GameStartScreen>
      )}
      {gameState==='done' && behavior && (
        <EndScreen
          gameId="steady-hand"
          title={getProfile(behavior)}
          emoji="🎯"
          score={`${behavior.pctOnTarget}%`}
          personality={getProfile(behavior)}
          insights={[
            { label:'Time on target', value:`${behavior.pctOnTarget}%`, color:accent },
            { label:'Avg deviation', value:`${behavior.avgDeviation}px`, color:'#fcd34d' },
            { label:'Tremor score', value:`${behavior.tremorScore}/100`, color: behavior.tremorScore>50 ? '#ef4444' : '#00ff88' },
          ]}
          accentColor={accent}
          onPlayAgain={handlePlayAgain}
          didWin={behavior.pctOnTarget > 70}
        />
      )}
    </GameShell>
  );
}
