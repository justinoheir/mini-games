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

const GAME_ID    = 'morse-tap';
const ACCENT     = '#fbbf24';
const DURATION   = 45;
const GAME_EMOJI = '📡';
const GAME_TITLE = 'Morse Tap';
const GAME_TAGLINE = 'Tap the code. Send the message.';

// Morse code dictionary
const MORSE: Record<string, string> = {
  A:'.-', B:'-...', C:'-.-.', D:'-..', E:'.', F:'..-.',
  G:'--.', H:'....', I:'..', J:'.---', K:'-.-', L:'.-..',
  M:'--', N:'-.', O:'---', P:'.--.', R:'.-.', S:'...',
  T:'-', U:'..-', V:'...-', W:'.--', X:'-..-', Y:'-.--',
};

// Simple letters with short codes
const EASY_LETTERS = ['E','I','T','A','N','S','M','O','R','U'];
const MED_LETTERS  = ['K','D','G','B','L','F','H','P','W','J'];

interface Signals {
  correctLetters: number;
  wrongAttempts: number;
  letterStreak: number;
  maxStreak: number;
  score: number;
}

function getPersonality(s: Signals): string {
  if (s.correctLetters>=15&&s.wrongAttempts<=2) return 'Telegraph Master 📡';
  if (s.correctLetters>=10)                    return 'Radio Operator 📻';
  if (s.wrongAttempts>=8)                      return 'Static Noise 📺';
  if (s.letterStreak>=5)                       return 'Dot Dash Pro ⚡';
  return 'Signal Learner 🔉';
}

type Phase = 'start'|'countdown'|'playing'|'done';
type TapPhase = 'tapping'|'result';

interface GS {
  running:boolean; timeLeft:number; sig:Signals;
  currentLetter:string; expectedMorse:string; enteredMorse:string;
  tapPhase:TapPhase; tapHeldStart:number; isHeld:boolean;
  resultTimer:number; resultOk:boolean;
  letters:string[]; letterIdx:number;
  submissions:Array<{time:number;symbol:string}>;
}

