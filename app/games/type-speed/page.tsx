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

const GAME_ID    = 'type-speed';
const ACCENT     = '#e879f9';
const DURATION   = 30;
const GAME_EMOJI = '⌨️';
const GAME_TITLE = 'Type Speed';
const GAME_TAGLINE = 'Type it fast. Beat the buzzer.';

const WORDS = [
  'cat','dog','sun','run','hot','big','red','fly','sky','fun',
  'map','cup','hat','pen','zip','fog','joy','gem','dew','fix',
  'data','code','fast','play','neon','glow','tech','sync','loop','byte',
  'swift','sharp','click','flash','pulse','sonic','pixel','cyber','turbo',
];

const KEYBOARD_ROWS = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['⌫','Z','X','C','V','B','N','M','↵'],
];

interface Signals {
  wordsTyped: number;
  wrongKeys: number;
  accuracy: number;
  wpm: number;
  maxStreak: number;
  streakCurrent: number;
  score: number;
}

function getPersonality(s: Signals): string {
  if (s.wpm>=40&&s.wrongKeys<=3) return 'Speed Typist ⚡';
  if (s.wordsTyped>=10)          return 'Keyboard Warrior 💪';
  if (s.wrongKeys>=8)            return 'Hunt & Pecker 🔍';
  if (s.accuracy>=90)            return 'Precision Typer 🎯';
  return 'Two-Finger Hero 🖐️';
}

type Phase = 'start'|'countdown'|'playing'|'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals; startTime: number;
  currentWord: string; typedSoFar: string;
  wordIdx: number; totalKeyPresses: number;
  shakeTimer: number; correctFlash: number;
}

