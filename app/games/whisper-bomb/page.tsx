'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Mic } from 'lucide-react';
import GameShell from '@/components/GameShell';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, increaseMusicTempo } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'whisper-bomb';
const GAME_ACCENT = '#ef4444';   // Whisper Bomb's permanent accent

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
  // Use brand accent if a non-default brand is active; otherwise keep the game's own red
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
    lastSpikeCountTime: 0,  // cooldown for noiseSpikes counter (500ms per spike event)
    ambientBaseline: 0,   // set during calibration in handleStart
  });

  // ── DOM refs for 60fps updates — avoids setState in rAF loop ──────────────
  const playAreaRef        = useRef<HTMLDivElement>(null);
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

  const [gameState, setGameState]   = useState<GameState>('start');
  const [displayTime, setDisplayTime] = useState(30);
  const [behavior, setBehavior]     = useState<BehaviorData | null>(null);
  const [micError, setMicError]     = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const getVolume = useCallback((): number => {
    const s = stateRef.current;
    if (!s.analyser) return 0;
    const data = new Uint8Array(s.analyser.frequencyBinCount);
    s.analyser.getByteFrequencyData(data);
    const sumSq = data.reduce((acc, v) => acc + v * v, 0);
    const raw = Math.min(100, (Math.sqrt(sumSq / data.length) / 128) * 100);
    // Subtract ambient baseline so noisy venues don't constantly trigger danger
    return Math.max(0, raw - s.ambientBaseline);
  }, []);

  const endGame = useCallback((defused: boolean, capturedTheme: typeof theme) => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.timerIntervalId) clearInterval(s.timerIntervalId);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {/* ignore */});
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
      if (s.timeLeft <= 0) { sfx.boom(); haptic([500]); endGame(false, capturedTheme); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const vol = getVolume();
      s.volumeSamples.push(vol);

      // ── Update DOM directly — no setState in rAF loop ────────────────────
      const fuse        = s.fuse;
      const fuseColor   = fuse > 60 ? '#00ff88' : fuse > 30 ? '#ffaa00' : '#ef4444';
      const volColor    = vol > 25  ? '#ef4444'  : vol > 8   ? '#ffaa00' : '#00ff88';
      const bombScale   = 1 + (vol / 200);
      const bgR         = Math.min(30, 10 + Math.round(vol * 0.5));

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

      // Defuse progress indicator — visible only when fuse < 25%
      if (defuseContainerRef.current)
        defuseContainerRef.current.style.display = fuse < 25 ? 'block' : 'none';
      if (fuse < 25) {
        const defuseProgress = Math.min(100, (s.quietStreak / 5) * 100);
        if (defuseBarFillRef.current)
          defuseBarFillRef.current.style.width = `${defuseProgress}%`;
        if (defuseBarTextRef.current)
          defuseBarTextRef.current.textContent = `${Math.ceil(5 - s.quietStreak)}s`;
      }

      // Fuse logic at ~60fps; rates calibrated to /s
      if (vol > 25) {
        // Count a spike event only once per 500ms
        const now = Date.now();
        if (now - s.lastSpikeCountTime >= 500) {
          s.noiseSpikes++;
          s.lastSpikeCountTime = now;
        }
        s.fuse -= 5 / 60;
        s.dangerFrames++;
        s.quietStreak = 0;
        if (now - s.lastSpikeTime > 400) {
          sfx.whoosh(); haptic([30]); s.lastSpikeTime = now;
          // Flash — tied to spike cooldown (≤2.5Hz, well below photosensitivity threshold)
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
      } else {
        s.fuse -= 2 / 60;
        s.quietStreak = 0;
      }

      if (s.fuse < 25 && s.quietStreak >= 5) {
        sfx.defuse(); haptic([30, 50, 30, 50, 100]); endGame(true, capturedTheme); return;
      }
      if (s.fuse <= 0) {
        sfx.boom(); haptic([500]); endGame(false, capturedTheme); return;
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
    // Test shortcut: skip mic acquisition when audio is disabled (e.g. Playwright)
    if ((window as unknown as Record<string,unknown>).__DISABLE_AUDIO) { setGameState('countdown'); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      const s = stateRef.current;
      s.stream = stream; s.analyser = analyser; s.audioCtx = audioCtx;

      // Ambient calibration: sample ~1 second of background noise to offset thresholds
      const calibData = new Uint8Array(analyser.frequencyBinCount);
      const calibSamples: number[] = [];
      for (let i = 0; i < 10; i++) {
        await new Promise<void>(r => setTimeout(r, 100));
        analyser.getByteFrequencyData(calibData);
        const rms = Math.sqrt(calibData.reduce((acc, v) => acc + v * v, 0) / calibData.length);
        calibSamples.push((rms / 128) * 100);
      }
      // Cap baseline at 20 so a very loud venue doesn't zero out all sensitivity
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
    setGameState('start');
  }, []);

  useEffect(() => () => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.timerIntervalId) clearInterval(s.timerIntervalId);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {/* ignore */});
    if (stopMusicRef.current) stopMusicRef.current();
  }, []);

  return (
    <GameShell title="Whisper Bomb" emoji="💣" accentColor={accent} theme={theme}>
      {/* Flash overlay — always present, controlled via ref (no setState in rAF) */}
      <div
        ref={flashRef}
        style={{ position: 'absolute', inset: 0, backgroundColor: 'transparent', pointerEvents: 'none', zIndex: 100 }}
      />

      {gameState === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}

      {gameState === 'start' && (
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
              marginTop: 12,
              padding: '10px 14px',
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.4)',
              borderRadius: 10,
              color: '#ef4444',
              fontSize: 14,
              textAlign: 'center',
            }}>
              Microphone access needed. Please allow and try again.
            </div>
          )}
        </GameStartScreen>
      )}

      {gameState === 'requesting' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--color-text-secondary)' }}>
          <Mic size={40} color="rgba(255,255,255,0.7)" />
          <div style={{ fontSize: 16, fontWeight: 600 }}>Calibrating microphone…</div>
          <div style={{ fontSize: 14, color: '#555', maxWidth: 220, textAlign: 'center', lineHeight: 1.5 }}>
            Measuring ambient noise level. Keep quiet for a moment.
          </div>
        </div>
      )}

      {gameState === 'playing' && (
        <div
          ref={playAreaRef}
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: 24,
            padding: '80px 24px 24px',
            background: 'radial-gradient(ellipse at center, rgba(30,5,5,1) 0%, rgba(10,3,3,1) 40%, #000 100%)',
            transition: 'background 0.2s',
          }}
        >
          {/* Timer — top right, accessible size */}
          <div style={{
            position: 'absolute',
            top: 52,
            right: 20,
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontSize: 40,
            fontWeight: displayTime <= 10 ? 900 : 700,
            color: displayTime <= 10 ? '#ef4444' : '#888',
            letterSpacing: '0.03em',
            transition: 'color 0.3s, transform 0.15s',
            transform: displayTime <= 10 ? 'scale(1.05)' : 'scale(1)',
            transformOrigin: 'top right',
            lineHeight: 1,
          }}>
            {displayTime}s
          </div>

          {/* Bomb — scales with volume via ref, no setState */}
          <div
            ref={bombContainerRef}
            style={{ position: 'relative', display: 'inline-block', transform: 'scale(1)', transition: 'transform 0.05s', fontSize: 90 }}
          >
            💣
            {/* Fuse bar (shrinks as fuse depletes) */}
            <div
              ref={bombFuseRef}
              style={{
                position: 'absolute', top: -4, right: -8, width: 4,
                height: '55px',
                backgroundColor: '#00ff88',
                borderRadius: 2,
                transformOrigin: 'bottom',
                transition: 'background-color 0.3s',
              }}
            />
          </div>

          {/* Fuse progress — accessibility-sized labels */}
          <div style={{ width: '80%', maxWidth: 300 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#666', fontSize: 18, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>FUSE</span>
              <span ref={fusePercentTextRef} style={{ color: '#00ff88', fontSize: 40, fontWeight: 800, lineHeight: 1 }}>100%</span>
            </div>
            <div style={{ backgroundColor: '#222', borderRadius: 4, height: 10, overflow: 'hidden' }}>
              <div
                ref={fuseBarFillRef}
                style={{ width: '100%', height: '100%', backgroundColor: '#00ff88', borderRadius: 4, transition: 'width 0.08s' }}
              />
            </div>
          </div>

          {/* Volume meter — accessibility-sized labels */}
          <div style={{ width: '80%', maxWidth: 300 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#666', fontSize: 18, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>VOLUME</span>
              <span ref={volumeValueTextRef} style={{ color: '#00ff88', fontSize: 40, fontWeight: 800, lineHeight: 1 }}>0</span>
            </div>
            <div style={{ backgroundColor: '#222', borderRadius: 4, height: 8, overflow: 'hidden' }}>
              <div
                ref={volumeBarFillRef}
                style={{ width: '0%', height: '100%', backgroundColor: '#00ff88', borderRadius: 4, transition: 'width 0.04s' }}
              />
            </div>
          </div>

          {/* Defuse progress — only appears when fuse < 25% */}
          <div
            ref={defuseContainerRef}
            style={{
              display: 'none',
              width: '80%',
              maxWidth: 300,
              padding: '12px 16px',
              background: 'rgba(0,255,136,0.08)',
              border: '1px solid rgba(0,255,136,0.35)',
              borderRadius: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#00ff88', fontSize: 18, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>DEFUSING</span>
              <span ref={defuseBarTextRef} style={{ color: '#00ff88', fontSize: 28, fontWeight: 800, lineHeight: 1 }}>5s</span>
            </div>
            <div style={{ backgroundColor: '#111', borderRadius: 4, height: 8, overflow: 'hidden' }}>
              <div
                ref={defuseBarFillRef}
                style={{ width: '0%', height: '100%', backgroundColor: '#00ff88', borderRadius: 4, transition: 'width 0.1s' }}
              />
            </div>
          </div>

          <p
            ref={instructionTextRef}
            style={{ color: '#555', fontSize: 16, textAlign: 'center', margin: 0, lineHeight: 1.5 }}
          >
            Keep quiet to slow the fuse
          </p>
        </div>
      )}

      {gameState === 'done' && behavior && (
        <EndScreen
          gameId={GAME_ID}
          title={behavior.defused ? 'Defused! 🔍' : '💥 BOOM!'}
          emoji={behavior.defused ? '✅' : '💥'}
          score={behavior.defused ? `${behavior.fuseRemaining}%` : '0%'}
          personality={getProfile(behavior)}
          insights={[
            { label: 'Noise spikes', value: String(behavior.noiseSpikes), color: '#ef4444' },
            { label: 'Avg volume', value: `${behavior.avgVolume}/100`, color: '#ffaa00' },
            { label: 'Danger time', value: `${behavior.dangerSeconds}s`, color: '#ff6666' },
            { label: 'Fuse left', value: `${behavior.fuseRemaining}%`, color: behavior.defused ? '#00ff88' : '#555' },
          ]}
          accentColor={accent}
          onPlayAgain={handlePlayAgain}
          didWin={behavior.defused}
        />
      )}
    </GameShell>
  );
}
