// The plan the user saves: plain language, built directly from the session (no model call, no JSON).
// Target, first offer, walk-away, market, packages, a three-step concession plan, arguments, what to say and tough questions.
import { slotValue, type SessionState } from "@/orchestrator/state";
import { SKIPPED } from "@/orchestrator/controller";
// The shapes the server puts in the session (package engine and concession plan); kept local so no engine code reaches the browser.
interface MesoResult { issues: { id: string; label: string; weight: number }[]; packages: { id: string; employerCost: string; shows: string; items: { issue: string; label: string; text: string }[] }[]; trades?: string[] }
interface ConcessionPlan { landing: number; steps: { amount: number }[] }
import type { Lang } from "./ui-text";

const val = <T = unknown>(s: SessionState, id: string): T | undefined => { const v = slotValue<T>(s, id); return v === (SKIPPED as unknown) ? undefined : v; };
const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "object" && x && typeof (x as { monthly?: unknown }).monthly === "number" ? (x as { monthly: number }).monthly : undefined);
const str = (x: unknown): string => (typeof x === "string" ? x.trim() : Array.isArray(x) ? x.map(str).filter(Boolean).join("; ") : x && typeof x === "object" ? Object.values(x as Record<string, unknown>).map(str).filter(Boolean).join(", ") : x === undefined || x === null ? "" : String(x));
const kr = (n: number, lang: Lang) => `${Math.round(n).toLocaleString(lang === "sv" ? "sv-SE" : "en-GB").replace(/[, ]/g, " ")} kr`;
const pct = (a: number, b: number) => Math.round(((a - b) / b) * 1000) / 10;
const cell = (t: string) => t.replace(/\|/g, "/").replace(/\n/g, " ");

