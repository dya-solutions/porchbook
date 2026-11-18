import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { PeopleView } from "@/components/porch/people-view";

export const Route = createFileRoute("/people/")({
  component: PeoplePage,
});

function PeoplePage() {
  return (
    <AppFrame
      rail={
        <div className="rounded-3xl glass-edge bg-card p-5">
          <h2 className="font-display text-xl text-ink">A small directory</h2>
          <p className="mt-2 text-sm text-muted">
            Roles and teams come from each person's profile. Add yours so the rest of the team can find you. Message someone from their row — that note stays private.
          </p>
        </div>
      }
    >
      <PeopleView />
    </AppFrame>
  );
}
