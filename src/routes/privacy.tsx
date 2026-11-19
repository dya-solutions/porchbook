import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-5 py-12">
      <Link to="/" search={{ room: "all" }} className="font-display text-2xl text-ink">
        Porchbook
      </Link>
      <h1 className="mt-8 font-display text-4xl text-ink">Privacy</h1>
      <div className="mt-6 space-y-4 text-ink">
        <p>
          Porchbook is a private space for one team. It is not a public network, and it does not sell information or run ads.
        </p>
        <p>What is stored:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>The name, email, and sign-in method you use to join.</li>
          <li>A message an admin sends into each member's chat.</li>
          <li>Posts, replies, and reactions on the shared feed.</li>
          <li>Private messages, which only the two people in that conversation can read.</li>
          <li>Groups you create or join, and the notes inside them. Only members can read those.</li>
          <li>
            Call setup messages while a call is open. The voices and video go between the phones on the call. Porchbook does not record them.
          </li>
          <li>If you turn on alerts, a notice that a message arrived. The message itself is not included.</li>
        </ul>
        <p>
          Signed-in members of Porchbook can see the directory and the feed. Email addresses are shown only to you, on your own profile. Passwords are stored by the sign-in system, not as plain text.
        </p>
        <p>
          The person who runs Porchbook can remove the app and the data that goes with it. To ask about your information, contact that person.
        </p>
        <p className="text-sm text-muted">
          Credits: the plant in the porch guy's room is by Darmstadt Graphics Group, from the Khronos glTF sample models, used under{" "}
          <a href="https://creativecommons.org/licenses/by/4.0/" className="underline">
            CC BY 4.0
          </a>
          . The flower vase is public domain (CC0).
        </p>
      </div>
    </main>
  );
}
