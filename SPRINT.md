# Overnight Sprint — AAA Polish 2026-03-18

## Mission
Ship AAA-quality polish across all 33 Glimmers games by 10am EST 2026-03-19.
Justin reviews at 10am. No new spend. No security issues. Every commit to `staging` branch.

## Staging
- Branch: `staging`
- Vercel preview: https://mini-games-intoether-ethertc.vercel.app
- ClickUp list: 901614090394 (Overnight Sprint — AAA Polish 2026-03-18)

## Rules
1. NEVER hardcode API keys or secrets. Use env vars only.
2. Always `git pull --rebase origin staging` before every push
3. Always `npm run build` locally before committing — no broken builds
4. No paid services, no new npm packages without checking package.json first
5. Use Tone.js (already installed) for sound — no new audio libraries
6. Use Web Vibration API for haptics — no third-party haptics SDKs
7. Commit often with clear messages: `feat(game-name): description`

## Stack
- Next.js 15, TypeScript, Tailwind CSS
- Tone.js (audio), Web Vibration API (haptics)
- Web Audio API available as fallback
- Three.js, Framer Motion, canvas-confetti

## ClickUp Integration
- API key: pk_26240221_VMLZQXF2CKTB8LUGR0TJ0P2H0UYVJ4M5
- Team ID: 14172346
- List ID: 901614090394
- Statuses: TO DO → IN PROGRESS → IN REVIEW → DONE

## Agent File Ownership (avoid conflicts)
- **gameplay-a**: app/games/{tilt-maze,whisper-bomb,breath-rider,steady-hand,tunnel,pulse-sphere,orbit-control,dodge-blitz,balance-beam,pitch-match,crowd-roar}/
- **gameplay-b**: app/games/{hoop-shot,penalty-kick,spiral-throw,reflex-rally,precision-putt,color-cascade,memory-grid,reaction-chain,shadow-tap,stack-drop,symbol-scan}/
- **gameplay-c**: app/games/{path-trace,gift-rush,snow-catch,boo-blast,cauldron-bubble,firework-launch,countdown-crush,cupid-shot,love-note,turkey-trot,harvest-catch}/
- **sound**: lib/audio.ts (improvements only — no breaking changes to exports)
- **haptics**: lib/haptics.ts (new file), components/HapticsProvider.tsx (new)
- **creative-director**: GAME_DESIGN_RULES.md, lib/theme.ts, components/ui/
- **rubrics**: QA_AGENT_PROMPT.md, tests/, docs/

## AAA Polish Standards
- Smooth animations: easing curves, not linear
- Satisfying feedback: score pop, combo streaks, near-miss reactions
- Sound: layered, punchy, with pitch variation — not flat beeps
- Haptics: meaningful patterns — score ≠ fail ≠ progress
- Visual juice: particle bursts on milestone scores, screen shake on impact
- Accessibility: all interactive elements have aria-labels
- Performance: no frame drops on mid-range mobile
