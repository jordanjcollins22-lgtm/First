import type { Metadata } from "next";
import { Montserrat, Oswald } from "next/font/google";
import "../globals.css";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
});

const oswald = Oswald({
  subsets: ["latin"],
  variable: "--font-oswald",
});

export const metadata: Metadata = {
  title: "Apex Shine Mobile | Premium Mobile Detailing",
  description:
    "Interior, exterior, ceramic coatings and paint protection. Premium mobile detailing that comes to you. Call 443-528-0896.",
  openGraph: {
    title: "Apex Shine Mobile | Premium Mobile Detailing",
    description: "Your car deserves the best. Premium mobile detailing that comes to you.",
    images: ["/detailing/business-card.jpg"],
  },
};

export default function DetailingRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${oswald.variable} h-full scroll-smooth antialiased`}
    >
      <body className="detailing min-h-full bg-black text-white">{children}</body>
    </html>
  );
}
