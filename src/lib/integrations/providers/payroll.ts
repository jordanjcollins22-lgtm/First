import type { IntegrationProvider } from "@/lib/integrations/types";

/**
 * Payroll. Not an API: each week's hours and commissions go to Gusto or ADP
 * as the CSV their import screens take, downloaded or emailed to whoever
 * runs payroll. What's typed here is where it goes and the ADP codes.
 */
export const payrollProvider: IntegrationProvider = {
  id: "payroll",
  name: "Payroll (Gusto or ADP)",
  area: "Admin",
  enables: "Weekly hours from the time clock and crew day, plus commissions owed, as a Gusto or ADP import file.",
  fields: [
    { key: "format", label: "Payroll provider", placeholder: "gusto", help: "gusto or adp." },
    { key: "send_to", label: "Send the weekly file to", placeholder: "payroll@yourbookkeeper.com", help: "Whoever runs payroll. Leave blank to only download." },
    { key: "adp_company_code", label: "ADP company code", placeholder: "ABC", help: "ADP only: the 3-character Co Code on your paydata." },
    { key: "adp_commission_code", label: "ADP commission earnings code", placeholder: "C", help: "ADP only: the earnings code your setup uses for commission." },
  ],
  howTo: [
    "Gusto: Payroll → Run payroll → Import hours shows the spreadsheet it takes. Each person's Gusto employee ID is on their profile in Gusto (or leave it blank and Gusto matches on name).",
    "ADP (Workforce Now or RUN): ask your ADP rep or look under Process → Payroll → Import to confirm your company code and the earnings code for commission. Each person's File # is on their ADP profile.",
    "Type each person's Gusto ID or ADP File # under Admin › Finance › Payroll, once.",
    "Each Monday, Finance › Payroll shows last week. Download the file, or press Send to email it to the address above.",
  ],
  docsUrl: "https://support.gusto.com/article/106622236100000/Import-hours-into-payroll",
  async test(_secrets, settings) {
    const format = String(settings.format ?? "gusto").toLowerCase();
    if (format !== "gusto" && format !== "adp") return { ok: false, error: "Payroll provider must be gusto or adp." };
    const to = String(settings.send_to ?? "").trim();
    if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, error: "That send-to address doesn't look like an email." };
    if (format === "adp" && !String(settings.adp_company_code ?? "").trim()) return { ok: false, error: "ADP needs the company code." };
    return { ok: true };
  },
};
