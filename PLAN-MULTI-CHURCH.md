# Plan: Porchbook for many porches

**Updated:** 19 November 2026, to match **BUILD-BRIEF.md**, including its section 8, "Decisions, 19 November".
**Which file wins:** BUILD-BRIEF.md, then this plan, then `public/porchbook-state.md` (the creator's original rulebook, which now only describes how Phaneroo's porch looked before this work).

---

## 1. The idea

Any **church, ministry, gospel artist or organisation** starts its own **porch**: a private home where its members fellowship, message and call each other, and reach its offices. There is also a **public porch**, where porches post publicly and members of any porch react. **Phaneroo Mbarara is porch number one**, and all its current content becomes its settings.

### Words used here

| Word | Meaning |
|---|---|
| **Porch** | One of four types: **Church**, Ministry, Gospel artist, Organisation. **Only church porches have members** and a private porch (feed, chat, offices, tour). The other three are **public pages run by a small team of admins**, with no members |
| **Public porch** | The shared public side, where only porches post and members of any porch follow and react |
| **Porch page** | A porch's public page: its public posts, its branches, and a Follow button |
| **Branch** | A full porch of its own that is linked to a main porch (e.g. Phaneroo Kampala → Phaneroo Ministries) |
| **Platform owner** | JT. Approves porches and branch links, manages shared settings. **Cannot read private messages** |
| **Porch admin** | Runs one porch (several per porch). Replaces today's single "founder" |
| **Office head, member** | As today |
| **Porch tag** | A label on saved data saying which porch it belongs to (a `porch_id` column in the database) |

### Ground rules (from the brief)
- Work **only on this computer with test data**. Never connect to or change the creator's live Phaneroo database.
- **Free only.** If something can't be done for free, stop and ask JT.
- Small stages. After each one: undo point (git), CHANGES.md, "after" pictures, the two-church test, then **stop and wait**.
- On-hold features are **hidden, never deleted** (section 9).

---

## 2. Where things stand

| Item | Status |
|---|---|
| App running on this computer, test account, git undo points, Windows start-up fix | ✅ Done |
| "Before" pictures of every screen (`../before/`) | ✅ Done |
| **Stage 1:** this plan rewritten; on-hold features hidden | ✅ Done (19 Nov) |
| Old plan **Step 0**: local database keeps its data, two-church test | ✅ Done in Stage 2 |
| Old plan **Step 1**: porch tables, Phaneroo as porch 1 | ✅ Done in Stage 2 |
| Old plan **Step 2**: admins instead of the founder | ✅ Done in Stage 2 |
| **Stage 2:** the foundation | ✅ Done (19 Nov). Two-church test: 14 passed, 0 failed, 5 not private yet (feed, people, chat) |
| **Stage 3a:** MSG/AMPC hidden; feed, chat, group chats, people, "on the porch now" and one-to-one calls private per porch | ✅ Done (19 Nov). Two-church test: 46 passed, 0 failed, 0 not private yet |
| **Stage 3b:** offices, tour doors, read shelf and devotional, notifications, wording, sounds and settings | ✅ Done (19 Nov). Two-church test: 112 passed, 0 failed, 0 not private yet |
| **Stage 4a:** six themes, Dawn/Dusk/Night dimmer, new top and bottom bars, My porch, Who is on the porch, "founder" → "admin" | ✅ Done (19 Nov) |
| **Stage 4b:** Tour, Offices tab, offices each church creates, office screens, request status, office announcements | ✅ Done (20 Nov). Two-church test: 139 passed, 0 failed, 0 not private yet |
| **Stage 4c:** Read, Chat, messaging, profiles, Porch settings screen | ❌ Not started |
| Stages 3–8 | ❌ Not started |

---

## 3. The big technical choice: one database, every row tagged

**One app and one database.** Every piece of porch data carries a porch tag. Every read only looks at the viewer's own porch, and every save stamps it.