const L = {
  en: {
    numbers: "Your numbers", what: "What it means", amount: "Amount",
    first: "First offer", firstMeans: "What you say first. Above your target, so you have room to give.",
    target: "Target", targetMeans: "Where you want to land.",
    walk: "Walk-away", walkMeans: "The lowest you accept. Below this you choose your alternative instead.",
    current: "Current salary", offer: "Their offer", market: "Market pay", marketMeans: (src: string) => `Middle half of pay for the role${src ? ` (${src})` : ""}.`, median: "middle",
    batna: "Your alternative if there is no deal", missing: "not set yet",
    firstHead: "Your first offer", firstLine: (f: string, t: string) => `Open with **${f}** a month. Say the figure, give your main reason, and then stay quiet: let them answer first. Your target is ${t}, so the first offer leaves room to make concessions and still land well.`,
    firstVs: (d: number, ref: string) => `That is ${d > 0 ? "+" : ""}${d} % compared with ${ref}.`, vsCurrent: "your current salary", vsOffer: "their offer",
    noFirst: "Your first offer is not set yet. Choose one above your target before the meeting.",
    planHead: "Concession plan in three steps", planIntro: "Give ground slowly, in smaller and smaller steps, and only in exchange for something. Never go below your walk-away.",
    step: (i: number, to: string, by: string, trade: string) => `If they say no: come down to **${to}** (–${by}), but only if you get ${trade} in return.`,
    stepLast: (to: string, by: string, trade: string) => `Last step: **${to}** (–${by}), your target, together with ${trade}.`,
    below: (w: string) => `Below ${w} (your walk-away): thank them, say you need to think, and fall back on your alternative.`,
    noPlan: "The plan needs a first offer above your target and a walk-away. Set them and the steps follow.",
    trades: ["a salary review in 6 months with agreed criteria, in writing", "20 000 kr a year for training", "one more day a week working from home"],
    pkgHead: "Your packages (choose-one offers)", pkgIntro: "Use them when they say no to your first offer, or want to settle one thing at a time. Offer them together and ask which one works best for them. They are worth about the same to you, but very different for them, so their choice shows what they value most.",
    pkgCost: "What it costs them", pkgShows: "If they choose it", pkg: "Package", item: "Item",
    cost: { budget: "Most cash now", low: "Least cash now", later: "In between" } as Record<string, string>,
    pkgNotYet: "Not built yet: give 100 points across the items that matter to you, and the packages follow.",
    argHead: "Why you deserve it", argExp: (y: number) => `${y} years of experience in the role.`, argScope: (x: string) => `Bigger role than before: ${x}.`, argLast: (x: string) => `Last raise: ${x}.`,
    argMarket: (cur: string, med: string, hi: string) => `Market: the middle pay for the role is ${med} and the upper quarter starts at ${hi}; you are at ${cur} today.`,
    argNone: "No results written down yet. Before the meeting, list two or three results with numbers (for example customer satisfaction, cases handled, sales).",
    sayHead: "What to say", saySilence: "After the figure: stop talking. Silence works for you.",
    open: "Opening", ask: "Your ask", ifNo: "If they say the budget is tight", trade: "Trading", close: "Closing",
    openLine: "Thank you for taking the time. I'd like to go through what I have contributed this past year and what I think is a fair salary going forward.",
    askLine: (f: string, ex?: string) => `Based on my results and the market pay for the role, I'm asking for a monthly salary of ${f}.${ex ? ` My strongest example: ${ex}.` : ""}`,
    ifNoLine: "I understand. What would it take to get there? If the salary can't reach that now, what can we agree on instead?",
    tradeLine: (to: string, t: string) => `If we can agree on ${t}, I can come down to ${to}.`,
    closeLine: "Can we summarise what we have agreed, and confirm it in writing?",
    toughHead: "Tough questions", ifThey: "If they…", you: "You…",
    tough: [["want to settle one thing at a time", "say you'd rather look at the whole package, and offer two or three packages"], ["say something is not negotiable", "ask why, and what could be traded for it instead"], ["say they cannot justify it now", "propose a dated review, a performance bonus, or a trade on another item"], ["ask what you earn or expect", "talk about the value of the role and your ask, not your current pay"]],
    checkHead: "Before the meeting", checks: ["Bring your results in writing, with numbers", "Know your walk-away and your alternative by heart", "Say your first offer out loud three times", "Ask for the agreement in writing"],
    more: "The coach's full notes",
    continue: "To continue later, use “Copy session text” in the app before you close it.",
  },
  sv: {
    numbers: "Dina siffror", what: "Vad det betyder", amount: "Belopp",
    first: "Första bud", firstMeans: "Det du säger först. Över ditt mål, så att du har utrymme att ge.",
    target: "Mål", targetMeans: "Där du vill landa.",
    walk: "Lägsta nivå", walkMeans: "Det lägsta du accepterar. Under detta väljer du ditt alternativ i stället.",
    current: "Nuvarande lön", offer: "Deras erbjudande", market: "Marknadslön", marketMeans: (src: string) => `Mittenhälften av lönerna för rollen${src ? ` (${src})` : ""}.`, median: "mitten",
    batna: "Ditt alternativ om ni inte blir överens", missing: "inte satt ännu",
    firstHead: "Ditt första bud", firstLine: (f: string, t: string) => `Öppna med **${f}** i månaden. Säg siffran, ge ditt viktigaste skäl och var sedan tyst: låt dem svara först. Ditt mål är ${t}, så det första budet ger utrymme att ge efter och ändå landa bra.`,
    firstVs: (d: number, ref: string) => `Det är ${d > 0 ? "+" : ""}${String(d).replace(".", ",")} % jämfört med ${ref}.`, vsCurrent: "din nuvarande lön", vsOffer: "deras erbjudande",
    noFirst: "Ditt första bud är inte satt ännu. Välj ett över ditt mål före mötet.",
    planHead: "Medgivandeplan i tre steg", planIntro: "Ge efter långsamt, i allt mindre steg, och bara mot att du får något tillbaka. Gå aldrig under din lägsta nivå.",
    step: (i: number, to: string, by: string, trade: string) => `Om de säger nej: gå ner till **${to}** (–${by}), men bara om du får ${trade} i gengäld.`,
    stepLast: (to: string, by: string, trade: string) => `Sista steget: **${to}** (–${by}), ditt mål, tillsammans med ${trade}.`,
    below: (w: string) => `Under ${w} (din lägsta nivå): tacka, säg att du behöver tänka och luta dig mot ditt alternativ.`,
    noPlan: "Planen behöver ett första bud över ditt mål och en lägsta nivå. Sätt dem så följer stegen.",
    trades: ["en lönerevision om 6 månader med överenskomna kriterier, skriftligt", "20 000 kr om året till utbildning", "en dag till i veckan hemifrån"],
    pkgHead: "Dina paket (välj ett)", pkgIntro: "Använd dem när de säger nej till ditt första bud eller vill ta en sak i taget. Lägg fram dem samtidigt och fråga vilket som passar dem bäst. De är värda ungefär lika mycket för dig men mycket olika för dem, så deras val visar vad de värderar mest.",
    pkgCost: "Vad det kostar dem", pkgShows: "Om de väljer det", pkg: "Paket", item: "Del",
    cost: { budget: "Mest pengar nu", low: "Minst pengar nu", later: "Mittemellan" } as Record<string, string>,
    pkgNotYet: "Inte klara ännu: fördela 100 poäng på det som är viktigt för dig, så byggs paketen.",
    argHead: "Varför du förtjänar det", argExp: (y: number) => `${y} års erfarenhet i rollen.`, argScope: (x: string) => `Större roll än tidigare: ${x}.`, argLast: (x: string) => `Senaste höjning: ${x}.`,
    argMarket: (cur: string, med: string, hi: string) => `Marknaden: mittenlönen för rollen är ${med} och den övre fjärdedelen börjar på ${hi}; du ligger på ${cur} i dag.`,
    argNone: "Inga resultat nedskrivna ännu. Skriv före mötet ner två eller tre resultat med siffror (till exempel kundnöjdhet, antal ärenden, försäljning).",
    sayHead: "Vad du säger", saySilence: "Efter siffran: sluta prata. Tystnaden arbetar för dig.",
    open: "Öppning", ask: "Ditt bud", ifNo: "Om de säger att budgeten är snäv", trade: "Byte", close: "Avslut",
    openLine: "Tack för att du tar dig tid. Jag vill gå igenom vad jag har bidragit med det senaste året och vad jag tycker är en rimlig lön framåt.",
    askLine: (f: string, ex?: string) => `Utifrån mina resultat och marknadslönen för rollen föreslår jag en månadslön på ${f}.${ex ? ` Mitt starkaste exempel: ${ex}.` : ""}`,
    ifNoLine: "Jag förstår. Vad skulle krävas för att komma dit? Om lönen inte kan nå dit nu, vad kan vi komma överens om i stället?",
    tradeLine: (to: string, t: string) => `Om vi kan komma överens om ${t} kan jag gå ner till ${to}.`,
    closeLine: "Kan vi sammanfatta vad vi har kommit överens om och bekräfta det skriftligt?",
    toughHead: "Svåra frågor", ifThey: "Om de…", you: "Gör du så här…",
    tough: [["vill ta en sak i taget", "säg att du hellre ser på helheten och lägg fram två eller tre paket"], ["säger att något inte är förhandlingsbart", "fråga varför och vad som kan bytas mot det i stället"], ["säger att de inte kan motivera det nu", "föreslå en daterad lönerevision, en resultatbonus eller ett byte på något annat"], ["frågar vad du tjänar eller förväntar dig", "prata om rollens värde och ditt bud, inte om din nuvarande lön"]],
    checkHead: "Före mötet", checks: ["Ta med dina resultat skriftligt, med siffror", "Kan din lägsta nivå och ditt alternativ utantill", "Säg ditt första bud högt tre gånger", "Be om överenskommelsen skriftligt"],
    more: "Coachens fullständiga anteckningar",
    continue: "För att fortsätta senare: använd ”Kopiera sessionstext” i appen innan du stänger den.",
  },
};

