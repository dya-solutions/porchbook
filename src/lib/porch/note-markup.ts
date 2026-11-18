/**
 * How a note is kept: plain text with small codes, so nothing in a note can ever run as a web page.
 *   {{g}} {{n}} {{r}}  highlights (gold, green, red)      {{R}} {{B}} {{G}}  pens (red, blue, green)
 *   {{b}} {{i}} {{u}} {{s}}  bold, italic, underline, strike     {{}}  closes the last one
 *   {{L:h}} {{L:c}} {{L:e}}  at the start of a line: heading, centre, right (they combine, e.g. {{L:hc}})
 *   {{img:ID}}  a picture on its own line          ☐ ☑  tick boxes        • and "1. "  are just text
 */

export const WASH = {
  gold: "rounded bg-[#f3d27a] px-0.5",
  green: "rounded bg-[#b7d7a8] px-0.5",
  red: "rounded bg-[#f0b4b4] px-0.5",
} as const;

export const PEN_CLASS = {
  red: "text-[#b42318]",
  blue: "text-[#1d4ed8]",
  green: "text-[#1b7a32]",
} as const;

export const FMT_CLASS = { b: "nb-b", i: "nb-i", u: "nb-u", s: "nb-s" } as const;
export type Fmt = keyof typeof FMT_CLASS;
export type Ink = keyof typeof WASH;
export type Pen = keyof typeof PEN_CLASS;

const INK_OF: Record<string, Ink> = { g: "gold", n: "green", r: "red" };
const PEN_OF: Record<string, Pen> = { R: "red", B: "blue", G: "green" };

/** Every code removed: what's left is the writing itself (a picture counts as writing). */
export function plainOfMarks(markup: string) {
  return markup.replace(/\{\{img:[A-Za-z0-9]+\}\}/g, "▣").replace(/\{\{[^{}]*\}\}/g, "").trim();
}

function escapeText(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function textHtml(text: string) {
  return escapeText(text).replace(/[☐☑]/g, (box) => `<span data-box="${box === "☑" ? 1 : 0}" contenteditable="false" class="nb-box${box === "☑" ? " is-done" : ""}">${box}</span>`);
}

function openTag(code: string) {
  if (INK_OF[code]) return `<span data-ink="${INK_OF[code]}" class="${WASH[INK_OF[code]]}">`;
  if (PEN_OF[code]) return `<span data-pen="${PEN_OF[code]}" class="${PEN_CLASS[PEN_OF[code]]}">`;
  if (code in FMT_CLASS) return `<span data-fmt="${code}" class="${FMT_CLASS[code as Fmt]}">`;
  return "";
}

export function pictureUrl(id: string) {
  return `/api/note-picture?id=${encodeURIComponent(id)}`;
}

export function lineClass(codes: string) {
  return ["nb-line", codes.includes("h") ? "is-head" : "", codes.includes("c") ? "is-centre" : codes.includes("e") ? "is-right" : ""].filter(Boolean).join(" ");
}

/** The kept text → the page you see, one line per row. */
export function marksToHtml(markup: string) {
  const open: string[] = [];
  const rows: string[] = [];
  for (const raw of markup.split("\n")) {
    let line = raw;
    let codes = "";
    const head = /^\{\{L:([hce]+)\}\}/.exec(line);
    if (head) {
      codes = head[1];
      line = line.slice(head[0].length);
    }
    const pic = /^\{\{img:([A-Za-z0-9]{8,40})\}\}$/.exec(line.trim());
    if (pic) {
      rows.push(`<div class="nb-pic" contenteditable="false" data-pic="${pic[1]}"><img src="${pictureUrl(pic[1])}" alt="" loading="lazy"></div>`);
      continue;
    }
    let html = open.map(openTag).join("");
    let words = false;
    const code = /\{\{([^{}]*)\}\}/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = code.exec(line))) {
      const piece = line.slice(last, match.index);
      if (piece) words = true;
      html += textHtml(piece);
      last = match.index + match[0].length;
      const name = match[1];
      if (name === "" || name === "/") {
        if (open.length) {
          open.pop();
          html += "</span>";
        }
      } else if (openTag(name)) {
        open.push(name);
        html += openTag(name);
      }
    }
    const rest = line.slice(last);
    if (rest) words = true;
    html += textHtml(rest) + "</span>".repeat(open.length);
    const attrs = codes ? ` data-line="${codes}" class="${lineClass(codes)}"` : "";
    rows.push(`<div${attrs}>${words ? html : "<br>"}</div>`);
  }
  return rows.join("");
}

