import { createFileRoute, Link } from "@tanstack/react-router";
import { useAccount } from "@/components/porch/account-screens";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { PublicFeed } from "@/components/porch/public-views";
import { useCallback, useEffect, useState } from "react";
import { waitingJoinCount } from "@/lib/porch/membership";
import { AppFrame } from "@/components/porch/frame";
import { FeedView } from "@/components/porch/feed-view";
import { PbIcon, PorchSwitch, PresenceStrip } from "@/components/porch/pb-shell";
import { OfficeAnnouncements } from "@/components/porch/office-screens";
import { FILTERS, type FeedFilter } from "@/lib/porch/model";

/** My porch (design-reference/Porch.dc.html), with the switch to the Public porch. */
export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { room: FeedFilter; view?: "public" } => {
    const room = typeof search.room === "string" ? search.room : "all";
    return {
      room: (FILTERS as readonly string[]).includes(room) ? (room as FeedFilter) : "all",
      ...(search.view === "public" ? { view: "public" as const } : {}),
    };
  },
  component: Home,
});

function Home() {
  const { room, view } = Route.useSearch();
  const onMeta = useCallback(() => undefined, []);

  return (
    <AppFrame>
      <div className="pb">
        <PorchSwitch side={view === "public" ? "public" : "mine"} />
        {view === "public" ? (
          <PublicSoon />
        ) : (
          <div className="pb-body">
            <WaitingToJoinCard />
            <PresenceStrip />
            <OfficeAnnouncements />
            <FeedView filter={room} onMeta={onMeta} />
          </div>
        )}
      </div>
    </AppFrame>
  );
}

/** Stage 6: the Public porch (design-reference/Public.dc.html): posts from the porches you follow. */
function PublicSoon() {
  const user = useCurrentUser();
  const account = useAccount(user?.id);
  // Decision 44: someone with no church can start a porch from here.
  const noChurch = account ? !account.member : false;
  return (
    <div>
      <PublicFeed member={Boolean(account?.member)} />
      {noChurch ? (
        <div className="pb-card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>Lead a church or a ministry?</p>
          <p className="pb-quiet" style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>
            Start its porch. It's checked before it can post publicly.
          </p>
          <Link to="/start" className="pb-btn" style={{ textDecoration: "none" }}>
            Start a porch
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/** Admins: people waiting to join, at the top of My porch, one tap from the list. */
function WaitingToJoinCard() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const load = () => void waitingJoinCount().then((r) => setCount(r.count)).catch(() => undefined);
    load();
    const back = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", back);
    const timer = window.setInterval(back, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.clearInterval(timer);
    };
  }, []);
  if (!count) return null;
  return (
    <Link to="/waiting-to-join" className="pb-card pb-waiting-card">
      <span className="pb-waiting-dot" aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span style={{ flex: 1 }}>
        <strong>{count} {count === 1 ? "person" : "people"} waiting to join</strong>
        <small>They're asking to join your church</small>
      </span>
      <span className="pb-waiting-go">Review</span>
    </Link>
  );
}
