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
  { id: 'tilt-maze',       title: 'Tilt Maze',       tagline: 'Roll the ball with your body',                href: '/games/tilt-maze',       accentColor: '#a855f7', duration: '60s', icon: 'explore',             category: 'skill',     industries: ['technology', 'retail', 'automotive']    },
  { id: 'whisper-bomb',    title: 'Whisper Bomb',    tagline: 'Stay silent. Defuse the bomb.',               href: '/games/whisper-bomb',    accentColor: '#ef4444', duration: '30s', icon: 'bomb',                category: 'breath',    industries: ['cpg', 'food_bev', 'technology']          },
  { id: 'breath-rider',    title: 'Breath Rider',    tagline: 'Fly with your breath',                        href: '/games/breath-rider',    accentColor: '#3b82f6', duration: '45s', icon: 'air',                 category: 'breath',    industries: ['healthcare', 'technology', 'retail']     },
  { id: 'steady-hand',     title: 'Steady Hand',     tagline: 'Hold perfectly still. We dare you.',         href: '/games/steady-hand',     accentColor: '#22c55e', duration: '30s', icon: 'ads_click',           category: 'skill',     industries: ['healthcare', 'technology', 'automotive'] },
  { id: 'tunnel',          title: 'Infinite Tunnel', tagline: "Dodge the rings. Don't crash.",               href: '/games/tunnel',          accentColor: '#00ffff', duration: '60s', icon: 'bolt',                category: 'skill',     industries: ['technology', 'automotive', 'retail']     },
  { id: 'pulse-sphere',    title: 'Pulse Sphere',    tagline: 'Touch. Move. Breathe. Watch it respond.',     href: '/games/pulse-sphere',    accentColor: '#a855f7', duration: '60s', icon: 'pulmonology',         category: 'breath',    industries: ['healthcare', 'technology', 'cpg']        },
  { id: 'shadow-tap',      title: 'Shadow Tap',      tagline: "Tap what you see. Before it's gone.",         href: '/games/shadow-tap',      accentColor: '#64748b', duration: '45s', icon: 'dark_mode',           category: 'cognitive', industries: ['technology', 'retail', 'cpg']            },
  { id: 'color-cascade',   title: 'Color Cascade',   tagline: 'Match the color. Match the speed.',           href: '/games/color-cascade',   accentColor: '#f43f5e', duration: '45s', icon: 'palette',             category: 'cognitive', industries: ['cpg', 'food_bev', 'retail']              },
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
