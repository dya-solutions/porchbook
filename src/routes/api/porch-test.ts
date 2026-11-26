import { createFileRoute } from "@tanstack/react-router";
import { newCode } from "@/lib/porch/porch-join";
import { dbSource, getSql } from "@/lib/db";

/**
 * Helper for the two-church test (scripts/two-church-test.mjs) ONLY.
 *
 * It answers only when the test started its own separate copy of the app with
 * PORCH_TEST_MODE=1 and a throw-away local database. In the normal app, and anywhere
 * with a real database, it says "not found" and does nothing.
 */
function enabled() {
  // Never online: a deployed app (Vercel) refuses this helper whatever its settings say.
  if (process.env.VERCEL || process.env.NODE_ENV === "production") return false;
  return process.env.PORCH_TEST_MODE === "1" && dbSource === "pglite";
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function userIdOf(email: unknown) {
  const sql = await getSql();
  const rows = await sql.query<{ user_id: string }>("select user_id from profiles where lower(email) = lower($1)", [String(email ?? "")]);
  return rows[0]?.user_id ?? "";
}

export const Route = createFileRoute("/api/porch-test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!enabled()) return new Response("Not found", { status: 404 });
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const sql = await getSql();
        try {
          switch (body.action) {
            case "porch": {
              const rows = await sql.query("select id, name, kind, status, verified from porches where id = $1", [Number(body.porchId)]);
              return json({ ok: true, porch: rows[0] ?? null });
            }
            case "porchInfo": {
              const rows = await sql.query("select id, name, kind, status, verified, invite_code, main_porch_id, created_by from porches where name = $1 order by id desc limit 1", [String(body.name ?? "")]);
              return json({ ok: true, porch: rows[0] ?? null });
            }
            case "createPorch": {
              const rows = await sql.query<{ id: number }>(
                "insert into porches (name, kind, status) values ($1, $2, 'approved') returning id",
                [String(body.name ?? "Test porch"), String(body.kind ?? "church")],
              );
              await sql.query("insert into porch_settings (porch_id) values ($1) on conflict do nothing", [rows[0].id]);
              // Only churches have an invite code (decision 40).
              const code = String(body.kind ?? "church") === "church" ? newCode() : null;
              if (code) await sql.query("update porches set invite_code = $2 where id = $1", [rows[0].id, code]);
              return json({ ok: true, id: rows[0].id, code });
            }
            case "person": {
              const userId = await userIdOf(body.email);
              const rows = await sql.query(
                "select my_porch(user_id) as porch_id, is_porch_admin(user_id) as admin, is_platform_owner(user_id) as owner, (select coalesce(array_agg(porch_id order by porch_id), '{}') from porch_members m where m.user_id = profiles.user_id) as porches from profiles where user_id = $1",
                [userId],
              );
              return json({ ok: true, userId, ...(rows[0] ?? {}) });
            }
            case "joinPorch": {
              const userId = await userIdOf(body.email);
              // One church each: joining here moves the person (they leave the church they were in).
              await sql.query("delete from porch_members where user_id = $1 and porch_id <> $2", [userId, Number(body.porchId)]);
              await sql.query("insert into porch_members (porch_id, user_id, full_name) select $2, user_id, display_name from profiles where user_id = $1 on conflict do nothing", [userId, Number(body.porchId)]);
              await sql.query("update profiles set porch_id = $2 where user_id = $1", [userId, Number(body.porchId)]);
              return json({ ok: true });
            }
            case "addMember": {
              // A second (or third) porch: a membership only. The porch they're switched to stays.
              const userId = await userIdOf(body.email);
              // No "on conflict": the database must refuse a second church, or a ministry, out loud.
              await sql.query("insert into porch_members (porch_id, user_id, full_name) select $2, user_id, display_name from profiles where user_id = $1", [userId, Number(body.porchId)]);
              return json({ ok: true });
            }
            case "removeMember": {
              const userId = await userIdOf(body.email);
              await sql.query("delete from porch_members where porch_id = $2 and user_id = $1", [userId, Number(body.porchId)]);
              return json({ ok: true });
            }
            case "pair": {
              const a = await userIdOf(body.email);
              const b = await userIdOf(body.other);
              const rows = await sql.query("select same_porch($1, $2) as same, is_admin_of($1, $3) as admin_of", [a, b, Number(body.porchId) || 0]);
              return json({ ok: true, ...(rows[0] ?? {}) });
            }
            case "makeAdmin": {
              const userId = await userIdOf(body.email);
              await sql.query("insert into porch_admins (porch_id, user_id, added_by) values ($1, $2, 'test') on conflict do nothing", [
                Number(body.porchId),
                userId,
              ]);
              return json({ ok: true });
            }
            case "makeOwner": {
              const userId = await userIdOf(body.email);
              await sql.query("insert into platform_owners (user_id) values ($1) on conflict do nothing", [userId]);
              return json({ ok: true });
            }
            default:
              return json({ ok: false, error: "Unknown action" }, 400);
          }
        } catch (error) {
          return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
        }
      },
    },
  },
});
