"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addOverheadExpense, deleteOverheadExpense, updateOverheadExpense } from "@/lib/actions/overhead-actions";
import type { OverheadExpense } from "@/types/domain";

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function ExpenseRow({ expense }: { expense: OverheadExpense }) {
  const [name, setName] = useState(expense.name);
  const [amount, setAmount] = useState(expense.amount.toString());
  const [note, setNote] = useState(expense.note ?? "");
  const [isPending, startTransition] = useTransition();

  function save(patch: { name?: string; amount?: number; note?: string | null }) {
    startTransition(async () => {
      await updateOverheadExpense(expense.id, patch);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteOverheadExpense(expense.id);
    });
  }

  return (
    <tr className="border-b border-border align-middle">
      <td className="p-2">
        <Input
          value={name}
          disabled={isPending}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== expense.name && save({ name: name.trim() })}
          className="h-9"
        />
      </td>
      <td className="p-2">
        <Input
          type="number"
          step="0.01"
          min={0}
          value={amount}
          disabled={isPending}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => {
            const next = Number(amount);
            if (!Number.isNaN(next) && next !== expense.amount) save({ amount: next });
          }}
          className="h-9 w-32"
        />
      </td>
      <td className="p-2">
        <Input
          placeholder="Optional note"
          value={note}
          disabled={isPending}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (expense.note ?? "") && save({ note: note.trim() || null })}
          className="h-9"
        />
      </td>
      <td className="p-2">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={isPending} onClick={handleDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}

export function OverheadList({ expenses }: { expenses: OverheadExpense[] }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  function handleAdd() {
    const parsedAmount = Number(amount);
    if (!name.trim() || Number.isNaN(parsedAmount)) return;
    startTransition(async () => {
      await addOverheadExpense({ name: name.trim(), amount: parsedAmount, note: note.trim() || null });
      setName("");
      setAmount("");
      setNote("");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-white/60 bg-card/60 px-4 py-3 backdrop-blur-md">
        <p className="text-xs text-muted-foreground">Total monthly overhead</p>
        <p className="text-2xl font-bold">{formatCurrency(total)}</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="p-2 font-medium">Name</th>
              <th className="p-2 font-medium">Amount / month</th>
              <th className="p-2 font-medium">Note</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {expenses.map((expense) => (
              <ExpenseRow key={expense.id} expense={expense} />
            ))}
            <tr>
              <td className="p-2">
                <Input placeholder="e.g. Fuel" value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
              </td>
              <td className="p-2">
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-9 w-32"
                />
              </td>
              <td className="p-2">
                <Input placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} className="h-9" />
              </td>
              <td className="p-2">
                <Button type="button" size="sm" disabled={isPending || !name.trim() || !amount.trim()} onClick={handleAdd}>
                  Add
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
        {expenses.length === 0 && <p className="p-4 text-sm text-muted-foreground">No overhead expenses yet.</p>}
      </div>
    </div>
  );
}
