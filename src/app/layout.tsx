import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Field Estimator",
  description: "Property estimating & job-execution app",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-bold text-primary">
              Field Estimator
            </Link>
            <nav className="flex items-center gap-4 text-sm font-medium">
              <Link href="/properties" className="hover:text-primary">
                Properties
              </Link>
              <Link href="/admin/service-templates" className="hover:text-primary">
                Service Templates
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
