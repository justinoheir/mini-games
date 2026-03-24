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

const GAME_ID = 'orbit-launch';
const ACCENT = '#6366f1';
const DURATION = 45;
const GAME_EMOJI = '🚀';
const GAME_TITLE = 'Orbit Launch';
const GAME_TAGLINE = 'Nail the angle. Own the orbit.';

interface Satellite { x: number; y: number; vx: number; vy: number; active: boolean; trail: Array<{ x: number; y: number }>; orbitComplete: boolean; }
interface OrbitalZone { minR: number; maxR: number; color: string; pts: number; label: string; }

interface Signals {
  totalLaunches: number; orbitsAchieved: number; perfectOrbits: number;
  maxStreak: number; streakCurrent: number; score: number; closestApproach: number;
}

function getPersonality(sig: Signals): string {
  if (sig.perfectOrbits >= 3 && sig.maxStreak >= 3) return 'Orbital Maestro 🌌';
  if (sig.orbitsAchieved >= 6) return 'Space Commander 🚀';
  if (sig.maxStreak >= 4) return 'Consistent Launcher 🛸';
  if (sig.orbitsAchieved >= 3) return 'Getting into Orbit 🌙';
  return 'Gravity Student 📚';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  satellite: Satellite; planetX: number; planetY: number; planetR: number;
  zones: OrbitalZone[]; launchX: number; launchY: number;
  pulling: boolean; pullStartX: number; pullStartY: number;
  curPullX: number; curPullY: number;
  accentColor: string; floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  scorePop: number; frame: number; stars: Array<{ x: number; y: number; r: number; twinkle: number }>;
}

