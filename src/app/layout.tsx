import type { ReactNode } from "react";
// Fonts are served by the app itself (no request to Google): Bricolage Grotesque for headings and figures,
// Figtree for the conversation, Source Serif 4 for the brief.
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/figtree";
import "@fontsource-variable/source-serif-4";
import "./globals.css";

export const metadata = { title: "Negotiator", description: "Prepare for your salary conversation in Sweden." };
export const viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#F5F7FA" }, { media: "(prefers-color-scheme: dark)", color: "#0D1626" }] };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
