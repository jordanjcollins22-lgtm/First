import { CATEGORIES, type Category } from "@/lib/accounting/schedule-c";

const GROUPS: { label: string; test: (c: Category) => boolean }[] = [
  { label: "Income", test: (c) => c.target.kind === "line" && ["1", "2", "6"].includes(c.target.line) },
  { label: "Job materials", test: (c) => c.target.kind === "job_materials" || (c.target.kind === "line" && c.target.line === "39") },
  { label: "Expenses (Part II)", test: (c) => c.target.kind === "line" && !["1", "2", "6", "39"].includes(c.target.line) },
  { label: "Not on Schedule C", test: (c) => c.target.kind === "excluded" },
  { label: "Undecided", test: (c) => c.target.kind === "review" },
];

function lineTag(c: Category) {
  if (c.target.kind === "line") return ` (line ${c.target.line})`;
  if (c.target.kind === "job_materials") return " (line 36 or 22)";
  return "";
}

/** Plain <select> with every category grouped and labeled with its Schedule C line. */
export function CategoryOptions() {
  return (
    <>
      {GROUPS.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {(CATEGORIES as readonly Category[]).filter(group.test).map((c) => (
            <option key={c.key} value={c.key} title={c.help}>
              {c.label}
              {lineTag(c)}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

export const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
