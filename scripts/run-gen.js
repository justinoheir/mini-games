/**
 * run-gen.js — Master runner for Glimmers game generation
 * Uses the archetype builders from gen.js + gen-mic.js
 * Run: node scripts/run-gen.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { micVolBody, micPitchBody, getChoiceQuestions, genTestSpec, toFuncName } = require('./gen-mic.js');

const ROOT = path.join(__dirname, '..');
const GAMES_DIR = path.join(ROOT, 'app/games');
const TESTS_DIR = path.join(ROOT, 'tests');

function mkFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

const EMOJIS = {
  'thread-needle':'🪡','jigsaw-rush':'🧩','magnet-maze':'🧲','cable-wrap':'🔌',
  'bubble-burst':'🫧','tower-stack':'🏗️','bounce-pass':'🏀','gear-grind':'⚙️',
  'wormhole-dive':'🌀','dream-catch':'🌙','curling-sweep':'🥌','rowing-rhythm':'🚣',
  'baseball-swing':'⚾','surf-ride':'🏄','ski-slalom':'⛷️','karate-chop':'🥋',
  'pole-vault':'🏃','table-tennis':'🏓','gymnast-beam':'🤸','pixel-skate':'🛹',
  'mirror-mind':'🪞','color-word':'🌈','number-path':'🔢','shape-rotate':'🔄',
  'odd-one-out':'🔎','sequence-unlock':'🔑','pattern-predict':'🔮','word-flash':'📸',
  'logic-gate':'💻','visual-search':'🔍','binary-decode':'🧙','rhythm-repeat':'🥁',
  'category-clash':'🏆','attention-switch':'🎭','face-memory':'👁️','inference-trail':'🕵️',
  'reflex-grid':'⚡','spatial-map':'🗺️','neon-chess':'♟️',
  'dragon-breath':'🐉','voice-sculpt':'🎨','echo-match':'🔊','howl-wolf':'🐺',
  'beat-box':'🎤','hum-maze':'🗺️','chant-power':'💥','whistle-launch':'🚀',
  'vocal-shield':'🛡️','breath-sculpt':'🌬️','frequency-tune':'📻','lung-capacity':'🫁',
  'sound-waves':'🌊','sing-along':'🎵','sound-garden':'🌸',
  'shamrock-shuffle':'🍀','egg-toss':'🥚','pinata-smash':'🎊','flower-bouquet':'💐',
  'bbq-master':'🏆','sparkler-draw':'✨','pencil-pack':'📚','diya-light':'🪔',
  'dreidel-spin':'✡️','dragon-parade':'🎊','bead-catch':'📿','lantern-float':'🏮',
  'taco-toss':'🌮','basket-weave':'🧺',
};

const BG = {
  'thread-needle':'#0d001a','jigsaw-rush':'#1a1400','magnet-maze':'#0a0000',
  'cable-wrap':'#001a0d','bubble-burst':'#001a1a','tower-stack':'#1a0d00',
  'bounce-pass':'#071a00','gear-grind':'#0a0a0a','wormhole-dive':'#0a0014',
  'dream-catch':'#070014','curling-sweep':'#001a1f','rowing-rhythm':'#001014',
  'baseball-swing':'#140d00','surf-ride':'#001419','ski-slalom':'#0a0014',
  'karate-chop':'#1a0000','pole-vault':'#071a00','table-tennis':'#14080a',
  'gymnast-beam':'#1a0014','pixel-skate':'#001a0d',
  'mirror-mind':'#07000f','color-word':'#14000a','number-path':'#001407',
  'shape-rotate':'#001419','odd-one-out':'#14060a','sequence-unlock':'#0d0014',
  'pattern-predict':'#001a17','word-flash':'#14000a','logic-gate':'#0a0c0f',
  'visual-search':'#001207','binary-decode':'#001407','rhythm-repeat':'#14100a',
  'category-clash':'#14060a','attention-switch':'#07070f','face-memory':'#14000a',
  'inference-trail':'#0a0014','reflex-grid':'#140000','spatial-map':'#000f14',
  'neon-chess':'#000f0f',
  'dragon-breath':'#1a0000','voice-sculpt':'#14000f','echo-match':'#001419',
  'howl-wolf':'#07070f','beat-box':'#14050a','hum-maze':'#001a17',
  'chant-power':'#1a0000','whistle-launch':'#14100a','vocal-shield':'#0a0a14',
  'breath-sculpt':'#001a0d','frequency-tune':'#14000f','lung-capacity':'#001407',
  'sound-waves':'#001419','sing-along':'#14000a','sound-garden':'#001407',
  'shamrock-shuffle':'#001407','egg-toss':'#141207','pinata-smash':'#14000a',
  'flower-bouquet':'#14000f','bbq-master':'#14080a','sparkler-draw':'#0a0800',
  'pencil-pack':'#00071a','diya-light':'#14100a','dreidel-spin':'#00071a',
  'dragon-parade':'#1a0000','bead-catch':'#0d0014','lantern-float':'#14060a',
  'taco-toss':'#071400','basket-weave':'#140d00',
};

const PERS = {
  'thread-needle':  ['Surgeon 🔬','Craftsperson 🧵','Focused 🎯','Shaky ✋'],
  'jigsaw-rush':    ['Speed Puzzler ⚡','Sharp Eye 👁️','Persistent 💪','Learning 🧩'],
  'magnet-maze':    ['Navigator 🧭','Pathfinder 🗺️','Careful 🐢','Lost 😵'],
  'cable-wrap':     ['Cable Boss 🔌','Tidy 🧹','Tangled 🤕','Getting There 📎'],
  'bubble-burst':   ['Bubble Master 🫧','Precise 🎯','Tenacious 💪','Pop Learner 💭'],
  'tower-stack':    ['Architect 🏗️','Builder 🧱','Precise 📐','Tumbling 🎲'],
  'bounce-pass':    ['Point Guard 🏀','Playmaker ⚡','On Fire 🔥','Learning 📐'],
  'gear-grind':     ['Engineer ⚙️','Mechanic 🔧','Grinder 💪','Tinkerer 🔩'],
  'wormhole-dive':  ['Warp Pilot 🚀','Deep Diver 🌀','Smooth Traveler ✨','Lost in Space 🛸'],
  'dream-catch':    ['Dream Weaver 🌙','Dream Catcher 🌟','Focused ✨','Daydreamer 💭'],
  'curling-sweep':  ['Skip Champion 🥌','Ice Master ❄️','Sweeper 🧹','Ice Rookie 🧊'],
  'rowing-rhythm':  ['Olympic Rower 🚣','Steady Oar ⚡','Endurance 💪','Learning Rhythm 🎵'],
  'baseball-swing': ['Power Hitter 🏆','Solid Contact ⚾','Hot Streak 🔥','Three Strikes 😬'],
  'surf-ride':      ['Surf Pro 🏄','Wave Rider 🌊','Trick Artist ✨','Wipeout Queen 💦'],
  'ski-slalom':     ['Slalom King 🎿','Clean Run ⛷️','Speed Demon 🏎️','Powder Bro 🌨️'],
  'karate-chop':    ['Black Belt 🥋','Brown Belt ⚡','Disciplined 🎯','White Belt 🤜'],
  'pole-vault':     ['World Record 🏆','High Flyer 🦅','Ambitious 📈','Face-Plant 😬'],
  'table-tennis':   ['Ping Pong Pro 🏓','Quick Reflexes ⚡','Unbreakable 🎯','Miss Queen 🤷'],
  'gymnast-beam':   ['Gold Medalist 🥇','Gymnast 🤸','Balanced ⚖️','Falling Star 💫'],
  'pixel-skate':    ['Tony Hawk 🛹','Street Skater 💨','Combo King 👑','Beginner Bail 😅'],
  'mirror-mind':    ['Synchronized 🪞','Bilateral Brain 🧠','Focused 🎯','Off-Sync 🔀'],
  'color-word':     ['Stroop Master 🧠','Focused Mind 🔍','Consistent ✅','Color Confused 🌈'],
  'number-path':    ['Number Ninja 🥷','Sequential 📊','Precise 🎯','Scattered 🔢'],
  'shape-rotate':   ['Spatial Genius 🌐','Mind Turner 🔄','Consistent 🎯','Spatially Challenged 🧊'],
  'odd-one-out':    ['Pattern Master 🔎','Sharp Eye 👁️','Consistent 🎯','Distracted 🌀'],
  'sequence-unlock':['Memory Palace 🏛️','Pattern Keeper 🔑','Persistent 💪','Forgetful 🤔'],
  'pattern-predict':['Pattern Oracle 🔮','Analyst 📈','Systematic 📐','Random Guesser 🎲'],
  'word-flash':     ['Photographic 📸','Word Hoarder 📚','Persistent 💪','Fleeting Memory 💭'],
  'logic-gate':     ['Hardware Engineer 💻','Logic Master 🔌','Systematic ⚙️','Short Circuit ⚡'],
  'visual-search':  ['Eagle Eye 🦅','Hunter 🎯','Consistent 📍','Searching 🔍'],
  'binary-decode':  ['Bit Wizard 🧙','Code Breaker 💻','Binary Mind 🔢','Bit Confused 😵'],
  'rhythm-repeat':  ['Rhythm Master 🥁','Beat Keeper 🎵','Musical 🎶','Off Beat 🎸'],
  'category-clash': ['Sort Savant 🧠','Quick Sorter ⚡','Clash Champion 🏆','Category Confused 🤷'],
  'attention-switch':['Multitasker 🎭','Dual Focus 🔀','Adaptive 🔄','Single-Track 🛤️'],
  'face-memory':    ['Face Reader 👁️','People Person 😊','Persistent 💪','Face Blind 😵'],
  'inference-trail':['Sherlock 🔍','Detective 🕵️','Deductive 🧩','Still Thinking 🤔'],
  'reflex-grid':    ['Reflex Machine ⚡','Quick Trigger 🎯','Unbreakable 🔥','Slow Poke 🐌'],
  'spatial-map':    ['Human GPS 🗺️','Good Navigator 🧭','Directional 📍','Lost Again 😅'],
  'neon-chess':     ['Grandmaster ♟️','Tactician 🎯','Calculated 🧠','Blunder King 😬'],
  'dragon-breath':  ['Fire Dragon 🐉','Flame Thrower 🔥','Long Breath 💪','Spark 🌟'],
  'voice-sculpt':   ['Voice Artist 🎨','Clay Hummer 🎵','Tonal 🎶','Flat Note 🎤'],
  'echo-match':     ['Echo Master 🎵','Sound Mimic 🔊','Consistent 🎯','Echo Off 📢'],
  'howl-wolf':      ['Alpha Wolf 🐺','Pack Leader 🌕','Howler 🎶','Lone Wolf 🐾'],
  'beat-box':       ['Human Drum Machine 🥁','Beatboxer 🎤','In the Groove 🎵','Off Beat 🎶'],
  'hum-maze':       ['Voice Navigator 🗺️','Hum Pilot 🎵','Perseverant 💪','Maze Humbler 🤔'],
  'chant-power':    ['Power Chanter 💥','Vocal Force ⚡','Sustained 🔋','Whisper 🤫'],
  'whistle-launch': ['Rocket Pilot 🚀','Astronaut 🌟','High Flyer ✈️','Ground Control 📡'],
  'vocal-shield':   ['Vocal Guardian 🛡️','Shield Singer 🎵','Sustained Voice 🔊','Needs Training 🎤'],
  'breath-sculpt':  ['Breath Artist 🌬️','Breath Control 🧘','Sculptor ✨','Still Learning 🌱'],
  'frequency-tune': ['Perfect Pitch 🎼','Frequency Finder 📻','Patient Tuner ⏱️','Off Frequency 📡'],
  'lung-capacity':  ['Iron Lungs 🫁','Strong Breath 💪','Consistent 🎯','Quick Breather 😮'],
  'sound-waves':    ['Sonic Boom 💥','Wave Rider 🌊','Loud and Proud 📢','Barely Audible 🔇'],
  'sing-along':     ['Soprano Star 🌟','On Key 🎵','In Tune 🎶','Shower Singer 🚿'],
  'sound-garden':   ['Garden Maestro 🌸','Green Thumb 🌱','Planter 🌿','Seedling 🌾'],
  'shamrock-shuffle':['Lucky Legend 🍀','Shamrock Chaser ☘️','Nimble 🐇','Coal Catcher 🖤'],
  'egg-toss':       ['Egg Champion 🥚','Gentle Catcher 🤲','Consistent 🎯','Egg-sploder 💥'],
  'pinata-smash':   ['Piñata Pro 🎊','Party Animal 🎉','Strong Arm 💪','Blind Bat 🦇'],
  'flower-bouquet': ['Florist 💐','Gardener 🌸','Petal Collector 🌺','Wilting 🥀'],
  'bbq-master':     ['Grill Master 🏆','Dad\'s Helper 👨‍🍳','Flipper 🍔','Char Artist 🔥'],
  'sparkler-draw':  ['Sparkle Artist 🌟','Fire Writer ✍️','Persistent Glow 🔦','Squiggly ✨'],
  'pencil-pack':    ['A+ Student 📚','Organized 📐','Quick Packer ⚡','Scattered 🎒'],
  'diya-light':     ['Diwali Master 🪔','Light Keeper 🕯️','Devoted 🙏','Still Learning ✨'],
  'dreidel-spin':   ['Dreidel King 🌟','Spinner ✡️','Strong Flick 💪','Shaky Spin 😬'],
  'dragon-parade':  ['Parade Dragon 🐉','Dragon Dancer 🎊','Long Dragon 🌟','Tangled Dragon 🪢'],
  'bead-catch':     ['Mardi Gras MVP 🎊','Bead Collector 📿','Nimble Catcher 🏃','Bead Spiller 😅'],
  'lantern-float':  ['Sky Lantern 🏮','Float Master 🕯️','High Blower 🌬️','Gentle Breeze 🍃'],
  'taco-toss':      ['Taco Chef 🌮','Taco Enthusiast 🫔','Ingredient Pro 👩‍🍳','Taco Disaster 😂'],
  'basket-weave':   ['Master Weaver 🧺','Basket Maker 🪢','Rhythmic 🎵','Tangled Strand 😅'],
};

const MUSIC = {
  sports:'sports', holiday:'holiday', breath:'calm', cognitive:'minimal', skill:'drive',
};

function getEmoji(g) { return EMOJIS[g.id] || '🎮'; }

// shared header template
function tplHeader(g) {
  const pers = PERS[g.id] || ['Pro 🏆','Good 👍','Learning 📚','Starter 🌱'];
  const music = MUSIC[g.cat] || 'drive';
  const emoji = EMOJIS[g.id] || '🎮';
  return `'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID   = '${g.id}';
const ACCENT    = '${g.accent}';
const DURATION  = ${g.dur};
const GAME_EMOJI   = '${emoji}';
const GAME_TITLE   = '${g.title}';
const GAME_TAGLINE = '${g.tag}';
const BG_COLOR  = '${BG[g.id] || '#0a0a0a'}';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = '${music}';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  const avg = sig.reactionTimes.length > 0
    ? sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length : 9999;
  if (acc >= 0.75 && avg < 600) return '${pers[0]}';
  if (acc >= 0.55) return '${pers[1]}';
  if (sig.maxStreak >= 4) return '${pers[2]}';
  return '${pers[3]}';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function WebhookEmitter({ theme, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>;
  sig: Signals; personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score }, player);
  }, [theme, sig, personality, player]);
  return null;
}
`;
}

// ─── Build game file from archetype ────────────────────────────────────────────
function buildGameFile(g) {
  // Import the appropriate body builder
  let body;
  switch(g.arch) {
    case 'tap-target': body = tapTargetBody(g); break;
    case 'timing':     body = timingBody(g); break;
    case 'swipe':      body = swipeBody(g); break;
    case 'tilt':       body = tiltBody(g); break;
    case 'combo':      body = comboBody(g); break;
    case 'sequence':   body = sequenceBody(g); break;
    case 'choice':     body = choiceBody(g); break;
    case 'rhythm':     body = rhythmBody(g); break;
    case 'mic-vol':    body = micVolBody(g); break;
    case 'mic-pitch':  body = micPitchBody(g); break;
    default:           body = tapTargetBody(g); break;
  }
  return tplHeader(g) + body;
}

// ─── All archetypes need these builders ────────────────────────────────────────
// (Pulled from gen.js by reading it)
const genJs = fs.readFileSync(path.join(__dirname, 'gen.js'), 'utf8');
// eval the relevant functions from gen.js in this context
// We extract them by running the file content and pulling named functions
eval(genJs.replace(/^'use strict';/, '').replace(/^const.*=.*require.*\n/gm, '').replace(/module\.exports.*$/m, ''));

// ─── GAMES LIST ────────────────────────────────────────────────────────────────
const GAMES = [
  { id:'thread-needle',   title:'Thread Needle',    tag:"Steady hands only.",    accent:'#e879f9', dur:30, cat:'skill',    arch:'tap-target', ind:['healthcare','retail','cpg'], icon:'pivot_table_chart' },
  { id:'jigsaw-rush',     title:'Jigsaw Rush',       tag:"Snap it. Fast.",        accent:'#fbbf24', dur:60, cat:'skill',    arch:'combo',      ind:['retail','technology','cpg'], icon:'extension' },
  { id:'magnet-maze',     title:'Magnet Maze',       tag:"Attract, repel, navigate.", accent:'#ef4444', dur:60, cat:'skill', arch:'tap-target', ind:['technology','automotive','healthcare'], icon:'explore' },
  { id:'cable-wrap',      title:'Cable Wrap',        tag:"No tangles. No mercy.", accent:'#34d399', dur:45, cat:'skill',    arch:'tap-target', ind:['technology','automotive','retail'], icon:'cable' },
  { id:'bubble-burst',    title:'Bubble Burst',      tag:"Pinch at the perfect size!", accent:'#67e8f9', dur:30, cat:'skill', arch:'timing',   ind:['cpg','retail','food_bev'], icon:'bubble_chart' },
  { id:'tower-stack',     title:'Tower Stack',       tag:"Drop it. Stack it.",    accent:'#f59e0b', dur:60, cat:'skill',    arch:'timing',     ind:['cpg','retail','food_bev'], icon:'view_in_ar' },
  { id:'bounce-pass',     title:'Bounce Pass',       tag:"Angle the bounce.",     accent:'#84cc16', dur:45, cat:'skill',    arch:'swipe',      ind:['sports','technology','cpg'], icon:'sports' },
  { id:'gear-grind',      title:'Gear Grind',        tag:"Mesh the gears.",       accent:'#94a3b8', dur:60, cat:'skill',    arch:'combo',      ind:['automotive','technology','finance'], icon:'settings' },
  { id:'wormhole-dive',   title:'Wormhole Dive',     tag:"Survive the warp.",     accent:'#7c3aed', dur:60, cat:'skill',    arch:'swipe',      ind:['technology','automotive','finance'], icon:'blur_circular' },
  { id:'dream-catch',     title:'Dream Catch',       tag:"Float through. Catch the fragments.", accent:'#818cf8', dur:60, cat:'skill', arch:'tap-target', ind:['healthcare','retail','technology'], icon:'nights_stay' },
  { id:'curling-sweep',   title:'Curling Sweep',     tag:"Sweep it in.",          accent:'#67e8f9', dur:60, cat:'sports',   arch:'timing',     ind:['sports','cpg','retail'], icon:'cleaning_services' },
  { id:'rowing-rhythm',   title:'Rowing Rhythm',     tag:"Sync your strokes.",    accent:'#38bdf8', dur:60, cat:'sports',   arch:'rhythm',     ind:['sports','healthcare','food_bev'], icon:'rowing' },
  { id:'baseball-swing',  title:'Baseball Swing',    tag:"Watch the pitch. Swing!", accent:'#fbbf24', dur:45, cat:'sports', arch:'timing',     ind:['sports','cpg','food_bev'], icon:'sports_baseball' },
  { id:'surf-ride',       title:'Surf Ride',         tag:"Tilt to balance.",      accent:'#06b6d4', dur:60, cat:'sports',   arch:'tilt',       ind:['sports','cpg','retail'], icon:'surfing' },
  { id:'ski-slalom',      title:'Ski Slalom',        tag:"Weave through the gates.", accent:'#818cf8', dur:45, cat:'sports', arch:'tilt',      ind:['sports','cpg','automotive'], icon:'downhill_skiing' },
  { id:'karate-chop',     title:'Karate Chop',       tag:"Chop the right zone.",  accent:'#ef4444', dur:30, cat:'sports',   arch:'combo',      ind:['sports','healthcare','technology'], icon:'sports_martial_arts' },
  { id:'pole-vault',      title:'Pole Vault',        tag:"Run. Plant. Fly.",      accent:'#a3e635', dur:45, cat:'sports',   arch:'swipe',      ind:['sports','healthcare','cpg'], icon:'sports_gymnastics' },
  { id:'table-tennis',    title:'Table Tennis',      tag:"Return everything.",    accent:'#fb923c', dur:45, cat:'sports',   arch:'timing',     ind:['sports','technology','cpg'], icon:'sports_tennis' },
  { id:'gymnast-beam',    title:'Gymnast Beam',      tag:"Balance. Execute.",     accent:'#f472b6', dur:60, cat:'sports',   arch:'tilt',       ind:['sports','healthcare','retail'], icon:'accessibility' },
  { id:'pixel-skate',     title:'Pixel Skate',       tag:"Flick tricks.",         accent:'#10b981', dur:45, cat:'sports',   arch:'combo',      ind:['sports','retail','technology'], icon:'skateboarding' },
  { id:'mirror-mind',     title:'Mirror Mind',       tag:"Both hands. Mirrored.", accent:'#8b5cf6', dur:45, cat:'cognitive',arch:'choice',     ind:['technology','healthcare','finance'], icon:'flip' },
  { id:'color-word',      title:'Color Word',        tag:"Trust your eyes.",      accent:'#f43f5e', dur:30, cat:'cognitive',arch:'choice',     ind:['cpg','retail','technology'], icon:'text_fields' },
  { id:'number-path',     title:'Number Path',       tag:"1 to N. Fastest finger wins.", accent:'#22c55e', dur:45, cat:'cognitive', arch:'tap-target', ind:['finance','technology','healthcare'], icon:'123' },
  { id:'shape-rotate',    title:'Shape Rotate',      tag:"Spin it in your mind.", accent:'#06b6d4', dur:60, cat:'cognitive',arch:'choice',     ind:['technology','automotive','finance'], icon:'3d_rotation' },
  { id:'odd-one-out',     title:'Odd One Out',       tag:"Spot what doesn't belong.", accent:'#f97316', dur:45, cat:'cognitive', arch:'tap-target', ind:['retail','cpg','technology'], icon:'find_in_page' },
  { id:'sequence-unlock', title:'Sequence Unlock',   tag:"Watch the lights.",     accent:'#a855f7', dur:60, cat:'cognitive',arch:'sequence',   ind:['technology','finance','healthcare'], icon:'pattern' },
  { id:'pattern-predict', title:'Pattern Predict',   tag:"What comes next?",      accent:'#14b8a6', dur:45, cat:'cognitive',arch:'choice',     ind:['finance','technology','cpg'], icon:'trending_up' },
  { id:'word-flash',      title:'Word Flash',        tag:"Read it. Remember it.", accent:'#ec4899', dur:60, cat:'cognitive',arch:'sequence',   ind:['retail','cpg','healthcare'], icon:'flash_on' },
  { id:'logic-gate',      title:'Logic Gate',        tag:"Wire the circuit.",     accent:'#64748b', dur:60, cat:'cognitive',arch:'choice',     ind:['technology','finance','automotive'], icon:'device_hub' },
  { id:'visual-search',   title:'Visual Search',     tag:"Find it. Tap it.",      accent:'#10b981', dur:30, cat:'cognitive',arch:'tap-target', ind:['retail','cpg','technology'], icon:'search' },
  { id:'binary-decode',   title:'Binary Decode',     tag:"Flip the bits.",        accent:'#22c55e', dur:45, cat:'cognitive',arch:'choice',     ind:['technology','finance','automotive'], icon:'data_object' },
  { id:'rhythm-repeat',   title:'Rhythm Repeat',     tag:"Hear the beat. Play it back.", accent:'#f59e0b', dur:60, cat:'cognitive', arch:'sequence', ind:['cpg','retail','food_bev'], icon:'music_note' },
  { id:'category-clash',  title:'Category Clash',    tag:"Sort it fast.",         accent:'#fb923c', dur:30, cat:'cognitive',arch:'choice',     ind:['retail','cpg','food_bev'], icon:'category' },
  { id:'attention-switch',title:'Attention Switch',  tag:"Dual task. Now!",       accent:'#6366f1', dur:45, cat:'cognitive',arch:'combo',      ind:['technology','finance','healthcare'], icon:'switch_access_shortcut' },
  { id:'face-memory',     title:'Face Memory',       tag:"Remember the faces.",   accent:'#f43f5e', dur:60, cat:'cognitive',arch:'sequence',   ind:['retail','healthcare','finance'], icon:'face' },
  { id:'inference-trail', title:'Inference Trail',   tag:"Follow the clues.",     accent:'#7c3aed', dur:60, cat:'cognitive',arch:'tap-target', ind:['finance','technology','healthcare'], icon:'lightbulb' },
  { id:'reflex-grid',     title:'Reflex Grid',       tag:"Tap the flash.",        accent:'#ef4444', dur:30, cat:'cognitive',arch:'tap-target', ind:['sports','technology','cpg'], icon:'grid_on' },
  { id:'spatial-map',     title:'Spatial Map',       tag:"Study the map.",        accent:'#0ea5e9', dur:60, cat:'cognitive',arch:'choice',     ind:['automotive','technology','retail'], icon:'map' },
  { id:'neon-chess',      title:'Neon Chess',        tag:"One move. Best move.",  accent:'#00ffff', dur:60, cat:'cognitive',arch:'choice',     ind:['technology','finance','healthcare'], icon:'grid_view' },
  { id:'dragon-breath',   title:'Dragon Breath',     tag:"Blow hard. Breathe fire!", accent:'#ef4444', dur:30, cat:'breath', arch:'mic-vol',    ind:['cpg','food_bev','sports'], icon:'local_fire_department' },
  { id:'voice-sculpt',    title:'Voice Sculpt',      tag:"Hum to shape the clay.", accent:'#d946ef', dur:45, cat:'breath',  arch:'mic-pitch',  ind:['healthcare','retail','technology'], icon:'record_voice_over' },
  { id:'echo-match',      title:'Echo Match',        tag:"Match the echo.",       accent:'#06b6d4', dur:45, cat:'breath',   arch:'mic-vol',    ind:['healthcare','cpg','retail'], icon:'graphic_eq' },
  { id:'howl-wolf',       title:'Howl Wolf',         tag:"Find your pitch.",      accent:'#6366f1', dur:45, cat:'breath',   arch:'mic-pitch',  ind:['cpg','retail','food_bev'], icon:'pets' },
  { id:'beat-box',        title:'Beat Box',          tag:"Drop the beat.",        accent:'#f97316', dur:60, cat:'breath',   arch:'mic-vol',    ind:['cpg','food_bev','retail'], icon:'music_note' },
  { id:'hum-maze',        title:'Hum Maze',          tag:"Change your pitch.",    accent:'#14b8a6', dur:60, cat:'breath',   arch:'mic-pitch',  ind:['healthcare','technology','retail'], icon:'route' },
  { id:'chant-power',     title:'Chant Power',       tag:"Hold the chant.",       accent:'#dc2626', dur:45, cat:'breath',   arch:'mic-vol',    ind:['sports','cpg','food_bev'], icon:'record_voice_over' },
  { id:'whistle-launch',  title:'Whistle Launch',    tag:"Whistle to launch.",    accent:'#fbbf24', dur:45, cat:'breath',   arch:'mic-pitch',  ind:['technology','cpg','sports'], icon:'rocket' },
  { id:'vocal-shield',    title:'Vocal Shield',      tag:"Sing it. Block it.",    accent:'#818cf8', dur:30, cat:'breath',   arch:'mic-pitch',  ind:['healthcare','technology','sports'], icon:'shield' },
  { id:'breath-sculpt',   title:'Breath Sculpt',     tag:"Breathe to shape.",     accent:'#34d399', dur:60, cat:'breath',   arch:'mic-vol',    ind:['healthcare','cpg','retail'], icon:'air' },
  { id:'frequency-tune',  title:'Frequency Tune',    tag:"Find the frequency.",   accent:'#f472b6', dur:45, cat:'breath',   arch:'mic-pitch',  ind:['technology','healthcare','automotive'], icon:'tune' },
  { id:'lung-capacity',   title:'Lung Capacity',     tag:"Take one breath.",      accent:'#4ade80', dur:30, cat:'breath',   arch:'mic-vol',    ind:['healthcare','sports','cpg'], icon:'pulmonology' },
  { id:'sound-waves',     title:'Sound Waves',       tag:"Shout the frequency.",  accent:'#22d3ee', dur:45, cat:'breath',   arch:'mic-vol',    ind:['technology','cpg','sports'], icon:'graphic_eq' },
  { id:'sing-along',      title:'Sing Along',        tag:"Match the note.",       accent:'#fb7185', dur:45, cat:'breath',   arch:'mic-pitch',  ind:['cpg','retail','food_bev'], icon:'mic' },
  { id:'sound-garden',    title:'Sound Garden',      tag:"Touch to grow.",        accent:'#4ade80', dur:60, cat:'breath',   arch:'tap-target', ind:['healthcare','retail','technology'], icon:'nature' },
  { id:'shamrock-shuffle',title:'Shamrock Shuffle',  tag:"Catch the luck.",       accent:'#16a34a', dur:30, cat:'holiday',  arch:'tilt',       ind:['retail','food_bev','cpg'], icon:'eco' },
  { id:'egg-toss',        title:'Egg Toss',          tag:"Catch it! Don't crack!", accent:'#fde68a', dur:45, cat:'holiday', arch:'timing',     ind:['food_bev','cpg','retail'], icon:'egg' },
  { id:'pinata-smash',    title:'Piñata Smash',      tag:"Find the weak spot.",   accent:'#ec4899', dur:30, cat:'holiday',  arch:'tap-target', ind:['food_bev','cpg','retail'], icon:'celebration' },
  { id:'flower-bouquet',  title:'Flower Bouquet',    tag:"Catch the petals.",     accent:'#f472b6', dur:45, cat:'holiday',  arch:'tap-target', ind:['retail','cpg','healthcare'], icon:'local_florist' },
  { id:'bbq-master',      title:'BBQ Master',        tag:"Flip it right.",        accent:'#f97316', dur:60, cat:'holiday',  arch:'timing',     ind:['food_bev','cpg','retail'], icon:'outdoor_grill' },
  { id:'sparkler-draw',   title:'Sparkler Draw',     tag:"Draw with fire.",       accent:'#fbbf24', dur:45, cat:'holiday',  arch:'tap-target', ind:['retail','cpg','sports'], icon:'auto_awesome' },
  { id:'pencil-pack',     title:'Pencil Pack',       tag:"Sort and pack.",        accent:'#3b82f6', dur:30, cat:'holiday',  arch:'choice',     ind:['retail','cpg','technology'], icon:'school' },
  { id:'diya-light',      title:'Diya Light',        tag:"Light the diyas.",      accent:'#f59e0b', dur:45, cat:'holiday',  arch:'sequence',   ind:['retail','cpg','food_bev'], icon:'emoji_objects' },
  { id:'dreidel-spin',    title:'Dreidel Spin',      tag:"Flick it hard.",        accent:'#3b82f6', dur:30, cat:'holiday',  arch:'swipe',      ind:['retail','food_bev','cpg'], icon:'rotate_right' },
  { id:'dragon-parade',   title:'Dragon Parade',     tag:"Make it dance!",        accent:'#ef4444', dur:60, cat:'holiday',  arch:'tap-target', ind:['retail','food_bev','cpg'], icon:'cruelty_free' },
  { id:'bead-catch',      title:'Bead Catch',        tag:"Tilt to catch!",        accent:'#a855f7', dur:30, cat:'holiday',  arch:'tilt',       ind:['retail','food_bev','cpg'], icon:'bubble_chart' },
  { id:'lantern-float',   title:'Lantern Float',     tag:"Blow them up.",         accent:'#f97316', dur:45, cat:'holiday',  arch:'mic-vol',    ind:['retail','cpg','food_bev'], icon:'light' },
  { id:'taco-toss',       title:'Taco Toss',         tag:"Catch the fillings.",   accent:'#84cc16', dur:45, cat:'holiday',  arch:'tilt',       ind:['food_bev','cpg','retail'], icon:'lunch_dining' },
  { id:'basket-weave',    title:'Basket Weave',      tag:"Over. Under.",          accent:'#d97706', dur:60, cat:'holiday',  arch:'rhythm',     ind:['retail','cpg','food_bev'], icon:'texture' },
];

// ─── RUN ───────────────────────────────────────────────────────────────────────
let built = 0, skipped = 0;
const builtIds = [];

for (const g of GAMES) {
  const gameDir = path.join(GAMES_DIR, g.id);
  const gamePath = path.join(gameDir, 'page.tsx');
  const testPath = path.join(TESTS_DIR, `${g.id}.spec.ts`);

  if (fs.existsSync(gamePath)) {
    console.log(`  SKIP (exists): ${g.id}`);
    skipped++;
    continue;
  }

  console.log(`  BUILD: ${g.id} [${g.arch}]`);
  try {
    const gameContent = buildGameFile(g);
    mkFile(gamePath, gameContent);
    const testContent = genTestSpec(g);
    mkFile(testPath, testContent);
    builtIds.push(g.id);
    built++;
  } catch(e) {
    console.error(`  ERROR building ${g.id}: ${e.message}`);
  }
}

console.log(`\n✅ Done! Built: ${built} | Skipped: ${skipped}`);
console.log('Built IDs:', builtIds.join(', '));

// ─── Update games.ts ───────────────────────────────────────────────────────────
const gamesTs = path.join(ROOT, 'lib/games.ts');
let content = fs.readFileSync(gamesTs, 'utf8');

// Group new games by category
const newSkill = GAMES.filter(g=>!fs.existsSync(path.join(GAMES_DIR, g.id, 'page.tsx.bak'))&&(g.cat==='skill'||g.cat==='cognitive'||g.cat==='breath'));
const newSports = GAMES.filter(g=>g.cat==='sports');
const newHoliday = GAMES.filter(g=>g.cat==='holiday');

// Helper to format a game entry
const fmtGame = g => `  { id:'${g.id}', title:'${g.title}', tagline:'${g.tag.replace(/'/g,"\\'")}', href:'/games/${g.id}', accentColor:'${g.accent}', duration:'${g.dur}s', icon:'${g.icon||'sports'}', category:'${g.cat==='cognitive'||g.cat==='breath'?g.cat:g.cat}', industries:${JSON.stringify(g.ind)} },`;

// Add games to their arrays if not already present
function addToArray(content, arrayName, games) {
  for (const g of games) {
    if (content.includes(`'${g.id}'`)) continue;
    // Find the closing ]; of the array
    const marker = `// END_${arrayName}`;
    if (content.includes(marker)) {
      content = content.replace(marker, fmtGame(g) + '\n  ' + marker);
    } else {
      // Append before the closing ]; of the array
      const arrayEnd = new RegExp(`(export const ${arrayName}[^;]+?)(\\];)`, 's');
      content = content.replace(arrayEnd, `$1${fmtGame(g)}\n$2`);
    }
  }
  return content;
}

// Add all new games
const allNew = GAMES.filter(g => builtIds.includes(g.id));
for (const g of allNew) {
  if (content.includes(`'${g.id}'`)) continue;
  const entry = fmtGame(g);
  if (g.cat === 'sports') {
    content = content.replace(/^(\s*\];)\s*$/m, (m, p1) => {
      if (!content.slice(0, content.indexOf(p1)).includes('SPORTS_GAMES')) return m;
      return entry + '\n' + m;
    });
    // Safer: append before last ]; of SPORTS_GAMES
    const idx = content.lastIndexOf("export const SPORTS_GAMES");
    if (idx >= 0) {
      const endIdx = content.indexOf('];', idx);
      if (endIdx >= 0) {
        content = content.slice(0, endIdx) + entry + '\n' + content.slice(endIdx);
      }
    }
  } else if (g.cat === 'holiday') {
    const idx = content.lastIndexOf("export const HOLIDAY_GAMES");
    if (idx >= 0) {
      const endIdx = content.indexOf('];', idx);
      if (endIdx >= 0 && !content.slice(idx, endIdx).includes(g.id)) {
        content = content.slice(0, endIdx) + entry + '\n' + content.slice(endIdx);
      }
    }
  } else {
    // skill, cognitive, breath → SKILL_GAMES
    const idx = content.lastIndexOf("export const SKILL_GAMES");
    if (idx >= 0) {
      const endIdx = content.indexOf('];', idx);
      if (endIdx >= 0 && !content.slice(idx, endIdx).includes(g.id)) {
        content = content.slice(0, endIdx) + entry + '\n' + content.slice(endIdx);
      }
    }
  }
}

fs.writeFileSync(gamesTs, content, 'utf8');
console.log('\n✅ games.ts updated');
