import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { ChevronLeft } from "lucide-react";
// @ts-expect-error page-flip ships without type declarations
import { PageFlip } from "page-flip/dist/js/page-flip.module.js";
import { contentsOf, dressBook, type BookMeta, type DisplayPage, type LibraryPages, type PageFit } from "@/lib/porch/pdf-book";

const garamond = '"EB Garamond", Garamond, Palatino, "Palatino Linotype", "Times New Roman", serif';

type Point = { x: number; y: number };

type FlipBook = {
  loadFromHTML: (items: HTMLElement[]) => void;
  destroy: () => void;
  turnToPage: (page: number) => void;
  getCurrentPageIndex: () => number;
  getPageCount: () => number;
  on: (event: string, callback: (event: { data: number | string }) => void) => void;
  startUserTouch: (point: Point) => void;
  userStop: (point: Point, swipe?: boolean) => void;
  isUserMove: boolean;
  isUserTouch: boolean;
  render: { render: (time: number) => void; finishAnimation: () => void; getOrientation: () => string };
  getPageCollection: () => {
    getBottomPage: (direction: number) => unknown;
    getFlippingPage: (direction: number) => { newTemporaryCopy: () => unknown };
    getPage: (index: number) => { newTemporaryCopy: () => unknown };
    getCurrentSpreadIndex: () => number;
  };
  flipController: {
    getCalculation: () => { getPosition: () => Point; getDirection: () => number; getCorner: () => string } | null;
    getBoundsRect: () => { height: number; pageWidth: number; width: number };
    getState: () => string;
    fold: (point: Point) => void;
    reset: () => void;
    stopMove: () => void;
    animateFlippingTo: (from: Point, to: Point, complete: boolean) => void;
  };
  update: () => void;
};

function pointOf(block: Element, touch: { clientX: number; clientY: number }): Point {
  const rect = block.getBoundingClientRect();
  return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
}

