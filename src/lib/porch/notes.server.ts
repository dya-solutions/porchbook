import type { Sql } from "@/lib/db";

/** Writes the bell's notifications (alongside the phone alerts). A failure never blocks the action. */
type Note = { userId: string; actorId: string; kind: "reaction" | "reply" | "question"; target?: "post" | "reply"; postId: number; refId: number; reaction?: string; snippet?: string };

const clip = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 140);

export async function recordNote(sql: Sql, note: Note) {
  if (!note.userId || note.userId === note.actorId) return;
  try {
    const target = note.target ?? "post";
    // A changed reaction replaces the old one (and comes back to the top).
    if (note.kind === "reaction") await dropNote(sql, { userId: note.userId, actorId: note.actorId, target, refId: note.refId });
    await sql.query(
      `insert into notifications (user_id, actor_id, kind, target, post_id, ref_id, reaction, snippet) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [note.userId, note.actorId, note.kind, target, note.postId, note.refId, note.reaction ?? "", clip(note.snippet ?? "")],
    );
  } catch {
    /* the bell is a convenience */
  }
}

/** A reaction taken back. */
export async function dropNote(sql: Sql, note: { userId: string; actorId: string; target: "post" | "reply"; refId: number }) {
  try {
    await sql.query("delete from notifications where user_id = $1 and actor_id = $2 and kind = 'reaction' and target = $3 and ref_id = $4", [
      note.userId,
      note.actorId,
      note.target,
      note.refId,
    ]);
  } catch {
    /* fine */
  }
}
