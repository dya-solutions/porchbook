# Plan: from one church to many church porches

**Status:** plan only. No app code has been changed for this yet.
**Written:** 2026-11-18, from reading the code as it is today.

---

## 1. The idea in plain words

Today Porchbook is one porch for one church, Phaneroo Ministries Mbarara. The goal is one Porchbook that holds many porches:

- Every account belongs to **exactly one church porch**. A person can leave it and join another.
- Each church has its **own admins** and its own **name, logo, colours, porch photo, offices, reading shelf, tour doors and wording**. The Bible stays the same for everyone.
- **Phaneroo Mbarara becomes church number one.** Everything it has today becomes its settings, so its members notice no change.
- **Later:** a public side, working name **the Porchway**, where verified church pages post and members follow, react and share. It is not built now, but this plan leaves room for it (section 8).

### Words used in this plan

| Word | Meaning |
|---|---|
| **Church porch** (or **church**) | One church's private space in Porchbook |
| **Platform owner** | You. Above all churches: you approve new churches and manage shared things like storage and keys |
| **Church admin** | Runs one church porch. Replaces today's single "founder" |
| **Member** | An ordinary account in one church porch |
| **Church tag** | A label on a piece of saved data saying which church it belongs to (in the database, a column called `church_id`) |

---

## 2. The big choice: one database, with every row tagged

**Recommendation:** keep **one app and one database**, and add a church tag to every piece of church data. Every time the app reads data, it only looks at the viewer's own church. Every time it saves data, it stamps the viewer's church on it.

Why this one:
- One website, one Android app and one database to look after. That is the simplest thing to run.
- Phaneroo's existing data just gets tagged "church 1". Nothing has to be moved anywhere.

The other option, a separate database per church, keeps churches apart more strongly. But every new church would need its own setup, and every fix would have to be applied many times. It isn't worth it at this size.

**The price of this choice:** the app reads and writes the database in about **600 places, spread over 86 files**. *Every* one of those must respect the church tag. Miss one and a church could see another church's data. That is why section 6 does it in small steps, and section 7 describes an automatic test that tries to break into another church after every step.

---

## 3. From one founder to church admins and a platform owner

### How it works today

- The **first account ever created** is automatically marked as the founder (`is_founder` on the `profiles` table). The database allows only one founder.
- The app checks "is this person the founder?" in about **140 places across 49 files**. Many files have their own copy of that check.
- The founder can do everything: change how the porch looks, edit wording, run the radio, manage the devotional and translations, appoint office heads, remove members, see complaints, set storage keys, and more.

### How it will work

| Who | How they are recorded | What they can do |
|---|---|---|
| **Platform owner** (you) | A short list of owner accounts, kept separately from all churches | Approve or suspend churches. Manage shared keys and storage (radio storage, AI keys, translation keys), shared Bible content and usage limits. Make someone a church admin. **Cannot read private messages** (recommended, see section 9) |
| **Church admin** | A role on that person's church membership. A church can have several | Everything the founder does today, **for their own church only** |
| **Office head** | As today (offices already have heads) | As today |
| **Member** | Membership in one church | As today |

### Steps

1. **Today's founder** of Phaneroo becomes **Phaneroo's first admin**. Nothing changes for them.
2. The ~140 founder checks are replaced by **two shared checks**: "is this person an admin of *this* church?" and "is this person the platform owner?" Each power goes to one or the other:
   - **Church admin:** looks (porch photo, header, covers, door, wall, carpet, ceiling, cloth, sounds), wording, manual, events, transport, serve forms, My 20, clinic, groups, offices, roll and removing members, prayer music, worship songs, devotional voice and translation checks, radio programme for that church, the PorchGuy for that church.
   - **Platform owner:** storage settings (the radio storage keys are saved in the database today), AI and translation keys and credit, shared Bible audio and versions, approving churches.
3. **Remove the "first account becomes founder" rule.** In a many-church world, whoever signs up first would get power over everything. New churches get their first admin when the platform owner approves the church.
4. The "founder notes" (messages from the founder to the whole porch) become **church announcements**, from that church's admins to that church only.

---

## 4. Which database tables need to know their church

The app has about **150 tables**. About 75 are created by the files in `migrations/`. The rest are created by the app code itself the first time they are needed, which makes them easy to miss. Every one must be decided on.

**Simple rule: if a table holds anything a church's members create or see, it gets a church tag. When in doubt, tag it.**

### A. Shared by all churches (no church tag)

