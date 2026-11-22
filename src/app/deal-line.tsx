import { dealFigures, kr, type DealFigures } from "./reader";
import type { SessionState } from "@/orchestrator/state";
import type { Lang } from "./ui-text";

type Labels = { title: string; empty: string; walkAway: string; target: string; firstOffer: string; market: string; current: string; offer: string; landing: string };
interface Mark { key: string; value: number; label: string; kind: "walk" | "target" | "first" | "ref" }

/** Places the markers on a 0..100 scale with a little room at both ends; labels that would touch go to another row. */
export function layout(f: DealFigures, l: Labels, gap = 17): { marks: (Mark & { x: number; row: number })[]; band?: { x1: number; x2: number; mid?: number }; empty: boolean } {
  const marks: Mark[] = [];
  if (f.walkAway) marks.push({ key: "walk", value: f.walkAway, label: l.walkAway, kind: "walk" });
  if (f.target) marks.push({ key: "target", value: f.target, label: l.target, kind: "target" });
  if (f.firstOffer && f.firstOffer !== f.target) marks.push({ key: "first", value: f.firstOffer, label: l.firstOffer, kind: "first" });
  if (f.offer) marks.push({ key: "offer", value: f.offer, label: l.offer, kind: "ref" });
  else if (f.current) marks.push({ key: "current", value: f.current, label: l.current, kind: "ref" });
  const vals = [...marks.map((m) => m.value), f.low, f.high].filter((v): v is number => typeof v === "number");
  if (!marks.length) return { marks: [], empty: true };
  let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 1) { lo -= 2000; hi += 2000; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const rows: number[][] = [[], [], []];
  const placed = [...marks].sort((a, b) => a.value - b.value).map((m) => {
    const px = x(m.value); let row = rows.findIndex((r) => r.every((o) => Math.abs(o - px) > gap)); if (row < 0) row = rows.length - 1;
    rows[row]!.push(px); return { ...m, x: px, row };
  });
  return { marks: placed, band: f.low !== undefined && f.high !== undefined ? { x1: x(f.low), x2: x(f.high), mid: f.mid !== undefined ? x(f.mid) : undefined } : undefined, empty: false };
}

export function DealLine({ state, lang, labels, compact = false }: { state: SessionState | null; lang: Lang; labels: Labels; compact?: boolean }) {
  const f = dealFigures(state); const { marks, band, empty } = layout(f, labels, compact ? 34 : 17); // labels need more room on the narrow rail
  return (
    <section className={`deal${compact ? " deal-compact" : ""}`} aria-label={labels.title}>
      <h2 className="deal-title">{labels.title}</h2>
      {empty ? <p className="deal-empty">{labels.empty}</p> : (
        <>
          <div className="deal-track" style={{ ["--rows" as string]: compact ? 0 : Math.max(1, ...marks.map((m) => m.row + 1)) }}>
            {band && <div className="deal-band" style={{ left: `${band.x1}%`, width: `${Math.max(1, band.x2 - band.x1)}%` }} title={`${labels.market}: ${kr(f.low!, lang)} – ${kr(f.high!, lang)}`} />}
            <div className="deal-rule" />
            {f.walkAway && f.firstOffer && f.firstOffer > f.walkAway && (() => { const w = marks.find((m) => m.key === "walk"), o = marks.find((m) => m.key === "first"); return w && o ? <div className="deal-zone" style={{ left: `${w.x}%`, width: `${o.x - w.x}%` }} /> : null; })()}
            {marks.map((m) => (
              <div key={m.key} className={`deal-mark deal-${m.kind}`} style={{ left: `${m.x}%`, ["--row" as string]: m.row }}>
                <span className="deal-dot" aria-hidden="true" />
                {!compact && <span className="deal-label"><span className="deal-name">{m.label}</span><span className="deal-value">{kr(m.value, lang)}</span></span>}
              </div>
            ))}
          </div>
          {compact && (
            <dl className="deal-legend">
              {[...marks].reverse().map((m) => <div key={m.key} className={`deal-${m.kind}`}><dt><span className="deal-dot" aria-hidden="true" />{m.label}</dt><dd>{kr(m.value, lang)}</dd></div>)}
            </dl>
          )}
          {band && <p className="deal-market"><span className="deal-swatch" aria-hidden="true" />{labels.market}: {kr(f.low!, lang)} – {kr(f.high!, lang)}</p>}
          {f.walkAway && f.firstOffer && f.firstOffer > f.walkAway && !compact && <p className="deal-note">{labels.landing}</p>}
        </>
      )}
    </section>
  );
}
