"use client";

export type InventoryKind = "tool" | "material" | "other";

const KINDS: { value: InventoryKind; label: string; hint: string }[] = [
  { value: "tool", label: "Tool", hint: "Kept and used again" },
  { value: "material", label: "Material", hint: "Used up, reordered" },
  { value: "other", label: "Other", hint: "A cost — a fee, a permit" },
];

/**
 * Tool, material, or other — the one question, asked once.
 *
 * There used to be two of these: this, and a "Buying it" pair asking whether
 * something was bought again or bought once. They are the same question in
 * two vocabularies, and asking it twice on one screen is how somebody answers
 * "Material" to one and "Equipment" to the other and gets a total that is
 * quietly wrong.
 *
 * Everything downstream is derived from this answer rather than asked
 * separately: a tool is bought once and kept, a material is bought again
 * every run, and an "other" is a flat price with nothing behind it.
 */
export function InventoryKindChoice({
  value,
  onChange,
}: {
  value: InventoryKind;
  onChange: (value: InventoryKind) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {KINDS.map((option) => {
        const on = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-lg border p-2 text-left ${
              on ? "border-primary bg-primary/10" : "border-border"
            }`}
          >
            <span className="block text-sm font-medium">{option.label}</span>
            <span className="block text-[11px] text-muted-foreground">{option.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/** What the answer means for costing: kit is charged once, stock every run.
 * An "other" is a flat fee and has no basis at all. */
export function basisFor(kind: InventoryKind): "consumable" | "capital" {
  return kind === "tool" ? "capital" : "consumable";
}
