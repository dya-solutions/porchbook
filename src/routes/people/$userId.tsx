import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { ProfileView } from "@/components/porch/profile-view";

export const Route = createFileRoute("/people/$userId")({
  component: PersonRoute,
});

function PersonRoute() {
  const { userId } = Route.useParams();
  return (
    <AppFrame>
      <ProfileView userId={userId} />
    </AppFrame>
  );
}
