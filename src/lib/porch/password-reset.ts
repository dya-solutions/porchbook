import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";

/**
 * Founder-only: give a member a temporary password when they forget theirs.
 * There is no email sending on Porchbook, so the founder passes the new
 * password on in person. Every session the member had is signed out.
 */

const MIN = 8;
const MAX = 128;

function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

export const founderResetPassword = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    return {
      userId: typeof raw.userId === "string" ? raw.userId.trim().slice(0, 200) : "",
      password: typeof raw.password === "string" ? raw.password : "",
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await sql.query<{ is_founder: boolean }>(
      "select is_porch_admin($1) as is_founder",
      [context.userId],
    );
    if (!boolish(me[0]?.is_founder)) {
      noteAttempt(context.userId, "password-reset", "Tried to reset another member's password.");
      return { ok: false as const, error: "Only an admin can reset passwords." };
    }
    if (!data.userId || data.userId === context.userId) {
      return { ok: false as const, error: "Choose another member. Change your own password from your account." };
    }
    if (data.password.length < MIN) {
      return { ok: false as const, error: `Use at least ${MIN} characters.` };
    }
    if (data.password.length > MAX) {
      return { ok: false as const, error: "That password is too long." };
    }

    const { auth } = await import("@/lib/auth/server");
    const ctx = await auth.$context;
    if (!(await ctx.internalAdapter.findUserById(data.userId))) {
      return { ok: false as const, error: "That member wasn't found." };
    }
    const hashed = await ctx.password.hash(data.password);
    const accounts = await ctx.internalAdapter.findAccounts(data.userId);
    if (accounts.some((account) => account.providerId === "credential")) {
      await ctx.internalAdapter.updatePassword(data.userId, hashed);
    } else {
      await ctx.internalAdapter.createAccount({
        userId: data.userId,
        providerId: "credential",
        accountId: data.userId,
        password: hashed,
      });
    }
    await ctx.internalAdapter.deleteUserSessions(data.userId);
    return { ok: true as const };
  });

/** Whether the signed-in viewer is the founder (shows the reset control). */
export const amIFounder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const me = await sql.query<{ is_founder: boolean }>(
      "select is_porch_admin($1) as is_founder",
      [context.userId],
    );
    return { founder: boolish(me[0]?.is_founder) };
  });
