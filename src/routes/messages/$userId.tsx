import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { MessagesRail, MessagesView } from "@/components/porch/messages-view";
import { ThreadView } from "@/components/porch/thread-view";

export const Route = createFileRoute("/messages/$userId")({
  component: ThreadRoute,
});

function ThreadRoute() {
  const { userId } = Route.useParams();
  return (
    <AppFrame rail={<MessagesRail />}>
      {/* On computers the conversation list stays on the left, like WhatsApp on a PC. */}
      <div className="pc-chat">
        <div className="pc-chat-list">
          <MessagesView />
        </div>
        <div className="pc-chat-open">
          <ThreadView userId={userId} />
        </div>
      </div>
    </AppFrame>
  );
}
