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

const ACCENT = '#22c55e';
const GAME_ID = 'penalty-kick';
const MAX_SHOTS = 10;

interface FloatText { x: number; y: number; text: string; color: string; alpha: number; vy: number; }
interface Signals {
  shots: number; goals: number; cornerShots: number;
  powerSum: number; curveShots: number; postSaveGoals: number;
  lastSavedResult: boolean; adaptCount: number;
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const total = sig.shots || 1;
  const cornerRate = sig.cornerShots / total;
  const powerAvg = sig.powerSum / total;
  const curveRate = sig.curveShots / total;
  if (cornerRate > 0.6 && powerAvg >= 50 && powerAvg <= 80) return '🎯 Composed Finisher';
  if (powerAvg > 80) return '💥 Power Shooter';
  if (curveRate > 0.4) return '🌀 Trickster';
  return '⚽ Striker';
}

export default function PenaltyKick() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tiltRef = useRef<ReturnType<typeof createTiltController> | null>(null);
  const [phase, setPhase] = useState<Phase>('start');
  const [shotsState, setShotsState] = useState(0);
  const [goalsDisplay, setGoalsDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [playerName, setPlayerName]   = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const playerSessionRef              = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false,
    shots: 0,
    goals: 0,
    // Ball
    ballX: 0, ballY: 0, ballVX: 0, ballVY: 0, ballInFlight: false,
    ballRadius: 16,
    // Keeper
    keeperX: 0, keeperY: 0, keeperW: 44, keeperH: 70,
    keeperVX: 0, keeperDiving: false, keeperDiveDir: 0,
    // Goal dimensions
    goalX: 0, goalY: 0, goalW: 0, goalH: 0,
    // Aim reticle
    aimX: 0, aimY: 0, dragging: false, dragStartX: 0, dragStartY: 0, dragStartTime: 0,
    power: 0, charging: false,
    // Curve from tilt
    curveX: 0,
    // Float texts
    floats: [] as FloatText[],
    // Signals
    sig: {
      shots:0, goals:0, cornerShots:0, powerSum:0, curveShots:0,
      postSaveGoals:0, lastSavedResult:false, adaptCount:0
    } as Signals,
    // Result
    resultText: '', resultColor: '', resultTimer: 0,
    phase: 'ready' as 'ready' | 'flying' | 'result',
    keeperFlash: '',
  });

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearTimeout(timerRef.current);
    tiltRef.current?.stop();
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const finalSigSnap = { ...s.sig };
    setFinalSig(finalSigSnap);
    setPhase('done');
    postWebhook(theme, GAME_ID, {
      score: `${finalSigSnap.goals}/${MAX_SHOTS}`,
      personality: getPersonality(finalSigSnap),
      signals: { goals: finalSigSnap.goals, shots: finalSigSnap.shots, cornerShots: finalSigSnap.cornerShots },
    }, playerSessionRef.current);
  }, [theme]);

  const resetRound = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;
    s.ballX = W / 2; s.ballY = H * 0.75;
    s.ballVX = 0; s.ballVY = 0; s.ballInFlight = false;
    s.keeperX = W / 2; s.keeperDiving = false; s.keeperVX = 0;
    s.aimX = W / 2; s.aimY = H * 0.35;
    s.dragging = false; s.charging = false; s.power = 0;
    s.phase = 'ready';
    s.curveX = 0;
    s.resultText = ''; s.resultTimer = 0;
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;

    s.running = true;
    s.shots = 0; s.goals = 0;
    s.sig = { shots:0, goals:0, cornerShots:0, powerSum:0, curveShots:0, postSaveGoals:0, lastSavedResult:false, adaptCount:0 };
    s.floats = [];
    setGoalsDisplay(0);
    setShotsState(0);

    // Goal at top
    s.goalW = W * 0.6; s.goalH = H * 0.18;
    s.goalX = (W - s.goalW) / 2;
    s.goalY = H * 0.08;
    s.keeperY = s.goalY + s.goalH * 0.25;
    s.keeperW = W * 0.1; s.keeperH = H * 0.12;

    resetRound();
    setPhase('playing');
    stopMusicRef.current = startMusic('tense');

    const loop = () => {
      if (!s.running) return;
      // Football pitch — deep grass gradient
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0a1f0a'); bg.addColorStop(1, '#051005');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Grass lines
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 5; i++) {
        ctx.beginPath(); ctx.moveTo(0, H*i/5); ctx.lineTo(W, H*i/5); ctx.stroke();
      }

      // Goal net (grid)
      const gx = s.goalX, gy = s.goalY, gw = s.goalW, gh = s.goalH;
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
      for (let xi = 0; xi <= 8; xi++) {
        const nx = gx + gw*xi/8;
        ctx.beginPath(); ctx.moveTo(nx, gy); ctx.lineTo(nx, gy+gh); ctx.stroke();
      }
      for (let yi = 0; yi <= 5; yi++) {
        const ny = gy + gh*yi/5;
        ctx.beginPath(); ctx.moveTo(gx, ny); ctx.lineTo(gx+gw, ny); ctx.stroke();
      }
      // Goal posts
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(gx, gy+gh); ctx.lineTo(gx, gy); ctx.lineTo(gx+gw, gy); ctx.lineTo(gx+gw, gy+gh);
      ctx.stroke();

      // Keeper
      const kx = s.keeperX, ky = s.keeperY;
      const kw = s.keeperW, kh = s.keeperH;
      if (s.keeperDiving) {
        ctx.save();
        ctx.translate(kx, ky);
        ctx.rotate(s.keeperDiveDir * 0.5);
        ctx.fillStyle = '#84cc16';
        ctx.fillRect(-kw*1.5, -kh/2, kw*3, kh/2);
        ctx.restore();
      } else {
        ctx.fillStyle = '#84cc16';
        ctx.beginPath();
        ctx.roundRect(kx - kw/2, ky - kh, kw, kh, 6);
        ctx.fill();
        // Head
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath(); ctx.arc(kx, ky - kh - 10, 12, 0, Math.PI*2); ctx.fill();
      }
      // Keeper move (before shot)
      if (s.phase === 'ready' && !s.keeperDiving) {
        s.keeperX += Math.sin(Date.now()/900) * 1.5;
        s.keeperX = Math.max(gx + kw/2, Math.min(gx + gw - kw/2, s.keeperX));
      }
      if (s.keeperDiving) {
        s.keeperX += s.keeperVX;
        s.keeperX = Math.max(gx, Math.min(gx + gw, s.keeperX));
      }

      // Ball flight
      if (s.phase === 'flying') {
        s.ballVX += (s.curveX * 0.15);
        s.ballX += s.ballVX;
        s.ballY += s.ballVY;
        const t = (s.ballY - (s.goalY + s.goalH)) / ((H*0.75) - (s.goalY + s.goalH));
        const scale = 0.3 + t * 0.7;
        const br = Math.max(4, s.ballRadius * scale);
        // Ball (simple black/white)
        ctx.save(); ctx.shadowBlur = 8; ctx.shadowColor = '#fff';
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.ballX, s.ballY, br, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#000'; ctx.font = `${br*0.9}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('⬡', s.ballX, s.ballY);
        ctx.restore();

        // Check goal
        if (s.ballY < s.goalY + s.goalH && s.ballY > s.goalY &&
            s.ballX > gx && s.ballX < gx + gw) {
          // Check keeper save
          const keeperLeft = s.keeperX - s.keeperW * (s.keeperDiving ? 1.5 : 0.5);
          const keeperRight = s.keeperX + s.keeperW * (s.keeperDiving ? 1.5 : 0.5);
          const saved = s.ballX > keeperLeft && s.ballX < keeperRight;
          s.phase = 'result';
          s.sig.shots++;
          setShotsState(s.sig.shots);
          s.sig.powerSum += s.power;
          if (Math.abs(s.curveX) > 3) s.sig.curveShots++;

          // Corner check
          const leftThird = gx + gw * 0.25;
          const rightThird = gx + gw * 0.75;
          if (s.aimX < leftThird || s.aimX > rightThird) s.sig.cornerShots++;

          if (saved) {
            s.sig.lastSavedResult = true;
            sfx.collision(); haptic([200]);
            s.resultText = 'SAVED!'; s.resultColor = '#ef4444';
            s.floats.push({ x: W/2, y: H/2, text:'SAVED!', color:'#ef4444', alpha:1, vy:-1.5 });
            if (s.power > 85) sfx.boom();
          } else {
            s.goals++;
            s.sig.goals++;
            s.sig.goals = s.goals;
            setGoalsDisplay(s.goals);
            if (s.sig.lastSavedResult) { s.sig.postSaveGoals++; s.sig.adaptCount++; }
            s.sig.lastSavedResult = false;
            sfx.collect(); sfx.success(); haptic([60, 30, 60]);
            s.resultText = 'GOAL!'; s.resultColor = '#4ade80';
            s.floats.push({ x: W/2, y: H/2, text:'GOAL!', color:'#4ade80', alpha:1, vy:-1.5 });
            if (s.power > 85) sfx.boom();
          }
          s.resultTimer = 90;
          if (s.sig.shots >= MAX_SHOTS) {
            setTimeout(() => endGame(), 1500);
          } else {
            setTimeout(() => resetRound(), 1500);
          }
        }
        // Wide/over
        if (s.ballY < s.goalY - 40 || s.ballX < gx - 40 || s.ballX > gx + gw + 40) {
          if (s.phase === 'flying') {
            s.phase = 'result';
            s.sig.shots++;
            setShotsState(s.sig.shots);
            s.sig.powerSum += s.power;
            sfx.fail(); haptic([150]);
            s.floats.push({ x: W/2, y: H/2, text:'MISS!', color:'#f97316', alpha:1, vy:-1.5 });
            s.resultTimer = 60;
            if (s.sig.shots >= MAX_SHOTS) setTimeout(() => endGame(), 1500);
            else setTimeout(() => resetRound(), 1500);
          }
        }
      }

      // Draw ball (when not flying)
      if (s.phase !== 'flying') {
        const br = s.ballRadius;
        ctx.save(); ctx.shadowBlur = 8; ctx.shadowColor = '#fff';
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.ballX, s.ballY, br, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#000'; ctx.font = `${br*0.9}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('⬡', s.ballX, s.ballY);
        ctx.restore();
      }

      // Aim reticle + curve arc
      if (s.phase === 'ready') {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        // Straight line
        ctx.setLineDash([6,4]);
        ctx.beginPath(); ctx.moveTo(s.ballX, s.ballY); ctx.lineTo(s.aimX, s.aimY); ctx.stroke();
        ctx.setLineDash([]);
        // Reticle
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.aimX, s.aimY, 18, 0, Math.PI*2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s.aimX-22, s.aimY); ctx.lineTo(s.aimX+22, s.aimY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s.aimX, s.aimY-22); ctx.lineTo(s.aimX, s.aimY+22); ctx.stroke();
        ctx.restore();

        // Power bar (right side)
        if (s.charging) {
          const barH = 150;
          const barY = H/2 - barH/2;
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(W - 36, barY, 20, barH);
          const fillH = barH * (s.power / 100);
          const pct = s.power / 100;
          const barColor = pct < 0.5 ? '#4ade80' : pct < 0.8 ? '#fbbf24' : '#ef4444';
          ctx.fillStyle = barColor;
          ctx.fillRect(W - 36, barY + barH - fillH, 20, fillH);
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
          ctx.strokeRect(W - 36, barY, 20, barH);
        }
      }

      // Float texts
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha;
        ctx.fillStyle = f.color; ctx.font = 'bold 42px sans-serif';
        ctx.textAlign = 'center'; ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.97;
      });

      // HUD drawn by DOM overlay GameHUD component

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, resetRound]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const s = stateRef.current;
    if (!s.running || s.phase !== 'ready') return;
    e.preventDefault();
    const t = e.touches[0];
    s.dragStartX = t.clientX; s.dragStartY = t.clientY; s.dragStartTime = Date.now();
    s.dragging = true; s.charging = true; s.power = 0;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const s = stateRef.current;
    if (!s.dragging) return;
    e.preventDefault();
    const t = e.touches[0];
    s.aimX = t.clientX; s.aimY = t.clientY;
    const dt = Date.now() - s.dragStartTime;
    s.power = Math.min(100, dt / 10);
    s.curveX = tiltRef.current?.getValues().x ?? 0;
    s.curveX *= 8;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const s = stateRef.current;
    if (!s.dragging || s.phase !== 'ready') return;
    s.dragging = false; s.charging = false;
    s.phase = 'flying';
    const dx = s.aimX - s.ballX;
    const dy = s.aimY - s.ballY;
    const dist = Math.sqrt(dx*dx+dy*dy);
    const spd = 4 + s.power * 0.12;
    s.ballVX = (dx / dist) * spd;
    s.ballVY = (dy / dist) * spd;
    // Keeper reaction
    const keeperSaveRate = 0.5 + (s.shots * 0.025);
    const reacts = Math.random() < keeperSaveRate;
    if (reacts) {
      const shotDir = dx > 0 ? 1 : -1;
      s.keeperDiving = true;
      s.keeperDiveDir = shotDir;
      s.keeperVX = shotDir * 6;
    }
    sfx.click();
    if (s.power > 85) { sfx.boom(); haptic([200]); }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const onResize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    const onForceEnd = () => { if (stateRef.current.running) endGame(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('game:force-end', onForceEnd);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('game:force-end', onForceEnd);
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearTimeout(timerRef.current);
      tiltRef.current?.stop();
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, [endGame]);

  const handleStart = useCallback(async () => {
    playerSessionRef.current = savePlayerSession(GAME_ID, playerName, playerAvatar);
    await initAudio(); sfx.click();
    const ctrl = createTiltController(() => {}, { sensitivity: 1.0, smoothing: 0.3, deadzone: 3 });
    tiltRef.current = ctrl;
    await ctrl.start();
    setPhase('countdown');
  }, [playerName, playerAvatar]);

  const handlePlayAgain = useCallback(() => {
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    stateRef.current.running = false;
    cancelAnimationFrame(animRef.current);
    tiltRef.current?.stop();
    setPhase('start');
  }, []);

  const sig = finalSig;
  const goals = sig?.goals ?? 0;

  return (
    <GameShell title="Penalty Kick" emoji="⚽" accentColor={ACCENT} theme={theme}>
      <canvas
        ref={canvasRef}
        style={{ display: phase === 'playing' ? 'block' : 'none', position: 'absolute', top: 0, left: 0 }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
      {phase === 'playing' && (
        <GameHUD
          items={[
            { label: 'GOALS', value: goalsDisplay },
            { label: 'SHOTS', value: `${shotsState}/${MAX_SHOTS}` },
          ]}
          accentColor={ACCENT}
        />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={ACCENT} />}
      {phase === 'start' && (
        <GameStartScreen
          emoji="⚽"
          title="Penalty Kick"
          description="Drag to aim, hold to charge power. Tilt for curve. Beat the keeper."
          sensorNote="Uses motion sensors"
          ctaLabel="Start Kicking →"
          accentColor={ACCENT}
          onStart={handleStart}
        >
          <PlayerNameInput
            accentColor={theme.colors.accent ?? ACCENT}
            onReady={(name, avatar) => { setPlayerName(name); setPlayerAvatar(avatar); }}
          />
        </GameStartScreen>
      )}
      {phase === 'done' && sig && (
        <EndScreen
          gameId={GAME_ID}
          title={getPersonality(sig)}
          emoji="⚽"
          score={`${goals}/${MAX_SHOTS}`}
          personality={getPersonality(sig)}
          insights={[
            { label: 'Goals Scored', value: `${goals}`, color: ACCENT },
            { label: 'Avg Power', value: `${sig.shots > 0 ? Math.round(sig.powerSum/sig.shots) : 0}%`, color: '#fbbf24' },
            { label: 'Corner Rate', value: `${sig.shots > 0 ? Math.round(sig.cornerShots/sig.shots*100) : 0}%`, color: '#c084fc' },
            { label: 'Curve Shots', value: `${sig.curveShots}`, color: '#60a5fa' },
          ]}
          accentColor={ACCENT}
          onPlayAgain={handlePlayAgain}
          didWin={goals >= 5}
        />
      )}
    </GameShell>
  );
}
