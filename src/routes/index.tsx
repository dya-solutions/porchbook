import { createFileRoute, Link } from "@tanstack/react-router";
import { useAccount } from "@/components/porch/account-screens";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { BrandLogo } from "@/components/porch/brand-logo";
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

/** The Public porch arrives in Stage 6. */
function PublicSoon() {
  const user = useCurrentUser();
  const account = useAccount(user?.id);
  // Decision 44: someone with no church can start a porch from here.
  const noChurch = account ? !account.member : false;
  return (
    <div className="pb-body">
      <div className="pb-card" style={{ padding: "28px 20px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        {/* Stage 4e: the Public porch header carries the Porchbook circle of people. */}
        <span style={{ color: "var(--pb-main)", display: "flex" }}>
          <BrandLogo kind="mark" height={44} />
        </span>
        <h2 className="pb-ttl" style={{ fontSize: 22 }}>
          The Public porch is coming soon
        </h2>
        <p className="pb-quiet" style={{ margin: 0, fontSize: 15, lineHeight: 1.45, maxWidth: 320 }}>
          Here you&apos;ll see posts from the churches and ministries you follow, and react to them.
        </p>
      </div>
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
