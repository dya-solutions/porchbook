import { createFileRoute } from "@tanstack/react-router";
import { FaqView } from "@/components/porch/faq-view";

/** The Porchbook FAQ (Stage 4f). Works signed in or out. */
export const Route = createFileRoute("/faq")({
  component: FaqView,
});
