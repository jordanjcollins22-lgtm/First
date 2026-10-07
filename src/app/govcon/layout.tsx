import Link from "next/link";

export default function GovconLayout({ children }: LayoutProps<"/govcon">) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <nav className="mb-6 flex flex-wrap items-center gap-4 border-b border-border pb-3 text-sm font-medium">
        <span className="font-bold text-primary">Gov Contracts</span>
        <Link href="/govcon" className="hover:text-primary">Pipeline</Link>
        <Link href="/govcon/calls" className="hover:text-primary">Call list</Link>
        <Link href="/govcon/contracts" className="hover:text-primary">Contracts</Link>
        <Link href="/govcon/settings" className="hover:text-primary">Settings</Link>
      </nav>
      {children}
    </div>
  );
}
