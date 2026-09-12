import type { Metadata } from "next";
import "../globals.css";

// Its own root layout (no shared app/layout.tsx above it) — this page gets
// embedded on clients' own websites via an iframe, so it must never carry
// the internal app's header/nav along with it.
export const metadata: Metadata = {
  title: "Schedule an evaluation",
  description: "Book a property evaluation",
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
