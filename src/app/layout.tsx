import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  title: "Field Estimator",
  description: "Property estimating & job-execution app",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  let userEmail: string | null = null;
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userEmail = user?.email ?? null;
  }

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-bold text-primary">
              Field Estimator
            </Link>
            <SiteNav userEmail={userEmail} />
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
