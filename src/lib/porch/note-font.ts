import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

/** Each member's chosen font for their notes, kept on their account. */
export const NOTE_FONTS = ["book", "garamond", "lora", "clean", "hand", "script"] as const;
export type NoteFont = (typeof NOTE_FONTS)[number];
const isFont = (value: unknown): value is NoteFont => typeof value === "string" && (NOTE_FONTS as readonly string[]).includes(value);

export const getNoteFont = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await sql`create table if not exists note_fonts (user_id text primary key, font text not null default 'book')`;
    await sql`alter table note_fonts add column if not exists size integer not null default 3`;
    const rows = await sql.query<{ font: string; size: number }>("select font, size from note_fonts where user_id = $1", [context.userId]);
    const size = Number(rows[0]?.size ?? 3);
    return { font: isFont(rows[0]?.font) ? rows[0].font : ("book" as NoteFont), size: size >= 1 && size <= 5 ? size : 3 };
  });

export const setNoteFont = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as { font?: unknown; size?: unknown }) : {};
    const size = Math.round(Number(raw.size ?? 3));
    return { font: isFont(raw.font) ? raw.font : ("book" as NoteFont), size: size >= 1 && size <= 5 ? size : 3 };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`create table if not exists note_fonts (user_id text primary key, font text not null default 'book')`;
    await sql`alter table note_fonts add column if not exists size integer not null default 3`;
    await sql.query(
      "insert into note_fonts (user_id, font, size) values ($1, $2, $3) on conflict (user_id) do update set font = excluded.font, size = excluded.size",
      [context.userId, data.font, data.size],
    );
    return { ok: true as const };
  });
