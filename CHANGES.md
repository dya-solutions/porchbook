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

### 4. Stage 3a (19 Nov 2026): church tags on the feed, chat, people, "on the porch now" and calls
- **MSG and AMPC Bibles hidden for everyone** (decision 5). They could only appear as uploaded "demo Bibles", which used to be founder-only and are now platform-owner-only, and in a "Read in…" link list that isn't used anywhere. Both now leave them out, and opening one is refused. Switch: `permissionBibles` in `src/lib/porch/on-hold.ts`. The files in `bibles-private/` were not used by the app and are untouched.
- **How the church tag works.** Each post, reply, reaction, conversation, message, group and group-chat note now carries the church porch it belongs to.
  - The **database stamps it automatically** whenever one is saved, so no saving path can forget it.
  - Everything that already existed was tagged as Phaneroo's.
  - Shared database checks ("my porch", "same porch", "post in my porch", "reply in my porch") are used by the app code. They live in `src/lib/porch/porch-foundation.ts`.
- **Feed** (`api.ts`, `api/porch-posts.ts`):
  - Only your own church porch's posts show, including pinned posts, "my posts", single posts opened from the bell, a person's page, and the posts list the Android app reads.
  - Reacting, replying, keeping and reacting to replies are **refused** for posts outside your porch.
  - A question can only be addressed to someone in your porch.
- **Chat** (`api.ts`, `chat.ts`):
  - Your chat list and unread count only include conversations in your porch.
  - Opening a conversation with, or messaging, someone in another porch is **refused** ("You can only message people in your porch.").
  - Reacting to, starring, pinning, editing or deleting a message outside your porch is refused.
  - "Message everyone" reaches only your own porch.
- **Group chats** (`groups.ts`):
  - Groups belong to their leader's porch. Lists, browsing, opening, writing, joining, following, adding people, leaders and group accounts all stay inside your porch.
  - The database also refuses to put anyone into a group from another porch.
- **People and profiles** (`api.ts`, `roll.ts`): the people list, a person's page, the people count and the admin's roll only show your own porch.
- **On the porch now** (`presence.ts`): only people in your own porch.
- **One-to-one calls** (`groups.ts`, `call-ask.ts`, `line-ring.ts`):
  - Starting a call, ringing, asking to call and ringing someone's phone are **refused** across porches ("You can only call people in your porch.").
  - The rest of the calling code is unchanged.
  - The hidden "open porch call" (one call shared by everyone, on hold) is now also refused by the server, not just hidden.
- **The two-church test** now checks all of the above: **46 passed, 0 failed, 0 not private yet.** For each area, Ben in Porch B is refused (not just hidden from) when he tries to open, react to, reply to, keep, message, join or call anything in Porch A, and nothing of his reaches Porch A. Matching checks prove that Abe, in the same porch as Ann, can still do all of these.
- **Why:** BUILD-BRIEF.md Stage 3 (first half, as JT asked).
- **Rules changed:** none on screen.
- **Checked:**
  - Type check passes.
  - Style check: no new problems. The one error it reports is in old code and was there before.
  - Your existing post still shows in Phaneroo's feed, and the test account is still admin.
  - "After" pictures are in `../after-stage3a/` and were compared with `../after-stage2/` (see the comparison page).

### 5. Stage 3b (19 Nov 2026): church tags on everything else
- **New rule (decision 8).** Any on-hold feature must get church tags and pass the two-church test before it is switched back on. This is in BUILD-BRIEF.md and next to every switch in `src/lib/porch/on-hold.ts`.
- **Four reusable database helpers** (`porch-foundation.ts`):
  - **Stamp from a person:** rows take the church of the person who saved them.
  - **Stamp from a parent:** rows take their parent's church, e.g. a hotel takes its event's.
  - **One per church:** "only one for the whole app" settings become "one per church". Saving one without naming the church fails loudly instead of quietly writing over Phaneroo's.
  - **Must name its church:** for rows with no person to take it from, such as events.

  Everything that already existed became Phaneroo's.
- **Offices** (`offices.ts`, `office-book.ts`, `hoo-reports.ts`, `api/office-pdf.ts`):
  - Each church has its own set of offices. All start with Phaneroo's 8 names; each church will name its own in Stage 4.
  - Each church has its own heads, office conversations, closed doors, calendar, office books, files, PDFs and H.O.O reports, report pages and Family writer.
  - The pickers for an office head or report writer only list the church's own members.
  - Two old database links that assumed one set of offices were removed.
