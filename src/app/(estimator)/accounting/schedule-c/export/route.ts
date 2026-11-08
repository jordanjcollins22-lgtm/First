import type { NextRequest } from "next/server";

import { getCategory } from "@/lib/accounting/schedule-c";
import { getYearSettings, listYearTransactions, parseYear } from "@/lib/data/accounting";
import { comparePlantTreatments } from "@/lib/accounting/report";

function csvCell(value: string | number) {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Every transaction for the year with its category and Schedule C line, for a CPA. */
export async function GET(request: NextRequest) {
  const year = parseYear(request.nextUrl.searchParams.get("year") ?? undefined);
  const [transactions, settings] = await Promise.all([listYearTransactions(year), getYearSettings(year)]);
  const treatment = settings.plantTreatment ?? comparePlantTreatments(transactions, settings).recommended;

  const header = ["Date", "Description", "Amount", "Category", "Schedule C line", "Deductible amount", "Needs review"];
  const rows = transactions.map((t) => {
    const cat = getCategory(t.category);
    let line = "Not on Schedule C";
    let deductible = 0;
    if (cat.target.kind === "line") {
      line = cat.target.line;
      deductible = cat.target.line === "1" || cat.target.line === "6" ? t.amount : -t.amount * (cat.target.deductiblePct ?? 1);
      if (t.category === "freight_in" && treatment === "install") line = "22";
    } else if (cat.target.kind === "job_materials") {
      line = treatment === "sell" ? "36" : "22";
      deductible = -t.amount;
    } else if (cat.target.kind === "review") {
      line = "UNDECIDED";
    }
    return [t.posted_on, t.description, t.amount.toFixed(2), cat.label, line, deductible.toFixed(2), t.needs_review ? "yes" : ""];
  });

  const body = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="schedule-c-${year}-transactions.csv"`,
    },
  });
}