function spanCodes(node: HTMLElement) {
  const pen = node.dataset.pen;
  const ink = node.dataset.ink;
  const fmt = node.dataset.fmt;
  const penCode = pen === "red" ? "R" : pen === "blue" ? "B" : pen === "green" ? "G" : "";
  const inkCode = ink === "gold" ? "g" : ink === "green" ? "n" : ink === "red" ? "r" : "";
  const fmtCode = fmt && fmt in FMT_CLASS ? fmt : "";
  return [fmtCode, penCode, inkCode].filter(Boolean);
}

function isBlock(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && (node.tagName === "DIV" || node.tagName === "P");
}

function walk(node: Node): string {
  // \u200b only holds a pen's place until the first letter: never kept.
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\u200b/g, "").replaceAll("{{", "{ {");
  if (!(node instanceof HTMLElement)) return "";
  if (node.tagName === "BR") return "\n";
  if (node.dataset.pic) return `\n{{img:${node.dataset.pic}}}`;
  if (node.tagName === "IMG") return "";
  // The transcriber's words still being heard: shown, never kept.
  if (node.dataset.live) return "";
  const kids = [...node.childNodes];
  // A line's last <br> only holds an empty line open; it isn't a line of its own.
  if (isBlock(node) && kids.length && kids[kids.length - 1] instanceof HTMLBRElement) kids.pop();
  let inner = "";
  for (const child of kids) inner += walk(child);
  if (isBlock(node)) {
    const codes = (node.dataset.line ?? "").replace(/[^hce]/g, "");
    return `\n${codes ? `{{L:${codes}}}` : ""}${inner}`;
  }
  let marked = inner;
  if (!marked) return "";
  for (const code of spanCodes(node).reverse()) marked = `{{${code}}}${marked}{{}}`;
  return marked;
}

/** The page you see → the kept text. */
export function readMarks(root: HTMLElement | null) {
  if (!root) return "";
  let text = "";
  root.childNodes.forEach((child) => {
    text += walk(child);
  });
  return text.replace(/^\n/, "").slice(0, 8000);
}

// ---- Lines ---------------------------------------------------------------

/** The line (a row on the page) holding this spot; loose words at the top are gathered into one first. */
export function lineOf(root: HTMLElement, node: Node | null): HTMLElement | null {
  if (!node || (node !== root && !root.contains(node))) return null;
  if (node === root) {
    const first = root.firstChild;
    if (!first) {
      const row = document.createElement("div");
      row.appendChild(document.createElement("br"));
      root.appendChild(row);
      return row;
    }
    return lineOf(root, first);
  }
  let current: Node = node;
  while (current.parentNode && current.parentNode !== root) current = current.parentNode;
  if (isBlock(current)) return current;
  // Loose words straight on the page: wrap the run they sit in (up to a <br> or a row) into a row.
  const run: Node[] = [current];
  let back = current.previousSibling;
  while (back && !isBlock(back) && !(back instanceof HTMLBRElement)) {
    run.unshift(back);
    back = back.previousSibling;
  }
  let ahead = current.nextSibling;
  while (ahead && !isBlock(ahead) && !(ahead instanceof HTMLBRElement)) {
    run.push(ahead);
    ahead = ahead.nextSibling;
  }
  const row = document.createElement("div");
  root.insertBefore(row, run[0]);
  for (const item of run) row.appendChild(item);
  if (ahead instanceof HTMLBRElement) ahead.remove();
  if (!row.childNodes.length) row.appendChild(document.createElement("br"));
  return row;
}

/** The rows a selection touches (just the caret's row when nothing is selected). */
export function linesIn(root: HTMLElement, range: Range): HTMLElement[] {
  const first = lineOf(root, range.startContainer);
  if (!first) return [];
  if (range.collapsed) return [first];
  const last = lineOf(root, range.endContainer) ?? first;
  const rows: HTMLElement[] = [];
  let row: Element | null = first;
  while (row) {
    if (row instanceof HTMLElement) rows.push(row);
    if (row === last) break;
    row = row.nextElementSibling;
  }
  return rows;
}

/** The text a row starts with (to spot bullets, numbers and tick boxes). */
export function rowText(row: HTMLElement) {
  return row.textContent ?? "";
}

// The space after a bullet, number or box is a fixed one, so it never disappears.
const PREFIX = /^(•[ \u00a0]|\d{1,3}\.[ \u00a0]|[☐☑][ \u00a0]?)/;

export function rowPrefix(row: HTMLElement) {
  return PREFIX.exec(rowText(row))?.[1] ?? "";
}

