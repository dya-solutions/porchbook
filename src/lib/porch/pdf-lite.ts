/** A tiny text-only PDF (Helvetica, A4) for lists people print or share. */

export type PdfLine = { text: string; size?: number; x?: number; gap?: number; right?: string; newPage?: boolean };

function latin(value: string): string {
  return value.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, "-").replace(/[^\x20-\x7E]/g, "?");
}
function esc(value: string): string {
  return latin(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function textPdf(lines: PdfLine[]): string {
  const left = 48;
  const top = 790;
  const bottom = 56;
  const pages: string[] = [];
  let ops: string[] = [];
  let y = top;
  const flush = () => {
    pages.push(ops.join("\n"));
    ops = [];
    y = top;
  };
  for (const line of lines) {
    if (line.newPage && ops.length) flush();
    const size = line.size ?? 11;
    const gap = line.gap ?? size + 5;
    if (y - gap < bottom) flush();
    ops.push(`BT /F1 ${size} Tf ${line.x ?? left} ${y - size} Td (${esc(line.text)}) Tj ET`);
    if (line.right) ops.push(`BT /F1 ${size} Tf 400 ${y - size} Td (${esc(line.right)}) Tj ET`);
    y -= gap;
  }
  if (ops.length || !pages.length) flush();
  const objects: string[] = [];
  const pageIds: number[] = [];
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let next = 4;
  for (const content of pages) {
    const contentId = next++;
    const pageId = next++;
    pageIds.push(pageId);
    objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
  }
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id += 1) {
    if (!objects[id]) continue;
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf).toString("base64");
}

/**
 * A PDF of tables, like a spreadsheet: a title, then sections, each a table with a
 * green header row and a ruled grid (A4 landscape). Header rows repeat on a new page.
 */
export type PdfColumn = { label: string; width: number; align?: "left" | "right" | "center" };
export type PdfBlock =
  | { kind: "title"; text: string; sub?: string }
  | { kind: "heading"; text: string; newPage?: boolean }
  | { kind: "table"; columns: PdfColumn[]; rows: string[][]; empty?: string };

export function tablePdf(blocks: PdfBlock[]): string {
  const W = 842;
  const H = 595;
  const left = 36;
  const right = W - 36;
  const top = H - 36;
  const bottom = 40;
  const rowH = 18;
  const headH = 22;
  const size = 9;
  const pages: string[] = [];
  let ops: string[] = [];
  let y = top;
  let pageNo = 0;
  const flush = () => {
    pageNo += 1;
    ops.push(`0.45 0.45 0.45 rg BT /F1 8 Tf ${right - 40} 22 Td (Page ${pageNo}) Tj ET 0 0 0 rg`);
    pages.push(ops.join("\n"));
    ops = [];
    y = top;
  };
  // Helvetica is about half its size wide per letter: cut text that won't fit its cell.
  const fit = (value: string, width: number, bold = false) => {
    const room = Math.max(1, Math.floor((width - 8) / (size * (bold ? 0.56 : 0.5))));
    const t = latin(value);
    return t.length > room ? `${t.slice(0, Math.max(1, room - 2)).trimEnd()}..` : t;
  };
  const textAt = (value: string, x: number, width: number, baseline: number, align: PdfColumn["align"], font: "F1" | "F2") => {
    const t = fit(value, width, font === "F2");
    const w = t.length * size * (font === "F2" ? 0.56 : 0.5);
    const at = align === "right" ? x + width - 4 - w : align === "center" ? x + (width - w) / 2 : x + 4;
    ops.push(`BT /${font} ${size} Tf ${at.toFixed(1)} ${baseline.toFixed(1)} Td (${t.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")}) Tj ET`);
  };
  const widths = (columns: PdfColumn[]) => {
    const total = columns.reduce((sum, c) => sum + c.width, 0) || 1;
    return columns.map((c) => (c.width / total) * (right - left));
  };
  const header = (columns: PdfColumn[]) => {
    const ws = widths(columns);
    // The green header row with white bold words.
    ops.push(`0 0.69 0.31 rg ${left} ${y - headH} ${right - left} ${headH} re f 0 0 0 rg`);
    let x = left;
    ops.push("1 1 1 rg");
    columns.forEach((c, i) => {
      textAt(c.label, x, ws[i], y - headH + 7, c.align ?? "left", "F2");
      x += ws[i];
    });
    ops.push("0 0 0 rg");
    grid(columns, headH);
    y -= headH;
  };
  const grid = (columns: PdfColumn[], h: number) => {
    const ws = widths(columns);
    ops.push(`0.5 w 0 0 0 RG ${left} ${y - h} ${right - left} ${h} re S`);
    let x = left;
    for (let i = 0; i < ws.length - 1; i += 1) {
      x += ws[i];
      ops.push(`${x.toFixed(1)} ${y} m ${x.toFixed(1)} ${y - h} l S`);
    }
  };
  for (const block of blocks) {
    if (block.kind === "title") {
      ops.push(`BT /F2 18 Tf ${left} ${y - 18} Td (${esc(block.text)}) Tj ET`);
      y -= 26;
      if (block.sub) {
        ops.push(`0.35 0.35 0.35 rg BT /F1 10 Tf ${left} ${y - 10} Td (${esc(block.sub)}) Tj ET 0 0 0 rg`);
        y -= 20;
      }
      continue;
    }
    if (block.kind === "heading") {
      if ((block.newPage && ops.length) || y - 24 - headH - rowH < bottom) flush();
      ops.push(`BT /F2 13 Tf ${left} ${y - 16} Td (${esc(block.text)}) Tj ET`);
      y -= 24;
      continue;
    }
    if (y - headH - rowH < bottom) flush();
    header(block.columns);
    const rows = block.rows.length ? block.rows : [[block.empty ?? "None yet", ...block.columns.slice(1).map(() => "")]];
    for (const row of rows) {
      if (y - rowH < bottom) {
        flush();
        header(block.columns);
      }
      const ws = widths(block.columns);
      let x = left;
      block.columns.forEach((c, i) => {
        textAt(row[i] ?? "", x, ws[i], y - rowH + 6, c.align ?? "left", "F1");
        x += ws[i];
      });
      grid(block.columns, rowH);
      y -= rowH;
    }
    y -= 14;
  }
  if (ops.length || !pages.length) flush();
  const objects: string[] = [];
  const pageIds: number[] = [];
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  let next = 5;
  for (const content of pages) {
    const contentId = next++;
    const pageId = next++;
    pageIds.push(pageId);
    objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`;
  }
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id += 1) {
    if (!objects[id]) continue;
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf).toString("base64");
}
