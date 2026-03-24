// ─── Types ────────────────────────────────────────────────────────────────────

export type GameCategory = 'skill' | 'sports' | 'holiday' | 'cognitive' | 'breath';

export type Industry = 'cpg' | 'technology' | 'healthcare' | 'finance' | 'food_bev' | 'sports' | 'retail' | 'automotive';

export interface Game {
  id: string;
  title: string;
  tagline: string;
  href: string;
  accentColor: string;
  duration: string;
  icon: string; // Material Symbol name
  category: GameCategory;
  industries: Industry[];
}

// ─── Game Data ────────────────────────────────────────────────────────────────

export const SKILL_GAMES: Game[] = [
  { id: 'wire-cross',      title: 'Wire Cross',       tagline: "Thread the ring. Don't touch the wire.",      href: '/games/wire-cross',      accentColor: '#00e5ff', duration: '45s', icon: 'electric_bolt',       category: 'skill',     industries: ['technology', 'automotive', 'healthcare'] },
  { id: 'balloon-pop',     title: 'Balloon Pop',      tagline: 'Pinch to pop before they overflow!',          href: '/games/balloon-pop',     accentColor: '#f43f5e', duration: '30s', icon: 'expand',              category: 'skill',     industries: ['cpg', 'retail', 'food_bev']              },
  { id: 'slingshot-smash', title: 'Slingshot Smash',  tagline: 'Stretch it. Aim it. Smash it.',               href: '/games/slingshot-smash', accentColor: '#f97316', duration: '45s', icon: 'sports_handball',     category: 'skill',     industries: ['sports', 'cpg', 'retail']                },
  { id: 'ripple-tap',      title: 'Ripple Tap',       tagline: 'Tap the peak. Not too early, not late.',      href: '/games/ripple-tap',      accentColor: '#06b6d4', duration: '30s', icon: 'waves',               category: 'skill',     industries: ['technology', 'healthcare', 'finance']    },
  { id: 'pendulum-swing',  title: 'Pendulum Swing',   tagline: "Keep the rhythm. Don't let it stop.",         href: '/games/pendulum-swing',  accentColor: '#a855f7', duration: '60s', icon: 'pending',             category: 'skill',     industries: ['technology', 'finance', 'automotive']    },
  { id: 'node-connect',    title: 'Node Connect',     tagline: 'Link the dots. Cross nothing.',               href: '/games/node-connect',    accentColor: '#10b981', duration: '45s', icon: 'account_tree',        category: 'skill',     industries: ['technology', 'finance', 'healthcare']    },
  { id: 'orbit-launch',    title: 'Orbit Launch',     tagline: 'Nail the angle. Own the orbit.',              href: '/games/orbit-launch',    accentColor: '#6366f1', duration: '45s', icon: 'rocket_launch',       category: 'skill',     industries: ['technology', 'automotive', 'finance']    },
  { id: 'speed-sort',      title: 'Speed Sort',       tagline: 'Left or right. Think fast.',                  href: '/games/speed-sort',      accentColor: '#facc15', duration: '30s', icon: 'sort',                category: 'skill',     industries: ['retail', 'finance', 'cpg']               },
  { id: 'spring-leap',     title: 'Spring Leap',      tagline: 'Hold to charge. Release to fly.',             href: '/games/spring-leap',     accentColor: '#4ade80', duration: '45s', icon: 'compress',            category: 'skill',     industries: ['sports', 'retail', 'technology']         },
  { id: 'crystal-catch',   title: 'Crystal Catch',    tagline: "Tilt and collect. Don't shatter them.",       href: '/games/crystal-catch',   accentColor: '#818cf8', duration: '45s', icon: 'diamond',             category: 'skill',     industries: ['retail', 'cpg', 'finance']               },
  { id: 'wobble-stack',    title: 'Wobble Stack',     tagline: 'Keep it balanced. It gets worse.',            href: '/games/wobble-stack',    accentColor: '#fb923c', duration: '60s', icon: 'layers',              category: 'skill',     industries: ['cpg', 'retail', 'food_bev']              },
  { id: 'chain-reaction',  title: 'Chain Reaction',   tagline: 'One tap. Maximum chaos.',                     href: '/games/chain-reaction',  accentColor: '#fb7185', duration: '30s', icon: 'auto_awesome',        category: 'skill',     industries: ['technology', 'cpg', 'sports']            },
  { id: 'pixel-paint',     title: 'Pixel Paint',      tagline: 'Speed-paint the pattern. Go!',                href: '/games/pixel-paint',     accentColor: '#f472b6', duration: '30s', icon: 'brush',               category: 'skill',     industries: ['retail', 'technology', 'cpg']            },
  { id: 'drop-zone',       title: 'Drop Zone',        tagline: 'Release at the right moment.',                href: '/games/drop-zone',       accentColor: '#22d3ee', duration: '45s', icon: 'arrow_downward',      category: 'skill',     industries: ['retail', 'cpg', 'food_bev']              },
  { id: 'laser-guide',     title: 'Laser Guide',      tagline: 'Reflect the beam. Hit the target.',           href: '/games/laser-guide',     accentColor: '#dc2626', duration: '45s', icon: 'flashlight_on',       category: 'skill',     industries: ['technology', 'finance', 'automotive']    },
  { id: 'friction-slide',  title: 'Friction Slide',   tagline: 'Flick with precision. Stop on target.',       href: '/games/friction-slide',  accentColor: '#0ea5e9', duration: '45s', icon: 'drag_pan',            category: 'skill',     industries: ['sports', 'retail', 'cpg']                },
  { id: 'gravity-well',    title: 'Gravity Well',     tagline: "Orbit the well. Don't get pulled in.",        href: '/games/gravity-well',    accentColor: '#7c3aed', duration: '60s', icon: 'lens',                category: 'skill',     industries: ['technology', 'finance', 'automotive']    },
  { id: 'tilt-maze',       title: 'Tilt Maze',       tagline: 'Roll the ball with your body',                href: '/games/tilt-maze',       accentColor: '#a855f7', duration: '60s', icon: 'explore',             category: 'skill',     industries: ['technology', 'retail', 'automotive']    },
  { id: 'whisper-bomb',    title: 'Whisper Bomb',    tagline: 'Stay silent. Defuse the bomb.',               href: '/games/whisper-bomb',    accentColor: '#ef4444', duration: '30s', icon: 'bomb',                category: 'breath',    industries: ['cpg', 'food_bev', 'technology']          },
  { id: 'breath-rider',    title: 'Breath Rider',    tagline: 'Fly with your breath',                        href: '/games/breath-rider',    accentColor: '#3b82f6', duration: '45s', icon: 'air',                 category: 'breath',    industries: ['healthcare', 'technology', 'retail']     },
  { id: 'steady-hand',     title: 'Steady Hand',     tagline: 'Hold perfectly still. We dare you.',         href: '/games/steady-hand',     accentColor: '#22c55e', duration: '30s', icon: 'ads_click',           category: 'skill',     industries: ['healthcare', 'technology', 'automotive'] },
  { id: 'tunnel',          title: 'Infinite Tunnel', tagline: "Dodge the rings. Don't crash.",               href: '/games/tunnel',          accentColor: '#00ffff', duration: '60s', icon: 'bolt',                category: 'skill',     industries: ['technology', 'automotive', 'retail']     },
  { id: 'pulse-sphere',    title: 'Pulse Sphere',    tagline: 'Touch. Move. Breathe. Watch it respond.',     href: '/games/pulse-sphere',    accentColor: '#a855f7', duration: '60s', icon: 'pulmonology',         category: 'breath',    industries: ['healthcare', 'technology', 'cpg']        },
  { id: 'shadow-tap',      title: 'Shadow Tap',      tagline: "Tap what you see. Before it's gone.",         href: '/games/shadow-tap',      accentColor: '#64748b', duration: '45s', icon: 'dark_mode',           category: 'cognitive', industries: ['technology', 'retail', 'cpg']            },
  { id: 'color-cascade',   title: 'Color Cascade',   tagline: 'Match the color. Match the speed.',           href: '/games/color-cascade',   accentColor: '#f43f5e', duration: '45s', icon: 'palette',             category: 'cognitive', industries: ['cpg', 'food_bev', 'retail']              },
  { id: 'equation-tap',    title: 'Equation Tap',     tagline: 'Solve it. Tap it. Beat the clock.',           href: '/games/equation-tap',    accentColor: '#facc15', duration: '45s', icon: 'calculate',           category: 'cognitive', industries: ['finance','technology','healthcare']    },
  { id: 'color-word',      title: 'Color Word',       tagline: 'Ignore the meaning. Trust your eyes.',        href: '/games/color-word',      accentColor: '#f43f5e', duration: '30s', icon: 'text_fields',         category: 'cognitive', industries: ['cpg','retail','technology']            },
  { id: 'visual-search',   title: 'Visual Search',    tagline: 'Find it. Tap it. Before the horde.',          href: '/games/visual-search',   accentColor: '#10b981', duration: '45s', icon: 'search',              category: 'cognitive', industries: ['retail','cpg','technology']            },
  { id: 'odd-one-out',     title: 'Odd One Out',      tagline: "Spot what doesn't belong. Quick!",            href: '/games/odd-one-out',     accentColor: '#f97316', duration: '45s', icon: 'find_in_page',        category: 'cognitive', industries: ['retail','cpg','technology']            },
  { id: 'pattern-predict', title: 'Pattern Predict',  tagline: 'What comes next? You tell me.',               href: '/games/pattern-predict', accentColor: '#14b8a6', duration: '45s', icon: 'trending_up',         category: 'cognitive', industries: ['finance','technology','cpg']           },
  { id: 'reflex-grid',     title: 'Reflex Grid',      tagline: 'Tap the flash. Never miss twice.',            href: '/games/reflex-grid',     accentColor: '#ef4444', duration: '30s', icon: 'grid_on',             category: 'cognitive', industries: ['sports','technology','cpg']            },
  { id: 'sequence-unlock', title: 'Sequence Unlock',  tagline: 'Watch the lights. Repeat them.',              href: '/games/sequence-unlock', accentColor: '#a855f7', duration: '60s', icon: 'pattern',             category: 'cognitive', industries: ['technology','finance','healthcare']    },
  { id: 'word-flash',      title: 'Word Flash',       tagline: 'Read it. Remember it. Recall it.',            href: '/games/word-flash',      accentColor: '#ec4899', duration: '60s', icon: 'flash_on',            category: 'cognitive', industries: ['retail','cpg','healthcare']            },
  { id: 'rhythm-repeat',   title: 'Rhythm Repeat',    tagline: 'Hear the beat. Play it back.',                href: '/games/rhythm-repeat',   accentColor: '#f59e0b', duration: '60s', icon: 'music_note',          category: 'cognitive', industries: ['cpg','retail','food_bev']              },
  { id: 'category-clash',  title: 'Category Clash',   tagline: 'Sort it fast. Categories clash!',             href: '/games/category-clash',  accentColor: '#fb923c', duration: '30s', icon: 'category',            category: 'cognitive', industries: ['retail','cpg','food_bev']              },
  { id: 'memory-grid',     title: 'Memory Grid',     tagline: 'Remember the pattern. Repeat it.',            href: '/games/memory-grid',     accentColor: '#8b5cf6', duration: '60s', icon: 'grid_view',           category: 'cognitive', industries: ['finance', 'technology', 'healthcare']    },
  { id: 'reaction-chain',  title: 'Reaction Chain',  tagline: 'Tap fast. Keep the chain alive.',              href: '/games/reaction-chain',  accentColor: '#facc15', duration: '45s', icon: 'link',                category: 'cognitive', industries: ['technology', 'sports', 'cpg']            },
  { id: 'stack-drop',      title: 'Stack Drop',      tagline: "Drop it. Stack it. Don't tip it.",             href: '/games/stack-drop',      accentColor: '#f97316', duration: '60s', icon: 'layers',              category: 'skill',     industries: ['cpg', 'retail', 'food_bev']              },
  { id: 'dodge-blitz',     title: 'Dodge Blitz',     tagline: "Tilt to survive. Don't stop moving.",         href: '/games/dodge-blitz',     accentColor: '#06b6d4', duration: '45s', icon: 'swap_horiz',          category: 'skill',     industries: ['technology', 'sports', 'automotive']     },
  { id: 'crowd-roar',      title: 'Crowd Roar',      tagline: "Roar loud. Hold it. Don't fade.",              href: '/games/crowd-roar',      accentColor: '#ef4444', duration: '45s', icon: 'radio',               category: 'breath',    industries: ['sports', 'cpg', 'food_bev']              },
  { id: 'balance-beam',    title: 'Balance Beam',    tagline: 'Keep the ball on the beam. Stay still.',       href: '/games/balance-beam',    accentColor: '#f59e0b', duration: '60s', icon: 'balance',             category: 'skill',     industries: ['sports', 'healthcare', 'technology']     },
  { id: 'path-trace',      title: 'Path Trace',      tagline: "Follow the line. Don't stray.",                href: '/games/path-trace',      accentColor: '#e879f9', duration: '45s', icon: 'edit',                category: 'skill',     industries: ['technology', 'automotive', 'finance']    },
  { id: 'pitch-match',     title: 'Pitch Match',     tagline: 'Hit the note. Hold it. Feel it.',               href: '/games/pitch-match',     accentColor: '#34d399', duration: '45s', icon: 'music_note',          category: 'breath',    industries: ['cpg', 'food_bev', 'retail']              },
  { id: 'symbol-scan',     title: 'Symbol Scan',     tagline: 'Find it. Tap it. Before the clock runs out.',  href: '/games/symbol-scan',     accentColor: '#10b981', duration: '60s', icon: 'manage_search',       category: 'cognitive', industries: ['finance', 'technology', 'healthcare']    },
];

