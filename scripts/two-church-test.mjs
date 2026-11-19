#!/usr/bin/env node
/**
 * The two-church test (BUILD-BRIEF.md, PLAN-MULTI-CHURCH.md section 8).
 *
 * Run it from the porchbook folder:   node scripts/two-church-test.mjs
 *
 * It starts its OWN copy of the app on http://localhost:8090 with a brand-new, throw-away
 * database (your normal app on 8080 and its data are never touched), then:
 *   - checks the foundation: Phaneroo is porch 1, new accounts join it, nobody becomes
 *     admin just by signing up first, admins and the platform owner work as planned;
 *   - sets up Porch A (Ann the admin, and Abe) and Porch B (Ben), and checks that Ben
 *     can't see or reach anything of Porch A's.
 *
 * Each isolation check belongs to an area (feed, chat, people...). Areas are made private
 * one at a time in Stage 3. Until an area is listed in AREAS_DONE, a leak there is reported
 * as "not private yet" instead of failing the test.
 */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(ROOT, "package.json"));
const { chromium } = require("playwright");

/** Areas already made private (Stage 3 adds to this list, one area at a time). */
const AREAS_DONE = ["feed", "people", "chat", "groups", "presence", "calls"];

const PORT = 8090;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = `.test-db-${Date.now()}`;
const PASSWORD = "Two-church-test-1";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(kind, area, name, pass, detail = "") {
  results.push({ kind, area, name, pass, detail });
  const mark = pass ? "PASS" : kind === "isolation" && !AREAS_DONE.includes(area) ? "NOT PRIVATE YET" : "FAIL";
  console.log(`  [${mark}] ${name}${detail ? ` (${detail})` : ""}`);
}

