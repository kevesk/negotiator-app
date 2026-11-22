import Link from "next/link";
export const metadata = { title: "Privacy · Negotiator" };

// Written to match exactly what the product does (Data-and-Privacy-Design). Providers checked against D99 on 2026-11-22; open points are in Decisions-Log.
const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
const EN = {
  h: "Privacy", lead: "This tool helps you prepare for a salary conversation in Sweden. It is preparation support, not legal or financial advice.",
  items: [
    ["What happens to your messages", "What you type is sent to an AI provider so it can answer you. For market pay, the service asks Statistics Sweden (SCB) for the figures of one occupation group, sending only the group code; if SCB has nothing, it uses web search with generic queries about role, sector and city. Never your personal details."],
    ["What this service stores", "Nothing. There are no accounts and no profiles, and your conversation is not saved by the service. When you close the page or press New session, it is gone. The AI provider may keep inputs and outputs for a limited time under its own business terms, which do not allow it to train its models on them."],
    ["What is counted", "Anonymous counters only: that a brief was produced, how you rated it, and technical error counts. They hold no text from you and cannot be linked to a person."],
    ["Access code and message limits", "The test version may ask for an access code. Your browser remembers it on this device only. To limit the number of messages per hour, the service keeps a scrambled (hashed) form of your network address together with message times, in memory only, for at most one hour. It is never written down or linked to what you type."],
    ["What you keep", "The brief and the summary you download or copy are yours, on your device. Download them before you close the page."],
    ["Please do not enter", "Personal identity numbers, bank details or passwords. The tool never needs them."],
    ["Providers", "AI answers: Anthropic (Claude API), under its commercial terms and data processing addendum. Hosting: Vercel, with the app's functions in Stockholm. Market pay: Statistics Sweden (SCB), and web search when SCB has nothing. Anthropic and Vercel may process data in the United States, under EU standard contractual clauses."],
    ["Who this is for", "Adults (18 or older) preparing their own salary conversation in Sweden."],
  ],
};
const SV = {
  h: "Integritet", lead: "Det här verktyget hjälper dig att förbereda ett lönesamtal i Sverige. Det är förberedelsestöd, inte juridisk eller finansiell rådgivning.",
  items: [
    ["Vad som händer med dina meddelanden", "Det du skriver skickas till en AI-leverantör så att den kan svara dig. För marknadslön hämtar tjänsten SCB:s siffror för en yrkesgrupp och skickar bara gruppens kod; har SCB inget används webbsökning med generella frågor om roll, bransch och ort. Aldrig dina personuppgifter."],
    ["Vad tjänsten sparar", "Ingenting. Det finns inga konton eller profiler, och din konversation sparas inte av tjänsten. När du stänger sidan eller trycker på Ny session är den borta. AI-leverantören kan spara indata och svar en begränsad tid enligt sina affärsvillkor, som inte tillåter att de används för att träna modeller."],
    ["Vad som räknas", "Bara anonyma räknare: att ett underlag togs fram, hur du betygsatte det och tekniska felantal. De innehåller ingen text från dig och kan inte kopplas till en person."],
    ["Åtkomstkod och meddelandegräns", "Testversionen kan fråga efter en åtkomstkod. Din webbläsare kommer ihåg den bara på den här enheten. För att begränsa antalet meddelanden per timme håller tjänsten en förvrängd (hashad) form av din nätverksadress och tidpunkterna för meddelanden, bara i minnet och i högst en timme. Den skrivs aldrig ner och kopplas aldrig till det du skriver."],
    ["Vad du behåller", "Underlaget och sammanfattningen som du laddar ner eller kopierar är dina, på din enhet. Ladda ner dem innan du stänger sidan."],
    ["Skriv helst inte in", "Personnummer, bankuppgifter eller lösenord. Verktyget behöver dem aldrig."],
    ["Leverantörer", "AI-svar: Anthropic (Claude API), enligt sina kommersiella villkor och sitt personuppgiftsbiträdesavtal. Drift: Vercel, med appens funktioner i Stockholm. Marknadslön: Statistiska centralbyrån (SCB) samt webbsökning när SCB inte har något. Anthropic och Vercel kan behandla uppgifter i USA, med EU:s standardavtalsklausuler."],
    ["Vem det är för", "Vuxna (18 år eller äldre) som förbereder sitt eget lönesamtal i Sverige."],
  ],
};
export default function Privacy() {
  return (
    <main className="shell" style={{ maxWidth: 720 }}>
      <p><Link href="/" style={{ color: "var(--accent)" }}>← Negotiator</Link></p>
      {[EN, SV].map((c) => (
        <section key={c.h} className="card" style={{ display: "grid", gap: 12 }} lang={c === EN ? "en" : "sv"}>
          <h1 style={{ margin: 0, fontSize: "1.3rem" }}>{c.h}</h1><p style={{ margin: 0, color: "var(--muted)" }}>{c.lead}</p>
          {c.items.map(([t, b]) => (<div key={t}><h2 style={{ margin: "0 0 2px", fontSize: "1rem" }}>{t}</h2><p style={{ margin: 0 }}>{b}</p></div>))}
          {CONTACT && <div><h2 style={{ margin: "0 0 2px", fontSize: "1rem" }}>{c === EN ? "Questions" : "Frågor"}</h2><p style={{ margin: 0 }}><a href={`mailto:${CONTACT}`} style={{ color: "var(--accent)" }}>{CONTACT}</a></p></div>}
        </section>
      ))}
    </main>
  );
}
