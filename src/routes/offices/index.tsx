import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { OfficesList } from "@/components/porch/office-screens";

export const Route = createFileRoute("/offices/")({
  component: OfficesPage,
});

function OfficesPage() {
  return (
    <AppFrame>
      <OfficesList />
    </AppFrame>
  );
}
