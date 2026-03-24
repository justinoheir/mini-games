# Glimmers Agent Workflow

**MANDATORY — all agents working on Glimmers must read and follow this.**

---

## Rule #1: QA Runs After Every Update

**Any time you modify games — environments, logic, UI, audio, haptics, anything — you MUST run QA before announcing completion.**

---

## QA Intel: Supabase (LIVE DATA — do not use JSON files)

**As of 2026-03-23, QA results are stored in Supabase, NOT in JSON files.**

### Writing QA results

After running the QA suite, upsert results into the `glimmer_qa_results` table:

```
POST https://ccioqoakdexiblnjrbhs.supabase.co/rest/v1/glimmer_qa_results
Headers:
  apikey: <SUPABASE_SERVICE_KEY from TOOLS.md>
  Authorization: Bearer <SUPABASE_SERVICE_KEY from TOOLS.md>
  Content-Type: application/json
  Prefer: resolution=merge-duplicates
```

Map QAResult fields to snake_case columns (camelCase → snake_case).
Use `game_id` as the upsert key (UNIQUE constraint).

### ⛔ DEPRECATED: JSON file approach

Writing to `tests/results/*.json` is **deprecated**. Do NOT use `lib/qaResults.ts` or the gen-qa-index script.
The `/qa` portal reads from Supabase (`glimmer_qa_results`) and revalidates every 60 seconds.

### QA intel table schema

| Column | Type | Notes |
|--------|------|-------|
| game_id | text UNIQUE | e.g. "balance-beam" |
| game_name | text | e.g. "Balance Beam" |
| verdict | text | SHIP / FIX_REQUIRED / BLOCKED / NOT_RUN |
| weighted_score | numeric | 0-100 |
| dimensions | jsonb | visualQuality, audioSync, gameFeel, etc. |
| performance | jsonb | fpsMedian, heapMB, etc. |
| accessibility | jsonb | axe results, motor/vision/cognitive checks |
| personas | jsonb | array of persona scores |
| bugs | jsonb | array of bugs |
| qa_date | text | YYYY-MM-DD |
| qa_agent | text | agent label |

---

## How to trigger QA

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

_Last updated: 2026-03-24 — QA intel migrated to Supabase (glimmer_qa_results table); JSON file approach deprecated_
