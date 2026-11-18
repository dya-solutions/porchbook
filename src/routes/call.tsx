import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { PersonCallView } from "@/components/porch/groups-view";

export const Route = createFileRoute("/call")({
  validateSearch: (search: Record<string, unknown>): { userId: string; join: string; video: string; pick: string } => ({
    userId: typeof search.userId === "string" ? search.userId : "",
    join: search.join === "1" ? "1" : "",
    video: search.video === "1" ? "1" : "",
    pick: search.pick === "1" ? "1" : "",
  }),
  component: CallPage,
});

function CallPage() {
  const { userId, join, video, pick } = Route.useSearch();
  return (
    <AppFrame>
      <PersonCallView userId={userId} autoJoin={join === "1"} video={video === "1"} picking={pick === "1"} />
    </AppFrame>
  );
}