- **Tour doors:**
  - **Events** (`events.ts`): events, hotels, rooms, answers, travel, the guest board and the guest list.
  - **Serve** (`serve.ts`): the volunteer download.
  - **Transport** (`transport.ts`, `transport-board.ts`): each church has its own current transport event (Phaneroo keeps "31st Night of Prayer"), stage names, transport team, buses, stops and rides. Stage news only reaches that church's riders.
  - **My 20** (`my20.ts`, `mission-sms.ts`): the admin's "everyone's lists" download and, importantly, **"delete everyone's lists", which used to wipe every church's lists**. The Missions text messages only use the church's own My 20 numbers.
  - **Pray:** prayer music.
  - **Feedback** (`trouble.ts`): the complaints list and answering them.
- **Read** (`read.ts`, `bible-sites.ts`, `devotion-runyankore.ts`, `api/read-pdf.ts`):
  - Each church has its own shelf: books, PDFs, its own Bible and Devotional entries, and Bible reading sites.
  - Typed-in or approved Runyankore and Luganda devotional copies are per church, so another church's admin can never overwrite Phaneroo's.
  - The devotional itself still comes from phaneroo.org for everyone. It becomes a church setting in Stage 4.
  - Personal notebooks stay with the person, as decided.
- **Notifications** (`notes.ts`, `push.server.ts`):
  - The bell shows only the church's own notes.
  - "Message everyone" alerts reach only the sender's church (the messages already did since Stage 3a). It used to alert every phone on Porchbook.
- **Wording, sounds and settings** (16 files): these are now one per church, so one church can never overwrite another's:
  - Edit words
  - button sounds, message sound
  - book covers and their butterflies
  - item sizes
  - the manual card and bell switches
  - porch photo, header photo, hide, door, wall, carpet, ceiling, cloth, shelf picture
  - Rhemaclip, the "previously" clip (its uploaded video is now one file per church; Phaneroo keeps its existing file), prayer music

  An admin removing someone's photo now only works within their own church.
- **On hold, so not separated (decision 8):** the radio, nuggets, PorchGuy, Clinic, devotional voice and machine translation. Their few spots that would otherwise break or reach another church now read Phaneroo's only, with a note.
- **The two-church test** now covers every area above. **112 passed, 0 failed, 0 "not private yet".**
  - For each area, Ben (Porch B) is refused or sees nothing of Porch A.
  - Matching checks prove Abe can still do it all inside Porch A.
  - A separate block proves that Porch B's admin changing words, sounds and settings (words, message and button sounds, porch photo, covers, item sizes, manual card, Rhemaclip, prayer music, Bible sites) does **not** change Porch A's.
- **Why:** BUILD-BRIEF.md Stage 3, second half.
- **Rules changed:** none on screen.
- **Checked:**
  - Type check passes.
  - After a restart, the test account's real data still works: admin tools, posts, shelf, 8 offices, events, words, transport event, bell and covers. No database errors at start-up.
  - "After" pictures are in `../after-stage3b/` and were compared with `../after-stage3a/` (see the comparison page).

### 6. Stage 4a (19 Nov 2026): themes, the new bars, My porch and Who is on the porch
- **Six themes, one set of colours** (`src/lib/porch/themes.ts`, `src/pb.css`).
  - The six themes from BUILD-BRIEF.md are one table. Every new screen reads its colours from it, and the shades in between (borders, raised surfaces, the bottom bar) are mixed from those colours.
  - Each porch's theme is saved in its porch settings. Phaneroo uses **Porch Evening**.
  - A porch admin can change the theme. The settings screen with the theme picker comes in Stage 4c.
  - The phone remembers the last theme, so the right colours show before anything loads.
- **Dawn / Dusk / Night is a gentle dimmer on every theme** (decision 4). The dimmer now stops at 40% (it used to reach 90%, nearly black), and it covers the whole screen, bars included. A "Light: Dawn / Dusk / Night" row, as in the Tour design, sits on the Tour page for phones and computers. It replaces the old ☀ in the old bottom bar.
- **The old porch photograph and textures are hidden** (decision 2). Every page has the plain theme background. The admin's photo and texture settings are hidden behind a new switch, `oldLooks` in `on-hold.ts`, together with the old Themes menu (decision 3).
- **New top bar** (Porch.dc.html):
  - the porch's initials and name, and which screen you're on;
  - the bell, with the design's outline bell;
  - your own picture, which **opens your profile**.

  The old header (Home/Tour/Read switch, Lite key, account menu) is gone.
