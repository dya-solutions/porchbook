import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { MessagesRail, MessagesView } from "@/components/porch/messages-view";

export const Route = createFileRoute("/messages/")({
  component: MessagesPage,
});

function MessagesPage() {
  return (
    <AppFrame rail={<MessagesRail />}>
      <div className="pc-chat">
        <div className="pc-chat-list is-alone">
          <MessagesView />
        </div>
        <div className="pc-chat-open pc-chat-pick">
          <p>Choose a conversation on the left.</p>
        </div>
      </div>
    </AppFrame>
  );
}