| Tables | Why |
|---|---|
| `user`, `session`, `account`, `verification` | Sign-in itself. One account, one login, whichever church |
| `push_keys`, `push_subscriptions`, `push_alert_log` | Belong to a phone, not a church. *Who* gets a notification must still be limited to the church |
| `guard_attempts` | Protection against password guessing |
| `bible_audio_books`, `bible_audio_chapters`, `bible_settings`, `demo_bibles`, `christian_glossary`, `translation_memory` | The Bible and translation helpers are the same for everyone |
| `storage_settings` | Platform storage keys: platform owner only |
| `_migrations` | Bookkeeping |

### B. Personal (follow the person, not the church)

A person's own notebook should go with them if they move church.

| Tables | Note |
|---|---|
| `notebook_notes`, `read_notes`, `note_fonts`, `note_pictures`, `read_docs` (personal books) | Owned by the person. Only shared notes need a church check |
| `bible_sittings` and personal reading progress | Owned by the person |

### C. Membership (the heart of the change)

| Table | Change |
|---|---|
| **New `churches`** | One row per church: name, short name, status (waiting / active / suspended), verified (for the later Porchway), created date. Phaneroo is number 1 |
| **New `church_settings`** | Everything in section 5: logo, colours, photo, time zone, country code, helplines, devotional source, and so on |
| **New `church_members`** | Who belongs where: person, church, role (member / admin), date joined, date left. Only one current church per person |
| **New `platform_owners`** | Your account(s) |
| `profiles` | Gets the person's current church. Name, team and bio stay as they are |
| `removed_members`, `legacy_members`, `roll` data | Removal is per church: removed from Phaneroo does not mean banned everywhere |

### D. Church content (every one gets a church tag)

