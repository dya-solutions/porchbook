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

### 7. Stage 4b (20 Nov 2026): Stage 9 written down, three fixes, the Tour and the Offices

**Part 1: Stage 9 (Porch stations) is now in BUILD-BRIEF.md and PLAN-MULTI-CHURCH.md.** Text only, nothing built: 9a a free playlist station on R2, 9b paid live broadcasting with a monthly allowance, and the rules.

**Part 2: three fixes**
- **"User's complaints" and "Edit words" are gone from "On the porch now"** (`trouble.tsx`). Admins open both from **Your account** on their own profile.
- **Post cards: "Reply" stays visible; Pin, Edit, Lock replies and Remove are in a "⋯" menu** on your own posts (`feed-view.tsx`). Remove still asks once more ("Delete for good").
- **New members are asked once, the first time they arrive: "Let the porch see you're here?"** (`porch-online.tsx`).
  - It is asked per person, not per phone, until they answer.
  - "Not now" is saved as their choice to stay hidden, so being hidden is always their own choice.
  - They can change it any time in Your account → How you appear.

**Part 3: Stage 4b**
- **Offices is its own tab** (Offices.dc.html, `office-screens.tsx`): each office has an icon, its name and a short description.
  - Phaneroo keeps its 8 offices, their names and heads. Their short descriptions come from the design.
  - The old "Prayer Requests" office from the first database setup had been merged into the Pastor's "Thank God with me" long ago and was only hidden. It is now marked removed. Nothing was deleted.
- **Each church makes its own offices.** On the Offices tab an admin taps **Manage offices** to:
  - create an office (name, short description, head, and what it offers);
  - change an office (rename it, change its description, head or what it offers);
  - remove an office. Members stop seeing it; its old messages are kept in the database.

  Only church porches have offices (decision 1). A new church starts with **no** offices: Phaneroo's are not copied in.
