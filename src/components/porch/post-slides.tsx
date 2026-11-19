import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getTourMode, toggleTourMode } from "@/lib/porch/tour-mode";
import { tuneIn, useFm } from "@/lib/porch/fm-player";
import { shown } from "@/lib/porch/on-hold";

/**
 * The idle post box: slides inviting people in. Each slide's orange button takes them there;
 * the bar under the slides ("What's on your heart?") always starts a post.
 */
type Slide = { icon: string; title: string; line: string; go: string; from: string; to: string; action: "devotion" | "radio" | "chat" | "write" };
const ALL_SLIDES: Slide[] = [
  { icon: "📖", title: "Read today's devotional", line: "Start your day in the Word.", go: "Read now ›", from: "#2f5e1a", to: "#0e1a08", action: "devotion" },
  { icon: "📻", title: "Enjoy Porchbook Radio", line: "Worship, Sermons and more.", go: "Listen ›", from: "#7a4a0c", to: "#1e1203", action: "radio" },
  { icon: "💬", title: "Chat with your friends", line: "Private messages, one to one.", go: "Chat ›", from: "#1d4a5e", to: "#07141a", action: "chat" },
  { icon: "✍️", title: "Edify the Porchbook community", line: "Share your meditation.", go: "Write a post ›", from: "#5c2f6e", to: "#150a1a", action: "write" },
];
// The radio slide hides while the radio is on hold.
const SLIDES = ALL_SLIDES.filter((slide) => slide.action !== "radio" || shown("radio"));

export function PostSlides({ onWrite }: { onWrite: () => void }) {
  const navigate = useNavigate();
  const fm = useFm();
  const [at, setAt] = useState(0);
  // A swipe (or a tap on a dot) restarts the 5-second wait, so the slide doesn't jump right after.
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setAt((n) => (n + 1) % SLIDES.length), 5000);
    return () => window.clearInterval(timer);
  }, [turn]);
  const goTo = (next: number) => {
    setAt((next + SLIDES.length) % SLIDES.length);
    setTurn((n) => n + 1);
  };
  // Swipe left for the next slide, right for the one before.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  function act(action: Slide["action"]) {
    if (action === "write") return onWrite();
    if (action === "chat") return void navigate({ to: "/messages" });
    if (action === "devotion") return void navigate({ to: "/read", search: { open: "devotion" } as never });
    // The radio lives on the Tour page: open it there and switch it on.
    void navigate({ to: "/next" }).then(() => {
      window.setTimeout(() => {
        if (getTourMode() !== "worship") toggleTourMode("worship");
        if (fm.status === "off") void tuneIn();
      }, 120);
    });
  }
  return (
    <div
      className="post-slides"
      onPointerDown={(event) => {
        swipe.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const start = swipe.current;
        swipe.current = null;
        if (!start) return;
        const dx = event.clientX - start.x;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(event.clientY - start.y)) goTo(at + (dx < 0 ? 1 : -1));
      }}
      onPointerCancel={() => {
        swipe.current = null;
      }}
    >
      {SLIDES.map((slide, index) => (
        <div
          key={slide.action}
          className={`post-slide${index === at ? " is-on" : ""}`}
          style={{ background: `radial-gradient(120% 90% at 80% 10%, ${slide.from}, ${slide.to})` }}
          aria-hidden={index !== at}
        >
          <span className="post-slide-art" aria-hidden="true">
            {slide.icon}
          </span>
          <div className="post-slide-head">
            <span className="post-slide-icon" aria-hidden="true">
              {slide.icon}
            </span>
            <div>
              <p className="post-slide-title">{slide.title}</p>
              <p className="post-slide-line">{slide.line}</p>
            </div>
          </div>
          <button type="button" className="post-slide-go" tabIndex={index === at ? 0 : -1} onClick={() => act(slide.action)}>
            {slide.go}
          </button>
        </div>
      ))}
      <div className="post-slide-dots" aria-hidden="true">
        {SLIDES.map((slide, index) => (
          <button key={slide.action} type="button" tabIndex={-1} className={index === at ? "is-on" : ""} onClick={() => goTo(index)} />
        ))}
      </div>
      <button type="button" className="post-slide-write" onClick={onWrite}>
        ✍&nbsp; What's on your heart? Tap here to write
      </button>
    </div>
  );
}
