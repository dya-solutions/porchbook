import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { keepJoinCode } from "@/components/porch/welcome-screen";
import { cleanCode } from "@/lib/porch/porch-join";

/** An invite link (Stage 5a): /join/CODE keeps the code on this phone, then opens the welcome. */
export const Route = createFileRoute("/join/$code")({
  component: JoinLink,
});

function JoinLink() {
  const { code } = Route.useParams();
  const [kept, setKept] = useState(false);
  useEffect(() => {
    keepJoinCode(cleanCode(code));
    setKept(true);
  }, [code]);
  return kept ? <Navigate to="/" search={{ room: "all" } as never} /> : null;
}
