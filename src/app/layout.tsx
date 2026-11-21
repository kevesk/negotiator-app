import type { ReactNode } from "react";
import "./globals.css";
export const metadata = { title: "Negotiator", description: "Prepare for your salary conversation in Sweden." };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