- Simplest to run: one website and one database. Phaneroo's data is simply tagged "porch 1".
- **The price:** the app reads and writes the database in about **600 places across 86 files**. Every one must respect the porch tag, or one porch could see another's posts or messages. That's why Stage 3 goes one area at a time, with the two-church test after each (section 8).
- **Public porch content lives in separate tables** (section 6). It is never a "public" switch on a private table, so a mistake can't leak a private post.

---

## 4. People and roles

### Today
- The **first account ever created** automatically becomes the founder (this happened to our local test account too). Only one founder is allowed.
- The app checks "is this the founder?" in about **140 places in 49 files**.

### New
| Who | Recorded as | Can |
|---|---|---|
| **Platform owner** (JT) | A short list of owner accounts, outside any porch | Approve porches (verification) and branch links. Suspend porches. Manage shared settings (Bible versions, storage, keys). **Never read private messages** |
| **Porch admin** | A role on their membership (several per porch) | Everything the founder does today, **for their own porch only**: offices, doors, theme, wording, events, transport, serve, My 20, groups, roll and removals, announcements, and posting on the porch's public page |
| **Office head** | Chosen by porch admins per office | Answer that office's conversations and requests |
| **Member** | Belongs to exactly **one church porch** | As today. Can also be an **admin of a few non-church porches** (ministry, artist, organisation pages) |

### Steps
1. Phaneroo's current founder becomes Phaneroo's first admin. JT becomes platform owner.
2. Replace the ~140 founder checks with two shared checks: "admin of *this* porch?" and "platform owner?"
3. **Remove "the first account becomes founder."** A new porch's first admin is whoever started it, once the platform owner approves it.
4. "Founder notes" (message everyone) become **porch announcements**, shown on the feed like the design's "From the Office of the Pastor · Pinned".

### Moving to another porch (decided in the brief)
- **Stays with the old porch:** their posts, comments and messages (shown as a former member).
- **Goes with them:** their personal notebook and Bible reading progress.
- **Ends:** their roles (admin, office head, group leader).

---

## 5. Which database tables need a porch tag

