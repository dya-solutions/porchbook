import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { keepJoinCode } from "@/components/porch/welcome-screen";
import { cleanCode } from "@/lib/porch/porch-join";
import { accountState } from "@/lib/porch/membership";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { BrandLogo } from "@/components/porch/brand-logo";

/**
 * An invite link, or a scanned invite QR code (N6): /join/CODE keeps the code on this phone, then
 * opens the app. Someone new sees "You're invited", makes an account, confirms the email and lands
 * on the join form; someone signed in with no church goes straight to the join form.
 * Someone already in a church is told so (one church each), and the code isn't kept.
 */
export const Route = createFileRoute("/join/$code")({
  component: JoinLink,
});

function JoinLink() {
  const { code } = Route.useParams();
  const { user, isPending } = useCurrentUserState();
  const [state, setState] = useState<"checking" | "go" | { church: string }>("checking");
  useEffect(() => {
    if (isPending) return;
    if (!user) {
      keepJoinCode(cleanCode(code));
      setState("go");
      return;
    }
    accountState({ data: { displayName: user.displayName ?? "", email: user.primaryEmail ?? null } })
      .then((me) => {
        if (me.member) {
          keepJoinCode("");
          setState({ church: me.porchName });
        } else {
          keepJoinCode(cleanCode(code));
          setState("go");
        }
      })
      .catch(() => {
        keepJoinCode(cleanCode(code));
        setState("go");
      });
  }, [code, user, isPending]);
  if (state === "go") return <Navigate to="/" search={{ room: "all" } as never} />;
  if (state === "checking") return null;
  return (
    <main className="pb pb-legacy welcome">
      <div className="welcome-in" style={{ gap: 16 }}>
        <BrandLogo kind="tile" height={36} className="welcome-logo-olive" />
        <h1 className="pb-ttl" style={{ fontSize: 28 }}>You're already in a church</h1>
        <p className="pb-quiet" style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
          You're a member of <strong>{state.church}</strong>. A person belongs to one church, so this invite can't be used while you're there. To join another church, leave yours first under Your account → Leave this church.
        </p>
        <Link to="/" search={{ room: "all" } as never} className="pb-btn" style={{ textDecoration: "none" }}>
          Open my porch
        </Link>
      </div>
    </main>
  );
}
