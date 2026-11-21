import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { MyDetailsPage } from "@/components/porch/member-pages";

/** Stage 5c. */
export const Route = createFileRoute("/my-details")({
  component: () => (
    <AppFrame>
      <MyDetailsPage />
    </AppFrame>
  ),
});
