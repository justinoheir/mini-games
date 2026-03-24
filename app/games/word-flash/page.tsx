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

const GAME_ID = 'word-flash';
const ACCENT = '#ec4899';
const DURATION = 60;
const GAME_EMOJI = '📚';
const GAME_TITLE = 'Word Flash';
const GAME_TAGLINE = 'Read it. Remember it. Recall it.';

interface Signals {
  total: number;
  hits: number;        // correctly identified seen words
  correctRejections: number; // correctly said NO to unseen words
  falseAlarms: number; // said YES to unseen words (bad)
  misses: number;      // said NO to seen words (bad)
  avgReactionMs: number;
  totalMs: number;
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const hitRate = sig.total > 0 ? (sig.hits + sig.correctRejections) / sig.total : 0;
  if (hitRate >= 0.9 && sig.falseAlarms === 0) return 'Photographic 📸';
  if (sig.hits >= 15) return 'Memory Palace 🏛️';
  if (hitRate >= 0.8) return 'Sharp Recall 📚';
  if (sig.falseAlarms <= 1) return 'Careful Thinker 🧠';
  return 'Still Encoding 💭';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';
type SubPhase = 'flash' | 'probe';

const WORD_POOL = [
  'CLOUD', 'RIVER', 'FLAME', 'STONE', 'LIGHT',
  'STORM', 'GLASS', 'BLADE', 'SWIFT', 'DREAM',
  'FOCUS', 'LASER', 'TOWER', 'SPARK', 'GHOST',
  'EAGLE', 'FROST', 'PEARL', 'SURGE', 'PRISM',
  'BLOOM', 'COMET', 'ORBIT', 'PULSE', 'QUARTZ',
];

interface GameState {
  running: boolean; timeLeft: number;
  sig: Signals; frame: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  subPhase: SubPhase;
  flashWords: string[];    // the words shown in flash phase
  probeWord: string;       // word being tested
  probeIsStudied: boolean; // true if probeWord was in flashWords
  flashIdx: number;        // which word in flash sequence to show
  flashTimer: number;      // frames left to show current flash word
  probeShownAt: number;
  feedback: boolean | null;
  feedbackTimer: number;
  studyLoad: number;       // how many words to memorize (starts 2)
}

export default function WordFlashGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { total: 0, hits: 0, correctRejections: 0, falseAlarms: 0, misses: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    frame: 0, accentColor: ACCENT, floats: [],
    subPhase: 'flash', flashWords: [], probeWord: '', probeIsStudied: false,
    flashIdx: 0, flashTimer: 0, probeShownAt: 0,
    feedback: null, feedbackTimer: 0, studyLoad: 2,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const startFlash = useCallback(() => {
    const s = stateRef.current;
    // Pick studyLoad random words
    const shuffled = WORD_POOL.slice().sort(() => Math.random() - 0.5);
    s.flashWords = shuffled.slice(0, s.studyLoad);
    s.flashIdx = 0;
    s.flashTimer = 60; // ~1 second per word at 60fps
    s.subPhase = 'flash';
  }, []);

  const startProbe = useCallback(() => {
    const s = stateRef.current;
    // 60% chance it's a studied word, 40% unseen
    const isStudied = Math.random() < 0.6;
    if (isStudied) {
      s.probeWord = s.flashWords[Math.floor(Math.random() * s.flashWords.length)];
    } else {
      const unseen = WORD_POOL.filter(w => !s.flashWords.includes(w));
      s.probeWord = unseen[Math.floor(Math.random() * unseen.length)];
    }
    s.probeIsStudied = isStudied;
    s.probeShownAt = Date.now();
    s.feedback = null; s.feedbackTimer = 0;
    s.subPhase = 'probe';
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
    s.sig = { total: 0, hits: 0, correctRejections: 0, falseAlarms: 0, misses: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.frame = 0; s.floats = []; s.studyLoad = 2;
    startFlash();
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

      // Background - library dark pink
      ctx.fillStyle = '#130812'; ctx.fillRect(0, 0, W, H);
      // Subtle book lines
      for (let i = 0; i < 8; i++) {
        ctx.strokeStyle = `rgba(236,72,153,0.04)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const ly = H * 0.1 + i * (H * 0.1);
        ctx.moveTo(0, ly); ctx.lineTo(W, ly); ctx.stroke();
      }

      // Feedback flash
      if (s.feedback !== null && s.feedbackTimer > 0) {
        ctx.fillStyle = s.feedback ? 'rgba(74,222,128,0.12)' : 'rgba(239,68,68,0.12)';
        ctx.fillRect(0, 0, W, H);
      }

      if (s.subPhase === 'flash') {
        s.flashTimer--;
        if (s.flashTimer <= 0) {
          s.flashIdx++;
          if (s.flashIdx >= s.flashWords.length) {
            // All words shown, go to probe
            setTimeout(() => { if (s.running) startProbe(); }, 300);
            s.flashTimer = 99999; // prevent re-trigger
          } else {
            s.flashTimer = 60;
          }
        }

        const wordToShow = s.flashWords[Math.min(s.flashIdx, s.flashWords.length - 1)];
        const pct = s.flashTimer / 60;

        // Flash word
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`Memorize! (${s.flashIdx + 1}/${s.flashWords.length})`, W / 2, H * 0.2);

        ctx.save();
        ctx.globalAlpha = Math.min(1, pct * 2);
        ctx.shadowBlur = 20; ctx.shadowColor = ACCENT;
        ctx.fillStyle = ACCENT;
        ctx.font = `bold ${Math.min(52, W * 0.13)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(wordToShow, W / 2, H / 2);
        ctx.restore();

        // Progress dots
        s.flashWords.forEach((_, i) => {
          const dotX = W / 2 + (i - (s.flashWords.length - 1) / 2) * 20;
          ctx.fillStyle = i <= s.flashIdx ? ACCENT : 'rgba(255,255,255,0.2)';
          ctx.beginPath(); ctx.arc(dotX, H * 0.65, 5, 0, Math.PI * 2); ctx.fill();
        });

      } else if (s.subPhase === 'probe') {
        // Show probe word
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('Was this word in the list?', W / 2, H * 0.2);

        ctx.save();
        ctx.shadowBlur = s.feedback === null ? 16 : 0;
        ctx.shadowColor = ACCENT;
        ctx.fillStyle = s.feedback === null ? '#ffffff' : (s.feedback ? '#4ade80' : '#ef4444');
        ctx.font = `bold ${Math.min(52, W * 0.13)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(s.probeWord, W / 2, H * 0.42);
        ctx.restore();

        // YES / NO buttons
        const btnW = Math.min((W - 60) / 2, 130);
        const btnH = 56;
        const btnY = H * 0.58;

        // YES button
        const yesX = W / 2 - btnW - 10;
        ctx.save();
        ctx.shadowBlur = 12; ctx.shadowColor = '#4ade80';
        ctx.fillStyle = s.feedback === true ? (s.probeIsStudied ? 'rgba(74,222,128,0.4)' : 'rgba(239,68,68,0.4)') : 'rgba(74,222,128,0.1)';
        ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2.5;
        ctx.beginPath(); (ctx as any).roundRect?.(yesX, btnY, btnW, btnH, 10) ?? ctx.rect(yesX, btnY, btnW, btnH);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('✓ YES', yesX + btnW / 2, btnY + 37);
        ctx.restore();

        // NO button
        const noX = W / 2 + 10;
        ctx.save();
        ctx.shadowBlur = 12; ctx.shadowColor = '#ef4444';
        ctx.fillStyle = s.feedback === false ? (!s.probeIsStudied ? 'rgba(74,222,128,0.4)' : 'rgba(239,68,68,0.4)') : 'rgba(239,68,68,0.1)';
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2.5;
        ctx.beginPath(); (ctx as any).roundRect?.(noX, btnY, btnW, btnH, 10) ?? ctx.rect(noX, btnY, btnW, btnH);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('✗ NO', noX + btnW / 2, btnY + 37);
        ctx.restore();

        // Reaction bar
        const elapsed = (Date.now() - s.probeShownAt) / 1000;
        const limit = 4;
        const pct = Math.max(0, 1 - elapsed / limit);
        ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(20, H * 0.74, W - 40, 4);
        ctx.fillStyle = pct > 0.5 ? ACCENT : pct > 0.25 ? '#fbbf24' : '#ef4444';
        ctx.fillRect(20, H * 0.74, (W - 40) * pct, 4);

        if (elapsed > limit && s.feedback === null) {
          // Timeout counts as miss or false alarm
          const ms = Date.now() - s.probeShownAt;
          s.sig.total++; s.sig.totalMs += ms;
          s.sig.misses++; s.sig.streakCurrent = 0;
          sfx.collision(); hapticFail();
          s.feedback = false; s.feedbackTimer = 15;
          setTimeout(() => { if (s.running) startFlash(); }, 600);
        }
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
  }, [endGame, startFlash, startProbe]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.subPhase !== 'probe' || s.feedback !== null) return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      const W = canvas.width, H = canvas.height;
      const btnW = Math.min((W - 60) / 2, 130);
      const btnH = 56, btnY = H * 0.58;
      const yesX = W / 2 - btnW - 10, noX = W / 2 + 10;

      const ms = Date.now() - s.probeShownAt;
      s.sig.total++; s.sig.totalMs += ms;

      let playerSaies = false;
      if (px >= yesX && px <= yesX + btnW && py >= btnY && py <= btnY + btnH) playerSaies = true;
      else if (px >= noX && px <= noX + btnW && py >= btnY && py <= btnY + btnH) playerSaies = false;
      else return;

      const correct = (playerSaies && s.probeIsStudied) || (!playerSaies && !s.probeIsStudied);
      s.feedback = playerSaies;
      s.feedbackTimer = 15;

      if (correct) {
        if (playerSaies) s.sig.hits++;
        else s.sig.correctRejections++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const speedPts = ms < 1000 ? 3 : ms < 2000 ? 2 : 1;
        s.sig.score += speedPts; setScoreDisplay(s.sig.score);
        s.studyLoad = Math.min(5, 2 + Math.floor(s.sig.hits / 5));
        sfx.collect(); hapticScore();
        if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
        s.floats.push({ x: W / 2, y: H * 0.52, text: `+${speedPts} ✓`, alpha: 1, vy: -2.5, color: '#fbbf24' });
      } else {
        if (playerSaies) s.sig.falseAlarms++;
        else s.sig.misses++;
        s.sig.streakCurrent = 0;
        sfx.collision(); hapticFail();
        s.floats.push({ x: W / 2, y: H * 0.52, text: playerSaies ? 'FALSE ALARM!' : 'MISSED IT!', alpha: 1, vy: -2, color: '#ef4444' });
      }
      setTimeout(() => { if (s.running) startFlash(); }, 550);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase, startFlash]);

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
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Memorize flashed words, then say YES or NO to each probe!" ctaLabel="Memorize! 📚" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Word Flash memory game canvas" />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Hits', value: String(finalSig.hits), color: ACCENT },
            { label: 'False Alarms', value: String(finalSig.falseAlarms), color: finalSig.falseAlarms === 0 ? '#4ade80' : '#ef4444' },
            { label: 'Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
            { label: 'Avg Speed', value: `${finalSig.total > 0 ? Math.round(finalSig.totalMs / finalSig.total) : 0}ms`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.hits >= 10 && finalSig.falseAlarms <= 2} />
      )}
    </GameShell>
  );
}
