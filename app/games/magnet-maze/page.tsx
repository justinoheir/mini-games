'use client';
/**
 * MAGNET MAZE
 * Real mechanic: Tilt device (DeviceOrientationEvent gamma/beta) to steer a metal
 * ball through a magnetic maze. Magnets attract the ball — use them wisely or get stuck.
 * Fallback: touch drag if no orientation events fire.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { motion, AnimatePresence } from 'framer-motion';

const GAME_ID = 'magnet-maze';
const ACCENT = '#a78bfa';
const DURATION = 60;
const GAME_EMOJI = '🧲';
const GAME_TITLE = 'Magnet Maze';
const GAME_TAGLINE = 'Tilt to steer. Magnets will try to stop you.';
const PB_KEY = 'mg_pb_magnet-maze';

const GRID = 5;

interface Cell { top: number; right: number; bottom: number; left: number; }
interface Magnet { x: number; y: number; strength: number; polarity: 1 | -1; }

interface Signals { score: number; completionTime: number | null; collisions: number; timedOut: boolean; }

function getPersonality(sig: Signals): string {
  if (sig.completionTime && sig.completionTime < 20000) return 'Magnetic Genius 🧲';
  if (sig.completionTime && sig.completionTime < 35000) return 'Field Navigator 🧭';
  if (sig.completionTime) return 'Persistent Explorer 🔍';
  if (sig.collisions < 8) return 'Careful Crawler 🐢';
  return 'Pinball Wizard 🎰';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

function generateMaze(grid: number): Cell[][] {
  const cells: Cell[][] = Array.from({ length: grid }, () =>
    Array.from({ length: grid }, () => ({ top: 1, right: 1, bottom: 1, left: 1 }))
  );
  const visited = Array.from({ length: grid }, () => new Array<boolean>(grid).fill(false));
  function carve(r: number, c: number) {
    visited[r][c] = true;
    const dirs: [number, number, keyof Cell, keyof Cell][] = (
      [[0, 1, 'right', 'left'], [-1, 0, 'top', 'bottom'], [0, -1, 'left', 'right'], [1, 0, 'bottom', 'top']] as [number, number, keyof Cell, keyof Cell][]
    ).sort(() => Math.random() - 0.5);
    for (const [dr, dc, wall, opp] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < grid && nc >= 0 && nc < grid && !visited[nr][nc]) {
        cells[r][c][wall] = 0; cells[nr][nc][opp] = 0; carve(nr, nc);
      }
    }
  }
  carve(0, 0);
  for (let i = 0; i < grid; i++) {
    cells[0][i].top = 1; cells[grid - 1][i].bottom = 1;
    cells[i][0].left = 1; cells[i][grid - 1].right = 1;
  }
  return cells;
}

function placeMagnets(cells: Cell[][], cs: number, ox: number, oy: number, grid: number): Magnet[] {
  const magnets: Magnet[] = [];
  const positions = [[1, 2], [2, 1], [3, 3], [1, 4], [3, 1]];
  for (const [r, c] of positions) {
    if (r < grid && c < grid) {
      magnets.push({
        x: ox + c * cs + cs / 2,
        y: oy + r * cs + cs / 2,
        strength: 800 + Math.random() * 600,
        polarity: Math.random() > 0.4 ? 1 : -1,
      });
    }
  }
  return magnets;
}

export default function MagnetMazeGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const orientRef = useRef<((e: DeviceOrientationEvent) => void) | null>(null);

  const stateRef = useRef({
    running: false,
    timeLeft: DURATION,
    sig: { score: 0, completionTime: null as number | null, collisions: 0, timedOut: false } as Signals,
    ballX: 0, ballY: 0, velX: 0, velY: 0,
    tiltX: 0, tiltY: 0,
    maze: [] as Cell[][],
    magnets: [] as Magnet[],
    cellSize: 0, offsetX: 0, offsetY: 0,
    startTime: 0,
    wallFlash: 0,
    celebrateUntil: 0,
    touchFallback: false,
    touchX: 0, touchY: 0,
    trail: [] as { x: number; y: number }[],
    accentColor: ACCENT,
    lastCollision: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [useFallback, setUseFallback] = useState(false);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [scorePop, setScorePop] = useState<string | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback((timedOut = false) => {
    const s = stateRef.current;
    if (!s.running) return;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (orientRef.current) { window.removeEventListener('deviceorientation', orientRef.current); orientRef.current = null; }
    if (timedOut) { s.sig.timedOut = true; sfx.gameOver(); haptic([100]); }
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0', 10);
      if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score));
    } catch { /* noop */ }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const W = window.innerWidth, H = window.innerHeight;
    const s = stateRef.current;
    const cs = Math.min(W, H) * 0.145;
    const ox = (W - GRID * cs) / 2;
    const oy = (H - GRID * cs) / 2;
    s.running = true;
    s.timeLeft = DURATION;
    s.sig = { score: 0, completionTime: null, collisions: 0, timedOut: false };
    s.maze = generateMaze(GRID);
    s.magnets = placeMagnets(s.maze, cs, ox, oy, GRID);
    s.cellSize = cs; s.offsetX = ox; s.offsetY = oy;
    s.ballX = ox + cs * 0.5; s.ballY = oy + cs * 0.5;
    s.velX = 0; s.velY = 0; s.tiltX = 0; s.tiltY = 0;
    s.trail = []; s.wallFlash = 0; s.celebrateUntil = 0;
    s.startTime = Date.now();
    s.lastCollision = 0;
    setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('tense');

    // DeviceOrientation
    const oriHandler = (e: DeviceOrientationEvent) => {
      s.tiltX = (e.gamma ?? 0) / 45; // -1..1
      s.tiltY = (e.beta ?? 0) / 45;
    };
    orientRef.current = oriHandler;
    window.addEventListener('deviceorientation', oriHandler);
    // Fallback after 1.5s
    const fallbackTimer = setTimeout(() => {
      if (s.running && Math.abs(s.tiltX) < 0.01 && Math.abs(s.tiltY) < 0.01) {
        s.touchFallback = true;
        setUseFallback(true);
      }
    }, 1500);

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) { sfx.warning(); haptic([50, 30, 50]); }
      else if (s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) { clearTimeout(fallbackTimer); endGame(true); }
    }, 1000);

    const radius = cs * 0.2;
    const exitX = ox + GRID * cs - cs / 2;
    const exitY = oy + GRID * cs - cs / 2;

    const checkWalls = (bx: number, by: number, vx: number, vy: number) => {
      let nvx = vx, nvy = vy, hit = false;
      const col = Math.floor((bx - ox) / cs);
      const row = Math.floor((by - oy) / cs);
      if (row >= 0 && row < GRID && col >= 0 && col < GRID) {
        const w = s.maze[row][col];
        const cx2 = ox + col * cs, cy2 = oy + row * cs;
        if (w.top && by - radius < cy2) { nvy = Math.abs(nvy); hit = true; }
        if (w.bottom && by + radius > cy2 + cs) { nvy = -Math.abs(nvy); hit = true; }
        if (w.left && bx - radius < cx2) { nvx = Math.abs(nvx); hit = true; }
        if (w.right && bx + radius > cx2 + cs) { nvx = -Math.abs(nvx); hit = true; }
      }
      if (bx - radius < ox) { nvx = Math.abs(nvx); hit = true; }
      if (bx + radius > ox + GRID * cs) { nvx = -Math.abs(nvx); hit = true; }
      if (by - radius < oy) { nvy = Math.abs(nvy); hit = true; }
      if (by + radius > oy + GRID * cs) { nvy = -Math.abs(nvy); hit = true; }
      if (hit) {
        const now = Date.now();
        if (now - s.lastCollision > 150) { s.sig.collisions++; sfx.nearMiss(); haptic([20, 30, 20]); s.lastCollision = now; }
        s.wallFlash = now + 160;
      }
      return { nvx, nvy };
    };

    const loop = () => {
      if (!s.running) return;
      const accent = s.accentColor;
      ctx.clearRect(0, 0, W, H);

      // Background
      const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.8);
      bg.addColorStop(0, '#0d0520'); bg.addColorStop(1, '#060210');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      // Wall flash
      if (Date.now() < s.wallFlash) {
        const p = Math.max(0, 1 - (Date.now() - (s.wallFlash - 160)) / 160);
        ctx.fillStyle = `rgba(239,68,68,${p * 0.3})`; ctx.fillRect(0, 0, W, H);
      }

      // Magnetic field gradient aura
      for (const mag of s.magnets) {
        const mGrad = ctx.createRadialGradient(mag.x, mag.y, 0, mag.x, mag.y, cs * 1.2);
        const col = mag.polarity === 1 ? '168,85,247' : '239,68,68';
        mGrad.addColorStop(0, `rgba(${col},0.15)`); mGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = mGrad; ctx.fillRect(0, 0, W, H);
      }

      // Draw maze walls
      ctx.save();
      ctx.strokeStyle = accent; ctx.lineWidth = 2;
      ctx.shadowBlur = 8; ctx.shadowColor = accent + '66';
      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          const x = ox + c * cs, y = oy + r * cs;
          const w = s.maze[r][c];
          const draw = (x1: number, y1: number, x2: number, y2: number) => {
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          };
          if (w.top) draw(x, y, x + cs, y);
          if (w.right) draw(x + cs, y, x + cs, y + cs);
          if (w.bottom) draw(x, y + cs, x + cs, y + cs);
          if (w.left) draw(x, y, x, y + cs);
        }
      }
      ctx.restore();

      // Magnets
      for (const mag of s.magnets) {
        ctx.save();
        const col = mag.polarity === 1 ? '#a855f7' : '#ef4444';
        ctx.shadowBlur = 18; ctx.shadowColor = col;
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(mag.x, mag.y, cs * 0.18, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = col + '33'; ctx.fill();
        ctx.fillStyle = col; ctx.font = `bold ${Math.round(cs * 0.18)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(mag.polarity === 1 ? 'N' : 'S', mag.x, mag.y);
        ctx.restore();
      }

      // Exit portal
      const pr = 14 + Math.sin(Date.now() / 220) * 4;
      ctx.save(); ctx.shadowBlur = 22; ctx.shadowColor = '#00ff88';
      ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(exitX, exitY, pr, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(0,255,136,0.2)'; ctx.fill(); ctx.restore();

      // Ball physics
      let inputX = s.tiltX, inputY = s.tiltY;
      if (s.touchFallback) {
        // Touch drag gives direction from center
        const tcx = s.touchX - s.ballX, tcy = s.touchY - s.ballY;
        const td = Math.hypot(tcx, tcy);
        if (td > 10) { inputX = (tcx / td) * Math.min(1, td / 100); inputY = (tcy / td) * Math.min(1, td / 100); }
        else { inputX = 0; inputY = 0; }
      }
      // Magnet forces
      let magX = 0, magY = 0;
      for (const mag of s.magnets) {
        const dx = mag.x - s.ballX, dy = mag.y - s.ballY;
        const dist = Math.max(20, Math.hypot(dx, dy));
        const force = (mag.polarity * mag.strength) / (dist * dist);
        magX += (dx / dist) * force; magY += (dy / dist) * force;
      }
      s.velX += inputX * 0.45 + magX * 0.002;
      s.velY += inputY * 0.45 + magY * 0.002;
      s.velX *= 0.84; s.velY *= 0.84;
      s.velX = Math.max(-6, Math.min(6, s.velX));
      s.velY = Math.max(-6, Math.min(6, s.velY));
      const { nvx, nvy } = checkWalls(s.ballX + s.velX, s.ballY + s.velY, s.velX, s.velY);
      s.velX = nvx; s.velY = nvy;
      s.ballX += nvx; s.ballY += nvy;

      // Trail
      s.trail.push({ x: s.ballX, y: s.ballY });
      if (s.trail.length > 10) s.trail.shift();
      const [tr, tg, tb] = [168, 139, 250];
      for (let i = 0; i < s.trail.length; i++) {
        ctx.beginPath(); ctx.arc(s.trail[i].x, s.trail[i].y, radius * (0.3 + i / 14), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${tr},${tg},${tb},${(i / s.trail.length) * 0.35})`; ctx.fill();
      }

      // Ball
      const bGrad = ctx.createRadialGradient(s.ballX - radius * 0.3, s.ballY - radius * 0.3, 0, s.ballX, s.ballY, radius);
      bGrad.addColorStop(0, '#ffffff'); bGrad.addColorStop(0.5, accent); bGrad.addColorStop(1, '#5b21b6');
      ctx.save(); ctx.shadowBlur = 24; ctx.shadowColor = accent;
      ctx.beginPath(); ctx.arc(s.ballX, s.ballY, radius, 0, Math.PI * 2); ctx.fillStyle = bGrad; ctx.fill();
      ctx.restore();

      // Check exit
      if (Math.hypot(s.ballX - exitX, s.ballY - exitY) < radius + 18 && s.celebrateUntil === 0) {
        s.sig.completionTime = Date.now() - s.startTime;
        s.sig.score = Math.max(0, Math.round(1000 - s.sig.completionTime / 60));
        sfx.collect(); haptic([40, 20, 60, 20, 80]);
        setScorePop(`${(s.sig.completionTime / 1000).toFixed(1)}s!`);
        setTimeout(() => setScorePop(null), 2000);
        s.celebrateUntil = Date.now() + 900;
      }
      if (s.celebrateUntil > 0 && Date.now() >= s.celebrateUntil) {
        s.celebrateUntil = 0;
        if (s.running) endGame(false);
        return;
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = window.innerWidth * dpr; canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px'; canvas.style.height = window.innerHeight + 'px';
      const ctx = canvas.getContext('2d'); if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const onMove = (e: TouchEvent) => {
      const s = stateRef.current;
      if (!s.running || !s.touchFallback) return;
      const t = e.touches[0]; if (!t) return;
      s.touchX = t.clientX; s.touchY = t.clientY;
    };
    canvas.addEventListener('touchmove', onMove, { passive: true });
    return () => { window.removeEventListener('resize', resize); canvas.removeEventListener('touchmove', onMove); };
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    if (orientRef.current) window.removeEventListener('deviceorientation', orientRef.current);
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio();
    const DO = DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };
    if (typeof DO.requestPermission === 'function') {
      try { await DO.requestPermission(); } catch { stateRef.current.touchFallback = true; setUseFallback(true); }
    }
    setPhase('countdown');
  }, []);

  const handlePlayAgain = useCallback(() => {
    stateRef.current.touchFallback = false;
    setUseFallback(false);
    setPhase('start'); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #0d0520 0%, #060210 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Enable Motion & Start →" accentColor={accent} onStart={handleStart}
          sensorNote="Uses tilt sensor"
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #0d0520 0%, #040110 100%)" />
      )}
      {phase === 'countdown' && <Countdown onComplete={() => startLoop()} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <canvas ref={canvasRef} role="img" aria-label="Magnet Maze game canvas"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <>
          <GameHUD accentColor={accent} items={[
            { label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 10, testId: 'timer' },
          ]} />
          {useFallback && (
            <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', zIndex: 60, color: 'rgba(255,255,255,0.5)', fontSize: 14, whiteSpace: 'nowrap' }}>
              📱 Touch mode active — drag to move
            </div>
          )}
        </>
      )}
      <AnimatePresence>
        {scorePop && (
          <motion.div key="pop" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1.2 }} exit={{ opacity: 0, y: -40 }} transition={{ duration: 0.7 }}
            style={{ position: 'fixed', top: '30%', left: '50%', transform: 'translateX(-50%)', zIndex: 80, pointerEvents: 'none', fontSize: 44, fontWeight: 900, color: '#00ff88', textShadow: '0 0 24px #00ff88' }}>
            {scorePop}
          </motion.div>
        )}
      </AnimatePresence>
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={finalSig.completionTime ? `${(finalSig.completionTime / 1000).toFixed(1)}s` : 'DNF'}
            personality={getPersonality(finalSig)}
            insights={[
              { label: 'Result', value: finalSig.completionTime ? `${(finalSig.completionTime / 1000).toFixed(1)}s` : 'Time out', color: finalSig.completionTime ? '#00ff88' : '#ef4444' },
              { label: 'Wall Hits', value: String(finalSig.collisions), color: finalSig.collisions < 5 ? '#4ade80' : '#facc15' },
              { label: 'Score', value: String(finalSig.score), color: accent },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={!!finalSig.completionTime} finalScore={finalSig.score} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}
