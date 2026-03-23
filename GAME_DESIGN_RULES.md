# Game Design Rules — Glimmers
**Version:** 1.0 | **Updated:** 2026-03-18

These are the canonical rules all Glimmers games must follow. Agents building games must read this first. QA agents enforce this at review time.

---

## Core Philosophy

**Every game must feel alive.** Tap → instant feedback. Score up → visual pop. Combo → escalating joy. Game over → satisfying, not abrupt. The physics, audio, and haptics should feel connected — like a single cohesive experience, not independent features bolted on.

---

## 1. Game Structure

Every game follows this exact state machine:

```
START_SCREEN → COUNTDOWN (3…2…1…GO) → PLAYING → GAME_OVER → (play-again) → COUNTDOWN
```

**Rules:**
- Start screen: player name input + CTA button. No gameplay until tapped.
- Countdown: `3 → 2 → 1 → GO` with 1s between each. Use Framer Motion scale animations.
- Playing: timer visible top-right or top-center. Score visible top-left or center.
- Game over: show score, personal best (if beaten), personality label, play-again button.
- Play-again: full state reset. Timer back to max. Score back to 0. No ghost elements.

---

## 2. Timer Rules

- Default game duration: **30 seconds** (can be 45s or 60s for complex games)
- Timer counts DOWN from N to 0
- Timer updates every second via `setInterval`
- Timer pulses or turns red in final **5 seconds**
- Game MUST end when timer hits 0 — not 0.5s late, not never
- Timer display: large text, always visible, never covered by game elements

---

## 3. Score Rules

- Score starts at **0** when game begins
- Score updates **immediately** on qualifying event (no debounce on score itself)
- Score display: prominent size (≥32px on mobile), always visible
- Score pop animation on increment: scale 1.0 → 1.3 → 1.0, duration 200ms, ease-out
- Combo system: 3+ consecutive successes = combo streak with multiplier display
- Personal best (PB): stored in `localStorage` as `mg_scores[gameId]`
- PB beat detection: compare end score to stored PB, show celebration if higher
- PB storage: update `mg_scores[gameId]` when game ends if score > current PB

---

## 4. Animation Rules

- **Never use linear easing** for player-visible animations. Use `ease-out`, `ease-in-out`, or spring physics.
- Score pop: `scale(1.3)` then back, 200ms ease-out
- Countdown: scale in from 2x, fade out — Framer Motion `AnimatePresence`
- Game over transition: slide up or fade in, 300ms ease-out — NOT an instant state swap
- Combo text: scale in from 0, bounce spring
- Near-miss: 4px screen shake, 150ms, ease-out
- Milestone particles (every 10 points): `canvas-confetti` burst or Three.js particle emitter
- All Framer Motion components use `key` prop for `AnimatePresence` to work correctly

---

## 5. Audio Rules

All audio must use **Tone.js** (already in package.json). No raw `new Audio()` for game sounds.

**Required sounds per game:**
| Event | Sound Type | Duration |
|-------|-----------|----------|
| Score point | Synth click, pitch varies with score | <100ms |
| Combo streak | Arpeggio or stacked tones | <300ms |
| Fail/miss | Lower pitch "bwonk" or dissonance | <200ms |
| Game over | Sustained tone, pitch drop | 500–800ms |
| Personal best | Fanfare or ascending arpeggio | 500–1000ms |
| Countdown beep | Clean click per count | <100ms |

**Audio rules:**
- Pitch variation: score events should shift pitch up as score increases (e.g., 220Hz + score × 2Hz)
- AudioContext must be created on first user gesture (tap/click) — not on page load
- AudioContext must be suspended/closed when game is not in PLAYING state
- No audio on rapid repeated events (debounce 50ms between same-type sounds)
- Volume: master gain ≤ 0.7 to avoid clipping

---

## 6. Haptics Rules

All haptics use the **Web Vibration API** (`navigator.vibrate()`). No third-party libs.

**Required patterns:**
```typescript
// In lib/haptics.ts — use these exact pattern exports
HAPTIC_SCORE     = [30]              // short tap — point scored
HAPTIC_COMBO     = [30, 20, 30, 20, 60]  // escalating — combo streak
HAPTIC_FAIL      = [20, 30, 20]     // double buzz — miss/failure
HAPTIC_GAME_OVER = [100]            // long pulse — game over
HAPTIC_PERSONAL_BEST = [50, 30, 50, 30, 100]  // celebration
```

