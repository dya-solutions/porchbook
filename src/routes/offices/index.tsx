import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { OfficesHome } from "@/components/porch/offices-view";

export const Route = createFileRoute("/offices/")({
  component: OfficesPage,
});

function OfficesPage() {
  return (
    <AppFrame>
      <OfficesHome />
    </AppFrame>
  );
}
