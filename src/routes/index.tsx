import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
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
  return (
    <div className="pb-body">
      <div className="pb-card" style={{ padding: "28px 20px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <span style={{ color: "var(--pb-main)", display: "flex" }}>
          <PbIcon name="globe" size={36} />
        </span>
        <h2 className="pb-ttl" style={{ fontSize: 22 }}>
          The Public porch is coming soon
        </h2>
        <p className="pb-quiet" style={{ margin: 0, fontSize: 15, lineHeight: 1.45, maxWidth: 320 }}>
          Here you&apos;ll see posts from the porches you follow (churches, ministries, gospel artists and organisations) and react to them.
        </p>
      </div>
    </div>
  );
}
