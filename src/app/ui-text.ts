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
    openingChips: ["I received a job offer", "It's about my current job", "I'm not sure yet"],
    nextLabel: "Next step", stepOf: "Step {n} of {total}", then: "Then", suggestLabel: "Tap to answer, or write your own",
    openingNext: "Tell me whether this is a new job offer or your current job.",
    notice: "Your messages are processed by an AI provider to answer you. This service stores nothing after the session ends. Download your brief and summary before you close.", privacy: "Privacy",
    copy: "Copy", copied: "Copied", savePdf: "Save as PDF", briefReady: "Your brief is ready", ratingQ: "Was this brief useful?", ratings: { useful: "Useful", somewhat: "Somewhat", not_useful: "Not useful" }, ratingThanks: "Thanks, noted anonymously.",
    placeholder: "Or write your own answer…", send: "Send", thinking: "Thinking…", newSession: "New session", summary: "Download summary",
    steps: ["Situation", "Market", "Numbers", "Strategy", "Scripts", "Brief"],
    errors: { not_configured: "The service is not set up yet (missing API key).", model_error: "The AI service did not answer. Please try again.", message_too_long: "That message is too long. Please shorten it.", generic: "Something went wrong. Please try again.", access_required: "This test version needs an access code. Start a new session and enter it.", rate_limited: "You have reached the message limit for now. Try again in about {m} minutes. Your session is kept.", busy: "The service has reached its limit for this hour. Try again in about {m} minutes. Your session is kept." },
    accessLabel: "Access code", accessHint: "This is a test version. Enter the code you were given.", accessWrong: "That code is not right.", accessTooMany: "Too many attempts. Try again in about {m} minutes.",
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
    openingChips: ["Jag har fått ett jobberbjudande", "Det gäller mitt nuvarande jobb", "Jag är inte säker än"],
    nextLabel: "Nästa steg", stepOf: "Steg {n} av {total}", then: "Sedan", suggestLabel: "Tryck för att svara, eller skriv eget",
    openingNext: "Berätta om det gäller ett nytt jobberbjudande eller ditt nuvarande jobb.",
    notice: "Dina meddelanden behandlas av en AI-leverantör för att kunna svara dig. Tjänsten sparar inget när sessionen är slut. Ladda ner ditt underlag och din sammanfattning innan du stänger.", privacy: "Integritet",
    copy: "Kopiera", copied: "Kopierat", savePdf: "Spara som PDF", briefReady: "Ditt underlag är klart", ratingQ: "Var underlaget användbart?", ratings: { useful: "Användbart", somewhat: "Delvis", not_useful: "Inte användbart" }, ratingThanks: "Tack, noterat anonymt.",
    placeholder: "Eller skriv ditt eget svar…", send: "Skicka", thinking: "Tänker…", newSession: "Ny session", summary: "Ladda ner sammanfattning",
    steps: ["Situation", "Marknad", "Siffror", "Strategi", "Manus", "Underlag"],
    errors: { not_configured: "Tjänsten är inte konfigurerad än (API-nyckel saknas).", model_error: "AI-tjänsten svarade inte. Försök igen.", message_too_long: "Meddelandet är för långt. Förkorta det.", generic: "Något gick fel. Försök igen.", access_required: "Den här testversionen kräver en åtkomstkod. Starta en ny session och ange den.", rate_limited: "Du har nått gränsen för antal meddelanden just nu. Försök igen om ungefär {m} minuter. Din session finns kvar.", busy: "Tjänsten har nått sin gräns för den här timmen. Försök igen om ungefär {m} minuter. Din session finns kvar." },
    accessLabel: "Åtkomstkod", accessHint: "Det här är en testversion. Ange koden du har fått.", accessWrong: "Koden stämmer inte.", accessTooMany: "För många försök. Försök igen om ungefär {m} minuter.",
    disclaimer: "Förberedelsestöd, inte juridisk eller finansiell rådgivning.",
  },
} as const;
/** Sidebar step index for a stage id; the web app shows six steps (Flow-Overview). */
export const STEP_OF: Record<string, number> = { route: 0, intake: 0, position: 0, market: 1, numbers: 2, strategy: 3, scripts: 4, brief: 5, practice: 5, debrief: 5 };