function paintCurl(host: HTMLElement) {
  const curled = /rotate\((-?0*(\.\d+|[1-9]))/;
  host.querySelectorAll<HTMLElement>(".stf__item").forEach((sheet) => {
    sheet.classList.toggle("bible-curl", curled.test(sheet.style.transform));
  });
  const block = host.querySelector<HTMLElement>(".stf__block");
  const inner = host.querySelector<HTMLElement>(".stf__innerShadow");
  if (!block || !inner) return;
  let gleam = block.querySelector<HTMLElement>(".bible-gleam");
  if (!gleam) {
    gleam = document.createElement("div");
    gleam.className = "bible-gleam";
    block.appendChild(gleam);
  }
  const visible = inner.style.display === "block" && inner.style.clipPath;
  if (!visible) {
    gleam.style.display = "none";
    return;
  }
  const origin = parseFloat(inner.style.transformOrigin) || 0;
  gleam.style.cssText = `
    display: block;
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    z-index: ${Number(inner.style.zIndex || "12") + 1};
    width: ${inner.style.width};
    height: ${inner.style.height};
    transform-origin: ${inner.style.transformOrigin};
    transform: ${inner.style.transform};
    clip-path: ${inner.style.clipPath};
    -webkit-clip-path: ${inner.style.clipPath};
    background: linear-gradient(${origin > 20 ? "to left" : "to right"}, rgba(255,252,245,0.9), rgba(255,252,245,0) 9%);
  `;
}

function sheetElement(page: DisplayPage) {
  const sheet = document.createElement("div");
  sheet.className = `bible-sheet face-${page.face}`;
  sheet.lang = "en";
  const leaf = document.createElement("div");
  leaf.className = "bible-leaf";
  const finish = () => {
    sheet.append(leaf);
    return sheet;
  };
  if (page.face === "cover" || page.face === "rear") {
    sheet.dataset.tone = page.tone;
    sheet.style.background = page.tone;
    sheet.style.color = "#FAF6EE";
    if (page.face === "cover" && page.cover) {
      const image = document.createElement("img");
      image.className = "cover-art";
      image.src = page.cover;
      image.alt = page.bookTitle;
      leaf.append(image);
      return finish();
    }
    if (page.face === "cover") {
      const title = document.createElement("p");
      title.className = "cover-title";
      title.textContent = page.bookTitle;
      const author = document.createElement("p");
      author.className = "cover-author";
      author.textContent = page.author;
      if (!page.author) author.hidden = true;
      leaf.append(title, author);
      return finish();
    }
    if (page.summary) {
      const summary = document.createElement("p");
      summary.className = "rear-summary";
      summary.textContent = page.summary;
      leaf.append(summary);
    }
    return finish();
  }
  if (page.running) {
    const head = document.createElement("p");
    head.className = "running";
    head.textContent = page.bookTitle;
    leaf.append(head);
  }
  const body = document.createElement("div");
  body.className = "bible-sheet-body";
  if (page.face === "contents") body.addEventListener("touchmove", (event) => event.stopPropagation());
  if (page.face === "chapter") {
    const space = document.createElement("div");
    space.className = "chapter-space";
    body.append(space);
  }
  if (page.face === "title") {
    const title = document.createElement("p");
    title.className = "title-name";
    title.textContent = page.bookTitle;
    body.append(title);
    if (page.author) {
      const author = document.createElement("p");
      author.className = "title-author";
      author.textContent = page.author;
      body.append(author);
    }
    const publisher = document.createElement("p");
    publisher.className = "title-publisher";
    publisher.textContent = "Porchbook";
    body.append(publisher);
  }
  if (page.face === "contents") {
    const heading = document.createElement("h2");
    heading.textContent = "Contents";
    body.append(heading);
    for (const entry of page.entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "contents-entry";
      button.dataset.jump = String(entry.page);
      const name = document.createElement("span");
      name.textContent = entry.title;
      const mark = document.createElement("span");
      mark.textContent = entry.printed ? String(entry.printed) : "";
      button.append(name, mark);
      body.append(button);
    }
  }
  let paragraph: HTMLParagraphElement | null = null;
  let dropped = page.face !== "chapter";
  for (const block of page.blocks) {
    if (block.kind === "scene") {
      paragraph = null;
      const scene = document.createElement("p");
      scene.className = "scene";
      scene.textContent = "* * *";
      body.append(scene);
      continue;
    }
    if (block.kind === "image" && block.src) {
      paragraph = null;
      const image = document.createElement("img");
      image.className = "page-picture";
      image.src = block.src;
      image.alt = block.text || "";
      body.append(image);
      if (block.text) {
        const caption = document.createElement("p");
        caption.className = "caption";
        caption.textContent = block.text;
        body.append(caption);
      }
      continue;
    }
    if (block.role === "numeral") {
      const numeral = document.createElement("span");
      numeral.className = "bible-numeral";
      numeral.textContent = block.text;
      body.append(numeral);
      continue;
    }
    if (block.role === "kicker") {
      paragraph = null;
      const kicker = document.createElement("p");
      kicker.className = "chapter-number";
      kicker.textContent = block.text;
      body.append(kicker);
      continue;
    }
    if (block.verse) {
      if (!paragraph) {
        paragraph = document.createElement("p");
        paragraph.className = dropped ? "bible-verse" : "bible-verse drop";
        dropped = true;
        body.append(paragraph);
      } else paragraph.appendChild(document.createTextNode(" "));
      const num = document.createElement("sup");
      num.dataset.verse = String(block.verse);
      num.textContent = String(block.verse);
      paragraph.appendChild(num);
      let wordIndex = -1;
      for (const part of block.text.split(/(\s+)/)) {
        if (!/[A-Za-z]/.test(part)) {
          paragraph.appendChild(document.createTextNode(part));
          continue;
        }
        wordIndex += 1;
        const word = document.createElement("span");
        word.className = "bible-word";
        word.dataset.verse = String(block.verse);
        word.dataset.word = part;
        word.dataset.index = String(wordIndex);
        word.textContent = part;
        paragraph.appendChild(word);
      }
      continue;
    }
    if (block.kind === "heading") {
      paragraph = null;
      const chapterLine = block.role === "chapter" ? block.text.match(/^chapter\s+(\d+)\b[:.\s-]*(.*)$/i) : null;
      if (chapterLine) {
        const number = document.createElement("p");
        number.className = "chapter-number";
        number.textContent = `Chapter ${chapterLine[1]}`;
        body.append(number);
        if (chapterLine[2]) {
          const title = document.createElement("h2");
          title.textContent = chapterLine[2];
          body.append(title);
        }
        continue;
      }
      const line = document.createElement(block.role === "section" || block.sub ? "h3" : "h2");
      line.textContent = block.text;
      body.append(line);
      continue;
    }
    if (!paragraph || block.fresh) {
      const indent = Boolean(block.fresh) && !block.quote && !block.lead;
      paragraph = document.createElement("p");
      paragraph.className = `${block.quote ? "quote" : ""} ${block.italic ? "italic" : ""} ${!dropped && page.face === "chapter" ? "drop" : ""} ${indent ? "indent" : ""}`.trim();
      if (!dropped && page.face === "chapter") dropped = true;
      body.append(paragraph);
    } else paragraph.appendChild(document.createTextNode(" "));
    if (block.italic && !paragraph.classList.contains("italic")) {
      const em = document.createElement("em");
      em.textContent = block.text;
      paragraph.appendChild(em);
    } else paragraph.appendChild(document.createTextNode(block.text));
    if (block.reference) {
      const cite = document.createElement("p");
      cite.className = "quote-ref";
      cite.textContent = block.reference.startsWith("—") ? block.reference : `— ${block.reference}`;
      body.append(cite);
      paragraph = null;
    }
  }
  leaf.append(body);
  if (page.number != null && page.running) {
    const mark = document.createElement("p");
    mark.className = "bible-sheet-num";
    mark.textContent = String(page.number);
    leaf.append(mark);
  }
  return finish();
}

// Books no longer vibrate when they open or their pages turn (the sound stays).
function paperFeel(_completes: boolean) {}

function rustle() {
  const audio = new AudioContext();
  const length = Math.floor(audio.sampleRate * 0.32);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    const fade = Math.pow(1 - index / length, 1.5);
    data[index] = (Math.random() * 2 - 1) * fade * 0.4;
  }
  const source = audio.createBufferSource();
  source.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1600;
  filter.Q.value = 0.6;
  source.connect(filter);
  filter.connect(audio.destination);
  source.start();
  source.onended = () => void audio.close();
}

