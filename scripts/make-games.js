/**
 * make-games.js — Complete self-contained generator for all remaining Glimmers games
 * Run: node scripts/make-games.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GAMES_DIR = path.join(ROOT, 'app/games');
const TESTS_DIR = path.join(ROOT, 'tests');

function mkFile(fp, content) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf8');
}

// ─── Game configs ──────────────────────────────────────────────────────────────
const GAMES = [
  { id:'thread-needle',   title:'Thread Needle',    tag:"Steady hands only. Pros need not apply.",  ac:'#e879f9', dur:30, cat:'skill',    arch:'tap', icon:'pivot_table_chart', ind:['healthcare','retail','cpg'] },
  { id:'jigsaw-rush',     title:'Jigsaw Rush',       tag:"Snap it. Fast. Clock's ticking.",          ac:'#fbbf24', dur:60, cat:'skill',    arch:'combo', icon:'extension', ind:['retail','technology','cpg'] },
  { id:'magnet-maze',     title:'Magnet Maze',       tag:"Attract, repel, navigate.",               ac:'#ef4444', dur:60, cat:'skill',    arch:'tap', icon:'explore', ind:['technology','automotive','healthcare'] },
  { id:'cable-wrap',      title:'Cable Wrap',        tag:"No tangles. No mercy.",                   ac:'#34d399', dur:45, cat:'skill',    arch:'tap', icon:'cable', ind:['technology','automotive','retail'] },
  { id:'bubble-burst',    title:'Bubble Burst',      tag:"Pinch at the perfect size!",              ac:'#67e8f9', dur:30, cat:'skill',    arch:'timing', icon:'bubble_chart', ind:['cpg','retail','food_bev'] },
  { id:'tower-stack',     title:'Tower Stack',       tag:"Drop it. Stack it. Don't tip it.",        ac:'#f59e0b', dur:60, cat:'skill',    arch:'timing', icon:'view_in_ar', ind:['cpg','retail','food_bev'] },
  { id:'bounce-pass',     title:'Bounce Pass',       tag:"Angle the bounce. Make the pass.",        ac:'#84cc16', dur:45, cat:'skill',    arch:'swipe', icon:'sports', ind:['sports','technology','cpg'] },
  { id:'gear-grind',      title:'Gear Grind',        tag:"Mesh the gears. Keep it spinning.",       ac:'#94a3b8', dur:60, cat:'skill',    arch:'combo', icon:'settings', ind:['automotive','technology','finance'] },
  { id:'wormhole-dive',   title:'Wormhole Dive',     tag:"Survive the warp. Keep diving.",          ac:'#7c3aed', dur:60, cat:'skill',    arch:'swipe', icon:'blur_circular', ind:['technology','automotive','finance'] },
  { id:'dream-catch',     title:'Dream Catch',       tag:"Float through. Catch the fragments.",     ac:'#818cf8', dur:60, cat:'skill',    arch:'tap', icon:'nights_stay', ind:['healthcare','retail','technology'] },
  { id:'curling-sweep',   title:'Curling Sweep',     tag:"Sweep it in. Sweep it hard.",             ac:'#67e8f9', dur:60, cat:'sports',   arch:'timing', icon:'cleaning_services', ind:['sports','cpg','retail'] },
  { id:'rowing-rhythm',   title:'Rowing Rhythm',     tag:"Sync your strokes. Row!",                 ac:'#38bdf8', dur:60, cat:'sports',   arch:'rhythm', icon:'rowing', ind:['sports','healthcare','food_bev'] },
  { id:'baseball-swing',  title:'Baseball Swing',    tag:"Watch the pitch. Swing!",                 ac:'#fbbf24', dur:45, cat:'sports',   arch:'timing', icon:'sports_baseball', ind:['sports','cpg','food_bev'] },
  { id:'surf-ride',       title:'Surf Ride',         tag:"Tilt to balance. Swipe for tricks.",      ac:'#06b6d4', dur:60, cat:'sports',   arch:'tilt', icon:'surfing', ind:['sports','cpg','retail'] },
  { id:'ski-slalom',      title:'Ski Slalom',        tag:"Weave through the gates. Go fast.",       ac:'#818cf8', dur:45, cat:'sports',   arch:'tilt', icon:'downhill_skiing', ind:['sports','cpg','automotive'] },
  { id:'karate-chop',     title:'Karate Chop',       tag:"Chop the right zone. Kata master.",       ac:'#ef4444', dur:30, cat:'sports',   arch:'combo', icon:'sports_martial_arts', ind:['sports','healthcare','technology'] },
  { id:'pole-vault',      title:'Pole Vault',        tag:"Run. Plant. Fly. Clear it!",              ac:'#a3e635', dur:45, cat:'sports',   arch:'swipe', icon:'sports_gymnastics', ind:['sports','healthcare','cpg'] },
  { id:'table-tennis',    title:'Table Tennis',      tag:"Return everything. Don't blink.",         ac:'#fb923c', dur:45, cat:'sports',   arch:'timing', icon:'sports_tennis', ind:['sports','technology','cpg'] },
  { id:'gymnast-beam',    title:'Gymnast Beam',      tag:"Balance. Execute. Stick the landing.",    ac:'#f472b6', dur:60, cat:'sports',   arch:'tilt', icon:'accessibility', ind:['sports','healthcare','retail'] },
  { id:'pixel-skate',     title:'Pixel Skate',       tag:"Flick tricks. Stack the combo.",          ac:'#10b981', dur:45, cat:'sports',   arch:'combo', icon:'skateboarding', ind:['sports','retail','technology'] },
  { id:'mirror-mind',     title:'Mirror Mind',       tag:"Both hands. Mirrored. Synchronized.",     ac:'#8b5cf6', dur:45, cat:'cognitive',arch:'choice', icon:'flip', ind:['technology','healthcare','finance'] },
  { id:'color-word',      title:'Color Word',        tag:"Ignore the meaning. Trust your eyes.",    ac:'#f43f5e', dur:30, cat:'cognitive',arch:'choice', icon:'text_fields', ind:['cpg','retail','technology'] },
  { id:'number-path',     title:'Number Path',       tag:"1 to N. Fastest finger wins.",            ac:'#22c55e', dur:45, cat:'cognitive',arch:'tap', icon:'123', ind:['finance','technology','healthcare'] },
  { id:'shape-rotate',    title:'Shape Rotate',      tag:"Spin it in your mind. Match it.",         ac:'#06b6d4', dur:60, cat:'cognitive',arch:'choice', icon:'3d_rotation', ind:['technology','automotive','finance'] },
  { id:'odd-one-out',     title:'Odd One Out',       tag:"Spot what doesn't belong. Quick!",       ac:'#f97316', dur:45, cat:'cognitive',arch:'tap', icon:'find_in_page', ind:['retail','cpg','technology'] },
  { id:'sequence-unlock', title:'Sequence Unlock',   tag:"Watch the lights. Repeat them.",          ac:'#a855f7', dur:60, cat:'cognitive',arch:'sequence', icon:'pattern', ind:['technology','finance','healthcare'] },
  { id:'pattern-predict', title:'Pattern Predict',   tag:"What comes next? You tell me.",           ac:'#14b8a6', dur:45, cat:'cognitive',arch:'choice', icon:'trending_up', ind:['finance','technology','cpg'] },
  { id:'word-flash',      title:'Word Flash',        tag:"Read it. Remember it. Recall it.",        ac:'#ec4899', dur:60, cat:'cognitive',arch:'sequence', icon:'flash_on', ind:['retail','cpg','healthcare'] },
  { id:'logic-gate',      title:'Logic Gate',        tag:"Wire the circuit. Get the output.",       ac:'#64748b', dur:60, cat:'cognitive',arch:'choice', icon:'device_hub', ind:['technology','finance','automotive'] },
  { id:'visual-search',   title:'Visual Search',     tag:"Find it. Tap it. Before the horde.",      ac:'#10b981', dur:30, cat:'cognitive',arch:'tap', icon:'search', ind:['retail','cpg','technology'] },
  { id:'binary-decode',   title:'Binary Decode',     tag:"Flip the bits. Find the number.",         ac:'#22c55e', dur:45, cat:'cognitive',arch:'choice', icon:'data_object', ind:['technology','finance','automotive'] },
  { id:'rhythm-repeat',   title:'Rhythm Repeat',     tag:"Hear the beat. Play it back.",            ac:'#f59e0b', dur:60, cat:'cognitive',arch:'sequence', icon:'music_note', ind:['cpg','retail','food_bev'] },
  { id:'category-clash',  title:'Category Clash',    tag:"Sort it fast. Categories clash!",         ac:'#fb923c', dur:30, cat:'cognitive',arch:'choice', icon:'category', ind:['retail','cpg','food_bev'] },
  { id:'attention-switch',title:'Attention Switch',  tag:"Dual task. Both streams. Now!",           ac:'#6366f1', dur:45, cat:'cognitive',arch:'combo', icon:'switch_access_shortcut', ind:['technology','finance','healthcare'] },
  { id:'face-memory',     title:'Face Memory',       tag:"Remember the faces. Spot them.",          ac:'#f43f5e', dur:60, cat:'cognitive',arch:'sequence', icon:'face', ind:['retail','healthcare','finance'] },
  { id:'inference-trail', title:'Inference Trail',   tag:"Follow the clues. Find the answer.",      ac:'#7c3aed', dur:60, cat:'cognitive',arch:'tap', icon:'lightbulb', ind:['finance','technology','healthcare'] },
  { id:'reflex-grid',     title:'Reflex Grid',       tag:"Tap the flash. Never miss twice.",        ac:'#ef4444', dur:30, cat:'cognitive',arch:'tap', icon:'grid_on', ind:['sports','technology','cpg'] },
  { id:'spatial-map',     title:'Spatial Map',       tag:"Study the map. Answer fast.",             ac:'#0ea5e9', dur:60, cat:'cognitive',arch:'choice', icon:'map', ind:['automotive','technology','retail'] },
  { id:'neon-chess',      title:'Neon Chess',        tag:"One move. Best move. Neon style.",        ac:'#00ffff', dur:60, cat:'cognitive',arch:'choice', icon:'grid_view', ind:['technology','finance','healthcare'] },
  { id:'dragon-breath',   title:'Dragon Breath',     tag:"Blow hard. Breathe fire!",                ac:'#ef4444', dur:30, cat:'breath',   arch:'micvol', icon:'local_fire_department', ind:['cpg','food_bev','sports'] },
  { id:'voice-sculpt',    title:'Voice Sculpt',      tag:"Hum to shape the clay.",                  ac:'#d946ef', dur:45, cat:'breath',   arch:'micpit', icon:'record_voice_over', ind:['healthcare','retail','technology'] },
  { id:'echo-match',      title:'Echo Match',        tag:"Match the echo. Hold the note.",          ac:'#06b6d4', dur:45, cat:'breath',   arch:'micvol', icon:'graphic_eq', ind:['healthcare','cpg','retail'] },
  { id:'howl-wolf',       title:'Howl Wolf',         tag:"Find your pitch. Call the pack.",         ac:'#6366f1', dur:45, cat:'breath',   arch:'micpit', icon:'pets', ind:['cpg','retail','food_bev'] },
  { id:'beat-box',        title:'Beat Box',          tag:"Drop the beat. Keep it going.",           ac:'#f97316', dur:60, cat:'breath',   arch:'micvol', icon:'music_note', ind:['cpg','food_bev','retail'] },
  { id:'hum-maze',        title:'Hum Maze',          tag:"Change your pitch. Navigate.",            ac:'#14b8a6', dur:60, cat:'breath',   arch:'micpit', icon:'route', ind:['healthcare','technology','retail'] },
  { id:'chant-power',     title:'Chant Power',       tag:"Hold the chant. Charge the power.",       ac:'#dc2626', dur:45, cat:'breath',   arch:'micvol', icon:'record_voice_over', ind:['sports','cpg','food_bev'] },
  { id:'whistle-launch',  title:'Whistle Launch',    tag:"Whistle to launch. Pitch to steer.",      ac:'#fbbf24', dur:45, cat:'breath',   arch:'micpit', icon:'rocket', ind:['technology','cpg','sports'] },
  { id:'vocal-shield',    title:'Vocal Shield',      tag:"Sing it. Block it. Hold it.",             ac:'#818cf8', dur:30, cat:'breath',   arch:'micpit', icon:'shield', ind:['healthcare','technology','sports'] },
  { id:'breath-sculpt',   title:'Breath Sculpt',     tag:"Breathe to shape. Slow or fast.",         ac:'#34d399', dur:60, cat:'breath',   arch:'micvol', icon:'air', ind:['healthcare','cpg','retail'] },
  { id:'frequency-tune',  title:'Frequency Tune',    tag:"Find the frequency. Hold it.",            ac:'#f472b6', dur:45, cat:'breath',   arch:'micpit', icon:'tune', ind:['technology','healthcare','automotive'] },
  { id:'lung-capacity',   title:'Lung Capacity',     tag:"Take one breath. Hold the note.",         ac:'#4ade80', dur:30, cat:'breath',   arch:'micvol', icon:'pulmonology', ind:['healthcare','sports','cpg'] },
  { id:'sound-waves',     title:'Sound Waves',       tag:"Shout the frequency. Shatter walls.",     ac:'#22d3ee', dur:45, cat:'breath',   arch:'micvol', icon:'graphic_eq', ind:['technology','cpg','sports'] },
  { id:'sing-along',      title:'Sing Along',        tag:"Match the note. Hold it perfect.",        ac:'#fb7185', dur:45, cat:'breath',   arch:'micpit', icon:'mic', ind:['cpg','retail','food_bev'] },
  { id:'sound-garden',    title:'Sound Garden',      tag:"Touch to grow. Grow to play.",            ac:'#4ade80', dur:60, cat:'breath',   arch:'tap', icon:'nature', ind:['healthcare','retail','technology'] },
  { id:'shamrock-shuffle',title:'Shamrock Shuffle',  tag:"Catch the luck. Dodge the coal.",         ac:'#16a34a', dur:30, cat:'holiday',  arch:'tilt', icon:'eco', ind:['retail','food_bev','cpg'] },
  { id:'egg-toss',        title:'Egg Toss',          tag:"Toss it. Catch it. Don't crack it!",      ac:'#fde68a', dur:45, cat:'holiday',  arch:'timing', icon:'egg', ind:['food_bev','cpg','retail'] },
  { id:'pinata-smash',    title:'Piñata Smash',      tag:"Find the weak spot. Smash!",              ac:'#ec4899', dur:30, cat:'holiday',  arch:'tap', icon:'celebration', ind:['food_bev','cpg','retail'] },
  { id:'flower-bouquet',  title:'Flower Bouquet',    tag:"Catch the petals. Build love.",           ac:'#f472b6', dur:45, cat:'holiday',  arch:'tap', icon:'local_florist', ind:['retail','cpg','healthcare'] },
  { id:'bbq-master',      title:'BBQ Master',        tag:"Flip it right. Don't burn dad's burger.", ac:'#f97316', dur:60, cat:'holiday',  arch:'timing', icon:'outdoor_grill', ind:['food_bev','cpg','retail'] },
  { id:'sparkler-draw',   title:'Sparkler Draw',     tag:"Draw with fire. Make it sparkle.",        ac:'#fbbf24', dur:45, cat:'holiday',  arch:'tap', icon:'auto_awesome', ind:['retail','cpg','sports'] },
  { id:'pencil-pack',     title:'Pencil Pack',       tag:"Sort and pack. School starts now.",       ac:'#3b82f6', dur:30, cat:'holiday',  arch:'choice', icon:'school', ind:['retail','cpg','technology'] },
  { id:'diya-light',      title:'Diya Light',        tag:"Light the diyas. In order!",              ac:'#f59e0b', dur:45, cat:'holiday',  arch:'sequence', icon:'emoji_objects', ind:['retail','cpg','food_bev'] },
  { id:'dreidel-spin',    title:'Dreidel Spin',      tag:"Flick it hard. Watch it spin!",           ac:'#3b82f6', dur:30, cat:'holiday',  arch:'swipe', icon:'rotate_right', ind:['retail','food_bev','cpg'] },
  { id:'dragon-parade',   title:'Dragon Parade',     tag:"Multi-touch the dragon. Make it dance!",  ac:'#ef4444', dur:60, cat:'holiday',  arch:'tap', icon:'cruelty_free', ind:['retail','food_bev','cpg'] },
  { id:'bead-catch',      title:'Bead Catch',        tag:"Tilt to catch the beads!",                ac:'#a855f7', dur:30, cat:'holiday',  arch:'tilt', icon:'bubble_chart', ind:['retail','food_bev','cpg'] },
  { id:'lantern-float',   title:'Lantern Float',     tag:"Blow them up. Watch them rise.",          ac:'#f97316', dur:45, cat:'holiday',  arch:'micvol', icon:'light', ind:['retail','cpg','food_bev'] },
  { id:'taco-toss',       title:'Taco Toss',         tag:"Catch the fillings. Build the taco.",     ac:'#84cc16', dur:45, cat:'holiday',  arch:'tilt', icon:'lunch_dining', ind:['food_bev','cpg','retail'] },
  { id:'basket-weave',    title:'Basket Weave',      tag:"Over. Under. Don't drop a strand.",       ac:'#d97706', dur:60, cat:'holiday',  arch:'rhythm', icon:'texture', ind:['retail','cpg','food_bev'] },
];

const EMOJIS = {'thread-needle':'🪡','jigsaw-rush':'🧩','magnet-maze':'🧲','cable-wrap':'🔌','bubble-burst':'🫧','tower-stack':'🏗️','bounce-pass':'🏀','gear-grind':'⚙️','wormhole-dive':'🌀','dream-catch':'🌙','curling-sweep':'🥌','rowing-rhythm':'🚣','baseball-swing':'⚾','surf-ride':'🏄','ski-slalom':'⛷️','karate-chop':'🥋','pole-vault':'🏃','table-tennis':'🏓','gymnast-beam':'🤸','pixel-skate':'🛹','mirror-mind':'🪞','color-word':'🌈','number-path':'🔢','shape-rotate':'🔄','odd-one-out':'🔎','sequence-unlock':'🔑','pattern-predict':'🔮','word-flash':'📸','logic-gate':'💻','visual-search':'🔍','binary-decode':'🧙','rhythm-repeat':'🥁','category-clash':'🏆','attention-switch':'🎭','face-memory':'👁️','inference-trail':'🕵️','reflex-grid':'⚡','spatial-map':'🗺️','neon-chess':'♟️','dragon-breath':'🐉','voice-sculpt':'🎨','echo-match':'🔊','howl-wolf':'🐺','beat-box':'🎤','hum-maze':'🗺️','chant-power':'💥','whistle-launch':'🚀','vocal-shield':'🛡️','breath-sculpt':'🌬️','frequency-tune':'📻','lung-capacity':'🫁','sound-waves':'🌊','sing-along':'🎵','sound-garden':'🌸','shamrock-shuffle':'🍀','egg-toss':'🥚','pinata-smash':'🎊','flower-bouquet':'💐','bbq-master':'🏆','sparkler-draw':'✨','pencil-pack':'📚','diya-light':'🪔','dreidel-spin':'✡️','dragon-parade':'🎊','bead-catch':'📿','lantern-float':'🏮','taco-toss':'🌮','basket-weave':'🧺'};

const BGS = {'thread-needle':'#0d001a','jigsaw-rush':'#1a1400','magnet-maze':'#0a0000','cable-wrap':'#001a0d','bubble-burst':'#001a1a','tower-stack':'#1a0d00','bounce-pass':'#071a00','gear-grind':'#0a0a0a','wormhole-dive':'#0a0014','dream-catch':'#070014','curling-sweep':'#001a1f','rowing-rhythm':'#001014','baseball-swing':'#140d00','surf-ride':'#001419','ski-slalom':'#0a0014','karate-chop':'#1a0000','pole-vault':'#071a00','table-tennis':'#14080a','gymnast-beam':'#1a0014','pixel-skate':'#001a0d','mirror-mind':'#07000f','color-word':'#14000a','number-path':'#001407','shape-rotate':'#001419','odd-one-out':'#14060a','sequence-unlock':'#0d0014','pattern-predict':'#001a17','word-flash':'#14000a','logic-gate':'#0a0c0f','visual-search':'#001207','binary-decode':'#001407','rhythm-repeat':'#14100a','category-clash':'#14060a','attention-switch':'#07070f','face-memory':'#14000a','inference-trail':'#0a0014','reflex-grid':'#140000','spatial-map':'#000f14','neon-chess':'#000f0f','dragon-breath':'#1a0000','voice-sculpt':'#14000f','echo-match':'#001419','howl-wolf':'#07070f','beat-box':'#14050a','hum-maze':'#001a17','chant-power':'#1a0000','whistle-launch':'#14100a','vocal-shield':'#0a0a14','breath-sculpt':'#001a0d','frequency-tune':'#14000f','lung-capacity':'#001407','sound-waves':'#001419','sing-along':'#14000a','sound-garden':'#001407','shamrock-shuffle':'#001407','egg-toss':'#141207','pinata-smash':'#14000a','flower-bouquet':'#14000f','bbq-master':'#14080a','sparkler-draw':'#0a0800','pencil-pack':'#00071a','diya-light':'#14100a','dreidel-spin':'#00071a','dragon-parade':'#1a0000','bead-catch':'#0d0014','lantern-float':'#14060a','taco-toss':'#071400','basket-weave':'#140d00'};

const PERS_MAP = {'thread-needle':['Surgeon 🔬','Craftsperson 🧵','Focused 🎯','Shaky ✋'],'jigsaw-rush':['Speed Puzzler ⚡','Sharp Eye 👁️','Persistent 💪','Learning 🧩'],'magnet-maze':['Navigator 🧭','Pathfinder 🗺️','Careful 🐢','Lost 😵'],'cable-wrap':['Cable Boss 🔌','Tidy 🧹','Tangled 🤕','Getting There 📎'],'bubble-burst':['Bubble Master 🫧','Precise 🎯','Tenacious 💪','Pop Learner 💭'],'tower-stack':['Architect 🏗️','Builder 🧱','Precise 📐','Tumbling 🎲'],'bounce-pass':['Point Guard 🏀','Playmaker ⚡','On Fire 🔥','Learning 📐'],'gear-grind':['Engineer ⚙️','Mechanic 🔧','Grinder 💪','Tinkerer 🔩'],'wormhole-dive':['Warp Pilot 🚀','Deep Diver 🌀','Smooth Traveler ✨','Lost in Space 🛸'],'dream-catch':['Dream Weaver 🌙','Dream Catcher 🌟','Focused ✨','Daydreamer 💭'],'curling-sweep':['Skip Champion 🥌','Ice Master ❄️','Sweeper 🧹','Ice Rookie 🧊'],'rowing-rhythm':['Olympic Rower 🚣','Steady Oar ⚡','Endurance 💪','Learning Rhythm 🎵'],'baseball-swing':['Power Hitter 🏆','Solid Contact ⚾','Hot Streak 🔥','Three Strikes 😬'],'surf-ride':['Surf Pro 🏄','Wave Rider 🌊','Trick Artist ✨','Wipeout Queen 💦'],'ski-slalom':['Slalom King 🎿','Clean Run ⛷️','Speed Demon 🏎️','Powder Bro 🌨️'],'karate-chop':['Black Belt 🥋','Brown Belt ⚡','Disciplined 🎯','White Belt 🤜'],'pole-vault':['World Record 🏆','High Flyer 🦅','Ambitious 📈','Face-Plant 😬'],'table-tennis':['Ping Pong Pro 🏓','Quick Reflexes ⚡','Unbreakable 🎯','Miss Queen 🤷'],'gymnast-beam':['Gold Medalist 🥇','Gymnast 🤸','Balanced ⚖️','Falling Star 💫'],'pixel-skate':['Tony Hawk 🛹','Street Skater 💨','Combo King 👑','Beginner Bail 😅'],'mirror-mind':['Synchronized 🪞','Bilateral Brain 🧠','Focused 🎯','Off-Sync 🔀'],'color-word':['Stroop Master 🧠','Focused Mind 🔍','Consistent ✅','Color Confused 🌈'],'number-path':['Number Ninja 🥷','Sequential 📊','Precise 🎯','Scattered 🔢'],'shape-rotate':['Spatial Genius 🌐','Mind Turner 🔄','Consistent 🎯','Spatially Challenged 🧊'],'odd-one-out':['Pattern Master 🔎','Sharp Eye 👁️','Consistent 🎯','Distracted 🌀'],'sequence-unlock':['Memory Palace 🏛️','Pattern Keeper 🔑','Persistent 💪','Forgetful 🤔'],'pattern-predict':['Pattern Oracle 🔮','Analyst 📈','Systematic 📐','Random Guesser 🎲'],'word-flash':['Photographic 📸','Word Hoarder 📚','Persistent 💪','Fleeting Memory 💭'],'logic-gate':['Hardware Engineer 💻','Logic Master 🔌','Systematic ⚙️','Short Circuit ⚡'],'visual-search':['Eagle Eye 🦅','Hunter 🎯','Consistent 📍','Searching 🔍'],'binary-decode':['Bit Wizard 🧙','Code Breaker 💻','Binary Mind 🔢','Bit Confused 😵'],'rhythm-repeat':['Rhythm Master 🥁','Beat Keeper 🎵','Musical 🎶','Off Beat 🎸'],'category-clash':['Sort Savant 🧠','Quick Sorter ⚡','Clash Champion 🏆','Category Confused 🤷'],'attention-switch':['Multitasker 🎭','Dual Focus 🔀','Adaptive 🔄','Single-Track 🛤️'],'face-memory':['Face Reader 👁️','People Person 😊','Persistent 💪','Face Blind 😵'],'inference-trail':['Sherlock 🔍','Detective 🕵️','Deductive 🧩','Still Thinking 🤔'],'reflex-grid':['Reflex Machine ⚡','Quick Trigger 🎯','Unbreakable 🔥','Slow Poke 🐌'],'spatial-map':['Human GPS 🗺️','Good Navigator 🧭','Directional 📍','Lost Again 😅'],'neon-chess':['Grandmaster ♟️','Tactician 🎯','Calculated 🧠','Blunder King 😬'],'dragon-breath':['Fire Dragon 🐉','Flame Thrower 🔥','Long Breath 💪','Spark 🌟'],'voice-sculpt':['Voice Artist 🎨','Clay Hummer 🎵','Tonal 🎶','Flat Note 🎤'],'echo-match':['Echo Master 🎵','Sound Mimic 🔊','Consistent 🎯','Echo Off 📢'],'howl-wolf':['Alpha Wolf 🐺','Pack Leader 🌕','Howler 🎶','Lone Wolf 🐾'],'beat-box':['Human Drum Machine 🥁','Beatboxer 🎤','In the Groove 🎵','Off Beat 🎶'],'hum-maze':['Voice Navigator 🗺️','Hum Pilot 🎵','Perseverant 💪','Maze Humbler 🤔'],'chant-power':['Power Chanter 💥','Vocal Force ⚡','Sustained 🔋','Whisper 🤫'],'whistle-launch':['Rocket Pilot 🚀','Astronaut 🌟','High Flyer ✈️','Ground Control 📡'],'vocal-shield':['Vocal Guardian 🛡️','Shield Singer 🎵','Sustained Voice 🔊','Needs Training 🎤'],'breath-sculpt':['Breath Artist 🌬️','Breath Control 🧘','Sculptor ✨','Still Learning 🌱'],'frequency-tune':['Perfect Pitch 🎼','Frequency Finder 📻','Patient Tuner ⏱️','Off Frequency 📡'],'lung-capacity':['Iron Lungs 🫁','Strong Breath 💪','Consistent 🎯','Quick Breather 😮'],'sound-waves':['Sonic Boom 💥','Wave Rider 🌊','Loud and Proud 📢','Barely Audible 🔇'],'sing-along':['Soprano Star 🌟','On Key 🎵','In Tune 🎶','Shower Singer 🚿'],'sound-garden':['Garden Maestro 🌸','Green Thumb 🌱','Planter 🌿','Seedling 🌾'],'shamrock-shuffle':['Lucky Legend 🍀','Shamrock Chaser ☘️','Nimble 🐇','Coal Catcher 🖤'],'egg-toss':['Egg Champion 🥚','Gentle Catcher 🤲','Consistent 🎯','Egg-sploder 💥'],'pinata-smash':['Piñata Pro 🎊','Party Animal 🎉','Strong Arm 💪','Blind Bat 🦇'],'flower-bouquet':['Florist 💐','Gardener 🌸','Petal Collector 🌺','Wilting 🥀'],'bbq-master':["Grill Master 🏆","Dad's Helper 👨‍🍳","Flipper 🍔","Char Artist 🔥"],'sparkler-draw':['Sparkle Artist 🌟','Fire Writer ✍️','Persistent Glow 🔦','Squiggly ✨'],'pencil-pack':['A+ Student 📚','Organized 📐','Quick Packer ⚡','Scattered 🎒'],'diya-light':['Diwali Master 🪔','Light Keeper 🕯️','Devoted 🙏','Still Learning ✨'],'dreidel-spin':['Dreidel King 🌟','Spinner ✡️','Strong Flick 💪','Shaky Spin 😬'],'dragon-parade':['Parade Dragon 🐉','Dragon Dancer 🎊','Long Dragon 🌟','Tangled Dragon 🪢'],'bead-catch':['Mardi Gras MVP 🎊','Bead Collector 📿','Nimble Catcher 🏃','Bead Spiller 😅'],'lantern-float':['Sky Lantern 🏮','Float Master 🕯️','High Blower 🌬️','Gentle Breeze 🍃'],'taco-toss':['Taco Chef 🌮','Taco Enthusiast 🫔','Ingredient Pro 👩‍🍳','Taco Disaster 😂'],'basket-weave':['Master Weaver 🧺','Basket Maker 🪢','Rhythmic 🎵','Tangled Strand 😅']};

const MUSIC_MAP = {sports:'sports',holiday:'holiday',breath:'calm',cognitive:'minimal',skill:'drive'};

// ─── Questions for choice games ────────────────────────────────────────────────
const Q = {
  default:[
    {q:'2 + 7 = ?',opts:['8','9','10','11'],c:1},
    {q:'Pick the even number',opts:['7','9','4','11'],c:2},
    {q:'5 × 3 = ?',opts:['12','15','18','20'],c:1},
    {q:'100 - 37 = ?',opts:['63','73','67','53'],c:0},
    {q:'Which is prime?',opts:['9','15','7','21'],c:2},
    {q:'Square root of 64?',opts:['6','7','8','9'],c:2},
    {q:'12 / 4 = ?',opts:['2','3','4','6'],c:1},
    {q:'15 + 28 = ?',opts:['41','42','43','44'],c:3},
  ],
  'mirror-mind':[{q:'Mirror the LEFT tap position',opts:['Same','Opposite side','Rotated 90°','Inverted'],c:1},{q:'Both sides must match?',opts:['Yes','No','Sometimes','Never'],c:0},{q:'Mirror means?',opts:['Copy','Flip','Rotate','Invert'],c:1},{q:'Synchronized means?',opts:['Fast','Together','Slow','Random'],c:1}],
  'color-word':[{q:'RED written in BLUE ink. Tap the ink color.',opts:['Red','Blue','Green','Yellow'],c:1},{q:'BLUE written in GREEN. Tap the ink color.',opts:['Blue','Green','Yellow','Red'],c:1},{q:'GREEN written in RED. Tap the ink color.',opts:['Blue','Red','Green','Purple'],c:1},{q:'YELLOW in PURPLE ink. Tap the ink color.',opts:['Yellow','Green','Purple','Blue'],c:2}],
  'shape-rotate':[{q:'Triangle rotated 180° looks like?',opts:['Same','Flipped','Square','Circle'],c:1},{q:'L rotated 90° clockwise?',opts:['Γ','⌐','J','7'],c:0},{q:'Square at 45° looks like?',opts:['Circle','Diamond','Rectangle','Triangle'],c:1},{q:'3D cube rotated 90°?',opts:['Same cube','Different cube','Flat square','Sphere'],c:1}],
  'logic-gate':[{q:'AND gate: inputs 1 and 0. Output?',opts:['0','1','Both','Error'],c:0},{q:'OR gate: inputs 0 and 0. Output?',opts:['0','1','Error','Undefined'],c:0},{q:'NOT gate: input 1. Output?',opts:['0','1','2','Null'],c:0},{q:'AND gate: inputs 1 and 1. Output?',opts:['0','1','2','Error'],c:1}],
  'binary-decode':[{q:'0101 in decimal?',opts:['3','4','5','6'],c:2},{q:'1000 in decimal?',opts:['6','7','8','9'],c:2},{q:'1111 in decimal?',opts:['13','14','15','16'],c:2},{q:'0011 in decimal?',opts:['1','2','3','4'],c:2},{q:'1010 in decimal?',opts:['8','9','10','11'],c:2}],
  'pattern-predict':[{q:'2, 4, 6, 8, ?',opts:['9','10','11','12'],c:1},{q:'1, 3, 9, 27, ?',opts:['54','72','81','90'],c:2},{q:'A, C, E, G, ?',opts:['H','I','J','K'],c:1},{q:'1, 1, 2, 3, 5, ?',opts:['7','8','9','10'],c:1},{q:'100, 50, 25, ?',opts:['10','12','12.5','15'],c:2}],
  'spatial-map':[{q:'Go North then turn East. Facing?',opts:['North','East','South','West'],c:1},{q:'Facing East, turn left. Now facing?',opts:['South','North','West','East'],c:1},{q:'Walk N 3, E 2, S 3. Net direction?',opts:['2 East','2 West','At Start','3 North'],c:0},{q:'South of East is?',opts:['Southeast','Southwest','Northeast','Northwest'],c:0}],
  'neon-chess':[{q:'Knight on e4. Can reach f6?',opts:['Yes','No','Maybe','Depends'],c:0},{q:'Rook on a1. Reach h1 in one move?',opts:['Yes','No','Only if empty','Diagonally'],c:0},{q:'Bishop moves?',opts:['Straight','Diagonally','L-shape','Any'],c:1},{q:'Checkmate means?',opts:['King in check, no legal move','King captured','Draw','Stalemate'],c:0}],
  'category-clash':[{q:'Fruits: Apple belongs in?',opts:['Fruit','Vegetable','Protein','Grain'],c:0},{q:'Soccer: Ball is?',opts:['Equipment','Clothing','Food','Vehicle'],c:0},{q:'Piano: It is a?',opts:['String','Wind','Percussion','Keyboard'],c:3},{q:'Dog: It is a?',opts:['Mammal','Bird','Fish','Reptile'],c:0}],
  'pencil-pack':[{q:'Pencil goes in?',opts:['Front pocket','Lunch box','Shoes','Jacket'],c:0},{q:'Lunch goes in?',opts:['Book bag','Lunch compartment','Pencil case','Gym bag'],c:1},{q:'Books belong in?',opts:['Pencil pouch','Main compartment','Lunch box','Gym bag'],c:1},{q:'Water bottle goes in?',opts:['Main pocket','Side pocket','Front zipper','Lunch box'],c:1}],
};

// ─── Generate questions JSON for a game ───────────────────────────────────────
function getQ(id) { return JSON.stringify(Q[id] || Q.default); }

// ─── File header ──────────────────────────────────────────────────────────────
function H(g) {
  const p = PERS_MAP[g.id] || ['Pro 🏆','Good 👍','Learning 📚','Starter 🌱'];
  const em = EMOJIS[g.id] || '🎮';
  const bg = BGS[g.id] || '#0a0a0a';
  const m = MUSIC_MAP[g.cat] || 'drive';
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

const GAME_ID = '${g.id}';
const ACCENT = '${g.ac}';
const DURATION = ${g.dur};
const GAME_EMOJI = '${em}';
const GAME_TITLE = '${g.title}';
const GAME_TAGLINE = '${g.tag.replace(/'/g, "\\'")}';
const BG_COLOR = '${bg}';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = '${m}';
const PB_KEY = 'mg_pb_${g.id}';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  const avg = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length : 9999;
  if (acc >= 0.75 && avg < 700) return '${p[0]}';
  if (acc >= 0.55) return '${p[1]}';
  if (sig.maxStreak >= 4) return '${p[2]}';
  return '${p[3]}';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}
`;
}

// ─── Shell wrapper ────────────────────────────────────────────────────────────
function gameShell(g, innerJsx, extraState='', extraEffects='') {
  return `
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);
  ${extraState}
  const handleStart = useCallback((name: string, avatar: string) => { initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); setPhase('countdown'); }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);
  const buildInsights = (sig: Signals) => {
    const acc = sig.attempts > 0 ? Math.round((sig.hits/sig.attempts)*100) : 0;
    const avg = sig.reactionTimes.length > 0 ? Math.round(sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length) : 0;
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    if (sig.score > pb) localStorage.setItem(PB_KEY, String(sig.score));
    return [
      { label: 'Accuracy', value: acc + '%', color: acc>=70?'#4ade80':acc>=40?'#facc15':'#ef4444' },
      { label: 'Avg React', value: avg + 'ms', color: ACCENT },
      { label: 'Best Streak', value: '×' + sig.maxStreak, color: ACCENT },
      { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
    ];
  };
  ${extraEffects}
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="${g.arch==='micvol'||g.arch==='micpit'?'Allow Mic':'Start'}" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&<>
        <canvas ref={canvasRef} aria-label="${g.title} game canvas" role="img" style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
        {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5},{label:'SCORE',value:scoreDisplay}]}/>}
      </>}
      ${innerJsx}
    </GameShell>
  );
}`;
}

const endAndWebhook = `{phase==='done'&&finalSig&&<>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.score>=5}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}`;

// ─── ARCHETYPE BUILDERS ────────────────────────────────────────────────────────

function tapArchetype(g) {
  const fn = toFn(g.id);
  return `${H(g)}
export default function ${fn}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, targets:[] as {x:number,y:number,r:number,alpha:number,spawnTime:number,id:number}[], nextId:0, speedMult:1 });

  const spawnTarget = useCallback(() => {
    const c=canvasRef.current; if(!c) return;
    const s=stateRef.current;
    const r=26+Math.random()*20, m=r+8;
    s.targets.push({x:m+Math.random()*(c.width-m*2),y:m+Math.random()*(c.height-m*2),r,alpha:1,spawnTime:Date.now(),id:s.nextId++});
    s.sig.attempts++;
  },[]);

  const endGame = useCallback(() => {
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop = useCallback(() => {
    const c=canvasRef.current; if(!c) return;
    const ctx=c.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION; s.targets=[]; s.nextId=0; s.speedMult=1;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();}},1000);
    for(let i=0;i<3;i++) spawnTarget();
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height,now=Date.now();
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      ctx.strokeStyle='rgba(255,255,255,0.03)'; ctx.lineWidth=1;
      for(let x=0;x<W;x+=52){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
      for(let y=0;y<H;y+=52){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
      s.targets=s.targets.filter(t=>{
        t.alpha=Math.max(0,1-(now-t.spawnTime)/2800);
        if(t.alpha<=0){s.sig.streakCurrent=0;sfx.nearMiss();haptic([20,30,20]);return false;}
        ctx.save(); ctx.globalAlpha=t.alpha;
        ctx.shadowBlur=18; ctx.shadowColor=ACCENT;
        ctx.strokeStyle=ACCENT; ctx.lineWidth=3;
        ctx.beginPath(); ctx.arc(t.x,t.y,t.r,0,Math.PI*2); ctx.stroke();
        ctx.fillStyle=ACCENT+'18'; ctx.fill();
        ctx.shadowBlur=0; ctx.fillStyle=ACCENT;
        ctx.beginPath(); ctx.arc(t.x,t.y,t.r*0.22,0,Math.PI*2); ctx.fill();
        const pulse=0.4+0.4*Math.sin(now*0.004+t.id*1.3);
        ctx.strokeStyle=ACCENT+'55'; ctx.lineWidth=1; ctx.globalAlpha=t.alpha*pulse;
        ctx.beginPath(); ctx.arc(t.x,t.y,t.r*1.38,0,Math.PI*2); ctx.stroke();
        ctx.restore(); return true;
      });
      if(s.targets.length<4&&Math.random()<0.018*s.speedMult) spawnTarget();
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 16px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText('×'+s.sig.streakCurrent+' COMBO!',W/2,68);}
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,spawnTarget]);

  const handleTap = useCallback((cx:number,cy:number)=>{
    const c=canvasRef.current; if(!c) return;
    const s=stateRef.current; if(!s.running) return;
    const rect=c.getBoundingClientRect();
    const x=(cx-rect.left)*(c.width/rect.width),y=(cy-rect.top)*(c.height/rect.height);
    let hit=false;
    s.targets=s.targets.filter(t=>{
      if(hit) return true;
      if(Math.hypot(x-t.x,y-t.y)<=t.r+10){
        hit=true; s.sig.hits++; s.sig.reactionTimes.push(Date.now()-t.spawnTime);
        s.sig.streakCurrent++; if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
        s.sig.score+=s.sig.streakCurrent>=3?2:1; s.speedMult=Math.min(2.5,1+s.sig.hits*0.05);
        setScoreDisplay(s.sig.score); sfx.collect(); haptic([30]); return false;
      }
      return true;
    });
    if(!hit){s.sig.streakCurrent=0;}
  },[]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{if(phase==='playing')handleTap(e.clientX,e.clientY);};
    c.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);c.removeEventListener('pointerdown',onDown);};
  },[phase,handleTap]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  ${gameShell(g, endAndWebhook)}
}`;
}

function timingArchetype(g) {
  const fn = toFn(g.id);
  return `${H(g)}
export default function ${fn}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, meter:0, dir:1, speed:0.012, zone:{min:0.38,max:0.62}, spawnTime:0 });

  const nextRound = useCallback(()=>{
    const s=stateRef.current; s.meter=Math.random()*0.3;
    s.dir=Math.random()>0.5?1:-1; s.speed=0.01+s.sig.hits*0.0007;
    const w=0.1+Math.random()*0.14; const c=0.3+Math.random()*0.4;
    s.zone={min:c-w/2,max:c+w/2}; s.spawnTime=Date.now(); s.sig.attempts++;
  },[]);

  const endGame = useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop = useCallback(()=>{
    const c=canvasRef.current; if(!c) return;
    const ctx=c.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();}},1000);
    nextRound();
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      s.meter+=s.dir*s.speed; if(s.meter>=1){s.meter=1;s.dir=-1;} if(s.meter<=0){s.meter=0;s.dir=1;}
      const bW=W*0.82,bX=(W-bW)/2,bY=H*0.5-18,bH=36;
      ctx.fillStyle='#ffffff10'; ctx.roundRect(bX,bY,bW,bH,10); ctx.fill();
      const tzX=bX+bW*s.zone.min,tzW=bW*(s.zone.max-s.zone.min);
      ctx.fillStyle=ACCENT+'44'; ctx.roundRect(tzX,bY,tzW,bH,8); ctx.fill();
      ctx.strokeStyle=ACCENT+'88'; ctx.lineWidth=2; ctx.roundRect(tzX,bY,tzW,bH,8); ctx.stroke();
      const iX=bX+bW*s.meter-5;
      ctx.shadowBlur=18; ctx.shadowColor=ACCENT; ctx.fillStyle=ACCENT;
      ctx.roundRect(iX,bY-6,10,bH+12,5); ctx.fill(); ctx.shadowBlur=0;
      ctx.fillStyle='rgba(255,255,255,0.45)'; ctx.font='14px monospace'; ctx.textAlign='center'; ctx.textBaseline='bottom';
      ctx.fillText('TAP IN THE ZONE',W/2,bY-12);
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 17px sans-serif';ctx.textBaseline='top';ctx.fillText('×'+s.sig.streakCurrent+' COMBO!',W/2,bY+bH+16);}
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,nextRound]);

  const handleTap = useCallback(()=>{
    const s=stateRef.current; if(!s.running) return;
    const inZone=s.meter>=s.zone.min&&s.meter<=s.zone.max;
    s.sig.reactionTimes.push(Date.now()-s.spawnTime);
    if(inZone){
      s.sig.hits++; s.sig.streakCurrent++;
      if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
      s.sig.score+=s.sig.streakCurrent>=3?2:1; setScoreDisplay(s.sig.score);
      sfx.collect(); haptic([30]);
    } else {
      s.sig.streakCurrent=0; sfx.nearMiss(); haptic([20,30,20]);
    }
    setTimeout(()=>{if(s.running)nextRound();},280);
  },[nextRound]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onDown=()=>{if(phase==='playing')handleTap();};
    c.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);c.removeEventListener('pointerdown',onDown);};
  },[phase,handleTap]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  ${gameShell(g, endAndWebhook)}
}`;
}

function swipeArchetype(g) {
  const fn = toFn(g.id);
  return `${H(g)}
export default function ${fn}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, proj:{x:0,y:0,vx:0,vy:0,active:false,spawnTime:0}, target:{x:0,y:0,r:30}, dragStart:{x:0,y:0}, dragging:false });

  const spawnTarget = useCallback(()=>{
    const c=canvasRef.current; if(!c) return;
    const s=stateRef.current; const m=60;
    s.target={x:m+Math.random()*(c.width-m*2),y:60+Math.random()*(c.height*0.45),r:28};
    s.sig.attempts++;
  },[]);

  const endGame = useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop = useCallback(()=>{
    const c=canvasRef.current; if(!c) return;
    const ctx=c.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    s.proj={x:c.width/2,y:c.height*0.82,vx:0,vy:0,active:false,spawnTime:0};
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();}},1000);
    spawnTarget();
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      // Target
      ctx.shadowBlur=16; ctx.shadowColor=ACCENT;
      ctx.strokeStyle=ACCENT; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(s.target.x,s.target.y,s.target.r,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle=ACCENT+'22'; ctx.fill();
      ctx.shadowBlur=0; ctx.fillStyle=ACCENT+'cc';
      ctx.beginPath(); ctx.arc(s.target.x,s.target.y,8,0,Math.PI*2); ctx.fill();
      // Launch zone indicator
      ctx.strokeStyle=ACCENT+'33'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(W/2,H*0.82,20,0,Math.PI*2); ctx.stroke();
      // Projectile
      if(s.proj.active){
        s.proj.x+=s.proj.vx; s.proj.y+=s.proj.vy; s.proj.vy+=0.35;
        ctx.shadowBlur=10; ctx.shadowColor='#ffffff'; ctx.fillStyle='#ffffff';
        ctx.beginPath(); ctx.arc(s.proj.x,s.proj.y,10,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0;
        if(Math.hypot(s.proj.x-s.target.x,s.proj.y-s.target.y)<s.target.r+12){
          s.sig.hits++; s.sig.streakCurrent++;
          if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
          s.sig.score+=s.sig.streakCurrent>=3?2:1; setScoreDisplay(s.sig.score);
          sfx.collect(); haptic([30]); s.proj.active=false; spawnTarget();
        }
        if(s.proj.x<-60||s.proj.x>W+60||s.proj.y>H+60){
          s.sig.streakCurrent=0; s.proj.active=false; sfx.nearMiss(); haptic([20,30,20]);
        }
      }
      // Drag guide
      if(s.dragging&&!s.proj.active){
        ctx.strokeStyle=ACCENT+'55'; ctx.lineWidth=2; ctx.setLineDash([6,4]);
        ctx.beginPath(); ctx.moveTo(W/2,H*0.82); ctx.lineTo(s.dragStart.x,s.dragStart.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 16px sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText('×'+s.sig.streakCurrent+' COMBO!',W/2,H-30);}
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,spawnTarget]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const s=stateRef.current; s.dragging=true; s.dragStart={x:e.clientX,y:e.clientY};
    };
    const onUp=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const s=stateRef.current; if(!s.dragging||s.proj.active) return;
      s.dragging=false;
      const dx=s.dragStart.x-e.clientX,dy=s.dragStart.y-e.clientY;
      const spd=Math.min(Math.hypot(dx,dy)*0.11,18);
      const a=Math.atan2(dy,dx);
      s.proj={x:c.width/2,y:c.height*0.82,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd,active:true,spawnTime:Date.now()};
      sfx.whoosh(); haptic([20]);
    };
    c.addEventListener('pointerdown',onDown); window.addEventListener('pointerup',onUp);
    return()=>{window.removeEventListener('resize',resize);c.removeEventListener('pointerdown',onDown);window.removeEventListener('pointerup',onUp);};
  },[phase]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  ${gameShell(g, endAndWebhook)}
}`;
}

function tiltArchetype(g) {
  const fn = toFn(g.id);
  return `${H(g)}
export default function ${fn}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, playerX:0, tiltX:0, items:[] as {x:number,y:number,r:number,type:'good'|'bad',id:number}[], nextId:0 });

  useEffect(()=>{
    const h=(e:DeviceMotionEvent)=>{ const s=stateRef.current; if(!s.running) return; s.tiltX=e.accelerationIncludingGravity?.x??0; };
    window.addEventListener('devicemotion',h);
    return()=>window.removeEventListener('devicemotion',h);
  },[]);

  const spawnItem = useCallback(()=>{
    const c=canvasRef.current; if(!c) return;
    const s=stateRef.current; const isBad=Math.random()<0.28;
    s.items.push({x:20+Math.random()*(c.width-40),y:-22,r:16,type:isBad?'bad':'good',id:s.nextId++});
    if(!isBad) s.sig.attempts++;
  },[]);

  const endGame = useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop = useCallback(()=>{
    const c=canvasRef.current; if(!c) return;
    const ctx=c.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION; s.items=[]; s.nextId=0; s.tiltX=0;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    s.playerX=c.width/2;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();}},1000);
    let spTimer=0;
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      s.playerX=Math.max(28,Math.min(W-28,s.playerX-s.tiltX*1.6));
      spTimer++; if(spTimer>38){spTimer=0;spawnItem();}
      const py=H-52, spd=2.2+s.sig.hits*0.09;
      ctx.shadowBlur=14; ctx.shadowColor=ACCENT;
      ctx.strokeStyle=ACCENT; ctx.lineWidth=4;
      ctx.beginPath(); ctx.arc(s.playerX,py,24,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle=ACCENT+'20'; ctx.fill(); ctx.shadowBlur=0;
      s.items=s.items.filter(it=>{
        it.y+=spd;
        if(Math.hypot(it.x-s.playerX,it.y-py)<30){
          if(it.type==='good'){
            s.sig.hits++; s.sig.streakCurrent++;
            if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
            s.sig.score+=s.sig.streakCurrent>=3?2:1; setScoreDisplay(s.sig.score);
            sfx.collect(); haptic([30]);
          } else {
            s.sig.streakCurrent=0; sfx.nearMiss(); haptic([20,30,20]);
          }
          return false;
        }
        if(it.y>H+20) return false;
        ctx.shadowBlur=10; ctx.shadowColor=it.type==='good'?ACCENT:'#ef4444';
        ctx.fillStyle=it.type==='good'?ACCENT:'#ef4444';
        ctx.beginPath(); ctx.arc(it.x,it.y,it.r,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0;
        return true;
      });
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 15px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText('×'+s.sig.streakCurrent,W/2,75);}
      ctx.fillStyle='rgba(255,255,255,0.3)'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='bottom';
      ctx.fillText('TILT or DRAG to move',W/2,H-12);
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,spawnItem]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onMove=(e:PointerEvent)=>{ if(phase!=='playing') return; const rect=c.getBoundingClientRect(); stateRef.current.playerX=(e.clientX-rect.left)*(c.width/rect.width); };
    c.addEventListener('pointermove',onMove);
    return()=>{window.removeEventListener('resize',resize);c.removeEventListener('pointermove',onMove);};
  },[phase]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  ${gameShell(g, endAndWebhook)}
}`;
}

function comboArchetype(g) {
  const fn = toFn(g.id);
  return `${H(g)}
export default function ${fn}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, zones:[] as {x:number,y:number,r:number,flash:number}[], sequence:[] as number[], progress:0, showing:true, showIdx:0, showTimer:0 });

  const buildZones = useCallback((W:number,H:number)=>{
    const s=stateRef.current; const N=4; const cx=W/2,cy=H*0.52; const R=Math.min(W,H)*0.31;
    s.zones=Array.from({length:N},(_,i)=>{ const a=(i/N)*Math.PI*2-Math.PI/2; return {x:cx+Math.cos(a)*R,y:cy+Math.sin(a)*R,r:38,flash:0}; });
  },[]);

  const newSeq = useCallback(()=>{
    const s=stateRef.current; const len=Math.min(2+Math.floor(s.sig.hits/3),7);
    s.sequence=Array.from({length:len},()=>Math.floor(Math.random()*s.zones.length));
    s.progress=0; s.showing=true; s.showIdx=0; s.showTimer=0; s.sig.attempts++;
  },[]);

  const endGame = useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop = useCallback(()=>{
    const c=canvasRef.current; if(!c) return;
    const ctx=c.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();}},1000);
    buildZones(c.width,c.height); setTimeout(()=>newSeq(),700);
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      if(s.showing){ s.showTimer++; if(s.showTimer%28===0){ if(s.showIdx<s.sequence.length){s.zones[s.sequence[s.showIdx]].flash=16;sfx.countdown();haptic([20]);s.showIdx++;}else{s.showing=false;} } }
      s.zones.forEach((z,i)=>{
        const isNext=!s.showing&&s.sequence[s.progress]===i;
        ctx.shadowBlur=z.flash>0?22:8; ctx.shadowColor=z.flash>0?ACCENT:'rgba(255,255,255,0.2)';
        ctx.fillStyle=z.flash>0?ACCENT:isNext?ACCENT+'44':ACCENT+'1a';
        ctx.strokeStyle=isNext?ACCENT:z.flash>0?ACCENT:'rgba(255,255,255,0.25)';
        ctx.lineWidth=isNext?3.5:z.flash>0?3:1.5;
        ctx.beginPath(); ctx.arc(z.x,z.y,z.r,0,Math.PI*2); ctx.fill(); ctx.stroke(); ctx.shadowBlur=0;
        ctx.fillStyle='rgba(255,255,255,0.7)'; ctx.font='bold 15px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(String(i+1),z.x,z.y);
        if(z.flash>0) z.flash--;
      });
      ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.font='13px monospace'; ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText(s.showing?'WATCH…':s.progress+' / '+s.sequence.length+' — YOUR TURN',W/2,56);
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 15px sans-serif';ctx.fillText('×'+s.sig.streakCurrent+' COMBO!',W/2,76);}
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,buildZones,newSeq]);

  const handleTap = useCallback((cx:number,cy:number)=>{
    const c=canvasRef.current; if(!c) return;
    const s=stateRef.current; if(!s.running||s.showing) return;
    const rect=c.getBoundingClientRect();
    const x=(cx-rect.left)*(c.width/rect.width),y=(cy-rect.top)*(c.height/rect.height);
    for(let i=0;i<s.zones.length;i++){
      const z=s.zones[i];
      if(Math.hypot(x-z.x,y-z.y)<=z.r+10){
        z.flash=12; sfx.click(); haptic([20]);
        if(s.sequence[s.progress]===i){
          s.progress++;
          if(s.progress>=s.sequence.length){
            s.sig.hits++; s.sig.streakCurrent++;
            if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
            s.sig.score+=s.sig.streakCurrent>=3?2:1; setScoreDisplay(s.sig.score);
            sfx.success(); haptic([50,20,80]); setTimeout(()=>{if(s.running)newSeq();},550);
          }
        } else {
          s.sig.streakCurrent=0; sfx.fail(); haptic([40,30,40]); setTimeout(()=>{if(s.running)newSeq();},480);
        }
        break;
      }
    }
  },[newSeq]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;buildZones(c.width,c.height);};
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{if(phase==='playing')handleTap(e.clientX,e.clientY);};
    c.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);c.removeEventListener('pointerdown',onDown);};
  },[phase,handleTap,buildZones]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  ${gameShell(g, endAndWebhook)}
}`;
}

function sequenceArchetype(g) {
  const fn = toFn(g.id);
  return `${H(g)}
export default function ${fn}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const COLORS = ['#ef4444','#3b82f6','#22c55e','#fbbf24','#a855f7','#f97316'];
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, cells:[] as {x:number,y:number,w:number,h:number,lit:number,color:string}[], sequence:[] as number[], playerSeq:[] as number[], phase:'showing'as'showing'|'input', showIdx:0, showTimer:0 });

  const buildGrid = useCallback((W:number,H:number)=>{
    const s=stateRef.current; const N=6,cols=3,cw=(W-56)/3,ch=72,sX=28,sY=H/2-ch;
    s.cells=Array.from({length:N},(_,i)=>({x:sX+(i%cols)*(cw+4),y:sY+Math.floor(i/cols)*(ch+8),w:cw,h:ch,lit:0,color:COLORS[i]}));
  },[]);

  const newRound = useCallback(()=>{
    const s=stateRef.current; const len=Math.min(2+Math.floor(s.sig.hits/2),8);
    s.sequence=Array.from({length:len},()=>Math.floor(Math.random()*s.cells.length));
    s.playerSeq=[]; s.phase='showing'; s.showIdx=0; s.showTimer=0; s.sig.attempts++;
  },[]);

  const endGame = useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop = useCallback(()=>{
    const c=canvasRef.current; if(!c) return;
    const ctx=c.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();}},1000);
    buildGrid(c.width,c.height); setTimeout(()=>newRound(),500);
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      if(s.phase==='showing'){s.showTimer++;if(s.showTimer%26===0){if(s.showIdx<s.sequence.length){s.cells[s.sequence[s.showIdx]].lit=18;sfx.countdown();haptic([15]);s.showIdx++;}else{s.phase='input';}}}
      s.cells.forEach((cel,i)=>{
        const bright=cel.lit>0;
        ctx.shadowBlur=bright?18:0; ctx.shadowColor=cel.color;
        ctx.fillStyle=bright?cel.color:cel.color+'2a';
        ctx.strokeStyle=cel.color+(bright?'':'44'); ctx.lineWidth=bright?2.5:1.5;
        ctx.roundRect(cel.x,cel.y,cel.w,cel.h,8); ctx.fill(); ctx.stroke(); ctx.shadowBlur=0;
        ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.font='11px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(String(i+1),cel.x+cel.w/2,cel.y+cel.h/2);
        if(cel.lit>0) cel.lit--;
      });
      ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='13px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText(s.phase==='showing'?'WATCH…':'TAP THE SEQUENCE! '+s.playerSeq.length+'/'+s.sequence.length,W/2,H*0.22);
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 15px sans-serif';ctx.fillText('×'+s.sig.streakCurrent+' STREAK!',W/2,H-70);}
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,buildGrid,newRound]);

  const handleTap = useCallback((cx:number,cy:number)=>{
    const c=canvasRef.current; if(!c) return;
    const s=stateRef.current; if(!s.running||s.phase!=='input') return;
    const rect=c.getBoundingClientRect();
    const x=(cx-rect.left)*(c.width/rect.width),y=(cy-rect.top)*(c.height/rect.height);
    for(let i=0;i<s.cells.length;i++){
      const cel=s.cells[i];
      if(x>=cel.x&&x<=cel.x+cel.w&&y>=cel.y&&y<=cel.y+cel.h){
        cel.lit=10; sfx.click(); haptic([15]); s.playerSeq.push(i);
        if(s.sequence[s.playerSeq.length-1]!==i){s.sig.streakCurrent=0;sfx.fail();haptic([40,30,40]);setTimeout(()=>{if(s.running)newRound();},450);return;}
        if(s.playerSeq.length===s.sequence.length){
          s.sig.hits++; s.sig.streakCurrent++;
          if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
          s.sig.score+=s.sig.streakCurrent>=3?2:1; setScoreDisplay(s.sig.score);
          sfx.success(); haptic([50,20,80]); setTimeout(()=>{if(s.running)newRound();},520);
        }
        break;
      }
    }
  },[newRound]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;buildGrid(c.width,c.height);};
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{if(phase==='playing')handleTap(e.clientX,e.clientY);};
    c.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);c.removeEventListener('pointerdown',onDown);};
  },[phase,handleTap,buildGrid]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  ${gameShell(g, endAndWebhook)}
}`;
}

function choiceArchetype(g) {
  const fn = toFn(g.id);
  const qData = JSON.stringify(Q[g.id] || Q.default);
  return `${H(g)}
export default function ${fn}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const QUESTIONS: {q:string,opts:string[],c:number}[] = ${qData};
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, cur:{q:'',opts:[] as string[],c:0,spawnTime:0}, btns:[] as {x:number,y:number,w:number,h:number,label:string,ok:boolean,flash:number}[] });

  const newQ = useCallback((W:number,H:number)=>{
    const s=stateRef.current; const q=QUESTIONS[Math.floor(Math.random()*QUESTIONS.length)];
    const opts=[...q.opts]; const ans=opts[q.c];
    for(let i=opts.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[opts[i],opts[j]]=[opts[j],opts[i]];}
    const nc=opts.indexOf(ans); s.cur={q:q.q,opts,c:nc,spawnTime:Date.now()}; s.sig.attempts++;
    const N=opts.length,bW=Math.min((W-60)/2,155),bH=52,gap=10;
    const sX=(W-2*bW-gap)/2, sY=H*0.54;
    s.btns=Array.from({length:N},(_,i)=>({x:sX+(i%2)*(bW+gap),y:sY+Math.floor(i/2)*(bH+gap),w:bW,h:bH,label:opts[i],ok:i===nc,flash:0}));
  },[]);

  const endGame = useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop = useCallback(()=>{
    const c=canvasRef.current; if(!c) return;
    const ctx=c.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();}},1000);
    newQ(c.width,c.height);
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      ctx.fillStyle='rgba(255,255,255,0.88)'; ctx.font='bold 16px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      const words=s.cur.q.split(' '),mW=W-40,lines:string[]=[]; let line='';
      words.forEach(w=>{const t=line+w+' ';if(ctx.measureText(t).width>mW&&line){lines.push(line.trim());line=w+' ';}else line=t;}); lines.push(line.trim());
      lines.forEach((l,i)=>ctx.fillText(l,W/2,H*0.33+(i-lines.length/2+0.5)*24));
      s.btns.forEach(b=>{
        const bright=b.flash>0;
        ctx.shadowBlur=bright?16:0; ctx.shadowColor=bright?(b.ok?'#22c55e':'#ef4444'):'transparent';
        ctx.fillStyle=bright?(b.ok?'#22c55e33':'#ef444433'):ACCENT+'20';
        ctx.strokeStyle=bright?(b.ok?'#22c55e':ACCENT):ACCENT+'55'; ctx.lineWidth=bright?2.5:1.5;
        ctx.roundRect(b.x,b.y,b.w,b.h,10); ctx.fill(); ctx.stroke(); ctx.shadowBlur=0;
        ctx.fillStyle='rgba(255,255,255,0.82)'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(b.label,b.x+b.w/2,b.y+b.h/2);
        if(b.flash>0) b.flash--;
      });
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 15px sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText('×'+s.sig.streakCurrent+' STREAK!',W/2,H-30);}
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,newQ]);

  const handleTap = useCallback((cx:number,cy:number)=>{
    const c=canvasRef.current; if(!c) return;
    const s=stateRef.current; if(!s.running) return;
    const rect=c.getBoundingClientRect();
    const x=(cx-rect.left)*(c.width/rect.width),y=(cy-rect.top)*(c.height/rect.height);
    for(const b of s.btns){
      if(x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h){
        b.flash=18; s.sig.reactionTimes.push(Date.now()-s.cur.spawnTime);
        if(b.ok){s.sig.hits++;s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;s.sig.score+=s.sig.streakCurrent>=3?2:1;setScoreDisplay(s.sig.score);sfx.collect();haptic([30]);}
        else{s.sig.streakCurrent=0;sfx.fail();haptic([40,30,40]);}
        setTimeout(()=>{if(s.running&&c)newQ(c.width,c.height);},360);
        break;
      }
    }
  },[newQ]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{if(phase==='playing')handleTap(e.clientX,e.clientY);};
    c.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);c.removeEventListener('pointerdown',onDown);};
  },[phase,handleTap]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  ${gameShell(g, endAndWebhook)}
}`;
}

function rhythmArchetype(g) {
  const fn = toFn(g.id);
  return `${H(g)}
export default function ${fn}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, lastTap:0, lane:'left'as'left'|'right', bpm:0, particles:[] as {x:number,y:number,r:number,alpha:number}[] });

  const endGame = useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop = useCallback(()=>{
    const c=canvasRef.current; if(!c) return;
    const ctx=c.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION; s.lastTap=0; s.bpm=0; s.lane='left'; s.particles=[];
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();}},1000);
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      const lX=W*0.27,rX=W*0.73,zY=H*0.7,zR=68;
      [lX,rX].forEach((zx,i)=>{
        const active=s.lane===(i===0?'left':'right');
        ctx.shadowBlur=active?22:6; ctx.shadowColor=ACCENT;
        ctx.strokeStyle=ACCENT+(active?'ff':'3a'); ctx.lineWidth=active?4.5:2;
        ctx.beginPath(); ctx.arc(zx,zY,zR,0,Math.PI*2); ctx.stroke();
        ctx.fillStyle=ACCENT+(active?'28':'0d'); ctx.fill(); ctx.shadowBlur=0;
        ctx.fillStyle=ACCENT+(active?'cc':'44'); ctx.font='bold 13px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(i===0?'LEFT':'RIGHT',zx,zY);
      });
      s.particles=s.particles.filter(p=>{p.y-=2.5;p.alpha-=0.025;if(p.alpha<=0)return false;ctx.globalAlpha=p.alpha;ctx.fillStyle=ACCENT;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;return true;});
      if(s.bpm>0){ctx.fillStyle=ACCENT;ctx.font='14px monospace';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(Math.round(s.bpm)+' BPM',W/2,68);}
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 15px sans-serif';ctx.fillText('×'+s.sig.streakCurrent+' COMBO!',W/2,90);}
      ctx.fillStyle='rgba(255,255,255,0.3)'; ctx.font='12px sans-serif'; ctx.textBaseline='bottom';
      ctx.fillText('TAP YOUR SIDE IN RHYTHM',W/2,H-14);
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  const handleTap = useCallback((side:'left'|'right')=>{
    const s=stateRef.current; if(!s.running) return;
    const now=Date.now();
    s.sig.attempts++;
    if(s.lane===side){
      s.sig.hits++; const rt=s.lastTap>0?now-s.lastTap:500;
      s.sig.reactionTimes.push(rt);
      if(rt>80&&rt<900){const b=60000/rt;s.bpm=s.bpm*0.7+b*0.3;}
      s.sig.streakCurrent++;
      if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
      s.sig.score+=s.sig.streakCurrent>=3?2:1; setScoreDisplay(s.sig.score);
      sfx.collect(); haptic([18]);
      const c=canvasRef.current;
      if(c){const W=c.width,H=c.height;s.particles.push({x:side==='left'?W*0.27:W*0.73,y:H*0.7,r:9,alpha:1});}
    } else {
      s.sig.streakCurrent=0; sfx.nearMiss(); haptic([20,30,20]);
    }
    s.lastTap=now; s.lane=side==='left'?'right':'left';
  },[]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const rect=c.getBoundingClientRect();
      handleTap(e.clientX-rect.left<c.offsetWidth/2?'left':'right');
    };
    c.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);c.removeEventListener('pointerdown',onDown);};
  },[phase,handleTap]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  ${gameShell(g, endAndWebhook)}
}`;
}

function micvolArchetype(g) {
  const fn = toFn(g.id);
  return `${H(g)}
export default function ${fn}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const analyserRef = useRef<AnalyserNode|null>(null);
  const streamRef = useRef<MediaStream|null>(null);
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, volume:0, power:0, hasMic:false, tX:0, tY:0 });

  const getVol = () => {
    const a=analyserRef.current; if(!a) return 0;
    const buf=new Uint8Array(a.frequencyBinCount); a.getByteFrequencyData(buf);
    return buf.reduce((s,v)=>s+v,0)/buf.length/255;
  };

  const endGame = useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    if(streamRef.current){streamRef.current.getTracks().forEach(t=>t.stop());streamRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop = useCallback(async()=>{
    const c=canvasRef.current; if(!c) return;
    const ctx=c.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});streamRef.current=stream;const ac=new AudioContext();const src=ac.createMediaStreamSource(stream);const an=ac.createAnalyser();an.fftSize=256;src.connect(an);analyserRef.current=an;s.hasMic=true;}catch{s.hasMic=false;}
    s.running=true; s.timeLeft=DURATION; s.power=0; s.volume=0;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    s.tX=50+Math.random()*(c.width-100); s.tY=80+Math.random()*(c.height*0.45); s.sig.attempts++;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();}},1000);
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      s.volume=s.hasMic?getVol():0.08+Math.random()*0.04;
      s.power=Math.min(1,Math.max(0,s.power+s.volume*0.09-0.013));
      const bW=W*0.72,bX=(W-bW)/2,bY=H*0.76,bH=22;
      ctx.fillStyle='#ffffff0e'; ctx.roundRect(bX,bY,bW,bH,6); ctx.fill();
      const g2=ctx.createLinearGradient(bX,0,bX+bW,0); g2.addColorStop(0,ACCENT); g2.addColorStop(1,'#ffffff');
      ctx.fillStyle=g2; ctx.roundRect(bX,bY,bW*s.power,bH,6); ctx.fill();
      ctx.strokeStyle=ACCENT+'55'; ctx.lineWidth=1.5; ctx.roundRect(bX,bY,bW,bH,6); ctx.stroke();
      ctx.shadowBlur=16; ctx.shadowColor=ACCENT; ctx.strokeStyle=ACCENT; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(s.tX,s.tY,32,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle=ACCENT+'20'; ctx.fill(); ctx.shadowBlur=0;
      if(s.power>0.12){
        const beamH=H*0.68-s.power*(H*0.52);
        ctx.strokeStyle=ACCENT+'88'; ctx.lineWidth=s.power*22;
        ctx.beginPath(); ctx.moveTo(W/2,H*0.68); ctx.lineTo(W/2,beamH); ctx.stroke();
        if(s.power>0.5&&Math.abs(W/2-s.tX)<64&&beamH<s.tY+34){
          s.sig.hits++; s.sig.streakCurrent++;
          if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
          s.sig.score+=s.sig.streakCurrent>=3?2:1; setScoreDisplay(s.sig.score);
          sfx.collect(); haptic([30]); s.power=0;
          s.tX=50+Math.random()*(W-100); s.tY=80+Math.random()*(H*0.45); s.sig.attempts++;
        }
      }
      ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText(s.hasMic?'SPEAK / BLOW INTO MIC':'TAP TO SIMULATE',W/2,H*0.84);
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 15px sans-serif';ctx.fillText('×'+s.sig.streakCurrent+' COMBO!',W/2,H*0.89);}
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onDown=()=>{if(phase==='playing')stateRef.current.power=Math.min(1,stateRef.current.power+0.22);};
    c.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);c.removeEventListener('pointerdown',onDown);};
  },[phase]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();if(streamRef.current)streamRef.current.getTracks().forEach(t=>t.stop());},[]);

  ${gameShell(g, endAndWebhook)}
}`;
}

function micpitArchetype(g) {
  const fn = toFn(g.id);
  return `${H(g)}
export default function ${fn}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const analyserRef = useRef<AnalyserNode|null>(null);
  const streamRef = useRef<MediaStream|null>(null);
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, pitchNorm:0.5, targetPitch:0.5, holdTime:0, hasMic:false });

  const getPitch = () => {
    const a=analyserRef.current; if(!a) return 0.5;
    const buf=new Float32Array(a.fftSize); a.getFloatTimeDomainData(buf);
    let c=0; for(let i=1;i<buf.length;i++) if(buf[i-1]<0&&buf[i]>=0) c++;
    return Math.min(1,Math.max(0,(c*(a.context.sampleRate/buf.length)-80)/800));
  };

  const endGame = useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    if(streamRef.current){streamRef.current.getTracks().forEach(t=>t.stop());streamRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop = useCallback(async()=>{
    const c=canvasRef.current; if(!c) return;
    const ctx=c.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});streamRef.current=stream;const ac=new AudioContext();const src=ac.createMediaStreamSource(stream);const an=ac.createAnalyser();an.fftSize=2048;src.connect(an);analyserRef.current=an;s.hasMic=true;}catch{s.hasMic=false;}
    s.running=true; s.timeLeft=DURATION; s.pitchNorm=0.5; s.holdTime=0;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    s.targetPitch=0.2+Math.random()*0.6; s.sig.attempts++;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();}},1000);
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      if(s.hasMic) s.pitchNorm=getPitch();
      else s.pitchNorm=0.5+0.06*Math.sin(Date.now()*0.0008);
      const sX=W*0.76,sW=28,sH=H*0.62,sY=(H-sH)/2;
      ctx.fillStyle='#ffffff0e'; ctx.roundRect(sX,sY,sW,sH,6); ctx.fill();
      const tzY=sY+sH*(1-s.targetPitch-0.07); const tzH=sH*0.14;
      ctx.fillStyle=ACCENT+'44'; ctx.roundRect(sX,tzY,sW,tzH,5); ctx.fill();
      ctx.strokeStyle=ACCENT; ctx.lineWidth=2; ctx.roundRect(sX,tzY,sW,tzH,5); ctx.stroke();
      const iY=sY+sH*(1-s.pitchNorm)-5;
      const inZ=Math.abs(s.pitchNorm-s.targetPitch)<0.07;
      ctx.shadowBlur=inZ?20:8; ctx.shadowColor=inZ?'#22c55e':ACCENT;
      ctx.fillStyle=inZ?'#22c55e':ACCENT; ctx.roundRect(sX-5,iY,sW+10,10,5); ctx.fill(); ctx.shadowBlur=0;
      if(inZ){
        s.holdTime+=1/60;
        const hW=Math.min(1,s.holdTime/1.5),mW=W*0.55,mX=(W-mW)/2,mY=H*0.8;
        ctx.fillStyle='#ffffff0d'; ctx.roundRect(mX,mY,mW,16,5); ctx.fill();
        ctx.fillStyle=ACCENT; ctx.roundRect(mX,mY,mW*hW,16,5); ctx.fill();
        if(s.holdTime>=1.5){
          s.sig.hits++; s.sig.streakCurrent++;
          if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
          s.sig.score+=s.sig.streakCurrent>=3?2:1; setScoreDisplay(s.sig.score);
          sfx.collect(); haptic([30]); s.holdTime=0; s.targetPitch=0.2+Math.random()*0.6; s.sig.attempts++;
        }
      } else {
        s.holdTime=Math.max(0,s.holdTime-0.04);
      }
      ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText(s.hasMic?'HUM / SING � MATCH THE TARGET':'DRAG UP/DOWN TO SIMULATE',W/2,H*0.88);
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 15px sans-serif';ctx.fillText('x'+s.sig.streakCurrent+' COMBO!',W/2,H*0.92);}
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onMove=(e:PointerEvent)=>{ if(phase!=='playing') return; const rect=c.getBoundingClientRect(); stateRef.current.pitchNorm=1-(e.clientY-rect.top)/rect.height; };
    c.addEventListener('pointermove',onMove);
    return()=>{window.removeEventListener('resize',resize);c.removeEventListener('pointermove',onMove);};
  },[phase]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();if(streamRef.current)streamRef.current.getTracks().forEach(t=>t.stop());},[]);

  ${gameShell(g, endAndWebhook)}
}`;
}

// --- Helper --------------------------------------------------------------------
function toFn(id) { return id.split('-').map(w=>w[0].toUpperCase()+w.slice(1)).join('')+'Game'; }

// --- Dispatch -----------------------------------------------------------------
function buildFile(g) {
  switch(g.arch) {
    case 'tap':     return tapArchetype(g);
    case 'timing':  return timingArchetype(g);
    case 'swipe':   return swipeArchetype(g);
    case 'tilt':    return tiltArchetype(g);
    case 'combo':   return comboArchetype(g);
    case 'sequence':return sequenceArchetype(g);
    case 'choice':  return choiceArchetype(g);
    case 'rhythm':  return rhythmArchetype(g);
    case 'micvol':  return micvolArchetype(g);
    case 'micpit':  return micpitArchetype(g);
    default:        return tapArchetype(g);
  }
}

// --- Test spec -----------------------------------------------------------------
function buildTestSpec(g) {
  const isMic=g.arch==='micvol'||g.arch==='micpit';
  return `import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { GamePage } from './pages/GamePage';

const GAME_ID = '${g.id}';
const GAME_PATH = '/games/${g.id}';
const ACCENT = '${g.ac}';
const DURATION_MS = ${g.dur * 1000};
${isMic?`
test.beforeEach(async({context})=>{
  await context.grantPermissions(['microphone']);
});`:''}

test('1.1 page loads without errors', async({page})=>{
  const errs: string[]=[];
  page.on('pageerror',e=>errs.push(e.message));
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  expect(errs).toHaveLength(0);
});
test('2.1 start screen visible', async({page})=>{
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await expect(gp.ctaButton).toBeVisible({timeout:4000});
});
test('2.2 name input visible', async({page})=>{
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto({skipUser:true});
  await expect(gp.nameInput).toBeVisible({timeout:4000});
});
test('2.3 CTA touch target =44px', async({page})=>{
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.expectTouchTargetSize(gp.ctaButton,44,'CTA');
});
test('2.4 back button touch target =44px', async({page})=>{
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.expectTouchTargetSize(gp.backButton,44,'back');
});
test('3.1 countdown after start', async({page})=>{
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.start();
  await gp.waitForCountdown();
});
test('4.1 timer visible during play', async({page})=>{
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.start();
  await gp.waitForPlaying();
  await expect(gp.timerEl).toBeVisible({timeout:3000});
});
test('4.2 timer decreases', async({page})=>{
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.start();
  await gp.waitForPlaying();
  await gp.expectTimerDecreasing(3000);
});
test('4.3 no crash during 10s', async({page})=>{
  const errs: string[]=[];
  page.on('pageerror',e=>errs.push(e.message));
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.start();
  await gp.waitForPlaying();
  await page.waitForTimeout(10000);
  expect(errs).toHaveLength(0);
});
test('5.1 score starts at 0', async({page})=>{
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.start();
  await gp.waitForPlaying();
  const t=await gp.scoreEl.textContent().catch(()=>'0');
  expect(parseInt(t??'0')).toBe(0);
});
test('5.2 game ends at timeout', async({page})=>{
  await page.addInitScript(()=>{const o=window.setInterval.bind(window);(window as any).setInterval=(fn:()=>void,ms:number,...a:unknown[])=>{if(ms===1000)return o(fn,100,...a);return o(fn,ms,...a);};});
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.start();
  await page.waitForSelector('button:has-text("Play Again")',{timeout:Math.ceil(DURATION_MS/10)+6000});
  await expect(gp.playAgainButton).toBeVisible();
});
test('6.1 end screen play-again visible', async({page})=>{
  await page.addInitScript(()=>{const o=window.setInterval.bind(window);(window as any).setInterval=(fn:()=>void,ms:number,...a:unknown[])=>{if(ms===1000)return o(fn,100,...a);return o(fn,ms,...a);};});
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.start();
  await gp.waitForEnd(DURATION_MS/10+5000);
  await expect(gp.playAgainButton).toBeVisible();
});
test('7.1 no horizontal scroll 375px', async({page})=>{
  await page.setViewportSize({width:375,height:667});
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  await gp.expectNoHorizontalScroll();
});
test('9.1 axe-core scan', async({page})=>{
  const gp=new GamePage(page,GAME_PATH,ACCENT);
  await gp.goto();
  const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).exclude('canvas').analyze();
  const crit=r.violations.filter(v=>v.impact==='critical'||v.impact==='serious');
  expect(crit).toHaveLength(0);
});
`;
}

// --- MAIN ---------------------------------------------------------------------
let built=0, skipped=0;
const builtIds=[];

for(const g of GAMES){
  const gameDir=path.join(GAMES_DIR,g.id);
  const gamePath=path.join(gameDir,'page.tsx');
  const testPath=path.join(TESTS_DIR,g.id+'.spec.ts');
  if(fs.existsSync(gamePath)){console.log('  SKIP: '+g.id);skipped++;continue;}
  console.log('  BUILD: '+g.id+' ['+g.arch+']');
  try{
    mkFile(gamePath,buildFile(g));
    mkFile(testPath,buildTestSpec(g));
    builtIds.push(g.id); built++;
  }catch(e){console.error('  ERROR '+g.id+': '+e.message);}
}
console.log('\nBuilt:'+built+' Skipped:'+skipped);

// --- Update games.ts -----------------------------------------------------------
const gtsPath=path.join(ROOT,'lib/games.ts');
let gts=fs.readFileSync(gtsPath,'utf8');
const fmtE=g=>`  { id:'${g.id}', title:'${g.title}', tagline:'${g.tag.replace(/'/g,"\\'")}', href:'/games/${g.id}', accentColor:'${g.ac}', duration:'${g.dur}s', icon:'${g.icon}', category:'${g.cat}', industries:${JSON.stringify(g.ind)} },`;

for(const g of GAMES){
  if(!builtIds.includes(g.id)) continue;
  if(gts.includes("'"+g.id+"'")) continue;
  const entry=fmtE(g)+'\n';
  const arr=g.cat==='sports'?'SPORTS_GAMES':g.cat==='holiday'?'HOLIDAY_GAMES':'SKILL_GAMES';
  const idx=gts.lastIndexOf('export const '+arr);
  if(idx>=0){const end=gts.indexOf('];',idx);if(end>=0&&!gts.slice(idx,end).includes(g.id)){gts=gts.slice(0,end)+entry+gts.slice(end);}}
}
fs.writeFileSync(gtsPath,gts,'utf8');
console.log('games.ts updated');
