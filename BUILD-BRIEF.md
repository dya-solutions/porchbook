# Porchbook build brief

Written 19 November 2026 with JT. This file is the agreed direction for JT's own version of Porchbook. Where it disagrees with PLAN-MULTI-CHURCH.md or porchbook-state.md, **this file wins**.

## 1. The idea in one paragraph

Any church (or ministry, gospel artist or organisation) creates its own **porch**: a private home where its members fellowship, message and call each other, and reach the church's offices. There is also a **public porch**, where porches post publicly and members of any porch can react. Phaneroo Mbarara is church number one.

## 2. Ground rules (unchanged)

- Work only on this computer with test data. **Never** connect to or change the creator's live Phaneroo database.
- **Free only.** Do not add any service that costs money. If something can't be done for free, stop and tell JT.
- Small stages. After each stage: save an undo point with git, update CHANGES.md in plain English, take "after" pictures where screens changed, run the two-church test, then **stop and wait for JT**.
- JT is not a software engineer: explain everything in plain words, give exact steps, prefer the simplest option that works.
- Hide features that are on hold (section 4). **Don't delete their code**, so they can come back later.

## 3. What we are building

### Every porch (private)
- **Feed** with the rooms Inspire, Inform and Inquire, the reactions Love, Like, Touching and Deep, plus reply, pin and lock.
- **Chat**: one-to-one messages and group chats. Office conversations also appear in Chat, marked "Office".
- **One-to-one voice and video calls**, only between members of the same porch.
- **On the porch now**: who is online, with a "Show me on the porch" switch. If you hide yourself, you can't see who else is online either (the rule the app already has).
- **Offices**: each church creates its own offices, picks each office's head and chooses which actions each office offers. Phaneroo starts with its current 8 offices and actions (Thank God with me, Contact the pastor, Appointments, Weekly programme, Accountability, Official). A member's requests show a status (for example Sent, Confirmed, Answered).
- **Tour doors**: Pray, My 20, Events, Groups, Serve, Transport, Feedback. Each church switches doors on or off. Offices is no longer a door; it has its own tab.
- **Read**: the Bible for everyone (free versions only for new churches), the church's own books, devotional text and PDFs, and each member's personal notebook.
- **People and profiles, groups, invite, notifications, Porchbook Lite, Dawn / Dusk / Night**.

### The public porch
- **Only porches post publicly.** A porch admin posts on behalf of the porch.
- Members of any porch can **follow** porches and **react** (Love, Like, Touching, Deep). No comments or replies on the public porch.
- Anyone who wants to post publicly must **start a porch** first. Porch types: Church, Ministry, Gospel artist, Organisation.
- A new porch must be **approved (verified) by the platform owner** before it can post publicly.
- Public posts live in **their own tables**, never in the private posts table with a "public" switch.
- Sharing a public post into a private porch shares a link. Private content never goes public automatically.

### Branches
- Every branch is a **full porch of its own**, with its own members, admins, offices and private feed.
- When a porch is created it can say "this is a branch" and ask to link to a main porch. **The main porch approves the link.**
- The main porch's public page lists its branches, and its public posts reach everyone who follows it.
- The main porch **cannot** see inside a branch's private porch, messages, offices or members. A branch can unlink at any time.

### People and roles
- **One account belongs to exactly one porch**, with a clean way to leave and join another. When someone moves: their posts and messages stay with the old porch, their notebook and Bible progress go with them, and their roles end.
- **Platform owner** (JT): approves porches and branch links, manages shared settings. **Cannot read private messages.**
- **Porch admins** (several per porch) replace today's single "founder". Remove the rule that the first account ever becomes founder.
- **Office heads** and **members** as today.

## 4. On hold (hide, don't delete)

Radio (studio, control room, jingles, nuggets, listening), PorchGuy (the AI helper), the PorchWay driving game (/city), group calls of any size (including open porch calls), the Clinic, the devotional voice (ElevenLabs, Azure or Google voices), machine translation (Sunbird), and anything else that costs money to run.

## 5. Calls

- Only **one-to-one** voice and video calls, phone to phone, between members of the same porch.
- Today's calls depend on the creator's own calls server (porchbook-calls.onrender.com), Firebase and a relay server. JT's version needs **its own free setup**. Before building calls, find the free option, explain it to JT in plain words and wait for his OK.

## 6. Look and design

- Follow the screens in the **design-reference** folder (one file per screen; read them as the picture of what to build). Screens: Welcome, My porch, Tour, Chat, Offices, Office of the Pastor, Talking to an office, Read, Public porch, Porch page with branches, Start a porch, Who is on the porch, Messaging a member, A voice call.
- **Navigation:** bottom bar with Porch, Tour, Offices, Read, Chat. A switch at the top of the Porch screen: "My porch" and "Public porch". Your own picture in the top bar opens your profile.
- **Keep everywhere:** the fonts Fraunces (titles) and Source Sans 3 (text), rounded cards, big tap areas (44 px or more), clear labels.
- **Drop:** heavy textures, 3D buttons, the crowded header.

### Themes
Each porch admin picks one theme in the porch settings. Only colours change; fonts and layout stay the same. Text must keep at least 4.5:1 contrast (these values pass).

