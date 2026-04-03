'use client';
/**
 * CODE BREAKER — 3D: floating holographic number display in a dark cyber environment.
 * Memorize the glowing code, then tap digits back. Codes grow longer.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID      = 'code-breaker';
const ACCENT       = '#06b6d4';
const DURATION     = 60;
const GAME_EMOJI   = '🔐';
const GAME_TITLE   = 'Code Breaker';
const GAME_TAGLINE = 'Memorize the code — then tap it back from memory.';

interface Signals {
  codesCorrect: number; codesWrong: number; maxCodeLength: number;
  avgMemoryMs: number; longestStreak: number; streakCurrent: number; score: number;
}

function getPersonality(sig: Signals): string {
  if (sig.maxCodeLength >= 7 && sig.codesCorrect >= 8)  return 'Cipher Brain 🔐';
  if (sig.longestStreak >= 6)                            return 'Code Streak 🔥';
  if (sig.maxCodeLength >= 6)                            return 'Memory Master 🧠';
  if (sig.codesCorrect >= 5)                             return 'Pattern Recognizer 👁️';
  return 'Digital Rookie 🖥️';
}

type MemoryPhase = 'show' | 'hide' | 'input' | 'feedback';

interface CodeState {
  code: number[]; userInput: number[]; memoryPhase: MemoryPhase;
  showTimer: number; hideTimer: number; feedbackTimer: number;
  feedbackResult: 'correct' | 'wrong' | null;
  inputStartTime: number; showStartTime: number;
}

interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  codeState: CodeState; currentCodeLength: number;
  accentColor: string; memoryTimes: number[];
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

const SHOW_FRAMES  = 120;
const FEEDBACK_FRAMES = 60;

function generateCode(length: number): number[] {
  return Array.from({ length }, () => Math.floor(Math.random() * 10));
}

export default function CodeBreakerGame() {
  const theme        = useBrandTheme();
  const accent       = theme.colors.accent ?? ACCENT;

  const mountRef     = useRef<HTMLDivElement>(null);
  const rendererRef  = useRef<THREE.WebGLRenderer|null>(null);
  const sceneRef     = useRef<THREE.Scene|null>(null);
  const cameraRef    = useRef<THREE.PerspectiveCamera|null>(null);
  const rafRef       = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  // 3D floating panels for each digit slot
  const digitMeshesRef = useRef<THREE.Mesh[]>([]);
  const gridMeshesRef  = useRef<THREE.Mesh[]>([]);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { codesCorrect:0, codesWrong:0, maxCodeLength:3, avgMemoryMs:0, longestStreak:0, streakCurrent:0, score:0 },
    codeState: { code:[], userInput:[], memoryPhase:'show', showTimer:SHOW_FRAMES, hideTimer:30, feedbackTimer:0, feedbackResult:null, inputStartTime:0, showStartTime:0 },
    currentCodeLength: 3,
    accentColor: ACCENT, memoryTimes: [],
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals|null>(null);
  // UI state for digit display overlay
  const [uiCode, setUiCode]             = useState<number[]>([]);
  const [uiInput, setUiInput]           = useState<number[]>([]);
  const [uiMemPhase, setUiMemPhase]     = useState<MemoryPhase>('show');
  const [uiFeedback, setUiFeedback]     = useState<'correct'|'wrong'|null>(null);

  useEffect(() => { stateRef.current.accentColor = accent; }, [accent]);

  // ── Three.js setup ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    const W = mount.clientWidth||window.innerWidth; const H = mount.clientHeight||window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(W, H); renderer.setClearColor(0x020b12);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(65, W/H, 0.1, 100);
    camera.position.set(0, 0, 7);
    cameraRef.current = camera;

    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const pl = new THREE.PointLight(0x06b6d4, 4, 20);
    pl.position.set(0, 2, 5);
    scene.add(pl);
    scene.add(new THREE.DirectionalLight(0x67e8f9, 0.6));

    // Grid floor
    const gridHelper = new THREE.GridHelper(20, 20, 0x0e7490, 0x0e7490);
    gridHelper.position.y = -3;
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.25;
    scene.add(gridHelper);

    // Background particles (floating data bits)
    const bitGeo = new THREE.BufferGeometry();
    const bitPos = new Float32Array(400 * 3);
    for (let i = 0; i < 400; i++) {
      bitPos[i*3]   = (Math.random()-0.5)*16;
      bitPos[i*3+1] = (Math.random()-0.5)*16;
      bitPos[i*3+2] = (Math.random()-0.5)*8-4;
    }
    bitGeo.setAttribute('position', new THREE.BufferAttribute(bitPos, 3));
    scene.add(new THREE.Points(bitGeo, new THREE.PointsMaterial({ color: 0x0891b2, size: 0.06, sizeAttenuation: true, transparent: true, opacity: 0.6 })));

    // Digit slot panels — created/rebuilt per round
    for (let i = 0; i < 10; i++) {
      const geo = new THREE.BoxGeometry(0.8, 0.9, 0.08);
      const mat = new THREE.MeshStandardMaterial({ color: 0x0e7490, metalness: 0.5, roughness: 0.4, transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      digitMeshesRef.current.push(mesh);
    }

    // Number pad tiles (0-9)
    const PAD_LAYOUT = [
      [1,2,3],[4,5,6],[7,8,9],[null,0,null]
    ];
    const tileSize = 0.7;
    const tileGap = 0.1;
    const padOffsetY = -1.5;
    PAD_LAYOUT.forEach((row, ri) => {
      row.forEach((num, ci) => {
        if (num === null) return;
        const geo = new THREE.BoxGeometry(tileSize, tileSize, 0.1);
        const mat = new THREE.MeshStandardMaterial({ color: 0x164e63, metalness: 0.4, roughness: 0.5, emissive: 0x06b6d4, emissiveIntensity: 0.2 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set((ci - 1) * (tileSize + tileGap), padOffsetY - ri * (tileSize + tileGap), 0.5);
        mesh.userData.digit = num;
        scene.add(mesh);
        gridMeshesRef.current.push(mesh);
      });
    });

    const onResize = () => {
      const W2 = mount.clientWidth||window.innerWidth; const H2 = mount.clientHeight||window.innerHeight;
      renderer.setSize(W2,H2); camera.aspect=W2/H2; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    let frame = 0;
    const render = () => {
      rafRef.current = requestAnimationFrame(render);
      frame++;
      const t = frame * 0.016;
      // Animate grid tiles
      gridMeshesRef.current.forEach(m => {
        m.position.z = 0.5 + Math.sin(t + m.position.x * 0.8) * 0.05;
      });
      // Animate digit panels
      digitMeshesRef.current.forEach((m, i) => {
        if (m.visible) m.rotation.y = Math.sin(t * 0.5 + i * 0.3) * 0.05;
      });
      // Camera gentle sway
      camera.position.x = Math.sin(t * 0.2) * 0.2;
      camera.position.y = Math.cos(t * 0.15) * 0.1;
      renderer.render(scene, camera);
    };
    render();

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(rafRef.current);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  const startNewCode = useCallback(() => {
    const s = stateRef.current;
    const code = generateCode(s.currentCodeLength);
    s.codeState = {
      code, userInput: [], memoryPhase: 'show',
      showTimer: SHOW_FRAMES, hideTimer: 30, feedbackTimer: 0, feedbackResult: null,
      inputStartTime: 0, showStartTime: Date.now(),
    };
    // Update 3D digit display
    const panels = digitMeshesRef.current;
    panels.forEach((m, i) => {
      m.visible = i < s.currentCodeLength;
      if (m.visible) {
        m.position.set((i - (s.currentCodeLength-1)/2) * 1.0, 1.2, 0.5);
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.opacity = 1; mat.color.setHex(0x0e7490);
      }
    });
    setUiCode(code); setUiInput([]); setUiMemPhase('show'); setUiFeedback(null);
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const avg = s.memoryTimes.length > 0 ? s.memoryTimes.reduce((a,b)=>a+b,0)/s.memoryTimes.length : 0;
    s.sig.avgMemoryMs = Math.round(avg);
    const sig = { ...s.sig };
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`)??'0');
    if (sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(sig.score));
    setFinalSig(sig); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { codesCorrect:0, codesWrong:0, maxCodeLength:3, avgMemoryMs:0, longestStreak:0, streakCurrent:0, score:0 };
    s.currentCodeLength = 3; s.memoryTimes = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('minimal');
    startNewCode();

    // Game logic ticker
    let frameCt = 0;
    const gameTick = () => {
      if (!stateRef.current.running) return;
      const s2 = stateRef.current; const cs = s2.codeState;
      frameCt++;

      if (cs.memoryPhase === 'show') {
        cs.showTimer--;
        if (cs.showTimer <= 0) {
          cs.memoryPhase = 'hide'; cs.hideTimer = 30;
          setUiMemPhase('hide');
          // Hide panels
          digitMeshesRef.current.forEach(m => {
            if (m.visible) { const mat = m.material as THREE.MeshStandardMaterial; mat.opacity = 0.1; mat.color.setHex(0x164e63); }
          });
          sfx.click();
        }
      } else if (cs.memoryPhase === 'hide') {
        cs.hideTimer--;
        if (cs.hideTimer <= 0) {
          cs.memoryPhase = 'input'; cs.inputStartTime = Date.now();
          setUiMemPhase('input');
        }
      } else if (cs.memoryPhase === 'feedback') {
        cs.feedbackTimer--;
        if (cs.feedbackTimer <= 0) {
          if (cs.feedbackResult === 'correct') s2.currentCodeLength = Math.min(9, s2.currentCodeLength + 1);
          startNewCode();
        }
      }
      rafRef.current = requestAnimationFrame(gameTick);
    };
    rafRef.current = requestAnimationFrame(gameTick);

    timerRef.current = setInterval(() => {
      const s2 = stateRef.current;
      s2.timeLeft--; setTimeLeft(s2.timeLeft);
      if (s2.timeLeft <= 10 && s2.timeLeft > 0) sfx.tick();
      if (s2.timeLeft <= 0) endGame();
    }, 1000);
  }, [endGame, startNewCode]);

  const handleDigitTap = useCallback((digit: number) => {
    const s = stateRef.current; const cs = s.codeState;
    if (cs.memoryPhase !== 'input') return;
    const newInput = [...cs.userInput, digit];
    cs.userInput = newInput; setUiInput([...newInput]);
    sfx.click(); haptic([15]);

    if (newInput.length === cs.code.length) {
      const correct = cs.code.every((d, i) => d === newInput[i]);
      cs.feedbackResult = correct ? 'correct' : 'wrong';
      cs.feedbackTimer = FEEDBACK_FRAMES;
      cs.memoryPhase = 'feedback';
      setUiMemPhase('feedback'); setUiFeedback(correct ? 'correct' : 'wrong');

      if (correct) {
        s.sig.codesCorrect++; s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.longestStreak) s.sig.longestStreak = s.sig.streakCurrent;
        if (s.currentCodeLength > s.sig.maxCodeLength) s.sig.maxCodeLength = s.currentCodeLength;
        const pts = s.currentCodeLength * 10 * (s.sig.streakCurrent >= 3 ? 2 : 1);
        s.sig.score += pts;
        const rt = Date.now() - cs.inputStartTime; s.memoryTimes.push(rt);
        setScoreDisplay(s.sig.score); sfx.success();
        // Light up panels green
        digitMeshesRef.current.forEach(m => {
          if (m.visible) { const mat = m.material as THREE.MeshStandardMaterial; mat.opacity=1; mat.emissive.setHex(0x22c55e); mat.emissiveIntensity=1; }
        });
      } else {
        s.sig.codesWrong++; s.sig.streakCurrent = 0;
        sfx.collision(); haptic([50,30,50]);
        // Light up panels red
        digitMeshesRef.current.forEach(m => {
          if (m.visible) { const mat = m.material as THREE.MeshStandardMaterial; mat.opacity=1; mat.emissive.setHex(0xef4444); mat.emissiveIntensity=1; }
        });
      }
    }
  }, []);

  // Handle tap on 3D number pad tiles
  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.codeState.memoryPhase !== 'input') return;
      // Raycasting
      const renderer = rendererRef.current; const camera = cameraRef.current; const scene = sceneRef.current;
      if (!renderer||!camera||!scene) return;
      const rect = mount.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      const hits = raycaster.intersectObjects(gridMeshesRef.current);
      if (hits.length > 0) {
        const digit = hits[0].object.userData.digit as number;
        if (digit !== undefined) {
          handleDigitTap(digit);
          // Flash the tile
          const mat = (hits[0].object as THREE.Mesh).material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = 2;
          setTimeout(() => { mat.emissiveIntensity = 0.2; }, 200);
        }
      }
    };
    mount.addEventListener('pointerdown', onPointerDown);
    return () => mount.removeEventListener('pointerdown', onPointerDown);
  }, [phase, handleDigitTap]);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const memPhaseLabel = uiMemPhase === 'show' ? 'MEMORIZE' : uiMemPhase === 'input' ? 'ENTER CODE' : uiMemPhase === 'feedback' ? (uiFeedback === 'correct' ? '✓ CORRECT' : '✗ WRONG') : '...';
  const memColor = uiMemPhase === 'feedback' ? (uiFeedback === 'correct' ? '#22c55e' : '#ef4444') : accent;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Break It 🔐" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position:'absolute',inset:0,width:'100%',height:'100%' }} />
          {phase === 'playing' && (
            <>
              <GameHUD accentColor={accent} items={[
                { label:'TIME',  value:timeLeft,      danger:timeLeft<=10 },
                { label:'SCORE', value:scoreDisplay },
              ]} />
              {/* Code display overlay */}
              <div style={{ position:'absolute',top:'18%',left:0,right:0,display:'flex',flexDirection:'column',alignItems:'center',gap:8,pointerEvents:'none' }}>
                <div style={{ fontSize:13,fontWeight:700,letterSpacing:'0.15em',color:memColor,textTransform:'uppercase' }}>{memPhaseLabel}</div>
                <div style={{ display:'flex',gap:8 }}>
                  {uiCode.map((d, i) => {
                    const revealed = uiMemPhase === 'show' || (uiMemPhase === 'feedback');
                    const entered = uiMemPhase !== 'show' && uiInput[i] !== undefined;
                    const bg = uiMemPhase === 'feedback' ? (uiFeedback === 'correct' ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)') : 'rgba(6,182,212,0.12)';
                    return (
                      <div key={i} style={{ width:44,height:54,borderRadius:8,border:`2px solid ${memColor}55`,background:bg,
                        display:'flex',alignItems:'center',justifyContent:'center',
                        fontSize:26,fontWeight:900,color:memColor,
                        fontFamily:'monospace' }}>
                        {revealed ? d : (entered ? uiInput[i] : '—')}
                      </div>
                    );
                  })}
                </div>
                {uiMemPhase === 'input' && (
                  <div style={{ fontSize:12,color:'rgba(255,255,255,0.4)',marginTop:2 }}>
                    {uiInput.length}/{uiCode.length} digits entered
                  </div>
                )}
              </div>
              {/* Digit pad overlay */}
              <div style={{ position:'absolute',bottom:80,left:'50%',transform:'translateX(-50%)',
                display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,width:200 }}>
                {[1,2,3,4,5,6,7,8,9,null,0,null].map((d, i) => (
                  d !== null ? (
                    <button key={i} onClick={() => handleDigitTap(d)}
                      style={{ height:52,borderRadius:10,border:`1.5px solid ${accent}55`,background:'rgba(6,182,212,0.08)',
                        color:accent,fontSize:22,fontWeight:800,cursor:'pointer',fontFamily:'monospace',
                        transition:'background 150ms',touchAction:'manipulation' }}>
                      {d}
                    </button>
                  ) : <div key={i} />
                ))}
              </div>
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label:'Correct',   value:String(finalSig.codesCorrect),  color:finalSig.codesCorrect>=8?'#4ade80':'#facc15' },
            { label:'Max Length',value:String(finalSig.maxCodeLength), color:accent },
            { label:'Best Streak',value:`×${finalSig.longestStreak}`,  color:'#fbbf24' },
            { label:'Avg Memory',value:`${(finalSig.avgMemoryMs/1000).toFixed(1)}s`, color:'var(--color-text)' },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.codesCorrect >= 5} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, codesCorrect: sig.codesCorrect, maxCodeLength: sig.maxCodeLength }, player);
  }, [theme, sig, personality, player]);
  return null;
}
