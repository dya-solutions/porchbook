// Stage 4f: the Porchbook FAQ (decision 23). One FAQ for every porch. Anyone can read it, signed
// in or not. Only the platform owner adds, edits, reorders or removes questions.
import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";

export type FaqItem = { id: number; section: string; question: string; answer: string; sort: number; check: boolean };

/** The starting questions. "check" marks answers JT should confirm (shown to the owner only). */
const START: { section: string; items: [question: string, answer: string, check?: boolean][] }[] = [
  {
    section: "Getting started",
    items: [
      ["What is Porchbook?", "Porchbook is your church on your phone. Your church has its own private porch for posts, offices and chat. The public porch shows posts from the churches and ministries you follow."],
      ["How do I join my church's porch?", "Ask your church for its invite code or link. Make your account and confirm your email with the code we send you. Then, on your home screen, type the code or paste the link under Find your church, and send a join request with your full name, phone number and city. Your church's admins look at it and let you in. A code alone never lets anyone in. A person belongs to one church.", true],
      ["What details does my church ask for, and why?", "Your full name, phone number and city. Each question says why: your name so your church family knows you, your phone so the church can reach you for care and urgent news, and your city so it can link you with a group near you. Porchbook no longer asks for your nation or address; the ones given before were deleted.", true],
      ["Can I use Porchbook without joining a church?", "Yes. With just an account you can use the public porch: find churches and ministries, follow them and react to their posts. You only join a church for its private porch. You can also start a church or a ministry porch from there.", true],
    ],
  },
  {
    section: "My porch",
    items: [
      ["What are Inspire, Inform and Inquire?", "They are the three rooms of your church's feed. Inspire is for encouragement and testimonies, Inform is for news and notices, and Inquire is for questions. Tap a room above the feed to see only its posts.", true],
      ["How do I post, react and reply?", "Tap \"Share with your porch…\", choose a room, write, and tap Post. Under a post, tap Love, Like, Touching or Deep to react, or Reply to answer. Your own posts have a \"⋯\" menu to pin, edit, lock replies or remove them."],
      ["Who can see what I post?", "Only the members of your own church. Posts on My porch never go to the public porch or to other churches."],
    ],
  },
  {
    section: "Offices",
    items: [
      ["What are offices?", "Offices are the parts of your church you can write to privately, like the Office of the Pastor. Each church sets up its own offices and chooses who heads each one."],
      ["How do I send a request to an office, and what do Sent, Confirmed and Answered mean?", "Open Offices, choose an office, then choose what you need (for example \"Contact the pastor\" or \"Book an appointment\") and write. Sent: it reached the office. Confirmed: the office has seen it. Answered: the office has replied. Your requests show on the office's page and in Chat."],
    ],
  },
  {
    section: "Chat and calls",
    items: [
      ["How do I message someone?", "Open Chat, tap the pen (New message) or search for the person, and write. You can message people in your own church. Messages are private between the two of you."],
      ["How do I call someone?", "Open your chat with them, or their profile, and tap the phone for a voice call or the camera for a video call. Calls work between members of the same church.", true],
      ["What does \"On the porch now\" mean, and how do I hide myself?", "It shows who in your church has Porchbook open right now. To hide, open your profile, then Your account → How you appear, and choose Hidden. While you're hidden, you can't see who else is here either."],
    ],
  },
  {
    section: "Public porch",
    items: [
      ["What is the public porch?", "A feed of posts from the churches and ministries you follow. It is coming soon.", true],
      ["How do I follow a porch?", "On the public porch, tap Find porches, search by name, town or type, and tap Follow. You always follow your own church, and its main church if it is a branch.", true],
      ["Why can't I post there?", "Only porches post on the public porch, through their admins, and only once Porchbook has approved them. Members follow and react, but don't post or comment, so it stays calm and safe."],
    ],
  },
  {
    section: "Privacy and account",
    items: [
      ["Who can see my details?", "Only you and your church's admins. Other members can't, other churches can't, and your details never appear on the public porch. They are deleted if you leave your church.", true],
      ["How do I change my details?", "Your account → My details. You can correct your full name, phone number and city, and change your username for the public porch.", true],
      ["How do I leave my church or move to another one?", "Your account → Leave this church. Porchbook tells you first what happens: your posts, comments and messages stay in that church's porch under your name; the details you gave it and your Serve form are deleted; any admin or office role there ends. Then you can join another church with its invite code.", true],
      ["How do I switch between light and dark?", "Open your profile, then Your account → Look, and choose Light or Dark. Dawn, Dusk and Night on the Tour page dim the screen gently."],
    ],
  },
  {
    section: "For ministries",
    items: [
      ["What is a ministry porch?", "A porch for a ministry: music, teaching, or another kind of ministry. It is run by a team of admins and has followers, not members. Its admins post for it on the public porch, and anyone can follow it. A church member can also be an admin of one or more ministries."],
      ["How do I act as my ministry?","If you run a ministry, tap your picture or the porch badge at the top and choose Continue as [your ministry]. A dark bar at the top shows that you're acting as the ministry. Tap Continue as me to come back. While you act as a ministry, your church's private porch is closed, so the two never mix."],
      ["How do I start a ministry porch?", "Your account → Start a porch (or Start a porch on the public porch). Choose Ministry, give its name and choose the country from the list. Then choose its type (Music, Teaching, or Other, and name it) and describe in a sentence or two what it does. Porchbook reads the description before approving it. You stay a member of your own church."],
    ],
  },
  {
    section: "For churches",
    items: [
      ["How do I start a porch for my church?", "Inside the app: Your account → Start a porch (or, if you're not in a church yet, Start a porch on the public porch). Choose Church, give its name, choose the country from the list, and say if it is a branch. You become its first member and admin, and you get an invite code to share. A person belongs to one church, so you can't start a church while you're a member of another."],
      ["How long does approval take?", "Porchbook checks every new porch by hand, usually within a few days. Until then your porch works privately for your members, but it can't post on the public porch.", true],
    ],
  },
];

