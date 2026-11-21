// The "page not found" screen, in the Porchbook brand.
import { BrandLogo } from "@/components/porch/brand-logo";

export function NotFound() {
  return (
    <main className="pb welcome">
      <div className="welcome-in" style={{ justifyContent: "center", alignItems: "center", textAlign: "center", gap: 16 }}>
        <span style={{ color: "var(--pb-main)", display: "flex" }}>
          <BrandLogo kind="mark" height={72} />
        </span>
        <h1 className="pb-ttl" style={{ fontSize: 28 }}>This page isn't here</h1>
        <p className="pb-quiet" style={{ margin: 0, fontSize: 16, lineHeight: 1.5, maxWidth: 320 }}>
          The address may be mistyped, or the page has moved. Your porch is one tap away.
        </p>
        <a href="/?room=all" className="pb-btn" style={{ textDecoration: "none", minWidth: 200 }}>
          Go to my porch
        </a>
        <a href="/faq" className="welcome-link" style={{ fontWeight: 600 }}>
          Questions?
        </a>
      </div>
    </main>
  );
}
