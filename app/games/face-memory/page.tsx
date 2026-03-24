'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'face-memory';
const ACCENT = '#fb7185';
const DURATION = 60;
const GAME_EMOJI = '👤';
const GAME_TITLE = 'Face Memory';
const GAME_TAGLINE = 'Remember who you met. Find them again.';

interface Signals {
  total: number;
  hits: number;
  misses: number;
  falseAlarms: number;
  avgReactionMs: number;
  totalMs: number;
  maxStudyLoad: number;
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.total > 0 ? sig.hits / sig.total : 0;
  if (acc >= 0.88 && sig.falseAlarms === 0) return 'Face Expert 🎭';
  if (sig.maxStudyLoad >= 5) return 'Social Butterfly 🦋';
  if (acc >= 0.8) return 'Good Memory 🧠';
  if (sig.falseAlarms <= 1) return 'Careful Recognizer 👁️';
  return 'Building Memory 📸';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';
type SubPhase = 'study' | 'test';

// Face features for procedural generation
const HAIR_STYLES = [
  (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(cx, cy - r * 0.7, r * 0.7, r * 0.5, 0, Math.PI, 0); ctx.fill();
  },
  (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy - r * 0.6, r * 0.65, Math.PI, 0); ctx.fill();
    ctx.fillRect(cx - r * 0.65, cy - r * 1.0, r * 0.2, r * 0.4);
    ctx.fillRect(cx + r * 0.45, cy - r * 1.0, r * 0.2, r * 0.4);
  },
  (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy - r * 0.5, r * 0.7, Math.PI, 0); ctx.fill();
    for (let i = -3; i <= 3; i++) {
      ctx.fillRect(cx + i * r * 0.15 - r * 0.05, cy - r * 1.15, r * 0.1, r * 0.4);
    }
  },
];

const SKIN_TONES = ['#FDBCB4', '#F1C27D', '#E0AC69', '#C68642', '#8D5524', '#4a2c1a'];
const HAIR_COLORS = ['#1a0a00', '#4a3728', '#8B5E3C', '#D4A017', '#e8c89f', '#c0392b', '#6c3483'];

interface Face {
  id: number;
  skinTone: string;
  hairColor: string;
  hairStyle: number;
  eyeColor: string;
  hasGlasses: boolean;
  hasBeard: boolean;
  eyebrowThick: boolean;
}

function makeFace(id: number): Face {
  return {
    id,
    skinTone: SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)],
    hairColor: HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)],
    hairStyle: Math.floor(Math.random() * HAIR_STYLES.length),
    eyeColor: ['#3b82f6', '#22c55e', '#8b5cf6', '#6b4226', '#64748b'][Math.floor(Math.random() * 5)],
    hasGlasses: Math.random() < 0.35,
    hasBeard: Math.random() < 0.3,
    eyebrowThick: Math.random() < 0.4,
  };
}

