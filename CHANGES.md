# Porchbook changes

A plain-English list of everything changed while improving the look and ease of use.
Each entry says what changed, why, and whether any rule in `public/porchbook-state.md` was changed (and that it was approved first).

## Setup (no app changes)

- Installed the app's building blocks (`npm install`) so it runs on a Windows computer.
- Added a small start-up file *outside* the app folder (`../.claude/launch.json`) so Claude can start the app on http://localhost:8080.
- Created a local-only test account. Its details are in `../TEST-ACCOUNT.md`. On this computer the app keeps its data in memory, so the account (and any posts) disappear whenever the app is restarted and must be created again.
- Started a git history (on this computer only, nothing uploaded). The first save, "Undo point: Porchbook as received", is the app exactly as it arrived, so anything can be put back.

## App changes

### 1. The start command now works on Windows
- **What:** `scripts/with-app-env.mjs` (the script behind `npm run dev`) now starts tools like `vite` through the Windows command shell. Nothing changes on Linux, Mac or the live site.
- **Why:** on Windows, `npm run dev` stopped straight away with "spawn vite ENOENT".
- **Rules changed:** none.
- **Checked:** `npm run dev` starts the app on http://localhost:8080. The script's own tests give the same result as before the change (3 tests fail both before and after, because they expect Grok's Linux sandbox).

## Approved for the redesign stage (not done yet)

These were approved by the owner on 2026-11-18 but will be done later, during the redesign.
Both go against `public/porchbook-state.md`, so that file must be updated when they are made.

- **Post cards: room, team and time on one line** under the name, instead of each on its own line. Rulebook section "Home" currently says they are "on their own lines".
- **Posting box opens when tapped:** it shows as one "Share something…" line until tapped. Rulebook section "Posting panel" currently says "The composer is open at the top of the feed".

## Left alone on purpose

- **The calls script line** (`porchbook-calls.js`) is described in the rulebook but is not in the code. The owner will raise this with the creator. Not added.
- **The PorchGuy button** in the header stays as it is for now.
