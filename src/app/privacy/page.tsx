import Link from "next/link";
export const metadata = { title: "Privacy · Negotiator" };

// Written to match exactly what the product does (Data-and-Privacy-Design). Provider terms are still to be checked before real users (D99).
const EN = {
  h: "Privacy", lead: "This tool helps you prepare for a salary conversation in Sweden. It is preparation support, not legal or financial advice.",
  items: [
    ["What happens to your messages", "What you type is sent to an AI provider so it can answer you. Market research uses web search with generic queries about role, sector and city, never your personal details."],
    ["What this service stores", "Nothing. There are no accounts and no profiles, and your conversation is not saved by the service. When you close the page or press New session, it is gone."],
    ["What is counted", "Anonymous counters only: that a brief was produced, how you rated it, and technical error counts. They hold no text from you and cannot be linked to a person."],
    ["What you keep", "The brief and the summary you download or copy are yours, on your device. Download them before you close the page."],
    ["Please do not enter", "Personal identity numbers, bank details or passwords. The tool never needs them."],
    ["Providers", "The AI provider and the hosting provider handle requests under their own terms. Their terms are being checked and this page will name them before public launch."],
  ],
};
const SV = {
  h: "Integritet", lead: "Det här verktyget hjälper dig att förbereda ett lönesamtal i Sverige. Det är förberedelsestöd, inte juridisk eller finansiell rådgivning.",
  items: [
    ["Vad som händer med dina meddelanden", "Det du skriver skickas till en AI-leverantör så att den kan svara dig. Marknadsundersökningen använder webbsökning med generella frågor om roll, bransch och ort, aldrig dina personuppgifter."],
    ["Vad tjänsten sparar", "Ingenting. Det finns inga konton eller profiler, och din konversation sparas inte av tjänsten. När du stänger sidan eller trycker på Ny session är den borta."],
    ["Vad som räknas", "Bara anonyma räknare: att ett underlag togs fram, hur du betygsatte det och tekniska felantal. De innehåller ingen text från dig och kan inte kopplas till en person."],
    ["Vad du behåller", "Underlaget och sammanfattningen som du laddar ner eller kopierar är dina, på din enhet. Ladda ner dem innan du stänger sidan."],
    ["Skriv helst inte in", "Personnummer, bankuppgifter eller lösenord. Verktyget behöver dem aldrig."],
    ["Leverantörer", "AI-leverantören och driftleverantören hanterar anrop enligt sina egna villkor. Villkoren kontrolleras och den här sidan nämner leverantörerna vid publik lansering."],
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
        </section>
      ))}
    </main>
  );
}
