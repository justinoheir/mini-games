'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, startMusic } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticImpact } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { createTiltController } from '@/lib/tilt';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import SwipeInstructions from '@/components/SwipeInstructions';
import { Grid3x3 } from 'lucide-react';

type MazeCell = { top: number; right: number; bottom: number; left: number };
const GRID = 5;
const GAME_ID = 'tilt-maze';

function generateMaze(grid: number): MazeCell[][] {
  const cells: MazeCell[][] = Array.from({ length: grid }, () =>
    Array.from({ length: grid }, () => ({ top: 1, right: 1, bottom: 1, left: 1 }))
  );
  const visited = Array.from({ length: grid }, () => new Array<boolean>(grid).fill(false));

  function carve(r: number, c: number) {
    visited[r][c] = true;
    const dirs: [number, number, keyof MazeCell, keyof MazeCell][] = [
      [0, 1, 'right', 'left'],
      [-1, 0, 'top', 'bottom'],
      [0, -1, 'left', 'right'],
      [1, 0, 'bottom', 'top'],
    ].sort(() => Math.random() - 0.5) as [number, number, keyof MazeCell, keyof MazeCell][];
    for (const [dr, dc, wall, opposite] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < grid && nc >= 0 && nc < grid && !visited[nr][nc]) {
        cells[r][c][wall] = 0;
        cells[nr][nc][opposite] = 0;
        carve(nr, nc);
      }
    }
  }
  carve(0, 0);
  // Always enforce border walls on outermost edges
  for (let i = 0; i < grid; i++) {
    cells[0][i].top = 1;
    cells[grid - 1][i].bottom = 1;
    cells[i][0].left = 1;
    cells[i][grid - 1].right = 1;
  }
  return cells;
}

// Fallback static maze (used on initial render before game starts)
const STATIC_MAZE: MazeCell[][] = [
  [{top:1,right:0,bottom:0,left:1},{top:1,right:0,bottom:1,left:0},{top:1,right:1,bottom:0,left:0},{top:1,right:0,bottom:1,left:1},{top:1,right:1,bottom:1,left:0}],
  [{top:0,right:1,bottom:0,left:1},{top:1,right:0,bottom:0,left:1},{top:0,right:0,bottom:1,left:0},{top:1,right:1,bottom:0,left:0},{top:1,right:1,bottom:0,left:1}],
  [{top:0,right:0,bottom:1,left:1},{top:0,right:1,bottom:0,left:0},{top:1,right:0,bottom:0,left:1},{top:0,right:0,bottom:1,left:0},{top:0,right:1,bottom:1,left:0}],
  [{top:1,right:0,bottom:0,left:1},{top:0,right:1,bottom:1,left:0},{top:0,right:0,bottom:0,left:1},{top:1,right:0,bottom:0,left:0},{top:1,right:1,bottom:0,left:0}],
  [{top:0,right:0,bottom:1,left:1},{top:1,right:0,bottom:1,left:0},{top:0,right:0,bottom:1,left:0},{top:0,right:1,bottom:1,left:0},{top:0,right:1,bottom:1,left:1}],
];

interface BehaviorData {
  collisions: number; correctionTimes: number[];
  completionTime: number | null; timedOut: boolean;
}
type GameState = 'start' | 'countdown' | 'playing' | 'done';

function getProfile(b: BehaviorData) {
  const avg = b.correctionTimes.length > 0
    ? b.correctionTimes.reduce((a, c) => a + c, 0) / b.correctionTimes.length : 999;
  if (b.collisions < 5 && avg < 300) return 'Precision Navigator 🎯';
  if (b.collisions > 15) return 'Reactive Explorer ⚡';
  return 'Methodical Solver 🧭';
}

