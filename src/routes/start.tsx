import { createFileRoute } from "@tanstack/react-router";
import { AuthCard } from "@/components/porch/frame";
import { StartPorch } from "@/components/porch/start-porch";

/** Start a porch (Stage 5a). Works signed out too: step 2 makes the account. */
export const Route = createFileRoute("/start")({
  component: () => <StartPorch account={(note) => <AuthCard startMode="join" note={note} />} />,
});
