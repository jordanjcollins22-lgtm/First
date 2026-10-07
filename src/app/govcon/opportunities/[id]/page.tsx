import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ActionButton, CopyButton } from "@/components/govcon/action-button";
import { DocUpload } from "@/components/govcon/doc-upload";
import { daysLeft } from "@/components/govcon/opportunity-table";
import { StatusBadge } from "@/components/govcon/status-badge";
import { addManualQuote, prioritizeOpportunity, repriceBid, setOpportunityStatus } from "@/lib/actions/govcon-actions";
import { getOpportunityDetail } from "@/lib/data/govcon";
import type { ProposalDraft, QuoteCheck, SolicitationAnalysis } from "@/lib/govcon/ai";
import type { ComparableAward } from "@/lib/govcon/sources/usaspending";
import type { PriceAnchor, PricingResult } from "@/lib/govcon/pricing";
import { appUrl } from "@/lib/govcon/pipeline/context";
import { TRADE_BY_KEY } from "@/lib/govcon/trades";
import type { PointOfContact, ScoreFactor, SubcontractingAssessment, TradeKey } from "@/lib/govcon/types";

const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `$${Math.round(Number(n)).toLocaleString()}`);

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        {actions}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">{children}</CardContent>
    </Card>
  );
}

function List({ items }: { items: string[] | undefined }) {
  if (!items?.length) return <p className="text-muted-foreground">None noted.</p>;
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((i, n) => (
        <li key={n}>{i}</li>
      ))}
    </ul>
  );
}

