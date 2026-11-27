import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { AdminsPanel } from "@/components/porch/admins-panel";

/** Stage 5d: Porch settings → Admins (every admin can look; Lead admins change them). */
export const Route = createFileRoute("/porch-admins")({
  component: () => (
    <AppFrame>
      <AdminsPanel />
    </AppFrame>
  ),
});