- **New bottom bar:** Porch, Tour, Offices, Read, Chat, with the unread count on Chat. Offices opens the existing offices page for now.
- **Nothing from the old menus was lost.** Your own profile now has a **"Your account"** card with:
  - Who is on the porch
  - Alerts
  - Invite someone
  - Feedback
  - Refresh Porchbook
  - Keep Porchbook running (in the Android app)
  - Admin tools (for admins)
  - Sign out
  - How you appear (online, do not disturb, hidden)
  - Porchbook Lite

  "Something new on Porchbook · tap Refresh" now shows just above the bottom bar.
- **My porch** (`routes/index.tsx`, `feed-view.tsx`):
  - The "My porch / Public porch" switch. The Public porch shows "coming soon" until Stage 6.
  - The **"on the porch now"** strip: faces, how many are here, and Visible or Hidden. It opens Who is on the porch.
  - **"Share with your porch…"**, which opens the post box when tapped (approved earlier). The post box keeps everything: rooms, Photo, Rhemaclip, Ask someone, Post.
  - Room chips: All, Inspire, Inform, Inquire, plus Mine.
  - Post cards as in the design: face, name, room and time on one line, the text, and the Love / Like / Touching / Deep pills with counts. Reply, Lock, Pin, Edit, Remove, call and message are all still there.
  - The old slides inside the post box are gone. Radio is on hold; the devotional, Chat and Write are one tap away in the bottom bar and the post box.
- **Who is on the porch** (new page `/presence`, Presence.dc.html): the "Show me on the porch" switch and the list, with message and call buttons. The old rule stays: while you're hidden, you don't see who else is here.
- **"Founder" becomes "admin"** in 102 on-screen wordings across 53 files, e.g. "Only an admin can…". Code names were not changed.
- **Also:**
  - "Property of …" under the older screens now names the viewer's own porch.
  - The old "the first account becomes founder" note in the code now reads "admin".
- **Rules changed (BUILD-BRIEF.md wins over porchbook-state.md):**
  - The porch photograph, glass posts on the photo, the 3D Home/Tour/Read switch and the old header are replaced by the design.
  - The bottom bar is now Porch, Tour, Offices, Read, Chat. It used to be Feed, Chat, Invite, Refresh.
  - The dark letter edges and the leaf-green post box are replaced by the theme colours.
  - The two items approved on 18 Nov are done (see below).
- **Not yet in the new look:** Tour, Offices, Read, Chat, profiles and the older pages keep their old look inside the new bars until Stages 4b and 4c. On Morning Light (the light theme), those older pages still look dark for now.
- **Checked:**
  - Type check passes.
  - Two-church test: 112 passed, 0 failed, 0 not private yet.
  - Design vs app comparison and theme pictures are in `../compare-design.html` (Porch Evening, Morning Light, Royal Night). Phaneroo was set back to Porch Evening afterwards.
  - "After" pictures are in `../after-stage4a/`.
- **Fixed during this stage:** a crash ("Rendered more hooks…") I had caused in the frame while sign-in finishes. It was caught by the theme pictures and fixed before saving.
- **Known, not new:** a "hydration" warning in the browser log. The server draws an empty placeholder before it knows who you are, and the browser redraws. This was already there; the page works. It can be tidied later.

## Approved for the redesign stage

These were approved by the owner on 2026-11-18. Both went against `public/porchbook-state.md` (BUILD-BRIEF.md now wins).

- ✅ **Done in Stage 4a:** post cards have room, team and time on one line under the name.
- ✅ **Done in Stage 4a:** the posting box is one "Share with your porch…" line until tapped.

## Left alone on purpose

- **The calls script line** (`porchbook-calls.js`) is described in the rulebook but is not in the code. The owner will raise this with the creator. Not added.
- **The PorchGuy button** in the header was left alone on 18 Nov. Since 19 Nov it is hidden, because the PorchGuy is on hold (BUILD-BRIEF.md).
