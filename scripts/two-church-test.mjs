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
const AREAS_DONE = ["details", "accounts", "joining", "starting", "approval", "feed", "people", "chat", "groups", "presence", "calls", "offices", "events", "serve", "transport", "my20", "pray", "feedback", "read", "notifications", "settings"];

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
/** Stage 5c: confirm a test person's email (the test app shows the code instead of emailing it). */
async function verify(p) {
  const sent = await p.call("lib/porch/membership.ts", "sendEmailCode");
  return p.call("lib/porch/membership.ts", "verifyEmailCode", { code: sent?.testCode });
}

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
  record("foundation", "joining", "A new account joins no church by itself (no more \"everyone joins Phaneroo\")", annState.porch_id === null || annState.porch_id === undefined, `porch ${annState.porch_id}`);
  const wrongCode = await ann.call("lib/porch/porch-join.ts", "joinWithCode", { code: "NOT-A-CODE" });
  record("foundation", "joining", "A wrong invite code joins nothing", wrongCode?.ok === false);
  const phanerooCode = (await helper("porchInfo", { name: "Phaneroo Ministries Mbarara" })).porch?.invite_code;
  const oldName = await ann.call("lib/porch/porch-join.ts", "checkInvite", { code: "PHANEROO-MBARARA" });
  record("foundation", "joining", "Invite codes are random (no more name codes like PHANEROO-MBARARA)", /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(phanerooCode ?? "") && oldName?.ok === false, phanerooCode);
  const annJoins = await ann.call("lib/porch/porch-join.ts", "joinWithCode", { code: phanerooCode?.toLowerCase() });
  const annAfterCode = await helper("person", { email: ann.email });
  record("foundation", "joining", "Phaneroo's invite code alone doesn't let Ann in (it only opens a join request)", annJoins?.ok === false && annJoins?.needsRequest === true && (annAfterCode.porch_id === null || annAfterCode.porch_id === undefined));
  await helper("joinPorch", { email: ann.email, porchId: 1 });
  record("foundation", "admins", "The first account ever is NOT made admin automatically", annState.admin === false);
  const annDesk = await ann.call("lib/porch/api.ts", "founderDesk");
  record("foundation", "admins", "…and the app gives them no admin tools", annDesk?.isFounder === false);

  const kinds = ["church", "ministry"];
  const made = [];
  for (const kind of kinds) made.push(await helper("createPorch", { name: `Test ${kind}`, kind }));
  record("foundation", "porches", "Both porch types (Church, Ministry) can be created", made.every((m) => m.ok));
  const wrong = await helper("createPorch", { name: "Bad", kind: "club" });
  const gone = await Promise.all(["psalmist", "organisation"].map((kind) => helper("createPorch", { name: `Old ${kind}`, kind })));
  record("foundation", "porches", "Any other porch type is refused (Psalmist and Organisation are gone)", wrong.ok === false && gone.every((g) => g.ok === false));

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
  await helper("joinPorch", { email: olive.email, porchId: 1 });
  await helper("makeOwner", { email: olive.email });
  const oliveStorage = await olive.call("lib/porch/storage-settings.ts", "storageInfo");
  record("foundation", "owners", "The platform owner can open the shared settings", oliveStorage?.ok === true);
  const oliveDesk = await olive.call("lib/porch/api.ts", "founderDesk");
  record("foundation", "owners", "Being platform owner does not make you a porch admin", oliveDesk?.isFounder === false);

  const has = (value, text) => JSON.stringify(value ?? {}).includes(text);
  // ---------------- Joining and starting a porch (Stage 5a) ----------------
  console.log("\nJoining and starting a porch");
  await helper("makeAdmin", { email: ben.email, porchId: porchB }); // Ben runs Porch B
  const codeA = (await helper("porchInfo", { name: "Porch A" })).porch?.invite_code;
  const codeB = (await helper("porchInfo", { name: "Porch B" })).porch?.invite_code;
  const checkA = await ann.call("lib/porch/porch-join.ts", "checkInvite", { code: codeA });
  record("sanity", "joining", "An invite code shows which church it belongs to", checkA?.ok === true && checkA?.name === "Porch A");
  const cara = await person("Cara New", "cara@two-church.test");
  const caraUnverified = await cara.call("lib/porch/membership.ts", "requestToJoin", { code: codeB, fullName: "Cara New", phone: "+256700000010", city: "Gulu" });
  record("sanity", "joining", "Someone who hasn't confirmed their email can't send a join request", caraUnverified?.ok === false);
  const caraWrong = await cara.call("lib/porch/membership.ts", "verifyEmailCode", { code: "000000" });
  const caraVerified = await verify(cara);
  record("sanity", "joining", "A wrong email code is refused; the right one confirms the email", caraWrong?.ok === false && caraVerified?.ok === true);
  const caraAsks = await cara.call("lib/porch/membership.ts", "requestToJoin", { code: codeB, fullName: "Cara New", phone: "+256700000010", city: "Gulu" });
  const caraBefore = await helper("person", { email: cara.email });
  record("sanity", "joining", "Cara's request to Porch B doesn't let her in by itself", caraAsks?.ok === true && (caraBefore.porch_id === null || caraBefore.porch_id === undefined));
  const benWaiting = await ben.call("lib/porch/membership.ts", "waitingToJoin");
  const caraRequest = (benWaiting?.people ?? []).find((p) => p.fullName === "Cara New");
  await ben.call("lib/porch/membership.ts", "decideJoinRequest", { id: caraRequest?.id, letIn: true });
  const caraState = await helper("person", { email: cara.email });
  record("sanity", "joining", "Ben (B's admin) lets Cara in: she's a member of Porch B", Boolean(caraRequest) && caraState.porch_id === porchB);
  const caraTwice = await cara.call("lib/porch/porch-join.ts", "joinWithCode", { code: codeA });
  const caraStill = await helper("person", { email: cara.email });
  record("isolation", "joining", "Cara can't hop into Porch A with A's code while she's in Porch B", caraTwice?.ok === false && caraStill.porch_id === porchB);
  const madeUpCode = await cara.call("lib/porch/porch-join.ts", "checkInvite", { code: "MINISTRY-CODE" });
  record("sanity", "joining", "A made-up code finds no porch", madeUpCode?.ok === false);
  const abeInvite = await abe.call("lib/porch/porch-join.ts", "myInvite");
  const abeReset = await abe.call("lib/porch/porch-join.ts", "resetInvite");
  record("sanity", "joining", "A member sees the invite code but can't reset it", abeInvite?.ok === true && abeInvite?.code === codeA && abeReset?.ok === false);
  const benReset = await ben.call("lib/porch/porch-join.ts", "resetInvite");
  const oldB = await cara.call("lib/porch/porch-join.ts", "checkInvite", { code: codeB });
  const newB = await cara.call("lib/porch/porch-join.ts", "checkInvite", { code: benReset?.code });
  const annCodeAfter = await abe.call("lib/porch/porch-join.ts", "myInvite");
  record("sanity", "joining", "Ben (B's admin) resets B's code: the old code stops working, the new one works", benReset?.ok === true && oldB?.ok === false && newB?.ok === true && newB?.name === "Porch B");
  record("sanity", "joining", "A reset gives a new random code, not one made from the church's name", /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(benReset?.code ?? "") && benReset?.code !== codeB && !/PORCH/.test(benReset?.code ?? ""), benReset?.code);
  record("isolation", "joining", "Resetting Porch B's code leaves Porch A's code alone", annCodeAfter?.code === codeA);

  const dee = await person("Dee Starter", "dee@two-church.test");
  const deeTooSoon = await dee.call("lib/porch/porch-join.ts", "startPorch", { kind: "church", name: "Porch D", country: "Uganda" });
  record("sanity", "starting", "Starting a porch needs a confirmed email", deeTooSoon?.ok === false);
  await verify(dee);
  const deeStarts = await dee.call("lib/porch/porch-join.ts", "startPorch", { kind: "church", name: "Porch D", country: "Uganda" });
  const deeState = await helper("person", { email: dee.email });
  const porchD = (await helper("porchInfo", { name: "Porch D" })).porch;
  record("sanity", "starting", "Dee starts a church porch: it waits for approval, Dee is its first member and admin", deeStarts?.ok === true && porchD?.status === "waiting" && deeState.porch_id === porchD?.id && deeState.admin === true);
  const deeLook = await dee.call("lib/porch/porch-look.ts", "myPorchLook");
  record("sanity", "starting", "Dee's porch works privately while it waits", deeLook?.member === true && deeLook?.waiting === true && deeLook?.name === "Porch D");
  const deeFeed = await dee.call("lib/porch/api.ts", "getFeed", { filter: "all" });
  record("isolation", "starting", "Dee's new church sees none of Porch A's or Phaneroo's posts", !has(deeFeed, "A private post in Porch A") && !has(deeFeed, "Porch B"));
  await verify(abe);
  const ABE_WHAT = "We lead worship nights and teach young singers in Mbarara.";
  const noWords = await abe.call("lib/porch/porch-join.ts", "startPorch", { kind: "ministry", name: "Abe Ministry", country: "Uganda", ministryType: "music", description: "" });
  const noTypeName = await abe.call("lib/porch/porch-join.ts", "startPorch", { kind: "ministry", name: "Abe Ministry", country: "Uganda", ministryType: "other", ministryOther: "", description: ABE_WHAT });
  const noCountry = await abe.call("lib/porch/porch-join.ts", "startPorch", { kind: "ministry", name: "Abe Ministry", country: "Narnia", ministryType: "music", description: ABE_WHAT });
  record("sanity", "starting", "A ministry needs a description, a named type for \"Other\", and a country from the list", noWords?.ok === false && noTypeName?.ok === false && noCountry?.ok === false);
  const abeMinistry = await abe.call("lib/porch/porch-join.ts", "startPorch", { kind: "ministry", name: "Abe Ministry", country: "Uganda", ministryType: "music", description: ABE_WHAT });
  const abeAfterMinistry = await helper("person", { email: abe.email });
  const ministry = (await helper("porchInfo", { name: "Abe Ministry" })).porch;
  record("sanity", "starting", "Abe (a member of Porch A) starts a music ministry: he runs it and stays in Porch A", abeMinistry?.ok === true && ministry?.kind === "ministry" && ministry?.status === "waiting" && abeAfterMinistry.porch_id === porchA);
  record("isolation", "starting", "Running a ministry porch doesn't make Abe an admin of his church", abeAfterMinistry.admin === false);
  record("isolation", "starting", "A ministry has no members (not even its starter) and no invite code", !(abeAfterMinistry.porches ?? []).includes(ministry?.id) && !ministry?.invite_code);
  const ministryMember = await helper("addMember", { email: cara.email, porchId: ministry?.id });
  const caraAfterTry = await helper("person", { email: cara.email });
  record("isolation", "joining", "A ministry can't get members, even straight in the database", ministryMember?.ok === false && !(caraAfterTry.porches ?? []).includes(ministry?.id));
  const psalmist = await dee.call("lib/porch/porch-join.ts", "startPorch", { kind: "psalmist", name: "Dee Psalms", country: "Uganda" });
  const oldKind = await dee.call("lib/porch/porch-join.ts", "startPorch", { kind: "gospel_artist", name: "Old Kind", country: "Uganda" });
  record("sanity", "starting", "Psalmist, Organisation and the old \"gospel_artist\" can't be started any more", psalmist?.ok === false && oldKind?.ok === false);
  const abeChurch = await abe.call("lib/porch/porch-join.ts", "startPorch", { kind: "church", name: "Abe's Church", country: "Uganda" });
  record("isolation", "starting", "A church member can't start a second church (one church each)", abeChurch?.ok === false);
  const abePorches = await abe.call("lib/porch/porch-join.ts", "myPorches");
  record("sanity", "starting", "Abe sees his ministry under Your porches", Array.isArray(abePorches) && abePorches.some((p) => p.name === "Abe Ministry" && p.status === "waiting"));
  const eve = await person("Eve Branch", "eve@two-church.test");
  await verify(eve);
  const badBranch = await eve.call("lib/porch/porch-join.ts", "startPorch", { kind: "church", name: "Porch E", country: "Uganda", branch: true, mainPorchId: porchD?.id });
  record("sanity", "starting", "A branch can only name an approved main porch", badBranch?.ok === false);
  const eveStarts = await eve.call("lib/porch/porch-join.ts", "startPorch", { kind: "church", name: "Porch E", country: "Uganda", branch: true, mainPorchId: 1 });
  const porchE = (await helper("porchInfo", { name: "Porch E" })).porch;
  record("sanity", "starting", "Eve starts a branch: the main porch (Phaneroo) is recorded", eveStarts?.ok === true && porchE?.main_porch_id === 1);
  const eveFeed = await eve.call("lib/porch/api.ts", "getFeed", { filter: "all" });
  record("isolation", "starting", "A branch's members see none of the main porch's private posts", !has(eveFeed, "Phaneroo") && (eveFeed?.posts ?? []).length === 0);

  const annList = await ann.call("lib/porch/porch-join.ts", "waitingPorches");
  record("sanity", "approval", "Only the platform owner sees the waiting list", annList?.ok === false);
  const oliveList = await olive.call("lib/porch/porch-join.ts", "waitingPorches");
  record("sanity", "approval", "The platform owner sees the new porches waiting", oliveList?.ok === true && ["Porch D", "Abe Ministry", "Porch E"].every((name) => has(oliveList, name)));
  const abeMinistryWaiting = (oliveList?.porches ?? []).find((p) => p.name === "Abe Ministry");
  record("sanity", "approval", "A ministry's type and description reach the approval list", abeMinistryWaiting?.ministryType === "Music" && abeMinistryWaiting?.description === ABE_WHAT && abeMinistryWaiting?.place === "Uganda");
  const annApproves = await ann.call("lib/porch/porch-join.ts", "decidePorch", { id: porchD?.id, approve: true });
  record("sanity", "approval", "A porch admin can't approve porches", annApproves?.ok === false);
  const oliveApproves = await olive.call("lib/porch/porch-join.ts", "decidePorch", { id: porchD?.id, approve: true });
  const porchDNow = (await helper("porchInfo", { name: "Porch D" })).porch;
  record("sanity", "approval", "The platform owner approves Porch D", oliveApproves?.ok === true && porchDNow?.status === "approved" && porchDNow?.verified === true);
  const oliveDeclines = await olive.call("lib/porch/porch-join.ts", "decidePorch", { id: porchE?.id, approve: false });
  const eveNow = await helper("person", { email: eve.email });
  const porchENow = (await helper("porchInfo", { name: "Porch E" })).porch;
  record("sanity", "approval", "Declining a church frees its people to join another church", oliveDeclines?.ok === true && porchENow?.status === "declined" && (eveNow.porch_id === null || eveNow.porch_id === undefined));

  // ---------------- Accounts and join requests (Stage 5c) ----------------
  console.log("\nAccounts and join requests");
  const faye = await person("Faye Joiner", "faye@two-church.test");
  const fayeState0 = await faye.call("lib/porch/membership.ts", "accountState");
  record("sanity", "joining", "A new account starts unconfirmed and in no church", fayeState0?.verified === false && fayeState0?.member === false);
  await verify(faye);
  const fayeBad = await faye.call("lib/porch/membership.ts", "requestToJoin", { code: codeA, fullName: "Faye", phone: "abc", city: "" });
  const fayeNoCity = await faye.call("lib/porch/membership.ts", "requestToJoin", { code: codeA, fullName: "Faye Joiner", phone: "+254711000001", city: "" });
  record("sanity", "joining", "A join request needs full name, phone and city (N2)", fayeBad?.ok === false && fayeNoCity?.ok === false);
  // Nation and address are sent too (as an old phone might), and must never be kept.
  const fayeAsks = await faye.call("lib/porch/membership.ts", "requestToJoin", { code: codeA, fullName: "Faye Joiner", phone: "+254711000001", city: "Kisumu", nation: "Kenya", address: "Secret Lane 7" });
  const fayeState1 = await faye.call("lib/porch/membership.ts", "accountState");
  record("sanity", "joining", "Faye's request to Porch A waits; she isn't a member yet", fayeAsks?.ok === true && fayeState1?.waiting?.porchName === "Porch A" && fayeState1?.member === false);
  const fayeFeed = await faye.call("lib/porch/api.ts", "getFeed", { filter: "all" });
  record("isolation", "joining", "While waiting, Faye sees none of Porch A's private posts", !has(fayeFeed, "A private post in Porch A"));
  const annWaiting = await ann.call("lib/porch/membership.ts", "waitingToJoin");
  const benWaiting2 = await ben.call("lib/porch/membership.ts", "waitingToJoin");
  const abeWaiting = await abe.call("lib/porch/membership.ts", "waitingToJoin");
  const fayeRequest = (annWaiting?.people ?? []).find((p) => p.fullName === "Faye Joiner");
  const annCount = await ann.call("lib/porch/membership.ts", "waitingJoinCount");
  const benCount = await ben.call("lib/porch/membership.ts", "waitingJoinCount");
  const abeCount = await abe.call("lib/porch/membership.ts", "waitingJoinCount");
  const annBellNow = await ann.call("lib/porch/notes.ts", "bellCount");
  record("sanity", "joining", "Ann (A's admin) sees how many are waiting to join, on My porch and on the bell", annCount?.count === (annWaiting?.people ?? []).length && annCount?.count >= 1 && annBellNow?.waiting === annCount?.count);
  record("isolation", "joining", "The waiting count is only for that church's admins (B's admin and a plain member see none of A's)", benCount?.count === 0 && abeCount?.count === 0);
  record("sanity", "joining", "Ann (A's admin) sees Faye's request with her phone and city", Boolean(fayeRequest) && fayeRequest?.phone === "+254711000001" && fayeRequest?.city === "Kisumu");
  record("sanity", "joining", "Nation and address are never kept, even when a phone still sends them", !has(annWaiting, "Kenya") && !has(annWaiting, "Secret Lane"));
  record("isolation", "joining", "A request to Porch A never shows in Porch B's waiting list", benWaiting2?.ok === true && !has(benWaiting2, "Faye Joiner") && !has(benWaiting2, "Kisumu"));
  record("isolation", "joining", "A member who isn't an admin (Abe) can't see the waiting list", abeWaiting?.ok === false && !has(abeWaiting, "Faye Joiner"));
  const benDecides = await ben.call("lib/porch/membership.ts", "decideJoinRequest", { id: fayeRequest?.id, letIn: true });
  const fayeStill = await helper("person", { email: faye.email });
  record("isolation", "joining", "Porch B's admin can't let someone into Porch A", benDecides?.ok === false && (fayeStill.porch_id === null || fayeStill.porch_id === undefined));
  const annLetsIn = await ann.call("lib/porch/membership.ts", "decideJoinRequest", { id: fayeRequest?.id, letIn: true });
  const fayeNow = await helper("person", { email: faye.email });
  record("sanity", "joining", "Ann lets Faye in: she's a member of Porch A", annLetsIn?.ok === true && fayeNow.porch_id === porchA);
  const annSeesFaye = await ann.call("lib/porch/membership.ts", "memberDetailsOf", { userId: faye.userId });
  record("sanity", "details", "Ann (A's admin) can see Faye's member details (full name, phone, city)", annSeesFaye?.ok === true && annSeesFaye?.details?.fullName === "Faye Joiner" && annSeesFaye?.details?.city === "Kisumu" && !has(annSeesFaye, "Secret Lane"));
  const benSeesFaye = await ben.call("lib/porch/membership.ts", "memberDetailsOf", { userId: faye.userId });
  record("isolation", "details", "Porch B's admins can never see Porch A's member details", benSeesFaye?.ok === false && !has(benSeesFaye, "Kisumu") && !has(benSeesFaye, "+254711000001"));
  const abeSeesFaye = await abe.call("lib/porch/membership.ts", "memberDetailsOf", { userId: faye.userId });
  record("isolation", "details", "A member who isn't an admin (Abe) can't see other members' details", abeSeesFaye?.ok === false && !has(abeSeesFaye, "Kisumu"));
  const fayeOwn = await faye.call("lib/porch/membership.ts", "myDetails");
  const fayeFix = await faye.call("lib/porch/membership.ts", "saveMyDetails", { fullName: "Faye Joiner", phone: "+254711000002", city: "Eldoret" });
  const fayeOwnAfter = await faye.call("lib/porch/membership.ts", "myDetails");
  record("sanity", "details", "Faye sees and corrects her own details", fayeOwn?.details?.phone === "+254711000001" && fayeFix?.ok === true && fayeOwnAfter?.details?.city === "Eldoret");
  const gus = await person("Gus Declined", "gus@two-church.test");
  await verify(gus);
  await gus.call("lib/porch/membership.ts", "requestToJoin", { code: benReset?.code, fullName: "Gus Declined", phone: "+256700000020", city: "Kampala" });
  const gusRequest = ((await ben.call("lib/porch/membership.ts", "waitingToJoin"))?.people ?? []).find((p) => p.fullName === "Gus Declined");
  await ben.call("lib/porch/membership.ts", "decideJoinRequest", { id: gusRequest?.id, letIn: false });
  const gusState = await gus.call("lib/porch/membership.ts", "accountState");
  record("sanity", "joining", "Ben declines Gus: Gus isn't a member and is told, and can ask again", gusState?.member === false && gusState?.waiting === null && gusState?.lastDeclined === "Porch B");
  const fayeName = await faye.call("lib/porch/membership.ts", "setUsername", { username: "faye.j" });
  const gusSame = await gus.call("lib/porch/membership.ts", "setUsername", { username: "FAYE.J" });
  const gusBad = await gus.call("lib/porch/membership.ts", "setUsername", { username: "no spaces allowed" });
  record("sanity", "accounts", "Usernames are unique (any capitals) and simple", fayeName?.ok === true && gusSame?.ok === false && gusBad?.ok === false);
  await faye.call("lib/porch/membership.ts", "setHideChurch", { hide: true });
  const fayeHide = await faye.call("lib/porch/membership.ts", "accountState");
  const cassHide = await cara.call("lib/porch/membership.ts", "accountState");
  record("isolation", "accounts", "\"Hide my church\" is each person's own switch", fayeHide?.hideChurch === true && cassHide?.hideChurch === false);
  const abeAsked = await abe.call("lib/porch/membership.ts", "accountState");
  await abe.call("lib/porch/membership.ts", "saveMyDetails", { fullName: "Abe Member", phone: "+256700000030", city: "Mbarara" });
  const abeAskedAfter = await abe.call("lib/porch/membership.ts", "accountState");
  record("sanity", "details", "An existing member with details missing is asked for them, until they're given", (abeAsked?.missing ?? []).length > 0 && (abeAskedAfter?.missing ?? []).length === 0);

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

  // ================ Stage 3b ================
  /** A PDF the app hands back (as base64 inside its answer), as plain text to search. */
  const pdfText = (value) => {
    const b64 = value?.pdf ?? value?.file ?? "";
    try {
      return Buffer.from(String(b64), "base64").toString("latin1");
    } catch {
      return "";
    }
  };
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  // ---- Offices ----
  // Stage 4b: each church makes its own offices. Phaneroo keeps its 8; a new church starts with none.
  const oliveOffices = await olive.call("lib/porch/offices.ts", "listOffices");
  const phanerooPastor = (oliveOffices?.offices ?? []).find((o) => o.key === "pastor");
  record("sanity", "offices", "Phaneroo keeps its 8 offices", (oliveOffices?.offices ?? []).length === 8, `${(oliveOffices?.offices ?? []).length} offices`);
  record("sanity", "offices", "Phaneroo's Office of the Pastor keeps all six actions", (phanerooPastor?.actions ?? []).length === 6);
  const annStart = await ann.call("lib/porch/offices.ts", "listOffices");
  record("isolation", "offices", "A new church starts with no offices (Phaneroo's are not copied in)", Array.isArray(annStart?.offices) && annStart.offices.length === 0);
  const abeMakes = await abe.call("lib/porch/offices.ts", "createOffice", { name: "Abe's office", actions: ["chat"] });
  record("sanity", "offices", "A member (Abe) can't create an office", abeMakes?.ok === false);
  const annMakes = await ann.call("lib/porch/offices.ts", "createOffice", { name: "Office of the Pastor", description: "Porch A's pastor", actions: ["thanks", "chat", "appoint", "calendar", "account", "official"] });
  record("sanity", "offices", "Ann (A's admin) creates Porch A's Office of the Pastor", annMakes?.ok === true && annMakes?.key === "pastor");
  const annHead = await ann.call("lib/porch/offices.ts", "setOfficeHead", { key: "pastor", userId: ann.userId });
  record("sanity", "offices", "Ann (Porch A's admin) makes herself head of A's pastor's office", annHead?.ok === true);
  const abeNote = await abe.call("lib/porch/offices.ts", "sendOfficeNote", { key: "pastor", room: "chat", body: "Office note in Porch A" });
  record("sanity", "offices", "Abe can write to Porch A's pastor's office", abeNote?.ok === true);
  const annOffice = await ann.call("lib/porch/offices.ts", "openOffice", { key: "pastor", room: "chat" });
  record("sanity", "offices", "Ann (the head) sees Abe's note", has(annOffice, "Abe Member"));
  const annBook = await ann.call("lib/porch/office-book.ts", "saveOfficeBook", { key: "pastor", title: "A book", body: "A secret office book" });
  record("sanity", "offices", "Ann can write Porch A's office book", annBook?.ok === true);

  // Porch B makes its own offices; none of them may appear in Porch A.
  await ben.call("lib/porch/offices.ts", "createOffice", { name: "Office of the Pastor", actions: ["thanks", "chat", "appoint", "calendar", "account", "official"] });
  await ben.call("lib/porch/offices.ts", "createOffice", { name: "Missions", actions: ["chat"] });
  const benYouth = await ben.call("lib/porch/offices.ts", "createOffice", { name: "Youth Desk B", description: "Only in Porch B", actions: ["chat", "appoint"] });
  record("sanity", "offices", "Ben (B's admin) creates Porch B's own offices", benYouth?.ok === true && benYouth?.key === "youth-desk-b");
  const annAfterB = await ann.call("lib/porch/offices.ts", "listOffices");
  const abeAfterB = await abe.call("lib/porch/offices.ts", "listOffices");
  record("isolation", "offices", "Offices created by Porch B don't appear in Porch A (Ann's list)", !has(annAfterB, "Youth Desk B") && (annAfterB?.offices ?? []).length === 1);
  record("isolation", "offices", "Offices created by Porch B don't appear in Porch A (Abe's list)", !has(abeAfterB, "Youth Desk B") && !has(abeAfterB, "Missions"));
  const abeOpensB = await abe.call("lib/porch/offices.ts", "openOffice", { key: "youth-desk-b" });
  record("isolation", "offices", "Abe can't open Porch B's office by its name", abeOpensB?.ok === false);
  const abeWritesB = await abe.call("lib/porch/offices.ts", "sendOfficeNote", { key: "youth-desk-b", room: "chat", body: "Sneaking into B" });
  record("isolation", "offices", "Abe can't write to Porch B's office", abeWritesB?.ok === false);
  const annRenamesB = await ann.call("lib/porch/offices.ts", "updateOffice", { key: "youth-desk-b", name: "Taken over", actions: ["chat"] });
  const annRemovesB = await ann.call("lib/porch/offices.ts", "removeOffice", { key: "youth-desk-b" });
  const benStill = await ben.call("lib/porch/offices.ts", "listOffices");
  record("isolation", "offices", "Ann can't rename or remove Porch B's office", annRenamesB?.ok === false && annRemovesB?.ok === false && has(benStill, "Youth Desk B") && !has(benStill, "Taken over"));
  await ben.call("lib/porch/offices.ts", "updateOffice", { key: "pastor", name: "Office of the Senior Pastor B", actions: ["chat"] });
  const annPastorName = await ann.call("lib/porch/offices.ts", "listOffices");
  record("isolation", "offices", "Ben renaming B's pastor's office doesn't rename A's", has(annPastorName, "Office of the Pastor") && !has(annPastorName, "Senior Pastor B") && (annPastorName?.offices?.[0]?.actions ?? []).length === 6);
  await ben.call("lib/porch/offices.ts", "createOffice", { name: "Short-lived B", actions: ["chat"] });
  const benRemoves = await ben.call("lib/porch/offices.ts", "removeOffice", { key: "short-lived-b" });
  const benAfterRemove = await ben.call("lib/porch/offices.ts", "listOffices");
  record("sanity", "offices", "Ben can remove one of B's offices", benRemoves?.ok === true && !has(benAfterRemove, "Short-lived B"));
  const annAfterRemove = await ann.call("lib/porch/offices.ts", "listOffices");
  record("isolation", "offices", "Ben removing a B office leaves Porch A's offices alone", (annAfterRemove?.offices ?? []).length === 1 && has(annAfterRemove, "Office of the Pastor"));
  const benOffices = await ben.call("lib/porch/offices.ts", "listOffices");
  record("isolation", "offices", "Ben's offices list shows none of Porch A's heads", Array.isArray(benOffices?.offices) && !has(benOffices, "Ann Admin"));
  record("isolation", "offices", "Ben's office-head picker shows only his own church", !has(benOffices?.people, "Ann Admin") && !has(benOffices?.people, "Abe Member"));
  const benHeadsAnn = await ben.call("lib/porch/offices.ts", "setOfficeHead", { key: "pastor", userId: ann.userId });
  record("isolation", "offices", "Ben is refused when he makes Ann (Porch A) a head", benHeadsAnn?.ok === false);
  await ben.call("lib/porch/offices.ts", "setOfficeHead", { key: "pastor", userId: ben.userId });
  const benOffice = await ben.call("lib/porch/offices.ts", "openOffice", { key: "pastor", room: "chat" });
  record("isolation", "offices", "Ben, head of B's pastor's office, sees none of Porch A's office notes", !has(benOffice, "Abe Member") && !has(benOffice, "Office note in Porch A"));
  const benReadsBook = await ben.call("lib/porch/office-book.ts", "loadOfficeBook", { key: "pastor" });
  record("isolation", "offices", "Ben can't read Porch A's office book", !has(benReadsBook, "A secret office book"));
  const benHoo = await ben.call("lib/porch/hoo-reports.ts", "loadHooBoard");
  record("isolation", "offices", "Ben's report-writer picker shows only his own church", !has(benHoo, "Ann Admin") && !has(benHoo, "Abe Member"));
  await ben.call("lib/porch/offices.ts", "saveCalendar", { key: "pastor", body: "Porch B calendar" });
  const annCalendar = await ann.call("lib/porch/offices.ts", "openOffice", { key: "pastor", room: "calendar" });
  record("isolation", "offices", "Ben's office calendar doesn't change Porch A's", !has(annCalendar, "Porch B calendar"));
  const annStillHead = await ann.call("lib/porch/offices.ts", "listOffices");
  record("isolation", "offices", "Ben choosing B's head doesn't change A's head", has(annStillHead, "Ann Admin") && !has(annStillHead, "Ben Other"));

  // ---- Request status: Sent, Confirmed, Answered ----
  const abeSent = await abe.call("lib/porch/offices.ts", "listOffices");
  const abeRequest = (abeSent?.requests ?? []).find((r) => r.officeKey === "pastor" && r.room === "chat");
  record("sanity", "offices", "Abe sees his request to the office as Sent", abeRequest?.status === "open");
  const benMarksAbe = await ben.call("lib/porch/offices.ts", "setPrayerStatus", { key: "pastor", room: "chat", memberId: abe.userId, status: "received" });
  record("isolation", "offices", "Ben (head of B's pastor's office) can't mark Abe's Porch A request", benMarksAbe?.ok === false);
  const abeMarksOwn = await abe.call("lib/porch/offices.ts", "setPrayerStatus", { key: "pastor", room: "chat", memberId: abe.userId, status: "received" });
  record("sanity", "offices", "Abe can't mark his own request Confirmed", abeMarksOwn?.ok === false);
  const annConfirms = await ann.call("lib/porch/offices.ts", "setPrayerStatus", { key: "pastor", room: "chat", memberId: abe.userId, status: "received" });
  const abeConfirmed = await abe.call("lib/porch/offices.ts", "listOffices");
  record("sanity", "offices", "Ann (the head) marks it Confirmed and Abe sees Confirmed", annConfirms?.ok === true && (abeConfirmed?.requests ?? []).some((r) => r.officeKey === "pastor" && r.status === "received"));
  await ann.call("lib/porch/offices.ts", "sendOfficeNote", { key: "pastor", room: "chat", memberId: abe.userId, body: "Ann's reply" });
  const abeAnswered = await abe.call("lib/porch/offices.ts", "listOffices");
  record("sanity", "offices", "When the office replies, Abe sees Answered", (abeAnswered?.requests ?? []).some((r) => r.officeKey === "pastor" && r.room === "chat" && r.status === "answered"));
  const benRequests = await ben.call("lib/porch/offices.ts", "listOffices");
  record("isolation", "offices", "Ben's requests list has none of Porch A's requests", !has(benRequests?.requests, "Office note in Porch A") && !has(benRequests?.requests, "Ann's reply"));

  // ---- Office announcements (pinned at the top of My porch) ----
  const abeAnnounces = await abe.call("lib/porch/offices.ts", "postAnnouncement", { key: "pastor", body: "Abe pretending" });
  record("sanity", "offices", "A member who isn't the head can't post an office announcement", abeAnnounces?.ok === false);
  const annAnnounces = await ann.call("lib/porch/offices.ts", "postAnnouncement", { key: "pastor", body: "A pinned word for Porch A" });
  const abeSees = await abe.call("lib/porch/offices.ts", "listAnnouncements");
  record("sanity", "offices", "Ann (the head) posts an announcement and Abe sees it", annAnnounces?.ok === true && has(abeSees, "A pinned word for Porch A") && has(abeSees, "Office of the Pastor"));
  await ben.call("lib/porch/offices.ts", "postAnnouncement", { key: "pastor", body: "A pinned word for Porch B" });
  const benSeesNotes = await ben.call("lib/porch/offices.ts", "listAnnouncements");
  const abeSeesAgain = await abe.call("lib/porch/offices.ts", "listAnnouncements");
  record("isolation", "offices", "Porch A's announcement doesn't show in Porch B", !has(benSeesNotes, "A pinned word for Porch A") && has(benSeesNotes, "A pinned word for Porch B"));
  record("isolation", "offices", "Porch B's announcement doesn't show in Porch A", !has(abeSeesAgain, "A pinned word for Porch B"));
  const oliveSees = await olive.call("lib/porch/offices.ts", "listAnnouncements");
  record("isolation", "offices", "Phaneroo sees neither church's announcement", !has(oliveSees, "Porch A") && !has(oliveSees, "Porch B"));
  const annAnnouncement = (abeSees ?? [])[0];
  const benRemovesA = await ben.call("lib/porch/offices.ts", "removeAnnouncement", { id: annAnnouncement?.id ?? 0 });
  const abeStillSees = await abe.call("lib/porch/offices.ts", "listAnnouncements");
  record("isolation", "offices", "Ben can't remove Porch A's announcement", benRemovesA?.ok === false && has(abeStillSees, "A pinned word for Porch A"));
  await ann.call("lib/porch/offices.ts", "postAnnouncement", { key: "pastor", body: "A newer word for Porch A" });
  const abeNewest = await abe.call("lib/porch/offices.ts", "listAnnouncements");
  record("sanity", "offices", "A new announcement replaces the office's last one", has(abeNewest, "A newer word for Porch A") && !has(abeNewest, "A pinned word for Porch A"));

  // ---- Office conversations in Chat (Stage 4c) ----
  const abeChats = await abe.call("lib/porch/offices.ts", "myOfficeChats");
  record("sanity", "chat", "Abe's Chat list shows his conversation with A's Office of the Pastor", Array.isArray(abeChats) && abeChats.some((c) => c.officeKey === "pastor" && c.lastBody === "Ann's reply" && c.waiting === true));
  const annChats = await ann.call("lib/porch/offices.ts", "myOfficeChats");
  record("sanity", "chat", "Ann (the head) sees Abe's office conversation in her Chat list", Array.isArray(annChats) && annChats.some((c) => c.asHead && c.title === "Abe Member"));
  const benChats = await ben.call("lib/porch/offices.ts", "myOfficeChats");
  record("isolation", "chat", "Ben's Chat list has none of Porch A's office conversations", !has(benChats, "Abe Member") && !has(benChats, "Ann's reply") && !has(benChats, "Office note in Porch A"));

  // ---- Porch settings: theme and Tour doors (Stage 4c) ----
  const abeTheme = await abe.call("lib/porch/porch-look.ts", "setPorchTheme", { theme: "royal-night" });
  record("sanity", "settings", "A member (Abe) can't change the porch's theme", abeTheme?.ok === false);
  const annTheme = await ann.call("lib/porch/porch-look.ts", "setPorchTheme", { theme: "living-water" });
  const benTheme = await ben.call("lib/porch/porch-look.ts", "setPorchTheme", { theme: "crimson-grace" });
  const abeLook = await abe.call("lib/porch/porch-look.ts", "myPorchLook");
  const benLook = await ben.call("lib/porch/porch-look.ts", "myPorchLook");
  const oliveLook = await olive.call("lib/porch/porch-look.ts", "myPorchLook");
  record("sanity", "settings", "Ann (A's admin) sets Porch A's theme and Abe sees it", annTheme?.ok === true && abeLook?.theme === "living-water");
  record("isolation", "settings", "Ben's theme for Porch B doesn't change Porch A's or Phaneroo's", benTheme?.ok === true && benLook?.theme === "crimson-grace" && abeLook?.theme === "living-water" && oliveLook?.theme === "porch-evening");

  // ---- The Porchbook brand (Stage 4e): one accent per church, Light or Dark per member ----
  const startAccent = await abe.call("lib/porch/porch-look.ts", "myPorchLook");
  record("sanity", "settings", "Every porch starts with Porchbook gold and Light", startAccent?.accent === "gold" && startAccent?.mode === "light");
  const abeAccent = await abe.call("lib/porch/porch-look.ts", "setPorchAccent", { accent: "teal" });
  record("sanity", "settings", "A member (Abe) can't change the church's accent colour", abeAccent?.ok === false);
  const benAccent = await ben.call("lib/porch/porch-look.ts", "setPorchAccent", { accent: "royal-blue" });
  const badAccent = await ben.call("lib/porch/porch-look.ts", "setPorchAccent", { accent: "neon-pink" });
  const benAccentLook = await ben.call("lib/porch/porch-look.ts", "myPorchLook");
  const abeAccentLook = await abe.call("lib/porch/porch-look.ts", "myPorchLook");
  const oliveAccentLook = await olive.call("lib/porch/porch-look.ts", "myPorchLook");
  record("sanity", "settings", "Ben sets Porch B's accent to Royal blue (and only the six brand accents are allowed)", benAccent?.ok === true && badAccent?.ok === false && benAccentLook?.accent === "royal-blue");
  record("isolation", "settings", "Porch B changing its accent doesn't change Porch A's or Phaneroo's", abeAccentLook?.accent === "gold" && oliveAccentLook?.accent === "gold");
  const abeDark = await abe.call("lib/porch/porch-look.ts", "setMyLookMode", { mode: "dark" });
  const abeDarkLook = await abe.call("lib/porch/porch-look.ts", "myPorchLook");
  const annModeLook = await ann.call("lib/porch/porch-look.ts", "myPorchLook");
  const benModeLook = await ben.call("lib/porch/porch-look.ts", "myPorchLook");
  record("isolation", "settings", "Abe choosing Dark changes only Abe's look, not Ann's (same church) or Ben's", abeDark?.ok === true && abeDarkLook?.mode === "dark" && annModeLook?.mode === "light" && benModeLook?.mode === "light");
  await abe.call("lib/porch/porch-look.ts", "setMyLookMode", { mode: "light" });

  // ---- Help and FAQ (Stage 4f): one FAQ for every porch, only the platform owner edits it ----
  const abeFaq = await abe.call("lib/porch/faq.ts", "loadFaq");
  const benFaq = await ben.call("lib/porch/faq.ts", "loadFaq");
  record("sanity", "settings", "The FAQ starts with its questions, the same for every porch", Array.isArray(abeFaq) && abeFaq.length >= 20 && JSON.stringify(abeFaq) === JSON.stringify(benFaq));
  const annFaqEdit = await ann.call("lib/porch/faq.ts", "editFaq", { action: "add", section: "Getting started", question: "Ann's question?", answer: "Not allowed" });
  record("sanity", "settings", "A porch admin (Ann) can't change the FAQ", annFaqEdit?.ok === false);
  const oliveFaqAdd = await olive.call("lib/porch/faq.ts", "editFaq", { action: "add", section: "Getting started", question: "A test question?", answer: "A test answer." });
  const abeFaqAfter = await abe.call("lib/porch/faq.ts", "loadFaq");
  const newItem = (abeFaqAfter ?? []).find((item) => item.question === "A test question?");
  record("sanity", "settings", "The platform owner adds a question and every porch sees it", oliveFaqAdd?.ok === true && Boolean(newItem) && has(await ben.call("lib/porch/faq.ts", "loadFaq"), "A test question?"));
  await olive.call("lib/porch/faq.ts", "editFaq", { action: "remove", id: newItem?.id });
  const faqAfterRemove = await abe.call("lib/porch/faq.ts", "loadFaq");
  record("sanity", "settings", "The platform owner removes it again", !has(faqAfterRemove, "A test question?"));
  record("sanity", "settings", "Members never see the owner's \"to check\" marks", (abeFaq ?? []).every((item) => item.check === false));
  const abeDoors = await abe.call("lib/porch/porch-look.ts", "setTourDoors", { off: ["my20"] });
  record("sanity", "settings", "A member (Abe) can't switch Tour doors off", abeDoors?.ok === false);
  const allOff = await ben.call("lib/porch/porch-look.ts", "setTourDoors", { off: ["pray", "my20", "events", "groups", "serve", "transport", "feedback"] });
  record("sanity", "settings", "A porch must keep at least one Tour door", allOff?.ok === false);
  const benDoors = await ben.call("lib/porch/porch-look.ts", "setTourDoors", { off: ["my20", "transport"] });
  const benDoorLook = await ben.call("lib/porch/porch-look.ts", "myPorchLook");
  const abeDoorLook = await abe.call("lib/porch/porch-look.ts", "myPorchLook");
  const oliveDoorLook = await olive.call("lib/porch/porch-look.ts", "myPorchLook");
  record("sanity", "settings", "Ben switches off My 20 and Transport for Porch B", benDoors?.ok === true && (benDoorLook?.tourOff ?? []).join(",") === "my20,transport");
  record("isolation", "settings", "Porch B's switched-off Tour doors don't change Porch A's or Phaneroo's Tour", (abeDoorLook?.tourOff ?? []).length === 0 && (oliveDoorLook?.tourOff ?? []).length === 0);

  // ---- Devotional (Stage 4d): new churches start with none; Phaneroo keeps phaneroo.org ----
  const oliveDevShelf = await olive.call("lib/porch/read.ts", "loadReadShelf");
  record("sanity", "read", "Phaneroo keeps phaneroo.org's daily devotional", oliveDevShelf?.devotion?.source === "phaneroo");
  const benDevShelf = await ben.call("lib/porch/read.ts", "loadReadShelf");
  const benDevotion = await ben.call("lib/porch/read.ts", "loadReadDoc", { key: "devotion" });
  record("isolation", "read", "Porch B starts with no devotional and never gets Phaneroo's", benDevShelf?.devotion?.source === "none" && benDevotion?.ok === false && !has(benDevotion, "phaneroo.org"));
  const benTakesPhaneroo = await ben.call("lib/porch/read.ts", "saveDevotionSetting", { source: "phaneroo" });
  record("isolation", "read", "Porch B can't switch on Phaneroo's devotional", benTakesPhaneroo?.ok === false);
  const benAfterTry = await ben.call("lib/porch/read.ts", "loadReadDoc", { key: "devotion" });
  record("isolation", "read", "…and still sees no Phaneroo devotional afterwards", !has(benAfterTry, "phaneroo.org"));
  const abeSetsDevotion = await abe.call("lib/porch/read.ts", "saveDevotionSetting", { source: "own", title: "Abe's", text: "Not allowed" });
  record("sanity", "read", "A member (Abe) can't change the devotional", abeSetsDevotion?.ok === false);
  const benOwn = await ben.call("lib/porch/read.ts", "saveDevotionSetting", { source: "own", title: "B's word for today", text: "Porch B's own devotional text" });
  const benReads = await ben.call("lib/porch/read.ts", "loadReadDoc", { key: "devotion" });
  record("sanity", "read", "Ben writes Porch B's own devotional and B reads it", benOwn?.ok === true && benReads?.ok === true && benReads?.title === "B's word for today" && has(benReads, "Porch B's own devotional text"));
  const abeReads = await abe.call("lib/porch/read.ts", "loadReadDoc", { key: "devotion" });
  const abeDevShelf = await abe.call("lib/porch/read.ts", "loadReadShelf");
  const oliveShelfAfter = await olive.call("lib/porch/read.ts", "loadReadShelf");
  record("isolation", "read", "Porch B's own devotional doesn't reach Porch A or Phaneroo", !has(abeReads, "Porch B's own devotional") && abeDevShelf?.devotion?.source === "none" && oliveShelfAfter?.devotion?.source === "phaneroo" && !has(oliveShelfAfter, "B's word"));
  const annLink = await ann.call("lib/porch/read.ts", "saveDevotionSetting", { source: "link", link: "https://example.org/porch-a-devotional" });
  const abeLink = await abe.call("lib/porch/read.ts", "loadReadDoc", { key: "devotion" });
  const benLinkCheck = await ben.call("lib/porch/read.ts", "loadReadDoc", { key: "devotion" });
  record("isolation", "read", "Porch A's devotional website reaches A only", annLink?.ok === true && abeLink?.link === "https://example.org/porch-a-devotional" && !has(benLinkCheck, "porch-a-devotional"));

  // ---- Events (with hotels and travel) ----
  const annEvent = await ann.call("lib/porch/events.ts", "saveEvent", { title: "Porch A retreat", startsOn: future });
  record("sanity", "events", "Ann can add an event in Porch A", annEvent?.ok === true);
  const abeEvents = await abe.call("lib/porch/events.ts", "listEvents");
  const eventId = (abeEvents?.events ?? []).find((e) => e.title === "Porch A retreat")?.id;
  record("sanity", "events", "Abe sees Porch A's event", Boolean(eventId));
  const abeYes = await abe.call("lib/porch/events.ts", "answerEvent", { eventId, answer: "yes" });
  record("sanity", "events", "Abe can say he's going", abeYes?.ok === true);
  await ann.call("lib/porch/events.ts", "saveHotel", { eventId, name: "Porch A hotel" });
  const benEvents = await ben.call("lib/porch/events.ts", "listEvents");
  record("isolation", "events", "Ben's events don't show Porch A's event", !has(benEvents, "Porch A retreat"));
  const benYes = await ben.call("lib/porch/events.ts", "answerEvent", { eventId, answer: "yes" });
  record("isolation", "events", "Ben is refused when he answers Porch A's event", benYes?.ok === false);
  const benHotels = await ben.call("lib/porch/events.ts", "eventHotels", { eventId });
  record("isolation", "events", "Ben can't see Porch A's hotels", !has(benHotels, "Porch A hotel"));
  const benTravel = await ben.call("lib/porch/events.ts", "saveTravel", { eventId, fromPlace: "Gulu", arriveAt: `${future}T10:00` });
  record("isolation", "events", "Ben is refused when he registers travel for Porch A's event", benTravel?.ok === false);
  const benAddsHotel = await ben.call("lib/porch/events.ts", "saveHotel", { eventId, name: "B's hotel" });
  record("isolation", "events", "Ben (B's admin) is refused when he adds a hotel to Porch A's event", benAddsHotel?.ok === false);
  const benBoard = await ben.call("lib/porch/events.ts", "guestBoard", { eventId });
  record("isolation", "events", "Ben is refused Porch A's guest board", benBoard?.ok === false && !has(benBoard, "Abe Member"));
  await ben.call("lib/porch/events.ts", "dropEvent", { id: eventId });
  const abeEventsAfter = await abe.call("lib/porch/events.ts", "listEvents");
  record("isolation", "events", "Ben can't remove Porch A's event", has(abeEventsAfter, "Porch A retreat"));

  // ---- Serve ----
  const form = { firstName: "Abe", lastName: "Servant", phone: "+256700000002", email: "abe@two-church.test", gender: "Male", bornOn: "1990-01-01", city: "Mbarara", discipleship: "Yes", howLong: "I am new", department: "Ushering", servesElsewhere: "No", elsewhere: "", profession: "Teacher", skills: "Welcoming", consent: "Yes" };
  const abeServe = await abe.call("lib/porch/serve.ts", "saveServe", { form });
  record("sanity", "serve", "Abe can fill in the Serve form", abeServe?.ok === true, abeServe?.ok ? "" : String(abeServe?.error ?? ""));
  const annServe = await ann.call("lib/porch/serve.ts", "downloadServe");
  record("sanity", "serve", "Ann (A's admin) gets Abe in the volunteer list", pdfText(annServe).includes("Servant"));
  const benServe = await ben.call("lib/porch/serve.ts", "downloadServe");
  record("isolation", "serve", "Ben's volunteer list has no Porch A volunteers", benServe?.ok === true && !pdfText(benServe).includes("Servant"));
  const abeServeForm = await abe.call("lib/porch/serve.ts", "loadServe");
  const benServeForm = await ben.call("lib/porch/serve.ts", "loadServe");
  record("isolation", "serve", "A Serve form belongs to its church: Abe sees his A form; Ben (B) has none", abeServeForm?.sent === true && abeServeForm?.form?.lastName === "Servant" && benServeForm?.sent === false);

  // ---- Transport ----
  const annStage = await ann.call("lib/porch/transport.ts", "saveTransportStage", { place: "Kakoba", stage: "Kakoba stage A" });
  record("sanity", "transport", "Ann can name a transport stage", annStage?.ok === true);
  const abeRide = await abe.call("lib/porch/transport.ts", "saveTransport", { place: "Kakoba", venue: "pmm" });
  record("sanity", "transport", "Abe can ask for a ride", abeRide?.ok === true);
  const annTransport = await ann.call("lib/porch/transport.ts", "loadTransport");
  record("sanity", "transport", "Ann sees Abe on her transport list", has(annTransport?.groups, "Abe Member"));
  const benTransport = await ben.call("lib/porch/transport.ts", "loadTransport");
  record("isolation", "transport", "Ben's transport doesn't show Porch A's riders or stages", !has(benTransport, "Abe Member") && !has(benTransport, "Kakoba stage A"));
  record("isolation", "transport", "Porch B has its own transport event", benTransport?.event?.id !== annTransport?.event?.id);
  await ben.call("lib/porch/transport.ts", "saveTransportStage", { place: "Kakoba", stage: "Porch B stage" });
  const abeTransport = await abe.call("lib/porch/transport.ts", "loadTransport");
  record("isolation", "transport", "Ben's stage doesn't reach Porch A's riders", !has(abeTransport, "Porch B stage"));
  const benTeam = await ben.call("lib/porch/transport-board.ts", "setTransportTeam", { userId: abe.userId, on: true });
  const annTeam = await ann.call("lib/porch/transport-board.ts", "listTransportTeam");
  record("isolation", "transport", "Ben can't put Abe (Porch A) on a transport team", benTeam?.ok === true && !has(annTeam, abe.userId));

  // ---- My 20 and its text messages ----
  const abeTwenty = await abe.call("lib/porch/my20.ts", "saveMyTwenty", { rows: [{ name: "Abe friend", phone: "+256700000001" }], centre: "Kakoba" });
  record("sanity", "my20", "Abe can save his My 20", abeTwenty?.ok === true);
  const annTwenty = await ann.call("lib/porch/my20.ts", "downloadMyTwenty");
  record("sanity", "my20", "Ann (A's admin) gets Abe's list", pdfText(annTwenty).includes("Abe friend"));
  const benTwenty = await ben.call("lib/porch/my20.ts", "downloadMyTwenty");
  record("isolation", "my20", "Ben's \"everyone's lists\" has no Porch A lists", !pdfText(benTwenty).includes("Abe friend"));
  await ben.call("lib/porch/my20.ts", "resetMyTwenty");
  const abeTwentyAfter = await abe.call("lib/porch/my20.ts", "loadMyTwenty");
  record("isolation", "my20", "Ben's \"delete everyone's lists\" leaves Porch A's lists alone", Number(abeTwentyAfter?.sent) === 1);
  await ben.call("lib/porch/offices.ts", "setOfficeHead", { key: "missions", userId: ben.userId });
  const benSms = await ben.call("lib/porch/mission-sms.ts", "loadMissionSms");
  record("isolation", "my20", "Ben's mission text messages wouldn't reach Porch A's My 20 numbers", benSms?.isHead === true && Number(benSms?.count) === 0);

  // ---- Pray (prayer music) ----
  const annPrayer = await ann.call("lib/porch/rhema.ts", "setPrayer", { url: "https://www.youtube.com/watch?v=AAAAAAAAAAA" });
  record("sanity", "pray", "Ann can set Porch A's prayer music", annPrayer?.ok === true);
  await ben.call("lib/porch/rhema.ts", "setPrayer", { url: "https://www.youtube.com/watch?v=BBBBBBBBBBB" });
  const abePrayer = await abe.call("lib/porch/rhema.ts", "getPrayer");
  record("isolation", "pray", "Ben's prayer music doesn't change Porch A's", abePrayer?.videoId === "AAAAAAAAAAA");

  // ---- Feedback ----
  const abeTrouble = await abe.call("lib/porch/trouble.ts", "sendTrouble", { words: "A complaint in Porch A", kind: "local" });
  record("sanity", "feedback", "Abe can send feedback", abeTrouble?.ok === true);
  const annTrouble = await ann.call("lib/porch/trouble.ts", "loadTrouble", { reports: true });
  const troubleId = (annTrouble?.reports ?? annTrouble?.rows ?? []).find?.((r) => (r.words ?? "").includes("A complaint in Porch A"))?.id;
  record("sanity", "feedback", "Ann (A's admin) sees Abe's feedback", has(annTrouble, "A complaint in Porch A"));
  const benTrouble = await ben.call("lib/porch/trouble.ts", "loadTrouble", { reports: true });
  record("isolation", "feedback", "Ben doesn't see Porch A's feedback", !has(benTrouble, "A complaint in Porch A"));
  if (troubleId) {
    const benHandles = await ben.call("lib/porch/trouble.ts", "handleTrouble", { id: troubleId, line: "Handled by B" });
    record("isolation", "feedback", "Ben is refused when he answers Porch A's feedback", benHandles?.ok === false);
  }

  // ---- Read shelf, Bible sites and the devotional ----
  const annShelfBook = await ann.call("lib/porch/read.ts", "addReadBook", { title: "Porch A book" });
  record("sanity", "read", "Ann can add a book to Porch A's shelf", annShelfBook?.ok === true);
  const abeShelf = await abe.call("lib/porch/read.ts", "loadReadShelf");
  record("sanity", "read", "Abe sees Porch A's book", has(abeShelf, "Porch A book"));
  const benShelf = await ben.call("lib/porch/read.ts", "loadReadShelf");
  record("isolation", "read", "Ben's shelf doesn't show Porch A's books", !has(benShelf, "Porch A book") && has(benShelf, "Bible"));
  const aBook = (abeShelf?.books ?? []).find((b) => b.title === "Porch A book")?.key;
  if (aBook) {
    const benOpens = await ben.call("lib/porch/read.ts", "loadReadDoc", { key: aBook });
    record("isolation", "read", "Ben is refused when he opens Porch A's book", benOpens?.ok === false);
    await ben.call("lib/porch/read.ts", "dropReadBooks", { keys: [aBook] });
    record("isolation", "read", "Ben can't delete Porch A's book", has(await abe.call("lib/porch/read.ts", "loadReadShelf"), "Porch A book"));
  }
  await ann.call("lib/porch/bible-sites.ts", "saveBibleSites", { sites: [{ label: "A site", url: "https://a.example/bible" }] });
  await ben.call("lib/porch/bible-sites.ts", "saveBibleSites", { sites: [] });
  const abeSites = await abe.call("lib/porch/bible-sites.ts", "getBibleSites");
  record("isolation", "read", "Ben replacing his Bible sites leaves Porch A's", has(abeSites, "A site"));
  record("isolation", "read", "Ben doesn't see Porch A's Bible sites", !has(await ben.call("lib/porch/bible-sites.ts", "getBibleSites"), "A site"));

  // ---- Notifications ----
  const annBell = await ann.call("lib/porch/notes.ts", "bellNotes", {});
  record("sanity", "notifications", "Ann's bell has Abe's reply to her post", has(annBell, "Abe Member") || has(annBell, "Amen from Abe"));
  const benBell = await ben.call("lib/porch/notes.ts", "bellNotes", {});
  record("isolation", "notifications", "Ben's bell has nothing from Porch A", !has(benBell, "Abe Member") && !has(benBell, "Ann Admin") && !has(benBell, "Amen from Abe"));
  const annAll = await ann.call("lib/porch/api.ts", "sendToAll", { body: "Announcement for Porch A" });
  record("sanity", "notifications", "Ann can message everyone in Porch A", annAll?.ok === true);
  const benInbox = await ben.call("lib/porch/api.ts", "listThreads");
  record("isolation", "notifications", "Ann's \"message everyone\" doesn't reach Ben", !has(benInbox, "Announcement for Porch A"));
  const abeInbox = await abe.call("lib/porch/api.ts", "listThreads");
  record("sanity", "notifications", "…but it reaches Abe", has(abeInbox, "Announcement for Porch A"));

  // ---- Wording, sounds and settings: Porch B's admin never changes Porch A's ----
  console.log("\nPorch B's admin changing words, sounds and settings");
  await ann.call("lib/porch/words.ts", "setWord", { key: "tour.pray", text: "Pray with A" });
  await ben.call("lib/porch/words.ts", "setWord", { key: "tour.pray", text: "Pray with B" });
  const abeWords = await abe.call("lib/porch/words.ts", "getWords");
  record("isolation", "settings", "Edit words: B's wording doesn't change A's", abeWords?.words?.["tour.pray"] === "Pray with A");
  record("isolation", "settings", "Edit words: B sees its own wording", (await ben.call("lib/porch/words.ts", "getWords"))?.words?.["tour.pray"] === "Pray with B");
  const tinyAudio = Buffer.from("ID3 two-church test sound").toString("base64");
  const annSound = await ann.call("lib/porch/message-sound.ts", "setMessageSound", { mime: "audio/wav", audio: tinyAudio });
  record("sanity", "settings", "Ann can set Porch A's message sound", annSound?.ok === true, annSound?.ok ? "" : String(annSound?.error ?? ""));
  await ben.call("lib/porch/message-sound.ts", "setMessageSound", { mime: "", audio: "" });
  const abeSound = await abe.call("lib/porch/message-sound.ts", "getMessageSound");
  record("isolation", "settings", "Message sound: B removing its sound doesn't remove A's", has(abeSound, tinyAudio));
  await ann.call("lib/porch/button-sound.ts", "setButtonSound", { mime: "audio/mpeg", audio: tinyAudio, slot: 1 });
  await ben.call("lib/porch/button-sound.ts", "setButtonSound", { mime: "", audio: "", slot: 1 });
  const abeButtons = await abe.call("lib/porch/button-sound.ts", "loadButtonSound");
  record("isolation", "settings", "Button sounds: B's change doesn't touch A's", has(abeButtons, tinyAudio));
  const tinyJpeg = Buffer.from("a tiny two-church test photo").toString("base64");
  const annGround = await ann.call("lib/porch/ground.ts", "setGround", { mime: "image/jpeg", image: tinyJpeg });
  record("sanity", "settings", "Ann can set Porch A's porch photo", annGround?.ok === true, annGround?.ok ? "" : String(annGround?.error ?? ""));
  await ben.call("lib/porch/ground.ts", "setGround", { mime: "", image: "" });
  record("isolation", "settings", "Porch photo: B's change doesn't touch A's", has(await abe.call("lib/porch/ground.ts", "getGround"), tinyJpeg));
  await ann.call("lib/porch/covers.ts", "setCover", { book: "bible", mime: "color", image: "#112233" });
  await ben.call("lib/porch/covers.ts", "setCover", { book: "bible", mime: "color", image: "#aabbcc" });
  const abeCovers = await abe.call("lib/porch/covers.ts", "getCovers");
  record("isolation", "settings", "Book covers: B's change doesn't touch A's", has(abeCovers, "#112233") && !has(abeCovers, "#aabbcc"));
  await ann.call("lib/porch/item-sizes.ts", "saveItemSize", { place: "shelf", item: "bible", w: 40, h: 60 });
  await ben.call("lib/porch/item-sizes.ts", "saveItemSize", { place: "shelf", item: "bible", w: 90, h: 90 });
  const abeSizes = await abe.call("lib/porch/item-sizes.ts", "loadItemSizes", { place: "shelf" });
  record("isolation", "settings", "Item sizes: B's change doesn't touch A's", has(abeSizes, "40") && !has(abeSizes, "90"));
  await ann.call("lib/porch/manual-card.ts", "setManualCardLive", { on: false });
  await ben.call("lib/porch/manual-card.ts", "setManualCardLive", { on: true });
  const abeManual = await abe.call("lib/porch/manual-card.ts", "manualCard");
  record("isolation", "settings", "Manual card switch: B switching it on doesn't switch on A's", !abeManual?.show);
  await ann.call("lib/porch/rhema.ts", "setRhema", { url: "https://www.youtube.com/watch?v=CCCCCCCCCCC" });
  await ben.call("lib/porch/rhema.ts", "setRhema", { url: "" });
  record("isolation", "settings", "Rhemaclip: B removing its clip doesn't remove A's", has(await abe.call("lib/porch/rhema.ts", "getRhema"), "CCCCCCCCCCC"));

  // ---------------- One church each (decision 39), on the membership list (M2) ----------------
  console.log("\nOne church each");
  await ben.call("lib/porch/api.ts", "createPost", { room: "proclaim", body: "A private post in Porch B" });
  const caraSecond = await helper("addMember", { email: cara.email, porchId: porchA });
  const caraOne = await helper("person", { email: cara.email });
  record("isolation", "joining", "Nobody can be in two churches, even straight in the database (Cara stays in B only)", caraSecond?.ok === false && caraOne.porch_id === porchB && (caraOne.porches ?? []).length === 1);
  const caraAsksA = await cara.call("lib/porch/membership.ts", "requestToJoin", { code: codeA, fullName: "Cara New", phone: "+256700000010", city: "Gulu" });
  record("isolation", "joining", "A member of Porch B can't send a join request to Porch A", caraAsksA?.ok === false);
  const caraToA = await cara.call("lib/porch/porch-join.ts", "switchPorch", { porchId: porchA });
  const caraFeed = await cara.call("lib/porch/api.ts", "getFeed", { filter: "all" });
  record("isolation", "feed", "Cara can't switch into Porch A, and sees B's posts and none of A's", caraToA?.ok === false && has(caraFeed, "A private post in Porch B") && !has(caraFeed, "A private post in Porch A"));
  const caraList = await cara.call("lib/porch/porch-join.ts", "myMemberships");
  record("sanity", "joining", "Cara's membership list has her one church", Array.isArray(caraList) && caraList.length === 1 && caraList[0]?.id === porchB);
  const benCara = await helper("pair", { email: ben.email, other: cara.email, porchId: porchA });
  const benAbe = await helper("pair", { email: ben.email, other: abe.email, porchId: porchA });
  const abeAnn = await helper("pair", { email: abe.email, other: ann.email, porchId: ministry?.id });
  record("sanity", "chat", "Ben and Cara are in the same church (B), so they may message each other", benCara.same === true);
  record("isolation", "chat", "Ben and Abe are in different churches", benAbe.same === false);
  record("isolation", "admins", "Being B's admin gives Ben no admin power in A (even though he was once listed there)", benCara.admin_of === false);
  record("isolation", "admins", "Ann (A's admin) has no power over Abe's ministry; Abe and Ann still share Porch A", abeAnn.same === true && abeAnn.admin_of === false);
  const abeStill = await abe.call("lib/porch/api.ts", "getFeed", { filter: "all" });
  record("isolation", "feed", "Running a ministry changes nothing in Abe's church: he sees A's posts, none of B's", has(abeStill, "A private post in Porch A") && !has(abeStill, "A private post in Porch B"));
  const caraPostsB = await cara.call("lib/porch/api.ts", "createPost", { room: "proclaim", body: "Cara's post in B" });
  const abeAfter = await abe.call("lib/porch/api.ts", "getFeed", { filter: "all" });
  record("isolation", "feed", "What Cara posts stays in B", caraPostsB?.ok === true && !has(abeAfter, "Cara's post in B"));
  const annSeesCara = await ann.call("lib/porch/membership.ts", "memberDetailsOf", { userId: cara.userId });
  record("isolation", "details", "A's admin can't see the details Cara gave Porch B", annSeesCara?.ok === false && !has(annSeesCara, "+256700000010") && !has(annSeesCara, "Gulu"));

  // ---------------- N3: "Continue as [ministry]" ----------------
  console.log("\nActing as a ministry (N3)");
  const abeBefore = await abe.call("lib/porch/membership.ts", "accountState");
  record("sanity", "accounts", "Abe's account lists the ministry he runs", (abeBefore?.ministries ?? []).some((m) => m.name === "Abe Ministry" && m.typeName === "Music") && abeBefore?.acting === null);
  const annActs = await ann.call("lib/porch/porch-join.ts", "actAs", { porchId: ministry?.id });
  const annActState = await ann.call("lib/porch/membership.ts", "accountState");
  record("isolation", "accounts", "Ann can't act as Abe's ministry (she isn't one of its admins)", annActs?.ok === false && annActState?.acting === null);
  await abe.call("lib/porch/membership.ts", "setUsername", { username: "abe.m" });
  const abeActs = await abe.call("lib/porch/porch-join.ts", "actAs", { porchId: ministry?.id });
  const abeActing = await abe.call("lib/porch/membership.ts", "accountState");
  const abeHome = await abe.call("lib/porch/porch-join.ts", "ministryHome");
  record("sanity", "accounts", "Abe continues as Abe Ministry: its own screen shows its description and admins", abeActs?.ok === true && abeActing?.acting?.name === "Abe Ministry" && abeHome?.ok === true && abeHome?.description === ABE_WHAT && (abeHome?.admins ?? []).some((a) => a.userId === abe.userId));
  record("sanity", "people", "N4: a ministry is public, so its admin team shows Abe by his username", (abeHome?.admins ?? []).some((a) => a.userId === abe.userId && a.name === "abe.m"));
  // N7: while Abe acts as the ministry, nobody reaches him as a church member, and he reaches nobody.
  const annToActing = await ann.call("lib/porch/api.ts", "sendMessage", { userId: abe.userId, body: "Are you there, Abe?" });
  const actingToAnn = await abe.call("lib/porch/api.ts", "sendMessage", { userId: ann.userId, body: "Sent as the ministry" });
  const actingRings = await abe.call("lib/porch/call-ask.ts", "ringPerson", { userId: ann.userId, video: false });
  record("isolation", "chat", "N7: acting as a ministry, Abe can't message or call his church (and Ann can't message him)", annToActing?.ok === false && actingToAnn?.ok === false && actingRings?.ok === false);
  const teamNote = await abe.call("lib/porch/porch-join.ts", "sendMinistryTeamMessage", { body: "Team note from Abe" });
  const teamList = await abe.call("lib/porch/porch-join.ts", "ministryTeamMessages");
  record("sanity", "chat", "N7: the ministry's admins write to each other in Team messages", teamNote?.ok === true && has(teamList, "Team note from Abe"));
  const annTeamRead = await ann.call("lib/porch/porch-join.ts", "ministryTeamMessages");
  const annTeamWrite = await ann.call("lib/porch/porch-join.ts", "sendMinistryTeamMessage", { body: "Ann sneaking in" });
  record("isolation", "chat", "N7: someone who isn't one of its admins can't read or write the ministry's Team messages", annTeamRead?.ok === false && !has(annTeamRead, "Team note from Abe") && annTeamWrite?.ok === false);
  const actingFeed = await abe.call("lib/porch/api.ts", "getFeed", { filter: "all" });
  const actingServe = await abe.call("lib/porch/serve.ts", "loadServe");
  record("isolation", "feed", "While acting as the ministry, Abe's church porch is closed (no A posts, no A Serve form)", !has(actingFeed, "A private post in Porch A") && actingServe?.sent === false);
  const actingPost = await abe.call("lib/porch/api.ts", "createPost", { room: "proclaim", body: "Posted while acting as the ministry" });
  const annFeedNow = await ann.call("lib/porch/api.ts", "getFeed", { filter: "all" });
  record("isolation", "feed", "A post written while acting as the ministry is refused (it never lands in Porch A)", actingPost?.ok === false && !has(annFeedNow, "Posted while acting as the ministry"));
  const abeBack = await abe.call("lib/porch/porch-join.ts", "actAs", { porchId: 0 });
  const abeFeedBack = await abe.call("lib/porch/api.ts", "getFeed", { filter: "all" });
  record("sanity", "feed", "Continue as me: Abe is back in Porch A and sees its posts", abeBack?.ok === true && has(abeFeedBack, "A private post in Porch A"));
  const annToAbeAgain = await ann.call("lib/porch/api.ts", "sendMessage", { userId: abe.userId, body: "Welcome back, Abe" });
  record("sanity", "chat", "N7: back as himself, Abe can be messaged by Ann again (same church)", annToAbeAgain?.ok === true);
  // N4: inside the church, people show by their full name, never their username.
  const annPeople = await ann.call("lib/porch/roll.ts", "listPorch");
  record("isolation", "people", "N4: inside Porch A, Abe shows by his full name, not his username", has(annPeople, "Abe Member") && !has(annPeople, "abe.m"));
  await abe.call("lib/porch/api.ts", "updateMe", { displayName: "Abe M. Member" });
  const annSeesAbe = await ann.call("lib/porch/membership.ts", "memberDetailsOf", { userId: abe.userId });
  record("sanity", "details", "N4: changing his name on his profile changes the name Porch A knows (one name inside the church)", annSeesAbe?.ok === true && annSeesAbe?.details?.fullName === "Abe M. Member");

  // ---------------- N3: Leave this church ----------------
  console.log("\nLeaving a church (N3)");
  await faye.call("lib/porch/api.ts", "createPost", { room: "proclaim", body: "Faye's post in A" });
  const fayeForm = { ...form, firstName: "Faye", lastName: "Volunteer", email: "faye@two-church.test" };
  const fayeServe = await faye.call("lib/porch/serve.ts", "saveServe", { form: fayeForm });
  const annLeaves = await ann.call("lib/porch/membership.ts", "leaveChurch");
  record("sanity", "joining", "Porch A's only admin can't leave while it has other members", annLeaves?.ok === false);
  const fayeLeaves = await faye.call("lib/porch/membership.ts", "leaveChurch");
  const fayeAfter = await faye.call("lib/porch/membership.ts", "accountState");
  const fayeFeedAfter = await faye.call("lib/porch/api.ts", "getFeed", { filter: "all" });
  record("sanity", "joining", "Faye leaves Porch A: she's in no church, and A's porch is closed to her", fayeServe?.ok === true && fayeLeaves?.ok === true && fayeAfter?.member === false && !has(fayeFeedAfter, "A private post in Porch A"));
  const annFeedAfter = await ann.call("lib/porch/api.ts", "getFeed", { filter: "all" });
  record("sanity", "feed", "Faye's posts stay in Porch A after she leaves", has(annFeedAfter, "Faye's post in A"));
  const annSeesFayeAfter = await ann.call("lib/porch/membership.ts", "memberDetailsOf", { userId: faye.userId });
  const annServeAfter = await ann.call("lib/porch/serve.ts", "downloadServe");
  const fayeServeAfter = await faye.call("lib/porch/serve.ts", "loadServe");
  const annToFaye = await ann.call("lib/porch/api.ts", "sendMessage", { userId: faye.userId, body: "Still there, Faye?" });
  record("isolation", "chat", "N7: once Faye has left, Ann can't message her (no shared church: their chat goes quiet)", annToFaye?.ok === false);
  record("isolation", "details", "Her details and her Serve form are gone from Porch A", annSeesFayeAfter?.ok === false && !has(annSeesFayeAfter, "Eldoret") && !pdfText(annServeAfter).includes("Volunteer") && fayeServeAfter?.sent === false);
  const fayeRejoin = await faye.call("lib/porch/membership.ts", "requestToJoin", { code: codeA, fullName: "Faye Joiner", phone: "+254711000002", city: "Eldoret" });
  record("sanity", "joining", "After leaving she can ask to join a church again (it waits for the admins)", fayeRejoin?.ok === true);

  // ---------------- Stage 6 + N5: the public porch ----------------
  console.log("\nThe public porch");
  const PUB = "lib/porch/public-porch.ts";
  // People never post publicly as themselves.
  const annAsHerself = await ann.call(PUB, "createPublicPost", { body: "Ann posting as herself" });
  const abeAsHimself = await abe.call(PUB, "createPublicPost", { body: "Abe posting as himself" });
  record("isolation", "feed", "People can't post on the public porch as themselves (only porches post)", annAsHerself?.ok === false && abeAsHimself?.ok === false);
  // A church's admin can continue as the church (and someone who isn't its admin can't).
  const annState6 = await ann.call("lib/porch/membership.ts", "accountState");
  record("sanity", "accounts", "Ann (A's admin) can continue as Porch A, not just ministries", (annState6?.ministries ?? []).some((m) => m.id === porchA && m.kind === "church"));
  const benActsA = await ben.call("lib/porch/porch-join.ts", "actAs", { porchId: porchA });
  record("isolation", "accounts", "Ben can't continue as Porch A (he isn't one of its admins)", benActsA?.ok === false);
  // Unapproved porches can't post publicly (Abe Ministry is still waiting).
  await abe.call("lib/porch/porch-join.ts", "actAs", { porchId: ministry?.id });
  const waitingPost = await abe.call(PUB, "createPublicPost", { body: "From a porch that isn't approved" });
  await abe.call("lib/porch/porch-join.ts", "actAs", { porchId: 0 });
  record("isolation", "feed", "A porch that isn't approved can't post publicly", waitingPost?.ok === false);
  // Ann posts publicly for Porch A.
  await ann.call("lib/porch/porch-join.ts", "actAs", { porchId: porchA });
  const aPublic = await ann.call(PUB, "createPublicPost", { body: "Porch A says hello to everyone" });
  await ann.call("lib/porch/porch-join.ts", "actAs", { porchId: 0 });
  record("sanity", "feed", "Ann, continuing as Porch A, posts on the public porch for it", aPublic?.ok === true);
  // Private posts never appear publicly.
  const benPublic0 = await ben.call(PUB, "publicFeed");
  const aPage = await ben.call(PUB, "porchPage", { porchId: porchA });
  const everything = JSON.stringify([benPublic0, aPage, await abe.call(PUB, "publicFeed")]);
  record("isolation", "feed", "Nothing from a church's private porch ever appears publicly", !everything.includes("A private post in Porch A") && !everything.includes("Private chat inside Porch A") && !everything.includes("Cara's post in B"));
  // You only see porches you follow; members follow their own church and can't unfollow it.
  record("isolation", "feed", "Ben doesn't see Porch A's public post (he doesn't follow A)", !has(benPublic0, "Porch A says hello"));
  const abePublic = await abe.call(PUB, "publicFeed");
  record("sanity", "feed", "Abe (a member of A) sees it: everyone follows their own church", has(abePublic, "Porch A says hello"));
  const abeUnfollow = await abe.call(PUB, "setFollow", { porchId: porchA, follow: false });
  record("sanity", "feed", "A member can't unfollow their own church", abeUnfollow?.ok === false);
  const benFind = await ben.call(PUB, "findPorches", { query: "Porch", type: "church" });
  const found = (benFind ?? []).map((p) => p.name);
  record("sanity", "feed", "Find porches finds approved churches only (Porch A, not the declined Porch E or the waiting ministry)", found.includes("Porch A") && !found.includes("Porch E") && !found.includes("Abe Ministry"));
  await ben.call(PUB, "setFollow", { porchId: porchA, follow: true });
  const benPublic1 = await ben.call(PUB, "publicFeed");
  record("sanity", "feed", "Ben follows Porch A: now he sees its public post (and still none of its private posts)", has(benPublic1, "Porch A says hello") && !has(benPublic1, "A private post in Porch A"));
  // Everyone can react, by username (plus church unless they hide it); nobody can comment.
  const aPostId = (benPublic1?.posts ?? []).find((p) => p.body === "Porch A says hello to everyone")?.id;
  const benReacts = await ben.call(PUB, "reactPublic", { postId: aPostId, kind: "care" });
  const fayeReacts = await faye.call(PUB, "reactPublic", { postId: aPostId, kind: "thanks" });
  const seen = (await abe.call(PUB, "publicFeed"))?.posts?.find((p) => p.id === aPostId);
  record("sanity", "feed", "Anyone with an account can react on a public post (Ben in B, Faye in no church)", benReacts?.ok === true && fayeReacts?.ok === true && seen?.reactions?.find((r) => r.kind === "care")?.count === 1);
  record("sanity", "people", "Public reactions show usernames, plus the church for members", (seen?.reactors ?? []).some((r) => r.church === "Porch B") && !(seen?.reactors ?? []).some((r) => r.name === "Ben Other"));
  const benUnfollow = await ben.call(PUB, "setFollow", { porchId: porchA, follow: false });
  const benPublic2 = await ben.call(PUB, "publicFeed");
  record("sanity", "feed", "Ben unfollows Porch A: its posts leave his public porch", benUnfollow?.ok === true && !has(benPublic2, "Porch A says hello"));
  // Sharing a public post into a church is a link, inside that church only.
  const abeShares = await abe.call(PUB, "sharePublicPost", { postId: aPostId });
  const annPrivate = await ann.call("lib/porch/api.ts", "getFeed", { filter: "all" });
  const benPrivate = await ben.call("lib/porch/api.ts", "getFeed", { filter: "all" });
  record("sanity", "feed", "Abe shares a public post into Porch A as a link", abeShares?.ok === true && (annPrivate?.posts ?? []).some((p) => p.sharedPublicPostId === aPostId));
  record("isolation", "feed", "A share into Porch A stays in Porch A (Ben's church never sees it)", !(benPrivate?.posts ?? []).some((p) => p.sharedPublicPostId === aPostId));

  // ---------------- Stage 5d: admin levels ----------------
  console.log("\nAdmin levels");
  const LV = "lib/porch/admin-levels.ts";
  const MB = "lib/porch/membership.ts";
  const mo = await person("Mo Membership", "mo@two-church.test");
  const mia = await person("Mia Moderator", "mia@two-church.test");
  const pat = await person("Pat Publisher", "pat@two-church.test");
  for (const p of [mo, mia, pat]) {
    await verify(p);
    await helper("joinPorch", { email: p.email, porchId: porchA });
  }
  const abeAdds = await abe.call(LV, "addAdmin", { userId: mo.userId, level: "membership" });
  record("isolation", "admins", "A plain member (Abe) can't name admins", abeAdds?.ok === false);
  const added = await Promise.all([
    ann.call(LV, "addAdmin", { userId: mo.userId, level: "membership" }),
    ann.call(LV, "addAdmin", { userId: mia.userId, level: "moderator" }),
    ann.call(LV, "addAdmin", { userId: pat.userId, level: "public_editor" }),
  ]);
  const listA = await ann.call(LV, "listAdmins");
  const levelOf = (id) => (listA?.admins ?? []).find((a) => a.userId === id)?.level;
  record("sanity", "admins", "Ann (Lead admin) names a Membership admin, a Moderator and a Public page editor", added.every((r) => r?.ok === true) && levelOf(ann.userId) === "lead" && levelOf(mo.userId) === "membership" && levelOf(mia.userId) === "moderator" && levelOf(pat.userId) === "public_editor");
  const outsider = await ann.call(LV, "addAdmin", { userId: ben.userId, level: "moderator" });
  record("isolation", "admins", "Only a member of the church can be one of its admins (Ben, in B, can't be made A's admin)", outsider?.ok === false);
  // Abe asks to join nothing; Faye's request to A is waiting (she asked again after leaving).
  const abePost = await abe.call("lib/porch/api.ts", "createPost", { room: "proclaim", body: "Abe's post for the moderator test" });
  const abePostId = ((await ann.call("lib/porch/api.ts", "getFeed", { filter: "all" }))?.posts ?? []).find((p) => p.body === "Abe's post for the moderator test")?.id;
  // Moderator: posts and complaints; no member details, no join requests, no public posting.
  const miaDetails = await mia.call(MB, "memberDetailsOf", { userId: abe.userId });
  const miaWaiting = await mia.call(MB, "waitingToJoin");
  const miaCount = await mia.call(MB, "waitingJoinCount");
  record("isolation", "details", "A Moderator can't see member details (no phone numbers)", miaDetails?.ok === false && !has(miaDetails, "+256700000030"));
  record("isolation", "joining", "A Moderator can't see or decide join requests", miaWaiting?.ok === false && miaCount?.count === 0);
  const miaComplaints = await mia.call("lib/porch/trouble.ts", "loadTrouble", { reports: true });
  record("sanity", "feedback", "A Moderator handles complaints", miaComplaints?.founder === true);
  const miaRemoves = await mia.call("lib/porch/api.ts", "deletePost", { id: abePostId });
  const afterRemove = await ann.call("lib/porch/api.ts", "getFeed", { filter: "all" });
  record("sanity", "feed", "A Moderator can remove someone else's post in the church", abePost?.ok === true && miaRemoves?.ok === true && !has(afterRemove, "Abe's post for the moderator test"));
  const miaRemovesB = await mia.call("lib/porch/api.ts", "deletePost", { id: ((await ben.call("lib/porch/api.ts", "getFeed", { filter: "all" }))?.posts ?? [])[0]?.id });
  record("isolation", "feed", "…but never a post in another church", miaRemovesB?.ok === false);
  const miaActs = await mia.call("lib/porch/porch-join.ts", "actAs", { porchId: porchA });
  record("isolation", "admins", "A Moderator can't post on the public porch for the church", miaActs?.ok === false);
  // Membership admin: join requests and member details; no moderating, no public posting.
  const moDetails = await mo.call(MB, "memberDetailsOf", { userId: abe.userId });
  const moWaiting = await mo.call(MB, "waitingToJoin");
  record("sanity", "details", "A Membership admin sees member details and the join requests", moDetails?.ok === true && moDetails?.details?.phone === "+256700000030" && moWaiting?.ok === true && has(moWaiting, "Faye Joiner"));
  const abePost2 = await abe.call("lib/porch/api.ts", "createPost", { room: "proclaim", body: "Abe's second post" });
  const abePost2Id = ((await ann.call("lib/porch/api.ts", "getFeed", { filter: "all" }))?.posts ?? []).find((p) => p.body === "Abe's second post")?.id;
  const moRemoves = await mo.call("lib/porch/api.ts", "deletePost", { id: abePost2Id });
  const moActs = await mo.call("lib/porch/porch-join.ts", "actAs", { porchId: porchA });
  const moAdds = await mo.call(LV, "addAdmin", { userId: abe.userId, level: "moderator" });
  record("isolation", "admins", "A Membership admin can't remove posts, post publicly, or name admins", abePost2?.ok === true && moRemoves?.ok === false && moActs?.ok === false && moAdds?.ok === false);
  // Public page editor: posts publicly for the church; can't let people in or see details.
  const patActs = await pat.call("lib/porch/porch-join.ts", "actAs", { porchId: porchA });
  const patPosts = await pat.call("lib/porch/public-porch.ts", "createPublicPost", { body: "Posted by A's public page editor" });
  await pat.call("lib/porch/porch-join.ts", "actAs", { porchId: 0 });
  record("sanity", "admins", "A Public page editor continues as the church and posts on the public porch", patActs?.ok === true && patPosts?.ok === true);
  const fayeReq = ((await mo.call(MB, "waitingToJoin"))?.people ?? []).find((p) => p.fullName === "Faye Joiner");
  const patLetsIn = await pat.call(MB, "decideJoinRequest", { id: fayeReq?.id, letIn: true });
  const patDetails = await pat.call(MB, "memberDetailsOf", { userId: abe.userId });
  const fayeStillOut = await helper("person", { email: faye.email });
  record("isolation", "joining", "A Public page editor can't let people in or see member details", patLetsIn?.ok === false && patDetails?.ok === false && (fayeStillOut.porch_id === null || fayeStillOut.porch_id === undefined));
  // Office head: sees the details of people who contacted their office, and nobody else's.
  await ann.call("lib/porch/offices.ts", "setOfficeHead", { key: "pastor", userId: pat.userId });
  const headSeesAbe = await pat.call(MB, "memberDetailsOf", { userId: abe.userId });
  const headSeesMo = await pat.call(MB, "memberDetailsOf", { userId: mo.userId });
  record("sanity", "details", "An office head sees the details of a member who contacted their office (Abe wrote to the pastor's office)", headSeesAbe?.ok === true);
  record("isolation", "details", "…but not of someone who didn't contact it", headSeesMo?.ok === false);
  await ann.call("lib/porch/offices.ts", "setOfficeHead", { key: "pastor", userId: ann.userId });
  // A porch always keeps a Lead admin; Lead can be handed over.
  const annDemotes = await ann.call(LV, "setAdminLevel", { userId: ann.userId, level: "moderator" });
  const annRemoves = await ann.call(LV, "removeAdmin", { userId: ann.userId });
  record("sanity", "admins", "The last Lead admin can't step down or be removed", annDemotes?.ok === false && annRemoves?.ok === false);
  const handOver = await ann.call(LV, "setAdminLevel", { userId: mo.userId, level: "lead" });
  const annSteps = await ann.call(LV, "setAdminLevel", { userId: ann.userId, level: "moderator" });
  const annNowAdds = await ann.call(LV, "addAdmin", { userId: abe.userId, level: "moderator" });
  record("sanity", "admins", "Ann hands Lead to Mo, steps down to Moderator, and can no longer name admins", handOver?.ok === true && annSteps?.ok === true && annNowAdds?.ok === false);
  const moRestores = await mo.call(LV, "setAdminLevel", { userId: ann.userId, level: "lead" });
  record("sanity", "admins", "The new Lead admin (Mo) can make Ann Lead admin again", moRestores?.ok === true);
  // Ministries: Lead admins and Public page editors only.
  await verify(ben);
  await ben.call(MB, "setUsername", { username: "ben.b" });
  await abe.call("lib/porch/porch-join.ts", "actAs", { porchId: ministry?.id });
  const ministryModerator = await abe.call(LV, "addAdmin", { userId: ben.userId, level: "moderator" });
  const ministryEditor = await abe.call(LV, "addAdmin", { userId: ben.userId, level: "public_editor" });
  const ministryList = await abe.call(LV, "listAdmins");
  await abe.call("lib/porch/porch-join.ts", "actAs", { porchId: 0 });
  record("sanity", "admins", "A ministry has Lead admins and Public page editors only (Ben added as editor, by username)", ministryModerator?.ok === false && ministryEditor?.ok === true && (ministryList?.levels ?? []).length === 2 && (ministryList?.admins ?? []).some((a) => a.name === "@ben.b" && a.level === "public_editor"));
  // Fix 3: anyone who runs a porch follows it, and can't unfollow it while they're its admin.
  await olive.call("lib/porch/porch-join.ts", "decidePorch", { id: ministry?.id, approve: true });
  const benFollows = await ben.call("lib/porch/public-porch.ts", "findPorches", { query: "Abe Ministry" });
  const benUnfollows = await ben.call("lib/porch/public-porch.ts", "setFollow", { porchId: ministry?.id, follow: false });
  record("sanity", "feed", "Running a porch means following it, and you can't unfollow it while you're its admin", (benFollows ?? []).some((p) => p.name === "Abe Ministry" && p.following && p.adminHere) && benUnfollows?.ok === false);

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