export default function MorseTapGame() {
  const theme = useBrandTheme();
  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{correctLetters:0,wrongAttempts:0,letterStreak:0,maxStreak:0,score:0},
    currentLetter:'E',expectedMorse:'.',enteredMorse:'',
    tapPhase:'tapping',tapHeldStart:0,isHeld:false,
    resultTimer:0,resultOk:true,
    letters:[],letterIdx:0,submissions:[],
  });
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const symbolTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);

  const [phase,setPhase]        = useState<Phase>('start');
  const [timeLeft,setTimeLeft]  = useState(DURATION);
  const [scoreDisplay,setScore] = useState(0);
  const [finalSig,setFinalSig]  = useState<Signals|null>(null);
  const [uiState,setUiState]    = useState({letter:'E',morse:'.',entered:'',result:''});
  const playerSessionRef = useRef<PlayerSession|null>(null);
  const ACCENT_USE = theme.colors.accent ?? ACCENT;

  const endGame = useCallback(()=>{
    const s=stateRef.current; s.running=false;
    if(timerRef.current){ clearInterval(timerRef.current); timerRef.current=null; }
    if(symbolTimerRef.current){ clearTimeout(symbolTimerRef.current); symbolTimerRef.current=null; }
    const pb=parseInt(localStorage.getItem('pb_'+GAME_ID)??"0");
    if(s.sig.score>pb) localStorage.setItem('pb_'+GAME_ID,String(s.sig.score));
    setFinalSig({...s.sig}); setPhase('done'); hapticVictory();
  },[]);

  const nextLetter = useCallback(()=>{
    const s=stateRef.current;
    s.letterIdx=(s.letterIdx+1)%s.letters.length;
    s.currentLetter=s.letters[s.letterIdx];
    s.expectedMorse=MORSE[s.currentLetter]??'.';
    s.enteredMorse='';
    s.tapPhase='tapping';
    setUiState({letter:s.currentLetter,morse:s.expectedMorse,entered:'',result:''});
  },[]);

  const checkMorse = useCallback(()=>{
    const s=stateRef.current; if(!s.running) return;
    if(symbolTimerRef.current){ clearTimeout(symbolTimerRef.current); symbolTimerRef.current=null; }
    if(s.enteredMorse===s.expectedMorse){
      s.sig.correctLetters++; s.sig.letterStreak++;
      if(s.sig.letterStreak>s.sig.maxStreak) s.sig.maxStreak=s.sig.letterStreak;
      const pts=s.sig.letterStreak>=3?3:2; s.sig.score+=pts;
      setScore(s.sig.score); sfx.success(); hapticScore();
      if(s.sig.letterStreak>=3) hapticCombo(s.sig.letterStreak);
      s.tapPhase='result'; s.resultOk=true; s.resultTimer=60;
      setUiState(u=>({...u,result:'✓ Correct!'}));
      setTimeout(()=>nextLetter(),800);
    } else {
      s.sig.wrongAttempts++; s.sig.letterStreak=0;
      sfx.collision(); hapticFail();
      s.tapPhase='result'; s.resultOk=false; s.resultTimer=50;
      setUiState(u=>({...u,result:`✗ Got ${s.enteredMorse}, want ${s.expectedMorse}`}));
      setTimeout(()=>nextLetter(),900);
    }
  },[nextLetter]);

  const startGame = useCallback(()=>{
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION;
    s.sig={correctLetters:0,wrongAttempts:0,letterStreak:0,maxStreak:0,score:0};
    // Build letter sequence
    const seq=[...EASY_LETTERS,...MED_LETTERS,...EASY_LETTERS].sort(()=>Math.random()-0.5);
    s.letters=seq; s.letterIdx=0;
    s.currentLetter=seq[0]; s.expectedMorse=MORSE[seq[0]]??'.';
    s.enteredMorse=''; s.tapPhase='tapping'; s.isHeld=false;
    setUiState({letter:seq[0],morse:MORSE[seq[0]]??'.',entered:'',result:''});
    setScore(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current=setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if(s.timeLeft<=0){ sfx.fail(); endGame(); }
    },1000);
  },[endGame]);

  const handlePointerDown = useCallback(()=>{
    const s=stateRef.current; if(!s.running||s.tapPhase==='result') return;
    s.isHeld=true; s.tapHeldStart=Date.now();
  },[]);

  const handlePointerUp = useCallback(()=>{
    const s=stateRef.current; if(!s.running||!s.isHeld||s.tapPhase==='result') return;
    s.isHeld=false;
    const held=Date.now()-s.tapHeldStart;
    const symbol=held>=300?'-':'.'; // 300ms threshold for dash
    s.enteredMorse+=symbol;
    sfx.click(); hapticScore();
    setUiState(u=>({...u,entered:s.enteredMorse}));

    // Auto-check if we've entered enough symbols
    if(s.enteredMorse.length>=s.expectedMorse.length){
      symbolTimerRef.current=setTimeout(()=>checkMorse(),400);
    } else {
      // Wait for more taps (500ms gap = end of letter)
      if(symbolTimerRef.current) clearTimeout(symbolTimerRef.current);
      symbolTimerRef.current=setTimeout(()=>checkMorse(),500);
    }
  },[checkMorse]);

  useEffect(()=>()=>{ if(timerRef.current) clearInterval(timerRef.current); if(symbolTimerRef.current) clearTimeout(symbolTimerRef.current); },[]);

  const handleStart=useCallback(async(n:string,a:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,n,a); await initAudio(); setPhase('countdown');
  },[]);
  const handlePlayAgain=useCallback(()=>{ setPhase('start'); setScore(0); setTimeLeft(DURATION); setFinalSig(null); },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={ACCENT_USE}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
        ctaLabel="Start Transmitting 📡" accentColor={ACCENT_USE} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startGame} accentColor={ACCENT_USE}/>}

      {phase==='playing'&&(
        <div style={{position:'absolute',inset:0,background:'#0a0800',display:'flex',flexDirection:'column',fontFamily:'monospace',overflow:'hidden'}}>
          <GameHUD accentColor={ACCENT_USE} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>

          {/* Main display */}
          <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'24px',padding:'16px'}}>

            {/* Letter to encode */}
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:'12px',color:'rgba(255,200,80,0.6)',marginBottom:'8px',letterSpacing:'0.1em'}}>ENCODE THIS LETTER</div>
              <div style={{fontSize:'80px',fontWeight:'bold',color:ACCENT_USE,lineHeight:1,
                filter:`drop-shadow(0 0 20px ${ACCENT_USE}88)`}}>
                {uiState.letter}
              </div>
              {/* Morse reference */}
              <div style={{marginTop:'12px',fontSize:'28px',letterSpacing:'8px',color:'rgba(251,191,36,0.4)'}}>
                {uiState.morse.split('').map((c,i)=>(
                  <span key={i} style={{opacity:uiState.entered.length>i?1:0.3}}>
                    {c==='.'?'●':'▬'}
                  </span>
                ))}
              </div>
            </div>

            {/* What user typed */}
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:'11px',color:'rgba(255,255,255,0.4)',marginBottom:'6px'}}>YOUR INPUT</div>
              <div style={{fontSize:'28px',letterSpacing:'6px',minHeight:'40px',color:'#fff'}}>
                {uiState.entered.split('').map((c,i)=>(
                  <span key={i}>{c==='.'?'●':'▬'} </span>
                ))}
              </div>
            </div>

            {/* Result */}
            {uiState.result&&(
              <div style={{fontSize:'18px',fontWeight:'bold',
                color:uiState.result.startsWith('✓')?'#4ade80':'#ef4444',
                textAlign:'center'}}>
                {uiState.result}
              </div>
            )}
          </div>

          {/* Tap button */}
          <div style={{padding:'16px 24px 32px',display:'flex',flexDirection:'column',alignItems:'center',gap:'8px'}}>
            <div style={{fontSize:'11px',color:'rgba(255,255,255,0.4)'}}>
              Short tap = dot (·) | Long hold = dash (—)
            </div>
            <button
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              style={{
                width:'100%',maxWidth:'300px',height:'72px',
                background:ACCENT_USE+'22',
                border:`3px solid ${ACCENT_USE}`,
                borderRadius:'12px',
                color:ACCENT_USE,fontSize:'20px',fontWeight:'bold',
                cursor:'pointer',touchAction:'none',
                boxShadow:`0 0 20px ${ACCENT_USE}44`,
                fontFamily:'monospace',
              }}>
              TAP / HOLD
            </button>
          </div>
        </div>
      )}

      {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
        score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[
          {label:'Letters Sent',value:`${finalSig.correctLetters}`,color:'#4ade80'},
          {label:'Wrong',value:`${finalSig.wrongAttempts}`,color:finalSig.wrongAttempts===0?'#4ade80':'#ef4444'},
          {label:'Best Streak',value:`×${finalSig.maxStreak}`,color:ACCENT_USE},
          {label:'Score',value:`${finalSig.score}`,color:'#fbbf24'},
        ]}
        accentColor={ACCENT_USE} onPlayAgain={handlePlayAgain} didWin={finalSig.correctLetters>=10}/>}
    </GameShell>
  );
}
