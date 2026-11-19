import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { PresenceView } from "@/components/porch/presence-view";

/** Who is on the porch (Stage 4a). */
export const Route = createFileRoute("/presence")({
  component: () => (
    <AppFrame>
      <PresenceView />
    </AppFrame>
  ),
});