| Area | Tables |
|---|---|
| **Feed** | `posts`, `comments`, `reactions`, `comment_reactions`, `comment_keeps`, `comment_actions`-related, `keeps`, `rhema_clip`, `previous_clip`, `item_sizes` |
| **Chat** | `conversations`, `conversation_pins`, `conversation_reads`, `conversation_signals`, `messages`, `message_hides`, `message_reactions`, `message_stars`, `message_sound`, `chat` tables |
| **Calls** | `call_peers`, `call_permissions`, `call_rings`, `call_signals`, `call_log`, `call_voice`, `line_rings` (only people in the same church may call each other) |
| **Groups** | `groups`, `group_members`, `group_notes`, `group_accounts`, `group_follows`, `group_marks`, `group_reports`, `group_studies`, `group_study_done` |
| **Offices** | `offices`, `office_threads`, `office_messages`, `office_files`, `office_pdfs`, `office_books`, `office_doors`, `office_removed`, `office_calendar`, `hoo_reports`, `hoo_decisions`, `hoo_writers`, `hoo_pages` |
| **Tour doors** | `my_twenty`, `mission_sms`-related (`mission_sends`, `mission_send_to`, `mission_reports`), `serve_forms`, `transport_events`, `transport_locations`, `transport_stages`, `transport_buses`, `transport_rides`, `transport_stops`, `pb_events`, `pb_event_rsvp`, `pb_event_travel`, `pb_hotels`, `pb_rooms`, `clinic_groups`, `clinic_questions`, `clinic_rounds`, `clinic_state`, `clinic_tags`, `clinic_videos`, `clinic_votes`, `prayer_track`, `trouble_reports` (complaints) |
| **Read shelf** | `porch_shelf`, `office_books`, shared reading documents, `bible_sites`, `bible_readings`/`bible_pieces` if they are church plans |
| **Devotional** | `devotion_voices`, `devotion_voice_settings`, `devotion_translations`, `devotional_translation` (each church may use a different devotional source) |
| **Radio** | `fm_tracks`, `fm_files`, `fm_programmes`, `fm_breaks`, `fm_break_heard`, `fm_live`, `fm_live_video`, `fm_mixer`, `fm_previews`, `fm_trash`, `fm_listen_hours`, `fm_requests`, `fm_request_pings`, `radio_usage`, `jingle_drafts`, `worship_songs` (see the radio question in section 9) |
| **Nuggets / PorchGuy** | `nuggets`, `nugget_settings`, `nugget_sources`, `nugget_speakers`, `nugget_favourites`, `porch_guy_usage`, `porch_guy_credit`, `porch_guy_asks`, `city_board`, `city_board_part` |
| **Looks and wording** | `porch_words`, `porch_ground`, `porch_header`, `porch_hide`, `porch_door`, `porch_wall`, `porch_carpet`, `porch_ceiling`, `porch_cloth`, `porch_cover`, `porch_cover_fly`, `porch_room_layout`, `button_sound`, `profile_faces` (shared face pictures), `porch_once`, `porch_flags`, `app_flags` (e.g. the manual card) |
| **Everything else** | `notifications`, `founder_notes` (becomes announcements), `manual_reads`, `presence` (who's on the porch), `previously` |

**Special care:** several tables have a "only one of these" rule built in. Examples: `porch_words` holds one wording per word, and `porch_ground` holds one porch photo. These become "one per church", otherwise church 2 would overwrite Phaneroo's photo.

---

## 5. Every Phaneroo-specific thing, and the church setting it becomes

Phaneroo's current values become its settings, so nothing changes for Phaneroo.

| What | Where it is today | Becomes |
|---|---|---|
| "Property of Phaneroo Ministries Mbarara" | Under every page, the welcome phone, the manual, account book and report book | **Church full name** |
| "Phaneroo" / "MBARARA" lettering | The reading sheet header, the manual's opening, the serve form | **Church name** and **branch / town** |
| Logo and butterfly mark (`mark.png`, the butterfly on books) | Header, book covers, icons | **Church logo**. The app icon stays Porchbook (see section 9) |
| Orange #f8a018 and green #90c840 | The rulebook and styles | **Church colours** ⚠️ This changes porchbook-state.md, see section 9 |
| The porch photograph, header photo, covers, door, wall and more | Already editable by the founder, but one per app | **Per church** (section 4, "looks") |
| Welcome wording, door names, room names and other words | Already editable through "Edit words", one set per app | **Per church wording**, with today's words as Phaneroo's |
| **The 8 offices** (Pastor, H.O.O, Administrator, H.O.F, Communications, Missions and outreach, Centre Coordination, Pastoral Support) and their sub-parts | Written into the code (`src/lib/porch/offices.ts`) | **Church office list**, which each church edits. Phaneroo starts with these 8 |
| Office phone line "0200998801" (+256 200 998801) | Offices page | **Church contact / help numbers** |
| **Daily devotional from phaneroo.org** (their website's devotional category, with its daily picture) | `devotion-page.server.ts` reads only phaneroo.org | **Devotional source**: none, a WordPress site and category, or typed in by admins. Phaneroo keeps phaneroo.org |
| Runyankore and Luganda translations (Phaneroo's own copy, else Sunbird machine translation) | Devotional reader and voice box | **Church languages**. Phaneroo: English, Runyankore, Luganda |
| "Apostle Grace Lubega" and "A Phaneroo pastor" | Clinic answers and Clinic PDFs, devotional voice sample | **Church leader's name** and **"our pastors" wording** |
| "Phaneroo is live now", Thursday and Sunday service labels | Radio / live YouTube announcement | **Church live label**, **service days** and **YouTube channel** |
| Notebook stamp "PHANEROO 123" (service numbers; older notes say "MasterClass") | Notebook | **Service-number label** (e.g. "Service", "Phaneroo") |
| **Kampala time** (fixed at UTC+3 in **17 files**, plus "Africa/Kampala" in others) | Devotional day, clinic months, radio schedule, events, transport, presence, clocks | **Church time zone**. This is the riskiest swap, see section 9 |
| "Uganda time" clock on the radio | Radio face | **Church time-zone name** |
| **Uganda +256** as the default phone code | My 20, serve form, transport | **Church default country code** |
| "From Uganda" / "abroad", "Coming from, e.g. Mbarara" | Event travel form | **Home country** and **example town** |
| "31st Night of Prayer" | My 20 heading and PDF, transport board | **Current My 20 event name** (admins change it each time) |
| **Manifest centres** | My 20 and the complaints helper | **Church centres list** (or turned off) |
| Transport divisions, pickup points, transport phone | Transport | Already data; becomes **per church** |
| "Global High School Grounds, Mbarara" induction venue | Serve form confirmation | **Serve induction venue** |
| "Payment to Phaneroo Ministries' account…" | Events | **Church payment note** |
| "e.g. Phaneroo Anniversary 2026" | Transport team form | Neutral example, e.g. "e.g. Church anniversary" |
| The user manual (5 short chapters) | Manual book | Platform manual plus a **church welcome chapter** |
| Privacy page | `/privacy` | Platform privacy page, plus **each church's contact** |
| PorchGuy and PorchWay (videos, events, voice) | `/porchguy`, `/city` | Content **per church**, or a platform feature (your call) |
| Radio station (programmes, jingles, storage bucket "porchbook-radio") | Radio | **Per church**, or shared (your call, section 9) |
| Site address `porchbook.vercel.app` used for links | Several server files | Platform setting (one address for all) |
| Android app `app.porch.team`, name "Porchbook" | Android folder (not touched) | Stays one app for all churches. Each church's logo shows inside it |
| "Phaneroo" in the AI helper's instructions | PorchGuy, clinic, nuggets (to check in each step) | **Church name** |

---

## 6. The steps, in a safe order

Each step is small, ends with something you can see or test, and is saved as its own undo point. **Phaneroo must look and behave exactly the same after every step.** We prove that by retaking the pictures (`node take-screens.mjs after`) and comparing them with `before/`.

### Step 0: Groundwork (no app changes for users)
- **Make the local database keep its data.** On your computer, everything is held in memory and wiped every time the app restarts. You can't test churches if they disappear. Easiest fix: let the local database save into a folder. This is a one-line, local-only change.
- **Write the two-church test** (section 7) so it's ready from the first real step.
- **Back up the live database** before *any* step goes live. Every step is first tried on a copy of the real data.

### Step 1: Add churches, put everyone in Phaneroo
- Add the `churches`, `church_settings`, `church_members` and `platform_owners` tables.
- Create Phaneroo as church 1, with today's values as its settings. Every existing account becomes a member of church 1.
- **Test:** the app looks identical (compare pictures), and every existing account shows up as a Phaneroo member.

### Step 2: Admins instead of the founder
- Phaneroo's founder becomes its first admin, and you become platform owner.
- Replace the founder checks, a few files at a time, with the two shared checks (section 3).
- Remove "first account becomes founder".
- **Test:** the admin sees every tool they saw before; a normal member sees none; a second admin can be added and gets the tools; the platform owner sees the platform tools.

### Step 3: Church tags, one area at a time
Do **one area per step**, in this order (simplest and most important first):
1. Feed (posts, comments, reactions)
2. Chat and calls
3. Groups
4. Offices
5. Tour doors (Events, Serve, Transport, My 20, Clinic, Pray, complaints)
6. Read shelf and shared reading
7. Devotional and translations
8. Radio, nuggets, PorchGuy
9. Looks and wording
10. Notifications, presence, announcements

For each area: add the tag, set every existing row to Phaneroo, make every read filter by the viewer's church and every save stamp it, then run the two-church test.

### Step 4: Move the hard-coded Phaneroo items into church settings
- Swap each item in section 5 for the church setting, a few at a time.
- **Test:** Phaneroo's pictures are identical, and a test church shows its own name, offices, time zone and phone code.

### Step 5: Joining, leaving and moving
- Each church gets **its own invite link or code** (the existing Invite page grows into this).
- Sign-up asks for a church invite code, or offers "start a new church".
- **Leave and join another** from the name menu. What moves and what stays is in section 9.
- **Test:** a person moves from church A to church B. Afterwards they see only B, and A's members no longer see them as a current member.

### Step 6: Creating a new church
- "Start a church porch" form: name, town, country, time zone and contact person. It goes to the platform owner to approve.
- Once approved, the person who asked becomes its first admin and gets a short setup guide (logo, photo, colours, offices, doors, devotional source).
- **Test:** create, approve and set up a church from start to finish.

### Step 7: Per-church looks on the phone
- The phone remembers looks (porch photo, covers, shelf) so they appear instantly. Those saved looks must be labelled per church, or a person who changes church would briefly see the old church's photo.
- The rulebook says the offline shell cache is `porch-shell-v1` and not to change it unless broken. Check that it holds no church-specific content. If it does, ask before touching it.

### Step 8: Platform owner page
- A simple page for you: churches waiting for approval, active churches, member counts, usage and costs, and suspending a church.

### Later: the Porchway (section 8)

---

## 7. How we test that one church can never see another church's data

### The two-church test (automatic, run after every step)
A script will set up:
- **Church A** with members Ann (admin) and Abe.
- **Church B** with member Ben.

In Church A it creates a post, a comment, a reaction, a chat message between Ann and Abe, a group, an office message, an event, a transport request, a My 20 list, a clinic question, a complaint, a shelf book and a notification.

Then, signed in as **Ben**, it checks that:
1. Ben's feed, chat list, groups, offices, people list, events, notifications and "who's on the porch" contain **nothing** from Church A.
2. **Guessing** doesn't work: opening Church A's post, group, conversation, person or office directly by its number or address is **refused**, not just hidden.
3. Ben **cannot** react to, reply to, message, call or invite anyone in Church A.
4. Ben's admin powers (once he is made admin of B) do **nothing** to Church A.
5. Church A's admin cannot see or change Church B's settings, looks or wording.

**Pass = zero leaks.** Any leak stops the step until it's fixed.

### A code check (automatic)
A small script that lists every database read or write touching a church table **without** a church filter. That list must be empty before a step is finished.

### Optional stronger lock, for later
The live database (Neon, which is Postgres) can enforce "only this church's rows" itself, even if the app has a mistake ("row-level security"). It's more complex to set up, so I'd add it once the steps above are done, as a second lock.

---

## 8. Leaving room for the Porchway (not built now)

So that adding a public side later is safe and easy:
- **Keep it in separate tables.** Public church-page posts go into their own tables (e.g. church pages, public posts, follows, public reactions and shares), **never** into today's private `posts` table with a "public" switch. That way a mistake in a switch can never make a private post public.
- **Following is not belonging.** A person belongs to one church porch but can follow many church pages. `church_members` and a future `follows` table stay separate.
- **Verification.** The `churches` table gets a "verified" mark from day one, set only by the platform owner.
- **Sharing.** A share from a public page into a private porch copies a link. It never moves private content out.
- **Moderation.** Public content needs reporting and take-down tools from the platform owner. Plan for this before launch.

---

## 9. Risks, open questions, and things you may have missed

### Questions for you or the creator
1. **The rulebook (porchbook-state.md) says the whole porch is fixed**: orange #f8a018, green #90c840, Fraunces and Source Sans 3, *the* porch photograph, a fixed set of doors. Per-church colours, photos and doors **break those rules**. ⚠️ My suggestion: the rulebook becomes "Phaneroo's look, and the default for new churches". Fonts, glass cards and layout stay the same everywhere, so Porchbook still feels like Porchbook, and only colours, logo, photo, doors and wording change per church. This needs your OK, and probably the creator's.
2. **Ownership.** Every page says "Property of Phaneroo Ministries Mbarara", and the code was written by your friend for them. Before Porchbook becomes a platform you run for other churches, agree in writing with the creator and with Phaneroo who owns what, and whether Phaneroo is happy to be church number one.
3. **The doors on the tour don't match the rulebook.** The rulebook lists a Feedback door. The app shows **Pray, My 20, Events, Radio, Serve, Transport, Groups, Offices, Clinic, Call** (see the `before/` pictures). The rulebook may be out of date. Worth checking with the creator before doors become per church.
4. **The radio:** one Porchbook radio for everyone, or a station per church? A station per church costs storage and setup for each. You could start shared and add per-church later.
5. **PorchGuy and PorchWay:** platform features (same for everyone) or per church?
6. **When someone moves church:** I suggest their posts, comments and messages **stay with the old church** (shown under their name as a former member), their personal notebook and Bible progress **go with them**, and their roles (admin, office head, group leader) **end**. Is that right?
7. **Can the platform owner read private messages?** I recommend **no**, even for you. It protects you and the churches. Complaints and reports would go to church admins first.

### Risks
- **Leaks between churches.** This is the biggest risk, because of the ~600 database places. Handled by small steps, the two-church test and the code check (section 7).
- **The live data.** Every step changes the real Phaneroo database. Always back up first, try it on a copy, and keep the undo points.
- **Time zones.** 17 files assume Uganda time (UTC+3) by adding 3 hours by hand. A church in another time zone would get the wrong devotional day, radio schedule and event times. This is fiddly and needs careful testing.
- **"Send to everyone" features.** Notifications, the radio, announcements and SMS (mission SMS) often go to *all* members. Each must become "all members **of this church**".
- **Background jobs.** The radio worker, nugget worker, Bible worker and the watchdog (`.github/workflows`) currently work for "the" porch. They'll need to loop over churches.
- **Costs grow per church.** AI (PorchGuy, translations), radio storage, file uploads, calls (porchbook-calls.onrender.com, which is outside this code) and texts. You'll need limits per church and a decision on who pays.
- **Calls run on outside services.** The calls relay and Firebase live outside this code. They must also only connect people in the same church. That may need the creator's help.
- **One Android app for all.** The installed app's name and icon will say Porchbook, not each church's name. Separate apps per church would be a big extra job.
- **Secrets in the database.** The radio storage keys are saved in the database today. They should be platform-owner only, ideally moved out of the database.
- **The calls script line** is in the rulebook but not in the code (already noted for the creator).
- **Spam churches.** Without approval, anyone could create fake churches. That's why the platform owner approves new ones (Step 6).
- **The law.** Uganda's Data Protection and Privacy Act (2019) applies to personal data. Once you host several churches' members, you are likely responsible for that data as the platform. Get advice before opening to other churches, and update the privacy page.
- **Children and safeguarding.** If young people use church porches, admins need reporting and blocking tools that work within their church.

### Size
This is a big change: probably **several weeks of careful work** in small steps, not days. The good news is that Phaneroo keeps working the whole time, because every step keeps it looking and behaving the same.
