import type { Metadata } from "next";
import "../globals.css";

/**
 * The careers pages, outside the app shell.
 *
 * Opened from an Indeed ad on a phone by somebody with no account: no
 * sign-in, no menus, just the job and the questions. The stylesheet is
 * imported here and not inherited, as on the pre-evaluation form.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://app.jslandscapingmd.com"),
  title: "Careers",
  description: "Join our landscaping team.",
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function CareersLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
