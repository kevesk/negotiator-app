import type { ReactNode } from "react";
import { ASSUMED, dropEmptyColumns } from "./reader";

/** Inline markup: **bold**, *italic*, `code`, and the assumption label. Stray markup symbols are removed so the user never sees them. */
export function inline(text: string, key = "", assumedLabel = "assumption"): ReactNode[] {
  const out: ReactNode[] = []; let i = 0; let n = 0;
  const re = /\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|(?<![*\w])\*([^*\s][^*\n]*?)\*(?![*\w])|`([^`\n]+)`|⁠\{assumed\}⁠/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > i) out.push(clean(text.slice(i, m.index)));
    const k = `${key}${n++}`;
    if (m[0] === ASSUMED) out.push(<span key={k} className="badge" title={assumedLabel}>{assumedLabel}</span>);
    else if (m[1] !== undefined || m[2] !== undefined) out.push(<strong key={k}>{inline(m[1] ?? m[2] ?? "", k + "b", assumedLabel)}</strong>);
    else if (m[3] !== undefined) out.push(<em key={k}>{inline(m[3], k + "i", assumedLabel)}</em>);
    else out.push(<code key={k}>{m[4]}</code>);
    i = m.index + m[0].length;
  }
  if (i < text.length) out.push(clean(text.slice(i)));
  return out;
}
const clean = (s: string) => s.replace(/\*\*/g, "").replace(/(^|\s)\*(?=\S)/g, "$1");

export type Block =
  | { t: "h"; level: 1 | 2 | 3; text: string }
  | { t: "p"; lines: string[] }
  | { t: "basis"; text: string }
  | { t: "ul"; lines: string[] }
  | { t: "ol"; lines: string[] }
  | { t: "table"; rows: string[][] };
const BULLET = /^\s*(?:[-*•])\s+(.*)$/; const NUM = /^\s*\d+[.)]\s+(.*)$/; const ROW = /^\s*\|.*\|\s*$/; const SEP = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;
const HEAD = /^\s*(#{1,6})\s+(.*)$/; const BASIS = /^\s*\*?\s*(Based on|Baseras på)\s*:/i;
const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/** Splits light markdown into blocks. Used by the chat, the brief view and the PDF. */
export function blocks(src: string): Block[] {
  const out: Block[] = []; const lines = src.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.trim() || /^\s*(-{3,}|\*{3,})\s*$/.test(l)) continue;
    if (ROW.test(l)) {
      const rows: string[][] = [];
      for (; i < lines.length && ROW.test(lines[i]!); i++) if (!SEP.test(lines[i]!)) rows.push(cells(lines[i]!));
      i--; out.push({ t: "table", rows: dropEmptyColumns(rows) }); continue;
    }
    const h = l.match(HEAD);
    if (h) { out.push({ t: "h", level: Math.min(3, h[1]!.length) as 1 | 2 | 3, text: h[2]!.replace(/\*\*/g, "").trim() }); continue; }
    if (BASIS.test(l)) { out.push({ t: "basis", text: l.replace(/^\s*\*|\*\s*$/g, "").trim() }); continue; }
    const kind = BULLET.test(l) ? "ul" : NUM.test(l) ? "ol" : "p";
    const last = out[out.length - 1];
    if (kind !== "p") {
      const item = l.replace(kind === "ul" ? BULLET : NUM, "$1");
      if (last && last.t === kind) last.lines.push(item); else out.push({ t: kind, lines: [item] });
      continue;
    }
    if (last && last.t === "p" && (lines[i - 1] ?? "").trim() !== "") last.lines.push(l); else out.push({ t: "p", lines: [l] });
  }
  return out;
}

const box = (l: string) => (/^\[ \]\s*/.test(l) ? { box: "open", text: l.replace(/^\[ \]\s*/, "") } : /^\[[xX]\]\s*/.test(l) ? { box: "done", text: l.replace(/^\[[xX]\]\s*/, "") } : { box: "", text: l });

/** Groups blocks into sections that start at each "##" heading, so a heading never ends up apart from its content. */
export function sectionsOf(bs: Block[]): Block[][] {
  const out: Block[][] = [[]];
  for (const b of bs) { if (b.t === "h" && b.level === 2 && out[out.length - 1]!.length) out.push([]); out[out.length - 1]!.push(b); }
  return out.filter((s) => s.length);
}

export function Markdown({ text, assumedLabel, className = "md", sections = false }: { text: string; assumedLabel?: string; className?: string; sections?: boolean }) {
  const a = assumedLabel ?? "assumption";
  const all = blocks(text);
  if (sections) return (
    <div className={className}>
      {sectionsOf(all).map((sec, k) => (
        <section key={k} className="sec" data-wide={sec.some((b) => b.t === "table") || (sec[0]?.t === "h" && sec[0].level === 1) ? "" : undefined}>
          {sec.map((b, i) => renderBlock(b, `${k}-${i}`, a))}
        </section>
      ))}
    </div>
  );
  return <div className={className}>{all.map((b, i) => renderBlock(b, String(i), a))}</div>;
}

function renderBlock(b: Block, i: string, a: string): ReactNode {
  return (
        b.t === "h" ? (b.level === 1 ? <h2 key={i}>{inline(b.text, `${i}-`, a)}</h2> : b.level === 2 ? <h3 key={i}>{inline(b.text, `${i}-`, a)}</h3> : <h4 key={i}>{inline(b.text, `${i}-`, a)}</h4>)
        : b.t === "basis" ? <p key={i} className="basis">{inline(b.text, `${i}-`, a)}</p>
        : b.t === "p" ? <p key={i}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l, `${i}-${j}-`, a)}</span>)}</p>
        : b.t === "ul" ? <ul key={i} className={b.lines.some((l) => box(l).box) ? "checks" : undefined}>{b.lines.map((l, j) => { const x = box(l); return <li key={j} data-box={x.box || undefined}>{inline(x.text, `${i}-${j}-`, a)}</li>; })}</ul>
        : b.t === "ol" ? <ol key={i}>{b.lines.map((l, j) => <li key={j}>{inline(l, `${i}-${j}-`, a)}</li>)}</ol>
        : <div className="tablewrap" key={i}><table><thead><tr>{b.rows[0]!.map((c, k) => <th key={k} scope="col">{inline(c, `${i}-h-${k}-`, a)}</th>)}</tr></thead><tbody>{b.rows.slice(1).map((r, j) => <tr key={j}>{r.map((c, k) => (k === 0 ? <th key={k} scope="row">{inline(c, `${i}-${j}-${k}-`, a)}</th> : <td key={k}>{inline(c, `${i}-${j}-${k}-`, a)}</td>))}</tr>)}</tbody></table></div>
  );
}