/** Stage 5c made these true (joining by request, member details). */
const NOW_TRUE_5C: [question: string, answer: string][] = [
  [
    "How do I join my church's porch?",
    "Ask your church for its invite code or link. Make your account and confirm your email with the code we send you. Then send a join request with your full name, nation, phone number and address. Your church's admins look at it and let you in. A code alone never lets anyone in.",
  ],
  [
    "What details does my church ask for, and why?",
    "Your full name, nation, phone number and address. Each question says why: your name so your church family knows you, your nation so the church can welcome you well, your phone so the church can reach you, and your address for visits and nearby groups.",
  ],
  [
    "Who can see my phone number and address?",
    "Only you and your church's admins. Other members can't see them, and they never appear on the public porch. They are deleted if you leave your church.",
  ],
  [
    "How do I change my details?",
    "Open your profile (your picture at the top right), then Your account → My details. You can correct your full name, nation, phone number and address, and choose a username for the public porch.",
  ],
];

/** 26 November (decisions 38-46): church or ministry; Start a porch moves inside the app. */
const NOW_TRUE_26NOV: [question: string, oldAnswer: string, answer: string][] = [
  ["What is Porchbook?", "Porchbook is your church on your phone. Your church has its own private porch for posts, offices and chat. The public porch shows posts from the churches, ministries, psalmists and organisations you follow.", "Porchbook is your church on your phone. Your church has its own private porch for posts, offices and chat. The public porch shows posts from the churches and ministries you follow."],
  ["Can I use Porchbook without joining a church?", "Yes. With just an account you can use the public porch: find porches, follow them and react to their posts. You only join a church for its private porch.", "Yes. With just an account you can use the public porch: find churches and ministries, follow them and react to their posts. You only join a church for its private porch. You can also start a church or a ministry porch from there."],
  ["What is the public porch?", "A feed of posts from the porches you follow: churches, ministries, psalmists and organisations. It is coming soon.", "A feed of posts from the churches and ministries you follow. It is coming soon."],
  ["How do I start a porch for my church?", "On the Welcome screen tap Start a porch (or Your account → Start a porch). Choose Church, give its name, town and country, and say if it is a branch. You become its first member and admin, and you get an invite code to share.", "Inside the app: Your account → Start a porch (or, if you're not in a church yet, Start a porch on the public porch). Choose Church, give its name, choose the country from the list, and say if it is a branch. You become its first member and admin, and you get an invite code to share. A person belongs to one church, so you can't start a church while you're a member of another."],
];
const NEW_26NOV: [question: string, answer: string][] = [
  ["What is a ministry porch?", "A porch for a ministry: music, teaching, or another kind of ministry. It is run by a team of admins and has followers, not members. Its admins post for it on the public porch, and anyone can follow it. A church member can also be an admin of one or more ministries."],
  ["How do I start a ministry porch?", "Your account → Start a porch (or Start a porch on the public porch). Choose Ministry, give its name and choose the country from the list. Then choose its type (Music, Teaching, or Other, and name it) and describe in a sentence or two what it does. Porchbook reads the description before approving it. You stay a member of your own church."],
];

