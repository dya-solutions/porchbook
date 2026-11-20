import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { PorchSettings } from "@/components/porch/porch-settings";

/** Porch settings, for the porch's admins (Stage 4c): theme and Tour doors. */
export const Route = createFileRoute("/porch-settings")({
  component: () => (
    <AppFrame>
      <PorchSettings />
    </AppFrame>
  ),
});
