import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/manual")({
  component: () => <Navigate to="/" search={{ room: "all" }} />,
});