// ---- Start a separate copy of the app with a throw-away database ----
console.log(`Starting a separate test copy of Porchbook on ${BASE} (throw-away database ${DB})…`);
const server = spawn(
  process.execPath,
  [join(ROOT, "scripts", "with-app-env.mjs"), process.execPath, join(ROOT, "node_modules", "vite", "bin", "vite.js"), "dev", "--host", "127.0.0.1", "--port", String(PORT)],
  {
    cwd: ROOT,
    env: { ...process.env, PORCH_TEST_MODE: "1", PORCH_LOCAL_DB: DB, BETTER_AUTH_URL: BASE, DATABASE_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

let browser;
async function finish(code) {
  await browser?.close().catch(() => {});
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
  else server.kill("SIGTERM");
  await wait(1500);
  try {
    rmSync(join(ROOT, DB), { recursive: true, force: true });
  } catch {
    /* the folder is ignored by git; it can be deleted by hand */
  }
  process.exit(code);
}

async function up() {
  for (let i = 0; i < 180; i += 1) {
    const ok = await fetch(`${BASE}/api/build`).then((r) => r.ok).catch(() => false);
    if (ok) return true;
    await wait(1000);
  }
  return false;
}

async function helper(action, extra = {}) {
  const res = await fetch(`${BASE}/api/porch-test`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  return res.json();
}

/** A signed-in person, calling the app's own server functions from a page, like the app does. */
async function person(name, email) {
  await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: BASE },
    body: JSON.stringify({ name, email, password: PASSWORD }),
  });
  const context = await browser.newContext();
  const res = await context.request.post(`${BASE}/api/auth/sign-in/email`, { headers: { Origin: BASE }, data: { email, password: PASSWORD } });
  const userId = (await res.json().catch(() => ({})))?.user?.id ?? "";
  const page = await context.newPage();
  await page.goto(`${BASE}/privacy`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const seed = { displayName: name, email, imageUrl: null };
  /** Call `fn` from a module, e.g. call("lib/porch/api.ts", "getFeed", {...}) */
  const call = (file, fn, data = {}) =>
    page.evaluate(
      async ({ file, fn, data }) => {
        const mod = await import(`/src/${file}`);
        return mod[fn]({ data });
      },
      { file, fn, data: { ...seed, ...data } },
    );
  // Opening the feed once creates the person's profile, as the app does.
  await call("lib/porch/api.ts", "getFeed", { filter: "all" });
  return { name, email, userId, call };
}

try {
  if (!(await up())) {
    console.log("The test copy of the app did not start. Its last messages:\n" + serverLog.slice(-3000));
    await finish(2);
  }
  browser = await chromium.launch({ channel: "msedge" }).catch(() => chromium.launch({ channel: "chrome" }));

  // ---------------- Foundation (Stage 2) ----------------
  console.log("\nFoundation");
  const phaneroo = (await helper("porch", { porchId: 1 })).porch;
  record("foundation", "porches", "Phaneroo Ministries Mbarara is porch 1, a church, approved", phaneroo?.name === "Phaneroo Ministries Mbarara" && phaneroo?.kind === "church" && phaneroo?.status === "approved");

  const ann = await person("Ann Admin", "ann@two-church.test"); // the very first account in this database
  const annState = await helper("person", { email: ann.email });
  record("foundation", "porches", "A new account joins Phaneroo (porch 1)", annState.porch_id === 1, `porch ${annState.porch_id}`);
  record("foundation", "admins", "The first account ever is NOT made admin automatically", annState.admin === false);
  const annDesk = await ann.call("lib/porch/api.ts", "founderDesk");
  record("foundation", "admins", "…and the app gives them no admin tools", annDesk?.isFounder === false);

  const kinds = ["church", "ministry", "gospel_artist", "organisation"];
  const made = [];
  for (const kind of kinds) made.push(await helper("createPorch", { name: `Test ${kind}`, kind }));
  record("foundation", "porches", "All four porch types can be created", made.every((m) => m.ok));
  const wrong = await helper("createPorch", { name: "Bad", kind: "club" });
  record("foundation", "porches", "Any other porch type is refused", wrong.ok === false);

  const porchA = (await helper("createPorch", { name: "Porch A", kind: "church" })).id;
  const porchB = (await helper("createPorch", { name: "Porch B", kind: "church" })).id;
  const abe = await person("Abe Member", "abe@two-church.test");
  const ben = await person("Ben Other", "ben@two-church.test");
  for (const p of [ann, abe]) await helper("joinPorch", { email: p.email, porchId: porchA });
  await helper("joinPorch", { email: ben.email, porchId: porchB });
  await helper("makeAdmin", { email: ann.email, porchId: porchA });

  const annNow = await ann.call("lib/porch/api.ts", "founderDesk");
  record("foundation", "admins", "Making Ann admin of Porch A gives her the admin tools", annNow?.isFounder === true);
  const abeDesk = await abe.call("lib/porch/api.ts", "founderDesk");
  record("foundation", "admins", "Abe (a member of Porch A) has no admin tools", abeDesk?.isFounder === false);

  await helper("makeAdmin", { email: ben.email, porchId: porchA });
  const benDesk = await ben.call("lib/porch/api.ts", "founderDesk");
  record("foundation", "admins", "Being listed as admin of a porch you don't belong to gives no admin tools", benDesk?.isFounder === false);

  const annStorage = await ann.call("lib/porch/storage-settings.ts", "storageInfo");
  record("foundation", "owners", "A porch admin is not a platform owner (shared settings stay closed)", annStorage?.ok === false);
  const olive = await person("Olive Owner", "olive@two-church.test");
  await helper("makeOwner", { email: olive.email });
  const oliveStorage = await olive.call("lib/porch/storage-settings.ts", "storageInfo");
  record("foundation", "owners", "The platform owner can open the shared settings", oliveStorage?.ok === true);
  const oliveDesk = await olive.call("lib/porch/api.ts", "founderDesk");
  record("foundation", "owners", "Being platform owner does not make you a porch admin", oliveDesk?.isFounder === false);

  // ---------------- Isolation (made private in Stage 3) ----------------
  console.log("\nIsolation between Porch A and Porch B");
  const posted = await ann.call("lib/porch/api.ts", "createPost", { room: "proclaim", body: "A private post in Porch A" });
  record("sanity", "feed", "Ann can post in Porch A", posted?.ok === true);

  const abeFeed = await abe.call("lib/porch/api.ts", "getFeed", { filter: "all" });
  const inFeed = (feed) => JSON.stringify(feed ?? {}).includes("A private post in Porch A");
  record("sanity", "feed", "Abe (same porch) sees Ann's post", inFeed(abeFeed));
  const postId = (abeFeed?.posts ?? []).find((p) => p.body === "A private post in Porch A")?.id;

  const benFeed = await ben.call("lib/porch/api.ts", "getFeed", { filter: "all" });
  record("isolation", "feed", "Ben's feed does not show Porch A's post", !inFeed(benFeed));
  if (postId) {
    const one = await ben.call("lib/porch/api.ts", "getOnePost", { postId });
    record("isolation", "feed", "Ben can't open Porch A's post directly by its number", one?.ok !== true);
  }

  const benPeople = await ben.call("lib/porch/api.ts", "listPeople");
  record("isolation", "people", "Ben's people list does not show Ann", !JSON.stringify(benPeople ?? {}).includes("Ann Admin"));
  const benSees = await ben.call("lib/porch/api.ts", "getPerson", { userId: ann.userId });
  record("isolation", "people", "Ben can't open Ann's profile", !JSON.stringify(benSees ?? {}).includes("Ann Admin"));

  await helper("makeAdmin", { email: ben.email, porchId: porchB }); // Ben runs Porch B, so his admin tools are tested too
  const benRoll = await ben.call("lib/porch/roll.ts", "listRoll");
  record("isolation", "people", "Ben's roll (as Porch B's admin) does not list Ann", !JSON.stringify(benRoll ?? {}).includes("Ann Admin"));

  // ---- Feed: Ben must be refused, not just kept from seeing ----
  const abeReply = await abe.call("lib/porch/api.ts", "addComment", { postId, body: "Amen from Abe" });
  record("sanity", "feed", "Abe (same porch) can reply to Ann's post", abeReply?.ok === true);
  const afterAbe = await abe.call("lib/porch/api.ts", "getFeed", { filter: "all" });
  const annPost = (afterAbe?.posts ?? []).find((p) => p.id === postId);
  const abeCommentId = annPost?.comments?.find((c) => (c.body ?? "").includes("Amen from Abe"))?.id;

  const benReact = await ben.call("lib/porch/api.ts", "setReaction", { postId, kind: "care" });
  record("isolation", "feed", "Ben is refused when he reacts to Porch A's post", benReact?.ok === false);
  const benReply = await ben.call("lib/porch/api.ts", "addComment", { postId, body: "Reply from Porch B" });
  record("isolation", "feed", "Ben is refused when he replies to Porch A's post", benReply?.ok === false);
  const benKeep = await ben.call("lib/porch/api.ts", "toggleKeep", { postId });
  record("isolation", "feed", "Ben is refused when he keeps Porch A's post", benKeep?.ok === false);
  if (abeCommentId) {
    const benCommentReact = await ben.call("lib/porch/api.ts", "setCommentReaction", { commentId: abeCommentId, kind: "care" });
    record("isolation", "feed", "Ben is refused when he reacts to a reply in Porch A", benCommentReact?.ok === false);
  }
  const askBen = await ann.call("lib/porch/api.ts", "createPost", { room: "ask", body: "A question for Ben", askedTo: ben.userId });
  const benFeedAgain = await ben.call("lib/porch/api.ts", "getFeed", { filter: "all" });
  record("isolation", "feed", "Ann can't send a question to Ben in another porch", askBen?.ok === false && !JSON.stringify(benFeedAgain ?? {}).includes("A question for Ben"));
  const finalPost = ((await abe.call("lib/porch/api.ts", "getFeed", { filter: "all" }))?.posts ?? []).find((p) => p.id === postId);
  const leftovers = JSON.stringify(finalPost ?? {});
  record("isolation", "feed", "Nothing of Ben's reached Porch A's post (no reply, no reaction)", Boolean(finalPost) && !leftovers.includes("Reply from Porch B") && !leftovers.includes(ben.userId));

  // ---- Chat (one-to-one) ----
  const annToAbe = await ann.call("lib/porch/api.ts", "sendMessage", { userId: abe.userId, body: "Private chat inside Porch A" });
  record("sanity", "chat", "Ann can message Abe (same porch)", annToAbe?.ok === true);
  const sent = await ben.call("lib/porch/api.ts", "sendMessage", { userId: ann.userId, body: "Hello from Porch B" });
  record("isolation", "chat", "Ben is refused when he messages Ann", sent?.ok === false);
  const benThreads = await ben.call("lib/porch/api.ts", "listThreads");
  record("isolation", "chat", "Ben's chat list shows nothing from Porch A", !JSON.stringify(benThreads ?? {}).match(/Ann Admin|Abe Member|Private chat inside Porch A/));
  const benOpensAnn = await ben.call("lib/porch/api.ts", "getThread", { userId: ann.userId });
  record("isolation", "chat", "Ben is refused when he opens a conversation with Ann", benOpensAnn?.profile === null);
  const abeThread = await abe.call("lib/porch/api.ts", "getThread", { userId: ann.userId });
  const annMessageId = (abeThread?.messages ?? []).find((m) => m.body === "Private chat inside Porch A")?.id;
  if (annMessageId) {
    const benReactsMsg = await ben.call("lib/porch/chat.ts", "reactMessage", { messageId: annMessageId, emoji: "🙏" });
    record("isolation", "chat", "Ben is refused when he reacts to a Porch A message", benReactsMsg?.ok === false);
  }

  // ---- Group chats ----
  const group = await ann.call("lib/porch/groups.ts", "startGroup", { name: "Porch A prayer group", purpose: "Praying together" });
  record("sanity", "groups", "Ann can start a group in Porch A", group?.ok === true);
  if (group?.id) {
    const note = await ann.call("lib/porch/groups.ts", "addGroupNote", { groupId: group.id, body: "Group chat inside Porch A" });
    record("sanity", "groups", "Ann can write in her group", note?.ok === true);
    const benGroup = await ben.call("lib/porch/groups.ts", "getGroup", { id: group.id });
    record("isolation", "groups", "Ben is refused when he opens Porch A's group", benGroup === null);
    const benPlain = await ben.call("lib/porch/groups.ts", "openPlainGroup", { id: group.id });
    record("isolation", "groups", "Ben is refused the group page too", !JSON.stringify(benPlain ?? {}).includes("Porch A prayer group"));
    const benNote = await ben.call("lib/porch/groups.ts", "addGroupNote", { groupId: group.id, body: "Group note from Porch B" });
    record("isolation", "groups", "Ben is refused when he writes in Porch A's group", benNote?.ok === false);
    const benJoin = await ben.call("lib/porch/groups.ts", "joinGroup", { id: group.id });
    record("isolation", "groups", "Ben is refused when he joins Porch A's group", benJoin?.ok === false);
    const benBrowse = await ben.call("lib/porch/groups.ts", "browseGroups");
    record("isolation", "groups", "Ben's group list doesn't show Porch A's group", !JSON.stringify(benBrowse ?? {}).includes("Porch A prayer group"));
    const addBen = await ann.call("lib/porch/groups.ts", "addToGroup", { groupId: group.id, userId: ben.userId });
    record("isolation", "groups", "Ann can't add Ben (another porch) to her group", addBen?.ok === false);
  }

  // ---- On the porch now ----
  await ann.call("lib/porch/presence.ts", "setPresence", { status: "online" });
  await abe.call("lib/porch/presence.ts", "setPresence", { status: "online" });
  const benPorch = await ben.call("lib/porch/presence.ts", "setPresence", { status: "online" });
  record("isolation", "presence", "Ben's \"on the porch now\" doesn't show Ann or Abe", !JSON.stringify(benPorch ?? {}).match(/Ann Admin|Abe Member/));
  const abePorch = await abe.call("lib/porch/presence.ts", "setPresence", { status: "online" });
  record("sanity", "presence", "Abe sees Ann on the porch (same porch)", JSON.stringify(abePorch ?? {}).includes("Ann Admin"));

  // ---- One-to-one calls ----
  const benCalls = await ben.call("lib/porch/groups.ts", "openPersonCall", { userId: ann.userId });
  record("isolation", "calls", "Ben is refused when he calls Ann", benCalls?.ok === false);
  const benRings = await ben.call("lib/porch/call-ask.ts", "ringPerson", { userId: ann.userId, video: false });
  record("isolation", "calls", "Ben is refused when he rings Ann", benRings?.ok === false);
  const benAsks = await ben.call("lib/porch/call-ask.ts", "askToCall", { userId: ann.userId });
  record("isolation", "calls", "Ben is refused when he asks to call Ann", benAsks?.ok === false);
  const benOffline = await ben.call("lib/porch/line-ring.ts", "ringOffline", { to: ann.userId });
  record("isolation", "calls", "Ben is refused when he rings Ann's phone", benOffline?.ok === false);
  const abeCalls = await abe.call("lib/porch/groups.ts", "openPersonCall", { userId: ann.userId });
  record("sanity", "calls", "Abe can call Ann (same porch)", abeCalls?.ok === true);

  // ---------------- Summary ----------------
  const failed = results.filter((r) => !r.pass && (r.kind !== "isolation" || AREAS_DONE.includes(r.area)));
  const notYet = results.filter((r) => !r.pass && r.kind === "isolation" && !AREAS_DONE.includes(r.area));
  const passed = results.filter((r) => r.pass);
  console.log(`\nResult: ${passed.length} passed, ${failed.length} failed, ${notYet.length} not private yet (areas waiting for Stage 3: ${[...new Set(notYet.map((r) => r.area))].join(", ") || "none"}).`);
  console.log(failed.length ? "TWO-CHURCH TEST: FAILED" : "TWO-CHURCH TEST: OK for this stage");
  await finish(failed.length ? 1 : 0);
} catch (error) {
  console.error("The test stopped with an error:", error);
  console.log(serverLog.slice(-2000));
  await finish(2);
}
