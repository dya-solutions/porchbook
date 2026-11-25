// Test data for the online site (porchbook.app) while JT builds. Made-up people only.
//
//   node --env-file=<file with DATABASE_URL> scripts/online-test-data.mjs show
//   node --env-file=<file with DATABASE_URL> scripts/online-test-data.mjs add  <passwords-file.md>
//   node --env-file=<file with DATABASE_URL> scripts/online-test-data.mjs remove          (only counts)
//   node --env-file=<file with DATABASE_URL> scripts/online-test-data.mjs remove --yes    (really removes)
//
// How test data is marked, so it can all be found and removed in one go before launch:
//   - every test person's email ends in @test.porchbook.app (a made-up address nobody can own);
//   - every test church is listed in the table porch_test_data, and its name ends in "(TEST)".
// Passwords are written only to the file given to "add" (TEST-ACCOUNT.md, outside the code folder).
// The script never prints the database address.

import pg from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { hashPassword } from "better-auth/crypto";

const TEST_DOMAIN = "@test.porchbook.app";
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL: pass the settings file with --env-file.");
  process.exit(1);
}
const [command = "show", arg] = process.argv.slice(2);
const pool = new pg.Pool({ connectionString: url, max: 2 });

const churches = [
  {
    key: "alpha",
    name: "Alpha Test Church (TEST)",
    shortName: "Alpha (TEST)",
    town: "Testville",
    accent: "teal",
    people: [
      { name: "Pastor Alpha Tester", user: "alpha.pastor", admin: true },
      { name: "Ada Testmember", user: "alpha.ada" },
      { name: "Ben Testmember", user: "alpha.ben" },
      { name: "Wanda Waiting Tester", user: "alpha.wanda", waiting: true },
      { name: "Walter Waiting Tester", user: "alpha.walter", waiting: true },
    ],
  },
  {
    key: "bravo",
    name: "Bravo Test Church (TEST)",
    shortName: "Bravo (TEST)",
    town: "Mocktown",
    accent: "crimson",
    people: [
      { name: "Pastor Bravo Tester", user: "bravo.pastor", admin: true },
      { name: "Cora Testmember", user: "bravo.cora" },
      { name: "Wesley Waiting Tester", user: "bravo.wesley", waiting: true },
    ],
  },
];

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ2345679"; // same 31 characters as the app's invite codes
function inviteCode() {
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}
function password() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  const raw = [...bytes].map((b) => chars[b % chars.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

async function markTable(client) {
  await client.query("create table if not exists porch_test_data (porch_id integer primary key, added_at timestamptz not null default now())");
}

async function show() {
  const client = await pool.connect();
  try {
    await markTable(client);
    const people = await client.query(`select count(*)::int as n from "user" where lower(email) like $1`, [`%${TEST_DOMAIN}`]);
    const porches = await client.query("select p.id, p.name, p.status, p.invite_code from porches p join porch_test_data t on t.porch_id = p.id order by p.id");
    const all = await client.query(`select count(*)::int as n from "user"`);
    console.log(`Test people: ${people.rows[0].n} (of ${all.rows[0].n} accounts in all)`);
    for (const p of porches.rows) console.log(`Test church #${p.id}: ${p.name} (${p.status}), invite code ${p.invite_code}`);
    if (!porches.rows.length) console.log("Test churches: none");
  } finally {
    client.release();
  }
}

async function add(passwordsFile) {
  if (!passwordsFile) throw new Error("Give the passwords file (TEST-ACCOUNT.md) as the second word.");
  const client = await pool.connect();
  const lines = [];
  try {
    await markTable(client);
    const existing = await client.query(`select count(*)::int as n from "user" where lower(email) like $1`, [`%${TEST_DOMAIN}`]);
    if (existing.rows[0].n > 0) throw new Error("Test data is already there. Run \"remove --yes\" first if you want it fresh.");
    await client.query("begin");
    for (const church of churches) {
      const code = inviteCode();
      const porch = await client.query(
        `insert into porches (name, short_name, kind, town, country, status, verified, invite_code, decided_at)
         values ($1, $2, 'church', $3, 'Uganda', 'approved', false, $4, now()) returning id`,
        [church.name, church.shortName, church.town, code],
      );
      const porchId = porch.rows[0].id;
      await client.query("insert into porch_test_data (porch_id) values ($1)", [porchId]);
      await client.query("insert into porch_settings (porch_id, accent) values ($1, $2) on conflict (porch_id) do update set accent = excluded.accent", [porchId, church.accent]);
      lines.push("", `### ${church.name}`, "", `Invite code: \`${code}\``, "", "| Name | Email | Password | What they are |", "| --- | --- | --- | --- |");
      let n = 0;
      for (const person of church.people) {
        n += 1;
        const id = randomUUID().replace(/-/g, "");
        const email = `${person.user}${TEST_DOMAIN}`;
        const pass = password();
        const hash = await hashPassword(pass);
        const phone = `+256 700 000 ${String(church.key === "alpha" ? 100 + n : 200 + n)}`;
        const address = `${n} Pretend Road, ${church.town}`;
        await client.query(`insert into "user" (id, name, email, "emailVerified") values ($1, $2, $3, true)`, [id, person.name, email]);
        await client.query(
          `insert into "account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
           values ($1, $2, 'credential', $2, $3, now(), now())`,
          [randomUUID().replace(/-/g, ""), id, hash],
        );
        await client.query(
          `insert into profiles (user_id, display_name, email, email_verified_at, username, porch_id)
           values ($1, $2, $3, now(), $4, $5)`,
          [id, person.name, email, person.user.replace(".", "_"), person.waiting ? null : porchId],
        );
        if (person.waiting) {
          await client.query(
            "insert into join_requests (porch_id, user_id, full_name, nation, phone, address) values ($1, $2, $3, 'Uganda', $4, $5)",
            [porchId, id, person.name, phone, address],
          );
        } else {
          await client.query(
            "insert into member_details (user_id, porch_id, nation, phone, address) values ($1, $2, 'Uganda', $3, $4)",
            [id, porchId, phone, address],
          );
        }
        if (person.admin) await client.query("insert into porch_admins (porch_id, user_id, added_by) values ($1, $2, 'test-data')", [porchId, id]);
        const what = person.admin ? "Admin (pastor)" : person.waiting ? "Waiting to join" : "Member";
        lines.push(`| ${person.name} | ${email} | \`${pass}\` | ${what} |`);
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  appendFileSync(
    passwordsFile,
    [
      "",
      "## Online test churches (porchbook.app)",
      "",
      `Added ${new Date().toISOString().slice(0, 10)}. Made-up people only; all emails end in ${TEST_DOMAIN}, so no code is ever emailed to them.`,
      "Remove them all before launch: see DEPLOY.md, \"Before launch\".",
      ...lines,
      "",
    ].join("\n"),
  );
  console.log("Added the test churches. Passwords are in the passwords file (not printed here).");
  await show();
}

/** Every table with one of these columns gets its test rows removed. */
const PERSON_COLUMNS = ["user_id", "author_id", "userId", "owner_id", "sender_id", "member_id", "from_user", "to_user", "recipient_id"];

async function remove(really) {
  const client = await pool.connect();
  try {
    await markTable(client);
    const people = (await client.query(`select id from "user" where lower(email) like $1`, [`%${TEST_DOMAIN}`])).rows.map((r) => r.id);
    const profileOnly = (await client.query(`select user_id from profiles where lower(coalesce(email, '')) like $1`, [`%${TEST_DOMAIN}`])).rows.map((r) => r.user_id);
    const ids = [...new Set([...people, ...profileOnly])];
    const porchIds = (await client.query("select porch_id from porch_test_data")).rows.map((r) => r.porch_id);
    console.log(`Found ${ids.length} test people and ${porchIds.length} test churches.`);
    const cols = (
      await client.query(
        `select table_name, column_name, data_type from information_schema.columns
          where table_schema = 'public' and (column_name = 'porch_id' or column_name = any($1))`,
        [PERSON_COLUMNS],
      )
    ).rows.filter((c) => !["porches", "porch_test_data", "user"].includes(c.table_name));

    await client.query("begin");
    let total = 0;
    // Rows can depend on each other, so go round until nothing more can be removed.
    for (let round = 0; round < 8; round += 1) {
      let removed = 0;
      for (const c of cols) {
        const isPorch = c.column_name === "porch_id";
        if (isPorch ? !porchIds.length : !ids.length) continue;
        if (!isPorch && !["text", "character varying"].includes(c.data_type)) continue;
        if (c.table_name === "profiles") continue; // profiles go last, and real people are only moved out
        await client.query("savepoint s");
        try {
          const r = await client.query(`delete from "${c.table_name}" where "${c.column_name}" = any($1)`, [isPorch ? porchIds : ids]);
          await client.query("release savepoint s");
          removed += r.rowCount ?? 0;
        } catch {
          await client.query("rollback to savepoint s"); // something still points at these rows: try again next round
        }
      }
      total += removed;
      if (!removed) break;
    }
    // Members of other churches are never touched: only test churches and test people go.
    // A real person who joined a test church just leaves it (their account stays).
    const moved = await client.query("update profiles set porch_id = null where porch_id = any($1) and not (user_id = any($2))", [porchIds, ids]);
    const profiles = await client.query("delete from profiles where user_id = any($1)", [ids]);
    const porches = await client.query("delete from porches where id = any($1)", [porchIds]);
    const users = await client.query(`delete from "user" where id = any($1)`, [ids]);
    await client.query("delete from porch_test_data where porch_id = any($1)", [porchIds]);
    console.log(`Removing: ${users.rowCount} test accounts, ${profiles.rowCount} profiles, ${porches.rowCount} churches, ${total} other rows (posts, requests, details…); ${moved.rowCount} real people moved out of test churches.`);
    if (really) {
      await client.query("commit");
      console.log("Removed.");
    } else {
      await client.query("rollback");
      console.log("Nothing removed yet: this was only a count. Add --yes to really remove.");
    }
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

try {
  if (command === "show") await show();
  else if (command === "add") await add(arg);
  else if (command === "remove") await remove(arg === "--yes");
  else console.log("Use: show | add <passwords-file> | remove [--yes]");
} catch (error) {
  console.error("Stopped:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
