'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticImpact } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'echo-tap';
const ACCENT = '#06b6d4';
const DURATION = 60;
const GAME_EMOJI = '??';
const GAME_TITLE = 'Echo Tap';
const GAME_TAGLINE = 'Listen. Repeat the pattern.';

const COLORS = ['#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#ec4899'];
const GLOW_COLORS = ['#fca5a5', '#86efac', '#93c5fd', '#fcd34d', '#d8b4fe', '#f9a8d4'];

interface Signals { maxLevel: number; totalRounds: number; mistakes: number; score: number; perfectRounds: number; }
function getPersonality(sig: Signals): string {
  if (sig.maxLevel >= 8 && sig.mistakes <= 2) return 'Echo Master ??';
  if (sig.maxLevel >= 6) return 'Pattern Pro ??';
  if (sig.perfectRounds >= 3) return 'Focused Listener ??';
  if (sig.totalRounds >= 5) return 'Pattern Seeker ??';
  return 'Learning the Echo ??';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
type SubPhase = 'showing' | 'player_turn' | 'success_flash' | 'fail_flash';

interface GState {
  running: boolean; timeLeft: number; sig: Signals; streak: number;
  sequence: number[]; playerInput: number[];
  subPhase: SubPhase; showIndex: number; showAt: number;
  level: number; lit: number | null; mistakeIndex: number | null;
  flashUntil: number; roundMistake: boolean;
}

function EchoTapInner() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animRef = useRef<number>(0);
  const stateRef = useRef<GState>({
    running: false, streak: 0, timeLeft: DURATION,
    sig: { maxLevel: 0, totalRounds: 0, mistakes: 0, score: 0, perfectRounds: 0 },
    sequence: [], playerInput: [], subPhase: 'showing',
    showIndex: 0, showAt: 0, level: 1, lit: null, mistakeIndex: null,
    flashUntil: 0, roundMistake: false,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streak, setStreak] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [displaySubPhase, setDisplaySubPhase] = useState<SubPhase>('showing');
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    cancelAnimationFrame(animRef.current);
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const startSequence = useCallback(() => {
    const s = stateRef.current;
    s.subPhase = 'showing'; s.showIndex = 0;
    s.showAt = Date.now() + 600; s.lit = null; s.playerInput = [];
    setDisplaySubPhase('showing');
  }, []);

  const nextLevel = useCallback(() => {
    const s = stateRef.current;
    s.level++;
    s.sequence.push(Math.floor(Math.random() * 6));
    if (s.level > s.sig.maxLevel) s.sig.maxLevel = s.level;
    startSequence();
  }, [startSequence]);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { maxLevel: 0, totalRounds: 0, mistakes: 0, score: 0, perfectRounds: 0 };
    s.level = 1; s.sequence = [Math.floor(Math.random() * 6)];
    setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setPhase('playing');
    startSequence();

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail?.(); endGame(); }
    }, 1000);

    const SHOW_DURATION = 600;
    const PAUSE_DURATION = 250;

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      if (!s.running) return;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      const dpr = window.devicePixelRatio || 1; const W = canvas.offsetWidth, H = canvas.offsetHeight; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const now = Date.now();

      ctx.fillStyle = '#050510';
      ctx.fillRect(0, 0, W, H);

      // Layout: 2 rows of 3 circles
      const cols = 3, rows = 2;
      const pad = W * 0.06;
      const cellW = (W - pad * 2) / cols;
      const cellH = (H * 0.58) / rows;
      const r = Math.min(cellW, cellH) * 0.38;
      const startY = H * 0.2;

      // Sequence playback logic
      if (s.subPhase === 'showing') {
        if (now >= s.showAt) {
          if (s.lit !== null) {
            // Pause between lights
            s.lit = null;
            s.showAt = now + PAUSE_DURATION;
            s.showIndex++;
          }
          if (s.lit === null && now >= s.showAt) {
            if (s.showIndex < s.sequence.length) {
              s.lit = s.sequence[s.showIndex];
              s.showAt = now + SHOW_DURATION;
              sfx.click?.(); hapticImpact();
            } else {
              // Done showing
              s.subPhase = 'player_turn'; s.lit = null;
              setDisplaySubPhase('player_turn');
            }
          }
        }
      }

      // Draw circles
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const idx = row * cols + col;
          const cx = pad + col * cellW + cellW / 2;
          const cy = startY + row * cellH + cellH / 2;
          const isLit = s.lit === idx ||
            (s.subPhase === 'player_turn' && s.playerInput[s.playerInput.length - 1] === idx && now < s.flashUntil);
          const isMistake = s.mistakeIndex === idx && now < s.flashUntil;

          ctx.save();
          if (isLit && !isMistake) {
            ctx.shadowColor = GLOW_COLORS[idx]; ctx.shadowBlur = 40;
            ctx.fillStyle = COLORS[idx];
            ctx.globalAlpha = 1;
          } else if (isMistake) {
            ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 40;
            ctx.fillStyle = '#ef4444';
            ctx.globalAlpha = 1;
          } else {
            ctx.fillStyle = COLORS[idx];
            ctx.globalAlpha = 0.25;
          }
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
          ctx.restore();

          // Number label
          ctx.save();
          ctx.fillStyle = isLit ? '#ffffff' : 'rgba(255,255,255,0.4)';
          ctx.font = `bold ${Math.round(r * 0.6)}px 'Space Grotesk', Arial, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(idx + 1), cx, cy);
          ctx.restore();
        }
      }

      // Status text
      ctx.save();
      ctx.textAlign = 'center';
      if (s.subPhase === 'showing') {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = `bold ${Math.round(H * 0.03)}px 'Space Grotesk', Arial, sans-serif`;
        ctx.fillText('WATCH THE PATTERN...', W / 2, H * 0.85);
      } else if (s.subPhase === 'player_turn') {
        ctx.fillStyle = '#06b6d4';
        ctx.font = `bold ${Math.round(H * 0.03)}px 'Space Grotesk', Arial, sans-serif`;
        ctx.shadowColor = '#06b6d4'; ctx.shadowBlur = 15;
        ctx.fillText(`REPEAT! (${s.playerInput.length}/${s.sequence.length})`, W / 2, H * 0.85);
      } else if (s.subPhase === 'success_flash') {
        ctx.fillStyle = '#22c55e';
        ctx.font = `bold ${Math.round(H * 0.04)}px 'Space Grotesk', Arial, sans-serif`;
        ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 20;
        ctx.fillText('? PERFECT!', W / 2, H * 0.85);
      } else if (s.subPhase === 'fail_flash') {
        ctx.fillStyle = '#ef4444';
        ctx.font = `bold ${Math.round(H * 0.04)}px 'Space Grotesk', Arial, sans-serif`;
        ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 20;
        ctx.fillText('? WRONG!', W / 2, H * 0.85);
      }
      ctx.restore();

      // Level indicator
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = `${Math.round(H * 0.022)}px 'Space Grotesk', Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`LEVEL ${s.level}`, W / 2, H * 0.93);
      ctx.restore();

      // Flash overlay
      if (s.subPhase === 'success_flash' && now < s.flashUntil) {
        ctx.save(); ctx.globalAlpha = 0.08; ctx.fillStyle = '#22c55e';
        ctx.fillRect(0, 0, W, H); ctx.restore();
      }
      if (s.subPhase === 'fail_flash' && now < s.flashUntil) {
        ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = '#ef4444';
        ctx.fillRect(0, 0, W, H); ctx.restore();
      }

      // Transition back from flash states
      if ((s.subPhase === 'success_flash' || s.subPhase === 'fail_flash') && now > s.flashUntil) {
        if (s.subPhase === 'success_flash') {
          nextLevel();
        } else {
          // Repeat same level
          s.roundMistake = false;
          startSequence();
        }
      }
    };
    draw();
  }, [endGame, startSequence, nextLevel]);

  const handleCircleTap = useCallback((idx: number) => {
    const s = stateRef.current;
    if (!s.running || s.subPhase !== 'player_turn') return;
    s.playerInput.push(idx);
    s.flashUntil = Date.now() + 200;
    sfx.click?.(); hapticImpact();

    const pos = s.playerInput.length - 1;
    if (s.playerInput[pos] !== s.sequence[pos]) {
      // Wrong
      s.streak=0; setStreak(0);
      s.sig.mistakes++;
      s.mistakeIndex = idx;
      s.flashUntil = Date.now() + 600;
      s.subPhase = 'fail_flash';
      setDisplaySubPhase('fail_flash');
      sfx.fail?.(); hapticFail();
    } else if (s.playerInput.length === s.sequence.length) {
      // Complete!
      s.streak=(s.streak||0)+1; setStreak(s.streak);
      const _et=Math.max(1,Math.floor(s.streak/3)+1);
      s.sig.totalRounds++;
      if (!s.roundMistake) s.sig.perfectRounds++;
      s.roundMistake = false;
      const pts = s.level * 10 * _et;
      s.sig.score += pts;
      setScoreDisplay(s.sig.score);
      s.subPhase = 'success_flash';
      s.flashUntil = Date.now() + 800;
      setDisplaySubPhase('success_flash');
      sfx.success?.(); hapticScore();
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || phase !== 'playing') return;
    const resize = () => { const dpr = window.devicePixelRatio || 1; canvas.width = canvas.offsetWidth * dpr; canvas.height = canvas.offsetHeight * dpr; };
    resize();
    window.addEventListener('resize', resize);

    const onTap = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running || s.subPhase !== 'player_turn') return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const dpr = window.devicePixelRatio || 1; const W = canvas.offsetWidth, H = canvas.offsetHeight; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = 3, rows = 2;
      const pad = W * 0.06;
      const cellW = (W - pad * 2) / cols;
      const cellH = (H * 0.58) / rows;
      const startY = H * 0.2;
      const r = Math.min(cellW, cellH) * 0.38;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const idx = row * cols + col;
          const cx = pad + col * cellW + cellW / 2;
          const cy = startY + row * cellH + cellH / 2;
          const dist = Math.hypot(x - cx, y - cy);
          if (dist < r + 10) { handleCircleTap(idx); return; }
        }
      }
    };
    canvas.addEventListener('pointerdown', onTap);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onTap);
    };
  }, [phase, handleCircleTap]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    cancelAnimationFrame(animRef.current);
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="Watch the circles light up in sequence, then repeat the exact pattern. Each round adds one more step!"
          ctaLabel="Listen Up ??" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} role="application" aria-label="Game canvas - tap to interact" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
            {phase === 'playing' && streak >= 3 && (
        <div style={{ position: 'fixed', top: 128, left: '50%', transform: 'translateX(-50%)', zIndex: 25, pointerEvents: 'none', fontSize: 20, fontWeight: 900, color: '#fbbf24', textShadow: '0 0 16px #fbbf2488', letterSpacing: 1, whiteSpace: 'nowrap' }} aria-live="polite" aria-atomic="true">
          ? x{Math.max(1,Math.floor(streak/3)+1)} Streak!
        </div>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Max Level', value: String(finalSig.maxLevel), color: ACCENT },
            { label: 'Rounds', value: String(finalSig.totalRounds), color: '#22c55e' },
            { label: 'Perfect', value: String(finalSig.perfectRounds), color: '#f59e0b' },
            { label: 'Mistakes', value: String(finalSig.mistakes), color: '#ef4444' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.maxLevel >= 5} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const EchoTap = dynamic(() => Promise.resolve({ default: EchoTapInner }), { ssr: false });
export default EchoTap;
