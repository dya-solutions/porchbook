import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { WaitingList } from "@/components/porch/member-pages";

/** Stage 5c. */
export const Route = createFileRoute("/waiting-to-join")({
  component: () => (
    <AppFrame>
      <WaitingList />
    </AppFrame>
  ),
});
