import { useEffect, useState } from "react";
import { authClient, authEnabled } from "./client";

/** Normalized user shape used across the app, auth on or off. */
export type AppUser = {
  id: string;
  displayName: string | null;
  primaryEmail: string | null;
  profileImageUrl: string | null;
  /** True when this is the sandbox/dev fallback (auth not configured). */
  isDevFallback: boolean;
};

/**
 * Stable fallback user, used ONLY when auth is disabled
 * (`VITE_AUTH_ENABLED=false`, the shipped default). With auth on, the sandbox
 * live preview does real sign-in via the baked preview client. Its id is
 * `"dev-user"` — the SAME id `verify.server.ts` returns server-side — so per-user
 * rows written in that mode belong to one consistent owner.
 */
export const DEV_USER: AppUser = {
  id: "dev-user",
  displayName: "Dev User",
  primaryEmail: "dev@example.com",
  profileImageUrl: null,
  isDevFallback: true,
};

/** `useCurrentUserState()` result: the user plus the session-loading flag. */
export type CurrentUserState = {
  /** The user — `null` BOTH while the session loads and when signed out. */
  user: AppUser | null;
  /** True while the session is still resolving — don't treat `user: null` as signed out yet. */
  isPending: boolean;
};

/**
 * Current user + loading state. Same behavior in live preview and when deployed:
 *   - Auth enabled -> the real signed-in user; `user` is `null` while
 *                            the session resolves (`isPending: true`) and when
 *                            signed out (`isPending: false`). Session comes from
 *                            Better Auth `useSession()` → `/api/auth/get-session`
 *                            (cookie when deployed; bearer in live preview).
 *   - Auth disabled (`VITE_AUTH_ENABLED=false`) -> `DEV_USER`, never pending.
 *
 * Protect a route by waiting out `isPending` before acting on `user` —
 * redirecting on `user: null` alone bounces signed-in visitors to sign-in on
 * every hard reload:
 *
 *   import { RedirectToSignIn } from "@/lib/auth/gates";
 *   const { user, isPending } = useCurrentUserState();
 *   if (isPending) return null;              // still resolving — don't redirect yet
 *   if (!user) return <RedirectToSignIn />;  // definitely signed out
 *
 * `authEnabled` is a module-level constant fixed at load, so the guarded hook
 * call keeps a stable hook order across every render of a given component.
 */
const WHO = "porch-who";
let firstPending = 0;

function pendingTooLong() {
  if (!firstPending) firstPending = Date.now();
  return Date.now() - firstPending > 1200;
}

function rememberedUser(): AppUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(WHO);
    if (!raw) return null;
    const row = JSON.parse(raw) as Partial<AppUser>;
    if (!row.id) return null;
    return {
      id: row.id,
      displayName: row.displayName ?? null,
      primaryEmail: row.primaryEmail ?? null,
      profileImageUrl: row.profileImageUrl ?? null,
      isDevFallback: false,
    };
  } catch {
    return null;
  }
}

function remember(user: AppUser | null) {
  try {
    if (!user) sessionStorage.removeItem(WHO);
    else
      sessionStorage.setItem(
        WHO,
        JSON.stringify({
          id: user.id,
          displayName: user.displayName,
          primaryEmail: user.primaryEmail,
          profileImageUrl: user.profileImageUrl,
        }),
      );
  } catch {
    /* a private window can refuse the note */
  }
}

export function useCurrentUserState(): CurrentUserState {
  if (!authEnabled) return { user: DEV_USER, isPending: false };
  // eslint-disable-next-line react-hooks/rules-of-hooks -- authEnabled is constant for the app's lifetime
  const { data, isPending } = authClient.useSession();
  const live = data?.user;
  const [held, setHeld] = useState<AppUser | null>(rememberedUser);
  const [, setTick] = useState(0);
  const user = live
    ? {
        id: live.id,
        displayName: live.name ?? null,
        primaryEmail: live.email ?? null,
        profileImageUrl: live.image ?? null,
        isDevFallback: false,
      }
    : null;
  useEffect(() => {
    const timer = window.setTimeout(() => setTick(1), 1200);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (user) {
      remember(user);
      return;
    }
    if (!isPending) {
      remember(null);
      setHeld(null);
      return;
    }
    setHeld(rememberedUser());
  }, [user?.id, user?.displayName, user?.primaryEmail, user?.profileImageUrl, isPending]);
  if (user) {
    firstPending = 0;
    return { user, isPending: false };
  }
  if (isPending && held) return { user: held, isPending: false };
  if (isPending && !pendingTooLong()) return { user: null, isPending: true };
  return { user: null, isPending: false };
}

/**
 * Convenience view of `useCurrentUserState().user` for display (e.g.
 * `user?.displayName ?? "Guest"`). NOTE: `null` means *loading OR signed out* —
 * for redirects/guards use `useCurrentUserState()` and check `isPending`.
 */
export function useCurrentUser(): AppUser | null {
  return useCurrentUserState().user;
}
