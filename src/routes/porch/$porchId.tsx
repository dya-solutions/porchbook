import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { PorchPublicPage } from "@/components/porch/public-views";
import { useAccount } from "@/components/porch/account-screens";
import { useCurrentUser } from "@/lib/auth/use-current-user";

/** Stage 6: a porch's public page (design-reference/PorchPage.dc.html). */
export const Route = createFileRoute("/porch/$porchId")({
  component: PorchPage,
});

function PorchPage() {
  const { porchId } = Route.useParams();
  const user = useCurrentUser();
  const account = useAccount(user?.id);
  return (
    <AppFrame>
      <PorchPublicPage key={porchId} porchId={Number(porchId) || 0} member={Boolean(account?.member)} />
    </AppFrame>
  );
}
