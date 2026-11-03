import Link from "next/link";

const TABS = [
  { key: "dashboard", label: "Dashboard", href: "/admin/people" },
  { key: "training", label: "Training", href: "/admin/people/training" },
  { key: "setup", label: "Checklists and SOPs", href: "/admin/people/setup" },
];

export function PeopleNav({ active }: { active: string }) {
  return (
    <nav aria-label="People" className="flex flex-wrap gap-1 rounded-lg border border-border p-1 text-sm">
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} aria-current={active === t.key ? "page" : undefined} className={`rounded-md px-3 py-1.5 font-medium ${active === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