export default async function OpportunityPage({ params }: PageProps<"/govcon/opportunities/[id]">) {
  await connection();
  const { id } = await params;
  const detail = await getOpportunityDetail(id);
  if (!detail) notFound();
  const { opp, rfqs, quotes, bid, events, subById } = detail;
  const analysis = (opp.analysis ?? null) as (Partial<SolicitationAnalysis> & { aiSkipped?: boolean }) | null;
  const scoreDetail = opp.score_detail as { factors?: ScoreFactor[]; disqualifiers?: string[]; flags?: string[] };
  const subcontracting = opp.subcontracting as Partial<SubcontractingAssessment>;
  const pricing = (bid?.pricing ?? null) as (PricingResult & { rejected?: Array<{ amount: number; reason: string }> }) | null;
  const proposal = (bid?.proposal ?? null) as ProposalDraft | null;
  const los = (bid?.compliance_check ?? null) as { compliant?: boolean; message?: string } | null;
  const comparables = (opp.comparables ?? []) as ComparableAward[];
  const anchor = opp.price_anchor as PriceAnchor | null;
  const contacts = (opp.points_of_contact ?? []) as PointOfContact[];
  const attachments = (opp.attachments ?? []) as Array<{ name: string; url: string }>;
  const trade = opp.trade ? TRADE_BY_KEY[opp.trade as TradeKey] : null;
  const base = appUrl();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={opp.status} />
            <Badge variant="outline">Score {opp.score}</Badge>
            {trade && <Badge variant="outline">{trade.label}</Badge>}
            <Badge variant="outline">{opp.set_aside_label ?? opp.set_aside}</Badge>
          </div>
          <h1 className="text-2xl font-bold">{opp.title}</h1>
          <p className="text-sm text-muted-foreground">
            {opp.agency} · {opp.office} · Sol# {opp.solicitation_number ?? "—"} ·{" "}
            {[opp.pop_city, opp.pop_state, opp.pop_zip].filter(Boolean).join(", ")}
          </p>
          <p className="text-sm">
            Due <strong>{opp.response_deadline ? new Date(opp.response_deadline).toLocaleString("en-US", { timeZoneName: "short" }) : "—"}</strong> ({daysLeft(opp.response_deadline)})
            {opp.url && (
              <>
                {" · "}
                <a href={opp.url} target="_blank" rel="noreferrer" className="text-primary underline">View on SAM.gov</a>
              </>
            )}
          </p>
          {opp.status_reason && <p className="text-sm text-muted-foreground">{opp.status_reason}</p>}
          {opp.last_error && <p className="text-sm text-destructive">{opp.last_error}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {opp.status === "new" && (
            <ActionButton action={prioritizeOpportunity.bind(null, id)}>Pursue this bid</ActionButton>
          )}
          {opp.status === "ready" && (
            <ActionButton action={setOpportunityStatus.bind(null, id, "submitted", undefined)} confirmText="Mark this proposal as submitted to the government?">
              Mark submitted
            </ActionButton>
          )}
          {opp.status === "submitted" && (
            <>
              <ActionButton action={setOpportunityStatus.bind(null, id, "won", undefined)}>Mark won</ActionButton>
              <ActionButton variant="outline" action={setOpportunityStatus.bind(null, id, "lost", undefined)}>Mark lost</ActionButton>
            </>
          )}
          {["new", "sourcing", "awaiting_quotes", "ready"].includes(opp.status) && (
            <ActionButton variant="outline" action={setOpportunityStatus.bind(null, id, "no_bid", "Manual no-bid")} confirmText="No-bid this opportunity?">
              No-bid
            </ActionButton>
          )}
          {["no_bid", "expired"].includes(opp.status) && (
            <ActionButton variant="outline" action={setOpportunityStatus.bind(null, id, "new", "Reopened")}>Reopen</ActionButton>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          {bid && (
            <Section title="Bid">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div><p className="text-xs text-muted-foreground">Our price</p><p className="text-xl font-bold">{money(bid.price)}</p></div>
                <div><p className="text-xs text-muted-foreground">Sub cost</p><p className="text-xl font-semibold">{money(bid.sub_cost)}</p></div>
                <div><p className="text-xs text-muted-foreground">Margin</p><p className="text-xl font-semibold">{money(bid.price - bid.sub_cost)}</p></div>
                <div><p className="text-xs text-muted-foreground">Markup</p><p className="text-xl font-semibold">{Math.round(bid.markup * 100)}%</p></div>
              </div>
              <List items={pricing?.rationale} />
              {!!pricing?.warnings?.length && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                  <p className="font-medium">Check before submitting</p>
                  <List items={pricing.warnings} />
                </div>
              )}
              {los && (
                <p className={los.compliant ? "text-primary" : "text-destructive"}>
                  Subcontracting limits: {los.message}
                </p>
              )}
              <form action={repriceBid.bind(null, id)} className="flex items-end gap-2">
                <div>
                  <label className="text-xs text-muted-foreground" htmlFor="markup">Reprice at markup %</label>
                  <Input id="markup" name="markup" type="number" step="1" defaultValue={Math.round(bid.markup * 100)} className="w-28" />
                </div>
                <Button type="submit" size="sm" variant="outline">Reprice</Button>
              </form>
            </Section>
          )}

          {proposal && (
            <Section title="Proposal draft">
              <p className="text-muted-foreground">Fill any [PLACEHOLDER], save as PDF, and submit per the instructions on the right.</p>
              {(
                [
                  ["Cover letter", proposal.coverLetter],
                  ["Technical approach", proposal.technicalApproach],
                  ["Past performance", proposal.pastPerformance],
                  ["Price", proposal.priceNarrative],
                ] as const
              ).map(([label, text]) => (
                <details key={label} className="rounded-md border border-border p-3" open={label === "Cover letter"}>
                  <summary className="flex cursor-pointer items-center justify-between font-medium">
                    {label} <CopyButton text={text} />
                  </summary>
                  <div className="mt-2 whitespace-pre-wrap">{text}</div>
                </details>
              ))}
              <div>
                <p className="font-medium">Submission checklist</p>
                <List items={proposal.submissionChecklist} />
              </div>
              {!!proposal.assumptions?.length && (
                <div>
                  <p className="font-medium">Assumptions</p>
                  <List items={proposal.assumptions} />
                </div>
              )}
            </Section>
          )}

          <Section title={`Sub quotes (${quotes.length})`}>
            {quotes.length ? (
              <table className="w-full">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="py-1">Sub</th><th>Price</th><th>Scope check</th><th>Terms</th></tr>
                </thead>
                <tbody>
                  {quotes.map((q) => {
                    const check = q.compliance as QuoteCheck | null;
                    return (
                      <tr key={q.id} className="border-t border-border align-top">
                        <td className="py-2 pr-2">
                          {subById.get(q.subcontractor_id)?.name ?? "—"}
                          {bid?.quote_id === q.id && <Badge className="ml-2">chosen</Badge>}
                          {q.notes && <div className="text-xs text-muted-foreground whitespace-pre-wrap">{q.notes}</div>}
                        </td>
                        <td className="py-2 pr-2 font-semibold">{money(q.amount)}</td>
                        <td className="py-2 pr-2">
                          {check ? (
                            <>
                              <span className={check.compliant ? "text-primary" : "text-destructive"}>{check.compliant ? "Matches scope" : "Gaps"}</span>
                              <div className="text-xs text-muted-foreground">{check.summary}</div>
                              {[...check.gaps, ...check.substitutions].map((g, i) => <div key={i} className="text-xs text-destructive">• {g}</div>)}
                            </>
                          ) : (
                            <span className="text-muted-foreground">Not checked</span>
                          )}
                        </td>
                        <td className="py-2 text-xs">
                          {q.accepts_net30 === false ? "No net-30" : q.accepts_net30 ? "Net-30 OK" : "Net-30 ?"}
                          {q.down_payment_pct ? ` · ${q.down_payment_pct}% down` : ""}
                          <br />
                          {q.is_small_business ? "Small" : q.is_small_business === false ? "Not small" : "Size ?"} ·{" "}
                          {q.uses_own_employees ? "Own crew" : q.uses_own_employees === false ? "Subs out" : "Crew ?"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="text-muted-foreground">No quotes yet.</p>
            )}
            <details className="rounded-md border border-border p-3">
              <summary className="cursor-pointer font-medium">Log a quote taken by phone</summary>
              <form action={addManualQuote.bind(null, id)} className="mt-3 grid gap-2 sm:grid-cols-2">
                <Input name="name" placeholder="Company name *" required />
                <Input name="amount" placeholder="Total price *" required />
                <Input name="phone" placeholder="Phone" />
                <Input name="email" placeholder="Email" />
                <Textarea name="notes" placeholder="What's included / exclusions" className="sm:col-span-2" />
                <Textarea name="references" placeholder="References" className="sm:col-span-2" />
                <label className="flex items-center gap-2"><input type="checkbox" name="net30" /> Accepts net-30</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="own_employees" /> Own employees</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="small_business" /> Small business</label>
                <Button type="submit" size="sm" className="sm:col-span-2">Save quote</Button>
              </form>
            </details>
          </Section>

          <Section title={`Quote requests (${rfqs.length})`}>
            {rfqs.length ? (
              <table className="w-full">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="py-1">Sub</th><th>Contact</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {rfqs.map((r) => (
                    <tr key={r.id} className="border-t border-border align-top">
                      <td className="py-2 pr-2">
                        {r.sub?.website ? <a href={r.sub.website} target="_blank" rel="noreferrer" className="hover:text-primary">{r.sub.name}</a> : r.sub?.name}
                        <div className="text-xs text-muted-foreground">
                          {r.sub?.rating ? `★ ${r.sub.rating} (${r.sub.review_count ?? 0})` : ""}
                          {r.sub?.past_federal_amount ? ` · federal work ${money(r.sub.past_federal_amount)}` : ""}
                        </div>
                      </td>
                      <td className="py-2 pr-2 text-xs">{r.sub?.email ?? "—"}<br />{r.sub?.phone ?? ""}</td>
                      <td className="py-2 pr-2"><Badge variant="outline">{r.channel === "call" && r.status === "queued" ? "to call" : r.status}</Badge></td>
                      <td className="py-2"><CopyButton text={`${base}/quote/${r.token}`} label="Copy quote link" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-muted-foreground">Subs are found after the documents are analyzed.</p>
            )}
          </Section>

          {analysis?.subScopeOfWork && (
            <Section title="Scope of work sent to subs" actions={<CopyButton text={analysis.subScopeOfWork} />}>
              <div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3">{analysis.subScopeOfWork}</div>
            </Section>
          )}

          {analysis && !analysis.aiSkipped && (
            <Section title="Solicitation analysis">
              <p>{analysis.scopeSummary}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="font-medium">Evaluation</p>
                  <p>{analysis.evaluation?.method?.replace(/_/g, " ")} — {analysis.evaluation?.factors?.join(", ")}</p>
                  <p className="text-xs text-muted-foreground">
                    Past performance {analysis.evaluation?.pastPerformanceRequired ? "required" : "not required"} · technical volume{" "}
                    {analysis.evaluation?.technicalVolumeRequired ? "required" : "not required"}
                  </p>
                </div>
                <div>
                  <p className="font-medium">Period</p>
                  <p>{analysis.periodOfPerformance?.description}</p>
                </div>
                <div>
                  <p className="font-medium">Site visit</p>
                  <p>{analysis.siteVisit?.offered ? `${analysis.siteVisit.mandatory ? "Mandatory" : "Optional"} — ${analysis.siteVisit.details ?? ""}` : "None"}</p>
                </div>
                <div>
                  <p className="font-medium">Wage determination / LoS clause</p>
                  <p>{analysis.wageDetermination ?? "None found"} · 52.219-14 {analysis.limitationsOnSubcontractingClause ? "included" : "not found"}</p>
                </div>
              </div>
              <div>
                <p className="font-medium">Red flags</p>
                <List items={analysis.redFlags} />
              </div>
              {!!analysis.priceLines?.length && (
                <div>
                  <p className="font-medium">Line items to price</p>
                  <List items={analysis.priceLines.map((l) => `${l.clin ? `${l.clin}: ` : ""}${l.description}${l.quantity ? ` — ${l.quantity} ${l.unit ?? ""}` : ""}`)} />
                </div>
              )}
            </Section>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <Section title="How to submit">
            {analysis?.submission ? (
              <>
                <p><strong>{analysis.submission.method}</strong> {analysis.submission.address}</p>
                <p className="whitespace-pre-wrap">{analysis.submission.instructions}</p>
                {analysis.submission.questionsDeadline && <p>Questions due: {analysis.submission.questionsDeadline}</p>}
                {analysis.submission.pageLimits && <p>Page limits: {analysis.submission.pageLimits}</p>}
                <p className="font-medium">Required contents</p>
                <List items={analysis.requiredProposalContents} />
              </>
            ) : (
              <p className="text-muted-foreground">Read the solicitation on SAM.gov for instructions.</p>
            )}
            <p className="font-medium">Government contacts</p>
            {contacts.map((c, i) => (
              <p key={i}>
                {c.name} {c.email && <a className="text-primary underline" href={`mailto:${c.email}`}>{c.email}</a>} {c.phone}
              </p>
            ))}
          </Section>

          <Section title="Why this scored">
            <ul className="space-y-1">
              {scoreDetail.factors?.map((f) => (
                <li key={f.key} className="flex justify-between gap-2">
                  <span>{f.label}{f.note ? <span className="text-xs text-muted-foreground"> — {f.note}</span> : null}</span>
                  <span className="tabular-nums">{f.points}/{f.max}</span>
                </li>
              ))}
            </ul>
            {!!scoreDetail.disqualifiers?.length && <div className="text-destructive"><List items={scoreDetail.disqualifiers} /></div>}
            {!!scoreDetail.flags?.length && <List items={scoreDetail.flags} />}
            {subcontracting.explanation && <p className="text-xs text-muted-foreground">{subcontracting.explanation}</p>}
          </Section>

          <Section title="Price history">
            <p>Anchor: {anchor ? `${money(anchor.annualAmount)}/yr — ${anchor.source}` : "none found"}</p>
            <ul className="space-y-2">
              {comparables.slice(0, 6).map((c) => (
                <li key={c.awardId} className="text-xs">
                  <a href={c.url} target="_blank" rel="noreferrer" className="font-medium text-primary underline">{c.awardId}</a> {c.recipientName} —{" "}
                  {money(c.amount)} ({c.startDate} → {c.endDate}, ≈{money(c.annualAmount)}/yr)
                  <div className="text-muted-foreground">{c.description.slice(0, 90)}</div>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Documents">
            {opp.status === "needs_docs" && (
              <p className="rounded-md bg-amber-50 p-2 text-amber-900">
                This portal keeps bid documents behind a free vendor login. Register at{" "}
                {opp.url ? <a href={opp.url} target="_blank" rel="noreferrer" className="underline">the portal</a> : "the portal"}, download the
                documents, and upload them here — the rest is automatic.
              </p>
            )}
            {((opp.uploaded_docs ?? []) as Array<{ name: string; path: string }>).map((d) => (
              <p key={d.path} className="text-xs">📎 {d.name}</p>
            ))}
            <DocUpload opportunityId={id} />
            {attachments.length ? (
              <ul className="space-y-1">
                {attachments.map((a) => (
                  <li key={a.url}><a href={a.url} className="text-primary underline" target="_blank" rel="noreferrer">{a.name}</a></li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">Not loaded yet.</p>
            )}
          </Section>

          <Section title="Activity">
            <ul className="space-y-1 text-xs">
              {events.map((e) => (
                <li key={e.id}>
                  <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span> — {e.message}
                </li>
              ))}
            </ul>
            <Link href="/govcon" className="text-primary underline">← Back to pipeline</Link>
          </Section>
        </div>
      </div>
    </div>
  );
}
