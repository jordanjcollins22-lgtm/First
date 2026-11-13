import type { Metadata, Viewport } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "Your job",
  // Links carry a private token; keep them out of search engines.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

/** Pages employees reach from a texted link. No login, no office navigation. */
export default function EmployeeLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-background">{children}</body>
    </html>
  );
}
