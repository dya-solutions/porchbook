import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { DEFAULT_THEME, THEMES, type ThemeId } from "@/lib/porch/themes";
import { DEFAULT_ACCENT, isAccent, type AccentId, type LookMode } from "@/lib/porch/brand";

/** The viewer's church porch as the top bar shows it: its name, initials and theme (Stage 4a). */
export type PorchLook = {
  name: string;
  shortName: string;
  initials: string;
  theme: ThemeId;
  admin: boolean;
  tourOff: string[];
  member: boolean;
  owner: boolean;
  waiting: boolean;
  /** Stage 4e: the church's accent colour, and this member's own Light or Dark. */
  accent: AccentId;
  mode: LookMode;
};

/** The Tour doors a porch can switch on or off in Porch settings (Stage 4c). */
export const TOUR_DOORS = [
  { key: "pray", name: "Pray" },
  { key: "my20", name: "My 20" },
  { key: "events", name: "Events" },
  { key: "groups", name: "Groups" },
  { key: "serve", name: "Serve" },
  { key: "transport", name: "Transport" },
  { key: "feedback", name: "Feedback" },
] as const;
const DOOR_KEYS = new Set<string>(TOUR_DOORS.map((door) => door.key));

function doorList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.replace(/[{}"]/g, "").split(",") : [];
  return list.map((item) => String(item).trim()).filter((item) => DOOR_KEYS.has(item));
}

const isTrue = (value: unknown) => value === true || value === "t";

function initialsOf(name: string) {
  const words = name.split(/\s+/).filter((word) => /^[\p{L}\p{N}]/u.test(word));
  return (words.slice(0, 2).map((word) => word[0]).join("") || "P").toUpperCase();
}

export const myPorchLook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<PorchLook> => {
    const sql = await getSql();
    const rows = await sql.query<{ name: string; short_name: string; theme: string | null; admin: unknown; tour_off: unknown; status: string; accent: string | null }>(
      `select p.name, p.short_name, p.status, s.theme, s.tour_off, s.accent, is_porch_admin($1) as admin
         from porches p left join porch_settings s on s.porch_id = p.id
        where p.id = my_porch($1)`,
      [context.userId],
    );
    const row = rows[0];
    const name = row?.name ?? "Porchbook";
    const shortName = row?.short_name || name;
    const theme = (THEMES.some((t) => t.id === row?.theme) ? row?.theme : DEFAULT_THEME) as ThemeId;
    const admin = row?.admin === true || row?.admin === "t";
    const owner = await sql.query<{ owner: unknown; mode: string | null }>(
      "select is_platform_owner($1) as owner, (select look_mode from profiles where user_id = $1) as mode",
      [context.userId],
    );
    return {
      name,
      shortName,
      initials: initialsOf(shortName),
      theme,
      admin,
      tourOff: doorList(row?.tour_off),
      // Stage 5a: not in a church yet (joins with an invite code), and the platform owner.
      member: Boolean(row),
      owner: isTrue(owner[0]?.owner),
      waiting: row?.status === "waiting",
      accent: isAccent(row?.accent) ? row.accent : DEFAULT_ACCENT,
      mode: owner[0]?.mode === "dark" ? "dark" : "light",
    };
  });

/** A porch admin chooses the porch's theme (Porch settings, Stage 4c). */
export const setPorchTheme = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const theme = input && typeof input === "object" ? (input as { theme?: unknown }).theme : "";
    return { theme: THEMES.some((t) => t.id === theme) ? (theme as ThemeId) : null };
  })
  .handler(async ({ context, data }) => {
    if (!data.theme) return { ok: false as const, error: "Choose a theme." };
    const sql = await getSql();
    const me = await sql.query<{ admin: unknown }>("select is_porch_admin($1) as admin", [context.userId]);
    if (!(me[0]?.admin === true || me[0]?.admin === "t")) return { ok: false as const, error: "Only a porch admin can change the theme." };
    await sql.query(
      `insert into porch_settings (porch_id, theme, updated_at) values (my_porch($1), $2, now())
       on conflict (porch_id) do update set theme = excluded.theme, updated_at = now()`,
      [context.userId, data.theme],
    );
    return { ok: true as const };
  });

/** A porch admin switches Tour doors on or off for everyone in the porch (Stage 4c). */
export const setTourDoors = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ off: doorList(input && typeof input === "object" ? (input as { off?: unknown }).off : []) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await sql.query<{ admin: unknown }>("select is_porch_admin($1) as admin", [context.userId]);
    if (!isTrue(me[0]?.admin)) return { ok: false as const, error: "Only a porch admin can change the Tour." };
    if (data.off.length >= TOUR_DOORS.length) return { ok: false as const, error: "Keep at least one door on the Tour." };
    await sql.query(
      `insert into porch_settings (porch_id, tour_off, updated_at) values (my_porch($1), $2, now())
       on conflict (porch_id) do update set tour_off = excluded.tour_off, updated_at = now()`,
      [context.userId, data.off],
    );
    return { ok: true as const };
  });

/** A porch admin chooses the church's accent colour (Stage 4e, Porch settings). */
export const setPorchAccent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const accent = input && typeof input === "object" ? (input as { accent?: unknown }).accent : "";
    return { accent: isAccent(accent) ? accent : null };
  })
  .handler(async ({ context, data }) => {
    if (!data.accent) return { ok: false as const, error: "Choose an accent colour." };
    const sql = await getSql();
    const me = await sql.query<{ admin: unknown }>("select is_porch_admin($1) as admin", [context.userId]);
    if (!isTrue(me[0]?.admin)) return { ok: false as const, error: "Only a porch admin can change the accent colour." };
    await sql.query(
      `insert into porch_settings (porch_id, accent, updated_at) values (my_porch($1), $2, now())
       on conflict (porch_id) do update set accent = excluded.accent, updated_at = now()`,
      [context.userId, data.accent],
    );
    return { ok: true as const };
  });

/** Each member chooses Light or Dark for themselves (Stage 4e, Your account). */
export const setMyLookMode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const mode = input && typeof input === "object" ? (input as { mode?: unknown }).mode : "";
    return { mode: mode === "dark" ? ("dark" as const) : ("light" as const) };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const done = await sql.query<{ user_id: string }>("update profiles set look_mode = $2 where user_id = $1 returning user_id", [context.userId, data.mode]);
    if (!done.length) return { ok: false as const, error: "Your profile isn't ready yet." };
    return { ok: true as const, mode: data.mode };
  });
