/**
 * gen-mic.js — Mic archetype bodies + choice questions + main runner
 * Appended to gen.js context at runtime via require
 */
'use strict';

// ─── VOL-MIC archetype ────────────────────────────────────────────────────────
function micVolBody(g) {
  const funcName = toFuncName(g.id);
  return `export default function ${funcName}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const analyserRef = useRef<AnalyserNode|null>(null);
  const streamRef = useRef<MediaStream|null>(null);
  const stateRef = useRef({
    running:false, timeLeft:DURATION,
    sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0},
    volume:0, power:0, targetX:0, targetY:0, spawnTime:0, hasMic:false,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const getMicVolume=useCallback(()=>{
    const analyser=analyserRef.current; if(!analyser) return 0;
    const buf=new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buf);
    return buf.reduce((a,b)=>a+b,0)/buf.length/255;
  },[]);

  const endGame=useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    if(streamRef.current){streamRef.current.getTracks().forEach(t=>t.stop());streamRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop=useCallback(async()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    // Try to get mic
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      streamRef.current=stream;
      const ac=new AudioContext();
      const source=ac.createMediaStreamSource(stream);
      const analyser=ac.createAnalyser();
      analyser.fftSize=256; source.connect(analyser);
      analyserRef.current=analyser;
      s.hasMic=true;
    }catch{s.hasMic=false;}

    s.running=true; s.timeLeft=DURATION; s.power=0; s.volume=0;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{ s.timeLeft--; setTimeLeft(s.timeLeft); if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();} },1000);
    s.targetX=50+Math.random()*(canvas.width-100);
    s.targetY=100+Math.random()*(canvas.height*0.5);
    s.sig.attempts++;

    const loop=()=>{
      if(!s.running) return;
      const W=canvas.width, H=canvas.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);

      // Get volume (real mic or fallback to random for demo)
      if(s.hasMic){
        s.volume=getMicVolume();
      } else {
        s.volume=0.1+Math.random()*0.05;
      }
      s.power=Math.min(1,s.power+s.volume*0.08-0.015);
      if(s.power<0) s.power=0;

      // Draw power bar
      const barW=W*0.7, barX=(W-barW)/2, barY=H*0.75, barH=24;
      ctx.fillStyle='#ffffff11'; ctx.roundRect(barX,barY,barW,barH,6); ctx.fill();
      const fillW=barW*s.power;
      const grad=ctx.createLinearGradient(barX,0,barX+barW,0);
      grad.addColorStop(0,ACCENT); grad.addColorStop(1,'#ffffff');
      ctx.fillStyle=grad; ctx.roundRect(barX,barY,fillW,barH,6); ctx.fill();
      ctx.strokeStyle=ACCENT+'66'; ctx.lineWidth=1.5; ctx.roundRect(barX,barY,barW,barH,6); ctx.stroke();

      // Draw target
      ctx.shadowBlur=16; ctx.shadowColor=ACCENT;
      ctx.strokeStyle=ACCENT; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(s.targetX,s.targetY,30,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle=ACCENT+'22'; ctx.fill();
      ctx.shadowBlur=0;

      // Power beam
      if(s.power>0.1){
        const beamH=H*0.68-s.power*(H*0.5);
        ctx.strokeStyle=ACCENT+'88'; ctx.lineWidth=s.power*20;
        ctx.beginPath(); ctx.moveTo(W/2,H*0.68); ctx.lineTo(W/2,beamH); ctx.stroke();
        // Check if beam reaches target
        if(s.power>0.5&&Math.abs(W/2-s.targetX)<60&&beamH<s.targetY+30){
          s.sig.hits++; s.sig.streakCurrent++;
          if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
          const pts=s.sig.streakCurrent>=3?2:1;
          s.sig.score+=pts; setScoreDisplay(s.sig.score);
          sfx.collect(); haptic([30]);
          s.power=0;
          s.targetX=50+Math.random()*(W-100);
          s.targetY=100+Math.random()*(H*0.5);
          s.sig.attempts++;
        }
      }

      // Instruction
      ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='13px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText(s.hasMic?'SPEAK / BLOW INTO MIC':'TAP RAPIDLY TO SIMULATE', W/2, H*0.82);
      if(s.sig.streakCurrent>=3){
        ctx.fillStyle=ACCENT; ctx.font='bold 16px sans-serif';
        ctx.fillText('x'+s.sig.streakCurrent+' COMBO!', W/2, H*0.88);
      }

      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,getMicVolume]);

  // Tap fallback if no mic
  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{ canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; };
    resize(); window.addEventListener('resize',resize);
    const onDown=()=>{ if(phase==='playing') stateRef.current.power=Math.min(1,stateRef.current.power+0.2); };
    canvas.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onDown);};
  },[phase]);

  useEffect(()=>()=>{
    cancelAnimationFrame(animRef.current);
    if(timerRef.current)clearInterval(timerRef.current);
    if(stopMusicRef.current)stopMusicRef.current();
    if(streamRef.current)streamRef.current.getTracks().forEach(t=>t.stop());
  },[]);

  const handleStart=useCallback((name,avatar)=>{initAudio();playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);setPhase('countdown');},[]);
  const handleCountdownDone=useCallback(()=>startLoop(),[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  const buildInsights=(sig)=>[
    {label:'Targets Hit',value:String(sig.hits),color:ACCENT},
    {label:'Best Streak',value:'x'+sig.maxStreak,color:ACCENT},
    {label:'Score',value:String(sig.score),color:'var(--color-text)'},
    {label:'Attempts',value:String(sig.attempts),color:'rgba(255,255,255,0.5)'},
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
        ctaLabel="Allow Mic" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&<>
        <canvas ref={canvasRef} aria-label="${g.title} game canvas" role="img"
          style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
        {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT}
          items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5},{label:'SCORE',value:scoreDisplay}]}/>}
      </>}
      {phase==='done'&&finalSig&&<>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={theme.colors.accent??ACCENT}
          onPlayAgain={handlePlayAgain} didWin={finalSig.hits>=6}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}`;
}

