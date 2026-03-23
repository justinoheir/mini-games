# Glimmers Agent Workflow

**MANDATORY — all agents working on Glimmers must read and follow this.**

---

## Rule #1: QA Runs After Every Update

**Any time you modify games — environments, logic, UI, audio, haptics, anything — you MUST run QA before announcing completion.**

### How to trigger QA

After your changes are committed and deployed, run the Playwright suite:

```bash
cd C:\Users\justi\.openclaw\workspace\mini-games
npm run dev &         # start dev server on port 3000
npx playwright test --reporter=html,json
```

Save the QA report to:
- `C:\Users\justi\.openclaw\workspace\glimmers-qa-report.md`
- `C:\Users\justi\Documents\Justin's Brain\02 - Ether\Glimmers\QA Reports\YYYY-MM-DD.md`

### QA report format

```
# Glimmers QA Report
Date: YYYY-MM-DD
Total games: 28
Passed: X | Failed: Y | Warnings: Z

## Results by Game
| Game | Background | State Machine | Timer | Score | Game Over | Mobile | A11y | Status |
|------|-----------|---------------|-------|-------|-----------|--------|------|--------|

## Failures & Issues
[game, what failed, screenshot if available]

## Recommendations
[prioritized fixes]
```

### If you can't run Playwright

Do a code audit instead — check each game for:
- Background prop applied
- State machine: START_SCREEN → COUNTDOWN → PLAYING → GAME_OVER
- Timer counts down from N to 0
- Score starts at 0
- Play-again resets state fully

---

## Rule #2: Per-game spec must exist

Every game must have a `tests/<game-name>.spec.ts`. If you add a new game and its spec doesn't exist, create it using `tests/qa-template.spec.ts` as the base.

---

## Rule #3: Announce format

When announcing completion, include a QA summary table in your message. Do NOT mark work as done without QA results.

Example announcement:
```
✅ Environments updated. QA results:
Passed: 26/28 | Failed: 2
Issues: breath-rider (audio not triggering), shadow-tap (game over not resetting)
Full report: glimmers-qa-report.md
```

---

## Rule #4: Never skip QA "to save time"

Justin explicitly requires QA after every update. It is not optional.

---

## Game List (28 total)

Sports: hoop-shot, penalty-kick, spiral-throw, precision-putt, reflex-rally
Cognitive: memory-grid, color-cascade, reaction-chain, symbol-scan, shadow-tap, countdown-crush
Motion/Sensor: tilt-maze, steady-hand, tunnel, dodge-blitz, balance-beam
Breath/Mic: whisper-bomb, breath-rider, pulse-sphere, crowd-roar, pitch-match
Holiday: boo-blast, cauldron-bubble, firework-launch, gift-rush, snow-catch, cupid-shot, love-note, turkey-trot, harvest-catch
Path/Skill: path-trace, stack-drop

---

_Last updated: 2026-03-23 — QA-after-every-update rule added by Justin_
