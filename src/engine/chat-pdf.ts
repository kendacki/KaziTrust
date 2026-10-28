import { jsPDF } from "jspdf";
import type { Thread } from "../storage";
import type { Report, Visual } from "../types";

const INK: [number, number, number] = [11, 12, 14];
const MUTE: [number, number, number] = [95, 99, 106];
const LINE: [number, number, number] = [228, 230, 233];
const GREEN: [number, number, number] = [46, 125, 83];
const SURFACE: [number, number, number] = [243, 244, 245];
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const LEFT = 40;
const WIDTH = PAGE_W - LEFT * 2;
const BOTTOM = 40;

const ADDRESS = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const SHORT = /[1-9A-HJ-NP-Za-km-z]{2,8}(?:…|\.{3})[1-9A-HJ-NP-Za-km-z]{2,8}/g;

const PLAIN_TYPE: Record<string, string> = {
  "on-chain contract": "Contract read",
  "token mint": "Token mint read",
  "high-frequency address": "High-frequency wallet",
  "active holder": "Active holder",
  "quiet address": "Quiet wallet",
  "new or quiet wallet": "New wallet",
  "established wallet": "Established wallet",
  "seasoned wallet": "Seasoned wallet",
  "active wallet": "Active wallet",
  "blocked address": "Blocked wallet",
};

type Turn = {
  question: string;
  answer: string;
  report?: Report;
  stopped?: boolean;
};

export function chatPdfName(thread: Thread, when = new Date()): string {
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(when);
  const stem = clip(contextStem(thread), 72) || "Wallet read";
  return `${fileSafe(stem)} ${date}.pdf`;
}

export async function downloadChatPdf(thread: Thread): Promise<void> {
  const when = new Date();
  const logo = await inkLogo();
  const doc = buildChatPdf(thread, logo, when);
  doc.save(chatPdfName(thread, when));
}

export function buildChatPdf(thread: Thread, logo: Logo | null, when = new Date()): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const stem = clip(contextStem(thread), 72) || "Wallet read";
  doc.setProperties({ title: stem, creator: "KaziTrust", subject: "Wallet read" });
  const scoring = [...thread.messages].reverse().find((message) => message.report)?.report?.scoringVersion;
  const sheet = new Sheet(doc, logo, stem, when, scoring ? `Scoring ${scoring}` : "");
  const blocks = turns(thread);
  if (!blocks.length) {
    sheet.notice("This chat has no messages yet.");
  }
  blocks.forEach((turn, index) => {
    if (index > 0) sheet.split();
    sheet.turn(turn, index + 1);
  });
  sheet.finish();
  return doc;
}

function contextStem(thread: Thread): string {
  const report = [...thread.messages].reverse().find((message) => message.report)?.report;
  const questions = thread.messages.filter((message) => message.role === "user").map((message) => message.content);
  const question = questions.at(-1) || questions[0] || thread.title || "";
  const q = question.toLowerCase();
  const band = report?.band ?? null;
  if (report?.kind === "compare" || /\bcompare\b/.test(q)) return "Wallet comparison";
  if (report?.kind === "batch") return withBand("Batch read", band);
  if (report?.illustrative || /sample deployer|illustrative/.test(q)) return "Sample deployer read";
  if (/\bfund|who sent|follow the money/.test(q)) return withBand("Funding trace", band);
  if (/\bapprov|delegat/.test(q)) return withBand("Approval read", band);

  const tokens = tokenNames(report);
  const named = report ? specificType(report.typeGuess) : null;
  const plain = report ? PLAIN_TYPE[report.typeGuess.toLowerCase()] : null;
  const deep = /\bdeep\b/.test(q) || /one year/i.test(report?.summary ?? "");
  if (deep) {
    const focus = tokens.length ? `${joinList(tokens)} holdings` : named || plain;
    return withBand(focus ? `Deep scan, ${focus}` : "Deep scan", band);
  }
  if (named) return withBand(named, band);
  if (tokens.length) return withBand(`${joinList(tokens)} holdings`, band);
  if (plain) return withBand(plain, band);
  if (!report && /\bscor|method\b/.test(q)) return "Scoring method";
  if (band) return `${band} wallet read`;
  return leftover(thread.title) || leftover(question) || "Wallet read";
}