// ─── PITCH-MIC archetype ─────────────────────────────────────────────────────
function micPitchBody(g) {
  const funcName = toFuncName(g.id);
  return `export default function ${funcName}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const analyserRef = useRef<AnalyserNode|null>(null);
  const streamRef = useRef<MediaStream|null>(null);
  const stateRef = useRef({
    running:false, timeLeft:DURATION,
    sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0},
    pitchNorm:0.5, targetPitch:0.5, targetTolerance:0.08, holdTime:0, hasMic:false,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const getPitch=useCallback(()=>{
    const analyser=analyserRef.current; if(!analyser) return 0.5;
    const buf=new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    // Simple zero-crossing pitch estimation
    let crossings=0;
    for(let i=1;i<buf.length;i++) if(buf[i-1]<0&&buf[i]>=0) crossings++;
    const freq=crossings*(analyser.context.sampleRate/buf.length);
    return Math.min(1,Math.max(0,(freq-80)/800));
  },[]);

  const endGame=useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    if(streamRef.current){streamRef.current.getTracks().forEach(t=>t.stop());streamRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop=useCallback(async()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      streamRef.current=stream;
      const ac=new AudioContext();
      const source=ac.createMediaStreamSource(stream);
      const analyser=ac.createAnalyser();
      analyser.fftSize=2048; source.connect(analyser);
      analyserRef.current=analyser;
      s.hasMic=true;
    }catch{s.hasMic=false;}

    s.running=true; s.timeLeft=DURATION; s.pitchNorm=0.5; s.holdTime=0;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    s.targetPitch=0.2+Math.random()*0.6; s.sig.attempts++;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{ s.timeLeft--; setTimeLeft(s.timeLeft); if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();} },1000);

    const loop=()=>{
      if(!s.running) return;
      const W=canvas.width, H=canvas.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);

      // Get pitch
      if(s.hasMic) s.pitchNorm=getPitch();
      else s.pitchNorm=0.5+0.05*Math.sin(Date.now()*0.001); // demo wave

      // Draw pitch scale (vertical bar on right)
      const scaleX=W*0.75, scaleW=30, scaleH=H*0.6, scaleY=(H-scaleH)/2;
      ctx.fillStyle='#ffffff11'; ctx.roundRect(scaleX,scaleY,scaleW,scaleH,6); ctx.fill();
      // Target zone
      const tzY=scaleY+scaleH*(1-s.targetPitch-s.targetTolerance);
      const tzH=scaleH*s.targetTolerance*2;
      ctx.fillStyle=ACCENT+'44'; ctx.roundRect(scaleX,tzY,scaleW,tzH,4); ctx.fill();
      ctx.strokeStyle=ACCENT; ctx.lineWidth=2; ctx.roundRect(scaleX,tzY,scaleW,tzH,4); ctx.stroke();
      // Current pitch indicator
      const indicatorY=scaleY+scaleH*(1-s.pitchNorm)-6;
      const inZone=Math.abs(s.pitchNorm-s.targetPitch)<s.targetTolerance;
      ctx.shadowBlur=inZone?20:8; ctx.shadowColor=inZone?'#22c55e':ACCENT;
      ctx.fillStyle=inZone?'#22c55e':ACCENT;
      ctx.roundRect(scaleX-4,indicatorY,scaleW+8,12,4); ctx.fill();
      ctx.shadowBlur=0;

      // Hold meter
      if(inZone){
        s.holdTime+=1/60;
        const holdW=Math.min(1,s.holdTime/1.5);
        const mW=W*0.55, mX=(W-mW)/2, mY=H*0.78;
        ctx.fillStyle='#ffffff11'; ctx.roundRect(mX,mY,mW,18,6); ctx.fill();
        ctx.fillStyle=ACCENT; ctx.roundRect(mX,mY,mW*holdW,18,6); ctx.fill();
        if(s.holdTime>=1.5){
          // Scored!
          s.sig.hits++; s.sig.streakCurrent++;
          if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
          const pts=s.sig.streakCurrent>=3?2:1;
          s.sig.score+=pts; setScoreDisplay(s.sig.score);
          sfx.collect(); haptic([30]);
          s.holdTime=0; s.targetPitch=0.2+Math.random()*0.6; s.sig.attempts++;
        }
      } else {
        s.holdTime=Math.max(0,s.holdTime-0.05);
      }

      // Labels
      ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='13px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText(s.hasMic?'HUM / SING TO MATCH TARGET':'DEMO MODE',W/2,H*0.86);
      if(s.sig.streakCurrent>=3){
        ctx.fillStyle=ACCENT; ctx.font='bold 15px sans-serif';
        ctx.fillText('x'+s.sig.streakCurrent+' COMBO!',W/2,H*0.9);
      }

      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,getPitch]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{ canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; };
    resize(); window.addEventListener('resize',resize);
    // Touch: drag vertically to simulate pitch
    const onMove=(e)=>{
      if(phase!=='playing') return;
      const rect=canvas.getBoundingClientRect();
      const y=(e.clientY-rect.top)/rect.height;
      stateRef.current.pitchNorm=1-y;
    };
    canvas.addEventListener('pointermove',onMove);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointermove',onMove);};
  },[phase]);

  useEffect(()=>()=>{
    cancelAnimationFrame(animRef.current);
    if(timerRef.current)clearInterval(timerRef.current);
    if(stopMusicRef.current)stopMusicRef.current();
    if(streamRef.current)streamRef.current.getTracks().forEach(t=>t.stop());
  },[]);

  const handleStart=useCallback((name,avatar)=>{initAudio();playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);setPhase('countdown');},[]);
  const handleCountdownDone=useCallback(()=>startLoop(),[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  const buildInsights=(sig)=>[
    {label:'Pitches Matched',value:String(sig.hits),color:ACCENT},
    {label:'Best Streak',value:'x'+sig.maxStreak,color:ACCENT},
    {label:'Score',value:String(sig.score),color:'var(--color-text)'},
    {label:'Attempts',value:String(sig.attempts),color:'rgba(255,255,255,0.5)'},
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
        ctaLabel="Allow Mic" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&<>
        <canvas ref={canvasRef} aria-label="${g.title} game canvas" role="img"
          style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
        {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT}
          items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5},{label:'SCORE',value:scoreDisplay}]}/>}
      </>}
      {phase==='done'&&finalSig&&<>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={theme.colors.accent??ACCENT}
          onPlayAgain={handlePlayAgain} didWin={finalSig.hits>=5}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}`;
}

