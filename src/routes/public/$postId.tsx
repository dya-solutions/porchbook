import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppFrame } from "@/components/porch/frame";
import { PublicPostCard } from "@/components/porch/public-views";
import { publicPostById, type PublicPost } from "@/lib/porch/public-porch";

/** One public post, opened from a link shared into a church's porch. */
export const Route = createFileRoute("/public/$postId")({
  component: PublicPostPage,
});

function PublicPostPage() {
  const { postId } = Route.useParams();
  const [post, setPost] = useState<PublicPost | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    publicPostById({ data: { postId: Number(postId) || 0 } })
      .then((result) => (result.ok ? setPost(result.post) : setError(result.error)))
      .catch(() => setError("Couldn't open this post."));
  }, [postId]);
  return (
    <AppFrame>
      <div className="pb ps">
        <h1 className="pb-ttl" style={{ fontSize: 24 }}>From the public porch</h1>
        {error ? <p className="pb-quiet">{error}</p> : null}
        {post ? <PublicPostCard post={post} canShare={false} /> : null}
        <Link to="/" search={{ room: "all", view: "public" } as never} className="pb-link" style={{ alignSelf: "flex-start" }}>
          Open the public porch
        </Link>
      </div>
    </AppFrame>
  );
}
