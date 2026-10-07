import Link from "next/link";
import { connection } from "next/server";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { updateContract } from "@/lib/actions/govcon-actions";
import { listContracts } from "@/lib/data/govcon";
import { revenueRunRate } from "@/lib/govcon/goals";

/** Won work in performance — the numbers behind the revenue run-rate. */
export default async function ContractsPage() {
  await connection();
  const contracts = await listContracts();
  const runRate = revenueRunRate(contracts.map((c) => ({ annualValue: Number(c.annual_value), startDate: c.start_date, endDate: c.end_date, status: c.status })));
  const subRunRate = contracts.filter((c) => c.status === "active").reduce((s, c) => s + Number(c.sub_annual_cost), 0) / 12;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Contracts</h1>
        <p className="text-sm text-muted-foreground">
          Monthly revenue run-rate <strong>${Math.round(runRate).toLocaleString()}</strong> · sub cost ≈ ${Math.round(subRunRate).toLocaleString()}/mo · gross
          margin ≈ ${Math.round(runRate - subRunRate).toLocaleString()}/mo. Contracts are created automatically when a bid is marked won — correct the
          values once the award documents arrive.
        </p>
      </div>
      {!contracts.length && <p className="text-muted-foreground">No contracts yet.</p>}
      {contracts.map((c) => (
        <Card key={c.id}>
          <CardContent className="space-y-2 pt-5 text-sm">
            <p className="font-semibold">
              <Link href={`/govcon/opportunities/${c.opportunity_id}`} className="hover:text-primary">{c.opp?.title ?? "Contract"}</Link>
            </p>
            <p className="text-muted-foreground">{c.opp?.agency} · {[c.opp?.pop_city, c.opp?.pop_state].filter(Boolean).join(", ")}</p>
            <form action={updateContract.bind(null, c.id)} className="grid items-end gap-2 sm:grid-cols-7">
              <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Contract #</span><Input name="contract_number" defaultValue={c.contract_number ?? ""} /></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Annual value $</span><Input name="annual_value" defaultValue={c.annual_value} /></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Sub cost / yr $</span><Input name="sub_annual_cost" defaultValue={c.sub_annual_cost} /></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Start</span><Input name="start_date" type="date" defaultValue={c.start_date ?? ""} /></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">End</span><Input name="end_date" type="date" defaultValue={c.end_date ?? ""} /></label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Status</span>
                <select name="status" defaultValue={c.status} className="h-10 w-full rounded-md border border-input bg-card px-2">
                  <option value="active">Active</option>
                  <option value="complete">Complete</option>
                  <option value="terminated">Terminated</option>
                </select>
              </label>
              <Button type="submit" size="sm" variant="outline" className="sm:col-start-7">Save</Button>
            </form>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
