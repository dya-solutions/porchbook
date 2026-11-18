import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { OfficeRoom } from "@/components/porch/offices-view";

export const Route = createFileRoute("/offices/$officeKey")({
  validateSearch: (search: Record<string, unknown>): { member: string; room: string } => ({
    member: typeof search.member === "string" ? search.member : "",
    room: typeof search.room === "string" ? search.room : "",
  }),
  component: OfficePage,
});

function OfficePage() {
  const { officeKey } = Route.useParams();
  const { member, room } = Route.useSearch();
  const key = officeKey === "prayer" ? "pastor" : officeKey;
  const desk = officeKey === "prayer" ? "thanks" : room;
  return (
    <AppFrame>
      <OfficeRoom officeKey={key} member={member} room={desk} />
    </AppFrame>
  );
}
