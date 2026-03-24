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
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID      = 'web-weave';
const ACCENT       = '#64748b';
const DURATION     = 60;
const GAME_EMOJI   = '🕸️';
const GAME_TITLE   = 'Web Weave';
const GAME_TAGLINE = 'Drag between anchors to weave your web. Catch flies!';

interface Anchor { x: number; y: number; id: number; }
interface WebStrand { a: number; b: number; } // anchor ids
interface Fly { x: number; y: number; vx: number; vy: number; id: number; caught: boolean; }

interface Signals {
  strandsWoven: number;
  fliesCaught: number;
  fliesEscaped: number;
  longestChain: number;
  score: number;
  combo: number;
  maxCombo: number;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  anchors: Anchor[];
  strands: WebStrand[];
  flies: Fly[];
  dragging: boolean;
  dragFromId: number;
  dragX: number;
  dragY: number;
  flySpawnTimer: number;
  accentColor: string;
  nextFlyId: number;
  chainLength: number;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const catchRate = (sig.fliesCaught + sig.fliesEscaped) > 0
    ? sig.fliesCaught / (sig.fliesCaught + sig.fliesEscaped) : 0;
  if (sig.strandsWoven >= 20 && catchRate >= 0.6) return 'Master Weaver 🕷️';
  if (catchRate >= 0.7) return 'Patient Hunter 🎯';
  if (sig.strandsWoven >= 25) return 'Speed Spinner 💨';
  if (sig.maxCombo >= 4) return 'Chain Catcher 🔗';
  return 'Casual Spinner 🌀';
}

function lineSegIntersects(ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number): {x:number;y:number} | null {
  const dxAB = bx - ax, dyAB = by - ay;
  const dxCD = dx - cx, dyCD = dy - cy;
  const denom = dxAB * dyCD - dyAB * dxCD;
  if (Math.abs(denom) < 0.001) return null;
  const t = ((cx - ax) * dyCD - (cy - ay) * dxCD) / denom;
  const u = ((cx - ax) * dyAB - (cy - ay) * dxAB) / denom;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return { x: ax + t * dxAB, y: ay + t * dyAB };
  }
  return null;
}