/** N2 and N3 (26 November): full name, phone and city; leaving a church; acting as a ministry. */
const NOW_TRUE_N2N3: [question: string, oldAnswers: string[], newQuestion: string, answer: string][] = [
  ["How do I join my church's porch?", ["Ask your church for its invite code or link. Open it, create your account, and send a join request with your details. Your church's admins look at your request and let you in. A code alone never lets anyone in: an admin always approves.","Ask your church for its invite code or link. Make your account and confirm your email with the code we send you. Then send a join request with your full name, nation, phone number and address. Your church's admins look at it and let you in. A code alone never lets anyone in."], "How do I join my church's porch?", "Ask your church for its invite code or link. Make your account and confirm your email with the code we send you. Then, on your home screen, type the code or paste the link under Find your church, and send a join request with your full name, phone number and city. Your church's admins look at it and let you in. A code alone never lets anyone in. A person belongs to one church."],
  ["What details does my church ask for, and why?", ["Your full name, nation, phone number and address. Your church uses them to know who you are, to reach you, and for care and visits. Each question says why it is asked. Only the admins allowed to see member details can see them.","Your full name, nation, phone number and address. Each question says why: your name so your church family knows you, your nation so the church can welcome you well, your phone so the church can reach you, and your address for visits and nearby groups."], "What details does my church ask for, and why?", "Your full name, phone number and city. Each question says why: your name so your church family knows you, your phone so the church can reach you for care and urgent news, and your city so it can link you with a group near you. Porchbook no longer asks for your nation or address; the ones given before were deleted."],
  ["Who can see my phone number and address?", ["Only you, and the admins of your church whose role allows them to see member details. Other members can't, and they never appear on the public porch. They are deleted if you leave your church.","Only you and your church's admins. Other members can't see them, and they never appear on the public porch. They are deleted if you leave your church."], "Who can see my details?", "Only you and your church's admins. Other members can't, other churches can't, and your details never appear on the public porch. They are deleted if you leave your church."],
  ["How do I change my details?", ["Tap your picture at the top right to open your profile, then Edit profile. You'll also be able to correct your phone number and address there once join requests arrive.","Open your profile (your picture at the top right), then Your account → My details. You can correct your full name, nation, phone number and address, and choose a username for the public porch."], "How do I change my details?", "Your account → My details. You can correct your full name, phone number and city, and change your username for the public porch."],
  ["How do I leave my church or move to another one?", ["This is coming soon. You'll be able to leave and send a join request to another church. Your old posts and messages stay with your old church; your notebook and Bible reading come with you."], "How do I leave my church or move to another one?", "Your account → Leave this church. Porchbook tells you first what happens: your posts, comments and messages stay in that church's porch under your name; the details you gave it and your Serve form are deleted; any admin or office role there ends. Then you can join another church with its invite code."],
];
const ACT_AS_QUESTION: [question: string, answer: string] = ["How do I act as my ministry?","If you run a ministry, tap your picture or the porch badge at the top and choose Continue as [your ministry]. A dark bar at the top shows that you're acting as the ministry. Tap Continue as me to come back. While you act as a ministry, your church's private porch is closed, so the two never mix."];

