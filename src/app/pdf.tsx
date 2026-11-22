// The PDF the user saves: the brief (or the preparation so far), the deal line, and the session text to continue later.
// Built in the browser; nothing is sent anywhere. The library is loaded only when the user taps Save.
import { blocks, type Block } from "./markdown";
import { cleanForReader, dealFigures, kr, ASSUMED } from "./reader";
import { toSummary } from "@/orchestrator/summary";
import type { SessionState } from "@/orchestrator/state";
import { T, type Lang } from "./ui-text";

const C = { ink: "#14213D", fjord: "#1E4E8C", mist: "#E6EDF7", saffron: "#E9A21F", line: "#D9E0EA", muted: "#5B6B82" };

/** Splits **bold** and the assumption marker into runs for the PDF text engine. */
function runs(text: string, assumed: string): { t: string; b?: boolean; tag?: boolean }[] {
  const out: { t: string; b?: boolean; tag?: boolean }[] = []; const re = /\*\*([^*\n]+?)\*\*|⁠\{assumed\}⁠/g; let i = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > i) out.push({ t: text.slice(i, m.index) });
    out.push(m[0] === ASSUMED ? { t: ` (${assumed})`, tag: true } : { t: m[1]!, b: true }); i = m.index + m[0].length;
  }
  if (i < text.length) out.push({ t: text.slice(i) });
  return out.map((r) => ({ ...r, t: r.t.replace(/\*\*/g, "").replace(/(^|\s)\*(?=\S)/g, "$1").replace(/\*(\s|$)/g, "$1") }));
}

