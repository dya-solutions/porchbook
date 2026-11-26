import { createFileRoute } from "@tanstack/react-router";
import { StartPorch } from "@/components/porch/start-porch";

/** Start a porch (decision 44): inside the app. Signed out, it shows Log in / Create account. */
export const Route = createFileRoute("/start")({
  component: StartPorch,
});