let ready: Promise<void> | null = null;
function ensure(sql: Sql) {
  ready ??= (async () => {
    await sql.query(`create table if not exists faq_items (
      id serial primary key,
      section text not null,
      question text not null,
      answer text not null,
      sort integer not null default 0,
      needs_check boolean not null default false,
      updated_at timestamptz not null default now()
    )`);
    const first = await sql.query<{ step: string }>("insert into porch_steps (step) values ('faq-start-v1') on conflict do nothing returning step");
    if (first.length) {
      let sort = 0;
      for (const block of START) {
        for (const [question, answer, check] of block.items) {
          sort += 10;
          await sql.query("insert into faq_items (section, question, answer, sort, needs_check) values ($1, $2, $3, $4, $5)", [block.section, question, answer, sort, Boolean(check)]);
        }
      }
    }
    // Stage 5c: answers that are now true. Only answers still waiting for JT's check change, so
    // anything JT has already edited stays as JT wrote it.
    const later = await sql.query<{ step: string }>("insert into porch_steps (step) values ('faq-5c-v1') on conflict do nothing returning step");
    if (later.length) {
      for (const [question, answer] of NOW_TRUE_5C) {
        await sql.query("update faq_items set answer = $2, needs_check = false, updated_at = now() where question = $1 and needs_check", [question, answer]);
      }
    }
    // 26 November: changed answers (only where JT hasn't edited them) and the two ministry questions.
    const nov26 = await sql.query<{ step: string }>("insert into porch_steps (step) values ('faq-26nov-v1') on conflict do nothing returning step");
    if (nov26.length) {
      for (const [question, oldAnswer, answer] of NOW_TRUE_26NOV) {
        await sql.query("update faq_items set answer = $3, updated_at = now() where question = $1 and answer = $2", [question, oldAnswer, answer]);
      }
      const top = await sql.query<{ sort: number | null }>("select min(sort) as sort from faq_items where section = 'For churches'");
      let sort = Number(top[0]?.sort ?? 1000) - 2;
      for (const [question, answer] of NEW_26NOV) {
        const there = await sql.query("select 1 from faq_items where question = $1", [question]);
        if (!there.length) await sql.query("insert into faq_items (section, question, answer, sort, needs_check) values ('For ministries', $1, $2, $3, false)", [question, answer, sort]);
        sort += 1;
      }
    }
    // N2 and N3: changed answers (only where JT hasn't edited them), and acting as a ministry.
    const n2n3 = await sql.query<{ step: string }>("insert into porch_steps (step) values ('faq-n2n3-v1') on conflict do nothing returning step");
    if (n2n3.length) {
      for (const [question, oldAnswers, newQuestion, answer] of NOW_TRUE_N2N3) {
        await sql.query("update faq_items set question = $3, answer = $4, needs_check = false, updated_at = now() where question = $1 and answer = any($2::text[])", [question, oldAnswers, newQuestion, answer]);
      }
      const [question, answer] = ACT_AS_QUESTION;
      const there = await sql.query("select 1 from faq_items where question = $1", [question]);
      const last = await sql.query<{ sort: number | null }>("select max(sort) as sort from faq_items where section = 'For ministries'");
      if (!there.length) await sql.query("insert into faq_items (section, question, answer, sort, needs_check) values ('For ministries', $1, $2, $3, false)", [question, answer, Number(last[0]?.sort ?? 1000) + 1]);
    }
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

function rows(list: { id: number; section: string; question: string; answer: string; sort: number; needs_check: unknown }[], owner: boolean): FaqItem[] {
  return list.map((row) => ({
    id: Number(row.id),
    section: row.section,
    question: row.question,
    answer: row.answer,
    sort: Number(row.sort),
    check: owner && (row.needs_check === true || row.needs_check === "t"),
  }));
}

/** Anyone, signed in or not, reads the FAQ. */
export const loadFaq = createServerFn({ method: "POST" }).handler(async () => {
  const sql = await getSql();
  await ensure(sql);
  const list = await sql.query<{ id: number; section: string; question: string; answer: string; sort: number; needs_check: unknown }>(
    "select id, section, question, answer, sort, needs_check from faq_items order by sort, id",
  );
  return rows(list, false);
});

async function isOwner(sql: Sql, userId: string) {
  const me = await sql.query<{ owner: unknown }>("select is_platform_owner($1) as owner", [userId]);
  return me[0]?.owner === true || me[0]?.owner === "t";
}

/** The owner's view: the same FAQ, with the answers marked for checking. */
export const loadFaqForOwner = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensure(sql);
    const owner = await isOwner(sql, context.userId);
    const list = await sql.query<{ id: number; section: string; question: string; answer: string; sort: number; needs_check: unknown }>(
      "select id, section, question, answer, sort, needs_check from faq_items order by sort, id",
    );
    return { owner, items: rows(list, owner) };
  });

function clip(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** The owner adds, changes, moves or removes a question. */
export const editFaq = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const action = raw.action === "add" || raw.action === "save" || raw.action === "remove" || raw.action === "up" || raw.action === "down" ? raw.action : null;
    return {
      action,
      id: Number(raw.id) || 0,
      section: clip(raw.section, 60),
      question: clip(raw.question, 200),
      answer: clip(raw.answer, 1200),
      checked: raw.checked === true,
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.action) return { ok: false as const, error: "Nothing to do." };
    const sql = await getSql();
    await ensure(sql);
    if (!(await isOwner(sql, context.userId))) {
      noteAttempt(context.userId, "faq-edit", "Tried to change the FAQ.");
      return { ok: false as const, error: "Only the platform owner can change the FAQ." };
    }
    if (data.action === "remove") {
      await sql.query("delete from faq_items where id = $1", [data.id]);
      return { ok: true as const };
    }
    if (data.action === "up" || data.action === "down") {
      const list = await sql.query<{ id: number; sort: number }>("select id, sort from faq_items order by sort, id");
      const at = list.findIndex((row) => Number(row.id) === data.id);
      const to = data.action === "up" ? at - 1 : at + 1;
      if (at < 0 || to < 0 || to >= list.length) return { ok: true as const };
      const a = list[at];
      const b = list[to];
      await sql.query("update faq_items set sort = $2 where id = $1", [a.id, b.sort]);
      await sql.query("update faq_items set sort = $2 where id = $1", [b.id, a.sort === b.sort ? a.sort + (data.action === "up" ? 1 : -1) : a.sort]);
      return { ok: true as const };
    }
    if (!data.section || !data.question || !data.answer) return { ok: false as const, error: "Write the section, the question and its answer." };
    if (data.action === "add") {
      const last = await sql.query<{ sort: number }>("select coalesce(max(sort), 0) as sort from faq_items where section = $1", [data.section]);
      const any = await sql.query<{ sort: number }>("select coalesce(max(sort), 0) as sort from faq_items");
      const sort = (Number(last[0]?.sort) || Number(any[0]?.sort) || 0) + 5;
      await sql.query("insert into faq_items (section, question, answer, sort) values ($1, $2, $3, $4)", [data.section, data.question, data.answer, sort]);
      return { ok: true as const };
    }
    await sql.query(
      "update faq_items set section = $2, question = $3, answer = $4, needs_check = needs_check and not $5, updated_at = now() where id = $1",
      [data.id, data.section, data.question, data.answer, data.checked],
    );
    return { ok: true as const };
  });