export default function TypeSpeedGame() {
  const theme = useBrandTheme();
  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{wordsTyped:0,wrongKeys:0,accuracy:0,wpm:0,maxStreak:0,streakCurrent:0,score:0},
    startTime:0,currentWord:'',typedSoFar:'',wordIdx:0,totalKeyPresses:0,
    shakeTimer:0,correctFlash:0,
  });
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const animRef  = useRef(0);

  const [phase,setPhase]        = useState<Phase>('start');
  const [timeLeft,setTimeLeft]  = useState(DURATION);
  const [scoreDisplay,setScore] = useState(0);
  const [finalSig,setFinalSig]  = useState<Signals|null>(null);
  const [currentWord,setCurrentWord] = useState('');
  const [typedSoFar,setTyped]   = useState('');
  const [shake,setShake]        = useState(false);
  const [flashOk,setFlashOk]    = useState(false);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const shuffledWords = useRef([...WORDS].sort(()=>Math.random()-0.5));

  const endGame = useCallback(()=>{
    const s=stateRef.current; s.running=false;
    if(timerRef.current){ clearInterval(timerRef.current); timerRef.current=null; }
    const elapsed=(Date.now()-s.startTime)/60000;
    s.sig.wpm=elapsed>0?Math.round(s.sig.wordsTyped/elapsed):0;
    s.sig.accuracy=s.totalKeyPresses>0?Math.round(((s.totalKeyPresses-s.sig.wrongKeys)/s.totalKeyPresses)*100):100;
    const pb=parseInt(localStorage.getItem('pb_'+GAME_ID)??"0");
    if(s.sig.score>pb) localStorage.setItem('pb_'+GAME_ID,String(s.sig.score));
    setFinalSig({...s.sig}); setPhase('done'); hapticVictory();
  },[]);

  const pickNextWord = useCallback(()=>{
    const s=stateRef.current;
    s.wordIdx=(s.wordIdx+1)%shuffledWords.current.length;
    s.currentWord=shuffledWords.current[s.wordIdx].toUpperCase();
    s.typedSoFar='';
    setCurrentWord(s.currentWord);
    setTyped('');
  },[]);

  const handleKeyPress = useCallback((key:string)=>{
    const s=stateRef.current; if(!s.running) return;
    s.totalKeyPresses++;

    if(key==='⌫'){
      s.typedSoFar=s.typedSoFar.slice(0,-1);
      setTyped(s.typedSoFar); return;
    }
    if(key==='↵'){
      if(s.typedSoFar===s.currentWord){
        // Word complete
        s.sig.wordsTyped++; s.sig.streakCurrent++;
        if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
        const pts=s.sig.streakCurrent>=3?3:2; s.sig.score+=pts;
        setScore(s.sig.score); sfx.collect(); hapticScore();
        if(s.sig.streakCurrent>=3) hapticCombo(s.sig.streakCurrent);
        s.correctFlash=1; setFlashOk(true);
        setTimeout(()=>setFlashOk(false),200);
        pickNextWord();
      } else {
        s.sig.wrongKeys++; s.sig.streakCurrent=0;
        sfx.collision(); hapticFail();
        setShake(true); setTimeout(()=>setShake(false),300);
      }
      return;
    }

    const expected=s.currentWord[s.typedSoFar.length];
    if(key===expected){
      s.typedSoFar+=key;
      setTyped(s.typedSoFar);
      sfx.click();
      // Auto-complete when last letter typed
      if(s.typedSoFar===s.currentWord){
        s.sig.wordsTyped++; s.sig.streakCurrent++;
        if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
        const pts=s.sig.streakCurrent>=3?3:2; s.sig.score+=pts;
        setScore(s.sig.score); sfx.success(); hapticScore();
        if(s.sig.streakCurrent>=3) hapticCombo(s.sig.streakCurrent);
        s.correctFlash=1; setFlashOk(true);
        setTimeout(()=>setFlashOk(false),300);
        setTimeout(()=>pickNextWord(),180);
      }
    } else {
      s.sig.wrongKeys++; s.sig.streakCurrent=0;
      sfx.collision(); hapticFail();
      setShake(true); setTimeout(()=>setShake(false),300);
    }
  },[pickNextWord]);

  const startGame = useCallback(()=>{
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION;
    s.sig={wordsTyped:0,wrongKeys:0,accuracy:0,wpm:0,maxStreak:0,streakCurrent:0,score:0};
    s.wordIdx=0; s.totalKeyPresses=0; s.startTime=Date.now();
    shuffledWords.current=[...WORDS].sort(()=>Math.random()-0.5);
    s.currentWord=shuffledWords.current[0].toUpperCase();
    s.typedSoFar='';
    setCurrentWord(s.currentWord); setTyped(''); setScore(0); setTimeLeft(DURATION);
    setPhase('playing');

    timerRef.current=setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if(s.timeLeft<=0){ sfx.fail(); endGame(); }
    },1000);
  },[endGame]);

  useEffect(()=>()=>{ if(timerRef.current) clearInterval(timerRef.current); },[]);

  const handleStart=useCallback(async(n:string,a:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,n,a); await initAudio(); setPhase('countdown');
  },[]);
  const handlePlayAgain=useCallback(()=>{ setPhase('start'); setScore(0); setTimeLeft(DURATION); setFinalSig(null); setCurrentWord(''); setTyped(''); },[]);

  const ACCENT_USE = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={ACCENT_USE}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
        ctaLabel="Start Typing ⌨️" accentColor={ACCENT_USE} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startGame} accentColor={ACCENT_USE}/>}

      {phase==='playing'&&(
        <div style={{position:'absolute',inset:0,background:'#0a0015',display:'flex',flexDirection:'column',padding:'0',overflow:'hidden'}}>
          <GameHUD accentColor={ACCENT_USE} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>

          {/* Word display */}
          <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'16px',padding:'0 16px'}}>
            <div style={{
              fontSize:'clamp(28px,8vw,52px)',fontWeight:'bold',letterSpacing:'0.12em',
              color: flashOk?'#4ade80':ACCENT_USE,
              transition:'color 0.1s',
              filter:`drop-shadow(0 0 12px ${flashOk?'#4ade80':ACCENT_USE})`,
              animation: shake?'shake 0.3s ease':'none',
            }}>
              {currentWord.split('').map((ch,i)=>(
                <span key={i} style={{color:i<typedSoFar.length?'#4ade80':i===typedSoFar.length?'#fff':'rgba(255,255,255,0.3)'}}>
                  {ch}
                </span>
              ))}
            </div>
            <div style={{color:'rgba(255,255,255,0.4)',fontSize:'14px'}}>
              {typedSoFar.length}/{currentWord.length} letters
            </div>
          </div>

          {/* On-screen keyboard */}
          <div style={{padding:'8px 4px 12px',background:'rgba(0,0,0,0.4)'}}>
            {KEYBOARD_ROWS.map((row,ri)=>(
              <div key={ri} style={{display:'flex',justifyContent:'center',gap:'4px',marginBottom:'4px'}}>
                {row.map(key=>{
                  const isTyped=typedSoFar.includes(key);
                  const isNext=key===currentWord[typedSoFar.length];
                  return (
                    <button key={key} onClick={()=>handleKeyPress(key)}
                      style={{
                        minWidth:key.length>1?'44px':'36px',height:'44px',
                        background:isNext?ACCENT_USE+'44':'rgba(255,255,255,0.07)',
                        border:`1px solid ${isNext?ACCENT_USE:'rgba(255,255,255,0.1)'}`,
                        borderRadius:'6px',color:isNext?ACCENT_USE:'rgba(255,255,255,0.8)',
                        fontSize:key.length>1?'13px':'16px',fontWeight:'bold',
                        boxShadow:isNext?`0 0 8px ${ACCENT_USE}66`:'none',
                        cursor:'pointer',transition:'all 0.1s',
                      }}>
                      {key}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
        score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[
          {label:'Words Typed',value:`${finalSig.wordsTyped}`,color:'#4ade80'},
          {label:'WPM',value:`${finalSig.wpm}`,color:ACCENT_USE},
          {label:'Accuracy',value:`${finalSig.accuracy}%`,color:finalSig.accuracy>=90?'#4ade80':'#fbbf24'},
          {label:'Best Streak',value:`×${finalSig.maxStreak}`,color:'#fbbf24'},
        ]}
        accentColor={ACCENT_USE} onPlayAgain={handlePlayAgain} didWin={finalSig.wordsTyped>=8}/>}
    </GameShell>
  );
}
