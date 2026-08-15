"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createDiscount } from "@/lib/actions/discount-actions";
import type { Discount, DiscountKind } from "@/types/domain";

const NONE = "none";
const ADD_NEW = "__add_new__";

function discountLabel(d: Discount): string {
  return d.kind === "percentage" ? `${d.name} — ${d.value}% off` : `${d.name} — $${d.value.toLocaleString()} off`;
}

/** Picks a discount from the org's reusable catalog instead of typing an
 * arbitrary number — with an inline "add new" form for when the one needed
 * doesn't exist yet. */
export function DiscountSelect({
  discounts,
  selectedId,
  onChange,
  onCreated,
}: {
  discounts: Discount[];
  selectedId: string | null;
  onChange: (id: string | null) => void;
  onCreated: (discount: Discount) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DiscountKind>("percentage");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSelectChange(v: string) {
    if (v === ADD_NEW) {
      setAdding(true);
      return;
    }
    onChange(v === NONE ? null : v);
  }

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      try {
        const created = await createDiscount(name, kind, Number(value) || 0);
        onCreated(created);
        onChange(created.id);
        setAdding(false);
        setName("");
        setValue("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't create that discount.");
      }
    });
  }

  if (adding) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border p-2.5">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Discount name (e.g. Spring Special)"
          className="h-9 text-sm"
        />
        <div className="flex gap-2">
          <Select value={kind} onValueChange={(v) => setKind(v as DiscountKind)}>
            <SelectTrigger className="h-9 w-36 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="percentage">Percentage</SelectItem>
              <SelectItem value="amount">Dollar amount</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={kind === "percentage" ? "10" : "500"}
            className="h-9 w-24 text-sm"
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={handleCreate} disabled={isPending || !name.trim() || !value}>
            Create
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Select value={selectedId ?? NONE} onValueChange={handleSelectChange}>
      <SelectTrigger className="h-9 w-full text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No discount</SelectItem>
        {discounts.map((d) => (
          <SelectItem key={d.id} value={d.id}>
            {discountLabel(d)}
          </SelectItem>
        ))}
        <SelectItem value={ADD_NEW}>+ Add new discount</SelectItem>
      </SelectContent>
    </Select>
  );
}
