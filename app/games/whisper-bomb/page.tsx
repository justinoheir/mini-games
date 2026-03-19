'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic } from 'lucide-react';
import GameShell from '@/components/GameShell';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import { initAudio, sfx, haptic, startMusic, increaseMusicTempo, playScoreHit, playVictoryFanfare, playNearMiss, playPersonalBest } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'whisper-bomb';
const GAME_ACCENT = '#ef4444';
const PB_KEY = 'pb_whisper-bomb';

type GameState = 'start' | 'requesting' | 'countdown' | 'playing' | 'done';
interface BehaviorData {
  avgVolume: number;
  noiseSpikes: number;
  dangerSeconds: number;
  defused: boolean;
  fuseRemaining: number;
}

function getProfile(b: BehaviorData) {
  if (b.defused && b.noiseSpikes < 3) return 'Calm 🧘';
  if (b.noiseSpikes > 10) return 'Explosive 💥';
  return 'Reactive ⚡';
}

export default function WhisperBomb() {
  const theme = useBrandTheme();
  const accent = theme.id !== 'ether' ? theme.colors.accent : GAME_ACCENT;

  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef({
    fuse: 100, timeLeft: 30,
    volumeSamples: [] as number[],
    noiseSpikes: 0, dangerFrames: 0, quietStreak: 0,
    animId: 0, timerIntervalId: null as ReturnType<typeof setInterval> | null,
    stream: null as MediaStream | null,
    analyser: null as AnalyserNode | null,
    audioCtx: null as AudioContext | null,
    running: false, musicSped: false,
    lastSpikeTime: 0,
    lastSpikeCountTime: 0,
    ambientBaseline: 0,
  });

  // ── DOM refs for 60fps updates ─────────────────────────────────────────────
  const playAreaRef          = useRef<HTMLDivElement>(null);
  const bombContainerRef     = useRef<HTMLDivElement>(null);
  const bombFuseRef          = useRef<HTMLDivElement>(null);
  const fuseBarFillRef       = useRef<HTMLDivElement>(null);
  const fusePercentTextRef   = useRef<HTMLSpanElement>(null);
  const volumeBarFillRef     = useRef<HTMLDivElement>(null);
  const volumeValueTextRef   = useRef<HTMLSpanElement>(null);
  const flashRef             = useRef<HTMLDivElement>(null);
  const flashTimeoutRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const instructionTextRef   = useRef<HTMLParagraphElement>(null);
  const defuseContainerRef   = useRef<HTMLDivElement>(null);
  const defuseBarFillRef     = useRef<HTMLDivElement>(null);
  const defuseBarTextRef     = useRef<HTMLSpanElement>(null);

  // ── Milestone/overlay refs ─────────────────────────────────────────────────
  const lastStreakMilestoneRef = useRef(0);
  const nearMissShownRef       = useRef(false);
  const nearMissTimeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimeoutRef       = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── React state ────────────────────────────────────────────────────────────
  const [gameState, setGameState]       = useState<GameState>('start');
  const [displayTime, setDisplayTime]   = useState(30);
  const [behavior, setBehavior]         = useState<BehaviorData | null>(null);
  const [micError, setMicError]         = useState(false);
  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  // ── Polish state ───────────────────────────────────────────────────────────
  const [scorePop, setScorePop]         = useState<{ value: number; key: number } | null>(null);
  const [streakDisplay, setStreakDisplay] = useState(0);
  const [personalBest, setPersonalBest] = useState<number | null>(null);
  const [isNewPB, setIsNewPB]           = useState(false);
  const [nearMiss, setNearMiss]         = useState(false);
  const [copied, setCopied]             = useState(false);

  // Load PB on mount
  useEffect(() => {
    const saved = localStorage.getItem(PB_KEY);
    if (saved) setPersonalBest(Number(saved));
  }, []);

  const getVolume = useCallback((): number => {
    const s = stateRef.current;
    if (!s.analyser) return 0;
    const data = new Uint8Array(s.analyser.frequencyBinCount);
    s.analyser.getByteFrequencyData(data);
    const sumSq = data.reduce((acc, v) => acc + v * v, 0);
    const raw = Math.min(100, (Math.sqrt(sumSq / data.length) / 128) * 100);
    return Math.max(0, raw - s.ambientBaseline);
  }, []);

  const endGame = useCallback((defused: boolean, capturedTheme: typeof theme) => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.timerIntervalId) clearInterval(s.timerIntervalId);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {});
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }

    const avgVol = s.volumeSamples.length > 0
      ? s.volumeSamples.reduce((a, v) => a + v, 0) / s.volumeSamples.length
      : 0;
    const bData: BehaviorData = {
      avgVolume: Math.round(avgVol),
      noiseSpikes: s.noiseSpikes,
      dangerSeconds: Math.round(s.dangerFrames / 60),
      defused,
      fuseRemaining: Math.max(0, Math.round(s.fuse)),
    };

    // Personal best check
    const score = defused ? bData.fuseRemaining : 0;
    const savedPB = localStorage.getItem(PB_KEY);
    const prevPB = savedPB !== null ? Number(savedPB) : null;
    const newPB = prevPB === null || score > prevPB;
    if (newPB && score > 0) {
      localStorage.setItem(PB_KEY, String(score));
      setPersonalBest(score);
      setIsNewPB(true);
      playPersonalBest();
      hapticVictory();
    } else {
      setIsNewPB(false);
      if (defused) {
        playVictoryFanfare();
        hapticVictory();
      } else {
        hapticFail();
      }
    }

    // Reset overlay states
    setStreakDisplay(0);
    setNearMiss(false);
    lastStreakMilestoneRef.current = 0;
    nearMissShownRef.current = false;

    setBehavior(bData);
    setGameState('done');
    postWebhook(capturedTheme, 'whisper-bomb', {
      score: defused ? `${bData.fuseRemaining}%` : '0%',
      personality: getProfile(bData),
      signals: { noiseSpikes: bData.noiseSpikes, avgVolume: bData.avgVolume, fuseRemaining: bData.fuseRemaining },
    }, playerSessionRef.current);
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.fuse = 100; s.timeLeft = 30; s.volumeSamples = []; s.noiseSpikes = 0;
    s.dangerFrames = 0; s.quietStreak = 0; s.running = true; s.musicSped = false;
    s.lastSpikeCountTime = 0;
    setDisplayTime(30);
    setScorePop(null);
    setStreakDisplay(0);
    setNearMiss(false);
    lastStreakMilestoneRef.current = 0;
    nearMissShownRef.current = false;
    setGameState('playing');
    stopMusicRef.current = startMusic('pulse');
    const capturedTheme = theme;

    s.timerIntervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--;
      setDisplayTime(s.timeLeft);
      sfx.tick();
      if (s.timeLeft === 15 && !s.musicSped) {
        s.musicSped = true;
        try { increaseMusicTempo(130); } catch { /* ignore in test env */ }
      }
      if (s.timeLeft === 8) {
        try { increaseMusicTempo(160); } catch { /* ignore in test env */ }
        sfx.warning();
      }
      if (s.timeLeft <= 0) { sfx.boom(); hapticFail(); endGame(false, capturedTheme); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const vol = getVolume();
      s.volumeSamples.push(vol);

      const fuse      = s.fuse;
      const fuseColor = fuse > 60 ? '#00ff88' : fuse > 30 ? '#ffaa00' : '#ef4444';
      const volColor  = vol > 25  ? '#ef4444'  : vol > 8   ? '#ffaa00' : '#00ff88';
      const bombScale = 1 + (vol / 200);
      const bgR       = Math.min(30, 10 + Math.round(vol * 0.5));

      if (bombContainerRef.current)
        bombContainerRef.current.style.transform = `scale(${bombScale})`;
      if (bombFuseRef.current) {
        bombFuseRef.current.style.height = `${Math.max(0, fuse) * 0.55}px`;
        bombFuseRef.current.style.backgroundColor = fuseColor;
      }
      if (fuseBarFillRef.current) {
        fuseBarFillRef.current.style.width = `${Math.max(0, fuse)}%`;
        fuseBarFillRef.current.style.backgroundColor = fuseColor;
      }
      if (fusePercentTextRef.current) {
        fusePercentTextRef.current.textContent = `${Math.round(Math.max(0, fuse))}%`;
        fusePercentTextRef.current.style.color = fuseColor;
      }
      if (volumeBarFillRef.current) {
        volumeBarFillRef.current.style.width = `${vol}%`;
        volumeBarFillRef.current.style.backgroundColor = volColor;
      }
      if (volumeValueTextRef.current) {
        volumeValueTextRef.current.textContent = `${Math.round(vol)}`;
        volumeValueTextRef.current.style.color = volColor;
      }
      if (playAreaRef.current)
        playAreaRef.current.style.background =
          `radial-gradient(ellipse at center, rgba(${bgR * 3},5,5,1) 0%, rgba(${bgR},3,3,1) 40%, #000 100%)`;
      if (instructionTextRef.current)
        instructionTextRef.current.textContent =
          fuse < 25 ? 'STAY SILENT — DEFUSING...' : 'Keep quiet to slow the fuse';

      if (defuseContainerRef.current)
        defuseContainerRef.current.style.display = fuse < 25 ? 'block' : 'none';
      if (fuse < 25) {
        const defuseProgress = Math.min(100, (s.quietStreak / 5) * 100);
        if (defuseBarFillRef.current)
          defuseBarFillRef.current.style.width = `${defuseProgress}%`;
        if (defuseBarTextRef.current)
          defuseBarTextRef.current.textContent = `${Math.ceil(5 - s.quietStreak)}s`;
      }

      // ── Fuse logic ────────────────────────────────────────────────────────
      if (vol > 25) {
        const now = Date.now();
        if (now - s.lastSpikeCountTime >= 500) {
          s.noiseSpikes++;
          s.lastSpikeCountTime = now;
        }
        s.fuse -= 5 / 60;
        s.dangerFrames++;
        s.quietStreak = 0;
        // Reset streak display when they make noise
        if (lastStreakMilestoneRef.current > 0) {
          lastStreakMilestoneRef.current = 0;
          setStreakDisplay(0);
        }
        if (now - s.lastSpikeTime > 400) {
          sfx.whoosh(); haptic([30]); s.lastSpikeTime = now;
          if (flashRef.current) {
            flashRef.current.style.backgroundColor = 'rgba(255,68,68,0.3)';
            if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
            flashTimeoutRef.current = setTimeout(() => {
              if (flashRef.current) flashRef.current.style.backgroundColor = 'transparent';
            }, 120);
          }
        }
      } else if (vol < 8) {
        s.fuse = Math.min(100, s.fuse + 1 / 60);
        s.quietStreak += 1 / 60;
        // Score pop every whole second of quiet streak
        const streakSecs = Math.floor(s.quietStreak);
        if (streakSecs > lastStreakMilestoneRef.current && streakSecs > 0) {
          lastStreakMilestoneRef.current = streakSecs;
          setScorePop({ value: streakSecs, key: Date.now() });
          setStreakDisplay(streakSecs);
          hapticScore();
          playScoreHit('default', 10);
        }
      } else {
        s.fuse -= 2 / 60;
        s.quietStreak = 0;
        if (lastStreakMilestoneRef.current > 0) {
          lastStreakMilestoneRef.current = 0;
          setStreakDisplay(0);
        }
      }

      // ── Near-miss: fuse enters 25-35% zone for the first time ─────────────
      if (fuse < 35 && fuse >= 25 && !nearMissShownRef.current) {
        nearMissShownRef.current = true;
        setNearMiss(true);
        playNearMiss();
        if (nearMissTimeoutRef.current) clearTimeout(nearMissTimeoutRef.current);
        nearMissTimeoutRef.current = setTimeout(() => setNearMiss(false), 2000);
      }
      if (fuse >= 35) nearMissShownRef.current = false;

      if (s.fuse < 25 && s.quietStreak >= 5) {
        sfx.defuse(); haptic([30, 50, 30, 50, 100]); endGame(true, capturedTheme); return;
      }
      if (s.fuse <= 0) {
        sfx.boom(); hapticFail(); endGame(false, capturedTheme); return;
      }
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [getVolume, endGame, theme]);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); sfx.click();
    setMicError(false);
    setGameState('requesting');
    try {
      if ((window as unknown as Record<string, unknown>).__DISABLE_AUDIO) { setGameState('countdown'); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      const s = stateRef.current;
      s.stream = stream; s.analyser = analyser; s.audioCtx = audioCtx;

      const calibData = new Uint8Array(analyser.frequencyBinCount);
      const calibSamples: number[] = [];
      for (let i = 0; i < 10; i++) {
        await new Promise<void>(r => setTimeout(r, 100));
        analyser.getByteFrequencyData(calibData);
        const rms = Math.sqrt(calibData.reduce((acc, v) => acc + v * v, 0) / calibData.length);
        calibSamples.push((rms / 128) * 100);
      }
      s.ambientBaseline = Math.min(
        calibSamples.reduce((a, b) => a + b, 0) / calibSamples.length,
        20
      );
      setGameState('countdown');
    } catch {
      setMicError(true);
      setGameState('start');
    }
  }, []);

  const handlePlayAgain = useCallback(() => {
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (flashTimeoutRef.current) { clearTimeout(flashTimeoutRef.current); flashTimeoutRef.current = null; }
    setIsNewPB(false);
    setGameState('start');
  }, []);

  const handleShare = useCallback(async () => {
    if (!behavior) return;
    const score = behavior.defused ? `${behavior.fuseRemaining}% fuse remaining` : 'BOOM 💥';
    const text = `I ${behavior.defused ? 'defused' : 'blew up'} the Whisper Bomb — ${score}! Can you stay quieter? 💣\nhttps://mini-games-green.vercel.app/games/whisper-bomb`;
    try {
      await navigator.share({ text });
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
        copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
      } catch { /* ignore */ }
    }
  }, [behavior]);

  useEffect(() => () => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.timerIntervalId) clearInterval(s.timerIntervalId);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    if (nearMissTimeoutRef.current) clearTimeout(nearMissTimeoutRef.current);
    if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {});
    if (stopMusicRef.current) stopMusicRef.current();
  }, []);

  return (
    <GameShell title="Whisper Bomb" emoji="💣" accentColor={accent} theme={theme}>
      {/* Flash overlay */}
      <div
        ref={flashRef}
        style={{ position: 'absolute', inset: 0, backgroundColor: 'transparent', pointerEvents: 'none', zIndex: 100 }}
      />

      <AnimatePresence mode="wait">
        {gameState === 'countdown' && (
          <motion.div
            key="countdown"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ position: 'absolute', inset: 0 }}
          >
            <Countdown onComplete={startLoop} accentColor={accent} />
          </motion.div>
        )}

        {gameState === 'start' && (
          <motion.div
            key="start"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.25 }}
            style={{ position: 'absolute', inset: 0 }}
          >
            <GameStartScreen
              emoji="💣"
              title="Whisper Bomb"
              description="Stay silent to slow the fuse. Hold quiet for 5 seconds at the end to defuse."
              sensorNote="Uses microphone"
              ctaLabel="Allow Mic & Start →"
              accentColor={accent}
              ctaTextColor="#fff"
              onStart={handleStart}
            >
              {micError && (
                <div style={{
                  marginTop: 12, padding: '10px 14px',
                  background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)',
                  borderRadius: 10, color: '#ef4444', fontSize: 14, textAlign: 'center',
                }}>
                  Microphone access needed. Please allow and try again.
                </div>
              )}
            </GameStartScreen>
          </motion.div>
        )}

        {gameState === 'requesting' && (
          <motion.div
            key="requesting"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--color-text-secondary)', position: 'absolute', inset: 0 }}
          >
            <Mic size={40} color="rgba(255,255,255,0.7)" />
            <div style={{ fontSize: 16, fontWeight: 600 }}>Calibrating microphone…</div>
            <div style={{ fontSize: 14, color: '#555', maxWidth: 220, textAlign: 'center', lineHeight: 1.5 }}>
              Measuring ambient noise level. Keep quiet for a moment.
            </div>
          </motion.div>
        )}

        {gameState === 'playing' && (
          <motion.div
            key="playing"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ position: 'absolute', inset: 0 }}
          >
            <div
              ref={playAreaRef}
              style={{
                position: 'relative', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', height: '100%',
                gap: 24, padding: '80px 24px 24px',
                background: 'radial-gradient(ellipse at center, rgba(30,5,5,1) 0%, rgba(10,3,3,1) 40%, #000 100%)',
              }}
            >
              {/* Timer */}
              <div style={{
                position: 'absolute', top: 52, right: 20,
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontSize: 40, fontWeight: displayTime <= 10 ? 900 : 700,
                color: displayTime <= 10 ? '#ef4444' : '#888',
                letterSpacing: '0.03em', lineHeight: 1,
                transition: 'color 0.3s',
              }}>
                {displayTime}s
              </div>

              {/* Streak badge */}
              <AnimatePresence>
                {streakDisplay >= 3 && (
                  <motion.div
                    key={`streak-${streakDisplay}`}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1 + streakDisplay * 0.04, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                    style={{
                      position: 'absolute', top: 52, left: 20,
                      background: 'rgba(255,170,0,0.15)', border: '1px solid rgba(255,170,0,0.5)',
                      borderRadius: 20, padding: '6px 12px',
                      fontSize: 18, fontWeight: 800, color: '#ffaa00',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    🔥 x{streakDisplay}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Score pop overlay */}
              <AnimatePresence>
                {scorePop && (
                  <motion.div
                    key={scorePop.key}
                    initial={{ scale: 1, y: 0, opacity: 1 }}
                    animate={{ scale: 1.5, y: -40, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.7, ease: 'easeOut' }}
                    style={{
                      position: 'absolute', top: '38%', left: '50%', transform: 'translateX(-50%)',
                      fontSize: 48, fontWeight: 900, color: '#00ff88',
                      pointerEvents: 'none', zIndex: 50,
                      textShadow: '0 0 20px rgba(0,255,136,0.8)',
                    }}
                    onAnimationComplete={() => setScorePop(null)}
                  >
                    +{scorePop.value}🤫
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Near-miss banner */}
              <AnimatePresence>
                {nearMiss && (
                  <motion.div
                    key="nearmiss"
                    initial={{ opacity: 0, scale: 0.8, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.8, y: -10 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                    style={{
                      position: 'absolute', top: '22%',
                      background: 'rgba(255,170,0,0.12)', border: '1px solid rgba(255,170,0,0.5)',
                      borderRadius: 12, padding: '8px 16px',
                      fontSize: 20, fontWeight: 800, color: '#ffaa00',
                      pointerEvents: 'none', zIndex: 50,
                    }}
                  >
                    😬 So close!
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Bomb */}
              <div
                ref={bombContainerRef}
                style={{ position: 'relative', display: 'inline-block', transform: 'scale(1)', transition: 'transform 0.05s', fontSize: 90 }}
              >
                💣
                <div
                  ref={bombFuseRef}
                  style={{
                    position: 'absolute', top: -4, right: -8, width: 4, height: '55px',
                    backgroundColor: '#00ff88', borderRadius: 2, transformOrigin: 'bottom', transition: 'background-color 0.3s',
                  }}
                />
              </div>

              {/* Fuse bar */}
              <div style={{ width: '80%', maxWidth: 300 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ color: '#666', fontSize: 18, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>FUSE</span>
                  <span ref={fusePercentTextRef} style={{ color: '#00ff88', fontSize: 40, fontWeight: 800, lineHeight: 1 }}>100%</span>
                </div>
                <div style={{ backgroundColor: '#222', borderRadius: 4, height: 10, overflow: 'hidden' }}>
                  <div ref={fuseBarFillRef} style={{ width: '100%', height: '100%', backgroundColor: '#00ff88', borderRadius: 4, transition: 'width 0.08s' }} />
                </div>
              </div>

              {/* Volume meter */}
              <div style={{ width: '80%', maxWidth: 300 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ color: '#666', fontSize: 18, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>VOLUME</span>
                  <span ref={volumeValueTextRef} style={{ color: '#00ff88', fontSize: 40, fontWeight: 800, lineHeight: 1 }}>0</span>
                </div>
                <div style={{ backgroundColor: '#222', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                  <div ref={volumeBarFillRef} style={{ width: '0%', height: '100%', backgroundColor: '#00ff88', borderRadius: 4, transition: 'width 0.04s' }} />
                </div>
              </div>

              {/* Defuse progress */}
              <div
                ref={defuseContainerRef}
                style={{
                  display: 'none', width: '80%', maxWidth: 300,
                  padding: '12px 16px', background: 'rgba(0,255,136,0.08)',
                  border: '1px solid rgba(0,255,136,0.35)', borderRadius: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ color: '#00ff88', fontSize: 18, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>DEFUSING</span>
                  <span ref={defuseBarTextRef} style={{ color: '#00ff88', fontSize: 28, fontWeight: 800, lineHeight: 1 }}>5s</span>
                </div>
                <div style={{ backgroundColor: '#111', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                  <div ref={defuseBarFillRef} style={{ width: '0%', height: '100%', backgroundColor: '#00ff88', borderRadius: 4, transition: 'width 0.1s' }} />
                </div>
              </div>

              <p
                ref={instructionTextRef}
                style={{ color: '#555', fontSize: 16, textAlign: 'center', margin: 0, lineHeight: 1.5 }}
              >
                Keep quiet to slow the fuse
              </p>
            </div>
          </motion.div>
        )}

        {gameState === 'done' && behavior && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              background: '#000', padding: '24px 20px', gap: 16, overflowY: 'auto',
            }}
          >
            {/* Title */}
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 260, damping: 20 }}
              style={{ fontSize: 52, lineHeight: 1 }}
            >
              {behavior.defused ? '✅' : '💥'}
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18, duration: 0.3 }}
              style={{ fontSize: 26, fontWeight: 900, color: behavior.defused ? '#00ff88' : '#ef4444', textAlign: 'center' }}
            >
              {behavior.defused ? 'Defused! 🔍' : '💥 BOOM!'}
            </motion.div>

            {/* Personal best banner */}
            <AnimatePresence>
              {isNewPB && (
                <motion.div
                  key="pb-banner"
                  initial={{ opacity: 0, scale: 0.8, y: -8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ delay: 0.3, type: 'spring', stiffness: 300, damping: 20 }}
                  style={{
                    background: 'linear-gradient(135deg, rgba(255,215,0,0.2), rgba(255,170,0,0.1))',
                    border: '1px solid rgba(255,215,0,0.5)', borderRadius: 14,
                    padding: '10px 20px', fontSize: 18, fontWeight: 800, color: '#ffd700',
                    textAlign: 'center',
                  }}
                >
                  🏆 New Best!
                </motion.div>
              )}
            </AnimatePresence>

            {/* Score card */}
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.3 }}
              style={{
                width: '100%', maxWidth: 320,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 16, padding: '20px 20px', display: 'flex', flexDirection: 'column', gap: 12,
              }}
            >
              {/* Final score */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#666', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Final Score</span>
                <span style={{ color: behavior.defused ? '#00ff88' : '#ef4444', fontSize: 32, fontWeight: 900, lineHeight: 1 }}>
                  {behavior.defused ? `${behavior.fuseRemaining}%` : '0%'}
                </span>
              </div>
              {/* Personal best */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#666', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Personal Best</span>
                <span style={{ color: '#ffd700', fontSize: 24, fontWeight: 800, lineHeight: 1 }}>
                  {personalBest !== null ? `${personalBest}%` : '—'}
                </span>
              </div>
              {/* Divider */}
              <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />
              {/* Stats */}
              {[
                { label: 'Noise spikes', value: String(behavior.noiseSpikes), color: '#ef4444' },
                { label: 'Avg volume', value: `${behavior.avgVolume}/100`, color: '#ffaa00' },
                { label: 'Danger time', value: `${behavior.dangerSeconds}s`, color: '#ff6666' },
                { label: 'Fuse left', value: `${behavior.fuseRemaining}%`, color: behavior.defused ? '#00ff88' : '#555' },
              ].map((stat) => (
                <div key={stat.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#555', fontSize: 14 }}>{stat.label}</span>
                  <span style={{ color: stat.color, fontSize: 16, fontWeight: 700 }}>{stat.value}</span>
                </div>
              ))}
              {/* Personality */}
              <div style={{
                marginTop: 4, padding: '10px 14px',
                background: 'rgba(255,255,255,0.04)', borderRadius: 10, textAlign: 'center',
              }}>
                <span style={{ color: '#888', fontSize: 13 }}>You are </span>
                <span style={{ color: accent, fontSize: 16, fontWeight: 800 }}>{getProfile(behavior)}</span>
              </div>
            </motion.div>

            {/* Action buttons */}
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.3 }}
              style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 320 }}
            >
              <button
                onClick={handlePlayAgain}
                style={{
                  flex: 1, padding: '14px 0', borderRadius: 12, border: 'none',
                  background: accent, color: '#fff', fontSize: 16, fontWeight: 800,
                  cursor: 'pointer', letterSpacing: '0.02em',
                }}
              >
                Play Again
              </button>
              <button
                onClick={handleShare}
                style={{
                  flex: 1, padding: '14px 0', borderRadius: 12,
                  border: `1px solid rgba(255,255,255,0.2)`, background: 'rgba(255,255,255,0.06)',
                  color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.02em',
                }}
              >
                {copied ? '✓ Copied!' : '📤 Share'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </GameShell>
  );
}