const curlCss = `
        .bible-host { position: absolute; inset: 0; }
        .bible-host .stf__parent {
          position: absolute !important;
          inset: 0 !important;
          width: 100% !important;
          height: 100% !important;
          min-width: 0 !important;
          min-height: 0 !important;
          max-width: none !important;
          touch-action: none;
          overflow: hidden;
        }
        .bible-host .stf__wrapper { height: 100%; padding-bottom: 0 !important; }
        .bible-host .stf__block { cursor: grab; }
        .bible-host .stf__item { position: absolute !important; }
        .bible-host .stf__item[style*="display: none"],
        .bible-host .stf__item[style*="display:none"] { display: none !important; }
        .bible-turning .stf__block { cursor: grabbing; }
        .stf__wrapper.--landscape .stf__block::before {
          content: "";
          position: absolute;
          top: 0;
          bottom: 0;
          left: 50%;
          width: 28px;
          transform: translateX(-50%);
          background: linear-gradient(to right, transparent, rgba(42,33,24,0.16) 42%, rgba(255,252,245,0.35) 50%, rgba(42,33,24,0.16) 58%, transparent);
          pointer-events: none;
          z-index: 4;
        }
        .bible-sheet {
          background-color: #faf6ee;
          color: #1e1b16;
          font-family: ${garamond};
          line-height: 1.5;
          box-sizing: border-box;
          overflow: hidden;
          hyphens: auto;
          user-select: none;
          -webkit-user-select: none;
          -webkit-touch-callout: none;
        }
        .bible-leaf {
          container-type: inline-size;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          position: relative;
          padding: 8cqw 8cqw 12cqw;
          font-size: 4.7cqw;
          line-height: 1.5;
        }
        .bible-size-small .bible-leaf { font-size: 4.05cqw; }
        .bible-size-large .bible-leaf { font-size: 5.5cqw; }
        .stf__item, .bible-sheet { background-color: #faf6ee; }
        .bible-sheet:not(.face-cover):not(.face-rear)::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -1;
          background: #faf6ee;
          pointer-events: none;
        }
        .bible-sheet-body { flex: 1; min-height: 0; overflow: hidden; }
        .bible-sheet p.running, .bible-sheet p.bible-sheet-num { margin: 0; color: #8a8478; text-align: center !important; font-size: 0.82em; line-height: 1.2; letter-spacing: 0.12em; width: 100%; }
        .bible-sheet p.running { margin-bottom: 0.4em; }
        .bible-sheet p.bible-sheet-num { position: absolute; left: 0; right: 0; bottom: 3.2cqw; margin: 0; padding: 0; pointer-events: none; }
        .chapter-space { height: 8cqw; flex: none; }
        .bible-sheet p.chapter-number { margin: 0 0 0.35em; text-align: center !important; font-size: 1.27em; line-height: 1.3; letter-spacing: 0.14em; }
        .bible-sheet h2 { margin: 0 0 0.8em; text-align: center; font-size: 2em; line-height: 1.15; font-weight: 400; }
        .bible-sheet h3 { margin: 1em 0 0.35em; text-align: left; font-size: 1.18em; line-height: 1.35; font-style: italic; font-weight: 400; }
        .bible-sheet p { margin: 0; text-align: justify; hyphens: auto; font-weight: 400; }
        .bible-sheet p.indent { text-indent: 1.5em; }
        .bible-sheet p.drop::first-letter { float: left; font-size: 4.5em; line-height: 0.8; padding-right: 0.06em; font-weight: 400; }
        .bible-sheet p.quote { margin: 0.8em 2em; font-style: italic; text-indent: 0; }
        .bible-sheet p.italic { font-style: italic; }
        .bible-sheet p.scene { margin: 1em 0; text-align: center !important; letter-spacing: 0.4em; }
        .bible-sheet p.quote-ref { margin: 0.2em 2em 0.8em; text-align: right !important; font-style: italic; }
        .bible-sheet p.caption { margin: 0 0 0.8em; text-align: center !important; font-size: 0.82em; font-style: italic; }
        .bible-verse { margin: 0; text-align: justify; text-indent: 0; }
        .bible-verse sup, .bible-sheet sup { margin-right: 0.15em; font-size: 0.62em; line-height: 0; color: #8a8478; font-style: normal; }
        .bible-word.on, .bible-sheet sup.on { background: rgba(138, 132, 120, 0.28); border-radius: 2px; }
        .bible-numeral { float: left; margin: 0.05em 0.12em 0 0; font-size: 4.5em; line-height: 0.8; font-weight: 400; }
        .contents-entry { display: flex; align-items: baseline; justify-content: space-between; gap: 0.8em; width: 100%; margin: 0; padding: 0.28em 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; }
        .contents-entry span:first-child { min-width: 0; }
        .contents-entry span:last-child { color: #8a8478; }
        .face-contents .bible-sheet-body { overflow-y: auto; }
        .cover-title, .title-name, .chapter-number, .running, .bible-sheet-num { font-variant: small-caps; }
        .cover-title { margin: 18% 8% 0; text-align: center; font-size: 2em; line-height: 1.15; letter-spacing: 0.06em; }
        .cover-author { margin: auto 8% 12%; text-align: center; font-size: 1.1em; letter-spacing: 0.08em; }
        .face-cover .bible-leaf, .face-rear .bible-leaf { padding: 0; color: #faf6ee; }
        .cover-art { width: 100%; height: 100%; object-fit: cover; }
        .rear-summary { margin: auto 10%; text-align: center; font-size: 1.05em; line-height: 1.45; }
        .title-name { margin: 22% 0 0.6em; text-align: center; font-size: 2.55em; line-height: 1.15; letter-spacing: 0.08em; }
        .title-author, .title-publisher { margin: 0.4em 0 0; text-align: center; font-size: 1.15em; letter-spacing: 0.06em; }
        .title-publisher { margin-top: auto; padding-bottom: 6%; }
        .page-picture { display: block; width: 100%; height: auto; margin: 0.6em 0 0.2em; }
        .bible-flutter .stf__item.--simple { animation: bible-flutter 460ms ease-out; transform-origin: 50% 100%; }
        @keyframes bible-flutter {
          0% { transform: translateY(-6px) rotate(-0.5deg); }
          42% { transform: translateY(1px) rotate(0.28deg); }
          72% { transform: translateY(-1px) rotate(-0.1deg); }
          100% { transform: none; }
        }
`;

