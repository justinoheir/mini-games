'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'laser-guide';
const ACCENT = '#dc2626';
const DURATION = 45;
const GAME_EMOJI = '🔴';
const GAME_TITLE = 'Laser Guide';
const GAME_TAGLINE = 'Reflect the beam. Hit the target.';

interface Mirror { x: number; y: number; angle: number; id: number; dragging: boolean; }
interface LevelConfig { mirrors: Mirror[]; targetX: number; targetY: number; targetR: number; sourceX: number; sourceY: number; sourceAngle: number; }
interface Signals { puzzlesSolved: number; movesUsed: number; perfectSolves: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(sig: Signals): string {
  if (sig.perfectSolves >= 3 && sig.maxStreak >= 3) return 'Laser Wizard 🔴';
  if (sig.puzzlesSolved >= 5) return 'Optics Expert 🔬';
  if (sig.maxStreak >= 3) return 'Reflective Thinker 🪞';
  if (sig.puzzlesSolved >= 2) return 'Getting in Focus 🎯';
  return 'Learning to Reflect 💡';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  level: LevelConfig; mirrors: Mirror[]; hitTarget: boolean; movesThisRound: number;
  accentColor: string; floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  scorePop: number; frame: number; hitFlash: number;
  draggingMirror: number | null; dragOffX: number; dragOffY: number;
}

function reflectDirection(dx: number, dy: number, mirrorAngle: number): { dx: number; dy: number } {
  const nx = Math.cos(mirrorAngle + Math.PI/2);
  const ny = Math.sin(mirrorAngle + Math.PI/2);
  const dot = dx * nx + dy * ny;
  return { dx: dx - 2 * dot * nx, dy: dy - 2 * dot * ny };
}

function castRay(sourceX: number, sourceY: number, dx: number, dy: number, mirrors: Mirror[], W: number, H: number): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [{ x: sourceX, y: sourceY }];
  let cx = sourceX, cy = sourceY, cdx = dx, cdy = dy;
  const MIRROR_LEN = 40;
  for (let bounce = 0; bounce < 10; bounce++) {
    let tMin = 9999, hitMirror: Mirror | null = null, hitT = 0;
    for (const m of mirrors) {
      const mx1 = m.x - Math.cos(m.angle) * MIRROR_LEN;
      const my1 = m.y - Math.sin(m.angle) * MIRROR_LEN;
      const mx2 = m.x + Math.cos(m.angle) * MIRROR_LEN;
      const my2 = m.y + Math.sin(m.angle) * MIRROR_LEN;
      // Ray-segment intersection
      const denom = (mx2-mx1)*cdy - (my2-my1)*cdx;
      if (Math.abs(denom) < 0.0001) continue;
      const t1 = ((cx-mx1)*cdy - (cy-my1)*cdx) / denom;
      const t2 = ((cx-mx1)*(my2-my1) - (cy-my1)*(mx2-mx1)) / denom;
      if (t1 >= 0 && t1 <= 1 && t2 > 0.01 && t2 < tMin) { tMin = t2; hitMirror = m; hitT = t1; }
    }
    // Wall check
    let wallT = 9999;
    if (cdx > 0) wallT = Math.min(wallT, (W - cx) / cdx);
    else if (cdx < 0) wallT = Math.min(wallT, (0 - cx) / cdx);
    if (cdy > 0) wallT = Math.min(wallT, (H - cy) / cdy);
    else if (cdy < 0) wallT = Math.min(wallT, (0 - cy) / cdy);

    if (hitMirror && tMin < wallT) {
      cx += cdx * tMin; cy += cdy * tMin;
      points.push({ x: cx, y: cy });
      const ref = reflectDirection(cdx, cdy, hitMirror.angle);
      cdx = ref.dx; cdy = ref.dy;
    } else {
      cx += cdx * wallT; cy += cdy * wallT;
      points.push({ x: cx, y: cy });
      break;
    }
  }
  return points;
}