export const SPORTS_GAMES: Game[] = [
  { id: 'slam-dunk',       title: 'Slam Dunk',        tagline: 'Two fingers. One moment. Go!',                href: '/games/slam-dunk',       accentColor: '#f97316', duration: '45s', icon: 'sports_basketball', category: 'sports', industries: ['sports', 'cpg', 'retail']           },
  { id: 'archery-draw',    title: 'Archery Draw',     tagline: 'Pull back. Wait. Release.',                   href: '/games/archery-draw',    accentColor: '#16a34a', duration: '60s', icon: 'target',            category: 'sports', industries: ['sports', 'cpg', 'retail']           },
  { id: 'hockey-slap',     title: 'Hockey Slap',      tagline: 'Pick your angle. Fire away.',                 href: '/games/hockey-slap',     accentColor: '#3b82f6', duration: '45s', icon: 'sports_hockey',     category: 'sports', industries: ['sports', 'cpg', 'food_bev']         },
  { id: 'javelin-throw',   title: 'Javelin Throw',    tagline: 'Power up. Release at the peak.',              href: '/games/javelin-throw',   accentColor: '#eab308', duration: '45s', icon: 'sports_track_and_field', category: 'sports', industries: ['sports', 'healthcare', 'technology'] },
  { id: 'bowling-curve',   title: 'Bowling Curve',    tagline: 'Hook it. Hit the pocket.',                    href: '/games/bowling-curve',   accentColor: '#7c3aed', duration: '45s', icon: 'sports_bowling',    category: 'sports', industries: ['sports', 'cpg', 'food_bev']         },
  { id: 'swimming-stroke', title: 'Swimming Stroke',  tagline: 'Alternate arms. Keep the pace.',              href: '/games/swimming-stroke', accentColor: '#0ea5e9', duration: '60s', icon: 'pool',              category: 'sports', industries: ['sports', 'healthcare', 'technology']  },
  { id: 'dart-board',      title: 'Dart Board',       tagline: 'Flick straight. Hit the bull.',               href: '/games/dart-board',      accentColor: '#dc2626', duration: '45s', icon: 'adjust',            category: 'sports', industries: ['sports', 'food_bev', 'retail']       },
  { id: 'track-sprint',    title: 'Track Sprint',     tagline: 'Alternate taps. Stay in your lane!',          href: '/games/track-sprint',    accentColor: '#f59e0b', duration: '30s', icon: 'directions_run',    category: 'sports', industries: ['sports', 'healthcare', 'retail']     },
  { id: 'discus-spin',     title: 'Discus Spin',      tagline: 'Spin it. Flick it. Fly!',                     href: '/games/discus-spin',     accentColor: '#10b981', duration: '45s', icon: 'rotate_right',      category: 'sports', industries: ['sports', 'cpg', 'technology']        },
  { id: 'boxing-combo',    title: 'Boxing Combo',     tagline: 'Jab. Cross. Hook. Repeat.',                   href: '/games/boxing-combo',    accentColor: '#ef4444', duration: '30s', icon: 'sports_mma',        category: 'sports', industries: ['sports', 'healthcare', 'cpg']        },
  { id: 'hoop-shot',      title: 'Hoop Shot',      tagline: 'Swipe to score. 60 seconds on the clock.',    href: '/games/hoop-shot',      accentColor: '#f97316', duration: '60s', icon: 'sports_basketball', category: 'sports', industries: ['sports', 'cpg', 'food_bev']           },
  { id: 'penalty-kick',   title: 'Penalty Kick',   tagline: 'Beat the keeper. Aim for the corners.',        href: '/games/penalty-kick',   accentColor: '#22c55e', duration: '60s', icon: 'sports_soccer',     category: 'sports', industries: ['sports', 'cpg', 'food_bev']           },
  { id: 'spiral-throw',   title: 'Spiral Throw',   tagline: "Lead your receiver. Don't throw behind.",      href: '/games/spiral-throw',   accentColor: '#f59e0b', duration: '60s', icon: 'sports_football',   category: 'sports', industries: ['sports', 'cpg', 'retail']             },
  { id: 'reflex-rally',   title: 'Reflex Rally',   tagline: "Return every shot. Don't miss.",               href: '/games/reflex-rally',   accentColor: '#84cc16', duration: '60s', icon: 'sports_tennis',     category: 'sports', industries: ['sports', 'technology', 'healthcare']  },
  { id: 'precision-putt', title: 'Precision Putt', tagline: 'Read the green. Control the power.',           href: '/games/precision-putt', accentColor: '#86efac', duration: '60s', icon: 'sports_golf',       category: 'sports', industries: ['sports', 'finance', 'retail']         },
];

