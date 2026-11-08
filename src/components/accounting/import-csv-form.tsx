"use client";

import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { importStatementCsv } from "@/lib/actions/accounting-actions";

import { SELECT_CLASS } from "./category-select";

export function ImportCsvForm({ accounts }: { accounts: { id: string; name: string; mask: string | null }[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "new");
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const r = await importStatementCsv(formData);
      setResult(r);
      if (!r.error) formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="account_id">Account</Label>
          <select
            id="account_id"
            name="account_id"
            className={SELECT_CLASS}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.mask ? ` ••${a.mask}` : ""}
              </option>
            ))}
            <option value="new">+ New account…</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="file">Statement CSV</Label>
          <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
        </div>
        {accountId === "new" && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new_account_name">Account name</Label>
              <Input id="new_account_name" name="new_account_name" placeholder="Chase Business Checking" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new_account_kind">Type</Label>
              <select id="new_account_kind" name="new_account_kind" className={SELECT_CLASS} defaultValue="checking">
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="credit_card">Credit card</option>
                <option value="other">Other</option>
              </select>
            </div>
          </>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="purchases_positive" />
        Purchases show as positive numbers in this file (American Express and some card exports)
      </label>

      {result?.error && <p className="text-sm text-destructive">{result.error}</p>}
      {result?.message && <p className="text-sm text-green-700">{result.message}</p>}

      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Importing…" : "Import statement"}
      </Button>
    </form>
  );
}
