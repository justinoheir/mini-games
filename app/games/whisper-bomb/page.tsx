'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, increaseMusicTempo } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import PlayerNameInput from '@/components/PlayerNameInput';

const GAME_ID = 'whisper-bomb';

type GameState = 'start' | 'requesting' | 'countdown' | 'playing' | 'done';
interface BehaviorData { avgVolume: number; noiseSpikes: number; dangerSeconds: number; defused: boolean; }

function getProfile(b: BehaviorData) {
  if (b.defused && b.noiseSpikes < 3) return 'Calm 🧘';
  if (b.noiseSpikes > 10) return 'Explosive 💥';
  return 'Reactive ⚡';
}

export default function WhisperBomb() {
  const theme = useBrandTheme();
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
  });
  const [gameState, setGameState] = useState<GameState>('start');
  const [fusePercent, setFusePercent] = useState(100);
  const [volume, setVolume] = useState(0);
  const [behavior, setBehavior] = useState<BehaviorData | null>(null);
  const [flashColor, setFlashColor] = useState<string | null>(null);
  const [playerName, setPlayerName]   = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const playerSessionRef              = useRef<PlayerSession | null>(null);

  const getVolume = useCallback((): number => {
    const s = stateRef.current;
    if (!s.analyser) return 0;
    const data = new Uint8Array(s.analyser.frequencyBinCount);
    s.analyser.getByteFrequencyData(data);
    const sumSq = data.reduce((acc, v) => acc + v * v, 0);
    return Math.min(100, (Math.sqrt(sumSq / data.length) / 128) * 100);
  }, []);

  const endGame = useCallback((defused: boolean, capturedTheme: typeof theme) => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.timerIntervalId) clearInterval(s.timerIntervalId);
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {/* ignore */});
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const avgVol = s.volumeSamples.length > 0 ? s.volumeSamples.reduce((a, v) => a + v, 0) / s.volumeSamples.length : 0;
    const bData: BehaviorData = { avgVolume: Math.round(avgVol), noiseSpikes: s.noiseSpikes, dangerSeconds: Math.round(s.dangerFrames / 60), defused };
    setBehavior(bData);
    setGameState('done');
    postWebhook(capturedTheme, 'whisper-bomb', { score: defused ? 'Defused' : 'Exploded', personality: getProfile(bData), signals: { noiseSpikes: bData.noiseSpikes, avgVolume: bData.avgVolume } }, playerSessionRef.current);
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.fuse = 100; s.timeLeft = 30; s.volumeSamples = []; s.noiseSpikes = 0;
    s.dangerFrames = 0; s.quietStreak = 0; s.running = true; s.musicSped = false;
    setFusePercent(100); setGameState('playing');
    stopMusicRef.current = startMusic('pulse');
    const capturedTheme = theme;

    s.timerIntervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--;
      sfx.tick();
      if (s.timeLeft === 15 && !s.musicSped) {
        s.musicSped = true;
        increaseMusicTempo(130);
      }
      if (s.timeLeft === 8) {
        increaseMusicTempo(160);
      }
      if (s.timeLeft <= 0) { sfx.boom(); haptic([500]); endGame(false, capturedTheme); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const vol = getVolume();
      s.volumeSamples.push(vol);
      setVolume(vol);

      // Fuse logic at ~60fps; rates calibrated to /s
      if (vol > 25) {
        s.noiseSpikes++;
        s.fuse -= 5 / 60;
        s.dangerFrames++;
        s.quietStreak = 0;
        const now = Date.now();
        if (now - s.lastSpikeTime > 400) { sfx.whoosh(); s.lastSpikeTime = now; }
        if (s.fuse % 1 < 0.1) { setFlashColor('rgba(255,68,68,0.3)'); setTimeout(() => setFlashColor(null), 80); }
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
      setFusePercent(Math.max(0, s.fuse));
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [getVolume, endGame, theme]);

  const handleStart = useCallback(async () => {
    playerSessionRef.current = savePlayerSession(GAME_ID, playerName, playerAvatar);
    initAudio(); sfx.click();
    setGameState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      const s = stateRef.current;
      s.stream = stream; s.analyser = analyser; s.audioCtx = audioCtx;
      setGameState('countdown');
    } catch { alert('Microphone access needed. Please allow and try again.'); setGameState('start'); }
  }, [playerName, playerAvatar]);

  const handlePlayAgain = useCallback(() => {
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    setGameState('start');
  }, []);

  useEffect(() => () => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.timerIntervalId) clearInterval(s.timerIntervalId);
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {/* ignore */});
    if (stopMusicRef.current) stopMusicRef.current();
  }, []);

  const accent = theme.colors.accent;
  const fuseColor = fusePercent > 60 ? '#00ff88' : fusePercent > 30 ? '#ffaa00' : '#ef4444';
  const bombScale = 1 + (volume / 200);
  const bgR = Math.min(30, 10 + Math.round(volume * 0.5));

  return (
    <GameShell title="Whisper Bomb" emoji="💣" accentColor="#ef4444" theme={theme}>
      {flashColor && <div style={{ position:'absolute', inset:0, backgroundColor:flashColor, pointerEvents:'none', zIndex:100 }} />}

      {gameState==='countdown' && <Countdown onComplete={startLoop} accentColor="#ef4444" />}

      {gameState==='start' && (
        <GameStartScreen
          emoji="💣"
          title="Whisper Bomb"
          description="Stay silent to slow the fuse. Hold quiet for 5 seconds at the end to defuse."
          sensorNote="Uses microphone"
          ctaLabel="Allow Mic & Start →"
          accentColor="#ef4444"
          ctaTextColor="#fff"
          onStart={handleStart}
        >
          <PlayerNameInput
            accentColor={theme.colors.accent ?? '#ef4444'}
            onReady={(name, avatar) => { setPlayerName(name); setPlayerAvatar(avatar); }}
          />
        </GameStartScreen>
      )}

      {gameState==='requesting' && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--color-text-secondary)' }}>Requesting microphone…</div>
      )}

      {gameState==='playing' && (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:28, padding:'80px 24px 24px', background:`radial-gradient(ellipse at center, rgba(${bgR*3},5,5,1) 0%, rgba(${bgR},3,3,1) 40%, #000 100%)`, transition:'background 0.2s' }}>
          {/* Bomb */}
          <div style={{ position:'relative', display:'inline-block', transform:`scale(${bombScale})`, transition:'transform 0.05s', fontSize:90 }}>
            💣
            {/* Fuse bar (shrinks as fuse depletes) */}
            <div style={{ position:'absolute', top:-4, right:-8, width:4, height:`${fusePercent * 0.55}px`, backgroundColor:fuseColor, borderRadius:2, transformOrigin:'bottom', transition:'height 0.1s, background-color 0.3s' }} />
          </div>

          {/* Fuse progress */}
          <div style={{ width:'80%', maxWidth:300 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
              <span style={{ color:'#666', fontSize:12 }}>FUSE</span>
              <span style={{ color:fuseColor, fontSize:12, fontWeight:700 }}>{Math.round(fusePercent)}%</span>
            </div>
            <div style={{ backgroundColor:'#222', borderRadius:4, height:10, overflow:'hidden' }}>
              <div style={{ width:`${fusePercent}%`, height:'100%', backgroundColor:fuseColor, transition:'width 0.08s, background-color 0.3s', borderRadius:4 }} />
            </div>
          </div>

          {/* Volume meter (side bar) */}
          <div style={{ width:'80%', maxWidth:300 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
              <span style={{ color:'#666', fontSize:12 }}>VOLUME</span>
              <span style={{ color: volume > 25 ? '#ef4444' : volume > 8 ? '#ffaa00' : '#00ff88', fontSize:12, fontWeight:700 }}>{Math.round(volume)}</span>
            </div>
            <div style={{ backgroundColor:'#222', borderRadius:4, height:8, overflow:'hidden' }}>
              <div style={{ width:`${volume}%`, height:'100%', backgroundColor: volume>25 ? '#ef4444' : volume>8 ? '#ffaa00' : '#00ff88', transition:'width 0.04s', borderRadius:4 }} />
            </div>
          </div>

          <p style={{ color:'#444', fontSize:12, textAlign:'center', margin:0 }}>
            {fusePercent < 25 ? '🤫 Stay silent for 5 seconds to defuse!' : 'Keep quiet to slow the fuse'}
          </p>
        </div>
      )}

      {gameState==='done' && behavior && (
        <EndScreen
          gameId="whisper-bomb"
          title={behavior.defused ? 'Defused! 🔍' : '💥 BOOM!'}
          emoji={behavior.defused ? '✅' : '💥'}
          score={behavior.defused ? 'Defused' : 'Exploded'}
          personality={getProfile(behavior)}
          insights={[
            { label:'Noise spikes', value:String(behavior.noiseSpikes), color:'#ef4444' },
            { label:'Avg volume', value:`${behavior.avgVolume}/100`, color:'#ffaa00' },
            { label:'Danger time', value:`${behavior.dangerSeconds}s`, color:'#ff6666' },
          ]}
          accentColor="#ef4444"
          onPlayAgain={handlePlayAgain}
          didWin={behavior.defused}
        />
      )}
    </GameShell>
  );
}
