import type { Metadata } from "next";
import "../globals.css";
import { OutboxRunner } from "@/components/offline/outbox-runner";

/**
 * A subcontractor's crew sheet, outside the app shell: opened from a text
 * or an email by somebody with no account. The stylesheet is imported here
 * and not inherited, because a root layout outside the (app) group
 * inherits nothing.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://app.jslandscapingmd.com"),
  title: "Crew sheet",
  description: "Where to go, what to do, and the photos to take.",
  robots: { index: false, follow: false },
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function CrewLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">
        {children}
        <OutboxRunner />
      </body>
    </html>
  );
}