function drawFace(ctx: CanvasRenderingContext2D, face: Face, cx: number, cy: number, r: number) {
  ctx.save();

  // Hair (behind head)
  HAIR_STYLES[face.hairStyle](ctx, cx, cy, r, face.hairColor);

  // Head
  ctx.fillStyle = face.skinTone;
  ctx.strokeStyle = face.skinTone === '#FDBCB4' ? '#e8a898' : '#6b3e26';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(cx, cy, r * 0.7, r * 0.85, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  // Eyes
  const eyeOffset = r * 0.25;
  [-1, 1].forEach(side => {
    const ex = cx + side * eyeOffset, ey = cy - r * 0.1;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(ex, ey, r * 0.14, r * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = face.eyeColor; ctx.beginPath(); ctx.arc(ex, ey, r * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(ex, ey, r * 0.04, 0, Math.PI * 2); ctx.fill();
    // Eyebrows
    ctx.strokeStyle = face.hairColor; ctx.lineWidth = face.eyebrowThick ? 2.5 : 1.5;
    ctx.beginPath(); ctx.moveTo(ex - r * 0.14, ey - r * 0.14); ctx.lineTo(ex + r * 0.14, ey - r * 0.18); ctx.stroke();
  });

  // Glasses
  if (face.hasGlasses) {
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 1.5;
    [-1, 1].forEach(side => {
      const ex = cx + side * eyeOffset, ey = cy - r * 0.1;
      ctx.beginPath(); ctx.arc(ex, ey, r * 0.18, 0, Math.PI * 2); ctx.stroke();
    });
    ctx.beginPath(); ctx.moveTo(cx - eyeOffset + r * 0.18, cy - r * 0.1);
    ctx.lineTo(cx + eyeOffset - r * 0.18, cy - r * 0.1); ctx.stroke();
  }

  // Nose
  ctx.strokeStyle = face.skinTone === '#FDBCB4' ? '#d4a090' : '#5a3020';
  ctx.lineWidth = 1.5; ctx.fillStyle = 'transparent';
  ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.05);
  ctx.lineTo(cx - r * 0.08, cy + r * 0.18); ctx.lineTo(cx + r * 0.08, cy + r * 0.18); ctx.stroke();

  // Mouth
  ctx.strokeStyle = '#b04060'; ctx.lineWidth = 2; ctx.fillStyle = 'transparent';
  ctx.beginPath(); ctx.arc(cx, cy + r * 0.32, r * 0.18, 0, Math.PI); ctx.stroke();

  // Beard
  if (face.hasBeard) {
    ctx.fillStyle = face.hairColor + 'aa';
    ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.55, r * 0.4, r * 0.25, 0, 0, Math.PI); ctx.fill();
  }

  ctx.restore();
}

interface GridFace {
  face: Face;
  x: number; y: number;
  isStudied: boolean;
}

interface GameState {
  running: boolean; timeLeft: number;
  sig: Signals; frame: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  subPhase: SubPhase;
  studyFaces: Face[];
  studyIdx: number;       // which study face to show
  studyTimer: number;     // frames to show each face
  gridFaces: GridFace[];
  studyLoad: number;
  selectedGridIdx: number;
  feedback: boolean | null;
  feedbackTimer: number;
  shownAt: number;
}

export default function FaceMemoryGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { total: 0, hits: 0, misses: 0, falseAlarms: 0, avgReactionMs: 0, totalMs: 0, maxStudyLoad: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    frame: 0, accentColor: ACCENT, floats: [],
    subPhase: 'study', studyFaces: [], studyIdx: 0, studyTimer: 100,
    gridFaces: [], studyLoad: 2, selectedGridIdx: -1,
    feedback: null, feedbackTimer: 0, shownAt: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  let faceIdCounter = 0;

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const startStudy = useCallback(() => {
    const s = stateRef.current;
    // Create study faces
    const faces = Array.from({ length: s.studyLoad }, () => makeFace(faceIdCounter++));
    s.studyFaces = faces;
    s.studyIdx = 0;
    s.studyTimer = 90;
    s.subPhase = 'study';
    if (s.studyLoad > s.sig.maxStudyLoad) s.sig.maxStudyLoad = s.studyLoad;
  }, []);

  const startTest = useCallback(() => {
    const s = stateRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width, H = canvas.height;

    // Create grid: some studied, some new
    const gridCount = s.studyLoad + Math.floor(Math.random() * s.studyLoad) + 1;
    const newFaces = Array.from({ length: gridCount - s.studyLoad }, () => makeFace(faceIdCounter++));
    const allFaces = [...s.studyFaces, ...newFaces].sort(() => Math.random() - 0.5);

    const cols = Math.min(3, allFaces.length);
    const rows = Math.ceil(allFaces.length / cols);
    const cellW = Math.min((W - 40) / cols, 100);
    const cellH = Math.min((H * 0.7) / rows, 110);
    const gridX = (W - cols * cellW) / 2;
    const gri = H * 0.2;

    s.gridFaces = allFaces.map((face, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      return {
        face,
        x: gridX + col * cellW + cellW / 2,
        y: gri + row * cellH + cellH / 2,
        isStudied: s.studyFaces.some(sf => sf.id === face.id),
      };
    });
    s.subPhase = 'test';
    s.shownAt = Date.now();
    s.selectedGridIdx = -1;
    s.feedback = null; s.feedbackTimer = 0;
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const pb = parseInt(localStorage.getItem('pb_' + GAME_ID) ?? '0');
    if (s.sig.score > pb) localStorage.setItem('pb_' + GAME_ID, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { total: 0, hits: 0, misses: 0, falseAlarms: 0, avgReactionMs: 0, totalMs: 0, maxStudyLoad: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.frame = 0; s.floats = []; s.studyLoad = 2;
    startStudy();
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      s.frame++;

      if (s.feedbackTimer > 0) s.feedbackTimer--;

      // Background - warm gallery
      ctx.fillStyle = '#140a0c'; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 6; i++) {
        ctx.strokeStyle = 'rgba(251,113,133,0.04)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, i * H / 6); ctx.lineTo(W, i * H / 6); ctx.stroke();
      }

      if (s.feedback !== null && s.feedbackTimer > 0) {
        ctx.fillStyle = s.feedback ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)';
        ctx.fillRect(0, 0, W, H);
      }

      if (s.subPhase === 'study') {
        s.studyTimer--;
        if (s.studyTimer <= 0) {
          s.studyIdx++;
          if (s.studyIdx >= s.studyFaces.length) {
            setTimeout(() => { if (s.running) startTest(); }, 400);
            s.studyTimer = 99999;
          } else {
            s.studyTimer = 90;
          }
        }

        const face = s.studyFaces[Math.min(s.studyIdx, s.studyFaces.length - 1)];
        const faceR = Math.min(W, H) * 0.18;
        const pct = Math.min(1, (90 - s.studyTimer) / 20);

        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`Memorize! (${s.studyIdx + 1}/${s.studyFaces.length})`, W / 2, H * 0.15);

        ctx.save(); ctx.globalAlpha = pct;
        drawFace(ctx, face, W / 2, H * 0.45, faceR);
        ctx.restore();

        // Progress dots
        s.studyFaces.forEach((_, i) => {
          ctx.fillStyle = i <= s.studyIdx ? ACCENT : 'rgba(255,255,255,0.2)';
          const dotX = W / 2 + (i - (s.studyFaces.length - 1) / 2) * 20;
          ctx.beginPath(); ctx.arc(dotX, H * 0.75, 5, 0, Math.PI * 2); ctx.fill();
        });

      } else if (s.subPhase === 'test') {
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`Tap the ${s.studyFaces.length} face${s.studyFaces.length > 1 ? 's' : ''} you saw!`, W / 2, H * 0.1);

        s.gridFaces.forEach((gf, i) => {
          const r = Math.min(35, (canvas.width / (Math.min(3, s.gridFaces.length) + 1)) * 0.4);
          const isSelected = s.selectedGridIdx === i;

          ctx.save();
          if (isSelected) {
            ctx.shadowBlur = 20;
            ctx.shadowColor = gf.isStudied ? '#4ade80' : '#ef4444';
          }
          ctx.strokeStyle = isSelected ? (gf.isStudied ? '#4ade80' : '#ef4444') : 'rgba(255,255,255,0.2)';
          ctx.lineWidth = isSelected ? 3 : 1;
          ctx.beginPath(); ctx.arc(gf.x, gf.y, r + 4, 0, Math.PI * 2);
          ctx.stroke();
          drawFace(ctx, gf.face, gf.x, gf.y, r);
          ctx.restore();
        });
      }

      // Floats
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha;
        ctx.fillStyle = f.color; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.95;
      });

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, startStudy, startTest]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.subPhase !== 'test') return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);

      let hitIdx = -1;
      const r = Math.min(35, (canvas.width / (Math.min(3, s.gridFaces.length) + 1)) * 0.4);
      s.gridFaces.forEach((gf, i) => {
        if (Math.hypot(px - gf.x, py - gf.y) < r + 8) hitIdx = i;
      });

      if (hitIdx < 0) return;
      const ms = Date.now() - s.shownAt;
      s.sig.total++; s.sig.totalMs += ms;
      s.selectedGridIdx = hitIdx;

      if (s.gridFaces[hitIdx].isStudied) {
        s.sig.hits++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const pts = ms < 2000 ? 3 : 2;
        s.sig.score += pts; setScoreDisplay(s.sig.score);
        sfx.collect(); hapticScore();
        if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
        s.feedback = true; s.feedbackTimer = 15;
        s.floats.push({ x: s.gridFaces[hitIdx].x, y: s.gridFaces[hitIdx].y - 40, text: '+' + pts + ' ✓', alpha: 1, vy: -2.5, color: '#fbbf24' });
        s.studyLoad = Math.min(6, 2 + Math.floor(s.sig.hits / 3));
        setTimeout(() => { if (s.running) startStudy(); }, 500);
      } else {
        s.sig.falseAlarms++;
        s.sig.streakCurrent = 0;
        sfx.collision(); hapticFail();
        s.feedback = false; s.feedbackTimer = 15;
        s.floats.push({ x: s.gridFaces[hitIdx].x, y: s.gridFaces[hitIdx].y - 30, text: 'NOT THEM!', alpha: 1, vy: -2, color: '#ef4444' });
        setTimeout(() => { if (s.running) startStudy(); }, 600);
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase, startStudy]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Memorize the faces, then find them in the crowd!" ctaLabel="Meet them! 👤" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Face Memory game canvas" />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Found', value: String(finalSig.hits), color: ACCENT },
            { label: 'False Alarms', value: String(finalSig.falseAlarms), color: finalSig.falseAlarms === 0 ? '#4ade80' : '#ef4444' },
            { label: 'Max Study', value: `${finalSig.maxStudyLoad} faces`, color: '#fbbf24' },
            { label: 'Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.hits >= 8 && finalSig.falseAlarms <= 2} />
      )}
    </GameShell>
  );
}
