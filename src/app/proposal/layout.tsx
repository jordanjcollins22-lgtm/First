import type { Metadata } from "next";
import "../globals.css";

/**
 * The client's own root layout, deliberately outside the (app) group.
 *
 * This page used to live inside it, which meant every client opening their
 * proposal got the internal navigation along with it: My Day, Money,
 * Inventory, the lot. Nothing was clickable for them and nothing leaked any
 * data, but a homeowner reading a quote should not be looking at the staff
 * menu of the company quoting them.
 *
 * Same reasoning as /book, and the same shape. A route group adds no URL
 * segment, so the link a client already has still works.
 */
export const metadata: Metadata = {
  title: "Your proposal",
  description: "Your property proposal",
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  // Zoom left available: a client reading a price and a scope on a phone in
  // the sun should be able to make it bigger.
  maximumScale: 5,
  userScalable: true,
};

export default function ProposalLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
