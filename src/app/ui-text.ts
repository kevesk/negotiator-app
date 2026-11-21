export type Lang = "en" | "sv";
export const STEPS = ["Situation", "Market", "Numbers", "Strategy", "Scripts", "Brief"] as const;
export const T = {
  en: {
    title: "Negotiator", tagline: "Prepare for your salary conversation in Sweden.",
    termsHead: "Before you start",
    terms: [
      "This tool is AI-based and is for preparation only. It is not legal or tax advice.",
      "Nothing is saved after your session ends. Close the page and it is gone.",
      "An AI provider processes what you type, so do not enter personal identity numbers or bank details.",
    ],
    start: "I understand, start", language: "Language",
    opening: "Hi. I help you prepare for a salary conversation. Nothing you write is saved after this session, and an AI provider processes what you type. Is this about a job offer, or about a salary discussion at the job you have now?",
    placeholder: "Type your answer…", send: "Send", thinking: "Thinking…", newSession: "New session", summary: "Download summary",
    steps: ["Situation", "Market", "Numbers", "Strategy", "Scripts", "Brief"],
    errors: { not_configured: "The service is not set up yet (missing API key).", model_error: "The AI service did not answer. Please try again.", message_too_long: "That message is too long. Please shorten it.", generic: "Something went wrong. Please try again." },
    disclaimer: "Preparation support, not legal or financial advice.",
  },
  sv: {
    title: "Negotiator", tagline: "Förbered ditt lönesamtal i Sverige.",
    termsHead: "Innan du börjar",
    terms: [
      "Verktyget är AI-baserat och är bara till för förberedelse. Det är inte juridisk rådgivning eller skatteråd.",
      "Inget sparas när sessionen är slut. Stänger du sidan är allt borta.",
      "En AI-leverantör behandlar det du skriver, så ange inga personnummer eller bankuppgifter.",
    ],
    start: "Jag förstår, starta", language: "Språk",
    opening: "Hej. Jag hjälper dig att förbereda ett lönesamtal. Inget du skriver sparas efter sessionen, och en AI-leverantör behandlar det du skriver. Gäller det ett jobberbjudande, eller ett lönesamtal på jobbet du har nu?",
    placeholder: "Skriv ditt svar…", send: "Skicka", thinking: "Tänker…", newSession: "Ny session", summary: "Ladda ner sammanfattning",
    steps: ["Situation", "Marknad", "Siffror", "Strategi", "Manus", "Underlag"],
    errors: { not_configured: "Tjänsten är inte konfigurerad än (API-nyckel saknas).", model_error: "AI-tjänsten svarade inte. Försök igen.", message_too_long: "Meddelandet är för långt. Förkorta det.", generic: "Något gick fel. Försök igen." },
    disclaimer: "Förberedelsestöd, inte juridisk eller finansiell rådgivning.",
  },
} as const;
/** Sidebar step index for a stage id; the web app shows six steps (Flow-Overview). */
export const STEP_OF: Record<string, number> = { route: 0, intake: 0, position: 0, market: 1, numbers: 2, strategy: 3, scripts: 4, brief: 5, practice: 5, debrief: 5 };
