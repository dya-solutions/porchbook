import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { PorchApprovals } from "@/components/porch/porch-approvals";

/** The platform owner's list of porches waiting for approval (Stage 5a). */
export const Route = createFileRoute("/porches-waiting")({
  component: () => (
    <AppFrame>
      <PorchApprovals />
    </AppFrame>
  ),
});
