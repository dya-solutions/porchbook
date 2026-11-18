import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { GroupHomeView } from "@/components/porch/groups-plain";

export const Route = createFileRoute("/groups/$groupId")({
  component: GroupRoute,
});

function GroupRoute() {
  const { groupId } = Route.useParams();
  return (
    <AppFrame>
      <GroupHomeView groupId={groupId} />
    </AppFrame>
  );
}
