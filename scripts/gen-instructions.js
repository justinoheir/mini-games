#!/usr/bin/env node
/**
 * Generates gameplay instructions for all Glimmer games using Claude Haiku.
 * Outputs: lib/gameInstructions.ts
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-3-haiku-20240307';

// All 161 games extracted from games.ts
const ALL_GAMES = [
  // SKILL_GAMES
  { id: 'paint-splash', title: 'Paint Splash', tagline: 'Shake and tilt to splatter paint. Cover the canvas!', category: 'skill', duration: '45s' },
  { id: 'web-weave', title: 'Web Weave', tagline: 'Drag between anchors to weave your web. Catch flies!', category: 'skill', duration: '60s' },
  { id: 'treasure-dive', title: 'Treasure Dive', tagline: 'Tilt to steer your diver. Grab treasure, dodge sharks!', category: 'skill', duration: '60s' },
  { id: 'frog-leap', title: 'Frog Leap', tagline: 'Tap left/right to leap to lily pads. Miss = splash!', category: 'skill', duration: '45s' },
  { id: 'wire-cross', title: 'Wire Cross', tagline: "Thread the ring. Don't touch the wire.", category: 'skill', duration: '45s' },
  { id: 'balloon-pop', title: 'Balloon Pop', tagline: 'Pinch to pop before they overflow!', category: 'skill', duration: '30s' },
  { id: 'slingshot-smash', title: 'Slingshot Smash', tagline: 'Stretch it. Aim it. Smash it.', category: 'skill', duration: '45s' },
  { id: 'ripple-tap', title: 'Ripple Tap', tagline: 'Tap the peak. Not too early, not late.', category: 'skill', duration: '30s' },
  { id: 'pendulum-swing', title: 'Pendulum Swing', tagline: "Keep the rhythm. Don't let it stop.", category: 'skill', duration: '60s' },
  { id: 'node-connect', title: 'Node Connect', tagline: 'Link the dots. Cross nothing.', category: 'skill', duration: '45s' },
  { id: 'orbit-launch', title: 'Orbit Launch', tagline: 'Nail the angle. Own the orbit.', category: 'skill', duration: '45s' },
  { id: 'speed-sort', title: 'Speed Sort', tagline: 'Left or right. Think fast.', category: 'skill', duration: '30s' },
  { id: 'spring-leap', title: 'Spring Leap', tagline: 'Hold to charge. Release to fly.', category: 'skill', duration: '45s' },
  { id: 'crystal-catch', title: 'Crystal Catch', tagline: "Tilt and collect. Don't shatter them.", category: 'skill', duration: '45s' },
  { id: 'wobble-stack', title: 'Wobble Stack', tagline: 'Keep it balanced. It gets worse.', category: 'skill', duration: '60s' },
  { id: 'chain-reaction', title: 'Chain Reaction', tagline: 'One tap. Maximum chaos.', category: 'skill', duration: '30s' },
  { id: 'pixel-paint', title: 'Pixel Paint', tagline: 'Speed-paint the pattern. Go!', category: 'skill', duration: '30s' },
  { id: 'drop-zone', title: 'Drop Zone', tagline: 'Release at the right moment.', category: 'skill', duration: '45s' },
  { id: 'laser-guide', title: 'Laser Guide', tagline: 'Reflect the beam. Hit the target.', category: 'skill', duration: '45s' },
  { id: 'friction-slide', title: 'Friction Slide', tagline: 'Flick with precision. Stop on target.', category: 'skill', duration: '45s' },
  { id: 'gravity-well', title: 'Gravity Well', tagline: "Orbit the well. Don't get pulled in.", category: 'skill', duration: '60s' },
  { id: 'tilt-maze', title: 'Tilt Maze', tagline: 'Roll the ball with your body', category: 'skill', duration: '60s' },
  { id: 'whisper-bomb', title: 'Whisper Bomb', tagline: 'Stay silent. Defuse the bomb.', category: 'breath', duration: '30s' },
  { id: 'breath-rider', title: 'Breath Rider', tagline: 'Fly with your breath', category: 'breath', duration: '45s' },
  { id: 'steady-hand', title: 'Steady Hand', tagline: 'Hold perfectly still. We dare you.', category: 'skill', duration: '30s' },
  { id: 'tunnel', title: 'Infinite Tunnel', tagline: "Dodge the rings. Don't crash.", category: 'skill', duration: '60s' },
  { id: 'pulse-sphere', title: 'Pulse Sphere', tagline: 'Touch. Move. Breathe. Watch it respond.', category: 'breath', duration: '60s' },
  { id: 'shadow-tap', title: 'Shadow Tap', tagline: "Tap what you see. Before it's gone.", category: 'cognitive', duration: '45s' },
  { id: 'color-cascade', title: 'Color Cascade', tagline: 'Match the color. Match the speed.', category: 'cognitive', duration: '45s' },
  { id: 'equation-tap', title: 'Equation Tap', tagline: 'Solve it. Tap it. Beat the clock.', category: 'cognitive', duration: '45s' },
  { id: 'color-word', title: 'Color Word', tagline: 'Ignore the meaning. Trust your eyes.', category: 'cognitive', duration: '30s' },
  { id: 'visual-search', title: 'Visual Search', tagline: 'Find it. Tap it. Before the horde.', category: 'cognitive', duration: '45s' },
  { id: 'odd-one-out', title: 'Odd One Out', tagline: "Spot what doesn't belong. Quick!", category: 'cognitive', duration: '45s' },
  { id: 'pattern-predict', title: 'Pattern Predict', tagline: 'What comes next? You tell me.', category: 'cognitive', duration: '45s' },
  { id: 'reflex-grid', title: 'Reflex Grid', tagline: 'Tap the flash. Never miss twice.', category: 'cognitive', duration: '30s' },
  { id: 'sequence-unlock', title: 'Sequence Unlock', tagline: 'Watch the lights. Repeat them.', category: 'cognitive', duration: '60s' },
  { id: 'word-flash', title: 'Word Flash', tagline: 'Read it. Remember it. Recall it.', category: 'cognitive', duration: '60s' },
  { id: 'rhythm-repeat', title: 'Rhythm Repeat', tagline: 'Hear the beat. Play it back.', category: 'cognitive', duration: '60s' },
  { id: 'category-clash', title: 'Category Clash', tagline: 'Sort it fast. Categories clash!', category: 'cognitive', duration: '30s' },
  { id: 'memory-grid', title: 'Memory Grid', tagline: 'Remember the pattern. Repeat it.', category: 'cognitive', duration: '60s' },
  { id: 'reaction-chain', title: 'Reaction Chain', tagline: 'Tap fast. Keep the chain alive.', category: 'cognitive', duration: '45s' },
  { id: 'stack-drop', title: 'Stack Drop', tagline: "Drop it. Stack it. Don't tip it.", category: 'skill', duration: '60s' },
  { id: 'dodge-blitz', title: 'Dodge Blitz', tagline: "Tilt to survive. Don't stop moving.", category: 'skill', duration: '45s' },
  { id: 'crowd-roar', title: 'Crowd Roar', tagline: "Roar loud. Hold it. Don't fade.", category: 'breath', duration: '45s' },
  { id: 'balance-beam', title: 'Balance Beam', tagline: 'Keep the ball on the beam. Stay still.', category: 'skill', duration: '60s' },
  { id: 'path-trace', title: 'Path Trace', tagline: "Follow the line. Don't stray.", category: 'skill', duration: '45s' },
  { id: 'pitch-match', title: 'Pitch Match', tagline: 'Hit the note. Hold it. Feel it.', category: 'breath', duration: '45s' },
  { id: 'symbol-scan', title: 'Symbol Scan', tagline: 'Find it. Tap it. Before the clock runs out.', category: 'cognitive', duration: '60s' },
  { id: 'neon-archer', title: 'Neon Archer', tagline: 'Swipe to aim. Release at the perfect moment.', category: 'sports', duration: '60s' },
  { id: 'ice-sculptor', title: 'Ice Sculptor', tagline: 'Chip away ice. Reveal the hidden shape.', category: 'skill', duration: '45s' },
  { id: 'gravity-flip', title: 'Gravity Flip', tagline: 'Tap to flip gravity. Dodge everything.', category: 'skill', duration: '60s' },
  { id: 'volcano-tap', title: 'Volcano Tap', tagline: 'Pop the bubbles. Miss three — eruption!', category: 'skill', duration: '45s' },
  { id: 'marathon-pace', title: 'Marathon Pace', tagline: 'Tilt to pace. Stay in the zone.', category: 'skill', duration: '60s' },
  { id: 'hot-potato', title: 'Hot Potato', tagline: 'Tap it away before it burns you.', category: 'skill', duration: '30s' },
  // SPORTS_GAMES
  { id: 'slam-dunk', title: 'Slam Dunk', tagline: 'Two fingers. One moment. Go!', category: 'sports', duration: '45s' },
  { id: 'archery-draw', title: 'Archery Draw', tagline: 'Pull back. Wait. Release.', category: 'sports', duration: '60s' },
  { id: 'hockey-slap', title: 'Hockey Slap', tagline: 'Pick your angle. Fire away.', category: 'sports', duration: '45s' },
  { id: 'javelin-throw', title: 'Javelin Throw', tagline: 'Power up. Release at the peak.', category: 'sports', duration: '45s' },
  { id: 'bowling-curve', title: 'Bowling Curve', tagline: 'Hook it. Hit the pocket.', category: 'sports', duration: '45s' },
  { id: 'swimming-stroke', title: 'Swimming Stroke', tagline: 'Alternate arms. Keep the pace.', category: 'sports', duration: '60s' },
  { id: 'dart-board', title: 'Dart Board', tagline: 'Flick straight. Hit the bull.', category: 'sports', duration: '45s' },
  { id: 'track-sprint', title: 'Track Sprint', tagline: 'Alternate taps. Stay in your lane!', category: 'sports', duration: '30s' },
  { id: 'discus-spin', title: 'Discus Spin', tagline: 'Spin it. Flick it. Fly!', category: 'sports', duration: '45s' },
  { id: 'boxing-combo', title: 'Boxing Combo', tagline: 'Jab. Cross. Hook. Repeat.', category: 'sports', duration: '30s' },
  { id: 'hoop-shot', title: 'Hoop Shot', tagline: 'Swipe to score. 60 seconds on the clock.', category: 'sports', duration: '60s' },
  { id: 'penalty-kick', title: 'Penalty Kick', tagline: 'Beat the keeper. Aim for the corners.', category: 'sports', duration: '60s' },
  { id: 'spiral-throw', title: 'Spiral Throw', tagline: "Lead your receiver. Don't throw behind.", category: 'sports', duration: '60s' },
  { id: 'reflex-rally', title: 'Reflex Rally', tagline: "Return every shot. Don't miss.", category: 'sports', duration: '60s' },
  { id: 'precision-putt', title: 'Precision Putt', tagline: 'Read the green. Control the power.', category: 'sports', duration: '60s' },
  // HOLIDAY_GAMES
  { id: 'gift-rush', title: 'Gift Rush', tagline: "Swipe left or right. Fast. Santa's watching.", category: 'holiday', duration: '45s' },
  { id: 'snow-catch', title: 'Snow Catch', tagline: "Tilt to catch the snow. Miss one and it's over.", category: 'holiday', duration: '45s' },
  { id: 'boo-blast', title: 'Boo Blast', tagline: "Tap the ghosts. They won't wait.", category: 'holiday', duration: '30s' },
  { id: 'cauldron-bubble', title: 'Cauldron Bubble', tagline: 'Blow to bubble. Too quiet = dead. Too loud = BOOM.', category: 'holiday', duration: '45s' },
  { id: 'firework-launch', title: 'Firework Launch', tagline: 'Swipe to launch. Tap to detonate. Make it count.', category: 'holiday', duration: '45s' },
  { id: 'countdown-crush', title: 'Countdown Crush', tagline: 'Score before midnight. Every second counts.', category: 'holiday', duration: '30s' },
  { id: 'cupid-shot', title: 'Cupid Shot', tagline: 'Aim. Wait. Shoot at the perfect moment.', category: 'holiday', duration: '45s' },
  { id: 'love-note', title: 'Love Note', tagline: 'Remember the sequence. Tap it back. From the heart.', category: 'holiday', duration: '60s' },
  { id: 'turkey-trot', title: 'Turkey Trot', tagline: "The turkey's running. Prove you're faster.", category: 'holiday', duration: '30s' },
  { id: 'harvest-catch', title: 'Harvest Catch', tagline: "Tilt to catch the harvest. Skip the Brussels sprouts.", category: 'holiday', duration: '45s' },
  { id: 'shamrock-shuffle', title: 'Shamrock Shuffle', tagline: 'Catch the luck. Dodge the coal.', category: 'holiday', duration: '30s' },
  { id: 'egg-toss', title: 'Egg Toss', tagline: "Toss it. Catch it. Don't crack it!", category: 'holiday', duration: '45s' },
  { id: 'pinata-smash', title: 'Piñata Smash', tagline: 'Find the weak spot. Smash!', category: 'holiday', duration: '30s' },
  { id: 'flower-bouquet', title: 'Flower Bouquet', tagline: 'Catch the petals. Build love.', category: 'holiday', duration: '45s' },
  { id: 'bbq-master', title: 'BBQ Master', tagline: "Flip it right. Don't burn dad's burger.", category: 'holiday', duration: '60s' },
  { id: 'sparkler-draw', title: 'Sparkler Draw', tagline: 'Draw with fire. Make it sparkle.', category: 'holiday', duration: '45s' },
  { id: 'pencil-pack', title: 'Pencil Pack', tagline: 'Sort and pack. School starts now.', category: 'holiday', duration: '30s' },
  { id: 'diya-light', title: 'Diya Light', tagline: 'Light the diyas. In order!', category: 'holiday', duration: '45s' },
  { id: 'dreidel-spin', title: 'Dreidel Spin', tagline: 'Flick it hard. Watch it spin!', category: 'holiday', duration: '30s' },
  { id: 'dragon-parade', title: 'Dragon Parade', tagline: 'Multi-touch the dragon. Make it dance!', category: 'holiday', duration: '60s' },
  { id: 'bead-catch', title: 'Bead Catch', tagline: 'Tilt to catch the beads!', category: 'holiday', duration: '30s' },
  { id: 'lantern-float', title: 'Lantern Float', tagline: 'Blow them up. Watch them rise.', category: 'holiday', duration: '45s' },
  { id: 'taco-toss', title: 'Taco Toss', tagline: 'Catch the fillings. Build the taco.', category: 'holiday', duration: '45s' },
  { id: 'basket-weave', title: 'Basket Weave', tagline: "Over. Under. Don't drop a strand.", category: 'holiday', duration: '60s' },
  { id: 'clover-path', title: 'Clover Path', tagline: "Trace the lucky path. Don't stray!", category: 'holiday', duration: '45s' },
  { id: 'signal-boost', title: 'Signal Boost', tagline: 'Hum steady to keep the tower alive.', category: 'breath', duration: '45s' },
  { id: 'crystal-grow', title: 'Crystal Grow', tagline: 'Breathe steady to grow the crystal.', category: 'breath', duration: '45s' },
  // BREATH_GAMES
  { id: 'echo-clap', title: 'Echo Clap', tagline: 'Clap in time with the echo pattern. It speeds up!', category: 'breath', duration: '45s' },
  { id: 'solar-charge', title: 'Solar Charge', tagline: 'Stay silent to charge the solar panel. Noise drains it!', category: 'breath', duration: '45s' },
  { id: 'aurora-wave', title: 'Aurora Wave', tagline: 'Breathe slowly to paint aurora waves. Erratic = broken!', category: 'breath', duration: '60s' },
  { id: 'dragon-breath', title: 'Dragon Breath', tagline: 'Blow hard. Breathe fire!', category: 'breath', duration: '30s' },
  { id: 'voice-sculpt', title: 'Voice Sculpt', tagline: 'Hum to shape the clay.', category: 'breath', duration: '45s' },
  { id: 'echo-match', title: 'Echo Match', tagline: 'Match the echo. Hold the note.', category: 'breath', duration: '45s' },
  { id: 'howl-wolf', title: 'Howl Wolf', tagline: 'Find your pitch. Call the pack.', category: 'breath', duration: '45s' },
  { id: 'beat-box', title: 'Beat Box', tagline: 'Drop the beat. Keep it going.', category: 'breath', duration: '60s' },
  { id: 'hum-maze', title: 'Hum Maze', tagline: 'Change your pitch. Navigate.', category: 'breath', duration: '60s' },
  { id: 'chant-power', title: 'Chant Power', tagline: 'Hold the chant. Charge the power.', category: 'breath', duration: '45s' },
  { id: 'whistle-launch', title: 'Whistle Launch', tagline: 'Whistle to launch. Pitch to steer.', category: 'breath', duration: '45s' },
  { id: 'vocal-shield', title: 'Vocal Shield', tagline: 'Sing it. Block it. Hold it.', category: 'breath', duration: '30s' },
  { id: 'breath-sculpt', title: 'Breath Sculpt', tagline: 'Breathe to shape. Slow or fast.', category: 'breath', duration: '60s' },
  { id: 'frequency-tune', title: 'Frequency Tune', tagline: 'Find the frequency. Hold it.', category: 'breath', duration: '45s' },
  { id: 'lung-capacity', title: 'Lung Capacity', tagline: 'Take one breath. Hold the note.', category: 'breath', duration: '30s' },
  { id: 'sound-waves', title: 'Sound Waves', tagline: 'Shout the frequency. Shatter walls.', category: 'breath', duration: '45s' },
  { id: 'sing-along', title: 'Sing Along', tagline: 'Match the note. Hold it perfect.', category: 'breath', duration: '45s' },
  { id: 'morse-tap', title: 'Morse Tap', tagline: 'Tap the code. Send the message.', category: 'breath', duration: '45s' },
  { id: 'morse-decode', title: 'Morse Decode', tagline: 'Flash by flash — what is the letter?', category: 'cognitive', duration: '60s' },
  { id: 'code-breaker', title: 'Code Breaker', tagline: 'Memorize. Hide. Enter. Beat the clock.', category: 'cognitive', duration: '60s' },
  // EXTRA_COGNITIVE_GAMES
  { id: 'pulse-jump', title: 'Pulse Jump', tagline: 'Tap in rhythm with the beat. Miss the pulse — fall!', category: 'cognitive', duration: '60s' },
  { id: 'domino-chain', title: 'Domino Chain', tagline: 'Tap the first domino at the perfect moment. Chain falls!', category: 'cognitive', duration: '60s' },
  { id: 'number-crunch', title: 'Number Crunch', tagline: 'Solve the math problem. Tap the right answer — fast!', category: 'cognitive', duration: '60s' },
  { id: 'mirror-mind', title: 'Mirror Mind', tagline: 'Both hands. Mirrored. Synchronized.', category: 'cognitive', duration: '45s' },
  { id: 'number-path', title: 'Number Path', tagline: '1 to N. Fastest finger wins.', category: 'cognitive', duration: '45s' },
  { id: 'logic-gate', title: 'Logic Gate', tagline: 'Wire the circuit. Get the output.', category: 'cognitive', duration: '60s' },
  { id: 'binary-decode', title: 'Binary Decode', tagline: 'Flip the bits. Find the number.', category: 'cognitive', duration: '45s' },
  { id: 'attention-switch', title: 'Attention Switch', tagline: 'Dual task. Both streams. Now!', category: 'cognitive', duration: '45s' },
  { id: 'face-memory', title: 'Face Memory', tagline: 'Remember the faces. Spot them.', category: 'cognitive', duration: '60s' },
  { id: 'inference-trail', title: 'Inference Trail', tagline: 'Follow the clues. Find the answer.', category: 'cognitive', duration: '60s' },
  { id: 'spatial-map', title: 'Spatial Map', tagline: 'Study the map. Answer fast.', category: 'cognitive', duration: '60s' },
  { id: 'neon-chess', title: 'Neon Chess', tagline: 'One move. Best move. Neon style.', category: 'cognitive', duration: '60s' },
  { id: 'shape-rotate', title: 'Shape Rotate', tagline: 'Spin it in your mind. Match it.', category: 'cognitive', duration: '60s' },
  { id: 'type-speed', title: 'Type Speed', tagline: 'Type it fast. Beat the buzzer.', category: 'cognitive', duration: '30s' },
  // EXTRA_SKILL_GAMES
  { id: 'bubble-burst', title: 'Bubble Burst', tagline: 'Pinch at the perfect size!', category: 'skill', duration: '30s' },
  { id: 'tower-stack', title: 'Tower Stack', tagline: "Drop it. Stack it. Don't tip it.", category: 'skill', duration: '60s' },
  { id: 'bounce-pass', title: 'Bounce Pass', tagline: 'Angle the bounce. Make the pass.', category: 'skill', duration: '45s' },
  { id: 'gear-grind', title: 'Gear Grind', tagline: 'Mesh the gears. Keep it spinning.', category: 'skill', duration: '60s' },
  { id: 'thread-needle', title: 'Thread Needle', tagline: 'Steady hands only. Pros need not apply.', category: 'skill', duration: '30s' },
  { id: 'jigsaw-rush', title: 'Jigsaw Rush', tagline: "Snap it. Fast. Clock's ticking.", category: 'skill', duration: '60s' },
  { id: 'cable-wrap', title: 'Cable Wrap', tagline: 'No tangles. No mercy.', category: 'skill', duration: '45s' },
  { id: 'magnet-maze', title: 'Magnet Maze', tagline: 'Attract, repel, navigate.', category: 'skill', duration: '60s' },
  { id: 'cosmic-catch', title: 'Cosmic Catch', tagline: 'Swipe the stars before they fade.', category: 'skill', duration: '30s' },
  { id: 'wormhole-dive', title: 'Wormhole Dive', tagline: 'Survive the warp. Keep diving.', category: 'skill', duration: '60s' },
  { id: 'dream-catch', title: 'Dream Catch', tagline: 'Float through. Catch the fragments.', category: 'skill', duration: '60s' },
  { id: 'sound-garden', title: 'Sound Garden', tagline: 'Touch to grow. Grow to play.', category: 'skill', duration: '60s' },
  // EXTRA_SPORTS_GAMES
  { id: 'curling-sweep', title: 'Curling Sweep', tagline: 'Sweep it in. Sweep it hard.', category: 'sports', duration: '60s' },
  { id: 'rowing-rhythm', title: 'Rowing Rhythm', tagline: 'Sync your strokes. Row!', category: 'sports', duration: '60s' },
  { id: 'baseball-swing', title: 'Baseball Swing', tagline: 'Watch the pitch. Swing!', category: 'sports', duration: '45s' },
  { id: 'karate-chop', title: 'Karate Chop', tagline: 'Chop the right zone. Kata master.', category: 'sports', duration: '30s' },
  { id: 'pole-vault', title: 'Pole Vault', tagline: 'Run. Plant. Fly. Clear it!', category: 'sports', duration: '45s' },
  { id: 'table-tennis', title: 'Table Tennis', tagline: "Return everything. Don't blink.", category: 'sports', duration: '45s' },
  { id: 'gymnast-beam', title: 'Gymnast Beam', tagline: 'Balance. Execute. Stick the landing.', category: 'sports', duration: '60s' },
  { id: 'pixel-skate', title: 'Pixel Skate', tagline: 'Flick tricks. Stack the combo.', category: 'sports', duration: '45s' },
  { id: 'surf-ride', title: 'Surf Ride', tagline: 'Tilt to balance. Swipe for tricks.', category: 'sports', duration: '60s' },
  { id: 'ski-slalom', title: 'Ski Slalom', tagline: 'Weave through the gates. Go fast.', category: 'sports', duration: '45s' },
  // NEW_GAMES
  { id: 'mirror-dance', title: 'Mirror Dance', tagline: 'Match the mirror. Move with the beat.', category: 'cognitive', duration: '60s' },
  { id: 'sand-pour', title: 'Sand Pour', tagline: "Fill the glass. Don't spill.", category: 'skill', duration: '60s' },
  { id: 'color-blend', title: 'Color Blend', tagline: 'Swipe to blend. Hit the target hue.', category: 'cognitive', duration: '60s' },
  { id: 'echo-tap', title: 'Echo Tap', tagline: 'Listen. Repeat the pattern.', category: 'cognitive', duration: '60s' },
  { id: 'heat-map', title: 'Heat Map', tagline: 'Where do you look first?', category: 'cognitive', duration: '60s' },
  { id: 'trust-fall', title: 'Trust Fall', tagline: 'Let go at the right moment.', category: 'cognitive', duration: '60s' },
  { id: 'spark-chain', title: 'Spark Chain', tagline: 'One spark. Maximum spread.', category: 'skill', duration: '60s' },
  { id: 'crowd-pulse', title: 'Crowd Pulse', tagline: 'Feel the room.', category: 'skill', duration: '60s' },
];

function callAnthropic(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message));
          else resolve(parsed.content[0].text);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function buildBatchPrompt(games) {
  const gameList = games.map(g =>
    `- id: "${g.id}" | title: "${g.title}" | tagline: "${g.tagline}" | category: ${g.category} | duration: ${g.duration}`
  ).join('\n');

  return `You are writing gameplay instructions for mobile micro-games in the Glimmer platform. Each game is 30-60 seconds.

For each game below, generate a JSON object. Be accurate — infer the mechanic from the title, tagline, and category. Keep it concise and fun.

Games:
${gameList}

Return ONLY a valid JSON array (no markdown, no extra text):
[
  {
    "id": "game-id",
    "howToPlay": "2-3 sentences. What does the player do? Controls (tap, swipe, tilt, hold, blow/hum for breath games)? Win condition?",
    "controls": "One line, e.g. 'Tap anywhere to jump. Swipe left/right to dodge.'",
    "goal": "One line, e.g. 'Survive as long as possible.' or 'Score as high as you can before time runs out.'"
  }
]

Rules:
- breath/vocal games: microphone or breath mechanics (blow, hum, shout, whistle, sing)
- skill games: touch/swipe/tilt mechanics
- cognitive games: memory, pattern, speed-thinking
- sports games: simulate sports actions with gestures
- holiday games: festive theme with simple gesture mechanics
- Keep howToPlay under 60 words
- Keep controls under 20 words
- Keep goal under 15 words`;
}

async function main() {
  console.log(`Generating instructions for ${ALL_GAMES.length} games...`);
  
  const BATCH_SIZE = 20;
  const results = {};
  
  for (let i = 0; i < ALL_GAMES.length; i += BATCH_SIZE) {
    const batch = ALL_GAMES.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(ALL_GAMES.length / BATCH_SIZE);
    console.log(`Batch ${batchNum}/${totalBatches}: processing ${batch.length} games (${batch.map(g => g.id).join(', ')})...`);
    
    let attempt = 0;
    let success = false;
    
    while (attempt < 3 && !success) {
      try {
        const prompt = buildBatchPrompt(batch);
        const response = await callAnthropic(prompt);
        
        // Parse JSON from response
        const parsed = JSON.parse(response.trim());
        
        for (const item of parsed) {
          results[item.id] = {
            howToPlay: item.howToPlay,
            controls: item.controls,
            goal: item.goal,
          };
        }
        
        console.log(`  ✓ Batch ${batchNum} done (${parsed.length} games)`);
        success = true;
      } catch (err) {
        attempt++;
        console.error(`  ✗ Batch ${batchNum} attempt ${attempt} failed: ${err.message}`);
        if (attempt < 3) {
          const wait = attempt * 2000;
          console.log(`  Retrying in ${wait}ms...`);
          await new Promise(r => setTimeout(r, wait));
        }
      }
    }
    
    if (!success) {
      console.error(`  FATAL: Batch ${batchNum} failed after 3 attempts`);
      process.exit(1);
    }
    
    // Small delay between batches to be respectful
    if (i + BATCH_SIZE < ALL_GAMES.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  // Generate TypeScript file
  const lines = [
    '// Auto-generated by scripts/gen-instructions.js',
    '// Do not edit manually — regenerate with: node scripts/gen-instructions.js',
    '',
    "export const GAME_INSTRUCTIONS: Record<string, { howToPlay: string; controls: string; goal: string }> = {",
  ];
  
  for (const [id, data] of Object.entries(results)) {
    lines.push(`  '${id}': {`);
    lines.push(`    howToPlay: ${JSON.stringify(data.howToPlay)},`);
    lines.push(`    controls: ${JSON.stringify(data.controls)},`);
    lines.push(`    goal: ${JSON.stringify(data.goal)},`);
    lines.push(`  },`);
  }
  
  lines.push('};');
  
  const outputPath = path.join(__dirname, '..', 'lib', 'gameInstructions.ts');
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
  
  console.log(`\n✓ Generated ${Object.keys(results).length} game instructions`);
  console.log(`✓ Written to: ${outputPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
