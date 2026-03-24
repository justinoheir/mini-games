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

const GAME_ID    = 'neon-chess';
const ACCENT     = '#00ffff';
const DURATION   = 60;
const GAME_EMOJI = '♟️';
const GAME_TITLE = 'Neon Chess';
const GAME_TAGLINE = 'One move. Best move. Neon style.';

// Simple chess puzzles: [board state, correct move]
// Board: 8x8, pieces: K=king, Q=queen, R=rook, B=bishop, N=knight, P=pawn
// Lowercase = black, uppercase = white (player is always white)
// Each puzzle: tap the white piece, then tap destination

type PieceType = 'K'|'Q'|'R'|'B'|'N'|'P'|'k'|'q'|'r'|'b'|'n'|'p'|null;

interface Puzzle {
  board: PieceType[][];
  correctFrom: [number,number];  // [row,col]
  correctTo: [number,number];
  hint: string;
}

// Simplified puzzles (checkmates in 1)
const PUZZLES: Puzzle[] = [
  {
    board: [
      [null,null,null,null,'k',null,null,null],
      [null,null,null,null,'p','p',null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,'Q',null,null],
      [null,null,null,null,'K',null,null,null],
    ],
    correctFrom:[6,5],correctTo:[0,5],hint:'Queen to f8#'
  },
  {
    board: [
      [null,null,null,null,'k',null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,'R'],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,'K',null,null,null],
    ],
    correctFrom:[2,7],correctTo:[0,7],hint:'Rook to h8#'
  },
  {
    board: [
      [null,'k',null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      ['R',null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      ['K',null,null,null,null,null,null,null],
    ],
    correctFrom:[2,0],correctTo:[0,0],hint:'Rook to a8#'
  },
  {
    board: [
      [null,null,null,null,'k',null,null,null],
      ['Q',null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,'K',null,null,null],
    ],
    correctFrom:[1,0],correctTo:[1,4],hint:'Queen to e7#'
  },
  {
    board: [
      [null,null,null,null,'k',null,null,null],
      [null,null,null,null,'P','P','P',null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,'Q',null,null,null,null,null,null],
      [null,null,null,null,'K',null,null,null],
    ],
    correctFrom:[6,1],correctTo:[0,1],hint:'Queen to b8#'
  },
  {
    board: [
      ['r',null,null,'k',null,null,null,'r'],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],
      [null,'R',null,null,'K',null,null,null],
    ],
    correctFrom:[7,1],correctTo:[0,1],hint:'Rook to b8#'
  },
];

interface Signals {
  correctMoves: number;
  wrongMoves: number;
  avgTimeMs: number;
  streakBest: number;
  streakCurrent: number;
  score: number;
}

function getPersonality(s: Signals): string {
  const acc=s.correctMoves+s.wrongMoves>0?s.correctMoves/(s.correctMoves+s.wrongMoves):0;
  if (acc>=0.9&&s.streakBest>=4) return 'Grandmaster ♔';
  if (acc>=0.75)                 return 'Tactician 🎯';
  if (s.wrongMoves>=5)          return 'Blunder King 👑';
  if (s.correctMoves>=6)        return 'Puzzle Solver ♟️';
  return 'Opening Theory 📚';
}

type Phase = 'start'|'countdown'|'playing'|'done';
type SubPhase = 'select'|'move'|'feedback';

interface GS {
  running:boolean; timeLeft:number; sig:Signals; frame:number; accentColor:string;
  puzzle:Puzzle; puzzleIdx:number;
  selectedPiece:[number,number]|null;
  subPhase:SubPhase; feedbackOk:boolean; feedbackTimer:number;
  puzzleStart:number;
  timings:number[];
}