export const HOLIDAY_GAMES: Game[] = [
  { id: 'gift-rush',        title: 'Gift Rush',        tagline: "Swipe left or right. Fast. Santa's watching.", href: '/games/gift-rush',        accentColor: '#ef4444', duration: '45s', icon: 'redeem',         category: 'holiday', industries: ['retail', 'cpg', 'food_bev']           },
  { id: 'snow-catch',       title: 'Snow Catch',       tagline: "Tilt to catch the snow. Miss one and it's over.", href: '/games/snow-catch',    accentColor: '#93c5fd', duration: '45s', icon: 'ac_unit',        category: 'holiday', industries: ['retail', 'cpg', 'food_bev']           },
  { id: 'boo-blast',        title: 'Boo Blast',        tagline: "Tap the ghosts. They won't wait.",              href: '/games/boo-blast',        accentColor: '#a855f7', duration: '30s', icon: 'ghost',          category: 'holiday', industries: ['cpg', 'food_bev', 'retail']           },
  { id: 'cauldron-bubble',  title: 'Cauldron Bubble',  tagline: 'Blow to bubble. Too quiet = dead. Too loud = BOOM.', href: '/games/cauldron-bubble', accentColor: '#22c55e', duration: '45s', icon: 'science',   category: 'holiday', industries: ['food_bev', 'cpg', 'retail']           },
  { id: 'firework-launch',  title: 'Firework Launch',  tagline: 'Swipe to launch. Tap to detonate. Make it count.', href: '/games/firework-launch', accentColor: '#f59e0b', duration: '45s', icon: 'celebration',  category: 'holiday', industries: ['sports', 'cpg', 'retail']             },
  { id: 'countdown-crush',  title: 'Countdown Crush',  tagline: 'Score before midnight. Every second counts.',   href: '/games/countdown-crush',  accentColor: '#fbbf24', duration: '30s', icon: 'timer',         category: 'holiday', industries: ['finance', 'technology', 'retail']     },
  { id: 'cupid-shot',       title: 'Cupid Shot',       tagline: 'Aim. Wait. Shoot at the perfect moment.',       href: '/games/cupid-shot',       accentColor: '#f43f5e', duration: '45s', icon: 'favorite',      category: 'holiday', industries: ['retail', 'cpg', 'food_bev']           },
  { id: 'love-note',        title: 'Love Note',        tagline: 'Remember the sequence. Tap it back. From the heart.', href: '/games/love-note', accentColor: '#ec4899', duration: '60s', icon: 'mail',           category: 'holiday', industries: ['retail', 'healthcare', 'cpg']         },
  { id: 'turkey-trot',      title: 'Turkey Trot',      tagline: "The turkey's running. Prove you're faster.",    href: '/games/turkey-trot',      accentColor: '#f97316', duration: '30s', icon: 'directions_run', category: 'holiday', industries: ['food_bev', 'cpg', 'retail']           },
  { id: 'harvest-catch',    title: 'Harvest Catch',    tagline: "Tilt to catch the harvest. Skip the Brussels sprouts.", href: '/games/harvest-catch', accentColor: '#d97706', duration: '45s', icon: 'agriculture', category: 'holiday', industries: ['food_bev', 'cpg', 'retail']           },
];

