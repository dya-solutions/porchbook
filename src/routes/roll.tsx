import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { RollView } from "@/components/porch/roll-view";

export const Route = createFileRoute("/roll")({
  component: RollPage,
});

function RollPage() {
  return (
    <AppFrame>
      <RollView />
    </AppFrame>
  );
}
