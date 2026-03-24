/**
 * gen.js — Glimmers 100 game generator
 * Generates 68 remaining game files + tests + games.ts entries
 * Run: node scripts/gen.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GAMES_DIR = path.join(ROOT, 'app/games');
const TESTS_DIR = path.join(ROOT, 'tests');

function mkFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`  ✓ ${path.relative(ROOT, filePath)}`);
}

// ─── Emoji lookup ─────────────────────────────────────────────────────────────
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

// ─── GAME CONFIGS ──────────────────────────────────────────────────────────────
const GAMES = [
  { id:'thread-needle',   title:'Thread Needle',    tag:'Steady hands only. Pros need not apply.',  accent:'#e879f9', dur:30, cat:'skill',    arch:'tap-target', ind:['healthcare','retail','cpg'] },
  { id:'jigsaw-rush',     title:'Jigsaw Rush',       tag:'Snap it. Fast. Clock\'s ticking.',         accent:'#fbbf24', dur:60, cat:'skill',    arch:'tap-target', ind:['retail','technology','cpg'] },
  { id:'magnet-maze',     title:'Magnet Maze',       tag:'Attract, repel, navigate.',               accent:'#ef4444', dur:60, cat:'skill',    arch:'tap-target', ind:['technology','automotive','healthcare'] },
  { id:'cable-wrap',      title:'Cable Wrap',        tag:'No tangles. No mercy.',                   accent:'#34d399', dur:45, cat:'skill',    arch:'tap-target', ind:['technology','automotive','retail'] },
  { id:'bubble-burst',    title:'Bubble Burst',      tag:'Pinch at the perfect size!',              accent:'#67e8f9', dur:30, cat:'skill',    arch:'timing',     ind:['cpg','retail','food_bev'] },
  { id:'tower-stack',     title:'Tower Stack',       tag:'Drop it. Stack it. Don\'t tip it.',       accent:'#f59e0b', dur:60, cat:'skill',    arch:'timing',     ind:['cpg','retail','food_bev'] },
  { id:'bounce-pass',     title:'Bounce Pass',       tag:'Angle the bounce. Make the pass.',        accent:'#84cc16', dur:45, cat:'skill',    arch:'swipe',      ind:['sports','technology','cpg'] },
  { id:'gear-grind',      title:'Gear Grind',        tag:'Mesh the gears. Keep it spinning.',       accent:'#94a3b8', dur:60, cat:'skill',    arch:'tap-target', ind:['automotive','technology','finance'] },
  { id:'wormhole-dive',   title:'Wormhole Dive',     tag:'Survive the warp. Keep diving.',          accent:'#7c3aed', dur:60, cat:'skill',    arch:'swipe',      ind:['technology','automotive','finance'] },
  { id:'dream-catch',     title:'Dream Catch',       tag:'Float through. Catch the fragments.',     accent:'#818cf8', dur:60, cat:'skill',    arch:'tap-target', ind:['healthcare','retail','technology'] },
  { id:'curling-sweep',   title:'Curling Sweep',     tag:'Sweep it in. Sweep it hard.',             accent:'#67e8f9', dur:60, cat:'sports',   arch:'timing',     ind:['sports','cpg','retail'] },
  { id:'rowing-rhythm',   title:'Rowing Rhythm',     tag:'Sync your strokes. Row!',                 accent:'#38bdf8', dur:60, cat:'sports',   arch:'rhythm',     ind:['sports','healthcare','food_bev'] },
  { id:'baseball-swing',  title:'Baseball Swing',    tag:'Watch the pitch. Swing!',                 accent:'#fbbf24', dur:45, cat:'sports',   arch:'timing',     ind:['sports','cpg','food_bev'] },
  { id:'surf-ride',       title:'Surf Ride',         tag:'Tilt to balance. Swipe for tricks.',      accent:'#06b6d4', dur:60, cat:'sports',   arch:'tilt',       ind:['sports','cpg','retail'] },
  { id:'ski-slalom',      title:'Ski Slalom',        tag:'Weave through the gates. Go fast.',       accent:'#818cf8', dur:45, cat:'sports',   arch:'tilt',       ind:['sports','cpg','automotive'] },
  { id:'karate-chop',     title:'Karate Chop',       tag:'Chop the right zone. Kata master.',       accent:'#ef4444', dur:30, cat:'sports',   arch:'combo',      ind:['sports','healthcare','technology'] },
  { id:'pole-vault',      title:'Pole Vault',        tag:'Run. Plant. Fly. Clear it!',              accent:'#a3e635', dur:45, cat:'sports',   arch:'swipe',      ind:['sports','healthcare','cpg'] },
  { id:'table-tennis',    title:'Table Tennis',      tag:'Return everything. Don\'t blink.',        accent:'#fb923c', dur:45, cat:'sports',   arch:'timing',     ind:['sports','technology','cpg'] },
  { id:'gymnast-beam',    title:'Gymnast Beam',      tag:'Balance. Execute. Stick the landing.',    accent:'#f472b6', dur:60, cat:'sports',   arch:'tilt',       ind:['sports','healthcare','retail'] },
  { id:'pixel-skate',     title:'Pixel Skate',       tag:'Flick tricks. Stack the combo.',          accent:'#10b981', dur:45, cat:'sports',   arch:'combo',      ind:['sports','retail','technology'] },
  { id:'mirror-mind',     title:'Mirror Mind',       tag:'Both hands. Mirrored. Synchronized.',     accent:'#8b5cf6', dur:45, cat:'cognitive',arch:'choice',     ind:['technology','healthcare','finance'] },
  { id:'color-word',      title:'Color Word',        tag:'Ignore the meaning. Trust your eyes.',    accent:'#f43f5e', dur:30, cat:'cognitive',arch:'choice',     ind:['cpg','retail','technology'] },
  { id:'number-path',     title:'Number Path',       tag:'1 to N. Fastest finger wins.',            accent:'#22c55e', dur:45, cat:'cognitive',arch:'tap-target', ind:['finance','technology','healthcare'] },
  { id:'shape-rotate',    title:'Shape Rotate',      tag:'Spin it in your mind. Match it.',         accent:'#06b6d4', dur:60, cat:'cognitive',arch:'choice',     ind:['technology','automotive','finance'] },
  { id:'odd-one-out',     title:'Odd One Out',       tag:'Spot what doesn\'t belong. Quick!',       accent:'#f97316', dur:45, cat:'cognitive',arch:'tap-target', ind:['retail','cpg','technology'] },
  { id:'sequence-unlock', title:'Sequence Unlock',   tag:'Watch the lights. Repeat them.',          accent:'#a855f7', dur:60, cat:'cognitive',arch:'sequence',   ind:['technology','finance','healthcare'] },
  { id:'pattern-predict', title:'Pattern Predict',   tag:'What comes next? You tell me.',           accent:'#14b8a6', dur:45, cat:'cognitive',arch:'choice',     ind:['finance','technology','cpg'] },
  { id:'word-flash',      title:'Word Flash',        tag:'Read it. Remember it. Recall it.',        accent:'#ec4899', dur:60, cat:'cognitive',arch:'sequence',   ind:['retail','cpg','healthcare'] },
  { id:'logic-gate',      title:'Logic Gate',        tag:'Wire the circuit. Get the output.',       accent:'#64748b', dur:60, cat:'cognitive',arch:'choice',     ind:['technology','finance','automotive'] },
  { id:'visual-search',   title:'Visual Search',     tag:'Find it. Tap it. Before the horde.',      accent:'#10b981', dur:30, cat:'cognitive',arch:'tap-target', ind:['retail','cpg','technology'] },
  { id:'binary-decode',   title:'Binary Decode',     tag:'Flip the bits. Find the number.',         accent:'#22c55e', dur:45, cat:'cognitive',arch:'choice',     ind:['technology','finance','automotive'] },
  { id:'rhythm-repeat',   title:'Rhythm Repeat',     tag:'Hear the beat. Play it back.',            accent:'#f59e0b', dur:60, cat:'cognitive',arch:'sequence',   ind:['cpg','retail','food_bev'] },
  { id:'category-clash',  title:'Category Clash',    tag:'Sort it fast. Categories clash!',         accent:'#fb923c', dur:30, cat:'cognitive',arch:'choice',     ind:['retail','cpg','food_bev'] },
  { id:'attention-switch',title:'Attention Switch',  tag:'Dual task. Both streams. Now!',           accent:'#6366f1', dur:45, cat:'cognitive',arch:'combo',      ind:['technology','finance','healthcare'] },
  { id:'face-memory',     title:'Face Memory',       tag:'Remember the faces. Spot them.',          accent:'#f43f5e', dur:60, cat:'cognitive',arch:'sequence',   ind:['retail','healthcare','finance'] },
  { id:'inference-trail', title:'Inference Trail',   tag:'Follow the clues. Find the answer.',      accent:'#7c3aed', dur:60, cat:'cognitive',arch:'tap-target', ind:['finance','technology','healthcare'] },
  { id:'reflex-grid',     title:'Reflex Grid',       tag:'Tap the flash. Never miss twice.',        accent:'#ef4444', dur:30, cat:'cognitive',arch:'tap-target', ind:['sports','technology','cpg'] },
  { id:'spatial-map',     title:'Spatial Map',       tag:'Study the map. Answer fast.',             accent:'#0ea5e9', dur:60, cat:'cognitive',arch:'choice',     ind:['automotive','technology','retail'] },
  { id:'neon-chess',      title:'Neon Chess',        tag:'One move. Best move. Neon style.',        accent:'#00ffff', dur:60, cat:'cognitive',arch:'choice',     ind:['technology','finance','healthcare'] },
  { id:'dragon-breath',   title:'Dragon Breath',     tag:'Blow hard. Breathe fire!',                accent:'#ef4444', dur:30, cat:'breath',   arch:'mic-vol',    ind:['cpg','food_bev','sports'] },
  { id:'voice-sculpt',    title:'Voice Sculpt',      tag:'Hum to shape the clay.',                  accent:'#d946ef', dur:45, cat:'breath',   arch:'mic-pitch',  ind:['healthcare','retail','technology'] },
  { id:'echo-match',      title:'Echo Match',        tag:'Match the echo. Hold the note.',          accent:'#06b6d4', dur:45, cat:'breath',   arch:'mic-vol',    ind:['healthcare','cpg','retail'] },
  { id:'howl-wolf',       title:'Howl Wolf',         tag:'Find your pitch. Call the pack.',         accent:'#6366f1', dur:45, cat:'breath',   arch:'mic-pitch',  ind:['cpg','retail','food_bev'] },
  { id:'beat-box',        title:'Beat Box',          tag:'Drop the beat. Keep it going.',           accent:'#f97316', dur:60, cat:'breath',   arch:'mic-vol',    ind:['cpg','food_bev','retail'] },
  { id:'hum-maze',        title:'Hum Maze',          tag:'Change your pitch. Navigate.',            accent:'#14b8a6', dur:60, cat:'breath',   arch:'mic-pitch',  ind:['healthcare','technology','retail'] },
  { id:'chant-power',     title:'Chant Power',       tag:'Hold the chant. Charge the power.',       accent:'#dc2626', dur:45, cat:'breath',   arch:'mic-vol',    ind:['sports','cpg','food_bev'] },
  { id:'whistle-launch',  title:'Whistle Launch',    tag:'Whistle to launch. Pitch to steer.',      accent:'#fbbf24', dur:45, cat:'breath',   arch:'mic-pitch',  ind:['technology','cpg','sports'] },
  { id:'vocal-shield',    title:'Vocal Shield',      tag:'Sing it. Block it. Hold it.',             accent:'#818cf8', dur:30, cat:'breath',   arch:'mic-pitch',  ind:['healthcare','technology','sports'] },
  { id:'breath-sculpt',   title:'Breath Sculpt',     tag:'Breathe to shape. Slow or fast.',         accent:'#34d399', dur:60, cat:'breath',   arch:'mic-vol',    ind:['healthcare','cpg','retail'] },
  { id:'frequency-tune',  title:'Frequency Tune',    tag:'Find the frequency. Hold it.',            accent:'#f472b6', dur:45, cat:'breath',   arch:'mic-pitch',  ind:['technology','healthcare','automotive'] },
  { id:'lung-capacity',   title:'Lung Capacity',     tag:'Take one breath. Hold the note.',         accent:'#4ade80', dur:30, cat:'breath',   arch:'mic-vol',    ind:['healthcare','sports','cpg'] },
  { id:'sound-waves',     title:'Sound Waves',       tag:'Shout the frequency. Shatter walls.',     accent:'#22d3ee', dur:45, cat:'breath',   arch:'mic-vol',    ind:['technology','cpg','sports'] },
  { id:'sing-along',      title:'Sing Along',        tag:'Match the note. Hold it perfect.',        accent:'#fb7185', dur:45, cat:'breath',   arch:'mic-pitch',  ind:['cpg','retail','food_bev'] },
  { id:'sound-garden',    title:'Sound Garden',      tag:'Touch to grow. Grow to play.',            accent:'#4ade80', dur:60, cat:'breath',   arch:'tap-target', ind:['healthcare','retail','technology'] },
  { id:'shamrock-shuffle',title:'Shamrock Shuffle',  tag:'Catch the luck. Dodge the coal.',         accent:'#16a34a', dur:30, cat:'holiday',  arch:'tilt',       ind:['retail','food_bev','cpg'] },
  { id:'egg-toss',        title:'Egg Toss',          tag:"Toss it. Catch it. Don't crack it!",      accent:'#fde68a', dur:45, cat:'holiday',  arch:'timing',     ind:['food_bev','cpg','retail'] },
  { id:'pinata-smash',    title:'Piñata Smash',      tag:'Find the weak spot. Smash!',              accent:'#ec4899', dur:30, cat:'holiday',  arch:'tap-target', ind:['food_bev','cpg','retail'] },
  { id:'flower-bouquet',  title:'Flower Bouquet',    tag:'Catch the petals. Build love.',           accent:'#f472b6', dur:45, cat:'holiday',  arch:'tap-target', ind:['retail','cpg','healthcare'] },
  { id:'bbq-master',      title:'BBQ Master',        tag:"Flip it right. Don't burn dad's burger.", accent:'#f97316', dur:60, cat:'holiday',  arch:'timing',     ind:['food_bev','cpg','retail'] },
  { id:'sparkler-draw',   title:'Sparkler Draw',     tag:'Draw with fire. Make it sparkle.',        accent:'#fbbf24', dur:45, cat:'holiday',  arch:'tap-target', ind:['retail','cpg','sports'] },
  { id:'pencil-pack',     title:'Pencil Pack',       tag:'Sort and pack. School starts now.',       accent:'#3b82f6', dur:30, cat:'holiday',  arch:'choice',     ind:['retail','cpg','technology'] },
  { id:'diya-light',      title:'Diya Light',        tag:'Light the diyas. In order!',              accent:'#f59e0b', dur:45, cat:'holiday',  arch:'sequence',   ind:['retail','cpg','food_bev'] },
  { id:'dreidel-spin',    title:'Dreidel Spin',      tag:'Flick it hard. Watch it spin!',           accent:'#3b82f6', dur:30, cat:'holiday',  arch:'swipe',      ind:['retail','food_bev','cpg'] },
  { id:'dragon-parade',   title:'Dragon Parade',     tag:'Multi-touch the dragon. Make it dance!',  accent:'#ef4444', dur:60, cat:'holiday',  arch:'tap-target', ind:['retail','food_bev','cpg'] },
  { id:'bead-catch',      title:'Bead Catch',        tag:'Tilt to catch the beads!',                accent:'#a855f7', dur:30, cat:'holiday',  arch:'tilt',       ind:['retail','food_bev','cpg'] },
  { id:'lantern-float',   title:'Lantern Float',     tag:'Blow them up. Watch them rise.',          accent:'#f97316', dur:45, cat:'holiday',  arch:'mic-vol',    ind:['retail','cpg','food_bev'] },
  { id:'taco-toss',       title:'Taco Toss',         tag:'Catch the fillings. Build the taco.',     accent:'#84cc16', dur:45, cat:'holiday',  arch:'tilt',       ind:['food_bev','cpg','retail'] },
  { id:'basket-weave',    title:'Basket Weave',      tag:'Over. Under. Don\'t drop a strand.',      accent:'#d97706', dur:60, cat:'holiday',  arch:'rhythm',     ind:['retail','cpg','food_bev'] },
];

// ─── BG colors per game ───────────────────────────────────────────────────────
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

// ─── Personality labels per game ──────────────────────────────────────────────
const PERS = {
  'thread-needle':   ['Surgeon 🔬','Craftsperson 🧵','Focused 🎯','Shaky ✋'],
  'jigsaw-rush':     ['Speed Puzzler ⚡','Sharp Eye 👁️','Persistent 💪','Learning 🧩'],
  'magnet-maze':     ['Navigator 🧭','Pathfinder 🗺️','Careful 🐢','Lost 😵'],
  'cable-wrap':      ['Cable Boss 🔌','Tidy 🧹','Tangled 🤕','Getting There 📎'],
  'bubble-burst':    ['Bubble Master 🫧','Precise 🎯','Tenacious 💪','Pop Learner 💭'],
  'tower-stack':     ['Architect 🏗️','Builder 🧱','Precise 📐','Tumbling 🎲'],
  'bounce-pass':     ['Point Guard 🏀','Playmaker ⚡','On Fire 🔥','Learning 📐'],
  'gear-grind':      ['Engineer ⚙️','Mechanic 🔧','Grinder 💪','Tinkerer 🔩'],
  'wormhole-dive':   ['Warp Pilot 🚀','Deep Diver 🌀','Smooth Traveler ✨','Lost in Space 🛸'],
  'dream-catch':     ['Dream Weaver 🌙','Dream Catcher 🌟','Focused ✨','Daydreamer 💭'],
  'curling-sweep':   ['Skip Champion 🥌','Ice Master ❄️','Sweeper 🧹','Ice Rookie 🧊'],
  'rowing-rhythm':   ['Olympic Rower 🚣','Steady Oar ⚡','Endurance 💪','Learning Rhythm 🎵'],
  'baseball-swing':  ['Power Hitter 🏆','Solid Contact ⚾','Hot Streak 🔥','Three Strikes 😬'],
  'surf-ride':       ['Surf Pro 🏄','Wave Rider 🌊','Trick Artist ✨','Wipeout Queen 💦'],
  'ski-slalom':      ['Slalom King 🎿','Clean Run ⛷️','Speed Demon 🏎️','Powder Bro 🌨️'],
  'karate-chop':     ['Black Belt 🥋','Brown Belt ⚡','Disciplined 🎯','White Belt 🤜'],
  'pole-vault':      ['World Record 🏆','High Flyer 🦅','Ambitious 📈','Face-Plant 😬'],
  'table-tennis':    ['Ping Pong Pro 🏓','Quick Reflexes ⚡','Unbreakable 🎯','Miss Queen 🤷'],
  'gymnast-beam':    ['Gold Medalist 🥇','Gymnast 🤸','Balanced ⚖️','Falling Star 💫'],
  'pixel-skate':     ['Tony Hawk 🛹','Street Skater 💨','Combo King 👑','Beginner Bail 😅'],
  'mirror-mind':     ['Synchronized 🪞','Bilateral Brain 🧠','Focused 🎯','Off-Sync 🔀'],
  'color-word':      ['Stroop Master 🧠','Focused Mind 🔍','Consistent ✅','Color Confused 🌈'],
  'number-path':     ['Number Ninja 🥷','Sequential 📊','Precise 🎯','Scattered 🔢'],
  'shape-rotate':    ['Spatial Genius 🌐','Mind Turner 🔄','Consistent 🎯','Spatially Challenged 🧊'],
  'odd-one-out':     ['Pattern Master 🔎','Sharp Eye 👁️','Consistent 🎯','Distracted 🌀'],
  'sequence-unlock': ['Memory Palace 🏛️','Pattern Keeper 🔑','Persistent 💪','Forgetful 🤔'],
  'pattern-predict': ['Pattern Oracle 🔮','Analyst 📈','Systematic 📐','Random Guesser 🎲'],
  'word-flash':      ['Photographic 📸','Word Hoarder 📚','Persistent 💪','Fleeting Memory 💭'],
  'logic-gate':      ['Hardware Engineer 💻','Logic Master 🔌','Systematic ⚙️','Short Circuit ⚡'],
  'visual-search':   ['Eagle Eye 🦅','Hunter 🎯','Consistent 📍','Searching 🔍'],
  'binary-decode':   ['Bit Wizard 🧙','Code Breaker 💻','Binary Mind 🔢','Bit Confused 😵'],
  'rhythm-repeat':   ['Rhythm Master 🥁','Beat Keeper 🎵','Musical 🎶','Off Beat 🎸'],
  'category-clash':  ['Sort Savant 🧠','Quick Sorter ⚡','Clash Champion 🏆','Category Confused 🤷'],
  'attention-switch':['Multitasker 🎭','Dual Focus 🔀','Adaptive 🔄','Single-Track 🛤️'],
  'face-memory':     ['Face Reader 👁️','People Person 😊','Persistent 💪','Face Blind 😵'],
  'inference-trail': ['Sherlock 🔍','Detective 🕵️','Deductive 🧩','Still Thinking 🤔'],
  'reflex-grid':     ['Reflex Machine ⚡','Quick Trigger 🎯','Unbreakable 🔥','Slow Poke 🐌'],
  'spatial-map':     ['Human GPS 🗺️','Good Navigator 🧭','Directional 📍','Lost Again 😅'],
  'neon-chess':      ['Grandmaster ♟️','Tactician 🎯','Calculated 🧠','Blunder King 😬'],
  'dragon-breath':   ['Fire Dragon 🐉','Flame Thrower 🔥','Long Breath 💪','Spark 🌟'],
  'voice-sculpt':    ['Voice Artist 🎨','Clay Hummer 🎵','Tonal 🎶','Flat Note 🎤'],
  'echo-match':      ['Echo Master 🎵','Sound Mimic 🔊','Consistent 🎯','Echo Off 📢'],
  'howl-wolf':       ['Alpha Wolf 🐺','Pack Leader 🌕','Howler 🎶','Lone Wolf 🐾'],
  'beat-box':        ['Human Drum Machine 🥁','Beatboxer 🎤','In the Groove 🎵','Off Beat 🎶'],
  'hum-maze':        ['Voice Navigator 🗺️','Hum Pilot 🎵','Perseverant 💪','Maze Humbler 🤔'],
  'chant-power':     ['Power Chanter 💥','Vocal Force ⚡','Sustained 🔋','Whisper 🤫'],
  'whistle-launch':  ['Rocket Pilot 🚀','Astronaut 🌟','High Flyer ✈️','Ground Control 📡'],
  'vocal-shield':    ['Vocal Guardian 🛡️','Shield Singer 🎵','Sustained Voice 🔊','Needs Training 🎤'],
  'breath-sculpt':   ['Breath Artist 🌬️','Breath Control 🧘','Sculptor ✨','Still Learning 🌱'],
  'frequency-tune':  ['Perfect Pitch 🎼','Frequency Finder 📻','Patient Tuner ⏱️','Off Frequency 📡'],
  'lung-capacity':   ['Iron Lungs 🫁','Strong Breath 💪','Consistent 🎯','Quick Breather 😮'],
  'sound-waves':     ['Sonic Boom 💥','Wave Rider 🌊','Loud and Proud 📢','Barely Audible 🔇'],
  'sing-along':      ['Soprano Star 🌟','On Key 🎵','In Tune 🎶','Shower Singer 🚿'],
  'sound-garden':    ['Garden Maestro 🌸','Green Thumb 🌱','Planter 🌿','Seedling 🌾'],
  'shamrock-shuffle':['Lucky Legend 🍀','Shamrock Chaser ☘️','Nimble 🐇','Coal Catcher 🖤'],
  'egg-toss':        ['Egg Champion 🥚','Gentle Catcher 🤲','Consistent 🎯','Egg-sploder 💥'],
  'pinata-smash':    ['Piñata Pro 🎊','Party Animal 🎉','Strong Arm 💪','Blind Bat 🦇'],
  'flower-bouquet':  ['Florist 💐','Gardener 🌸','Petal Collector 🌺','Wilting 🥀'],
  'bbq-master':      ['Grill Master 🏆','Dad\'s Helper 👨‍🍳','Flipper 🍔','Char Artist 🔥'],
  'sparkler-draw':   ['Sparkle Artist 🌟','Fire Writer ✍️','Persistent Glow 🔦','Squiggly ✨'],
  'pencil-pack':     ['A+ Student 📚','Organized 📐','Quick Packer ⚡','Scattered 🎒'],
  'diya-light':      ['Diwali Master 🪔','Light Keeper 🕯️','Devoted 🙏','Still Learning ✨'],
  'dreidel-spin':    ['Dreidel King 🌟','Spinner ✡️','Strong Flick 💪','Shaky Spin 😬'],
  'dragon-parade':   ['Parade Dragon 🐉','Dragon Dancer 🎊','Long Dragon 🌟','Tangled Dragon 🪢'],
  'bead-catch':      ['Mardi Gras MVP 🎊','Bead Collector 📿','Nimble Catcher 🏃','Bead Spiller 😅'],
  'lantern-float':   ['Sky Lantern 🏮','Float Master 🕯️','High Blower 🌬️','Gentle Breeze 🍃'],
  'taco-toss':       ['Taco Chef 🌮','Taco Enthusiast 🫔','Ingredient Pro 👩‍🍳','Taco Disaster 😂'],
  'basket-weave':    ['Master Weaver 🧺','Basket Maker 🪢','Rhythmic 🎵','Tangled Strand 😅'],
};

// ─── Music pattern map ────────────────────────────────────────────────────────
const MUSIC = {
  sports: 'sports', holiday: 'holiday', breath: 'calm', cognitive: 'minimal', skill: 'drive',
};

// ─── Template builders ────────────────────────────────────────────────────────

function tpl(g, body, extraImports='') {
  const emoji = EMOJIS[g.id] || '🎮';
  const bg = BG[g.id] || '#0a0a0a';
  const pers = PERS[g.id] || ['Pro 🏆','Good 👍','Learning 📚','Starter 🌱'];
  const music = MUSIC[g.cat] || 'drive';

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
${extraImports}
const GAME_ID   = '${g.id}';
const ACCENT    = '${g.accent}';
const DURATION  = ${g.dur};
const GAME_EMOJI   = '${emoji}';
const GAME_TITLE   = '${g.title}';
const GAME_TAGLINE = '${g.tag}';
const BG_COLOR  = '${bg}';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = '${music}';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  const avg = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length : 9999;
  if (acc >= 0.75 && avg < 600) return '${pers[0]}';
  if (acc >= 0.55) return '${pers[1]}';
  if (sig.maxStreak >= 4) return '${pers[2]}';
  return '${pers[3]}';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

${body}

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

// ─── TAP-TARGET archetype ─────────────────────────────────────────────────────
function tapTargetBody(g) {
  const bg = BG[g.id] || '#0a0a0a';
  const pulse = g.accent + '44';
  const funcName = toFuncName(g.id);
  return `export default function ${funcName}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { score:0, hits:0, attempts:0, reactionTimes:[] as number[], maxStreak:0, streakCurrent:0 },
    targets: [] as {x:number,y:number,r:number,alpha:number,spawnTime:number,id:number}[],
    nextId: 0, speedMult: 1,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const spawnTarget = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const s = stateRef.current;
    const r = 26 + Math.random() * 20;
    const m = r + 8;
    s.targets.push({ x: m+Math.random()*(canvas.width-m*2), y: m+Math.random()*(canvas.height-m*2), r, alpha:1, spawnTime:Date.now(), id:s.nextId++ });
    s.sig.attempts++;
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    setFinalSig({...s.sig}); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.targets = []; s.nextId = 0; s.speedMult = 1;
    s.sig = { score:0, hits:0, attempts:0, reactionTimes:[], maxStreak:0, streakCurrent:0 };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic(MUSIC_PAT);
    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([100]); endGame(); }
    }, 1000);
    for (let i=0; i<3; i++) spawnTarget();

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width, H = canvas.height, now = Date.now();
      ctx.fillStyle = BG_COLOR; ctx.fillRect(0,0,W,H);
      ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1;
      for (let x=0; x<W; x+=48) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
      for (let y=0; y<H; y+=48) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

      s.targets = s.targets.filter(t => {
        const age = (now-t.spawnTime)/2800;
        t.alpha = Math.max(0, 1-age);
        if (t.alpha <= 0) { s.sig.streakCurrent=0; sfx.nearMiss(); haptic([20,30,20]); return false; }
        ctx.save(); ctx.globalAlpha = t.alpha;
        ctx.shadowBlur=18; ctx.shadowColor=ACCENT;
        ctx.strokeStyle=ACCENT; ctx.lineWidth=3;
        ctx.beginPath(); ctx.arc(t.x,t.y,t.r,0,Math.PI*2); ctx.stroke();
        ctx.fillStyle=ACCENT+'18'; ctx.fill();
        ctx.shadowBlur=0; ctx.fillStyle=ACCENT;
        ctx.beginPath(); ctx.arc(t.x,t.y,t.r*0.22,0,Math.PI*2); ctx.fill();
        const pulse = 0.4+0.4*Math.sin(now*0.004+t.id*1.2);
        ctx.strokeStyle=ACCENT+'66'; ctx.lineWidth=1; ctx.globalAlpha=t.alpha*pulse;
        ctx.beginPath(); ctx.arc(t.x,t.y,t.r*1.35,0,Math.PI*2); ctx.stroke();
        ctx.restore();
        return true;
      });
      if (s.targets.length < 4 && Math.random() < 0.018*s.speedMult) spawnTarget();
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnTarget]);

  const handleTap = useCallback((cx:number, cy:number) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const s = stateRef.current; if (!s.running) return;
    const rect = canvas.getBoundingClientRect();
    const x=(cx-rect.left)*(canvas.width/rect.width), y=(cy-rect.top)*(canvas.height/rect.height);
    let hit = false;
    s.targets = s.targets.filter(t => {
      if (hit) return true;
      const d = Math.hypot(x-t.x, y-t.y);
      if (d <= t.r+10) {
        hit=true; s.sig.hits++; s.sig.reactionTimes.push(Date.now()-t.spawnTime);
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
        const pts = s.sig.streakCurrent>=3 ? 2 : 1;
        s.sig.score+=pts; s.speedMult=Math.min(2.5,1+s.sig.hits*0.05);
        setScoreDisplay(s.sig.score); sfx.collect(); haptic([30]);
        return false;
      }
      return true;
    });
    if (!hit) { s.sig.streakCurrent=0; }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize=()=>{ canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; };
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{ if(phase==='playing') handleTap(e.clientX,e.clientY); };
    canvas.addEventListener('pointerdown',onDown);
    return ()=>{ window.removeEventListener('resize',resize); canvas.removeEventListener('pointerdown',onDown); };
  }, [phase, handleTap]);

  useEffect(()=>()=>{ cancelAnimationFrame(animRef.current); if(timerRef.current) clearInterval(timerRef.current); if(stopMusicRef.current) stopMusicRef.current(); },[]);

  const handleStart=useCallback((name:string,avatar:string)=>{ initAudio(); playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar); setPhase('countdown'); },[]);
  const handleCountdownDone=useCallback(()=>startLoop(),[startLoop]);
  const handlePlayAgain=useCallback(()=>{ setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); },[]);

  const buildInsights=(sig:Signals)=>{
    const acc=sig.attempts>0?Math.round((sig.hits/sig.attempts)*100):0;
    const avg=sig.reactionTimes.length>0?Math.round(sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length):0;
    return [
      {label:'Accuracy',value:acc+'%',color:acc>=70?'#4ade80':acc>=40?'#facc15':'#ef4444'},
      {label:'Avg React',value:avg+'ms',color:ACCENT},
      {label:'Best Streak',value:'×'+sig.maxStreak,color:ACCENT},
      {label:'Hits',value:String(sig.hits),color:'var(--color-text)'},
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
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
          onPlayAgain={handlePlayAgain} didWin={finalSig.hits>=8}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}`;
}

// ─── TIMING archetype ─────────────────────────────────────────────────────────
function timingBody(g) {
  const funcName = toFuncName(g.id);
  return `export default function ${funcName}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({
    running:false, timeLeft:DURATION,
    sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0},
    meter:0, meterDir:1, meterSpeed:0.012, targetZone:{min:0.38,max:0.62},
    active:true, spawnTime:Date.now(), phase:'active' as 'active'|'result', resultTimer:0,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const endGame = useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const nextRound = useCallback(()=>{
    const s=stateRef.current;
    s.meter=Math.random()*0.4;
    s.meterDir=Math.random()>0.5?1:-1;
    s.meterSpeed=0.01+s.sig.hits*0.0008;
    const w=0.12+Math.random()*0.12;
    const center=0.3+Math.random()*0.4;
    s.targetZone={min:center-w/2,max:center+w/2};
    s.phase='active'; s.spawnTime=Date.now(); s.sig.attempts++;
  },[]);

  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{ s.timeLeft--; setTimeLeft(s.timeLeft); if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();} },1000);
    nextRound();

    const loop=()=>{
      if(!s.running) return;
      const W=canvas.width, H=canvas.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);

      // Move meter
      s.meter+=s.meterDir*s.meterSpeed;
      if(s.meter>=1){s.meter=1;s.meterDir=-1;}
      if(s.meter<=0){s.meter=0;s.meterDir=1;}

      // Draw meter bar
      const barW=W*0.8, barX=(W-barW)/2, barY=H*0.5-16, barH=32;
      ctx.fillStyle='#ffffff11'; ctx.roundRect(barX,barY,barW,barH,8); ctx.fill();
      // Target zone
      const tzX=barX+barW*s.targetZone.min, tzW=barW*(s.targetZone.max-s.targetZone.min);
      ctx.fillStyle=ACCENT+'44'; ctx.roundRect(tzX,barY,tzW,barH,6); ctx.fill();
      ctx.strokeStyle=ACCENT+'88'; ctx.lineWidth=2; ctx.roundRect(tzX,barY,tzW,barH,6); ctx.stroke();
      // Indicator
      const indX=barX+barW*s.meter-4;
      ctx.shadowBlur=16; ctx.shadowColor=ACCENT;
      ctx.fillStyle=ACCENT; ctx.roundRect(indX,barY-4,8,barH+8,4); ctx.fill();
      ctx.shadowBlur=0;

      // Labels
      ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='14px monospace'; ctx.textAlign='center';
      ctx.fillText('TAP IN THE ZONE', W/2, barY-20);

      // Combo display
      if(s.sig.streakCurrent>=3){
        ctx.fillStyle=ACCENT; ctx.font='bold 18px sans-serif';
        ctx.fillText('×'+s.sig.streakCurrent+' COMBO!', W/2, barY+barH+30);
      }

      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,nextRound]);

  const handleTap=useCallback(()=>{
    const s=stateRef.current; if(!s.running||s.phase!=='active') return;
    const inZone=s.meter>=s.targetZone.min&&s.meter<=s.targetZone.max;
    s.sig.reactionTimes.push(Date.now()-s.spawnTime);
    if(inZone){
      s.sig.hits++; s.sig.streakCurrent++;
      if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
      const pts=s.sig.streakCurrent>=3?2:1;
      s.sig.score+=pts; setScoreDisplay(s.sig.score);
      sfx.collect(); haptic([30]);
    } else {
      s.sig.streakCurrent=0; sfx.nearMiss(); haptic([20,30,20]);
    }
    setTimeout(()=>{ if(s.running) nextRound(); },300);
  },[nextRound]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{ if(phase==='playing') handleTap(); };
    canvas.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onDown);};
  },[phase,handleTap]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  const handleStart=useCallback((name:string,avatar:string)=>{initAudio();playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);setPhase('countdown');},[]);
  const handleCountdownDone=useCallback(()=>startLoop(),[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  const buildInsights=(sig:Signals)=>{
    const acc=sig.attempts>0?Math.round((sig.hits/sig.attempts)*100):0;
    return [
      {label:'Timing Acc',value:acc+'%',color:acc>=70?'#4ade80':acc>=40?'#facc15':'#ef4444'},
      {label:'Perfect Hits',value:String(sig.hits),color:ACCENT},
      {label:'Best Streak',value:'×'+sig.maxStreak,color:ACCENT},
      {label:'Score',value:String(sig.score),color:'var(--color-text)'},
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
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

// ─── SWIPE archetype ──────────────────────────────────────────────────────────
function swipeBody(g) {
  const funcName = toFuncName(g.id);
  return `export default function ${funcName}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({
    running:false, timeLeft:DURATION,
    sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0},
    projectile:{x:0,y:0,vx:0,vy:0,active:false,spawnTime:0},
    target:{x:0,y:0,r:28},
    dragStart:{x:0,y:0,time:0}, dragging:false,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const spawnTarget=useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const s=stateRef.current;
    const m=60;
    s.target={x:m+Math.random()*(canvas.width-m*2), y:60+Math.random()*(canvas.height*0.4), r:28};
    s.sig.attempts++;
  },[]);

  const endGame=useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    s.projectile={x:canvas.width/2,y:canvas.height*0.8,vx:0,vy:0,active:false,spawnTime:0};
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{ s.timeLeft--; setTimeLeft(s.timeLeft); if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();} },1000);
    spawnTarget();

    const loop=()=>{
      if(!s.running) return;
      const W=canvas.width, H=canvas.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);

      // Draw target
      ctx.shadowBlur=16; ctx.shadowColor=ACCENT;
      ctx.strokeStyle=ACCENT; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(s.target.x,s.target.y,s.target.r,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle=ACCENT+'22'; ctx.fill();
      ctx.shadowBlur=0; ctx.fillStyle=ACCENT;
      ctx.beginPath(); ctx.arc(s.target.x,s.target.y,8,0,Math.PI*2); ctx.fill();

      // Move projectile
      if(s.projectile.active){
        s.projectile.x+=s.projectile.vx;
        s.projectile.y+=s.projectile.vy;
        s.projectile.vy+=0.3; // gravity
        // Draw projectile
        ctx.shadowBlur=12; ctx.shadowColor='#ffffff';
        ctx.fillStyle='#ffffff';
        ctx.beginPath(); ctx.arc(s.projectile.x,s.projectile.y,10,0,Math.PI*2); ctx.fill();
        ctx.shadowBlur=0;
        // Check hit
        const dx=s.projectile.x-s.target.x, dy=s.projectile.y-s.target.y;
        if(Math.hypot(dx,dy)<s.target.r+10){
          s.sig.hits++; s.sig.streakCurrent++;
          if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
          const pts=s.sig.streakCurrent>=3?2:1;
          s.sig.score+=pts; setScoreDisplay(s.sig.score);
          sfx.collect(); haptic([30]);
          s.projectile.active=false;
          spawnTarget();
        }
        // Off screen
        if(s.projectile.x<-50||s.projectile.x>W+50||s.projectile.y>H+50){
          s.sig.streakCurrent=0; s.projectile.active=false;
          sfx.nearMiss(); haptic([20,30,20]);
        }
      }

      // Drag guide line
      if(s.dragging && !s.projectile.active){
        ctx.strokeStyle=ACCENT+'66'; ctx.lineWidth=2; ctx.setLineDash([6,6]);
        ctx.beginPath(); ctx.moveTo(canvas.width/2,canvas.height*0.8); ctx.lineTo(s.dragStart.x,s.dragStart.y); ctx.stroke();
        ctx.setLineDash([]);
      }

      // Combo label
      if(s.sig.streakCurrent>=3){
        ctx.fillStyle=ACCENT; ctx.font='bold 18px sans-serif'; ctx.textAlign='center';
        ctx.fillText('×'+s.sig.streakCurrent+' COMBO!', W/2, H-40);
      }

      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,spawnTarget]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const s=stateRef.current;
      s.dragging=true; s.dragStart={x:e.clientX,y:e.clientY,time:Date.now()};
    };
    const onUp=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const s=stateRef.current;
      if(!s.dragging||s.projectile.active) return;
      s.dragging=false;
      const rect=canvas.getBoundingClientRect();
      const dx=s.dragStart.x-e.clientX, dy=s.dragStart.y-e.clientY;
      const spd=Math.min(Math.hypot(dx,dy)*0.12,18);
      const ang=Math.atan2(dy,dx);
      s.projectile={x:canvas.width/2,y:canvas.height*0.8,vx:Math.cos(ang)*spd,vy:Math.sin(ang)*spd,active:true,spawnTime:Date.now()};
      sfx.whoosh(); haptic([20]);
    };
    canvas.addEventListener('pointerdown',onDown);
    window.addEventListener('pointerup',onUp);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onDown);window.removeEventListener('pointerup',onUp);};
  },[phase]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  const handleStart=useCallback((name:string,avatar:string)=>{initAudio();playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);setPhase('countdown');},[]);
  const handleCountdownDone=useCallback(()=>startLoop(),[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  const buildInsights=(sig:Signals)=>{
    const acc=sig.attempts>0?Math.round((sig.hits/sig.attempts)*100):0;
    return [
      {label:'Accuracy',value:acc+'%',color:acc>=60?'#4ade80':acc>=35?'#facc15':'#ef4444'},
      {label:'Shots Hit',value:String(sig.hits),color:ACCENT},
      {label:'Best Streak',value:'×'+sig.maxStreak,color:ACCENT},
      {label:'Score',value:String(sig.score),color:'var(--color-text)'},
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
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

// ─── TILT archetype (accelerometer or simulated via touch drag) ───────────────
function tiltBody(g) {
  const funcName = toFuncName(g.id);
  return `export default function ${funcName}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({
    running:false, timeLeft:DURATION,
    sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0},
    playerX:0, tiltX:0,
    items:[] as {x:number,y:number,r:number,type:'good'|'bad',id:number}[],
    nextId:0,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  useEffect(()=>{
    const handler=(e:DeviceMotionEvent)=>{
      const s=stateRef.current; if(!s.running) return;
      const x=e.accelerationIncludingGravity?.x??0;
      s.tiltX=x;
    };
    window.addEventListener('devicemotion',handler);
    return()=>window.removeEventListener('devicemotion',handler);
  },[]);

  const spawnItem=useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const s=stateRef.current;
    const isBad=Math.random()<0.25;
    s.items.push({x:20+Math.random()*(canvas.width-40),y:-20,r:16,type:isBad?'bad':'good',id:s.nextId++});
    if(!isBad) s.sig.attempts++;
  },[]);

  const endGame=useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION; s.items=[]; s.nextId=0;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    s.playerX=canvas.width/2; s.tiltX=0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{ s.timeLeft--; setTimeLeft(s.timeLeft); if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();} },1000);
    let spawnTimer=0;

    const loop=()=>{
      if(!s.running) return;
      const W=canvas.width, H=canvas.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);

      // Move player by tilt
      s.playerX=Math.max(30,Math.min(W-30, s.playerX-s.tiltX*1.5));

      // Spawn items
      spawnTimer++;
      if(spawnTimer>40){spawnTimer=0;spawnItem();}

      // Draw player (basket/catcher)
      const py=H-50;
      ctx.shadowBlur=12; ctx.shadowColor=ACCENT;
      ctx.strokeStyle=ACCENT; ctx.lineWidth=4;
      ctx.beginPath(); ctx.arc(s.playerX,py,22,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle=ACCENT+'22'; ctx.fill();
      ctx.shadowBlur=0;

      // Update items
      const speed=2+s.sig.hits*0.08;
      s.items=s.items.filter(item=>{
        item.y+=speed;
        // Check catch
        if(Math.hypot(item.x-s.playerX,item.y-py)<28){
          if(item.type==='good'){
            s.sig.hits++; s.sig.streakCurrent++;
            if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
            const pts=s.sig.streakCurrent>=3?2:1;
            s.sig.score+=pts; setScoreDisplay(s.sig.score);
            sfx.collect(); haptic([30]);
          } else {
            s.sig.streakCurrent=0; sfx.nearMiss(); haptic([20,30,20]);
          }
          return false;
        }
        if(item.y>H+20) return false;
        // Draw item
        ctx.shadowBlur=10; ctx.shadowColor=item.type==='good'?ACCENT:'#ef4444';
        ctx.fillStyle=item.type==='good'?ACCENT:'#ef4444';
        ctx.beginPath(); ctx.arc(item.x,item.y,item.r,0,Math.PI*2); ctx.fill();
        ctx.shadowBlur=0;
        return true;
      });

      // Combo label
      if(s.sig.streakCurrent>=3){
        ctx.fillStyle=ACCENT; ctx.font='bold 16px sans-serif'; ctx.textAlign='center';
        ctx.fillText('×'+s.sig.streakCurrent, W/2, 80);
      }

      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,spawnItem]);

  // Touch fallback for tilt
  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onMove=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const s=stateRef.current;
      const rect=canvas.getBoundingClientRect();
      const x=(e.clientX-rect.left)*(canvas.width/rect.width);
      s.playerX=x;
    };
    canvas.addEventListener('pointermove',onMove);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointermove',onMove);};
  },[phase]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  const handleStart=useCallback((name:string,avatar:string)=>{initAudio();playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);setPhase('countdown');},[]);
  const handleCountdownDone=useCallback(()=>startLoop(),[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  const buildInsights=(sig:Signals)=>{
    const acc=sig.attempts>0?Math.round((sig.hits/sig.attempts)*100):0;
    return [
      {label:'Catch Rate',value:acc+'%',color:acc>=70?'#4ade80':acc>=40?'#facc15':'#ef4444'},
      {label:'Items Caught',value:String(sig.hits),color:ACCENT},
      {label:'Best Streak',value:'×'+sig.maxStreak,color:ACCENT},
      {label:'Score',value:String(sig.score),color:'var(--color-text)'},
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
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
          onPlayAgain={handlePlayAgain} didWin={finalSig.hits>=10}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}`;
}

// ─── COMBO archetype ──────────────────────────────────────────────────────────
function comboBody(g) {
  const funcName = toFuncName(g.id);
  return `export default function ${funcName}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({
    running:false, timeLeft:DURATION,
    sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0},
    zones:[] as {x:number,y:number,r:number,active:boolean,flash:number}[],
    sequence:[] as number[], progress:0, spawnTime:0,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const buildZones=useCallback((W:number,H:number)=>{
    const s=stateRef.current;
    const N=4;
    const cx=W/2, cy=H/2, r=Math.min(W,H)*0.32;
    s.zones=Array.from({length:N},((_,i)=>{
      const a=(i/N)*Math.PI*2-Math.PI/2;
      return {x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r,r:36,active:false,flash:0};
    }));
  },[]);

  const newSequence=useCallback(()=>{
    const s=stateRef.current;
    const len=Math.min(3+Math.floor(s.sig.hits/4),8);
    s.sequence=Array.from({length:len},()=>Math.floor(Math.random()*s.zones.length));
    s.progress=0; s.sig.attempts++;
    // Flash the sequence
    let delay=400;
    s.sequence.forEach((zi,i)=>{
      setTimeout(()=>{
        if(!s.running) return;
        s.zones[zi].flash=8;
      },delay*i);
    });
  },[]);

  const endGame=useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{ s.timeLeft--; setTimeLeft(s.timeLeft); if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();} },1000);
    buildZones(canvas.width,canvas.height);
    setTimeout(()=>newSequence(),800);

    const loop=()=>{
      if(!s.running) return;
      const W=canvas.width, H=canvas.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      // Draw zones
      s.zones.forEach((z,i)=>{
        const isNext=s.sequence[s.progress]===i && s.progress<s.sequence.length;
        ctx.shadowBlur=z.flash>0?24:10;
        ctx.shadowColor=z.flash>0?ACCENT:'rgba(255,255,255,0.3)';
        ctx.fillStyle=z.flash>0?ACCENT:ACCENT+'33';
        ctx.strokeStyle=isNext?ACCENT:'rgba(255,255,255,0.3)';
        ctx.lineWidth=isNext?3:2;
        ctx.beginPath(); ctx.arc(z.x,z.y,z.r,0,Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.shadowBlur=0;
        ctx.fillStyle='rgba(255,255,255,0.7)'; ctx.font='bold 16px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(String(i+1),z.x,z.y);
        if(z.flash>0) z.flash--;
      });
      // Progress indicator
      ctx.fillStyle='rgba(255,255,255,0.3)'; ctx.font='14px monospace'; ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText(s.progress+' / '+s.sequence.length, W/2, 60);
      // Combo
      if(s.sig.streakCurrent>=3){
        ctx.fillStyle=ACCENT; ctx.font='bold 16px sans-serif';
        ctx.fillText('×'+s.sig.streakCurrent+' COMBO!', W/2, 80);
      }
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,buildZones,newSequence]);

  const handleTap=useCallback((cx:number,cy:number)=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const s=stateRef.current; if(!s.running) return;
    const rect=canvas.getBoundingClientRect();
    const x=(cx-rect.left)*(canvas.width/rect.width), y=(cy-rect.top)*(canvas.height/rect.height);
    for(let i=0;i<s.zones.length;i++){
      const z=s.zones[i];
      if(Math.hypot(x-z.x,y-z.y)<=z.r+8){
        if(s.sequence[s.progress]===i){
          z.flash=10; s.progress++;
          sfx.click(); haptic([20]);
          if(s.progress>=s.sequence.length){
            // Completed
            s.sig.hits++; s.sig.streakCurrent++;
            if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
            const pts=s.sig.streakCurrent>=3?2:1;
            s.sig.score+=pts; setScoreDisplay(s.sig.score);
            sfx.success(); haptic([50,20,80]);
            setTimeout(()=>{ if(s.running) newSequence(); },600);
          }
        } else {
          s.sig.streakCurrent=0; s.progress=0;
          sfx.fail(); haptic([40,30,40]);
          setTimeout(()=>{ if(s.running) newSequence(); },500);
        }
        break;
      }
    }
  },[newSequence]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{
      canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight;
      buildZones(canvas.width,canvas.height);
    };
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{ if(phase==='playing') handleTap(e.clientX,e.clientY); };
    canvas.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onDown);};
  },[phase,handleTap,buildZones]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  const handleStart=useCallback((name:string,avatar:string)=>{initAudio();playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);setPhase('countdown');},[]);
  const handleCountdownDone=useCallback(()=>startLoop(),[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  const buildInsights=(sig:Signals)=>[
    {label:'Combos Done',value:String(sig.hits),color:ACCENT},
    {label:'Best Streak',value:'×'+sig.maxStreak,color:ACCENT},
    {label:'Score',value:String(sig.score),color:'var(--color-text)'},
    {label:'Attempts',value:String(sig.attempts),color:'rgba(255,255,255,0.5)'},
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
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

// ─── SEQUENCE-MEMORY archetype ────────────────────────────────────────────────
function sequenceBody(g) {
  const funcName = toFuncName(g.id);
  return `export default function ${funcName}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({
    running:false, timeLeft:DURATION,
    sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0},
    cells:[] as {x:number,y:number,w:number,h:number,lit:number,color:string}[],
    sequence:[] as number[], playerSeq:[] as number[],
    phase:'showing'as'showing'|'input',
    showIdx:0, showTimer:0,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const COLORS=['#ef4444','#3b82f6','#22c55e','#fbbf24','#a855f7','#f97316'];

  const buildGrid=useCallback((W:number,H:number)=>{
    const s=stateRef.current;
    const N=6, cols=3, rows=2;
    const cw=(W-60)/(cols), ch=80;
    const startX=30, startY=H/2-ch;
    s.cells=Array.from({length:N},((_,i)=>{
      const col=i%cols, row=Math.floor(i/cols);
      return {x:startX+col*cw+4,y:startY+row*(ch+8),w:cw-8,h:ch,lit:0,color:COLORS[i]};
    }));
  },[]);

  const newRound=useCallback(()=>{
    const s=stateRef.current;
    const len=Math.min(2+Math.floor(s.sig.hits/2),8);
    s.sequence=Array.from({length:len},()=>Math.floor(Math.random()*s.cells.length));
    s.playerSeq=[]; s.sig.attempts++;
    s.phase='showing'; s.showIdx=0; s.showTimer=0;
  },[]);

  const endGame=useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{ s.timeLeft--; setTimeLeft(s.timeLeft); if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();} },1000);
    buildGrid(canvas.width,canvas.height);
    setTimeout(()=>newRound(),600);
    let frame=0;

    const loop=()=>{
      if(!s.running) return;
      const W=canvas.width, H=canvas.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      frame++;

      // Show sequence animation
      if(s.phase==='showing'){
        s.showTimer++;
        if(s.showTimer%30===0){
          if(s.showIdx<s.sequence.length){
            const ci=s.sequence[s.showIdx];
            s.cells[ci].lit=20;
            sfx.countdown(); haptic([20]);
            s.showIdx++;
          } else {
            s.phase='input';
          }
        }
      }

      // Draw cells
      s.cells.forEach((c,i)=>{
        const bright=c.lit>0;
        ctx.shadowBlur=bright?20:0; ctx.shadowColor=c.color;
        ctx.fillStyle=bright?c.color:c.color+'33';
        ctx.strokeStyle=c.color+(bright?'':'55'); ctx.lineWidth=bright?3:1.5;
        ctx.roundRect(c.x,c.y,c.w,c.h,8); ctx.fill(); ctx.stroke();
        ctx.shadowBlur=0;
        if(c.lit>0) c.lit--;
        // Index label
        ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='12px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(String(i+1),c.x+c.w/2,c.y+c.h/2);
      });

      // Phase label
      ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.font='14px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText(s.phase==='showing'?'WATCH…':'YOUR TURN!',W/2, H*0.25);
      if(s.phase==='input'){
        ctx.fillStyle=ACCENT; ctx.font='13px monospace';
        ctx.fillText(s.playerSeq.length+' / '+s.sequence.length, W/2, H*0.28+18);
      }

      if(s.sig.streakCurrent>=3){
        ctx.fillStyle=ACCENT; ctx.font='bold 16px sans-serif';
        ctx.fillText('×'+s.sig.streakCurrent+' STREAK!', W/2, H-80);
      }

      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,buildGrid,newRound]);

  const handleTap=useCallback((cx:number,cy:number)=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const s=stateRef.current; if(!s.running||s.phase!=='input') return;
    const rect=canvas.getBoundingClientRect();
    const x=(cx-rect.left)*(canvas.width/rect.width), y=(cy-rect.top)*(canvas.height/rect.height);
    for(let i=0;i<s.cells.length;i++){
      const c=s.cells[i];
      if(x>=c.x&&x<=c.x+c.w&&y>=c.y&&y<=c.y+c.h){
        c.lit=12; sfx.click(); haptic([20]);
        s.playerSeq.push(i);
        const expected=s.sequence[s.playerSeq.length-1];
        if(i!==expected){
          // Wrong
          s.sig.streakCurrent=0; sfx.fail(); haptic([40,30,40]);
          setTimeout(()=>{ if(s.running) newRound(); },500);
          return;
        }
        if(s.playerSeq.length===s.sequence.length){
          // Correct!
          s.sig.hits++; s.sig.streakCurrent++;
          if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
          const pts=s.sig.streakCurrent>=3?2:1;
          s.sig.score+=pts; setScoreDisplay(s.sig.score);
          sfx.success(); haptic([50,20,80]);
          setTimeout(()=>{ if(s.running) newRound(); },600);
        }
        break;
      }
    }
  },[newRound]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{ canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; buildGrid(canvas.width,canvas.height); };
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{ if(phase==='playing') handleTap(e.clientX,e.clientY); };
    canvas.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onDown);};
  },[phase,handleTap,buildGrid]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  const handleStart=useCallback((name:string,avatar:string)=>{initAudio();playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);setPhase('countdown');},[]);
  const handleCountdownDone=useCallback(()=>startLoop(),[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  const buildInsights=(sig:Signals)=>[
    {label:'Sequences',value:String(sig.hits),color:ACCENT},
    {label:'Best Streak',value:'×'+sig.maxStreak,color:ACCENT},
    {label:'Score',value:String(sig.score),color:'var(--color-text)'},
    {label:'Attempts',value:String(sig.attempts),color:'rgba(255,255,255,0.5)'},
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
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
          onPlayAgain={handlePlayAgain} didWin={finalSig.hits>=4}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}`;
}

// ─── MULTIPLE-CHOICE archetype ────────────────────────────────────────────────
function choiceBody(g) {
  const funcName = toFuncName(g.id);
  const questions = getChoiceQuestions(g.id);
  return `export default function ${funcName}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({
    running:false, timeLeft:DURATION,
    sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0},
    question:{text:'',options:[] as string[],correct:0,spawnTime:0},
    buttons:[] as {x:number,y:number,w:number,h:number,label:string,idx:number,flash:number,correct:boolean}[],
    qTimer:0,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const QUESTIONS: {text:string,options:string[],correct:number}[] = ${JSON.stringify(questions)};

  const newQuestion=useCallback((W:number,H:number)=>{
    const s=stateRef.current;
    const q=QUESTIONS[Math.floor(Math.random()*QUESTIONS.length)];
    // Shuffle options
    const opts=[...q.options];
    const correctAns=opts[q.correct];
    for(let i=opts.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[opts[i],opts[j]]=[opts[j],opts[i]];}
    const newCorrect=opts.indexOf(correctAns);
    s.question={text:q.text,options:opts,correct:newCorrect,spawnTime:Date.now()};
    s.sig.attempts++;
    // Build buttons
    const N=opts.length, btnW=Math.min((W-60)/2,160), btnH=54, gap=12;
    const cols=2, rows=Math.ceil(N/cols);
    const totalW=cols*btnW+(cols-1)*gap, startX=(W-totalW)/2;
    const startY=H*0.55;
    s.buttons=Array.from({length:N},((_,i)=>{
      const col=i%cols, row=Math.floor(i/cols);
      return {x:startX+col*(btnW+gap),y:startY+row*(btnH+gap),w:btnW,h:btnH,label:opts[i],idx:i,flash:0,correct:i===newCorrect};
    }));
  },[]);

  const endGame=useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{ s.timeLeft--; setTimeLeft(s.timeLeft); if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();} },1000);
    newQuestion(canvas.width,canvas.height);

    const loop=()=>{
      if(!s.running) return;
      const W=canvas.width, H=canvas.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);

      // Question text
      ctx.fillStyle='rgba(255,255,255,0.9)';
      ctx.font='bold 17px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      const qY=H*0.35;
      // Word-wrap question
      const words=s.question.text.split(' '), maxW=W-40;
      let line='', lines:string[]=[];
      words.forEach(w=>{ const t=line+w+' '; if(ctx.measureText(t).width>maxW&&line){lines.push(line.trim());line=w+' ';}else line=t; });
      lines.push(line.trim());
      lines.forEach((l,i)=>ctx.fillText(l,W/2,qY+(i-lines.length/2+0.5)*24));

      // Buttons
      s.buttons.forEach(b=>{
        const bright=b.flash>0;
        ctx.shadowBlur=bright?16:0; ctx.shadowColor=bright?(b.correct?'#22c55e':'#ef4444'):'transparent';
        ctx.fillStyle=bright?(b.correct?'#22c55e33':'#ef444433'):ACCENT+'22';
        ctx.strokeStyle=bright?(b.correct?'#22c55e':ACCENT):ACCENT+'66'; ctx.lineWidth=bright?2.5:1.5;
        ctx.roundRect(b.x,b.y,b.w,b.h,10); ctx.fill(); ctx.stroke();
        ctx.shadowBlur=0;
        ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.font='13px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(b.label,b.x+b.w/2,b.y+b.h/2);
        if(b.flash>0) b.flash--;
      });

      if(s.sig.streakCurrent>=3){
        ctx.fillStyle=ACCENT; ctx.font='bold 15px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
        ctx.fillText('×'+s.sig.streakCurrent+' STREAK!', W/2, H-80);
      }

      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,newQuestion]);

  const handleTap=useCallback((cx:number,cy:number)=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const s=stateRef.current; if(!s.running) return;
    const rect=canvas.getBoundingClientRect();
    const x=(cx-rect.left)*(canvas.width/rect.width), y=(cy-rect.top)*(canvas.height/rect.height);
    for(const b of s.buttons){
      if(x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h){
        b.flash=20;
        s.sig.reactionTimes.push(Date.now()-s.question.spawnTime);
        if(b.correct){
          s.sig.hits++; s.sig.streakCurrent++;
          if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
          const pts=s.sig.streakCurrent>=3?2:1;
          s.sig.score+=pts; setScoreDisplay(s.sig.score);
          sfx.collect(); haptic([30]);
        } else {
          s.sig.streakCurrent=0; sfx.fail(); haptic([40,30,40]);
        }
        setTimeout(()=>{ if(s.running&&canvas) newQuestion(canvas.width,canvas.height); },400);
        break;
      }
    }
  },[newQuestion]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{ canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; };
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{ if(phase==='playing') handleTap(e.clientX,e.clientY); };
    canvas.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onDown);};
  },[phase,handleTap]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  const handleStart=useCallback((name:string,avatar:string)=>{initAudio();playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);setPhase('countdown');},[]);
  const handleCountdownDone=useCallback(()=>startLoop(),[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  const buildInsights=(sig:Signals)=>{
    const acc=sig.attempts>0?Math.round((sig.hits/sig.attempts)*100):0;
    const avg=sig.reactionTimes.length>0?Math.round(sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length):0;
    return [
      {label:'Accuracy',value:acc+'%',color:acc>=70?'#4ade80':acc>=40?'#facc15':'#ef4444'},
      {label:'Avg Speed',value:avg+'ms',color:ACCENT},
      {label:'Best Streak',value:'×'+sig.maxStreak,color:ACCENT},
      {label:'Correct',value:String(sig.hits),color:'var(--color-text)'},
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
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
          onPlayAgain={handlePlayAgain} didWin={finalSig.hits>=8}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}`;
}

// ─── RHYTHM archetype ─────────────────────────────────────────────────────────
function rhythmBody(g) {
  const funcName = toFuncName(g.id);
  return `export default function ${funcName}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({
    running:false, timeLeft:DURATION,
    sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0},
    lastTap:0, tapCount:0, bpm:0, lane:'left'as'left'|'right',
    targets:[] as {x:number,y:number,r:number,alpha:number,side:'left'|'right'}[],
    nextSpawn:0,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const endGame=useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION; s.tapCount=0; s.bpm=0;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    s.lastTap=0; s.lane='left'; s.targets=[];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{ s.timeLeft--; setTimeLeft(s.timeLeft); if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();} },1000);

    const loop=()=>{
      if(!s.running) return;
      const W=canvas.width, H=canvas.height, now=Date.now();
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);

      // Draw two tap zones
      const zR=70, lX=W*0.28, rX=W*0.72, zY=H*0.72;
      [lX,rX].forEach((zx,i)=>{
        const active=s.lane===(i===0?'left':'right');
        ctx.shadowBlur=active?20:5; ctx.shadowColor=ACCENT;
        ctx.strokeStyle=ACCENT+(active?'ff':'44'); ctx.lineWidth=active?4:2;
        ctx.beginPath(); ctx.arc(zx,zY,zR,0,Math.PI*2); ctx.stroke();
        ctx.fillStyle=ACCENT+(active?'22':'11'); ctx.fill();
        ctx.shadowBlur=0;
        ctx.fillStyle=ACCENT+(active?'cc':'44'); ctx.font='bold 14px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(i===0?'LEFT':'RIGHT',zx,zY);
      });

      // Animate targets
      s.targets=s.targets.filter(t=>{
        t.y-=3; t.alpha=Math.max(0,t.alpha-0.015);
        if(t.alpha<=0) return false;
        ctx.globalAlpha=t.alpha; ctx.fillStyle=ACCENT;
        ctx.beginPath(); ctx.arc(t.x,t.y,t.r,0,Math.PI*2); ctx.fill();        ctx.globalAlpha=1;
        return true;
      });

      // BPM display
      if(s.bpm>0){
        ctx.fillStyle=ACCENT; ctx.font='14px monospace'; ctx.textAlign='center'; ctx.textBaseline='top';
        ctx.fillText(Math.round(s.bpm)+' BPM', W/2, 70);
      }
      if(s.sig.streakCurrent>=3){
        ctx.fillStyle=ACCENT; ctx.font='bold 16px sans-serif';
        ctx.fillText('x'+s.sig.streakCurrent+' STREAK!', W/2, 90);
      }

      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  const handleTap=useCallback((side:'left'|'right')=>{
    const s=stateRef.current; if(!s.running) return;
    const now=Date.now();
    if(s.lane===side){
      // Correct side
      s.sig.hits++; s.sig.attempts++;
      const rt=s.lastTap>0?now-s.lastTap:500;
      s.sig.reactionTimes.push(rt);
      if(rt<800&&rt>100){
        const bpmNow=60000/rt; s.bpm=s.bpm*0.7+bpmNow*0.3;
      }
      s.sig.streakCurrent++;
      if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
      const pts=s.sig.streakCurrent>=3?2:1;
      s.sig.score+=pts; setScoreDisplay(s.sig.score);
      sfx.collect(); haptic([20]);
      // Add particle
      const canvas=canvasRef.current;
      if(canvas){
        const W=canvas.width, H=canvas.height;
        const zX=side==='left'?W*0.28:W*0.72;
        s.targets.push({x:zX,y:H*0.72,r:8,alpha:1,side});
      }
    } else {
      s.sig.streakCurrent=0; s.sig.attempts++; sfx.nearMiss(); haptic([20,30,20]);
    }
    s.lastTap=now; s.lane=side==='left'?'right':'left';
  },[]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{ canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; };
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const rect=canvas.getBoundingClientRect();
      const x=e.clientX-rect.left;
      handleTap(x<canvas.offsetWidth/2?'left':'right');
    };
    canvas.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onDown);};
  },[phase,handleTap]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  const handleStart=useCallback((name,avatar)=>{initAudio();playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);setPhase('countdown');},[]);
  const handleCountdownDone=useCallback(()=>startLoop(),[startLoop]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);

  const buildInsights=(sig)=>[
    {label:'Hits',value:String(sig.hits),color:ACCENT},
    {label:'Best Streak',value:'x'+sig.maxStreak,color:ACCENT},
    {label:'Peak BPM',value:sig.reactionTimes.length>0?Math.round(60000/Math.min(...sig.reactionTimes.filter(r=>r>100&&r<2000)))+'':'-',color:ACCENT},
    {label:'Score',value:String(sig.score),color:'var(--color-text)'},
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
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
          onPlayAgain={handlePlayAgain} didWin={finalSig.hits>=15}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}`;
}