/** Take a bullet, number or tick box off the front of a row. */
export function dropPrefix(row: HTMLElement) {
  const box = row.querySelector("[data-box]");
  const prefix = rowPrefix(row);
  if (!prefix) return;
  if (box && /^[☐☑]/.test(prefix)) {
    const after = box.nextSibling;
    box.remove();
    if (after instanceof Text && /^[ \u00a0]/.test(after.textContent ?? "")) after.textContent = (after.textContent ?? "").slice(1);
    return;
  }
  let left = prefix.length;
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  let text = walker.nextNode() as Text | null;
  while (text && left > 0) {
    const value = text.textContent ?? "";
    const cut = Math.min(left, value.length);
    text.textContent = value.slice(cut);
    left -= cut;
    text = walker.nextNode() as Text | null;
  }
}

export function makeBox(done = false) {
  const box = document.createElement("span");
  box.dataset.box = done ? "1" : "0";
  box.contentEditable = "false";
  box.className = `nb-box${done ? " is-done" : ""}`;
  box.textContent = done ? "☑" : "☐";
  return box;
}

/** Put a bullet ("• "), a number ("3. ") or a tick box at the front of a row. */
export function addPrefix(row: HTMLElement, kind: "bullet" | "number" | "box", number = 1) {
  if (row.firstChild instanceof HTMLBRElement && row.childNodes.length === 1) row.firstChild.remove();
  if (kind === "box") {
    row.insertBefore(document.createTextNode("\u00a0"), row.firstChild);
    row.insertBefore(makeBox(), row.firstChild);
  } else {
    row.insertBefore(document.createTextNode(kind === "bullet" ? "•\u00a0" : `${number}.\u00a0`), row.firstChild);
  }
}

/** The number for a numbered row: one more than the row above, if that one is numbered. */
export function nextNumber(row: HTMLElement) {
  const above = row.previousElementSibling;
  const found = above instanceof HTMLElement ? /^(\d{1,3})\.[ \u00a0]/.exec(rowText(above)) : null;
  return found ? Number(found[1]) + 1 : 1;
}

export function setRowCode(row: HTMLElement, code: "h" | "c" | "e" | "l") {
  let codes = row.dataset.line ?? "";
  if (code === "h") codes = codes.includes("h") ? codes.replace("h", "") : `h${codes}`;
  else {
    codes = codes.replace(/[ce]/g, "");
    if (code !== "l") codes += code;
  }
  if (codes) {
    row.dataset.line = codes;
    row.className = lineClass(codes);
  } else {
    delete row.dataset.line;
    row.removeAttribute("class");
  }
}

export function placeCaretAt(node: Node, offset: number) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function placeCaretAfter(node: Node) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

// ---- Bold, italic, underline, strike -------------------------------------

function unwrap(span: HTMLElement) {
  const parent = span.parentNode;
  if (!parent) return;
  while (span.firstChild) parent.insertBefore(span.firstChild, span);
  parent.removeChild(span);
  if (parent instanceof HTMLElement) parent.normalize();
}

/** Bold (etc.) on the chosen words, or off again if they already have it. Works row by row. */
export function applyFmt(root: HTMLElement, range: Range, code: Fmt): Node[] {
  const rows = linesIn(root, range);
  const host = (range.commonAncestorContainer instanceof HTMLElement ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest(`[data-fmt="${code}"]`);
  if (host instanceof HTMLElement && root.contains(host)) {
    const kids = [...host.childNodes];
    unwrap(host);
    return kids;
  }
  const made: Node[] = [];
  for (const row of rows) {
    const part = document.createRange();
    part.selectNodeContents(row);
    if (row.contains(range.startContainer) || row === range.startContainer) part.setStart(range.startContainer, range.startOffset);
    if (row.contains(range.endContainer) || row === range.endContainer) part.setEnd(range.endContainer, range.endOffset);
    if (!part.toString().trim()) continue;
    const span = document.createElement("span");
    span.dataset.fmt = code;
    span.className = FMT_CLASS[code];
    const contents = part.extractContents();
    contents.querySelectorAll(`[data-fmt="${code}"]`).forEach((inner) => {
      if (inner instanceof HTMLElement) unwrap(inner);
    });
    span.appendChild(contents);
    part.insertNode(span);
    made.push(span);
  }
  return made;
}

/** Select from the first node to the last (so the next style lands on the same words). */
export function selectNodes(nodes: Node[]) {
  const sel = window.getSelection();
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (!sel || !first || !last || !first.isConnected || !last.isConnected) return;
  const range = document.createRange();
  range.setStartBefore(first);
  range.setEndAfter(last);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function fmtAt(root: HTMLElement, node: Node | null) {
  const on = new Set<Fmt>();
  let current = node;
  while (current && current !== root) {
    if (current instanceof HTMLElement && current.dataset.fmt && current.dataset.fmt in FMT_CLASS) on.add(current.dataset.fmt as Fmt);
    current = current.parentNode;
  }
  return on;
}