export default function WebWeaveGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { strandsWoven: 0, fliesCaught: 0, fliesEscaped: 0, longestChain: 0, score: 0, combo: 0, maxCombo: 0 },
    anchors: [], strands: [], flies: [],
    dragging: false, dragFromId: -1, dragX: 0, dragY: 0,
    flySpawnTimer: 0, accentColor: ACCENT, nextFlyId: 0, chainLength: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🕸️');
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const spawnAnchors = useCallback((W: number, H: number) => {
    const s = stateRef.current;
    s.anchors = [];
    const positions = [
      [W * 0.5, H * 0.1], [W * 0.85, H * 0.3], [W * 0.75, H * 0.65],
      [W * 0.5, H * 0.8], [W * 0.25, H * 0.65], [W * 0.15, H * 0.3],
      [W * 0.5, H * 0.45], [W * 0.35, H * 0.25], [W * 0.65, H * 0.25],
    ];
    positions.forEach(([x, y], i) => s.anchors.push({ x, y, id: i }));
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { strandsWoven: 0, fliesCaught: 0, fliesEscaped: 0, longestChain: 0, score: 0, combo: 0, maxCombo: 0 };
    s.strands = []; s.flies = []; s.dragging = false; s.flySpawnTimer = 0;
    s.nextFlyId = 0; s.chainLength = 0;
    spawnAnchors(canvas.width, canvas.height);
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('chill');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width; const H = canvas.height;

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, W, H);

      // Spawn flies
      s.flySpawnTimer++;
      if (s.flySpawnTimer > 90) {
        s.flySpawnTimer = 0;
        const edge = Math.floor(Math.random() * 4);
        let fx = 0, fy = 0;
        if (edge === 0) { fx = Math.random() * W; fy = -10; }
        else if (edge === 1) { fx = W + 10; fy = Math.random() * H; }
        else if (edge === 2) { fx = Math.random() * W; fy = H + 10; }
        else { fx = -10; fy = Math.random() * H; }
        const cx = W / 2, cy = H / 2;
        const dist = Math.hypot(cx - fx, cy - fy);
        s.flies.push({ x: fx, y: fy, vx: (cx - fx) / dist * 1.5, vy: (cy - fy) / dist * 1.5,
          id: s.nextFlyId++, caught: false });
      }

      // Draw web strands
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 6; ctx.shadowColor = '#64748b';
      for (const strand of s.strands) {
        const a = s.anchors.find(a => a.id === strand.a);
        const b = s.anchors.find(b => b.id === strand.b);
        if (!a || !b) continue;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // Drag line
      if (s.dragging) {
        const from = s.anchors.find(a => a.id === s.dragFromId);
        if (from) {
          ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = ACCENT; ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(s.dragX, s.dragY); ctx.stroke();
          ctx.setLineDash([]); ctx.restore();
        }
      }

      // Move & check flies
      s.flies = s.flies.filter(f => !f.caught && f.x > -20 && f.x < W + 20 && f.y > -20 && f.y < H + 20);
      for (const fly of s.flies) {
        fly.x += fly.vx; fly.y += fly.vy;
        // Check if fly crosses a strand
        for (const strand of s.strands) {
          const a = s.anchors.find(a => a.id === strand.a);
          const b = s.anchors.find(b => b.id === strand.b);
          if (!a || !b) continue;
          const hit = lineSegIntersects(fly.x - fly.vx, fly.y - fly.vy, fly.x, fly.y, a.x, a.y, b.x, b.y);
          if (hit) {
            fly.caught = true;
            s.sig.fliesCaught++;
            s.sig.combo++;
            if (s.sig.combo > s.sig.maxCombo) s.sig.maxCombo = s.sig.combo;
            const pts = s.sig.combo >= 3 ? 3 : 2;
            s.sig.score += pts;
            setScoreDisplay(s.sig.score);
            sfx.collect(); haptic([30]);
            break;
          }
        }
        if (!fly.caught) {
          ctx.save(); ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('🪰', fly.x, fly.y); ctx.restore();
        }
      }

      // Draw anchors
      for (const anchor of s.anchors) {
        ctx.save();
        ctx.shadowBlur = 12; ctx.shadowColor = ACCENT;
        ctx.fillStyle = ACCENT;
        ctx.beginPath(); ctx.arc(anchor.x, anchor.y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(anchor.x, anchor.y, 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnAnchors]);

  const getAnchorAt = useCallback((x: number, y: number): number => {
    const s = stateRef.current;
    for (const a of s.anchors) {
      if (Math.hypot(a.x - x, a.y - y) < 20) return a.id;
    }
    return -1;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;
      if (stateRef.current.running) spawnAnchors(canvas.width, canvas.height);
    };
    resize(); window.addEventListener('resize', resize);

    const toCanvas = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (clientX - rect.left) * (canvas.width / rect.width),
               y: (clientY - rect.top) * (canvas.height / rect.height) };
    };

    const onDown = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running) return;
      const { x, y } = toCanvas(e.clientX, e.clientY);
      const id = getAnchorAt(x, y);
      if (id >= 0) { s.dragging = true; s.dragFromId = id; s.dragX = x; s.dragY = y; }
    };
    const onMove = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.dragging) return;
      const { x, y } = toCanvas(e.clientX, e.clientY);
      s.dragX = x; s.dragY = y;
    };
    const onUp = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running || !s.dragging) return;
      const { x, y } = toCanvas(e.clientX, e.clientY);
      const toId = getAnchorAt(x, y);
      if (toId >= 0 && toId !== s.dragFromId) {
        const exists = s.strands.some(st => (st.a === s.dragFromId && st.b === toId) || (st.a === toId && st.b === s.dragFromId));
        if (!exists) {
          s.strands.push({ a: s.dragFromId, b: toId });
          s.sig.strandsWoven++;
          sfx.collect(); haptic([20]);
        }
      }
      s.dragging = false;
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
    };
  }, [getAnchorAt, spawnAnchors]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    setPlayerName(name); setPlayerAvatar(avatar);
    initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const buildInsights = (sig: Signals) => [
    { label: 'Flies Caught',  value: `${sig.fliesCaught}`,  color: sig.fliesCaught >= 5 ? '#4ade80' : '#facc15' },
    { label: 'Strands Woven', value: `${sig.strandsWoven}`, color: ACCENT },
    { label: 'Best Combo',    value: `×${sig.maxCombo}`,     color: ACCENT },
    { label: 'Escaped',       value: `${sig.fliesEscaped}`, color: 'var(--color-text)' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Spin the Web" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} role="img" aria-label="Spider web weaving game"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME', value: timeLeft, danger: timeLeft <= 5 },
              { label: 'SCORE', value: scoreDisplay },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain} didWin={finalSig.fliesCaught >= 5} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig}
          personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, gameId, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>; gameId: string; sig: Signals; personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, gameId, { personality, score: sig.score, strandsWoven: sig.strandsWoven,
      fliesCaught: sig.fliesCaught, fliesEscaped: sig.fliesEscaped, maxCombo: sig.maxCombo }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