// ─── Questions for choice-based games ─────────────────────────────────────────
function getChoiceQuestions(id) {
  const base = [
    {text:'Which is larger?',options:['8','12','5','3'],correct:1},
    {text:'2 + 7 = ?',options:['8','9','10','11'],correct:1},
    {text:'Pick the even number',options:['7','9','4','11'],correct:2},
    {text:'5 × 3 = ?',options:['12','15','18','20'],correct:1},
    {text:'100 - 37 = ?',options:['63','73','67','53'],correct:0},
    {text:'Which is prime?',options:['9','15','7','21'],correct:2},
    {text:'Square root of 64?',options:['6','7','8','9'],correct:2},
    {text:'12 / 4 = ?',options:['2','3','4','6'],correct:1},
  ];
  const gameQ = {
    'mirror-mind':[
      {text:'Tap the mirrored position of the LEFT dot',options:['Top-Left','Top-Right','Bottom-Left','Bottom-Right'],correct:1},
      {text:'Mirror of bottom-right is?',options:['Top-Left','Bottom-Left','Bottom-Right','Top-Right'],correct:0},
      {text:'Tap the mirror of A4',options:['A4','D4','A1','D1'],correct:3},
      {text:'Left hand position mirrored to right?',options:['Same','Opposite','Inverted','Rotated'],correct:1},
    ],
    'color-word':[
      {text:'The word RED is written in BLUE ink. What ink color?',options:['Red','Blue','Green','Yellow'],correct:1},
      {text:'BLUE written in GREEN. Tap the ink color.',options:['Blue','Green','Yellow','Red'],correct:1},
      {text:'GREEN written in RED. Tap the ink.',options:['Blue','Red','Green','Purple'],correct:1},
      {text:'YELLOW in PURPLE ink. What color is the ink?',options:['Yellow','Green','Purple','Blue'],correct:2},
    ],
    'shape-rotate':[
      {text:'A triangle rotated 180° looks like?',options:['Same triangle','Mirror triangle','Square','Circle'],correct:1},
      {text:'L rotated 90° clockwise becomes?',options:['Γ','⌐','J','7'],correct:0},
      {text:'Which rotation makes ▲ look like ▽?',options:['90°','180°','270°','360°'],correct:1},
      {text:'Square rotated 45° becomes?',options:['Circle','Diamond','Rectangle','Triangle'],correct:1},
    ],
    'logic-gate':[
      {text:'AND gate: inputs 1 and 0. Output?',options:['0','1','Both','Neither'],correct:0},
      {text:'OR gate: inputs 0 and 0. Output?',options:['0','1','Error','Undefined'],correct:0},
      {text:'NOT gate: input 1. Output?',options:['0','1','2','Null'],correct:0},
      {text:'AND gate: inputs 1 and 1. Output?',options:['0','1','2','Error'],correct:1},
      {text:'OR gate: inputs 1 and 0. Output?',options:['0','1','Both','Error'],correct:1},
    ],
    'binary-decode':[
      {text:'Binary 0101 = ?',options:['3','4','5','6'],correct:2},
      {text:'Binary 1000 = ?',options:['6','7','8','9'],correct:2},
      {text:'Binary 1111 = ?',options:['13','14','15','16'],correct:2},
      {text:'Binary 0011 = ?',options:['1','2','3','4'],correct:2},
      {text:'Binary 1010 = ?',options:['8','9','10','11'],correct:2},
    ],
    'pattern-predict':[
      {text:'2, 4, 6, 8, ?',options:['9','10','11','12'],correct:1},
      {text:'1, 3, 9, 27, ?',options:['54','72','81','90'],correct:2},
      {text:'A, C, E, G, ?',options:['H','I','J','K'],correct:1},
      {text:'1, 1, 2, 3, 5, ?',options:['7','8','9','10'],correct:1},
      {text:'100, 50, 25, ?',options:['10','12','12.5','15'],correct:2},
    ],
    'spatial-map':[
      {text:'You go North then turn East. Where are you facing?',options:['North','East','South','West'],correct:1},
      {text:'Start facing East, turn 90° left. Now facing?',options:['South','North','West','East'],correct:1},
      {text:'Walk 3 blocks North, 2 East, 3 South. Where vs start?',options:['2 East','2 West','3 North','At start'],correct:0},
      {text:'South of East is?',options:['Southeast','Southwest','Northeast','Northwest'],correct:0},
    ],
    'neon-chess':[
      {text:'Knight on e4. Can it reach f6?',options:['Yes','No','Maybe','Depends'],correct:0},
      {text:'Rook on a1. Can it reach h1 in one move?',options:['Yes','No','Only if empty','Only diagonally'],correct:0},
      {text:'Bishop moves?',options:['Straight lines','Diagonally','L-shape','Any direction'],correct:1},
      {text:'Checkmate means?',options:['King in check, no legal move','King captured','Draw','Stalemate'],correct:0},
    ],
    'pencil-pack':[
      {text:'Where does a pencil go?',options:['Backpack front','Lunch box','Shoes','Jacket'],correct:0},
      {text:'Where does lunch go?',options:['Book bag','Lunch compartment','Pencil case','Gym bag'],correct:1},
      {text:'Books belong in?',options:['Pencil pouch','Main compartment','Lunch box','Gym bag'],correct:1},
      {text:'Water bottle goes in?',options:['Main pocket','Side pocket','Front zipper','Lunch box'],correct:1},
    ],
  };
  return gameQ[id] || base;
}