- **What an office can offer** (an admin ticks these for each office):
  - Thank God with me
  - Contact the office ("Contact the pastor" for a pastor's office)
  - Book an appointment
  - Weekly programme
  - Accountability (office holders only)
  - Official (from the head to office holders)

  Phaneroo's Office of the Pastor keeps all six. Phaneroo's other offices offer "Contact the office". Their old single conversation moved into it, nothing lost.
- **One office's page** (Office.dc.html): its icon and name, who heads it, its actions as a list, and **"Your requests"**.
  - **For the head:** a box to post an office announcement.
  - **For admins:** the head picker.
  - **For the head and admins:** the office's books and files as before.
- **Request status: Sent, Confirmed, Answered.**
  - **Sent:** when you write.
  - **Confirmed:** when the office marks it. The head has a "Mark confirmed" button.
  - **Answered:** when the office replies, or the head marks it.
  - **For "Thank God with me":** a reply means Confirmed. The person who asked taps **"God answered"**.

  You see the status on the office page and at the top of the conversation. The head sees it on each conversation and can filter by it.
- **The conversation** (OfficeThread.dc.html): theme colours, your messages on the right, the office's on the left with "time · name, office", and "Write to the office…" at the bottom. The old green photo behind it is gone. The rule stays: one message, then wait for the office to reply.
- **Weekly programme:** the office's head can now write it in the app.
  - Everyone in the church reads it.
  - Phaneroo's Office of the Pastor shows its usual week until the pastor writes a new one.
  - Before, that week (with Phaneroo's phone number) was built into the app.
- **Office announcements:** the head of an office posts a short announcement from the office's page. It shows **pinned at the top of My porch**: "From the Office of the Pastor · Pinned".
  - A new announcement replaces that office's last one.
  - The head or an admin can remove it.
  - Up to three offices' announcements show at a time.
- **Official messages** now come from whichever office the writer heads that offers "Official". At Phaneroo that is the Office of the Pastor, as before.
- **Tour in the new design** (Tour.dc.html, `tour-door.tsx`): "Tour · Everything your church offers, in one place."
  - The doors are cards with an icon, a name and one line: Pray, My 20 (with your count), Events, Groups, Serve, Transport, and Feedback across the bottom.
  - The stitched leather panel is gone.
  - Each door works exactly as before. When one is open, the doors shrink to a strip above it, as before.
  - Offices left the Tour because it has its own tab now.
  - The Pray door's line says what it does today: "Let the porch know you're praying". The design's "Send a prayer request" is in the Office of the Pastor → Thank God with me.
- **Rules changed (BUILD-BRIEF.md wins over porchbook-state.md):**
  - Offices are no longer the same fixed list for everyone.
  - The Tour no longer has an Offices door.
  - The Pastor's weekly programme is no longer fixed in the app.
- **Still Phaneroo-shaped (noted for later):**
  - The H.O.O reports board and the Missions text messages only appear in offices whose short names are "hoo" and "missions".
  - The office books' starting shelves are Phaneroo's.

  Other churches' offices simply don't have these extras.
- **Checked:**
  - Type check passes.
  - **Two-church test: 139 passed, 0 failed, 0 not private yet** (it was 112). New checks:
    - Phaneroo keeps its 8 offices and the Pastor's six actions.
    - A new church starts with no offices, and a member can't create one.
    - **Offices created by Porch B don't appear in Porch A** (in Ann's list or Abe's list). Abe can't open or write to them. Ann can't rename or remove them.
    - Renaming or removing in B leaves A alone.
    - Request status goes Sent → Confirmed → Answered. Ben can't mark Porch A's requests.
    - Announcements: only the head can post. A's announcement isn't seen in B or Phaneroo, and B's isn't seen in A. Ben can't remove A's. A new one replaces the last.
  - Design vs app: `../compare-design.html` now also has Office and OfficeThread, and Tour and the Office of the Pastor in each theme (Porch Evening, Morning Light, Royal Night). Phaneroo was set back to Porch Evening afterwards.
  - "After" pictures: `../after-stage4b/`.
- **Not yet in the new look:** Read, Chat, profiles and the older pages (Stage 4c). What opens inside a Tour door (Events, Groups, Serve, Transport, My 20) keeps its old look until then.

### 8. Stage 4c (20 Nov 2026): Chat, conversations, Read, profiles and Porch settings
- **Chat** (Chat.dc.html, `chat-screens.tsx`): "Chat", a **New message** button, "Search your porch", and **All / People / Groups / Offices**.
  - **One list** for the people you message, your groups, and your **office conversations, marked "Office"**. Each office conversation also shows its status (Sent / Confirmed / Answered).
  - A **green dot** shows who is on the porch now. The old rule stays: while you're hidden, you don't see others.
  - Unread messages show a count. My Space (notes only you can read) is at the top.
  - **New message** shows everyone on your porch to pick from.
  - **For an office's head:** the people who wrote to that office appear in the head's Chat too.
  - Groups open their group page, as before. Groups have no messages inside yet.
- **A conversation** (Conversation.dc.html):
  - **Header:** the person's face with the online dot, "On the porch now" in green when they are, and the voice and video call buttons.
  - **Messages:** yours on the right, theirs on the left, and "Message Esther…" at the bottom.
  - **On phones** the bottom bar steps aside while a conversation is open, so the message box sits at the bottom.
  - **Fixed:** since Stage 4a the bottom bar covered the message box on phones, in both chats and office conversations.
  - The old green photo behind conversations is gone.
  - Everything else is kept: reply, edit, star, pin, delete, reactions and search.
- **Read** (Read.dc.html, `read-home.tsx`):
  - **The Bible** card: "Holy Bible · KJV", where you stopped (e.g. "John 3 · Continue where you stopped · verse 16") and **Continue reading**.
  - **From your church:** today's devotional and the church's books and PDFs, as covers.
  - **Mine:** My notebook.

  Each opens the same reader as before. The wooden shelf now only appears while an admin uses a **Shelf tools** button (add or remove books, sizes, covers, titles), so nothing was lost.
- **Profiles and People** (no design file, so they follow the same look):
  - Profiles use theme cards, the title font, a full-width **Message** button, green call buttons, and "On the porch now" when the person is.
  - **Your account** stays on your own profile.
  - People has the new search box and faces.
- **Porch settings** (new screen `/porch-settings`, opened from **Your account → Porch settings**, admins only):
  - **Theme:** the six themes as colour cards. Tap one and everyone in the porch gets it. Each member can still use Dawn / Dusk / Night.
  - **Tour doors:** switch Pray, My 20, Events, Groups, Serve, Transport or Feedback on or off for the whole porch (as PLAN-MULTI-CHURCH.md section 6 describes). Nothing is deleted, and at least one door must stay on.
  - A link to Offices, where admins create offices.
- **The top bar** now names Porch settings and "On the porch now" too.
- **Rules changed (BUILD-BRIEF.md wins over porchbook-state.md):**
  - The Read library is no longer a wooden shelf for members.
  - The chat background photo is gone.
  - The bottom bar hides during a conversation on phones.
- **Checked:**
  - Type check passes.
  - **Two-church test: 149 passed, 0 failed, 0 not private yet** (it was 139). New checks:
    - Office conversations show in Chat for the member and for the office's head, and **none of Porch A's show in Ben's Chat**.
    - A member can't change the theme or the Tour doors.
    - **Porch B's theme doesn't change Porch A's or Phaneroo's.**
    - **Porch B's switched-off doors don't change Porch A's or Phaneroo's Tour.**
    - A porch must keep at least one door.
  - Design vs app: `../compare-design.html` now also has Conversation, and Read and Porch settings in each theme (Porch Evening, Morning Light, Royal Night). Phaneroo was set back to Porch Evening afterwards.
  - "After" pictures: `../after-stage4c/`.
- **Test data:** while checking the conversation screen I wrote one note in the test account's own My Space on this computer ("Sermon note: John 15:5"). It's only on the local test database.
- **Not yet in the new look:** what opens inside the Tour doors (Events, Groups, Serve, Transport, My 20), the Bible and book readers themselves, the admins' Shelf tools, Admin tools, and the older pages (invite, calls, roll). These keep their old look and could be a short "Stage 4d" if you want them redesigned.

### 9. Stage 4d (20 Nov 2026): the devotional per church, four fixes, and the older screens in the new look

**Fixes**
1. **Each church chooses its devotional** (Porch settings → Devotional, admins only):
   - **No devotional**
   - **Our own**: a title and the words, typed in the app
   - **A website**: the church's devotional page
   - **Phaneroo only:** "Phaneroo's daily devotional" from phaneroo.org, which changes by itself each morning

   **New churches start with no devotional. Phaneroo keeps phaneroo.org.**
   - **A leak this closed:** until now, the app fetched Phaneroo's newest devotional automatically for **every** church porch. Now only Phaneroo follows phaneroo.org.
   - Any Phaneroo devotional address already given to another porch on a computer was taken back, once.
   - Other churches can't choose Phaneroo's automatic devotional.
   - With no devotional, the Read screen doesn't show one. Admins see "Set up a devotional" instead.
2. **Tour:** it now has the same 16px side spacing as the other pages, scrolls to the end, and shows the Feedback card and the Dawn / Dusk / Night row in full.
   - **Cause:** the Tour page kept its own narrow edges and a large empty space at the bottom, left over from the old bottom bar.
   - The old keys' shine on the door cards is gone too.
3. **Office page:** the "Choose a head" box is gone from the top. Admins see a small **Edit** next to "Head: …", which opens the head picker. Members never see it, and Manage offices still has it.
4. **Read:** the "Today's devotional" card shows the day's picture as its cover and **the day's title** under it (e.g. "Kingdom Finance Principles: Beyond Transactional Giving"). A church's own devotional shows its typed title.
   - On a phone that has never opened the devotional, the card fetches it in the background, and the title appears once it arrives. It can take a few seconds, so a few comparison pictures caught the plain "Today's devotional" card.

**Stage 4d: the older screens in the theme**
- **One change covers every page:** the content of every page now uses the theme's colours.
  - The old black panels, gold edges, textured orange buttons and photo backgrounds (e.g. the sparkle photo behind Serve) become the theme's cards, lines and main colour.
  - Headings use the title font, and quiet text the theme's quiet colour.
  - This also works in **Morning Light**, where older pages used to stay dark.
- **Inside the Tour doors:** My 20, Events, Groups, Serve, Transport and Feedback now open in theme cards with theme fields and buttons. They work as before.
  - **Pray** still doesn't open a sheet. It marks you "praying" (and plays the prayer music when set), as before.
- **The Bible reader:**
  - **Theme colours:** the top bar, the Bible / Devotional / Notes switch, the book and chapter keys, the search, and the book, chapter and verse menus.
  - **Theme's page:** the reading page is now the theme's own page by default.
  - **"Paper page" stays:** a member can still tap it for the parchment page.
- **The devotional reader and book readers** have theme colours around them. **The notebook list** is in the theme. A note being written keeps its paper page.
- **Invite, the roll, Groups, a group's page, Calls and Privacy** follow the theme. The top bar names The roll, Calls and Privacy.
- **Left for later:** Admin tools and the word-study pop-up in the Bible. The admins' Shelf tools on Read got theme colours, since that was quick.
- **Still Phaneroo-shaped wording (each church can change it with Edit words):**
  - Serve's subtitle "Phaneroo Ministries Mbarara"
  - My 20's "31st Night of Prayer"
  - Transport's "To 31st Night of Prayer… Call +256…"

  They're per-church words, so Porch B's admin can change them without touching Phaneroo's. Starting new churches with blank wording here would be a small follow-up.
- **Checked:**
  - Type check passes.
  - **Two-church test: 157 passed, 0 failed, 0 not private yet** (it was 149). New checks:
    - Phaneroo keeps phaneroo.org.
    - **Porch B starts with no devotional and never gets Phaneroo's**, can't switch it on, and still sees none afterwards.
    - A member can't change the devotional.
    - B's own devotional stays in B.
    - A's devotional website reaches A only.
  - Design vs app: `../compare-design.html` (Porch Evening, Morning Light, Royal Night). Phaneroo was set back to Porch Evening afterwards.
  - "After" pictures in both themes:
    - `../after-stage4d/porch-evening/` (phone and computer)
    - `../after-stage4d/morning-light/` (phone)
  - **New helper:** `../set-theme.mjs` sets the test porch's theme for pictures.

### 10. Stage 5a (20 Nov 2026): joining and starting a porch
- **Follow-up from 4d:** new churches start with **blank wording** on the Serve, My 20 and Transport sheets: Serve's subtitle and welcome, My 20's "31st Night of Prayer", and Transport's "Phaneroo Grounds", "Phaneroo Mbarara" and "Manifest" places.
  - Phaneroo keeps its own wording.
  - Another church's admin can write theirs with Edit words.
  - A place with no name isn't offered on Transport.
- **Welcome screen** (Main.dc.html, `welcome-screen.tsx`): "Your church, on one porch." with **Join your church's porch** (invite code), **Start a porch**, and **Already a member? Sign in**.
  - After a right code, it shows "Joining Phaneroo Ministries Mbarara · Mbarara, Uganda" above the account form.
  - The earlier "tap the phone" welcome is kept in the code, unused.
- **No more "everyone joins Phaneroo".** A new account joins the church **whose invite code it uses**.
  - Someone signed in but not in a church yet sees the same screen to type a code (or start a porch).
  - Accounts made before today were already placed. That was done once and doesn't repeat.
- **Invite codes and links:**
  - Every church porch has an invite code, e.g. Phaneroo's is PHANEROO-MBARARA. Other codes look like GRACE-7K2PQ, with no 0/O or 1/I/L, so they're easy to read aloud.
  - The **Invite** page shows the church's code and its **invite link** (`/join/CODE`). The WhatsApp, Instagram, Facebook and SMS buttons now send "Join [church] on Porchbook. Our invite code is …" with the link.
  - Admins have **Reset the code**: a new code is made, and the old code and link stop working.
  - Opening an invite link keeps the code on the phone, so the person joins right after making their account.
- **Start a porch** (StartPorch.dc.html, new page `/start`), in 3 steps:
  1. **The porch:**
     - what kind: Church, Ministry, Gospel artist or Organisation;
     - its name, and its town and country;
     - **This is a branch**, with "Find the main porch". It searches approved church porches, and the main porch is recorded. Linking branches is Stage 7.
  2. **Your account** (skipped if you're signed in).
  3. **Done:** "waiting for approval", and for a church, its new invite code.
- **Who belongs where** (decision of 19 Nov):
  - The person who starts a **church** becomes its first member and admin.
  - A **ministry, gospel artist or organisation** porch has only a small team of admins and no members, and no invite code. The person who starts it stays a member of their own church, and running it doesn't make them an admin of their church.
  - A church member can't start a second church (one church each). Moving church is Stage 5b.
  - **Your porches**, on your profile, lists the porches you run and where each stands (Waiting for approval, Approved, Declined). **Start a porch** is in Your account.
- **New porches wait for your approval** (new page `/porches-waiting`, in Your account → **Porches waiting for approval**, platform owner only).
  - Each one shows its kind, place, who started it, and the main porch if it says it's a branch, with **Approve** and **Decline**.
  - A waiting porch works privately (feed, chat, offices) but can't post publicly. Public posting is Stage 6.
  - Declining a church frees its people to join another church, and its admins step down.
  - Only three porches per person can wait at once.
- **Checked:**
  - Type check passes.
  - **Two-church test: 181 passed, 0 failed, 0 not private yet** (it was 157). New checks:
    - a new account joins no church by itself;
    - a wrong code joins nothing;
    - Phaneroo's code joins Phaneroo, and Porch B's code joins B;
    - **someone in Porch B can't hop into Porch A with A's code**;
    - only churches take members by code;
    - a member can't reset the code, but an admin can (the old code stops working), and **resetting B's code leaves A's alone**;
    - starting a church (waiting, private, first member and admin) **sees none of Porch A's or Phaneroo's posts**;
    - starting a ministry keeps the person in their church and doesn't make them a church admin;
    - a member can't start a second church;
    - a branch must name an approved main porch, and a branch sees none of the main porch's private posts;
    - only the platform owner sees the waiting list and can approve, and declining frees the church's people.
  - "After" pictures: `../after-stage5a/` (phone and computer), including the Welcome, joining with a code, Start a porch and the waiting list.
- **Fixed during this stage:** the Decline button failed with a database error. Two lines had lost their "$1" when I wrote them. The test caught it before saving.
- **Test data on this computer:** while checking Decline, I started and declined a ministry porch called "Decline Check Ministry" with the test account. It shows as Declined under the test account's Your porches.

### 11. Decisions of 21 Nov, random invite codes, and Stage 4e: the Porchbook brand (21 Nov 2026)

**Part 1: decisions recorded (text only).** They are in BUILD-BRIEF.md section 8b (decisions 14–22) and in the plan:
- accounts with a verified email and an optional username;
- church membership by request only, approved by admins, with full name, nation, phone and address;
- full names in the private porch, and usernames on public reactions with an "hide my church" switch;
- who sees member details;
- the draft admin levels;
- the email service to be agreed first;
- "move to the new church" when starting one.

**The new stage order:** 4e → 5c → 5d → 5b → 6 onwards.

**Part 2: invite codes can't be guessed any more.**
- Every porch, Phaneroo included, now has a **random code like K7QM-4XPA**: 8 letters and digits, with no 0/O or 1/I/L, about 850 billion possible codes.
- The old name codes (PHANEROO-MBARARA) were replaced once and **no longer work**. Admins share the new code and link from Invite.
- Reset still gives a new random code.

**Part 3: Stage 4e, the Porchbook brand** (`brand/BRAND.md`, `src/lib/porch/brand.ts`)
- **Olive is always the frame:**
  - the top bar (olive with white text in Light);
  - the bottom bar (with an olive line, and the selected tab in olive);
  - main buttons, links, switches, selected chips, focus rings;
  - the My porch / Public porch track (olive tint).
- **Each church's accent colour** colours only its own touches:
  - its name badge in the top bar;
  - room chips (Inspire / Inform / Inquire);
  - reactions;
  - pinned office announcements;
  - office icons;
  - notification badges and unread counts.

  The accent never replaces olive on buttons or bars.
- **Every porch, Phaneroo included, now uses olive with Porchbook gold.**
- **The six full church themes are switched off, not deleted**: the `churchThemes` switch in on-hold.ts, like the on-hold features.
- **Porch settings:** the theme picker is replaced by an **accent colour picker** (the six accents from BRAND.md), with a small preview showing that buttons stay olive.
- **Light or Dark, each member's own choice:** Your account → Look: **Light** (default) / **Dark**.
  - Dawn / Dusk / Night stays as the gentle dimmer.
  - The phone remembers the choice, so the right colours show before anything loads.
- **Logos**, from `brand/`, used exactly as the files are (never recoloured, stretched or redrawn; they take the colour of the text around them):
  - **Welcome:** the main logo (tile + word) **white on an olive page**.
  - **Sign-in:** olive on cream.
  - **Loading screen:** the circle of people, breathing gently.
  - **Public porch header:** the circle of people.
  - **Top bar:** keeps the church's own initials badge, in its accent, and its name.
  - **Empty feed** ("Porchbook is quiet"): now the circle of people. Before, it showed a photo of a speaker that every new church would have seen.
- **App icon and favicons:** the brand app-icon pictures (512 and 192 for the web app, 180 for iPhone, 32 and 16 for the browser tab). The old icons are kept in `public/old-icons/`. The browser bar colour is olive.
- **Type:** **Fredoka** (weight 500) for titles and names instead of Fraunces. Source Sans 3 stays for body text.
- **Checked:**
  - Type check passes.
  - **Two-church test: 188 passed, 0 failed, 0 not private yet** (it was 181). New checks:
    - **invite codes are random**, and the old name code doesn't work;
    - **a reset gives a new random code and the old one stops working**;
    - every porch starts with gold and Light;
    - a member can't change the accent, and only the six accents are allowed;
    - **Porch B changing its accent doesn't change Porch A's or Phaneroo's**;
    - **Abe choosing Dark changes only Abe's look**, not Ann's (same church) or Ben's.
  - **Pictures:** `../brand-pictures.html` shows the Welcome and sign-in screens, and Phaneroo (gold) and **Grace Test Church (Royal blue)**, each in **Light and Dark**: Porch, Tour, Offices, Read, Chat, Porch settings. The pictures are in `../after-stage4e/brand/`, and every screen in Light is in `../after-stage4e/all-screens-light/`.
  - **New helper:** `../brand-pictures.mjs` makes these pictures again.
- **Test data on this computer:** a second test account, Grace Tester, with its own approved church **Grace Test Church** (Royal blue), for the accent pictures. Its details are in `../TEST-ACCOUNT.md`.
- **Not changed (Android):** the Android app's own icon lives in the android folder, which I don't touch unless you ask.

### 12. Two fixes and Stage 4f: Help and FAQ instead of the Manual (21 Nov 2026)

**Fixes**
1. **The old orange-and-green butterfly is gone** from post cards and everywhere else it appeared: the post box, book covers and office books, Calls, the complaints list and the office reports. Nothing replaces it.
   - The code is kept and switched off in one place (`pb.css`), like the on-hold features.
   - The small icon on phone notifications (the "badge") is now the Porchbook circle of people. The old one is kept in `public/old-icons/`.
   - The radio's lock-screen picture (radio is on hold) now uses the Porchbook app icon.
2. **The blank Offices picture:** the Offices page works in Light mode. The picture had been taken while the page was still fading in. The picture script now retakes any nearly blank picture, and `after-stage4e/brand/phaneroo-light-offices.png` has been taken again.

**Stage 4f: Help and FAQ** (BUILD-BRIEF.md decision 23, new page `/faq`)
- **The Porchbook Manual is hidden, not deleted:** its card on My porch and its book are behind a new `manual` switch in on-hold.ts.
- **One Porchbook FAQ, the same for every porch.** Reach it from:
  - **Your account → Help and FAQ**;
  - a small **"Questions?"** link on the Welcome screen, which works for people who aren't signed in.
- **How it looks:** a search box at the top, then questions grouped into sections. Tapping a question opens its short answer in place. Searching opens the matching answers. It uses the brand look: an olive bar with the circle of people.
- **Only you (the platform owner) can change it:** **Edit the FAQ** on the same page lets you add a question (to a section, or a new one), edit, move up or down, or remove. Admins and members can't.
- **It starts with 22 questions in 7 sections:** Getting started, My porch, Offices, Chat and calls, Public porch, Privacy and account, For churches.
  - The answers match how the app works today and the Stage 5c decisions (join requests need admin approval).
  - **Answers marked "Marked for you to check"** (only you see the mark) describe things not built yet, or details to confirm:
    - joining by request;
    - the details a church asks for;
    - using Porchbook without a church;
    - what the three rooms are for;
    - calls;
    - the public porch and following;
    - who sees phone and address;
    - changing details;
    - leaving or moving church;
    - how long approval takes.

    Saving an edited answer clears its mark.
- **Checked:**
  - Type check passes.
  - **Two-church test: 193 passed, 0 failed, 0 not private yet** (it was 188). New checks:
    - the FAQ is the same for every porch;
    - a porch admin can't change it;
    - the owner adds a question that every porch then sees, and removes it again;
    - members never see the "to check" marks.
  - **Pictures:** `../brand-pictures.html` (Light and Dark, Phaneroo and Grace Test Church, now with the FAQ), and every screen in `../after-stage4f/`, including the FAQ signed out.

### 13. Brevo checked, hydration error fixed, and Stage 5c: accounts and join requests (21 Nov 2026)

**Brevo, checked on its own pages** (brevo.com/pricing and help.brevo.com, read in the browser):
- **Free plan:**
  - **300 emails a day**, free forever, no card needed.
  - Brevo has to approve the account for sending first.
  - Transactional emails (like our codes) work on every plan through its API.
  - Over 300 in a day, up to 1,000 wait in a queue, and beyond that they're not sent.
  - Unused emails don't carry over.
  - Every free email carries a "Sent with Brevo" sticker.
- **One verified email address works:** you add it as a sender and type the 6-digit code Brevo sends to it. No domain is needed.
- **Brevo warns** that sending from a free address (Gmail, Yahoo) makes emails more likely to land in spam. Your plan to get a Porchbook domain before real members sign up fixes that.

**The "hydration" error is fixed.** The browser log is clean on every page load. The first picture the browser drew didn't match what the server had drawn; now it always starts with the loading screen, as the server does.

**Stage 5c: accounts and join requests** (BUILD-BRIEF.md decisions 14–17)
- **A Porchbook account:** full name, plus an **email confirmed with a 6-digit code** sent through Brevo, plus an **optional unique username**.
  - The code works for 15 minutes; five wrong tries means asking for a new one; at most 6 codes a day.
  - **Test mode:** with no Brevo key on this computer, nothing is emailed and the code is shown on screen instead, in a dashed box. This happens only on this computer and never in a deployed app.
  - **The Brevo key** goes only in `porch-local.json` (`"brevo": { "apiKey", "senderEmail", "senderName" }`), which git ignores.
  - **Starting a porch** also needs a confirmed email.
- **An account alone belongs to no private porch.** It can look at the public porch ("coming soon" until Stage 6), start a porch, and read the FAQ.
- **Joining a church is by request only:**
  - **The invite code or link** only finds the church.
  - **The request** asks for full name, nation, phone number and address. Each field has one line saying why the church needs it.
  - **While waiting,** the person sees "Your request is on its way", can take it back, and can look at the public porch. Their screen checks every 20 seconds, so the porch opens as soon as they're let in.
  - **Declined:** the person is told, and can ask again with a code.
  - **Nobody gets in without an admin's approval.** The old "join with a code" step now only says "send a join request".
- **People waiting to join** (new page `/waiting-to-join`, in Your account for church admins):
  - each request shows the person's name, nation, phone, address and email, with **Let in** and **Decline**;
  - admins get a notification for each new request;
  - the person gets one when they're let in or declined.
- **Existing accounts:**
  - They stay members of their churches, and count as confirmed.
  - The next time they open the app, **they're asked for any missing details** (nation, phone, address), with **Not now** for that visit.
- **My details** (new page `/my-details`, in Your account):
  - every member sees and corrects their full name, nation, phone and address;
  - **On the public porch:** an optional username, and the **"Show my church with my reactions"** switch (on by default; switching it off hides your church). These are ready for public reactions in Stage 6.
- **Member details are seen only by the member and their church's admins** (admin levels refine this in 5d). Admins see a **"Member details · admins only"** card on a member's profile.
- **Full names:** the sign-up form asks for a **Full name** (first and last). The name from a person's join request becomes the name their posts and messages show.
- **FAQ:** four answers are now true and were updated, with their "to check" marks cleared:
  - how to join;
  - what details are asked and why;
  - who sees phone and address;
  - how to change details.

  Answers you had already edited were left as you wrote them. The other marked answers (the public porch, moving church, calls, approval time) still wait for later stages.
- **Also fixed:** buttons that are links (like **Message** on a profile) showed dark text on olive. They now show white text.
- **Checked:**
  - Type check passes.
  - **Two-church test: 214 passed, 0 failed, 0 not private yet** (it was 193). New checks:
    - a code alone doesn't let anyone in;
    - a person must confirm their email first, and a wrong code is refused;
    - a request must have all the details;
    - a request waits and lets nobody in by itself, and a waiting person sees none of the church's posts;
    - **a request to Porch A never shows in Porch B's waiting list**;
    - a member who isn't an admin can't see the list;
    - **Porch B's admin can't let anyone into Porch A**;
    - A's admin lets someone in;
    - **Porch B's admins can never see Porch A's member details**, and a plain member can't see others' details;
    - members see and correct their own details;
    - declining works, and the person can ask again;
    - usernames are unique;
    - "hide my church" is each person's own;
    - existing members are asked for missing details until they give them.
  - **Pictures:**
    - `../accounts-pictures.html` shows the whole joining path with local test accounts: asked for missing details → My details → a new person's account → confirm email (test mode) → the join request with its "why" lines → waiting → the admin's People waiting to join → member details on a profile → let in.
    - Every screen is in `../after-stage5c/all-screens/`.
- **Test data on this computer** (all in `../TEST-ACCOUNT.md`):
  - **New accounts:** Hope Newcomer (let into Grace Test Church) and Joy Waiting (still waiting to join Grace Test Church).
  - **Test details** were filled in for Test Member and Grace Tester.

### 14. Many porches, steps M1 and M2: Psalmist, members for every porch type, and the membership list (25 Nov 2026)
- **Decisions recorded:** JT's answers to the three questions became BUILD-BRIEF.md decisions 35 to 37:
  - 35: nation and address are deleted (only the city is asked now);
  - 36: one-to-one chats belong to the two people;
  - 37: you show as online in every porch you belong to.
- **M1: names and types**
  - **"Gospel artist" is now "Psalmist"** everywhere: the Start a porch choices, the welcome page, Help and FAQ, the public porch's text, and the stored type. Any porch already saved as a gospel artist becomes a psalmist by itself.
  - **Every porch type has members and an invite code:** church, ministry, psalmist and organisation alike. Porches that had no code get one.
  - The church-only rules are gone. Offices can be created in any porch, and Start a porch now says "Every porch has members, and you'll be its first member and admin". The menu says "A church, ministry, psalmist or organisation porch".
- **M2: the membership list underneath**
  - A new list, `porch_members`, holds one row per person per porch, with the full name, phone and city they gave that porch.
  - The profile's porch now means **"the porch you've switched to"**, and it only counts while you're still a member there.
  - All existing screens follow it unchanged.
  - **Existing accounts:**
    - everyone becomes a member of the porch they're in;
    - whoever started a porch becomes its member and admin (**including JT's Organisation porch**);
    - the admins of ministry, psalmist and organisation porches become members too;
    - members' phone numbers are copied across.
  - **Underneath, for the next steps:** switching porches (refused for a porch you're not in) and "my porches", which the switcher (M3) will use. Two people "share a porch" now means at least one porch in common.
- **What you see change:**
  - Someone with no church who started a porch is now **inside their porch**, instead of being stuck on "Join your church's porch".
  - A starter who already belongs to a porch stays where they are, and is told the new porch is one of their porches.
  - The person who started the porch isn't asked for nation and address (they're being dropped in M4).
  - Everything else, Phaneroo included, looks the same.
- **Two gaps closed on the way:**
  - "Remove from the porch" (the roll) now only works on someone in the admin's **own** porch.
  - Someone who is also in other porches only leaves this one; their account stays.
  - The roll only shows offices of the porch you're in.
- **Rules changed:**
  - Decisions 1, 9 and 24–25 (members for all four types).
  - porchbook-state.md's "one church per person" is replaced.
- **Files changed:**
  - `porch-foundation.ts` (the list, the database questions, the one-time moves)
  - `porch-join.ts` (codes for all types, starting, switching, my porches)
  - `membership.ts`, `roll.ts`, `offices.ts`, `api.ts`, `groups.ts`, `hoo-reports.ts`, `presence.ts`, `transport-board.ts`
  - `start-porch.tsx`, `account-screens.tsx`, `frame.tsx`, `faq.ts`, `index.tsx`
  - the test helper `api/porch-test.ts`, `scripts/online-test-data.mjs`
- **Checked:**
  - The type check and the build pass.
  - **The two-church test: 230 passed, 0 failed.** All of the earlier checks still pass, with three updated for the new rules:
    - a ministry now has an invite code;
    - a member may start a second porch;
    - a made-up code finds nothing.
  - **New checks with Cara, who is in both Porch A and Porch B:**
    - switched to B she sees only B, and switched to A only A (feed and people);
    - what she posts in A stays in A;
    - switching to a porch she's not in is refused;
    - A's admin never sees the details she gave B;
    - Ben and Cara share a porch, but Ben and Abe don't;
    - B's admin has no power in A;
    - once she's no longer in A, A closes for her at once.
  - Psalmist works, and the old "gospel_artist" type is refused.
  - On this computer, the test account that started three Organisation porches is now inside the first one.
- **Pictures:** `../after-m1m2/`.
- **Not done yet (later steps):**
  - the switcher on screen (M3);
  - the new join form, and deleting nation and address (M4);
  - Serve forms are still one per person. They need to become one per porch before the switcher, so one porch's admins can't see a form filled in for another (noted for M4).

### 15. Change of direction, step N1: churches with members, ministries with admins, a new landing page (26 Nov 2026)
- **Decisions recorded:** BUILD-BRIEF.md decisions 38–46 (section 8d) replace decisions 24–34 where they clash. PLAN-MULTI-CHURCH.md has a new section 12 with steps N1 to N7; M3 to M9 are dropped.
- **Porch types:**
  - **Church**, or **Ministry**, with a ministry type: Music, Teaching, or Other (the person names it).
  - The list of ministry types is one short list in `porch-kinds.ts`, so more can be added later.
  - Psalmist and Organisation are gone.
- **Existing porches converted:** every Psalmist or Organisation porch became **Ministry, type Other**, and its old type's name ("Organisation" or "Psalmist") became the "Other" name.
  - The change is recorded, and the platform owner sees the list under "Changed to Ministry on 26 November" on "Porches waiting for approval".
  - Converted porches have no description yet, because they were started before descriptions existed.
  - On this computer: the three test porches of the local "org starter" (Test Org Porch twice, and Second Test Org).
  - Online: JT's Organisation porch (the list on porchbook.app shows exactly which).
- **One church each; ministries have admins only:**
  - Only church porches have members, and a person is a member of one church only. The database itself refuses a second church or a ministry membership.
  - A ministry has no members, no invite code and no join requests. Anyone listed as a "member" of a converted porch was taken off that list; its admins stay.
  - A church member can't start a second church, but can start (and run) ministries.
- **Landing page:** only **Create account** and **Log in**.
  - The invite-code box and "Start a porch" moved inside the app.
  - An invite link still names the church that invited you.
- **Create account:** username (unique, checked before the account is made), email and password, then the 6-digit email code. No full name at sign-up any more: that comes with joining a church.
- **Start a porch, inside the app:**
  - It's under Your account → Start a porch, on the no-church screen, and as a "Start a porch" card on the public porch for people with no church. Signed out, /start shows the landing page.
  - **Step 1:** Church or Ministry, the name, and the **country** from a searchable list of all nations (type a few letters, e.g. "ug" finds Uganda; "UK" or "USA" work too). There's no town any more. A church can still say it's a branch.
  - **Step 2 (ministry only):** its type, and a description of what it does (20 to 400 letters).
- **Porches waiting for approval:** shows a ministry's type and its description ("What it does") before you approve.
- **FAQ:**
  - New section "For ministries", with "What is a ministry porch?" and "How do I start a ministry porch?".
  - Updated answers: "What is Porchbook?", "Can I use Porchbook without joining a church?", "What is the public porch?" and "How do I start a porch for my church?". Answers JT has edited himself are left alone.
- **Rules changed:**
  - Decisions 24, 25, 29, 31 and 33 (replaced by 38–46).
  - The Stage 5a welcome screen (join with a code on the landing page) is replaced by decision 44.
- **Not in this step** (planned in section 12):
  - joining with full name, phone and city, and deleting nation and address (N2);
  - "Me / Continue as [ministry]" (N3);
  - messages and calls only within a church (N7).
- **Files changed:**
  - `porch-foundation.ts`, `porch-join.ts`, `membership.ts`, `faq.ts`
  - new: `porch-kinds.ts`, `countries.ts`, `country-picker.tsx`
  - `start-porch.tsx` (rewritten), `welcome-screen.tsx`, `frame.tsx` (Create account), `porch-approvals.tsx`, `account-screens.tsx`, `routes/index.tsx`, `routes/start.tsx`
  - the test helper `api/porch-test.ts`, `scripts/two-church-test.mjs`
- **Checked:**
  - The type check and the build pass.
  - **The two-church test: 230 passed, 0 failed.** The checks that relied on many memberships were replaced. The new checks prove:
    - nobody can be in two churches, even straight in the database;
    - a member of B can't ask to join A;
    - a ministry can't get members, even straight in the database;
    - a ministry has no invite code;
    - its starter stays in their own church;
    - a church member can't start a second church;
    - a ministry needs a description, a named "Other" type, and a country from the list;
    - Psalmist and Organisation can't be started;
    - **a ministry's type and description reach the approval list**;
    - B's admin has no power in A, and A's admin none over a member's ministry.
  - On this computer:
    - the conversion worked on the real local copy;
    - Create account was tried end to end: the username is saved, and the email-code screen follows.
- **Pictures:** `../after-n1/` (landing, Create account, the no-church screen, the public porch's Start a porch, the country list, a ministry's type and description, and the approval list).
- **Test data on this computer:** a new account, n1check@porch.test (in `../TEST-ACCOUNT.md`, with the org starter account).

### 16. Steps N2 and N3: joining with name, phone and city; "Continue as [ministry]"; Leave this church; a friendly home (26 Nov 2026)
- **N2: joining a church**
  - **The join request asks for full name, phone number and city**, each with one line saying why. It no longer asks for nation or address, and if an old phone still sends them they're ignored.
  - The church's admins see the phone and city in "People waiting to join" and on a member's profile.
  - **Nation and address are deleted (decision 35):**
    - the old details table (nation, phone, address) is emptied; the phone numbers were already copied to the membership list in M2;
    - nation and address are blanked on every join request.
  - The details now live in the membership list, one row for the person's church.
  - **Existing members are asked once for their city** (the "A few details for your church" screen, with "Not now"). My details now has full name, phone and city.
  - **Serve forms belong to the church.**
    - A form is saved for the church you're in.
    - Only that church's admins get it in the volunteer list.
    - Old forms were given their owner's church once.
    - Leaving the church deletes the form.
- **N3: "Me / Continue as [ministry]" (decision 43)**
  - For anyone who runs a ministry, tapping **their picture or the porch badge** opens **"Continue as"**. It lists "Me" (with your church) and each ministry you run, with a "Now" mark on the current one.
  - **Acting as a ministry is unmistakable:** a dark bar at the very top says "Acting as [ministry]", with a "Continue as me" button. The badge and your picture get gold rings.
  - **The ministry's own screen** shows its description, its country and approval status, the admin team, and what's coming with the public porch (posting for it, followers).
  - **While you act as a ministry, your church's private porch is closed**: no church posts, no Serve form, and posting is refused. Nothing you do as the ministry can land in your church.
  - People with no church get a "Continue as [ministry]" button on their home screen.
- **N3: Leave this church**
  - It's under Your account → Leave this church (on My details).
  - **"Are you sure"** says plainly what happens:
    - your posts, comments and messages stay in the church's porch under your name, and you can no longer see them;
    - the details you gave it, and your Serve form, are deleted;
    - any admin or office-head role there ends;
    - your account, username and ministries stay;
    - coming back needs the admins' yes.
  - A church's only admin can't leave while it has other members.
- **A friendly home for people with no church:**
  - "Welcome, @username" and a short welcome.
  - **Find your church** (an invite code, or paste the invite link; searching by name comes later).
  - **Porches you run**, with "Continue as".
  - **Start a porch**, and Porches waiting for approval for the platform owner.
  - **Help and FAQ**, and the public porch (coming soon).
- **FAQ:**
  - Updated answers: joining, what details are asked, who can see them (now "Who can see my details?"), changing them, and leaving a church.
  - New question: "How do I act as my ministry?".
  - Answers JT has edited himself are left alone.
- **Also:** a post can only be written in a church porch. Someone with no church, or acting as a ministry, is told so instead of the post being saved nowhere.
- **Rules changed:**
  - Decision 14 (nation and address on join requests) and Stage 5b (moving church).
  - porchbook-state.md's join details.
- **Files changed:**
  - `porch-foundation.ts` (acting as, church_of, my_porch), `membership.ts`, `porch-join.ts`, `serve.ts`, `api.ts`, `faq.ts`, `pb.css`
  - new: `act-as.tsx`
  - `account-screens.tsx`, `member-pages.tsx`, `pb-shell.tsx`, `frame.tsx`
  - `scripts/two-church-test.mjs`
- **Checked:**
  - The type check and the build pass. The one style-checker error is old (a line in `serve.ts` I didn't change).
  - **The two-church test: 243 passed, 0 failed** (13 new checks):
    - a join request needs full name, phone and city; nation and address are never kept; the admin sees phone and city;
    - a Serve form belongs to its church;
    - the ministry's runner can act as it, someone else can't, and its screen shows its description and admins;
    - while acting, the church porch is closed and a post is refused; "Continue as me" opens it again;
    - the only admin can't leave; leaving closes the church, keeps the posts, and deletes the details and Serve form; the person can ask to join again.
  - On this computer:
    - the real local copy updated itself;
    - existing members are asked for their city;
    - the org starter account can continue as its ministries and come back.
- **Pictures:** `../after-n2-n3/`, in seven screens:
  1. the home for someone with no church;
  2. acting as a ministry;
  3. the "Continue as" sheet;
  4. the join form;
  5. members being asked for their city;
  6. My details;
  7. Leave this church's "are you sure".

### 17. Steps N4, N6 and N7: names, the invite QR code, messages and calls within a church (26 Nov 2026)
- **N4: names (decision 28)**
  - **Inside a church, people show by their full name**, the one they gave their church. Changing your name on your profile now changes the name your church knows too, so there's only ever one name inside the church.
  - Accounts whose profile name had drifted from the name their church knows were matched once.
  - **On anything public, people show by their username.** The first public place is a ministry's admin team. The public porch (Stage 6) will use the same "public name".
- **N6: the invite QR code (decision 31)**
  - On **Invite**, a church's admins see a QR code under the invite code and link. Two buttons:
    - **Show it big:** fills the screen, with the church's name and the code under it, big enough to scan from the back of a room on a projector or TV;
    - **Download:** a printable picture with the church's name, "Scan to ask to join our porch on Porchbook", the QR code, the invite code and the link.
  - The QR code is made on the phone with a small free library (`qrcode`, MIT licence). There's no outside service.
  - **Scanning it** opens the invite link:
    - **someone new** sees "You're invited to join [church]", creates an account, confirms the email, and lands straight on the join form (tried on this computer with a brand-new account);
    - **someone signed in with no church** goes straight to the join form;
    - **someone already in a church** is told so ("A person belongs to one church…"), and the invite isn't kept.
- **N7: messages and calls (decision 46)**
  - Private messages and calls only work between **members of the same church**. It's checked on the server, in every place a message, call or ring starts.
  - Once two people no longer share a church (for example after one leaves), they can't message each other any more.
  - **While someone acts as a ministry**, they can't message or call their church, and the church can't reach them, until they "Continue as me".
  - **A ministry's admins write to each other in "Team messages"** on the ministry's own screen. Nobody else can read or write there. Calls between a ministry's admins aren't built yet.
- **The online test data script** follows the new shape:
  - one church each, with full name, phone and city;
  - join requests with a city;
  - a made-up ministry, Alpha Worship Team (TEST), run by Ada, so "Continue as" can be tried.
  - **It was rehearsed on a copy of this computer's database:** add, show, the "count only" remove and the real remove all worked. The made-up people could log in and saw the right things (the pastor sees who's waiting, Ada runs the ministry, Wanda is waiting).
  - It now also checks that the online site is on the new version before adding anything.
- **Rules changed:** decisions 28, 31 and 46 are now built.
- **Files changed:**
  - new: `invite-qr.tsx`
  - `routes/invite.tsx`, `routes/join/$code.tsx`, `act-as.tsx`, `porch-foundation.ts` (public_name, same_porch, team messages), `porch-join.ts`, `api.ts`, `pb.css`
  - `scripts/online-test-data.mjs`, `scripts/two-church-test.mjs`
  - `package.json` (qrcode)
  - DEPLOY.md
- **Checked:**
  - The type check and the build pass.
  - **The two-church test: 251 passed, 0 failed** (8 new checks):
    - a ministry's admin team shows usernames;
    - inside a church, full names, never usernames;
    - a profile name change reaches the church;
    - acting as a ministry blocks messages and calls both ways, and coming back opens them again;
    - Team messages work for the ministry's admins and are closed to anyone else;
    - after Faye leaves, Ann can't message her.
- **Pictures:** `../after-n4-n6-n7/`:
  1. Invite with the QR code;
  2. the downloaded picture;
  3. the QR shown big;
  4. scanned by someone already in a church;
  5. scanned by someone new;
  6. the new account landing on the join form;
  7. a ministry's Team messages.
- **Test data on this computer:** four "scan check" accounts (in `../TEST-ACCOUNT.md`).

## Approved for the redesign stage

These were approved by the owner on 2026-11-18. Both went against `public/porchbook-state.md` (BUILD-BRIEF.md now wins).

- ✅ **Done in Stage 4a:** post cards have room, team and time on one line under the name.
- ✅ **Done in Stage 4a:** the posting box is one "Share with your porch…" line until tapped.

## Left alone on purpose

- **The calls script line** (`porchbook-calls.js`) is described in the rulebook but is not in the code. The owner will raise this with the creator. Not added.
- **The PorchGuy button** in the header was left alone on 18 Nov. Since 19 Nov it is hidden, because the PorchGuy is on hold (BUILD-BRIEF.md).
