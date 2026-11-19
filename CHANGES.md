# Porchbook changes

A plain-English list of everything changed, to go through with the creator.
Each entry says what changed, why, and which rules changed. Since 19 November 2026 the agreed direction is **BUILD-BRIEF.md**, which wins over `public/porchbook-state.md` (the creator's original rulebook) and over `PLAN-MULTI-CHURCH.md`.

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

### 2. Stage 1 (19 Nov 2026): plan rewritten, on-hold features hidden
- **What:**
  - **PLAN-MULTI-CHURCH.md** was rewritten to match BUILD-BRIEF.md: porch types, public porch, branches, offices with actions and request status, one-to-one calls only, 6 themes and the 8 stages. It also says what is done and what isn't, and lists open questions.
  - The features on hold in BUILD-BRIEF.md section 4 are **hidden, not deleted**. One new file, `src/lib/porch/on-hold.ts`, holds an on/off switch for each. Changing `true` to `false` there brings a feature back.
- **What disappeared from the screens:**
  - **Radio:** the Radio door on the tour, the "Enjoy Porchbook Radio" slide in the post box, the radio card on computers, the on-air bar, radio news and the nugget link. The radio can no longer be switched on from anywhere, and the control room page sends people to the porch.
  - **PorchGuy:** the PorchGuy button in the header. His page sends people to the porch. "Videos on the porch guy's screen" is hidden in Events, and the Events intro no longer mentions him.
  - **PorchWay** (the driving game, `/city`) sends people to the porch.
  - **Group calls:** the Call door on the tour. One-to-one calls, started from a person, are untouched.
  - **Clinic:** the Clinic door. **Feedback** is back on the tour in its place.
  - **Devotional voice:** the "Listen" button on the devotional, and the founder's AI-credit warning strip.
  - **Machine translation (Sunbird):** the devotional no longer asks Sunbird. Phaneroo's own Runyankore and Luganda copies still show, and so does a copy typed in by the founder.
- **What stays for now:** the Offices door stays on the tour until Offices gets its own tab (Stage 4), so members can still reach their offices.
- **Why:** BUILD-BRIEF.md section 4 (on hold, and anything that costs money to run).
- **Rules changed:** porchbook-state.md lists a Radio-free tour with a Feedback door; that is now true again. It also describes the PorchGuy header button and radio in the composer slides, which are now hidden. BUILD-BRIEF.md (approved by JT) wins.
- **Files changed:** `on-hold.ts` (new), `frame.tsx`, `pc-side.tsx`, `post-slides.tsx`, `events-home.tsx`, `next.tsx` (tour), `read.tsx`, `tour-mode.ts`, `fm-player.ts`, `devotion-runyankore.ts`, and the `porchguy`, `city` and `control-room` pages.
- **Checked:**
  - The type check passes.
  - The style checker shows no errors; all its warnings were there before.
  - "After" pictures are in `../after/` to compare with `../before/`.
  - The two-church test doesn't exist yet. It's built in Stage 2.

### 3. Stage 2 (19 Nov 2026): the foundation
- **Decisions recorded.** JT's answers of 19 November are now section 8 of BUILD-BRIEF.md ("Decisions, 19 November") and are in PLAN-MULTI-CHURCH.md.
- **The local database keeps its data.** Before, everything lived in memory and disappeared whenever the app restarted. Now it is saved in a folder called `.local-db` inside the app folder, on this computer only and never saved in git. Delete that folder to start again with an empty database. (`src/lib/db.ts`)
- **Porches exist.** New tables, created when the app starts:
  - `porches`, with the four types: church, ministry, gospel artist, organisation;
  - `porch_settings` (theme, time zone, country code);
  - `porch_admins`;
  - `platform_owners`;
  - a "which church" column on each person's profile.

  **Phaneroo Ministries Mbarara is porch 1** (a church, approved and verified), and every existing account is put in it. Until invite codes arrive in Stage 5, new accounts also join Phaneroo. (`src/lib/porch/porch-foundation.ts`)
- **Porch admins and a platform owner replace the single founder.**
  - The 67 places that asked "is this person the founder?" now ask "is this person an admin of the church porch they belong to?" Two of them (radio storage keys and shared Bible versions) ask "is this person the platform owner?" instead.
  - Being admin of a porch you don't belong to gives no powers, and the platform owner is not automatically a porch admin.
  - Today's founder became Phaneroo's first admin, once.
  - The words on screen still say "founder" in a few places; they change with the new design in Stage 4.
- **"The first account ever becomes founder" is removed.** Signing up first no longer gives anyone power.
- **Who is admin and owner on this computer:** a small file, `porch-local.json` (this computer only, never in git), lists the emails of platform owners and Phaneroo admins. It currently names the test account for both. Put your own email there to make yourself platform owner.
- **The two-church test** (`scripts/two-church-test.mjs`) starts its own separate copy of the app on port 8090 with a throw-away database, so your data is never touched. It checks the foundation and tries to see, open and message across two porches.
  - Result now: **14 passed, 0 failed, 5 "not private yet"** (feed, people and chat). Those 5 are the leaks Stage 3 closes, one area at a time; they also prove the test really catches leaks.
  - It uses a helper (`src/routes/api/porch-test.ts`) that only works inside the test's own copy. In the normal app it answers "not found".
  - The test copy gets its own Vite cache folder (`vite.config.ts`).
- **Why:** BUILD-BRIEF.md Stage 2.
- **Rules changed:** none on screen. Behind the scenes, the founder rule is replaced as the brief says.
- **Checked:**
  - The type check and style check pass.
  - The two-church test passes for this stage.
  - The test account signs in after a restart without signing up again, and is still Phaneroo's admin.
  - "After" pictures are in `../after-stage2/` and were compared with `../after-stage1/` and `../before/` (see the comparison pages).
- **Not done on purpose:** hiding the MSG and AMPC Bibles is the first item of Stage 3, and hiding the old photo settings is part of Stage 4.

## Approved for the redesign stage (not done yet)

These were approved by the owner on 2026-11-18 but will be done later, during the redesign.
Both go against `public/porchbook-state.md`, so that file must be updated when they are made.

- **Post cards: room, team and time on one line** under the name, instead of each on its own line. Rulebook section "Home" currently says they are "on their own lines".
- **Posting box opens when tapped:** it shows as one "Share something…" line until tapped. Rulebook section "Posting panel" currently says "The composer is open at the top of the feed".

## Left alone on purpose

- **The calls script line** (`porchbook-calls.js`) is described in the rulebook but is not in the code. The owner will raise this with the creator. Not added.
- **The PorchGuy button** in the header was left alone on 18 Nov. Since 19 Nov it is hidden, because the PorchGuy is on hold (BUILD-BRIEF.md).
