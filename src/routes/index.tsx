import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { AppFrame } from "@/components/porch/frame";
import { FeedView } from "@/components/porch/feed-view";
import { FILTERS, type FeedFilter, type Profile } from "@/lib/porch/model";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { room: FeedFilter } => {
    const room = typeof search.room === "string" ? search.room : "all";
    return {
      room: (FILTERS as readonly string[]).includes(room) ? (room as FeedFilter) : "all",
    };
  },
  component: Home,
});

function Home() {
  const { room } = Route.useSearch();
  const [meta, setMeta] = useState<{ peopleCount: number; me: Profile | null }>({
    peopleCount: 0,
    me: null,
  });
  const onMeta = useCallback((next: { peopleCount: number; me: Profile | null }) => {
    setMeta(next);
  }, []);

  return (
    <AppFrame rail={<SeatRail count={meta.peopleCount} me={meta.me} />}>
      <FeedView filter={room} onMeta={onMeta} />
    </AppFrame>
  );
}

function SeatRail({ count, me }: { count: number; me: Profile | null }) {
  return (
    <div className="rounded-3xl glass-edge bg-card p-5">
      <p className="font-display text-4xl tabular-nums text-ink">{count}</p>
      <p className="text-sm text-muted">{count === 1 ? "person on Porchbook" : "people on Porchbook"}</p>
      <p className="mt-3 text-sm text-muted">A community of communion. No ads, and nothing public.</p>
      {me?.team ? <p className="mt-4 text-sm font-medium text-ink">Your team · {me.team}</p> : null}
    </div>
  );
}
