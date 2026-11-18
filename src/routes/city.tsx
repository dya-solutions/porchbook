import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { AppFrame } from "@/components/porch/frame";
import { holdRadio, releaseRadio } from "@/lib/porch/fm-player";
import { useLine } from "@/lib/porch/line-call";
import { LiteGate } from "@/components/porch/lite-bits";

export const Route = createFileRoute("/city")({
  component: CityPage,
});

function CityPage() {
  const frame = useRef<HTMLIFrameElement>(null);
  const line = useLine();
  const ringing = Boolean(line.call);

  // PorchWay tells us when its music/engine is playing: the radio steps aside
  // meanwhile, and comes back when PorchWay goes quiet or you leave.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !event.data || event.data.type !== "porchway-sound") return;
      if (event.data.on) holdRadio("porchway");
      else releaseRadio("porchway");
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      releaseRadio("porchway");
    };
  }, []);

  // A call: PorchWay gives the camera back (face steering pauses).
  useEffect(() => {
    if (ringing) frame.current?.contentWindow?.postMessage({ type: "porch-call" }, window.location.origin);
  }, [ringing]);

  return (
    <AppFrame>
      <LiteGate megabytes={8} what="PorchWay">
      <iframe
        ref={frame}
        title="PorchWay"
        src="/porchbook_highway.html?v=66"
        allow="autoplay; camera; accelerometer; gyroscope"
        className="absolute inset-0 h-full w-full border-0"
      />
      </LiteGate>
    </AppFrame>
  );
}
