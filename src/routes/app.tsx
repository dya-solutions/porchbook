import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { primaryButtonClass } from "@/components/porch/bits";

const PACKAGE = "app.porch.team";

export const Route = createFileRoute("/app")({
  validateSearch: (search: Record<string, unknown>): { stay: boolean } => ({
    stay: search.stay === true || search.stay === "true" || search.stay === "1" || search.stay === 1,
  }),
  component: AppPage,
});

function androidIntentUrl() {
  const fallback = new URL("/app", window.location.origin);
  fallback.searchParams.set("stay", "1");
  return `intent://open#Intent;scheme=porch;package=${PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallback.href)};end`;
}

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

function alreadyInApp() {
  return document.referrer.startsWith(`android-app://${PACKAGE}`);
}

function AppPage() {
  const { stay } = Route.useSearch();

  useEffect(() => {
    if (stay || !isAndroid() || alreadyInApp()) return;
    window.location.replace(androidIntentUrl());
  }, [stay]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5 py-12">
      <p className="font-display text-2xl text-ink">Porchbook</p>
      <h1 className="mt-6 font-display text-4xl text-ink">Open the app</h1>
      <p className="mt-4 text-lg text-muted">
        {stay
          ? "Porchbook isn’t installed on this phone yet. Download it, then come back and tap App."
          : "This is the new Porchbook. Install it and it takes the place of the old one."}
      </p>
      <div className="mt-8 grid gap-3">
        <button
          type="button"
          className={primaryButtonClass}
          onClick={() => {
            if (isAndroid()) window.location.assign(androidIntentUrl());
            else window.location.assign("/porch.apk");
          }}
        >
          Open the app
        </button>
        <a
          href="/porch.apk"
          download="porch.apk"
          className="inline-flex min-h-11 items-center justify-center rounded-lg glass-edge bg-card px-4 text-sm font-semibold text-ink"
        >
          Download the Android app
        </a>
      </div>
      <Link to="/" search={{ room: "all" }} className="mt-6 inline-flex min-h-11 items-center text-sm font-medium text-pine">
        Back to Porchbook
      </Link>
    </main>
  );
}