function withBand(stem: string, band: string | null): string {
  if (!band || stem.toLowerCase().includes(band.toLowerCase())) return stem;
  return `${stem}, ${band.toLowerCase()}`;
}

function specificType(type: string): string | null {
  if (PLAIN_TYPE[type.toLowerCase()]) return null;
  const clean = fileSafe(type);
  if (clean.length < 2) return null;
  return /read$/i.test(clean) ? clean : `${clean} read`;
}

function tokenNames(report?: Report): string[] {
  const visual = report?.visuals.find((item) => item.type === "holdings");
  if (!visual || visual.type !== "holdings") return [];
  const names: string[] = [];
  for (const row of visual.rows) {
    if (row.label === "SOL" || row.mark === "sol") continue;
    if (isShortMint(row.label)) continue;
    const label = row.name && row.name.toLowerCase() !== row.label.toLowerCase() ? row.name : row.label;
    const clean = fileSafe(label);
    if (!clean || isShortMint(clean) || names.includes(clean)) continue;
    names.push(clean);
    if (names.length === 2) break;
  }
  return names;
}

function leftover(value: string): string | null {
  const clean = fileSafe(value).replace(/^(read|check|scan)\b/i, "").trim();
  if (clean.length < 4) return null;
  return clean;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function isShortMint(label: string): boolean {
  return /^.{4}(?:…|\.{3}).{4}$/.test(label);
}

function fileSafe(value: string): string {
  return value
    .replace(ADDRESS, " ")
    .replace(SHORT, " ")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/[^\w\s,'-]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}

function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max).replace(/\s+\S*$/, "").trim();
  return cut || clean.slice(0, max).trim();
}

function pdfText(value: string): string {
  return value
    .replace(/[—–]/g, ", ")
    .replace(/…/g, "...")
    .replace(/[^\n\r\t\x20-\x7E]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function turns(thread: Thread): Turn[] {
  const blocks: Turn[] = [];
  for (const message of thread.messages) {
    if (message.role === "user") {
      blocks.push({ question: message.content, answer: "" });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (!last || last.answer || last.report) {
      blocks.push({ question: "", answer: message.content, report: message.report, stopped: message.stopped });
      continue;
    }
    last.answer = message.content;
    last.report = message.report;
    last.stopped = message.stopped;
  }
  return blocks;
}

class Sheet {
  private y = 92;

  constructor(
    private doc: jsPDF,
    private logo: Logo | null,
    private stem: string,
    when: Date,
    private subtitle: string,
  ) {
    this.mast(when);
  }

  notice(text: string) {
    this.paragraph(text, 10, "normal", INK, 13);
  }

  turn(turn: Turn, index: number) {
    if (turn.question) {
      this.label(String(index).padStart(2, "0"));
      this.paragraph(turn.question, 10.5, "normal", INK, 14);
      this.gap(4);
    }
    if (turn.stopped && !turn.report) {
      this.paragraph(turn.answer || "Stopped before a score was saved.", 9, "normal", MUTE, 12);
      return;
    }
    if (turn.report) {
      this.report(turn.report);
      return;
    }
    if (turn.answer) {
      this.label("Answer");
      this.paragraph(turn.answer, 9.5, "normal", INK, 12.5);
    }
  }

  split() {
    this.gap(6);
    this.ensure(8);
    this.doc.setDrawColor(...LINE);
    this.doc.setLineWidth(0.6);
    this.doc.line(LEFT, this.y, LEFT + WIDTH, this.y);
    this.y += 12;
  }

  finish() {
    const pages = this.doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      this.doc.setPage(page);
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(8);
      this.doc.setTextColor(...MUTE);
      this.doc.text("kazitrustai.fun", LEFT, PAGE_H - 22);
      const mark = `${page} / ${pages}`;
      this.doc.text(mark, LEFT + WIDTH - this.doc.getTextWidth(mark), PAGE_H - 22);
    }
  }

  private mast(when: Date) {
    this.brand(22);
    const date = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(when);
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(9);
    this.doc.setTextColor(...MUTE);
    this.doc.text(date, LEFT + WIDTH - this.doc.getTextWidth(date), 33);
    this.rule(46);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(14);
    this.doc.setTextColor(...INK);
    const title = this.doc.splitTextToSize(pdfText(this.stem), WIDTH);
    this.doc.text(title, LEFT, 66);
    this.y = 66 + title.length * 16;
    if (this.subtitle) {
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(8);
      this.doc.setTextColor(...MUTE);
      this.doc.text(pdfText(this.subtitle), LEFT, this.y);
      this.y += 14;
    }
    this.y += 6;
  }

  private brand(top: number) {
    let width = 0;
    let height = 0;
    if (this.logo) {
      height = 14;
      width = height * (this.logo.width / this.logo.height);
      if (width > 20) {
        width = 20;
        height = 20 * (this.logo.height / this.logo.width);
      }
      this.doc.addImage(this.logo.url, "PNG", LEFT, top, width, height);
    }
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(12);
    this.doc.setTextColor(...INK);
    this.doc.text("KaziTrust", LEFT + (width ? width + 6 : 0), top + 11);
  }

  private drawRunningHeader() {
    this.brand(16);
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(8);
    this.doc.setTextColor(...MUTE);
    const stem = pdfText(this.stem);
    const width = this.doc.getTextWidth(stem);
    const max = WIDTH - 120;
    const shown = width > max ? `${stem.slice(0, 42).trim()}...` : stem;
    this.doc.text(shown, LEFT + WIDTH - this.doc.getTextWidth(shown), 27);
    this.rule(36);
    this.y = 50;
  }

  private report(report: Report) {
    this.meta([
      ["Type", report.typeGuess],
      ["Score", report.riskScore === null ? "None" : String(report.riskScore)],
      ["Band", report.band ?? "Unscored"],
      ["As of", asOf(report.dataAsOf)],
    ]);
    this.account(report);
    if (report.summary) {
      this.label("The read");
      this.paragraph(report.summary, 9.5, "normal", INK, 12.5);
    }
    if (report.findings.length) {
      this.label("Findings");
      for (const finding of report.findings) this.finding(finding.severity === "clean", finding.severityWord, finding.title, finding.explanation);
    }
    for (const visual of report.visuals) this.visual(visual);
    if (report.rules.length) {
      this.label("Score");
      for (const rule of report.rules) this.pair(rule.points > 0 ? `+${rule.points}` : String(rule.points), rule.detail);
    }
    if (report.meaning) {
      this.label("Meaning");
      this.paragraph(report.meaning, 9.5, "normal", INK, 12.5);
    }
    if (report.nextStep) {
      this.label("Next");
      this.paragraph(report.nextStep, 9.5, "normal", INK, 12.5);
    }
    if (report.warnings.length) {
      this.gap(2);
      for (const warning of report.warnings) this.paragraph(warning, 8, "normal", MUTE, 11);
    }
  }

  private account(report: Report) {
    const full = pdfText(report.wallet);
    const shown = full.length >= 32 ? full : pdfText(report.displayAddress);
    if (!shown) return;
    this.ensure(16);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(8);
    this.doc.setTextColor(...MUTE);
    this.doc.text("ACCOUNT", LEFT, this.y);
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(8.5);
    this.doc.setTextColor(...INK);
    this.doc.text(shown, LEFT + 58, this.y);
    this.y += 14;
  }

  private meta(cells: [string, string][]) {
    const column = WIDTH / cells.length;
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(9);
    const wrapped = cells.map((cell) => (this.doc.splitTextToSize(pdfText(cell[1]), column - 16) as string[]).slice(0, 2));
    const lines = Math.max(...wrapped.map((item) => item.length), 1);
    const height = 24 + lines * 11;
    this.ensure(height + 8);
    this.doc.setFillColor(...SURFACE);
    this.doc.rect(LEFT, this.y, WIDTH, height, "F");
    cells.forEach((cell, index) => {
      const x = LEFT + index * column + 8;
      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(7);
      this.doc.setTextColor(...MUTE);
      this.doc.text(cell[0].toUpperCase(), x, this.y + 13);
      this.doc.setFontSize(9);
      this.doc.setTextColor(...INK);
      this.doc.text(wrapped[index], x, this.y + 26);
    });
    this.y += height + 10;
  }

  private finding(clean: boolean, severity: string, title: string, explanation: string) {
    const titleLines = this.lines(title, 9.5, WIDTH - 78);
    const body = this.lines(explanation, 8.5, WIDTH - 78);
    this.ensure(12 + titleLines.length * 12 + body.length * 11);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(8);
    this.doc.setTextColor(...(clean ? GREEN : MUTE));
    this.doc.text(pdfText(severity).toUpperCase(), LEFT, this.y);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(9.5);
    this.doc.setTextColor(...INK);
    this.doc.text(titleLines, LEFT + 78, this.y);
    this.y += titleLines.length * 12;
    if (body.length) {
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(8.5);
      this.doc.setTextColor(...MUTE);
      this.doc.text(body, LEFT + 78, this.y);
      this.y += body.length * 11;
    }
    this.y += 6;
  }

  private visual(visual: Visual) {
    if (visual.type === "holdings") {
      this.label("Holdings");
      this.table(
        ["Token", "Amount"],
        visual.rows.map((row) => [row.flag ? `${row.label} (${row.flag})` : row.label, row.amount]),
        [WIDTH * 0.68, WIDTH * 0.32],
      );
      if (visual.caption) this.paragraph(visual.caption, 8, "normal", MUTE, 11);
      return;
    }
    if (visual.type === "restrictions") {
      this.label("Restrictions");
      this.table(
        ["Check", "State"],
        visual.rows.map((row) => [row.label, row.state]),
        [WIDTH * 0.62, WIDTH * 0.38],
      );
      return;
    }
    if (visual.type === "approvals") {
      this.label("Approvals");
      if (!visual.rows.length) {
        this.paragraph(visual.caption, 8.5, "normal", MUTE, 11);
        return;
      }
      this.table(
        ["Token", "Delegate", "Amount"],
        visual.rows.map((row) => [row.mint, row.delegate, row.amount]),
        [WIDTH * 0.34, WIDTH * 0.4, WIDTH * 0.26],
      );
      return;
    }
    if (visual.type === "funding") {
      this.label("Funding");
      for (const hop of visual.hops) this.pair(hop.label, hop.detail);
      return;
    }
    if (visual.type === "programs") {
      this.label("Contracts");
      this.table(
        ["Contract", "Count"],
        visual.slices.map((slice) => [slice.label, String(slice.value)]),
        [WIDTH * 0.75, WIDTH * 0.25],
      );
      return;
    }
    if (visual.type === "rugcheck") {
      this.label("RugCheck");
      this.table(
        ["Check", "State"],
        visual.rows.map((row) => [row.label, row.state]),
        [WIDTH * 0.62, WIDTH * 0.38],
      );
      return;
    }
    if (visual.type === "compare") {
      this.label("Comparison");
      this.table(
        ["", visual.left.title, visual.right.title],
        [
          ["Score", visual.left.score === null ? "None" : String(visual.left.score), visual.right.score === null ? "None" : String(visual.right.score)],
          ["Band", visual.left.band ?? "Unscored", visual.right.band ?? "Unscored"],
          ["Note", visual.left.line, visual.right.line],
        ],
        [70, (WIDTH - 70) / 2, (WIDTH - 70) / 2],
      );
      return;
    }
    if (visual.type === "timeline") {
      this.label("Timeline");
      for (const event of visual.events) this.pair(event.time, `${event.title}. ${event.detail}`);
      return;
    }
    if (visual.type === "heatmap") {
      this.label("Timing");
      this.paragraph(`Busiest hour in this scan: ${visual.peak}.`, 9, "normal", INK, 12);
      return;
    }
    if (visual.type === "counterparties") {
      this.label("Counterparties");
      const rows = [
        ...visual.inbound.map((row) => ["In", row.label, row.amount]),
        ...visual.outbound.map((row) => ["Out", row.label, row.amount]),
      ];
      if (rows.length) this.table(["", "Name", "Amount"], rows, [46, WIDTH - 150, 104]);
      return;
    }
    if (visual.type === "batch") {
      this.label("Batch");
      this.table(
        ["Account", "Score", "Band"],
        visual.rows.map((row) => [shortAccount(row.address), row.score === null ? "None" : String(row.score), row.band]),
        [WIDTH * 0.46, WIDTH * 0.22, WIDTH * 0.32],
      );
      return;
    }
    if (visual.type === "cluster") {
      this.label("Opened accounts");
      this.paragraph(visual.nodes.map((node) => node.label).join(", "), 9, "normal", INK, 12);
    }
  }

  private table(headers: string[], rows: string[][], widths: number[]) {
    this.headerRow(headers, widths);
    for (const row of rows) this.bodyRow(row, widths);
    this.gap(4);
  }

  private headerRow(headers: string[], widths: number[]) {
    this.ensure(16);
    this.doc.setFillColor(...SURFACE);
    this.doc.rect(LEFT, this.y - 9, WIDTH, 16, "F");
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(7);
    this.doc.setTextColor(...MUTE);
    let x = LEFT;
    headers.forEach((header, index) => {
      const alignRight = index === headers.length - 1 && headers.length > 1;
      const text = pdfText(header).toUpperCase();
      const left = alignRight ? x + widths[index] - this.doc.getTextWidth(text) - 6 : x + 6;
      this.doc.text(text, left, this.y);
      x += widths[index];
    });
    this.y += 12;
  }

  private bodyRow(cells: string[], widths: number[]) {
    const wrapped = cells.map((cell, index) => this.lines(cell, 8.5, widths[index] - 12));
    const lines = Math.max(...wrapped.map((item) => item.length), 1);
    const height = lines * 11 + 5;
    this.ensure(height);
    let x = LEFT;
    wrapped.forEach((text, index) => {
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(8.5);
      this.doc.setTextColor(...INK);
      const alignRight = index === cells.length - 1 && cells.length > 1 && text.length === 1;
      const left = alignRight ? x + widths[index] - this.doc.getTextWidth(text[0] ?? "") - 6 : x + 6;
      this.doc.text(text, left, this.y);
      x += widths[index];
    });
    this.y += lines * 11;
    this.doc.setDrawColor(...LINE);
    this.doc.setLineWidth(0.4);
    this.doc.line(LEFT, this.y - 3, LEFT + WIDTH, this.y - 3);
    this.y += 5;
  }

  private pair(left: string, right: string) {
    const rightLines = this.lines(right, 8.5, WIDTH - 150);
    this.ensure(rightLines.length * 11 + 4);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(8.5);
    this.doc.setTextColor(...INK);
    const name = this.lines(left, 8.5, 140)[0] ?? "";
    this.doc.text(name, LEFT, this.y);
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(...MUTE);
    this.doc.text(rightLines, LEFT + 150, this.y);
    this.y += rightLines.length * 11 + 3;
  }

  private label(text: string) {
    this.ensure(18);
    this.gap(2);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(7.5);
    this.doc.setTextColor(...MUTE);
    this.doc.text(pdfText(text).toUpperCase(), LEFT, this.y);
    this.y += 12;
  }

  private paragraph(text: string, size: number, style: "normal" | "bold", color: [number, number, number], leading: number) {
    const lines = this.lines(text, size, WIDTH);
    for (const line of lines) {
      this.ensure(leading);
      this.doc.setFont("helvetica", style);
      this.doc.setFontSize(size);
      this.doc.setTextColor(...color);
      this.doc.text(line, LEFT, this.y);
      this.y += leading;
    }
  }

  private lines(text: string, size: number, width: number): string[] {
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(size);
    const clean = pdfText(text);
    if (!clean) return [];
    return this.doc.splitTextToSize(clean, Math.max(20, width)) as string[];
  }

  private rule(y: number) {
    this.doc.setDrawColor(...LINE);
    this.doc.setLineWidth(0.6);
    this.doc.line(LEFT, y, LEFT + WIDTH, y);
  }

  private gap(amount: number) {
    this.y += amount;
  }

  private ensure(height: number) {
    if (this.y + height <= PAGE_H - BOTTOM) return;
    this.doc.addPage();
    this.drawRunningHeader();
  }
}

function asOf(value: string): string {
  const read = value.split(/read/i).pop()?.trim() || value;
  return read.split(",")[0]?.trim() || "This read";
}

function shortAccount(value: string): string {
  const clean = pdfText(value);
  if (clean.length <= 12) return clean;
  return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
}

type Logo = { url: string; width: number; height: number };

async function inkLogo(): Promise<Logo | null> {
  try {
    const response = await fetch("/mark.png");
    if (!response.ok) return null;
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#0b0c0e";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = "destination-in";
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (pixels[(y * canvas.width + x) * 4 + 3] < 20) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < minX || maxY < minY) return null;
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const crop = document.createElement("canvas");
    crop.width = width;
    crop.height = height;
    crop.getContext("2d")?.drawImage(canvas, minX, minY, width, height, 0, 0, width, height);
    return { url: crop.toDataURL("image/png"), width, height };
  } catch {
    return null;
  }
}
