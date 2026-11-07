import type { Metadata } from "next";
import "../globals.css";
import { ReviewChecklist } from "@/components/review/review-checklist";

/**
 * Flow Board review pages, outside the app shell so a reviewer opening a
 * preview link is never sent to the sign-in screen. They show sample data
 * only, and they only exist on preview deployments (see each page).
 */
export const metadata: Metadata = {
  title: "Review",
  robots: { index: false, follow: false },
};

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">
        {children}
        <ReviewChecklist />
      </body>
    </html>
  );
}