export default function LaserGuide() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { puzzlesSolved: 0, movesUsed: 0, perfectSolves: 0, maxStreak: 0, streakCurrent: 0, score: 0 },
    level: { mirrors: [], targetX: 0, targetY: 0, targetR: 25, sourceX: 0, sourceY: 0, sourceAngle: 0 },
    mirrors: [], hitTarget: false, movesThisRound: 0,
    accentColor: ACCENT, floats: [], scorePop: 0, frame: 0, hitFlash: 0,
    draggingMirror: null, dragOffX: 0, dragOffY: 0,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false; cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const generateLevel = useCallback((W: number, H: number, levelNum: number) => {
    const mirrors: Mirror[] = [];
    const count = 2 + Math.min(levelNum, 3);
    for (let i = 0; i < count; i++) {
      mirrors.push({ id: i, x: 80 + Math.random() * (W - 160), y: 100 + Math.random() * (H - 200), angle: Math.random() * Math.PI, dragging: false });
    }
    return { mirrors, targetX: W - 60, targetY: 100 + Math.random() * (H - 200), targetR: 25, sourceX: 30, sourceY: 100 + Math.random() * (H - 200), sourceAngle: Math.random() * 0.5 };
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { puzzlesSolved: 0, movesUsed: 0, perfectSolves: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.level = generateLevel(W, H, 0);
    s.mirrors = s.level.mirrors.map(m => ({ ...m }));
    s.hitTarget = false; s.movesThisRound = 0; s.frame = 0; s.floats = []; s.scorePop = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    timerRef.current = setInterval(() => { s.timeLeft--; setTimeLeft(s.timeLeft); if (s.timeLeft <= 0) { sfx.fail(); endGame(); } }, 1000);

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);
      s.frame++;
      // Background: dark spy room
      ctx.fillStyle = '#030812'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(220,38,38,0.05)'; ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
      for (let gy = 0; gy < H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

      const lvl = s.level;
      const rayPts = castRay(lvl.sourceX, lvl.sourceY, Math.cos(lvl.sourceAngle), Math.sin(lvl.sourceAngle), s.mirrors, W, H);
      const lastPt = rayPts[rayPts.length - 1];
      const hitDist = Math.hypot(lastPt.x - lvl.targetX, lastPt.y - lvl.targetY);
      const isHitting = hitDist < lvl.targetR + 8;

      if (isHitting && !s.hitTarget) {
        s.hitTarget = true;
        s.sig.puzzlesSolved++;
        const isPerfect = s.movesThisRound <= 2;
        if (isPerfect) s.sig.perfectSolves++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
        const pts = (isPerfect ? 5 : 3) * mult;
        s.sig.score += pts;
        s.scorePop = Date.now() + 400;
        setScoreDisplay(s.sig.score);
        sfx.success(); hapticScore();
        s.hitFlash = 40;
        s.floats.push({ x: W/2, y: H*0.3, text: isPerfect ? `+${pts} EFFICIENT! ✨` : `+${pts} Hit!`, alpha: 1, vy: -2, color: '#fbbf24' });
        setTimeout(() => {
          if (s.running) {
            s.level = generateLevel(W, H, s.sig.puzzlesSolved);
            s.mirrors = s.level.mirrors.map(m => ({ ...m }));
            s.hitTarget = false; s.movesThisRound = 0;
          }
        }, 800);
      }

      // Draw laser beam
      ctx.save();
      ctx.strokeStyle = isHitting ? '#ff4444' : '#dc2626';
      ctx.lineWidth = isHitting ? 3 : 2;
      ctx.shadowBlur = isHitting ? 20 : 10;
      ctx.shadowColor = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(rayPts[0].x, rayPts[0].y);
      for (let i = 1; i < rayPts.length; i++) ctx.lineTo(rayPts[i].x, rayPts[i].y);
      ctx.stroke();
      // Laser dots
      rayPts.forEach(pt => {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 4, 0, Math.PI*2); ctx.fill();
      });
      ctx.restore();

      // Source
      ctx.save();
      ctx.shadowBlur = 14; ctx.shadowColor = '#ef4444';
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(lvl.sourceX, lvl.sourceY, 14, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('⚡', lvl.sourceX, lvl.sourceY + 4);
      ctx.restore();

      // Target
      const tPulse = 1 + Math.sin(s.frame * 0.08) * 0.1;
      ctx.save();
      ctx.shadowBlur = isHitting ? 30 : 10;
      ctx.shadowColor = isHitting ? '#fbbf24' : '#dc2626';
      ctx.strokeStyle = isHitting ? '#fbbf24' : '#dc2626';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(lvl.targetX, lvl.targetY, lvl.targetR * tPulse, 0, Math.PI*2); ctx.stroke();
      ctx.fillStyle = (isHitting ? '#fbbf24' : '#dc2626') + '33';
      ctx.beginPath(); ctx.arc(lvl.targetX, lvl.targetY, lvl.targetR * tPulse, 0, Math.PI*2); ctx.fill();
      ctx.restore();

      // Mirrors
      const MIRROR_LEN = 40;
      s.mirrors.forEach(m => {
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.angle);
        ctx.shadowBlur = m.dragging ? 20 : 8;
        ctx.shadowColor = '#38bdf8';
        ctx.strokeStyle = m.dragging ? '#67e8f9' : '#38bdf8';
        ctx.lineWidth = m.dragging ? 6 : 4;
        ctx.beginPath();
        ctx.moveTo(-MIRROR_LEN, 0); ctx.lineTo(MIRROR_LEN, 0);
        ctx.stroke();
        // Handle
        ctx.fillStyle = '#60a5fa';
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      });

      if (s.hitFlash > 0) {
        ctx.fillStyle = `rgba(251,191,36,${s.hitFlash/40*0.2})`; ctx.fillRect(0,0,W,H); s.hitFlash--;
      }
      if (s.scorePop > Date.now()) {
        const t = (s.scorePop - Date.now()) / 400;
        ctx.save(); ctx.globalAlpha = t; ctx.font = `bold ${Math.round(38*(1+(1-t)*0.3))}px sans-serif`;
        ctx.fillStyle = '#fbbf24'; ctx.textAlign = 'center'; ctx.fillText(`${s.sig.score}`, W/2, 90); ctx.restore();
      }
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha; ctx.fillStyle = f.color; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.96;
      });
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, generateLevel]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      for (const m of s.mirrors) {
        if (Math.hypot(m.x - px, m.y - py) < 30) {
          m.dragging = true; s.draggingMirror = m.id;
          s.dragOffX = px - m.x; s.dragOffY = py - m.y;
          break;
        }
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.draggingMirror === null) return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      const m = s.mirrors.find(m => m.id === s.draggingMirror);
      if (m) {
        m.x = px - s.dragOffX; m.y = py - s.dragOffY;
        m.angle += 0.03; // rotate on drag
        s.sig.movesUsed++; s.movesThisRound++;
        s.hitTarget = false;
      }
    };
    const onPointerUp = () => {
      const s = stateRef.current;
      s.mirrors.forEach(m => m.dragging = false);
      s.draggingMirror = null;
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [phase]);

  useEffect(() => () => { cancelAnimationFrame(animRef.current); if (timerRef.current) clearInterval(timerRef.current); }, []);
  const handleStart = useCallback(async (name: string, avatar: string) => { playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); await initAudio(); setPhase('countdown'); }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Drag mirrors to reflect the laser beam into the target!" ctaLabel="Reflect! 🔴" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <><canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Laser reflection puzzle game canvas" />
        {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}</>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Puzzles Solved', value: String(finalSig.puzzlesSolved), color: ACCENT }, { label: 'Efficient Solves', value: String(finalSig.perfectSolves), color: '#fbbf24' }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' }, { label: 'Mirror Moves', value: String(finalSig.movesUsed), color: '#06b6d4' }]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.puzzlesSolved >= 3} />
      )}
    </GameShell>
  );
}
