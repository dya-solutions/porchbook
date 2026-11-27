import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { FindPorches } from "@/components/porch/public-views";

/** N5: Find porches (by name, country and type). */
export const Route = createFileRoute("/find")({
  component: () => (
    <AppFrame>
      <FindPorches />
    </AppFrame>
  ),
});