/** The concession trades: the middle version of the items that matter most to the user besides base pay, else sensible defaults. */
function tradesFor(s: SessionState, lang: Lang): string[] {
  const d = s.outputs.package_draft as MesoResult | undefined;
  return [...(d?.trades ?? []), ...L[lang].trades].slice(0, 3);
}
/** Facts the extraction wrote about "the user" read as the user's own words. */
const firstPerson = (x: string, lang: Lang) => (lang === "sv" ? x.replace(/\b(användaren|användarens)\b/gi, (w) => (/s$/i.test(w) ? "min" : "mig")) : x.replace(/\bthe user's\b/gi, "my").replace(/\bthe user\b/gi, "me"));

export function planMarkdown(s: SessionState, lang: Lang, brief?: string): string {
  const l = L[lang]; const out: string[] = [];
  const target = num(val(s, "own_target")), walk = num(val(s, "walk_away")), current = num(val(s, "current_base")), offer = num(val(s, "offer_base"));
  const numbers = s.outputs.numbers as { defaultAnchor?: { amount?: number } } | undefined;
  const first = num(val(s, "first_offer")) ?? numbers?.defaultAnchor?.amount;
  const m = (val<{ p25?: number; median?: number; p75?: number; sources?: string[] }>(s, "market_range") ?? s.outputs.market_range) as { p25?: number; median?: number; p75?: number; sources?: string[] } | undefined;
  const fmt = (n?: number) => (n === undefined ? l.missing : kr(n, lang));

  // 1. the numbers
  out.push(`## ${l.numbers}`, "", `| | ${l.amount} | ${l.what} |`, "|---|---|---|");
  out.push(`| ${l.first} | ${fmt(first)} | ${l.firstMeans} |`, `| ${l.target} | ${fmt(target)} | ${l.targetMeans} |`, `| ${l.walk} | ${fmt(walk)} | ${l.walkMeans} |`);
  if (offer !== undefined) out.push(`| ${l.offer} | ${kr(offer, lang)} | |`); else if (current !== undefined) out.push(`| ${l.current} | ${kr(current, lang)} | |`);
  if (typeof m?.p25 === "number" && typeof m?.p75 === "number") out.push(`| ${l.market} | ${kr(m.p25, lang)} – ${kr(m.p75, lang)}${typeof m.median === "number" ? ` (${l.median} ${kr(m.median, lang)})` : ""} | ${cell(l.marketMeans(m.sources?.[0] ?? ""))} |`);
  const batna = str(val(s, "batna")); if (batna) out.push(`| ${l.batna} | | ${cell(batna)} |`);
  out.push("");

  // 2. the first offer
  out.push(`## ${l.firstHead}`, "");
  if (first !== undefined && target !== undefined) { out.push(l.firstLine(kr(first, lang), kr(target, lang))); const ref = offer ?? current; if (ref) out.push("", l.firstVs(pct(first, ref), offer ? l.vsOffer : l.vsCurrent)); }
  else out.push(l.noFirst);
  out.push("");

  // 3. three-step concession plan
  out.push(`## ${l.planHead}`, "", l.planIntro, "");
  if (first !== undefined && target !== undefined && walk !== undefined && first > target) {
    const cp = s.outputs.concession_plan as (ConcessionPlan & { first: number }) | undefined;
    const plan = cp && cp.first === first && cp.landing === target ? cp : undefined;
    const trades = tradesFor(s, lang); let at = first;
    if (!plan) out.push(l.noPlan);
    else {
      plan.steps.forEach((st, i) => { at -= st.amount; out.push(`${i + 1}. ${i === plan.steps.length - 1 ? l.stepLast(kr(at, lang), kr(st.amount, lang), trades[i] ?? trades[0]!) : l.step(i, kr(at, lang), kr(st.amount, lang), trades[i] ?? trades[0]!)}`); });
      out.push("", l.below(kr(walk, lang)));
    }
  } else out.push(l.noPlan);
  out.push("");

  // 4. packages
  const d = s.outputs.package_draft as (MesoResult & { failed?: boolean }) | undefined;
  if (String(val(s, "negotiate_scope") ?? "").toLowerCase() === "package" || d?.packages?.length) {
    out.push(`## ${l.pkgHead}`, "");
    if (d?.packages?.length) {
      out.push(l.pkgIntro, "", `| ${l.item} | ${d.packages.map((p) => `${l.pkg} ${p.id}`).join(" | ")} |`, `|---|${d.packages.map(() => "---").join("|")}|`);
      for (const is of d.issues) out.push(`| ${cell(d.packages[0]!.items.find((x) => x.issue === is.id)?.label ?? is.label)} | ${d.packages.map((p) => cell(p.items.find((x) => x.issue === is.id)?.text ?? "")).join(" | ")} |`);
      out.push(`| ${l.pkgCost} | ${d.packages.map((p) => l.cost[p.employerCost] ?? "").join(" | ")} |`, `| ${l.pkgShows} | ${d.packages.map((p) => cell(p.shows)).join(" | ")} |`);
    } else out.push(l.pkgNotYet);
    out.push("");
  }

  // 5. arguments
  out.push(`## ${l.argHead}`, "");
  const args: string[] = [];
  const ach = val<unknown>(s, "achievements");
  const achList = Array.isArray(ach) ? ach.map(str).filter(Boolean) : str(ach).split(/(?<=[.!])\s+(?=[A-ZÅÄÖ0-9])/).map((x) => x.trim()).filter(Boolean);
  args.push(...achList.map((a) => firstPerson(a.replace(/\.$/, ""), lang) + "."));
  const scope = str(val(s, "scope_change")); if (scope) args.push(l.argScope(firstPerson(scope.replace(/\.$/, ""), lang)));
  const years = num(val(s, "experience_years")); if (years) args.push(l.argExp(years));
  if (typeof m?.median === "number" && typeof m?.p75 === "number" && current !== undefined) args.push(l.argMarket(kr(current, lang), kr(m.median, lang), kr(m.p75, lang)));
  const lr = val<unknown>(s, "last_raise"); const last = typeof lr === "number" ? `${lr} %` : str(lr); if (last) args.push(l.argLast(last));
  if (!achList.length) args.push(l.argNone);
  out.push(...args.map((a) => `- ${a}`), "");

  // 6. what to say: the script writer's text when it exists, otherwise plain lines from the figures
  out.push(`## ${l.sayHead}`, "");
  const scripts = s.outputs.scripts as { parts?: { id: string; text: string; objection?: string }[] } | undefined;
  const label: Record<string, string> = { opening: l.open, ask: l.ask, objection: l.ifNo, trade: l.trade, close: l.close };
  if (scripts?.parts?.length) {
    for (const p of scripts.parts) if (p.text) out.push(`**${p.objection ? cell(p.objection) : label[p.id] ?? p.id}:** ${p.text.replace(/\n+/g, " ")}`, "");
  } else {
    const ex = achList[0] ? firstPerson(achList[0].replace(/\.$/, ""), lang) : undefined;
    out.push(`**${l.open}:** ${l.openLine}`, "");
    if (first !== undefined) out.push(`**${l.ask}:** ${l.askLine(kr(first, lang), ex)}`, "", l.saySilence, "");
    out.push(`**${l.ifNo}:** ${l.ifNoLine}`, "");
    if (target !== undefined) out.push(`**${l.trade}:** ${l.tradeLine(kr(target, lang), tradesFor(s, lang)[0]!)}`, "");
    out.push(`**${l.close}:** ${l.closeLine}`, "");
  }

  // 7. tough questions and the checklist
  out.push(`## ${l.toughHead}`, "", `| ${l.ifThey} | ${l.you} |`, "|---|---|", ...l.tough.map(([a, b]) => `| ${a} | ${b} |`), "");
  out.push(`## ${l.checkHead}`, "", ...l.checks.map((c) => `- [ ] ${c}`), "");
  if (brief?.trim()) out.push(`## ${l.more}`, "", brief.replace(/^#\s+.+$/m, "").replace(/^##\s/gm, "### ").trim(), "");
  out.push(l.continue);
  return out.join("\n");
}
