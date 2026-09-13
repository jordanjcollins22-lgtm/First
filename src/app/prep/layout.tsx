import type { Metadata } from "next";
import "../globals.css";

/**
 * The pre-evaluation form, outside the app shell.
 *
 * Opened from a booking email on a phone by somebody with no account. There
 * is no sign-in, nothing to install, and nothing on the page but the
 * questions. The stylesheet is imported here and not inherited: a root
 * layout outside the (app) group inherits nothing from it.
 */
export const metadata: Metadata = {
  title: "Before your evaluation",
  description: "A few questions so we come ready.",
  robots: { index: false, follow: false },
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function PrepLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
