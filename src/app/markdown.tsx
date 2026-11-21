import type { ReactNode } from "react";

/** Inline markup: **bold**, *italic*, `code`. Anything left over (a stray ** or *) is removed so the user never sees markup symbols. */
export function inline(text: string, key = ""): ReactNode[] {
  const out: ReactNode[] = []; let i = 0; let n = 0;
  const re = /\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|(?<![*\w])\*([^*\s][^*\n]*?)\*(?![*\w])|`([^`\n]+)`/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > i) out.push(clean(text.slice(i, m.index)));
    const k = `${key}${n++}`;
    if (m[1] !== undefined || m[2] !== undefined) out.push(<strong key={k}>{inline(m[1] ?? m[2] ?? "", k + "b")}</strong>);
    else if (m[3] !== undefined) out.push(<em key={k}>{inline(m[3], k + "i")}</em>);
    else out.push(<code key={k}>{m[4]}</code>);
    i = m.index + m[0].length;
  }
  if (i < text.length) out.push(clean(text.slice(i)));
  return out;
}
const clean = (s: string) => s.replace(/\*\*/g, "").replace(/(^|\s)\*(?=\S)/g, "$1");

type Block = { t: "p"; lines: string[] } | { t: "ul"; lines: string[] } | { t: "ol"; lines: string[] } | { t: "table"; rows: string[][] };
const BULLET = /^\s*(?:[-*•])\s+(.*)$/; const NUM = /^\s*\d+[.)]\s+(.*)$/; const ROW = /^\s*\|.*\|\s*$/; const SEP = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;
const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function blocks(src: string): Block[] {
  const out: Block[] = []; const lines = src.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.trim()) continue;
    if (ROW.test(l)) {
      const rows: string[][] = [];
      for (; i < lines.length && ROW.test(lines[i]!); i++) if (!SEP.test(lines[i]!)) rows.push(cells(lines[i]!));
      i--; out.push({ t: "table", rows }); continue;
    }
    const kind = BULLET.test(l) ? "ul" : NUM.test(l) ? "ol" : "p";
    const last = out[out.length - 1];
    if (kind !== "p" && last && last.t === kind && !(lines[i - 1] ?? "").match(/^\s*$/)) { last.lines.push(l.replace(kind === "ul" ? BULLET : NUM, "$1")); continue; }
    if (kind !== "p") { out.push({ t: kind, lines: [l.replace(kind === "ul" ? BULLET : NUM, "$1")] }); continue; }
    const heading = l.replace(/^\s*#{1,6}\s+/, "");
    const text = heading !== l ? `**${heading.replace(/\*\*/g, "")}**` : l;
    if (last && last.t === "p" && !(lines[i - 1] ?? "").match(/^\s*$/) && heading === l) last.lines.push(text); else out.push({ t: "p", lines: [text] });
  }
  return out;
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {blocks(text).map((b, i) =>
        b.t === "p" ? <p key={i}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l, `${i}-${j}-`)}</span>)}</p>
        : b.t === "ul" ? <ul key={i}>{b.lines.map((l, j) => <li key={j}>{inline(l.replace(/^\[ \]\s*/, "☐ ").replace(/^\[[xX]\]\s*/, "☑ "), `${i}-${j}-`)}</li>)}</ul>
        : b.t === "ol" ? <ol key={i}>{b.lines.map((l, j) => <li key={j}>{inline(l, `${i}-${j}-`)}</li>)}</ol>
        : <div className="tablewrap" key={i}><table><tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => (j === 0 ? <th key={k}>{inline(c, `${i}-${j}-${k}-`)}</th> : <td key={k}>{inline(c, `${i}-${j}-${k}-`)}</td>))}</tr>)}</tbody></table></div>)}
    </div>
  );
}