export const ALL_GAMES: Game[] = [...SKILL_GAMES, ...SPORTS_GAMES, ...HOLIDAY_GAMES];

export const FEATURED_GAMES: Game[] = [
  SKILL_GAMES[0],
  SKILL_GAMES[1],
  SKILL_GAMES[4],
  SKILL_GAMES[9],
  HOLIDAY_GAMES[2],
  HOLIDAY_GAMES[4],
];

const NEW_ARRIVAL_IDS = ['harvest-catch', 'love-note', 'countdown-crush', 'cauldron-bubble', 'snow-catch'];
export const NEW_ARRIVALS: Game[] = NEW_ARRIVAL_IDS
  .map(id => ALL_GAMES.find(g => g.id === id))
  .filter((g): g is Game => g !== undefined);

// ─── Category config ──────────────────────────────────────────────────────────

export const CATEGORY_META: Record<GameCategory, { label: string }> = {
  skill:     { label: 'SKILL'   },
  sports:    { label: 'SPORTS'  },
  holiday:   { label: 'HOLIDAY' },
  cognitive: { label: 'BRAIN'   },
  breath:    { label: 'BREATH'  },
};

// ─── Industry config ──────────────────────────────────────────────────────────

export const INDUSTRIES: { id: Industry; label: string; icon: string }[] = [
  { id: 'cpg',        label: 'CPG',        icon: '🏪' },
  { id: 'food_bev',   label: 'Food & Bev', icon: '🍺' },
  { id: 'sports',     label: 'Sports',     icon: '🏆' },
  { id: 'technology', label: 'Technology', icon: '💻' },
  { id: 'healthcare', label: 'Healthcare', icon: '❤️' },
  { id: 'finance',    label: 'Finance',    icon: '📊' },
  { id: 'retail',     label: 'Retail',     icon: '🛍️' },
  { id: 'automotive', label: 'Automotive', icon: '🚗' },
];