export async function makePdf(opts: { lang: Lang; state: SessionState; brief?: string }): Promise<Blob> {
  const R = await import("@react-pdf/renderer");
  const { Document, Page, Text, View, StyleSheet, Svg, Rect, Line, Circle, pdf } = R;
  const t = T[opts.lang]; const assumed = t.assumed;
  const s = StyleSheet.create({
    page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 52, fontFamily: "Times-Roman", fontSize: 10.5, lineHeight: 1.45, color: C.ink },
    brand: { fontFamily: "Helvetica-Bold", fontSize: 9, color: C.fjord, marginBottom: 6 },
    title: { fontFamily: "Helvetica-Bold", fontSize: 21, lineHeight: 1.2, marginBottom: 6 },
    date: { fontFamily: "Helvetica", fontSize: 9, lineHeight: 1.3, color: C.muted, marginBottom: 18 },
    h2: { fontFamily: "Helvetica-Bold", fontSize: 12.5, color: C.fjord, marginTop: 14, marginBottom: 5, paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: C.line },
    h3: { fontFamily: "Helvetica-Bold", fontSize: 11, marginTop: 10, marginBottom: 3 },
    p: { marginBottom: 5 },
    basis: { fontFamily: "Helvetica-Oblique", fontSize: 8.5, color: C.muted, marginTop: 6 },
    li: { flexDirection: "row", marginBottom: 2.5 }, bullet: { width: 12, color: C.saffron, fontFamily: "Helvetica-Bold" }, liText: { flex: 1 },
    box: { width: 8, height: 8, borderWidth: 1, borderColor: C.fjord, borderRadius: 1.5, marginTop: 3, marginRight: 6 }, boxDone: { backgroundColor: C.fjord },
    table: { marginVertical: 6, borderTopWidth: 1, borderTopColor: C.line },
    tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.line }, th: { fontFamily: "Helvetica-Bold", fontSize: 9, backgroundColor: C.mist },
    td: { flex: 1, paddingVertical: 4, paddingHorizontal: 5, fontSize: 9.5 },
    dealBox: { marginBottom: 8, padding: 12, backgroundColor: "#F5F7FA", borderRadius: 4 },
    dealTitle: { fontFamily: "Helvetica-Bold", fontSize: 10, marginBottom: 8 },
    dealRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 6 }, dealItem: { width: "33%", marginBottom: 4 },
    dealName: { fontFamily: "Helvetica", fontSize: 8, color: C.muted }, dealValue: { fontFamily: "Helvetica-Bold", fontSize: 11 },
    resume: { marginTop: 18, padding: 10, borderWidth: 1, borderColor: C.line, borderRadius: 4 },
    mono: { fontFamily: "Courier", fontSize: 7.5, lineHeight: 1.3, color: C.muted },
    foot: { position: "absolute", bottom: 26, left: 52, right: 52, fontFamily: "Helvetica", fontSize: 8, color: C.muted, flexDirection: "row", justifyContent: "space-between" },
  });
  const Rich = ({ text, style }: { text: string; style?: any }) => (
    <Text style={style}>{runs(text, assumed).map((r, i) => <Text key={i} style={r.b ? { fontFamily: "Times-Bold" } : r.tag ? { fontFamily: "Helvetica-Oblique", fontSize: 8, color: C.muted } : undefined}>{r.t}</Text>)}</Text>
  );
  const render = (b: Block, i: number) =>
    b.t === "h" ? <Text key={i} style={b.level <= 2 ? s.h2 : s.h3} minPresenceAhead={40}>{b.text}</Text>
    : b.t === "basis" ? <Rich key={i} text={b.text} style={s.basis} />
    : b.t === "p" ? <Rich key={i} text={b.lines.join(" ")} style={s.p} />
    : b.t === "ul" || b.t === "ol" ? <View key={i} style={{ marginBottom: 5 }}>{b.lines.map((l, j) => { const open = /^\[ \]\s*/.test(l), done = /^\[[xX]\]\s*/.test(l); return <View key={j} style={s.li} wrap={false}>{open || done ? <View style={done ? [s.box, s.boxDone] : s.box} /> : <Text style={s.bullet}>{b.t === "ol" ? `${j + 1}.` : "•"}</Text>}<Rich text={l.replace(/^\[[ xX]\]\s*/, "")} style={s.liText} /></View>; })}</View>
    : <View key={i} style={s.table}>{b.rows.map((r, j) => <View key={j} style={s.tr} wrap={false}>{r.map((c, k) => <Rich key={k} text={c} style={j === 0 || k === 0 ? [s.td, s.th] : s.td} />)}</View>)}</View>;

  const f = dealFigures(opts.state);
  const marks = [[t.deal.walkAway, f.walkAway], [t.deal.target, f.target], [t.deal.firstOffer, f.firstOffer], [t.deal.market, f.low !== undefined && f.high !== undefined ? `${kr(f.low, opts.lang)} – ${kr(f.high, opts.lang)}` : undefined]] as [string, number | string | undefined][];
  const known = marks.filter(([, v]) => v !== undefined);
  const nums = [f.walkAway, f.target, f.firstOffer, f.low, f.high].filter((v): v is number => typeof v === "number");
  const lo = nums.length ? Math.min(...nums) * 0.95 : 0, hi = nums.length ? Math.max(...nums) * 1.05 : 1; const X = (v: number) => 10 + ((v - lo) / Math.max(1, hi - lo)) * 440; // inside a 460 pt wide drawing
  const body = blocks(cleanForReader(opts.brief ?? "", opts.lang)).filter((b, i) => !(i === 0 && b.t === "h" && b.level === 1));
  const title = opts.brief ? (opts.brief.match(/^#\s+(.+)$/m)?.[1]?.replace(/\*\*/g, "") ?? t.pdf.title) : t.pdf.summaryTitle;
  const date = new Date().toLocaleDateString(opts.lang === "sv" ? "sv-SE" : "en-GB", { year: "numeric", month: "long", day: "numeric" });

  const doc = (
    <Document title={title} author="Negotiator" language={opts.lang}>
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>Negotiator</Text>
        <Text style={s.title}>{title}</Text>
        <Text style={s.date}>{date}</Text>
        {known.length > 0 && (
          <View style={s.dealBox} wrap={false}>
            <Text style={s.dealTitle}>{t.deal.title}</Text>
            {nums.length >= 2 && (
              <Svg width={460} height={34}>
                {f.low !== undefined && f.high !== undefined && <Rect x={X(f.low)} y={11} width={Math.max(2, X(f.high) - X(f.low))} height={12} fill={C.fjord} fillOpacity={0.16} />}
                <Line x1={4} y1={17} x2={456} y2={17} stroke={C.ink} strokeWidth={1} />
                {f.walkAway !== undefined && <Circle cx={X(f.walkAway)} cy={17} r={5} fill={C.ink} />}
                {f.target !== undefined && <Circle cx={X(f.target)} cy={17} r={5} fill={C.fjord} />}
                {f.firstOffer !== undefined && <Circle cx={X(f.firstOffer)} cy={17} r={6} fill={C.saffron} />}
              </Svg>
            )}
            <View style={s.dealRow}>{known.map(([name, v]) => <View key={name} style={s.dealItem}><Text style={s.dealName}>{name}</Text><Text style={s.dealValue}>{typeof v === "number" ? kr(v, opts.lang) : v}</Text></View>)}</View>
          </View>
        )}
        {body.map(render)}
        <View style={s.resume} wrap={false}>
          <Text style={[s.dealName, { marginBottom: 4 }]}>{t.pdf.resume}</Text>
          <Text style={s.mono}>{toSummary(opts.state)}</Text>
        </View>
        <View style={s.foot} fixed><Text>{t.pdf.made}. {t.disclaimer}</Text><Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} /></View>
      </Page>
    </Document>
  );
  return pdf(doc).toBlob();
}