**Haptic rules:**
- Only fire haptics on **discrete game events** (not every frame)
- Always check `navigator.vibrate !== undefined` before calling
- Never fire haptics more than once per 100ms (debounce)
- Different events MUST use different patterns (player learns through feel)
- No vibration on back button, settings, or passive UI — only game events

---

## 7. Accessibility Rules

Every game must meet WCAG 2.1 AA minimum.

- All buttons: `aria-label` attribute (not just visible text)
- All inputs: `<label>` element or `aria-label`
- Touch targets: minimum **44×44px** (both CTA and back button)
- Color contrast: ≥4.5:1 for normal text, ≥3:1 for large text
- Score display: `aria-live="polite"` so screen readers announce score changes
- Never communicate game state through color alone — use text or icon too
- `canvas` elements: add `role="img"` and `aria-label` describing the game

---

## 8. Mobile Layout Rules

- Design for **375px wide** (iPhone SE) as the minimum
- All content fits in viewport — no horizontal scroll
- No fixed elements that overlap game content
- Back button: fixed top-left, always accessible, never covered
- End screen: must fit on 375×667px without scrolling
- Game canvas: fills remaining screen height below HUD, never overflow
- Font sizes: score ≥32px, timer ≥24px, labels ≥14px

---

## 9. Performance Rules

- Target: **60fps** on mid-range mobile (Pixel 5, iPhone 11 equivalent)
- No `setTimeout`/`setInterval` in animation loops — use `requestAnimationFrame`
- Canvas games: clear only dirty regions when possible
- Remove event listeners in `useEffect` cleanup functions
- Cancel `requestAnimationFrame` loops on component unmount
- Lazy-load Three.js if used (not needed in every game)
- No large assets (images > 200KB) without compression
- AudioContext: one shared context per game, not new on every sound

---

## 10. QA / Testing Rules

⚠️ **MANDATORY: QA must run after every update to any game. See GLIMMERS_WORKFLOW.md.**

*(Enforced by QA agent — do not modify without coordination)*

- Every game must have a corresponding `tests/<game-name>.spec.ts`
- Tests must pass: page load, countdown, playing phase, game over, play-again, mobile viewport, accessibility
- Score at 0 on start is a required assertion
- Timer decreasing is a required assertion
- axe-core scan on start screen is required
- FPS must be ≥55 during gameplay
- Memory must stay below 150MB
- Test file must use the `GamePage` page object from `tests/pages/GamePage.ts`

### Game-specific test requirements:
- **Motion games:** include `mockAccelerometer` setup
- **Mic/breath games:** include `mockMicrophone` setup with 'silent' and 'loud' patterns
- **Haptic assertions:** `getVibrateLog()` must return > 0 entries after scoring events
- **Audio assertions:** `window.__audioEventLog` must contain score/gameover events

---

## 11. Code Quality Rules

- TypeScript strict mode: no `any` unless absolutely necessary
- No hardcoded secrets or API keys — env vars only
- No `console.log` left in production code (use `console.warn`/`console.error` for real errors)
- Components: functional only, no class components
- State: `useState` and `useReducer` only — no external state libraries
- Game loop: `useRef` for mutable values in animation loops (not `useState`)
- `useEffect` cleanup: always return cleanup function for timers, RAF loops, event listeners

---

## Game Categories

| Category | Games |
|----------|-------|
| Sports | hoop-shot, penalty-kick, spiral-throw, precision-putt, reflex-rally |
| Cognitive | memory-grid, color-cascade, reaction-chain, symbol-scan, shadow-tap, countdown-crush |
| Motion/Sensor | tilt-maze, steady-hand, tunnel, dodge-blitz, balance-beam, orbit-control |
| Breath/Mic | whisper-bomb, breath-rider, pulse-sphere, crowd-roar, pitch-match |
| Holiday | boo-blast, cauldron-bubble, firework-launch, gift-rush, snow-catch, cupid-shot, love-note, turkey-trot, harvest-catch |
| Path/Skill | path-trace, stack-drop |
