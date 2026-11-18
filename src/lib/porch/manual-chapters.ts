import { MANUAL } from "@/lib/porch/manual-text";

/** The manual text, cut into chapters of questions, topics, lists and tables (same shapes as the printed manual). */
export type ManualItem =
  | { kind: "q"; q: string; a: string }
  | { kind: "topic"; title: string; note: string; text: string }
  | { kind: "list"; lines: { depth: number; text: string }[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "p"; text: string };
export type ManualChapter = { title: string; icon: string; intro: string; items: ManualItem[] };

const CHAPTERS: Record<string, [string, string]> = {
  "Joining and your first day": ["🦋", "Welcome to the porch. Here is what Porchbook is, and how to begin."],
  "Home and posts": ["🏠", "Home is where the posts are: share, react, and find the right room."],
  Tour: ["📻", "Tour holds the rest of Porchbook: the radio, events, serving and more."],
  "Read: the shelf": ["📖", "The Bible, the devotional and your notebook, all on one shelf."],
  "The porch guy and Lite mode": ["🎧", "Your guide on the porch, and a lighter Porchbook for slow data."],
};
const LEADS = ["Your look", "Pray", "Porchbook Radio", "Events", "Serve", "Transport", "My20", "Groups", "Offices", "Feedback", "Call",
  "The Bible", "Study", "Dictionary", "The devotional", "The notebook", "Rhemaclip", "The porch guy", "Lite mode"].sort((a, b) => b.length - a.length);

const listOf = (lines: string[]) => lines.map((line) => ({ depth: Math.floor((line.length - line.trimStart().length) / 2), text: line.trim().slice(2) }));

export const MANUAL_CHAPTERS: ManualChapter[] = (() => {
  const out: ManualChapter[] = [];
  for (const block of MANUAL.split(/\n\n+/).map((b) => b.trim()).filter(Boolean)) {
    if (CHAPTERS[block]) {
      out.push({ title: block, icon: CHAPTERS[block][0], intro: CHAPTERS[block][1], items: [] });
      continue;
    }
    const items = out[out.length - 1]?.items;
    if (!items) continue;
    const lines = block.split("\n");
    if (lines[0].startsWith("|")) {
      const [head, ...rows] = lines.filter((l) => l.startsWith("|")).map((l) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      items.push({ kind: "table", head, rows });
    } else if (lines.every((l) => l.trimStart().startsWith("- "))) items.push({ kind: "list", lines: listOf(lines) });
    else if (lines.length > 1 && lines[1].trimStart().startsWith("- ")) {
      items.push({ kind: "q", q: lines[0], a: "" }, { kind: "list", lines: listOf(lines.slice(1)) });
    } else {
      const lead = LEADS.find((l) => block.startsWith(`${l} `));
      if (lead) {
        let text = block.slice(lead.length).trim();
        let note = "";
        const m = /^\(([^)]*)\)\s*([\s\S]*)$/.exec(text);
        if (m) [note, text] = [m[1].charAt(0).toUpperCase() + m[1].slice(1), m[2]];
        items.push({ kind: "topic", title: lead, note, text });
      } else if (block.endsWith("?")) items.push({ kind: "q", q: block, a: "" });
      else {
        const m = /^(.*?\?)\s+([\s\S]*)$/.exec(block);
        items.push(m ? { kind: "q", q: m[1], a: m[2] } : { kind: "p", text: block });
      }
    }
  }
  return out;
})();