| Theme | Background | Cards | Text | Quiet text | Main colour | Text on main colour | Second colour |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Porch Evening (default, Phaneroo) | #0E120F | #171D18 | #F4F1E8 | #A3AC9F | #F8A018 | #1A1205 | #90C840 |
| Royal Night | #0D1220 | #161D30 | #F2F0EA | #A6AEC4 | #E8B84A | #1A1405 | #8FA8FF |
| Morning Light (light theme) | #F6F3EA | #FFFFFF | #1D2219 | #5C6458 | #9E5400 | #FFFFFF | #4A7320 |
| Crimson Grace | #140E0F | #1E1617 | #F5EFEC | #B3A6A3 | #E5574E | #1A0706 | #F2C14E |
| Living Water | #0B1416 | #132125 | #EEF5F4 | #9DB2B1 | #3CC6C0 | #06201F | #F4A259 |
| Purple Praise | #120E18 | #1C1626 | #F3EFF8 | #ADA4BC | #B48CFF | #160C2A | #F5C451 |

Build the themes as one set of colour settings that every screen reads from, so adding a theme later means adding one row. Dawn / Dusk / Night still work on top of any theme.

## 7. Order of work (stop after each stage)

1. **Update the plan.** Rewrite PLAN-MULTI-CHURCH.md to match this brief, and hide the on-hold features.
2. **Foundation.** Plan steps 0–2: the local database keeps its data, the two-church test, the churches tables with Phaneroo as church 1, and admins instead of the founder. Skip anything already done and say so.
3. **Church tags, one area at a time:** feed, chat, people and "on the porch now", offices, tour doors, read shelf, notifications.
4. **Themes and the new design**, one screen at a time, following design-reference. Phaneroo uses Porch Evening.
5. **Joining, leaving and starting a porch**, with platform-owner approval.
6. **Public porch**: porch pages, following, public posts and reactions.
7. **Branches**: link requests, approval, branch list, unlinking.
8. **One-to-one calls** on a free setup (section 5).
9. **Porch stations** (future, after Stage 8): see section 9.

## 8. Decisions, 19 November

JT's answers to the questions raised after Stage 1. Where these differ from anything above, **these win**.

1. **Only church porches have members.** Ministry, Gospel artist and Organisation porches are public pages run by a small team of admins, with no private members. A person belongs to **one church porch** for fellowship, and can also be an **admin of a few non-church porches**.
2. **Porch photo and textures:** hide the old photo and texture settings (porch photo, header photo, covers, door, wall, carpet, ceiling, cloth and similar). Later, each porch gets just a **logo** and a **cover photo** for its public page.
3. **Keep** Rhemaclip, Edit words and button sounds. **Replace** the old Themes menu with the six themes (Stage 4).
4. **Dawn / Dusk / Night** becomes a gentle dimmer on every theme. **Night must never go nearly black**, on any theme.
5. **Hide The Message (MSG) and Amplified (AMPC) Bibles for everyone**, Phaneroo included, until JT confirms permission. Keep KJV and the other free versions.
6. **Going online, file storage and the call relay: not now.** Everything stays on JT's computer. Calls are handled in Stage 8.
7. **Ownership:** JT will sort it out with the creator.
8. **Rule for on-hold features:** any feature on hold (radio, PorchGuy, Clinic, group calls, devotional voice, machine translation) must get **church tags** and **pass the two-church test** before it is ever switched back on. Each switch in `src/lib/porch/on-hold.ts` carries the same note.
9. **Anyone can build a porch** (church, ministry, gospel artist, organisation). A person is a **member of only one porch: their church**. They can be an **admin of other non-church porches** they build.
10. **The public porch shows only posts from porches you follow.** Members can follow, unfollow and react, but **cannot post or comment** there.
11. **Every member automatically follows their own church's porch**, and its main church if it is a branch. They **can't unfollow their own church**.
12. **"Find porches":** a search to find porches to follow, by name, town or type. It never adds posts to your feed by itself; only following does.
13. **Public porch design:** `design-reference/Public.dc.html` was updated. The filter chips are replaced by "From the X porches you follow" and a **"Find porches"** button. Follow that version.

Decisions 9–13 belong to **Stage 6 (public porch)**.

## 9. Stage 9: Porch stations (future, after Stage 8)

Every porch can have its own radio station that its members tune into while they're on the porch. It reuses the on-hold radio code, which must first get church tags and pass the two-church test (decision 8).

### 9a. Playlist station (free)
- Porch admins upload or link sounds (sermons, choir recordings, jingles, announcements, songs) and arrange them into a schedule.
- No always-on radio server. Every member's app plays the same scheduled file at the same point in time, so everyone hears the same thing. Files are stored in Cloudflare R2, where listening is free.
- Low sound quality settings that still sound clear, and respect Porchbook Lite, to save members' mobile data.

### 9b. Live broadcasting (paid, with a monthly allowance per church)
- An approved person (an admin, or someone an admin chooses) can go live from their own phone or computer microphone. Members who tune in hear them live, and the playlist pauses until the broadcast ends.
- Needs a one-to-many audio streaming service (about $0.59 per 1,000 listener-minutes, e.g. Agora audience-only), or a self-hosted radio server. Each church gets a monthly allowance; the app stops new broadcasts when it is used up and never goes over it.

### Rules
- **Music copyright:** porches may only play what they have the right to (their own sermons and choir, and songs from artists who give permission, for example artist porches on Porchbook). Admins must confirm they have the rights when they upload a song.
- **Only approved people can go live.**
- **Each porch's station is private to its own members.**
