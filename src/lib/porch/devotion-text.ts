/** The English reading out of the devotional page (translations are not shown). */
export function englishOf(html: string) {
  const bodies = [...html.matchAll(/<article data-i="(\d+)"[^>]*>([\s\S]*?)<\/article>/g)];
  const names = [...html.matchAll(/data-pick="(\d+)"[^>]*>([^<]*)</g)];
  const englishAt = names.find((match) => /^english$/i.test(match[2].trim()))?.[1] ?? "0";
  return bodies.find((item) => item[1] === englishAt)?.[2] ?? bodies[0]?.[2] ?? "";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…" };

/** Plain text to be read aloud: one paragraph per line, Scripture references said naturally. */
export function speechOf(html: string) {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|div|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((line) => line.replace(/\s&\s/g, " and "))
    .map((line) =>
      // "Romans 8:28-30" → "Romans chapter 8, verses 28 to 30"
      line.replace(/\b((?:[1-3]\s?)?[A-Z][a-z]+\.?)\s(\d{1,3}):(\d{1,3})(?:\s?[-–]\s?(\d{1,3}))?/g, (_m, book, chapter, verse, end) =>
        end ? `${book} chapter ${chapter}, verses ${verse} to ${end}` : `${book} chapter ${chapter}, verse ${verse}`,
      ),
    )
    .join("\n");
}

/**
 * The same text, marked so the voice can read it like a person would:
 * "§T " the title, "§H " a heading or subheading, "§Q " a scripture quote; other lines are paragraphs.
 */
export function speechLinesOf(html: string) {
  let titled = false;
  const marked = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    // Headings: the first one is the title.
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, _level, inner) => {
      const tag = titled ? "§H " : "§T ";
      titled = true;
      return `\n${tag}${inner}\n`;
    })
    // A paragraph that is only bold words is a subheading.
    .replace(/<p[^>]*>\s*<(strong|b)[^>]*>([\s\S]*?)<\/\1>\s*<\/p>/gi, (_m, _tag, inner) => `\n§H ${inner}\n`)
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner) => `\n§Q ${inner.replace(/<\/?p[^>]*>/gi, " ")}\n`);
  const lines = speechOf(marked).split("\n").filter(Boolean);
  const out: string[] = [];
  const bare = (line: string) => line.replace(/^§[A-Z] /, "");
  const isRef = (line: string) => /\bchapter \d+, verses? \d+/.test(line);
  let stage: "title" | "author" | "scripture" | "body" = "title";
  let section = "";
  for (const raw of lines) {
    const line = bare(raw).trim();
    if (!line) continue;
    // The devotional's fixed parts, even when joined to the text after them ("Prayer Father we thank you…").
    const label = /^(further study|golden nugget|prayer)\b\s*[:.\-–—]?\s*(.*)$/i.exec(line);
    if (label && stage === "body") {
      section = label[1].toLowerCase();
      out.push(`§H ${label[1][0].toUpperCase()}${label[1].slice(1).toLowerCase()}`);
      const rest = label[2].trim();
      if (rest) out.push(...(section === "further study" ? rest.split(/\s*;\s*/).filter(Boolean).map((ref) => `§R ${ref}`) : [rest]));
      continue;
    }
    if (stage === "title") {
      out.push(`§T ${line}`);
      stage = "author";
      continue;
    }
    if (stage === "author" && /apostle|pastor|bishop|prophet|lubega/i.test(line) && line.length < 70) {
      out.push(`§A ${line}`);
      stage = "scripture";
      continue;
    }
    if (stage === "author" || stage === "scripture") {
      // The opening scripture: the first verse after the title and author.
      if (raw.startsWith("§Q") || isRef(line)) {
        out.push(`§S ${line}`);
        stage = "body";
        continue;
      }
      stage = "body";
    }
    if (section === "further study") {
      out.push(...line.split(/\s*;\s*/).filter(Boolean).map((ref) => `§R ${ref}`));
      continue;
    }
    if (raw.startsWith("§")) {
      out.push(raw);
      continue;
    }
    // A short line with no ending punctuation reads as a heading too.
    if (line.length < 60 && !/[.!?:;,"”’)]$/.test(line) && line.split(" ").length <= 8) out.push(`§H ${line}`);
    else out.push(line);
  }
  return out.join("\n");
}
