/**
 * Cents as dollars for the marketing screens: whole dollars from $10 up,
 * cents below. Shared by server and client components, so it lives outside
 * any "use client" file (a server component can't call into one).
 */
export function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const dollars = cents / 100;
  return dollars >= 1000 ? `$${Math.round(dollars).toLocaleString()}` : `$${dollars.toFixed(dollars < 10 ? 2 : 0)}`;
}