The app has about **150 tables**. About 75 are made by `migrations/` (which we don't touch until asked); the rest are created by the app code when first needed, so they're easy to miss. **Rule: anything members create or see gets a porch tag. When in doubt, tag it.**

### A. Shared by everyone (no porch tag)
| Tables | Why |
|---|---|
| `user`, `session`, `account`, `verification` | Sign-in: one login, whichever porch |
| `push_keys`, `push_subscriptions`, `push_alert_log` | Belong to a phone. *Who* gets an alert must still be limited to the porch |
| `guard_attempts` | Protection against password guessing |
| `bible_audio_books`, `bible_audio_chapters`, `bible_settings`, `demo_bibles`, `christian_glossary`, `translation_memory` | The Bible and its helpers are the same for everyone |
| `storage_settings` | Platform owner only |

### B. Personal (follow the person when they move)
`notebook_notes`, `read_notes`, `note_fonts`, `note_pictures`, personal `read_docs`, `bible_sittings` and reading progress.

### C. New tables for porches, roles and the public side
| Table | Holds |
|---|---|
| `porches` | Name, short name, type (church / ministry / gospel_artist / organisation), town and country, status (waiting / approved / suspended), **verified**, invite code, created date. Phaneroo = 1 |
| `porch_settings` | Theme, time zone, country code, and later the other items in section 7 |
| `profiles.porch_id` | The **one church porch** a person belongs to. One column, so nobody can belong to two churches |
| `porch_admins` | Who runs which porch. A person can be admin of their own church porch and of a few non-church porches |
| `platform_owners` | JT's account(s) |
| `porch_moves` *(Stage 5)* | History of leaving and joining, so posts stay with the old porch |
| `porch_links` | Branch → main porch link requests: asked, approved, unlinked |
| `office_actions` | Which actions each office offers (Thank God with me, Contact the pastor, Appointments, Weekly programme, Accountability, Official) |
| `office_requests` | A member's request to an office and its **status** (Sent, Confirmed, Answered) |
| `public_posts`, `public_reactions`, `follows` | The public porch: posts by porches, reactions by members of any porch, who follows which porch (Stage 6) |

### D. Porch content (each gets a porch tag)
| Area | Tables |
|---|---|
| **Membership** | `profiles` (current porch), `removed_members`, `legacy_members` (removal is per porch) |
| **Feed** | `posts`, `comments`, `reactions`, `comment_reactions`, `comment_keeps`, `keeps`, `item_sizes`, `rhema_clip`, `previous_clip` |
| **Chat** | `conversations`, `conversation_pins`, `conversation_reads`, `conversation_signals`, `messages`, `message_hides`, `message_reactions`, `message_stars`, `message_sound` |
| **One-to-one calls** | `call_peers`, `call_permissions`, `call_rings`, `call_signals`, `call_log`, `call_voice`, `line_rings` (calls only within one porch) |
| **On the porch now** | `presence` |
| **Groups** | `groups`, `group_members`, `group_notes`, `group_accounts`, `group_follows`, `group_marks`, `group_reports`, `group_studies`, `group_study_done` |
| **Offices** | `offices`, `office_threads`, `office_messages`, `office_files`, `office_pdfs`, `office_books`, `office_doors`, `office_removed`, `office_calendar`, `hoo_reports`, `hoo_decisions`, `hoo_writers`, `hoo_pages` |
| **Tour doors** | Pray: `prayer_track`. My 20: `my_twenty`, `mission_sends`, `mission_send_to`, `mission_reports`. Events: `pb_events`, `pb_event_rsvp`, `pb_event_travel`, `pb_hotels`, `pb_rooms`. Serve: `serve_forms`. Transport: `transport_events`, `transport_locations`, `transport_stages`, `transport_buses`, `transport_rides`, `transport_stops`. Feedback: `trouble_reports` |
| **Read** | `porch_shelf`, shared reading docs, `bible_sites`, porch reading plans, `devotion_translations`, `devotional_translation` |
| **Looks and wording** | `porch_words`, `button_sound`, `profile_faces`, `porch_once`, `porch_flags`, `app_flags`. The old photo and texture tables (`porch_ground`, `porch_header`, `porch_hide`, `porch_door`, `porch_wall`, `porch_carpet`, `porch_ceiling`, `porch_cloth`, `porch_cover`, `porch_cover_fly`, `porch_room_layout`) are **hidden** (decision 2), and are replaced later by a **logo and cover photo** per porch |
| **Other** | `notifications`, `founder_notes` (→ announcements), `manual_reads`, `previously` |
| **On hold (tag before switching back on)** | Radio: all `fm_*`, `radio_usage`, `jingle_drafts`, `worship_songs`. Nuggets: `nugget*`. PorchGuy: `porch_guy_*`, `city_board*`. Clinic: `clinic_*`. Devotional voice: `devotion_voice*`, `devotion_voices`. **These hidden features must get their porch tag before anyone switches them back on.** |

**Special care:** several tables allow "only one", like one wording per word (`porch_words`) or one ringtone. These become "one per porch". Otherwise porch 2 would overwrite Phaneroo's.

---

## 6. New parts the brief adds

### Offices (own tab)
- Each porch creates its own offices, picks each office's head, and chooses which **actions** each office offers. Phaneroo starts with its current 8 offices and actions.
- A member's requests show a **status** (Sent → Confirmed → Answered), as in `Office.dc.html` and `OfficeThread.dc.html`.
- Office conversations also show in **Chat**, marked "Office" (`Chat.dc.html`).
- Offices leaves the tour and gets its own tab in the bottom bar. **Until that tab exists (Stage 4), the Offices door stays on the tour**, so members can still reach their offices.

### Tour doors
- Pray, My 20, Events, Groups, Serve, Transport, Feedback. **Each porch switches doors on or off.**
- Radio, Clinic and Call are hidden (on hold). Feedback is back on the tour in the Clinic's place.

### Public porch (Stage 6)
*Decisions 9–13 (BUILD-BRIEF.md) are in force for this stage:*
- **Anyone can build a porch** of any type. A person is a **member of only one porch, their church**, and can be an **admin of other non-church porches** they build.
- The public porch shows **only posts from porches you follow**. Members follow, unfollow and react; they never post or comment there.
- **Automatic following:** every member follows their own church's porch, and its main church if it's a branch. **Their own church can't be unfollowed.**
- **Find porches:** search by name, town or type. Finding a porch never adds its posts by itself; only following does.
- **Design:** follow the updated `design-reference/Public.dc.html`: "From the X porches you follow" plus a **Find porches** button, instead of filter chips.
- **Tests to add then:** you only see followed porches' posts; you can't post or comment; you can't unfollow your own church; search finds porches but adds nothing to the feed.

- **Only porches post** (an admin posts on behalf of the porch), and only once the porch is **approved (verified)** by the platform owner.
- Members of any porch can **follow** porches and **react** (Love, Like, Touching, Deep). **No comments or replies.**
- To post publicly you must start a porch first.
- Sharing a public post into a private porch shares a **link**. Private content never goes public automatically.

### Branches (Stage 7)
- Every branch is a **full porch** with its own members, admins, offices and private feed.
- When starting a porch, "This is a branch" asks to link to a main porch. **The main porch approves.**
- The main porch's page lists its branches, and its public posts reach everyone who follows it.
- The main porch **cannot** see inside a branch's private porch, messages, offices or members. A branch can unlink at any time.

### Joining and starting (Stage 5)
- Welcome screen (`Main.dc.html`): **Join your church's porch** with an **invite code**, **Start a porch**, or **Sign in**.
- Start a porch (`StartPorch.dc.html`), in 3 steps: type, name, town and country, and "This is a branch". It waits for platform-owner approval before it can post publicly.

### One-to-one calls (Stage 8)
- Voice and video, **only between members of the same porch**, phone to phone.
- Today's calls use the creator's own servers (porchbook-calls.onrender.com, Firebase and a relay). JT's version needs **its own free setup**. Before building, find the free option, explain it in plain words and wait for JT's OK (section 10 explains the catch).

### Look and design (Stage 4)
- Follow `design-reference/`, one screen at a time.
- **Bottom bar:** Porch, Tour, Offices, Read, Chat. **Top of the Porch screen:** a "My porch / Public porch" switch. **Your own picture** in the top bar opens your profile.
- **Keep:** Fraunces and Source Sans 3, rounded cards, tap areas of 44 px or more, clear labels.
- **Drop:** heavy textures, 3D buttons, the crowded header.
- **Six themes**, chosen by each porch admin. Only colours change. Built as **one set of colour settings that every screen reads from**, so a new theme is one more row. Phaneroo uses **Porch Evening**. Dawn, Dusk and Night become a **gentle dimmer** on every theme; Night never goes nearly black. All six themes were checked: every text and button colour pair passes the 4.5:1 contrast rule (the lowest is 4.9:1, Crimson Grace's red on its cards).

---

## 7. Phaneroo-specific things and the porch setting each becomes

Phaneroo's current values become its settings, so nothing changes for Phaneroo.

| What | Where today | Becomes |
|---|---|---|
| "Property of Phaneroo Ministries Mbarara" | Under every page, the welcome phone, the manual, account and report books | **Porch full name** |
| "Phaneroo" / "MBARARA" lettering | Reading sheet, manual opening, serve form | **Porch name** and **town** |
| Logo and butterfly mark | Header, book covers | **Porch logo** (initials in a circle until a logo is added, as in the designs) |
| Orange #f8a018, green #90c840 | Rulebook and styles | **Theme**: Phaneroo = Porch Evening (same orange and green) |
| The 8 offices and their parts | `src/lib/porch/offices.ts` | **Porch offices**, which each porch edits |
| The office actions | Office pages | **Office actions** per office (`office_actions`) |
| Office phone "0200998801" (+256) | Offices page | **Porch help and contact numbers** |
| Daily devotional from **phaneroo.org** (with its picture) | `devotion-page.server.ts` | **Devotional source**: none, a website (WordPress), or typed by admins. Phaneroo keeps phaneroo.org |
| Phaneroo's own Runyankore and Luganda devotional | Devotional reader | **Porch languages** (machine translation on hold) |
| "Apostle Grace Lubega", "A Phaneroo pastor" | Clinic (on hold), voice sample (on hold) | **Leader's name**, needed when those return |
| "Phaneroo is live now", Thursday and Sunday | Radio (on hold) | **Live label, service days, YouTube channel**, needed when the radio returns |
| Notebook stamp "PHANEROO 123" | Notebook | **Service-number label** |
| **Kampala time**, added by hand as "+3 hours" in **17 files**, plus "Africa/Kampala" elsewhere | Devotional day, events, transport, presence, clocks | **Porch time zone** (risky, see section 10) |
| **Uganda +256** default phone code | My 20, serve form, transport | **Porch country code** |
| "From Uganda", "e.g. Mbarara" | Event travel form | **Home country**, **example town** |
| "31st Night of Prayer" | My 20 and its PDF, transport board | **Current My 20 event name** |
| Manifest centres | My 20, complaints helper | **Porch centres list** (or off) |
| "Global High School Grounds, Mbarara" | Serve form | **Serve induction venue** |
| "Payment to Phaneroo Ministries' account…" | Events | **Payment note** |
| "e.g. Phaneroo Anniversary 2026" | Transport team form | Neutral example |
| User manual (5 chapters) | Manual book | Platform manual + **porch welcome chapter** |
| Privacy page | `/privacy` | Platform privacy page + **porch contact** |
| Wording ("Edit words") | One set for the whole app | **Per porch** |
| Tour doors | Fixed in code | **Doors on/off per porch** |
| `porchbook.vercel.app` in links | Server files | Platform setting |

---

## 8. The stages, in order (stop after each)

After every stage: git undo point, CHANGES.md, "after" pictures where screens changed, the **two-church test** (from Stage 2 on), then stop for JT.

1. **Update the plan and hide on-hold features.** ✅ Done.
2. **Foundation** ✅ Done (19 Nov).
   - The local database **keeps its data** between restarts. Today it's held in memory and wiped every time; the fix is to save it in a folder on this computer.
   - Write the **two-church test**.
   - Add `porches` (with porch type), `porch_settings`, `porch_admins`, `platform_owners` and each person's church (`profiles.porch_id`). Phaneroo becomes porch 1, and every existing account joins it.
   - **Admins instead of the founder**, and remove "first account becomes founder".
   - Test: Phaneroo looks identical (pictures), the admin keeps every tool, a member gets none, and a second admin can be added.
3. **Porch tags, one area at a time**, in two halves.
   - **3a** ✅ Done (19 Nov): MSG and AMPC hidden; feed, chat (with group chats), people and profiles, "on the porch now", and one-to-one calls only within a porch.
   - **3b** ✅ Done (19 Nov): offices (and the office-head and report pickers), tour doors (Events, Serve, Transport, My 20 and its SMS, Pray, Feedback), read shelf and devotional, notifications and alerts ("send to everyone" is now "everyone in this porch"), and per-porch wording, sounds and every "only one" setting.
   - **Still not separated, by decision:** the on-hold features (radio, nuggets, PorchGuy, Clinic, devotional voice, machine translation, group calls). They must be tagged and pass the two-church test before being switched on (decision 8).
   - **Left for later stages:** moving between churches (Stage 5: old conversations, office threads, roles, and old Porchbook "legacy" posts claimed by email); the devotional source and the 8 office names as church settings (Stage 4); calls through outside services (Stage 8).
4. **Themes and the new design**, in three parts (4a ✅ themes, bars, My porch, Who is on the porch; 4b ✅ Tour and Offices; 4c Read, Chat, profiles, Porch settings), one screen at a time, following `design-reference/`. Hide the old photo and texture settings and the old Themes menu (decisions 2 and 3), and make Dawn / Dusk / Night a gentle dimmer (decision 4). The colour settings come first, then Porch, Tour, Offices (with its new tab and office actions), Chat, Read, Presence, Conversation and profile. Phaneroo uses Porch Evening.
5. **Joining, leaving and starting a porch**, with invite codes, the 3-step Start a porch screen, and platform-owner approval.
6. **Public porch**: porch pages, following (automatic for your own church and its main church), public posts and reactions (separate tables), and Find porches. Members react only; no posting or comments.
7. **Branches**: link requests, approval by the main porch, the branch list on the porch page, unlinking.
8. **One-to-one calls** on a free setup. JT approves the setup first.
9. **Porch stations** (future, after Stage 8; BUILD-BRIEF.md section 9). Each porch gets its own private radio station, reusing the on-hold radio code.
   - **First:** the radio code gets church tags and must pass the two-church test (decision 8). The radio's tables (`fm_*`, `radio_usage`, `jingle_drafts`, `worship_songs`) and its one shared storage setting become per porch.
   - **9a, playlist station (free):** admins upload or link sounds and arrange a schedule. No always-on server: every member's app plays the same scheduled file at the same moment. Files live in Cloudflare R2 (free to listen). Low but clear sound quality, respecting Porchbook Lite.
   - **9b, live broadcasting (paid, monthly allowance per church):** an approved person goes live from their phone or computer microphone, and the playlist pauses meanwhile. This needs a one-to-many audio service (about $0.59 per 1,000 listener-minutes, e.g. Agora audience-only) or a self-hosted radio server. The app stops new broadcasts when a church's allowance is used up and never goes over.
   - **Rules:** porches only play what they have the right to; admins confirm the rights when uploading a song. Only approved people go live. Each station is private to its own porch.
   - **Tests to add then:** Porch B never hears or sees Porch A's station, schedule or files; a member who isn't approved can't go live; a church over its allowance can't start a broadcast.
   - **To decide then:** Cloudflare R2's free tier asks for a payment card when you sign up (decision 6 says storage waits until later). Live broadcasting is the first feature in the plan that costs money each month.

### The two-church test (from Stage 2)
A script sets up **Porch A** (Ann the admin, and Abe) and **Porch B** (Ben). In Porch A it creates a post, comment, reaction, chat message, group, office request and message, event, transport request, My 20 list, complaint, shelf book and notification. Then, as **Ben**, it checks that:
1. Ben's feed, chat list, groups, offices, people list, "on the porch now", events and notifications show **nothing** from A.
2. Opening A's post, group, conversation, person or office directly by its number or address is **refused**.
3. Ben **cannot** react to, reply to, message, call or invite anyone in A.
4. Admin powers in B do **nothing** to A, and A's admin can't change B's settings or theme.
5. *(From Stage 6)* A's **private** posts never appear on the public porch, and Ben can react to A's **public** posts but not comment.
6. *(From Stage 7)* A main porch can't see into its branch.

**Pass = zero leaks.** A small code check also lists every database read or write on a porch table that is missing the porch tag. That list must be empty.

---

## 9. On hold (hidden in Stage 1, code kept)

All switches live in one file: **`src/lib/porch/on-hold.ts`**. Changing a `true` to `false` brings a feature back.

| Feature | What was hidden |
|---|---|
| **Radio** (studio, control room, jingles, nuggets, listening) | Radio door on the tour, the radio slide in the post box, the radio card on computers, the on-air bar, radio news, the nugget link, the `/control-room` page (old links go to the porch). The radio can't be switched on from anywhere |
| **PorchGuy** (AI helper) | The PorchGuy button in the header, the `/porchguy` page (old links go to the porch), "Videos on the porch guy's screen" in Events and its mention in the Events intro |
| **PorchWay** (driving game) | The `/city` page (old links go to the porch) |
| **Group calls** (incl. open porch calls) | The Call door on the tour. One-to-one calls (from a person's page or chat) stay |
| **Clinic** | The Clinic door. Feedback takes its place again |
| **Devotional voice** (ElevenLabs, Azure, Google) | The "Listen" button on the devotional, and the founder's AI-credit warning strip |
| **Machine translation** (Sunbird) | The devotional no longer asks Sunbird. Phaneroo's own Runyankore and Luganda, or a copy typed in by an admin, still show |

---

## 10. Risks and open questions

### Decisions, 19 November (were questions)
- **Members only in church porches.** Ministry, Gospel artist and Organisation porches are public pages with a small admin team and no members. A person belongs to one church porch and can also admin a few non-church porches.
- **Old photo and texture settings: hidden** (Stage 4, when the new design arrives). Later each porch gets a logo and a cover photo for its public page.
- **Kept:** Rhemaclip, Edit words, button sounds. The old Themes menu is replaced by the six themes in Stage 4.
- **Dawn / Dusk / Night is a gentle dimmer on every theme.** Night never goes nearly black, on any theme (Stage 4).
- **MSG and AMPC Bibles are hidden for everyone**, Phaneroo included, until JT confirms permission. KJV and other free versions stay. *To do: first item of Stage 3.*
- **Going online, file storage and the call relay: not now.** Everything stays on JT's computer, and calls wait for Stage 8.
- **Ownership:** JT is sorting it out with the creator.

### Things that may not be free
- **Putting JT's version online** isn't one of the 8 stages. Free options exist, but each has limits:
  - **Vercel's free plan** is for non-commercial personal use only.
  - The **Neon free database** has small storage (around 0.5 GB).
  - **Free photo and file storage** is small, and some providers (for example Cloudflare R2) ask for a payment card even on the free tier.
  
  This needs a decision before real churches use it.
- **Photos and files** (post photos, profile pictures, office files, PDFs) need storage. Today they use the creator's paid-tier services, so they don't work locally. They need a free home in Stage 3 or 4: the database or the computer's disk while testing, then a free online store.
- **Calls (Stage 8).** Phone-to-phone calls are free when both phones can reach each other directly. On many mobile networks they can't, and the call then needs a "relay" (TURN) server. Good relays usually cost money, and free ones have small limits. Expect some calls on mobile data to fail on a free-only setup.
- **Alerts** (push notifications) are free.
- **The Android app** belongs to the creator (`app.porch.team`), and we don't touch the `android/` folder. JT's version would start as an installable web app (Add to Home Screen).

### Risks
- **Leaks between porches.** This is the biggest risk (~600 database places). Handled by doing one area at a time, the two-church test and the missing-tag check.
- **Time zones.** 17 files add "+3 hours" by hand for Kampala. A porch elsewhere would get the wrong devotional day, event times and clocks. It needs careful testing.
- **"Send to everyone"** (announcements, alerts, My 20 SMS) must become "everyone **in this porch**".
- **Background jobs** (`.github/workflows`, workers) assume one porch. Most belong to on-hold features, but check each before switching anything back on.
- **On-hold features still have untagged tables.** They must be tagged before being switched back on (section 5).
- **Offices door.** It leaves the tour only when the Offices tab exists (Stage 4).
- **The two-church test doesn't exist yet**, so Stage 1 couldn't run it. It's built in Stage 2.
- **Ownership.** The code was written by the creator for Phaneroo, and every page says "Property of Phaneroo Ministries Mbarara". Agree in writing with the creator and Phaneroo before offering JT's version to other churches.
- **The law and safety.** Uganda's Data Protection and Privacy Act (2019) applies once JT hosts several porches' members. Porches need reporting and blocking tools, especially where young people are members.
- **The calls script line** in the rulebook isn't in the code (already noted for the creator). It's not needed for JT's version, which will have its own calls setup.

### Size
This is several weeks of careful work in small stages. Phaneroo keeps working the same way after every stage.
