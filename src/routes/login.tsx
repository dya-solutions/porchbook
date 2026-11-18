import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Welcome } from "@/components/porch/frame";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/login")({
  component: Login,
});

function Login() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return null;
  if (user) return <Navigate to="/" search={{ room: "all" }} />;
  return <Welcome />;
}
