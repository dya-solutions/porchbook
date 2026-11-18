import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { GroupsHome } from "@/components/porch/groups-plain";

export const Route = createFileRoute("/groups/")({
  component: GroupsPage,
});

function GroupsPage() {
  return (
    <AppFrame>
      <GroupsHome />
    </AppFrame>
  );
}