export default function OrbitLaunch() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalLaunches: 0, orbitsAchieved: 0, perfectOrbits: 0, maxStreak: 0, streakCurrent: 0, score: 0, closestApproach: 9999 },
    satellite: { x: 0, y: 0, vx: 0, vy: 0, active: false, trail: [], orbitComplete: false },
    planetX: 0, planetY: 0, planetR: 40, zones: [],
    launchX: 0, launchY: 0, pulling: false, pullStartX: 0, pullStartY: 0, curPullX: 0, curPullY: 0,
    accentColor: ACCENT, floats: [], scorePop: 0, frame: 0, stars: [],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
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
    const W = canvas.width, H = canvas.height;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalLaunches: 0, orbitsAchieved: 0, perfectOrbits: 0, maxStreak: 0, streakCurrent: 0, score: 0, closestApproach: 9999 };
    s.planetX = W / 2; s.planetY = H / 2;
    s.planetR = 36;
    s.zones = [
      { minR: 80, maxR: 110, color: '#fbbf24', pts: 5, label: 'PERFECT' },
      { minR: 110, maxR: 150, color: '#10b981', pts: 3, label: 'GOOD' },
      { minR: 150, maxR: 200, color: '#6366f1', pts: 1, label: 'OK' },
    ];
    s.launchX = W * 0.15; s.launchY = H * 0.85;
    s.satellite = { x: s.launchX, y: s.launchY, vx: 0, vy: 0, active: false, trail: [], orbitComplete: false };
    s.pulling = false; s.frame = 0; s.floats = []; s.scorePop = 0;
    s.stars = Array.from({ length: 60 }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 2, twinkle: Math.random() * Math.PI * 2 }));
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const G = 2500; // gravitational constant
    let orbitAngleAccum = 0;
    let prevAngle = 0;
    let orbitCheckActive = false;

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);
      s.frame++;

      // Space background
      ctx.fillStyle = '#030310';
      ctx.fillRect(0, 0, W, H);

      // Stars with twinkling
      s.stars.forEach(star => {
        star.twinkle += 0.04;
        const alpha = 0.3 + Math.sin(star.twinkle) * 0.3;
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.beginPath(); ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2); ctx.fill();
      });

      // Draw orbital zones
      s.zones.forEach(zone => {
        ctx.save();
        ctx.strokeStyle = zone.color + '40';
        ctx.lineWidth = zone.maxR - zone.minR;
        ctx.beginPath();
        ctx.arc(s.planetX, s.planetY, (zone.minR + zone.maxR) / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      });

      // Planet
      const planetGrad = ctx.createRadialGradient(s.planetX - 12, s.planetY - 12, 4, s.planetX, s.planetY, s.planetR);
      planetGrad.addColorStop(0, '#4a90d9');
      planetGrad.addColorStop(0.5, '#2563eb');
      planetGrad.addColorStop(1, '#1e3a5f');
      ctx.save();
      ctx.shadowBlur = 30; ctx.shadowColor = '#3b82f6';
      ctx.fillStyle = planetGrad;
      ctx.beginPath(); ctx.arc(s.planetX, s.planetY, s.planetR, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Atmosphere ring
      ctx.save();
      ctx.strokeStyle = '#93c5fd44';
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(s.planetX, s.planetY, s.planetR + 10, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();

      // Satellite physics
      if (s.satellite.active) {
        const dx = s.planetX - s.satellite.x;
        const dy = s.planetY - s.satellite.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (s.sig.closestApproach > dist) s.sig.closestApproach = dist;

        // Gravity
        const force = G / (dist * dist);
        s.satellite.vx += (dx / dist) * force * 0.016;
        s.satellite.vy += (dy / dist) * force * 0.016;

        s.satellite.x += s.satellite.vx;
        s.satellite.y += s.satellite.vy;

        // Track orbit angle
        const angle = Math.atan2(s.satellite.y - s.planetY, s.satellite.x - s.planetX);
        const dAngle = angle - prevAngle;
        const wrappedDAngle = ((dAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        orbitAngleAccum += wrappedDAngle;
        prevAngle = angle;

        if (orbitCheckActive && Math.abs(orbitAngleAccum) >= Math.PI * 2) {
          // Orbit complete!
          const zone = s.zones.find(z => dist >= z.minR && dist <= z.maxR);
          const pts = zone?.pts ?? 0;
          if (pts > 0) {
            s.sig.orbitsAchieved++;
            if (zone?.label === 'PERFECT') s.sig.perfectOrbits++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
            s.sig.score += pts * mult;
            s.scorePop = Date.now() + 400;
            setScoreDisplay(s.sig.score);
            sfx.success(); hapticScore();
            s.floats.push({ x: W / 2, y: H / 4, text: `+${pts * mult} ${zone?.label || ''} ORBIT! 🌌`, alpha: 1, vy: -1.5, color: zone?.color || ACCENT });
          }
          s.satellite.active = false;
          s.satellite = { x: s.launchX, y: s.launchY, vx: 0, vy: 0, active: false, trail: [], orbitComplete: false };
          orbitAngleAccum = 0;
        }

        // Crash
        if (dist < s.planetR + 8) {
          s.satellite.active = false;
          s.sig.streakCurrent = 0;
          sfx.collision(); hapticFail();
          s.floats.push({ x: W / 2, y: H * 0.4, text: 'CRASH! 💥', alpha: 1, vy: -2, color: '#ef4444' });
          s.satellite = { x: s.launchX, y: s.launchY, vx: 0, vy: 0, active: false, trail: [], orbitComplete: false };
          orbitAngleAccum = 0;
        }

        // Escaped
        if (s.satellite.x < -100 || s.satellite.x > W + 100 || s.satellite.y < -100 || s.satellite.y > H + 100) {
          s.satellite.active = false;
          s.sig.streakCurrent = 0;
          sfx.collision(); hapticFail();
          s.floats.push({ x: W / 2, y: H * 0.4, text: 'Escaped orbit!', alpha: 1, vy: -2, color: '#f97316' });
          s.satellite = { x: s.launchX, y: s.launchY, vx: 0, vy: 0, active: false, trail: [], orbitComplete: false };
          orbitAngleAccum = 0;
        }

        // Trail
        s.satellite.trail.push({ x: s.satellite.x, y: s.satellite.y });
        if (s.satellite.trail.length > 80) s.satellite.trail.shift();

        // Draw trail
        if (s.satellite.trail.length > 2) {
          ctx.save();
          for (let i = 1; i < s.satellite.trail.length; i++) {
            const alpha = i / s.satellite.trail.length * 0.7;
            ctx.strokeStyle = `rgba(99,102,241,${alpha})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(s.satellite.trail[i - 1].x, s.satellite.trail[i - 1].y);
            ctx.lineTo(s.satellite.trail[i].x, s.satellite.trail[i].y);
            ctx.stroke();
          }
          ctx.restore();
        }

        // Draw satellite
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 12; ctx.shadowColor = '#6366f1';
        ctx.translate(s.satellite.x, s.satellite.y);
        ctx.rotate(s.frame * 0.05);
        ctx.fillRect(-8, -3, 16, 6);
        ctx.fillRect(-3, -8, 6, 16);
        ctx.restore();
      } else {
        orbitCheckActive = false;
        // Draw satellite at launch position
        ctx.save();
        ctx.fillStyle = '#aaaaff';
        ctx.shadowBlur = 8; ctx.shadowColor = '#6366f1';
        ctx.translate(s.launchX, s.launchY);
        ctx.fillRect(-8, -3, 16, 6);
        ctx.fillRect(-3, -8, 6, 16);
        ctx.restore();

        // Draw pull indicator
        if (s.pulling) {
          const dx = s.launchX - s.curPullX;
          const dy = s.launchY - s.curPullY;
          const power = Math.min(Math.sqrt(dx * dx + dy * dy) / 80, 1);
          ctx.save();
          ctx.strokeStyle = `rgba(${Math.round(power * 255)},${Math.round((1 - power) * 200)},255,0.6)`;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 4]);
          const vx = (dx / 80) * 6, vy = (dy / 80) * 6;
          ctx.beginPath(); ctx.moveTo(s.launchX, s.launchY);
          let tx = s.launchX, ty = s.launchY, tvx = vx, tvy = vy;
          for (let i = 0; i < 20; i++) {
            const ddx = s.planetX - tx, ddy = s.planetY - ty;
            const d = Math.sqrt(ddx * ddx + ddy * ddy);
            tvx += (ddx / d) * (G / (d * d)) * 0.016;
            tvy += (ddy / d) * (G / (d * d)) * 0.016;
            tx += tvx; ty += tvy;
            ctx.lineTo(tx, ty);
          }
          ctx.stroke(); ctx.setLineDash([]); ctx.restore();
        }
      }

      // Score pop
      if (s.scorePop > Date.now()) {
        const t = (s.scorePop - Date.now()) / 400;
        ctx.save(); ctx.globalAlpha = t;
        ctx.font = `bold ${Math.round(38 * (1 + (1 - t) * 0.3))}px sans-serif`;
        ctx.fillStyle = ACCENT; ctx.textAlign = 'center';
        ctx.fillText(`${s.sig.score}`, W / 2, 80); ctx.restore();
      }

      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha;
        ctx.fillStyle = f.color; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.96;
      });

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.satellite.active) return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      if (Math.hypot(px - s.launchX, py - s.launchY) < 50) {
        s.pulling = true; s.pullStartX = px; s.pullStartY = py;
        s.curPullX = px; s.curPullY = py;
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.pulling) return;
      const rect = canvas.getBoundingClientRect();
      s.curPullX = (e.clientX - rect.left) * (canvas.width / rect.width);
      s.curPullY = (e.clientY - rect.top) * (canvas.height / rect.height);
    };
    const onPointerUp = () => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.pulling) return;
      s.pulling = false;
      const dx = s.launchX - s.curPullX;
      const dy = s.launchY - s.curPullY;
      const power = Math.min(Math.sqrt(dx * dx + dy * dy) / 80, 1);
      if (power > 0.1) {
        s.satellite.x = s.launchX; s.satellite.y = s.launchY;
        s.satellite.vx = (dx / 80) * 6;
        s.satellite.vy = (dy / 80) * 6;
        s.satellite.active = true; s.satellite.trail = [];
        s.sig.totalLaunches++;
        sfx.click(); hapticScore();
      }
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

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Drag the satellite and release to launch it into orbit around the planet!"
          ctaLabel="Launch! 🚀" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
            role="img" aria-label="Orbital launch game canvas" />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
              { label: 'SCORE', value: scoreDisplay },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Orbits', value: String(finalSig.orbitsAchieved), color: ACCENT },
            { label: 'Perfect Orbits', value: String(finalSig.perfectOrbits), color: '#fbbf24' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' },
            { label: 'Launches', value: String(finalSig.totalLaunches), color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.orbitsAchieved >= 3} />
      )}
    </GameShell>
  );
}