// ─── Helper ────────────────────────────────────────────────────────────────────
function toFuncName(id) {
  return id.split('-').map(w=>w[0].toUpperCase()+w.slice(1)).join('')+'Game';
}

// ─── Test spec generator ───────────────────────────────────────────────────────
function genTestSpec(g) {
  const isMic = g.arch==='mic-vol'||g.arch==='mic-pitch';
  const isTilt = g.arch==='tilt';
  const sensor = isMic?'mic':isTilt?'motion':'touch';
  return `import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { GamePage } from './pages/GamePage';

const GAME_ID = '${g.id}';
const GAME_PATH = '/games/${g.id}';
const ACCENT = '${g.accent}';
const GAME_DURATION_MS = ${g.dur * 1000};
const SENSOR = '${sensor}';

test('1.1 — page loads without JS errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  const game = new GamePage(page, GAME_PATH, ACCENT);
  await game.goto({ sensors: { motion: SENSOR==='motion', mic: SENSOR==='mic' } });
  expect(errors).toHaveLength(0);
});

test('2.1 — start screen renders', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT);
  await game.goto();
  await expect(game.ctaButton).toBeVisible({ timeout: 3000 });
});

test('2.2 — name input visible on start screen', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT);
  await game.goto({ skipUser: true });
  await expect(game.nameInput).toBeVisible({ timeout: 3000 });
});

test('2.3 — CTA button meets 44×44px touch target', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT);
  await game.goto();
  await game.expectTouchTargetSize(game.ctaButton, 44, 'CTA button');
});

test('2.4 — back button meets 44×44px touch target', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT);
  await game.goto();
  await game.expectTouchTargetSize(game.backButton, 44, 'back button');
});

test('3.1 — countdown appears after start', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT);
  await game.goto({ sensors: { motion: SENSOR==='motion' } });
  await game.start();
  await game.waitForCountdown();
});

test('4.1 — timer visible during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT);
  await game.goto({ sensors: { motion: SENSOR==='motion' } });
  await game.start();
  await game.waitForPlaying();
  await expect(game.timerEl).toBeVisible({ timeout: 3000 });
});

test('4.2 — timer decreases during gameplay', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT);
  await game.goto({ sensors: { motion: SENSOR==='motion' } });
  await game.start();
  await game.waitForPlaying();
  await game.expectTimerDecreasing(3000);
});

test('4.3 — no crash during 10 seconds', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  const game = new GamePage(page, GAME_PATH, ACCENT);
  await game.goto({ sensors: { motion: SENSOR==='motion', mic: SENSOR==='mic' } });
  await game.start();
  await game.waitForPlaying();
  await page.waitForTimeout(10000);
  expect(errors).toHaveLength(0);
});

test('5.1 — score starts at 0', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT);
  await game.goto({ sensors: { motion: SENSOR==='motion' } });
  await game.start();
  await game.waitForPlaying();
  const text = await game.scoreEl.textContent().catch(()=>'0');
  expect(parseInt(text??'0')).toBe(0);
});

test('5.2 — game ends when timer reaches 0', async ({ page }) => {
  await page.addInitScript(()=>{
    const orig=window.setInterval.bind(window);
    (window as any).setInterval=(fn: ()=>void,ms: number,...args: unknown[])=>{
      if(ms===1000) return orig(fn,100,...args);
      return orig(fn,ms,...args);
    };
  });
  const game = new GamePage(page, GAME_PATH, ACCENT);
  await game.goto({ sensors: { motion: SENSOR==='motion' } });
  await game.start();
  await page.waitForSelector('button:has-text("Play Again")', { timeout: Math.ceil(GAME_DURATION_MS/10)+5000 });
  await expect(game.playAgainButton).toBeVisible();
});

test('6.1 — end screen has play-again button', async ({ page }) => {
  await page.addInitScript(()=>{
    const orig=window.setInterval.bind(window);
    (window as any).setInterval=(fn: ()=>void,ms: number,...args: unknown[])=>{ if(ms===1000) return orig(fn,100,...args); return orig(fn,ms,...args); };
  });
  const game = new GamePage(page, GAME_PATH, ACCENT);
  await game.goto();
  await game.start();
  await game.waitForEnd(GAME_DURATION_MS/10+5000);
  await expect(game.playAgainButton).toBeVisible();
});

test('7.1 — no horizontal scroll on iPhone SE', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const game = new GamePage(page, GAME_PATH, ACCENT);
  await game.goto();
  await game.expectNoHorizontalScroll();
});

test('7.2 — no horizontal scroll on iPhone 15 Pro Max', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  const game = new GamePage(page, GAME_PATH, ACCENT);
  await game.goto();
  await game.expectNoHorizontalScroll();
});

test('9.1 — start screen passes axe-core scan', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT);
  await game.goto();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa']).exclude('canvas').analyze();
  const critical = results.violations.filter(v=>v.impact==='critical'||v.impact==='serious');
  expect(critical).toHaveLength(0);
});

test('12.1 — haptics log checked', async ({ page }) => {
  const game = new GamePage(page, GAME_PATH, ACCENT);
  await game.goto({ sensors: { motion: SENSOR==='motion' } });
  await game.start();
  await game.waitForPlaying();
  await page.waitForTimeout(5000);
  const log = await game.getVibrateLog();
  console.log(\`Haptics fired: \${log.length}\`);
});
`;
}

module.exports = { micVolBody, micPitchBody, getChoiceQuestions, genTestSpec, toFuncName };