export function CurlHost({
  pages,
  sound = false,
  startAt = 0,
  highlight = null,
  flipRef,
  onIndex,
  onVerse,
  onPastEnd,
  onBeforeStart,
  fit = "normal",
  onFit,
}: {
  pages: DisplayPage[];
  sound?: boolean;
  startAt?: number;
  highlight?: number | null;
  flipRef?: MutableRefObject<FlipBook | null>;
  onIndex?: (index: number) => void;
  onVerse?: (verse: number, word?: string, index?: number) => void;
  onPastEnd?: () => void;
  onBeforeStart?: () => void;
  fit?: PageFit;
  onFit?: (fit: PageFit) => void;
}) {
  const bookRef = useRef<HTMLDivElement>(null);
  const soundRef = useRef(sound);
  const indexRef = useRef(onIndex);
  const verseRef = useRef(onVerse);
  const pastRef = useRef(onPastEnd);
  const beforeRef = useRef(onBeforeStart);
  soundRef.current = sound;
  indexRef.current = onIndex;
  verseRef.current = onVerse;
  pastRef.current = onPastEnd;
  beforeRef.current = onBeforeStart;
  const openAt = useRef(startAt);
  const seenPages = useRef(pages);
  if (seenPages.current !== pages) {
    seenPages.current = pages;
    openAt.current = startAt;
  }

  useEffect(() => {
    const id = "porch-garamond";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap";
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    const parent = bookRef.current;
    if (!parent || !pages.length) return;
    const host = document.createElement("div");
    host.className = "bible-host";
    parent.appendChild(host);
    const flip = new PageFlip(host, {
      width: 432,
      height: 648,
      size: "stretch",
      minWidth: 200,
      maxWidth: 1200,
      minHeight: 240,
      maxHeight: 1600,
      drawShadow: true,
      flippingTime: 800,
      usePortrait: true,
      autoSize: false,
      maxShadowOpacity: 0.35,
      showCover: false,
      mobileScrollSupport: false,
      swipeDistance: 24,
      clickEventForward: true,
      useMouseEvents: true,
      showPageCorners: false,
      disableFlipByClick: false,
      startPage: Math.max(0, Math.min(openAt.current, pages.length - 1)),
      startZIndex: 2,
    }) as FlipBook;
    flip.loadFromHTML(pages.map((sheet) => sheetElement(sheet)));
    const collection = flip.getPageCollection();
    const bottomOf = collection.getBottomPage.bind(collection);
    const flipOf = collection.getFlippingPage.bind(collection);
    collection.getFlippingPage = (direction) => {
      if (flip.render.getOrientation() !== "portrait" || direction === 0) return flipOf(direction);
      return collection.getPage(collection.getCurrentSpreadIndex()).newTemporaryCopy() as ReturnType<typeof flipOf>;
    };
    collection.getBottomPage = (direction) => {
      if (flip.render.getOrientation() !== "portrait") return bottomOf(direction);
      const current = collection.getCurrentSpreadIndex();
      const index = direction === 0 ? current + 1 : current - 1;
      if (index < 0 || index >= flip.getPageCount()) return bottomOf(direction);
      try {
        return collection.getPage(index);
      } catch {
        return bottomOf(direction);
      }
    };
    const arm = flip.startUserTouch.bind(flip);
    flip.startUserTouch = (point) => {
      if (flip.flipController.getState() === "read") {
        flip.isUserMove = false;
        flip.isUserTouch = false;
      } else if (flip.isUserMove && flip.isUserTouch) return;
      arm(point);
    };
    const stopUser = flip.userStop.bind(flip);
    flip.userStop = (point, swipe) => {
      if (!swipe && !flip.isUserMove) {
        flip.isUserTouch = false;
        return;
      }
      stopUser(point, swipe);
    };
    const controller = flip.flipController;
    let downX: number | null = null;
    let downAt = 0;
    let dragged = false;
    let armed = false;
    let alive = true;
    const onTouch = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      const block = host.querySelector(".stf__block");
      if (!touch || !block) return;
      const point = pointOf(block, touch);
      downX = point.x;
      downAt = performance.now();
      dragged = false;
      armed = true;
      flip.startUserTouch(point);
    };
    host.addEventListener("touchstart", onTouch, { capture: true, passive: true });
    let across = 1;
    const place = (clientX: number) => {
      const block = host.querySelector(".stf__block");
      if (!block) return;
      const rect = block.getBoundingClientRect();
      if (rect.width > 0) across = (clientX - rect.left) / rect.width;
    };
    const feelRelease = (clientX: number) => {
      if (!armed) return;
      armed = false;
      const block = host.querySelector(".stf__block");
      const start = downX;
      if (!block || start === null) return;
      const moved = clientX - block.getBoundingClientRect().left - start;
      if (!dragged && Math.abs(moved) < 18) return;
      const single = flip.render.getOrientation() === "portrait";
      const swipe = Math.abs(moved) > 24 && performance.now() - downAt < 280;
      const completes = !single || swipe || (moved < 0 ? across <= 0.5 : across >= 0.5);
      paperFeel(completes);
    };
    const onTouchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      place(touch.clientX);
      feelRelease(touch.clientX);
    };
    const onPointerDown = (event: PointerEvent) => {
      const block = host.querySelector(".stf__block");
      if (!block) return;
      downX = event.clientX - block.getBoundingClientRect().left;
      downAt = performance.now();
      dragged = false;
      const inside = event.target instanceof Node && host.contains(event.target);
      if (inside) armed = true;
      else if (event.pointerType !== "touch") armed = false;
      place(event.clientX);
    };
    const onPointerMove = (event: PointerEvent) => {
      place(event.clientX);
      const block = host.querySelector(".stf__block");
      if (!block || downX === null) return;
      if (Math.abs(event.clientX - block.getBoundingClientRect().left - downX) > 10) dragged = true;
    };
    const onPointerUp = (event: PointerEvent) => {
      place(event.clientX);
      feelRelease(event.clientX);
      const block = host.querySelector(".stf__block");
      const start = downX;
      if (!block || start === null) return;
      const moved = event.clientX - block.getBoundingClientRect().left - start;
      const page = flip.getCurrentPageIndex();
      window.setTimeout(() => {
        if (!alive || !host.isConnected || controller.getState() !== "read") return;
        if (flip.getCurrentPageIndex() !== page) return;
        const total = flip.getPageCount();
        const single = flip.render.getOrientation() === "portrait";
        if (moved <= -56 && page >= total - (single ? 1 : 2)) pastRef.current?.();
        if (moved >= 56 && page <= 0) beforeRef.current?.();
      }, 70);
    };
    const onClick = (event: MouseEvent) => {
      if (dragged) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const jump = target.closest<HTMLElement>("[data-jump]");
      if (jump) {
        flip.turnToPage(Number(jump.dataset.jump) || 0);
        return;
      }
      const word = target.closest<HTMLElement>("[data-word]");
      const verse = (word ?? target.closest<HTMLElement>("[data-verse]"))?.dataset.verse;
      if (!verse) return;
      verseRef.current?.(Number(verse), word?.dataset.word, word ? Number(word.dataset.index) : undefined);
    };
    host.addEventListener("click", onClick);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("touchend", onTouchEnd, true);
    const follow = controller.fold.bind(controller);
    controller.fold = (point) => {
      if (downX === null) downX = point.x;
      if (controller.getState() === "fold_corner") flip.render.finishAnimation();
      const calc = controller.getCalculation();
      const blockWidth = host.querySelector(".stf__block")?.getBoundingClientRect().width || 1;
      const single = flip.render.getOrientation() === "portrait";
      const movingBack = point.x > downX + 8;
      if (single && movingBack && downX < blockWidth * 0.5 && calc?.getDirection() !== 1) {
        controller.reset();
        follow({ x: 8, y: point.y });
      }
      follow(point);
    };
    const release = controller.stopMove.bind(controller);
    let felt = false;
    controller.stopMove = () => {
      const calc = controller.getCalculation();
      const single = flip.render.getOrientation() === "portrait";
      if (!calc || !single) {
        release();
        return;
      }
      const forward = calc.getDirection() === 0;
      const passed = forward ? across <= 0.5 : across >= 0.5;
      felt = true;
      const bounds = controller.getBoundsRect();
      const y = calc.getCorner() === "bottom" ? bounds.height : 0;
      controller.animateFlippingTo(calc.getPosition(), passed ? { x: -bounds.pageWidth, y } : { x: bounds.pageWidth, y }, passed);
      paperFeel(passed);
    };

    let curling = false;
    let turned = false;
    let previous = "read";
    flip.on("flip", (event) => indexRef.current?.(Number(event.data) || 0));
    flip.on("changeState", (event) => {
      const next = String(event.data);
      curling = next !== "read";
      host.classList.toggle("bible-turning", curling);
      if (next === "user_fold" || next === "flipping") turned = true;
      if (next === "flipping" && !felt) paperFeel(true);
      if (soundRef.current && (next === "flipping" || (next === "read" && previous === "user_fold"))) rustle();
      previous = next;
      if (next === "read") {
        felt = false;
        downX = null;
        // No settle-shake after a page lands: the book stays still.
        turned = false;
        host.querySelectorAll(".bible-curl").forEach((sheet) => sheet.classList.remove("bible-curl"));
        host.querySelectorAll<HTMLElement>(".bible-gleam").forEach((gleam) => {
          gleam.style.display = "none";
        });
      }
    });

    const nativeFrame = window.requestAnimationFrame.bind(window);
    const renderer = flip.render as FlipBook["render"] & {
      drawBottomPage: () => void;
      bottomPage: { getElement: () => HTMLElement; draw: (density?: unknown) => void } | null;
      flippingPage: { getDrawingDensity: () => unknown } | null;
      getSettings: () => { startZIndex: number };
    };
    const drawBottom = renderer.drawBottomPage.bind(renderer);
    renderer.drawBottomPage = () => {
      const bottom = renderer.bottomPage;
      if (!bottom) return;
      if (renderer.getOrientation() !== "portrait") {
        drawBottom();
        return;
      }
      const density = renderer.flippingPage ? renderer.flippingPage.getDrawingDensity() : undefined;
      bottom.draw(density);
      const sheet = bottom.getElement();
      const anchor = host.querySelector<HTMLElement>(".stf__item.--simple");
      if (anchor) {
        sheet.style.left = anchor.style.left;
        sheet.style.top = anchor.style.top;
        sheet.style.width = anchor.style.width;
        sheet.style.height = anchor.style.height;
      }
      sheet.style.transform = "none";
      sheet.style.zIndex = String(renderer.getSettings().startZIndex + 3);
    };
    const draw = renderer.render.bind(renderer);
    renderer.render = (time: number) => {
      if (!alive || !host.isConnected) {
        alive = false;
        window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame;
        queueMicrotask(() => {
          window.requestAnimationFrame = nativeFrame;
        });
        return;
      }
      draw(time);
      host.querySelectorAll<HTMLElement>(".stf__item").forEach((item) => {
        const tone = item.dataset.tone;
        if (tone) item.style.backgroundColor = tone;
        else if (!item.classList.contains("face-cover") && !item.classList.contains("face-rear")) item.style.backgroundColor = "#faf6ee";
      });
      if (curling) paintCurl(host);
      else {
        const stage = host.querySelector<HTMLElement>(".stf__block");
        const shown = [...host.querySelectorAll<HTMLElement>(".stf__item.--simple")].filter((item) => item.offsetWidth > 0 && item.style.display !== "none");
        if (stage && shown.length) {
          const left = Math.min(...shown.map((item) => parseFloat(item.style.left) || 0));
          const right = Math.max(...shown.map((item) => (parseFloat(item.style.left) || 0) + item.offsetWidth));
          const nudge = Math.round((host.clientWidth - (right - left)) / 2 - left);
          const next = `translateX(${nudge}px)`;
          if (stage.style.transform !== next) stage.style.transform = next;
        }
      }
    };

    const fitWindow = () => {
      if (!host.isConnected) return;
      const box = parent.getBoundingClientRect();
      if (box.width < 40 || box.height < 40) return;
      flip.update();
    };
    const frame = window.requestAnimationFrame(fitWindow);
    window.addEventListener("resize", fitWindow);
    if (flipRef) flipRef.current = flip;
    return () => {
      alive = false;
      host.removeEventListener("touchstart", onTouch, true);
      host.removeEventListener("click", onClick);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("touchend", onTouchEnd, true);
      window.removeEventListener("resize", fitWindow);
      window.cancelAnimationFrame(frame);
      if (flipRef) flipRef.current = null;
      flip.destroy();
      window.requestAnimationFrame = nativeFrame;
    };
  }, [flipRef, pages]);

  useEffect(() => {
    const host = bookRef.current;
    if (!host) return;
    host.querySelectorAll<HTMLElement>("[data-verse]").forEach((line) => {
      line.classList.toggle("on", highlight != null && Number(line.dataset.verse) === highlight);
    });
  }, [highlight, pages]);

  return (
    <>
      <style>{curlCss}</style>
      <div ref={bookRef} className={`bible-size-${fit} absolute inset-0`} />
      {onFit ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-[#2a2118]/85 px-1.5 py-1 text-[#f7f3ea] shadow">
            <button type="button" className="min-h-10 min-w-10 rounded-full px-2 text-sm font-semibold disabled:opacity-35" aria-label="Smaller text" disabled={fit === "small"} onClick={() => onFit(fit === "large" ? "normal" : "small")}>
              🔎−
            </button>
            <button type="button" className="min-h-10 min-w-10 rounded-full px-2 text-sm font-semibold disabled:opacity-35" aria-label="Larger text" disabled={fit === "large"} onClick={() => onFit(fit === "small" ? "normal" : "large")}>
              🔎+
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ScrollRead({ pages, fit, startAt, onFit, onIndex }: { pages: DisplayPage[]; fit: PageFit; startAt: number; onFit: (fit: PageFit) => void; onIndex: (index: number) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = scroller.current;
    if (!host) return;
    host.replaceChildren();
    pages.forEach((page, index) => {
      const frame = document.createElement("article");
      frame.className = "book-scroll-page";
      frame.id = `book-page-${index}`;
      frame.append(sheetElement(page));
      host.append(frame);
    });
    const target = host.children[Math.min(startAt, Math.max(pages.length - 1, 0))] as HTMLElement | undefined;
    if (target) target.scrollIntoView();
  }, [pages]);
  return (
    <>
      <style>{curlCss}</style>
      <div
        ref={scroller}
        className={`book-scroll bible-size-${fit}`}
        onScroll={(event) => {
          const host = event.currentTarget;
          const top = host.scrollTop;
          let nearest = 0;
          let best = Number.POSITIVE_INFINITY;
          for (let index = 0; index < host.children.length; index += 1) {
            const page = host.children[index] as HTMLElement;
            const distance = Math.abs(page.offsetTop - top);
            if (distance < best) {
              best = distance;
              nearest = index;
            }
          }
          onIndex(nearest);
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-[#2a2118]/85 px-1.5 py-1 text-[#f7f3ea] shadow">
          <button type="button" className="min-h-10 min-w-10 rounded-full px-2 text-sm font-semibold disabled:opacity-35" aria-label="Smaller text" disabled={fit === "small"} onClick={() => onFit(fit === "large" ? "normal" : "small")}>
            A−
          </button>
          <button type="button" className="min-h-10 min-w-10 rounded-full px-2 text-sm font-semibold disabled:opacity-35" aria-label="Larger text" disabled={fit === "large"} onClick={() => onFit(fit === "small" ? "normal" : "large")}>
            A+
          </button>
        </div>
      </div>
    </>
  );
}

export function LibraryBook({
  title,
  pages,
  meta,
  empty = "",
  busy = false,
  edited = false,
  onClose,
  onFile,
  onEmpty,
  onWrite,
  extra,
}: {
  title: string;
  pages: LibraryPages;
  meta?: BookMeta;
  empty?: string;
  busy?: boolean;
  edited?: boolean;
  onClose: () => void;
  onFile?: (file: File) => void;
  onEmpty?: () => void;
  onWrite?: () => void;
  /** Something extra in the top bar (⬇ Download). */
  extra?: React.ReactNode;
}) {
  const [sound, setSound] = useState(false);
  const [fit, setFit] = useState<PageFit>("normal");
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<"flip" | "scroll">("flip");
  const [contentsOpen, setContentsOpen] = useState(false);
  const flipRef = useRef<FlipBook | null>(null);
  const sheets = useMemo(
    () => (pages.length ? dressBook(pages, fit, { title, author: meta?.author, summary: meta?.summary, cover: meta?.cover }) : []),
    [pages, fit, title, meta?.author, meta?.summary, meta?.cover],
  );
  const entries = useMemo(() => contentsOf(sheets), [sheets]);

  useEffect(() => {
    const saved = localStorage.getItem("porch-read-mode");
    if (saved === "scroll" || saved === "flip") setMode(saved);
  }, []);

  function choose(next: "flip" | "scroll") {
    setMode(next);
    localStorage.setItem("porch-read-mode", next);
  }

  return (
    <div className="book-window bg-[#cbbba4] text-[#2a2118]">
      <header className="relative z-30 shrink-0 bg-[#e4d2b8] px-2 pt-1 pb-2">
        {onFile ? (
          <label className="mx-auto flex min-h-9 w-fit cursor-pointer items-center justify-center px-3 text-sm font-semibold">
            {busy ? "Replacing…" : "Replace"}
            <input
              type="file"
              accept=".pdf,.txt,.docx,.epub,application/pdf,text/plain"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onFile(file);
              }}
            />
          </label>
        ) : null}
        <div className="flex items-center gap-1">
          <button type="button" className="flex min-h-11 items-center gap-1 px-1 text-base font-semibold" onClick={onClose}>
            <ChevronLeft className="size-5" aria-hidden="true" />
            Back
          </button>
          <p className="min-w-0 flex-1 truncate text-center text-sm font-semibold">
            {title}
            {edited ? <span className="text-red-700"> edited</span> : null}
          </p>
          {onWrite ? (
            <button type="button" className="min-h-11 px-2 text-sm font-semibold" onClick={onWrite}>
              Write
            </button>
          ) : null}
          {extra}
          <button type="button" className={`min-h-11 px-2 text-sm ${sound ? "font-semibold" : "opacity-70"}`} onClick={() => setSound((on) => !on)}>
            Sound
          </button>
          <button type="button" className={`min-h-11 px-2 text-sm ${mode === "flip" ? "font-semibold" : "opacity-70"}`} onClick={() => choose("flip")}>
            Flip
          </button>
          <button type="button" className={`min-h-11 px-2 text-sm ${mode === "scroll" ? "font-semibold" : "opacity-70"}`} onClick={() => choose("scroll")}>
            Scroll
          </button>
          <button type="button" className="min-h-11 px-2 text-sm font-semibold" onClick={() => setContentsOpen(true)}>
            Contents
          </button>
        </div>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {sheets.length ? (
          mode === "scroll" ? (
            <ScrollRead pages={sheets} fit={fit} startAt={Math.min(index, Math.max(sheets.length - 1, 0))} onFit={setFit} onIndex={setIndex} />
          ) : (
            <CurlHost pages={sheets} sound={sound} fit={fit} onFit={setFit} flipRef={flipRef} onIndex={setIndex} startAt={Math.min(index, Math.max(sheets.length - 1, 0))} />
          )
        ) : (
          <p className="px-6 pt-10 text-lg font-semibold">{empty || "This book has no pages yet."}</p>
        )}
        {onEmpty && sheets.length ? (
          <button type="button" className="absolute top-2 right-3 z-20 text-xs font-semibold text-[#6b5344] underline" onClick={onEmpty}>
            Empty
          </button>
        ) : null}
      </div>
      {contentsOpen ? (
        <div className="absolute inset-0 z-40 flex flex-col bg-[#faf6ee]" onTouchMove={(event) => event.stopPropagation()}>
          <div className="flex items-center gap-2 px-2 py-2">
            <button type="button" className="flex min-h-11 items-center gap-1 px-1 text-base font-semibold" onClick={() => setContentsOpen(false)}>
              <ChevronLeft className="size-5" aria-hidden="true" />
              Back
            </button>
            <p className="text-sm font-semibold">Contents</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-24">
            {entries.length ? (
              entries.map((entry) => (
                <button
                  key={`${entry.page}:${entry.title}`}
                  type="button"
                  className="flex w-full items-baseline justify-between gap-3 border-b border-[#e6dcc8] py-3 text-left"
                  onClick={() => {
                    if (mode === "scroll") document.getElementById(`book-page-${entry.page}`)?.scrollIntoView({ behavior: "smooth" });
                    else flipRef.current?.turnToPage(entry.page);
                    setIndex(entry.page);
                    setContentsOpen(false);
                  }}
                >
                  <span>{entry.title}</span>
                  <span className="text-[#8a8478]">{entry.printed ?? ""}</span>
                </button>
              ))
            ) : (
              <p className="pt-6 text-sm text-[#6b5344]">This book has no chapter list.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
