import type { ReactNode } from "react";
export const metadata = { title: "Negotiator" };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="sv"><body>{children}</body></html>);
}
