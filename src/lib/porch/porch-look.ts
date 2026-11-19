import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { DEFAULT_THEME, THEMES, type ThemeId } from "@/lib/porch/themes";

/** The viewer's church porch as the top bar shows it: its name, initials and theme (Stage 4a). */
export type PorchLook = { name: string; shortName: string; initials: string; theme: ThemeId; admin: boolean };

function initialsOf(name: string) {
  const words = name.split(/\s+/).filter((word) => /^[\p{L}\p{N}]/u.test(word));
  return (words.slice(0, 2).map((word) => word[0]).join("") || "P").toUpperCase();
}

export const myPorchLook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<PorchLook> => {
    const sql = await getSql();
    const rows = await sql.query<{ name: string; short_name: string; theme: string | null; admin: unknown }>(
      `select p.name, p.short_name, s.theme, is_porch_admin($1) as admin
         from porches p left join porch_settings s on s.porch_id = p.id
        where p.id = my_porch($1)`,
      [context.userId],
    );
    const row = rows[0];
    const name = row?.name ?? "Porchbook";
    const shortName = row?.short_name || name;
    const theme = (THEMES.some((t) => t.id === row?.theme) ? row?.theme : DEFAULT_THEME) as ThemeId;
    const admin = row?.admin === true || row?.admin === "t";
    return { name, shortName, initials: initialsOf(shortName), theme, admin };
  });

/** A porch admin chooses the porch's theme (the full settings screen comes in Stage 4c). */
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
