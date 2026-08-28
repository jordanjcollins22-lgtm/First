/**
 * The advertiser's own pages, outside the app shell.
 *
 * A local business clicking a link we sent them is not staff, and the staff
 * nav on their screen is both confusing and a small leak of how we work.
 */
export default function FlyerLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