export default function NeonChessGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef(0);
  const timerRef  = useRef<ReturnType<typeof setInterval>|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{correctMoves:0,wrongMoves:0,avgTimeMs:0,streakBest:0,streakCurrent:0,score:0},
    frame:0,accentColor:ACCENT,
    puzzle:PUZZLES[0],puzzleIdx:0,
    selectedPiece:null,subPhase:'select',feedbackOk:true,feedbackTimer:0,
    puzzleStart:0,timings:[],
  });

  const [phase,setPhase]        = useState<Phase>('start');
  const [timeLeft,setTimeLeft]  = useState(DURATION);
  const [scoreDisplay,setScore] = useState(0);
  const [finalSig,setFinalSig]  = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);
  useEffect(()=>{ stateRef.current.accentColor=theme.colors.accent??ACCENT; },[theme]);

  const endGame = useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){ clearInterval(timerRef.current); timerRef.current=null; }
    const pb=parseInt(localStorage.getItem('pb_'+GAME_ID)??"0");
    if(s.sig.score>pb) localStorage.setItem('pb_'+GAME_ID,String(s.sig.score));
    s.sig.avgTimeMs=s.timings.length>0?Math.round(s.timings.reduce((a,b)=>a+b,0)/s.timings.length):0;
    setFinalSig({...s.sig}); setPhase('done'); hapticVictory();
  },[]);

  const nextPuzzle = useCallback((s:GS)=>{
    s.puzzleIdx=(s.puzzleIdx+1)%PUZZLES.length;
    s.puzzle=PUZZLES[s.puzzleIdx];
    s.selectedPiece=null; s.subPhase='select'; s.puzzleStart=Date.now();
  },[]);

  const startLoop = useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION; s.frame=0;
    s.sig={correctMoves:0,wrongMoves:0,avgTimeMs:0,streakBest:0,streakCurrent:0,score:0};
    s.puzzleIdx=0; s.puzzle=PUZZLES[0]; s.selectedPiece=null;
    s.subPhase='select'; s.feedbackTimer=0; s.timings=[];
    s.puzzleStart=Date.now();
    setScore(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current=setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if(s.timeLeft<=0){ sfx.fail(); endGame(); }
    },1000);

    const PIECE_SYMBOLS:Record<string,string>={
      'K':'♔','Q':'♕','R':'♖','B':'♗','N':'♘','P':'♙',
      'k':'♚','q':'♛','r':'♜','b':'♝','n':'♞','p':'♟',
    };

    const loop=()=>{
      if(!s.running) return; s.frame++;
      const W=canvas.width,H=canvas.height;

      // Dark cyber background
      ctx.fillStyle='#050f1a'; ctx.fillRect(0,0,W,H);

      // Board dimensions
      const boardSize=Math.min(W*0.9,H*0.75);
      const cellSize=boardSize/8;
      const bx=(W-boardSize)/2, by=(H-boardSize)/2+20;

      // Draw board
      for(let row=0;row<8;row++){
        for(let col=0;col<8;col++){
          const light=(row+col)%2===0;
          const isSelected=s.selectedPiece&&s.selectedPiece[0]===row&&s.selectedPiece[1]===col;
          const isFrom=s.puzzle.correctFrom[0]===row&&s.puzzle.correctFrom[1]===col;
          const isTo=s.puzzle.correctTo[0]===row&&s.puzzle.correctTo[1]===col;
          ctx.fillStyle=isSelected?'#00ffff33':
            (s.subPhase==='feedback'&&s.feedbackOk&&(isFrom||isTo))?'#00ff0033':
            (s.subPhase==='feedback'&&!s.feedbackOk)?'#ff000022':
            light?'#0f2030':'#061018';
          ctx.fillRect(bx+col*cellSize,by+row*cellSize,cellSize,cellSize);
          if(isSelected){
            ctx.strokeStyle='#00ffff'; ctx.lineWidth=2;
            ctx.strokeRect(bx+col*cellSize+1,by+row*cellSize+1,cellSize-2,cellSize-2);
          }
        }
      }

      // Board border (neon)
      ctx.strokeStyle='#00ffff44'; ctx.lineWidth=2;
      ctx.strokeRect(bx,by,boardSize,boardSize);

      // Draw pieces
      for(let row=0;row<8;row++){
        for(let col=0;col<8;col++){
          const piece=s.puzzle.board[row][col];
          if(!piece) continue;
          const isWhite=piece===piece.toUpperCase();
          const cx=bx+col*cellSize+cellSize/2, cy=by+row*cellSize+cellSize/2;
          ctx.save();
          if(isWhite){ ctx.shadowBlur=8; ctx.shadowColor='#00ffff'; }
          ctx.fillStyle=isWhite?'#00ffff':'#ff6b6b';
          ctx.font=`bold ${Math.round(cellSize*0.72)}px sans-serif`;
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText(PIECE_SYMBOLS[piece]??piece,cx,cy);
          ctx.restore();
        }
      }

      // Possible destination highlight (when piece selected)
      if(s.selectedPiece){
        const [fr,fc]=s.selectedPiece;
        ctx.save(); ctx.globalAlpha=0.5+Math.sin(s.frame*0.2)*0.2;
        ctx.fillStyle='#00ffff';
        ctx.beginPath();
        ctx.arc(bx+s.puzzle.correctTo[1]*cellSize+cellSize/2,
                by+s.puzzle.correctTo[0]*cellSize+cellSize/2, cellSize*0.15,0,Math.PI*2);
        ctx.fill(); ctx.restore();
      }

      // Instruction text
      const instrY=by+boardSize+25;
      ctx.fillStyle='rgba(0,255,255,0.7)'; ctx.font='14px sans-serif'; ctx.textAlign='center';
      if(s.subPhase==='select') ctx.fillText('Tap a white piece to select it',W/2,instrY);
      else if(s.subPhase==='move') ctx.fillText('Now tap the best destination!',W/2,instrY);
      else {
        ctx.fillStyle=s.feedbackOk?'rgba(100,255,100,0.9)':'rgba(255,100,100,0.9)';
        ctx.fillText(s.feedbackOk?`✓ ${s.puzzle.hint}`:`✗ Wrong — ${s.puzzle.hint}`,W/2,instrY);
      }

      // Feedback flash
      if(s.subPhase==='feedback'){
        s.feedbackTimer--;
        if(s.feedbackTimer<=0) nextPuzzle(s);
      }

      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,nextPuzzle]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{ canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; };
    resize(); window.addEventListener('resize',resize);

    const onPD=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const s=stateRef.current; if(s.subPhase==='feedback') return;
      const rect=canvas.getBoundingClientRect();
      const cx=(e.clientX-rect.left)*(canvas.width/rect.width);
      const cy=(e.clientY-rect.top)*(canvas.height/rect.height);
      const W=canvas.width,H=canvas.height;
      const boardSize=Math.min(W*0.9,H*0.75);
      const cellSize=boardSize/8;
      const bx=(W-boardSize)/2, by=(H-boardSize)/2+20;
      const col=Math.floor((cx-bx)/cellSize), row=Math.floor((cy-by)/cellSize);
      if(col<0||col>7||row<0||row>7) return;

      if(s.subPhase==='select'){
        const piece=s.puzzle.board[row][col];
        if(piece&&piece===piece.toUpperCase()){
          s.selectedPiece=[row,col]; s.subPhase='move'; sfx.click();
        }
      } else if(s.subPhase==='move'){
        const [sr,sc]=s.selectedPiece!;
        if(row===s.puzzle.correctTo[0]&&col===s.puzzle.correctTo[1]){
          // Correct!
          const elapsed=Date.now()-s.puzzleStart; s.timings.push(elapsed);
          s.sig.correctMoves++; s.sig.streakCurrent++;
          if(s.sig.streakCurrent>s.sig.streakBest) s.sig.streakBest=s.sig.streakCurrent;
          const fast=elapsed<3000; const pts=fast?3:2;
          s.sig.score+=pts; sfx.success(); hapticScore();
          if(s.sig.streakCurrent>=3) hapticCombo(s.sig.streakCurrent);
          setScore(s.sig.score);
          s.subPhase='feedback'; s.feedbackOk=true; s.feedbackTimer=45;
        } else if(row===sr&&col===sc){
          s.selectedPiece=null; s.subPhase='select'; // deselect
        } else {
          // Wrong destination
          s.sig.wrongMoves++; s.sig.streakCurrent=0;
          sfx.collision(); hapticFail();
          s.subPhase='feedback'; s.feedbackOk=false; s.feedbackTimer=45;
        }
      }
    };
    canvas.addEventListener('pointerdown',onPD);
    return()=>{ window.removeEventListener('resize',resize); canvas.removeEventListener('pointerdown',onPD); };
  },[phase]);

  useEffect(()=>()=>{ cancelAnimationFrame(animRef.current); if(timerRef.current) clearInterval(timerRef.current); },[]);

  const handleStart=useCallback(async(n:string,a:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,n,a); await initAudio(); setPhase('countdown');
  },[]);
  const handlePlayAgain=useCallback(()=>{ setPhase('start'); setScore(0); setTimeLeft(DURATION); setFinalSig(null); },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
        ctaLabel="Play Neon Chess ♟️" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}
            role="img" aria-label="Neon chess puzzle game canvas"/>
          {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT}
            items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}
        </>
      )}
      {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
        score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[
          {label:'Correct',value:`${finalSig.correctMoves}`,color:'#4ade80'},
          {label:'Wrong',value:`${finalSig.wrongMoves}`,color:finalSig.wrongMoves===0?'#4ade80':'#ef4444'},
          {label:'Best Streak',value:`×${finalSig.streakBest}`,color:ACCENT},
          {label:'Avg Time',value:finalSig.avgTimeMs>0?`${(finalSig.avgTimeMs/1000).toFixed(1)}s`:'—',color:'#fbbf24'},
        ]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.correctMoves>=5}/>}
    </GameShell>
  );
}