export default function TiltMaze() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const tiltControllerRef = useRef<ReturnType<typeof createTiltController> | null>(null);
  const hapticsEnabled = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('haptics') !== 'off'
    : true;

  const stateRef = useRef({
    ballX: 0, ballY: 0, velX: 0, velY: 0,
    behavior: { collisions: 0, correctionTimes: [] as number[], completionTime: null as number | null, timedOut: false },
    lastCollisionTime: 0, startTime: 0, animId: 0,
    joystickX: 0, joystickY: 0,
    timeLeft: 60, wallFlashUntil: 0,
    ballTrail: [] as { x: number; y: number }[],
    running: false,
    accentColor: '#a855f7',
    maze: STATIC_MAZE as MazeCell[][],
    celebrateUntil: 0,
    exitX: 0, exitY: 0,
  });
  const [gameState, setGameState] = useState<GameState>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft] = useState(60);
  const [behavior, setBehavior] = useState<BehaviorData | null>(null);
  const [joystickEnabled, setJoystickEnabled] = useState(false);
  const [joystickThumb, setJoystickThumb] = useState({ x: 0, y: 0 });
  const [playerName, setPlayerName]   = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const { pops } = useScorePop();
  const playerSessionRef              = useRef<PlayerSession | null>(null);
  const [scorePop, setScorePop]       = useState<string | null>(null);
  const [nearMissMsg, setNearMissMsg] = useState(false);
  const [milestoneMsg, setMilestoneMsg] = useState<string | null>(null);
  const lastNearMissTimeRef           = useRef(0);
  const halfTimeFiredRef              = useRef(false);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent; }, [theme]);

  const drawMaze = useCallback((ctx2d: CanvasRenderingContext2D, cs: number, ox: number, oy: number, accent: string) => {
    // Outer glow pass — thick, soft glow layer
    ctx2d.save();
    ctx2d.shadowBlur = 12;
    ctx2d.shadowColor = accent + '55';
    ctx2d.strokeStyle = accent + '55';
    ctx2d.lineWidth = 4;
    const maze = stateRef.current.maze;
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const x = ox + c * cs, y = oy + r * cs;
        const w = maze[r][c];
        if (w.top)    { ctx2d.beginPath(); ctx2d.moveTo(x,y);    ctx2d.lineTo(x+cs,y);    ctx2d.stroke(); }
        if (w.right)  { ctx2d.beginPath(); ctx2d.moveTo(x+cs,y); ctx2d.lineTo(x+cs,y+cs); ctx2d.stroke(); }
        if (w.bottom) { ctx2d.beginPath(); ctx2d.moveTo(x,y+cs); ctx2d.lineTo(x+cs,y+cs); ctx2d.stroke(); }
        if (w.left)   { ctx2d.beginPath(); ctx2d.moveTo(x,y);    ctx2d.lineTo(x,y+cs);    ctx2d.stroke(); }
      }
    }
    ctx2d.restore();
    // Sharp inner wall pass
    ctx2d.save();
    ctx2d.strokeStyle = accent;
    ctx2d.lineWidth = 2;
    ctx2d.shadowBlur = 0;
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const x = ox + c * cs, y = oy + r * cs;
        const w = maze[r][c];
        if (w.top)    { ctx2d.beginPath(); ctx2d.moveTo(x,y);    ctx2d.lineTo(x+cs,y);    ctx2d.stroke(); }
        if (w.right)  { ctx2d.beginPath(); ctx2d.moveTo(x+cs,y); ctx2d.lineTo(x+cs,y+cs); ctx2d.stroke(); }
        if (w.bottom) { ctx2d.beginPath(); ctx2d.moveTo(x,y+cs); ctx2d.lineTo(x+cs,y+cs); ctx2d.stroke(); }
        if (w.left)   { ctx2d.beginPath(); ctx2d.moveTo(x,y);    ctx2d.lineTo(x,y+cs);    ctx2d.stroke(); }
      }
    }
    ctx2d.restore();
  }, []);

  const checkWalls = useCallback((
    bx: number, by: number, vx: number, vy: number,
    cs: number, ox: number, oy: number, radius: number
  ) => {
    const s = stateRef.current;
    const col = Math.floor((bx - ox) / cs), row = Math.floor((by - oy) / cs);
    let nvx = vx, nvy = vy, hit = false;
    if (row >= 0 && row < GRID && col >= 0 && col < GRID) {
      const w = stateRef.current.maze[row][col];
      const cx2 = ox + col * cs, cy2 = oy + row * cs;
      if (w.top    && by - radius < cy2)      { nvy =  Math.abs(nvy); hit = true; }
      if (w.bottom && by + radius > cy2 + cs) { nvy = -Math.abs(nvy); hit = true; }
      if (w.left   && bx - radius < cx2)      { nvx =  Math.abs(nvx); hit = true; }
      if (w.right  && bx + radius > cx2 + cs) { nvx = -Math.abs(nvx); hit = true; }
    }
    if (bx - radius < ox)            { nvx =  Math.abs(nvx); hit = true; }
    if (bx + radius > ox + GRID * cs){ nvx = -Math.abs(nvx); hit = true; }
    if (by - radius < oy)            { nvy =  Math.abs(nvy); hit = true; }
    if (by + radius > oy + GRID * cs){ nvy = -Math.abs(nvy); hit = true; }
    if (hit) {
      const now = Date.now();
      s.behavior.collisions++;
      // Throttle sound+haptic to 150ms — prevents 60fps audio buzz when ball is pressed against wall
      if (now - s.lastCollisionTime > 150) {
        sfx.collision();
        if (hapticsEnabled) hapticImpact();
      }
      if (s.lastCollisionTime) s.behavior.correctionTimes.push(now - s.lastCollisionTime);
      s.lastCollisionTime = now;
    }
    return { nvx, nvy, hit };
  }, []);

  const endGame = useCallback((themeRef: typeof theme) => {
    const s = stateRef.current;
    if (!s.running) return; // guard: prevent double-fire (timer + celebrate race condition)
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (timerRef.current) clearInterval(timerRef.current);
    tiltControllerRef.current?.stop();
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const bData = { ...s.behavior };
    setBehavior(bData);
    setGameState('done');
    postWebhook(themeRef, 'tilt-maze', {
      score: bData.completionTime ? `${(bData.completionTime / 1000).toFixed(1)}s` : 'DNF',
      personality: getProfile(bData),
      signals: { collisions: bData.collisions, timedOut: bData.timedOut },
    }, playerSessionRef.current);
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.behavior = { collisions: 0, correctionTimes: [], completionTime: null, timedOut: false };
    s.timeLeft = 60; s.velX = 0; s.velY = 0; s.running = true;
    s.ballTrail = []; s.wallFlashUntil = 0; s.joystickX = 0; s.joystickY = 0; s.celebrateUntil = 0;
    s.maze = generateMaze(GRID);
    halfTimeFiredRef.current = false;
    setGameState('playing'); setTimeLeft(60);
    stopMusicRef.current = startMusic('tense');
    const capturedTheme = theme;

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft === 30 && !halfTimeFiredRef.current) {
        halfTimeFiredRef.current = true;
        setMilestoneMsg('Halfway! Keep going! ⏱️');
        setTimeout(() => setMilestoneMsg(null), 1800);
      }
      if (s.timeLeft === 10) { sfx.warning(); if (hapticsEnabled) hapticScore(); }
      else if (s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) { s.behavior.timedOut = true; sfx.fail(); if (hapticsEnabled) hapticFail(); endGame(capturedTheme); }
    }, 1000);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    const W = canvas.offsetWidth, H = canvas.offsetHeight;
    const cs = Math.min(W, H) * 0.14;
    const ox = (W - GRID * cs) / 2, oy = (H - GRID * cs) / 2;
    s.ballX = ox + cs * 0.5; s.ballY = oy + cs * 0.5;
    const radius = cs * 0.2;
    s.startTime = Date.now();

    const loop = () => {
      if (!s.running) return;
      const accent = s.accentColor;
      const exitX = ox + GRID * cs - cs / 2, exitY = oy + GRID * cs - cs / 2;

      // Celebrate animation: expanding rings before game ends
      if (s.celebrateUntil > 0) {
        const elapsed = Date.now() - (s.celebrateUntil - 900);
        const progress = Math.min(elapsed / 900, 1);
        const bgGrad2 = ctx2d.createLinearGradient(0, 0, 0, H);
        bgGrad2.addColorStop(0, '#131921'); bgGrad2.addColorStop(1, '#0d1117');
        ctx2d.fillStyle = bgGrad2; ctx2d.fillRect(0, 0, W, H);
        ctx2d.fillStyle = `rgba(0,255,136,${0.25 * (1 - progress)})`; ctx2d.fillRect(0, 0, W, H);
        for (let ring = 0; ring < 4; ring++) {
          const rr = ((progress + ring * 0.25) % 1) * cs * 2.5;
          const alpha = Math.max(0, 1 - (progress + ring * 0.25) % 1) * 0.9;
          ctx2d.beginPath(); ctx2d.arc(exitX, exitY, rr, 0, Math.PI * 2);
          ctx2d.strokeStyle = `rgba(0,255,136,${alpha})`; ctx2d.lineWidth = 3; ctx2d.stroke();
        }
        ctx2d.save(); ctx2d.shadowBlur = 30; ctx2d.shadowColor = '#00ff88';
        ctx2d.beginPath(); ctx2d.arc(s.ballX, s.ballY, radius * (1 + progress), 0, Math.PI * 2);
        ctx2d.fillStyle = `rgba(0,255,136,${1 - progress})`; ctx2d.fill(); ctx2d.restore();
        if (Date.now() >= s.celebrateUntil) { s.celebrateUntil = 0; endGame(capturedTheme); return; }
        s.animId = requestAnimationFrame(loop); return;
      }
      // Dungeon atmosphere — dark stone gradient + vignette
      const bgGrad = ctx2d.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#131921');
      bgGrad.addColorStop(1, '#0d1117');
      ctx2d.fillStyle = bgGrad;
      ctx2d.fillRect(0, 0, W, H);
      const vig = ctx2d.createRadialGradient(W/2, H/2, W*0.1, W/2, H/2, W*0.75);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx2d.fillStyle = vig;
      ctx2d.fillRect(0, 0, W, H);
      if (Date.now() < s.wallFlashUntil) {
        const flashProgress = 1 - (Date.now() - (s.wallFlashUntil - 180)) / 180;
        ctx2d.fillStyle = `rgba(255,0,0,${Math.max(0, flashProgress) * 0.28})`; ctx2d.fillRect(0, 0, W, H);
      }
      drawMaze(ctx2d, cs, ox, oy, accent);

      // Tilt input: combine deviceorientation + joystick
      const tilt = tiltControllerRef.current?.getValues() ?? { x: 0, y: 0 };
      const inputX = tilt.x + s.joystickX;
      const inputY = tilt.y + s.joystickY;
      s.velX += inputX * 0.4;
      s.velY += inputY * 0.4;
      s.velX *= 0.85; s.velY *= 0.85;
      s.velX = Math.max(-5, Math.min(5, s.velX)); s.velY = Math.max(-5, Math.min(5, s.velY));
      const { nvx, nvy, hit } = checkWalls(s.ballX + s.velX, s.ballY + s.velY, s.velX, s.velY, cs, ox, oy, radius);
      if (hit) s.wallFlashUntil = Date.now() + 180;
      s.velX = nvx; s.velY = nvy; s.ballX += nvx; s.ballY += nvy;

      // Trail — pre-compute RGB once per frame (not per trail point)
      s.ballTrail.push({ x: s.ballX, y: s.ballY });
      if (s.ballTrail.length > 8) s.ballTrail.shift();
      const trailHex = accent.replace('#', '');
      const trailR = parseInt(trailHex.slice(0,2),16);
      const trailG = parseInt(trailHex.slice(2,4),16);
      const trailB = parseInt(trailHex.slice(4,6),16);
      s.ballTrail.forEach((pos, i) => {
        ctx2d.beginPath(); ctx2d.arc(pos.x, pos.y, radius * (0.35 + i / 16), 0, Math.PI * 2);
        ctx2d.fillStyle = `rgba(${trailR},${trailG},${trailB},${(i / 8) * 0.4})`; ctx2d.fill();
      });
      ctx2d.save();
      ctx2d.shadowBlur = 22; ctx2d.shadowColor = accent;
      ctx2d.beginPath(); ctx2d.arc(s.ballX, s.ballY, radius, 0, Math.PI * 2);
      ctx2d.fillStyle = accent; ctx2d.fill();
      ctx2d.restore();

      // Exit portal
      const pulseR = 13 + Math.sin(Date.now() / 220) * 5;
      ctx2d.save(); ctx2d.shadowBlur = 18; ctx2d.shadowColor = '#00ff88';
      ctx2d.beginPath(); ctx2d.arc(exitX, exitY, pulseR, 0, Math.PI * 2);
      ctx2d.fillStyle = 'rgba(0,255,136,0.25)'; ctx2d.fill();
      ctx2d.strokeStyle = '#00ff88'; ctx2d.lineWidth = 3; ctx2d.stroke();
      ctx2d.restore();

      // Near-miss: ball within 1.8x cell-size but not touching exit
      const distToExit = Math.sqrt((s.ballX - exitX)**2 + (s.ballY - exitY)**2);
      const nearMissDist = cs * 0.9;
      const exitReach = cs * 0.42;
      if (s.celebrateUntil === 0 && distToExit < nearMissDist && distToExit >= exitReach) {
        const now2 = Date.now();
        if (now2 - lastNearMissTimeRef.current > 3000) {
          lastNearMissTimeRef.current = now2;
          setNearMissMsg(true);
          setTimeout(() => setNearMissMsg(false), 1500);
        }
      }
      if (s.celebrateUntil === 0 && distToExit < exitReach) {
        s.behavior.completionTime = Date.now() - s.startTime;
        sfx.success();
        if (hapticsEnabled) hapticVictory();
        const timeStr = `${(s.behavior.completionTime / 1000).toFixed(1)}s`;
        setScorePop(timeStr);
        setTimeout(() => setScorePop(null), 1800);
        s.celebrateUntil = Date.now() + 900;
        s.animId = requestAnimationFrame(loop); return;
      }
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [drawMaze, checkWalls, endGame, theme]);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio();
    // Create fresh controller each play
    const controller = createTiltController(() => {}, { sensitivity: 1.0, smoothing: 0.45, deadzone: 2, clamp: 22 });
    tiltControllerRef.current = controller;
    const success = await controller.start();
    if (!success) {
      if (hapticsEnabled) hapticScore();
      setJoystickEnabled(true);
    } else {
      // Auto-fallback if no events fire within 1500ms
      let got = false;
      const check = () => { got = true; };
      window.addEventListener('deviceorientation', check, { once: true });
      setTimeout(() => {
        window.removeEventListener('deviceorientation', check);
        if (!got) setJoystickEnabled(true);
      }, 1500);
    }
    setGameState('countdown');
  }, []);

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
    const applySize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = window.innerWidth  * dpr;
      canvas.height = window.innerHeight * dpr;
      // Keep CSS display size at 1:1 viewport pixels
      canvas.style.width  = window.innerWidth  + 'px';
      canvas.style.height = window.innerHeight + 'px';
      const ctx2 = canvas.getContext('2d');
      if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    applySize();
    const onResize = applySize;
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (timerRef.current) clearInterval(timerRef.current);
      cancelAnimationFrame(stateRef.current.animId);
      tiltControllerRef.current?.stop();
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []);

  const b = behavior;
  const avg = b?.correctionTimes?.length ? Math.round(b.correctionTimes.reduce((a,c)=>a+c,0)/b.correctionTimes.length) : null;
  const accent = theme.colors.accent;

  return (
    <>
      {gameState === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="tilt-maze"
          steps={[{ icon: "📱", title: "Tilt your phone", body: "Tilt left, right, forward, and back to roll the ball." }, { icon: "🌀", title: "Navigate the maze", body: "Guide the ball through the paths to reach the glowing exit." }, { icon: "⏱️", title: "Beat the clock", body: "Reach the exit before time runs out. Fewer wall hits = better score." }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title="Tilt Maze" emoji="🌀" accentColor={accent} theme={theme}>
      <canvas ref={canvasRef} style={{ display: gameState==='playing' ? 'block' : 'none', position: 'absolute', top:0, left:0, touchAction: 'none' }} />
      {gameState==='playing' && (
        <GameHUD
          items={[{ label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 10 }]}
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
      {/* Score pop overlay */}
      {scorePop && (
        <div style={{
          position: 'fixed', top: '30%', left: '50%', transform: 'translateX(-50%)',
          zIndex: 80, pointerEvents: 'none',
          animation: 'scorePop 1.8s ease-out forwards',
          fontSize: 52, fontWeight: 900, color: '#00ff88',
          textShadow: '0 0 24px #00ff8888',
          letterSpacing: '-1px',
        }}>
          {scorePop} 🏁
        </div>
      )}
      {/* Near-miss message */}
      <AnimatePresence>
        {nearMissMsg && (
          <motion.div
            key="near-miss"
            initial={{ opacity: 0, scale: 0.7, y: 0 }}
            animate={{ opacity: 1, scale: 1, y: -10 }}
            exit={{ opacity: 0, scale: 0.8, y: -30 }}
            transition={{ duration: 0.3 }}
            style={{
              position: 'fixed', top: '20%', left: '50%', transform: 'translateX(-50%)',
              zIndex: 80, pointerEvents: 'none',
              fontSize: 24, fontWeight: 800, color: '#fbbf24',
              textShadow: '0 0 12px #fbbf2488',
              whiteSpace: 'nowrap',
            }}
          >
            So close! 🎯
          </motion.div>
        )}
      </AnimatePresence>
      {/* Milestone message */}
      <AnimatePresence>
        {milestoneMsg && (
          <motion.div
            key="milestone"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
            style={{
              position: 'fixed', top: '15%', left: '50%', transform: 'translateX(-50%)',
              zIndex: 80, pointerEvents: 'none',
              fontSize: 20, fontWeight: 800, color: '#a855f7',
              textShadow: '0 0 12px #a855f788',
              whiteSpace: 'nowrap',
            }}
          >
            {milestoneMsg}
          </motion.div>
        )}
      </AnimatePresence>
      <style>{`
        @keyframes scorePop {
          0%   { opacity: 0; transform: translateX(-50%) scale(0.6); }
          15%  { opacity: 1; transform: translateX(-50%) scale(1.15); }
          60%  { opacity: 1; transform: translateX(-50%) scale(1); }
          100% { opacity: 0; transform: translateX(-50%) scale(0.9) translateY(-30px); }
        }
      `}</style>
      {gameState==='countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {gameState==='start' && (
        <GameStartScreen
          emoji="🌀"
          iconNode={<Grid3x3 size={80} color={accent} strokeWidth={1.5} />}
          title="Tilt Maze"
          description="Tilt your phone to roll the ball through the maze. Reach the glowing exit before time runs out."
          sensorNote="Uses motion sensors"
          ctaLabel="Enable Motion & Start →"
          accentColor={accent}
          onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #0a0f1a 0%, #060810 55%, #020308 100%)"
        />
      )}
      {gameState==='done' && b && (
        <EndScreen
          gameId="tilt-maze"
          title={b.completionTime ? getProfile(b) : "Time's Up!"}
          emoji={b.completionTime ? '🏆' : '⏰'}
          score={b.completionTime ? `${(b.completionTime/1000).toFixed(1)}s` : 'DNF'}
          personality={getProfile(b)}
          insights={[
            { label:'Wall collisions', value:String(b.collisions), color:accent },
            { label:'Avg correction', value:avg ? `${avg}ms` : 'N/A', color:'#c084fc' },
            { label:'Style', value:getProfile(b), color:'#00ff88' },
            { label:'Result', value:b.completionTime ? `${(b.completionTime/1000).toFixed(1)}s` : 'DNF', color: b.completionTime ? '#00ff88' : '#ef4444' },
          ]}
          accentColor={accent}
          onPlayAgain={handlePlayAgain}
          didWin={!!b.completionTime}
        />
      )}
      {gameState === 'playing' && (
        <>
          <ScorePopEffect pops={pops} accentColor={accent} />
          <StreakBadge streak={0} accentColor={accent} />
        </>
      )}
    </GameShell>
    </>
  );
}
