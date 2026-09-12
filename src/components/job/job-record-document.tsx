import { SiteMapImage } from "@/components/proposal/site-map-image";
import { ScopeText } from "@/components/proposal/scope-text";
import { money, shortDay, whenLine, type JobRecord, type RecordChange, type RecordMessage } from "@/lib/job-record";
import { addressLines } from "@/lib/receipt";

/**
 * The job record on paper.
 *
 * Laid out in the order the conversation goes when a client is unhappy: who
 * and where, what to have straight before knocking, the picture, what was
 * agreed, what was not, what got added, what they were told to expect, what
 * was said, what happened on site, what was paid, and the whole thing as one
 * dated list at the end for anybody who wants to check a claim.
 *
 * Every section is written so it can be read out loud across a table. No
 * ids, no internal state names, dates as dates and money as money. The
 * client copy is the same document with the team's own notes left out, and
 * the heading says which copy it is so the two are never confused.
 */
export function JobRecordDocument({ record }: { record: JobRecord }) {
  return (
    <article className="print-root mx-auto w-full max-w-[8.5in] bg-white text-[#14181a] shadow-sm print:shadow-none">
      <Letterhead record={record} />

      <div className="px-6 py-6 sm:px-10 print:px-0">
        <Parties record={record} />

        {record.walkNotes.length > 0 && (
          <Section title="Before you walk it" tone="attention">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {record.walkNotes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          </Section>
        )}

        {record.siteMap && record.siteMap.zones.length > 0 && (
          <Section title="The property, with the areas as they were drawn">
            <div className="overflow-hidden rounded-lg border border-[#e3e7e2] [break-inside:avoid]">
              <SiteMapImage
                imagePath={record.siteMap.imagePath}
                transform={record.siteMap.transform}
                zones={record.siteMap.zones.map((zone, index) => ({ ...zone, number: index + 1 }))}
                numbered
              />
            </div>
            <ol className="mt-2 grid grid-cols-1 gap-x-6 gap-y-0.5 text-xs text-[#5b6660] sm:grid-cols-2 print:grid-cols-2">
              {record.siteMap.zones.map((zone, index) => (
                <li key={`${zone.zoneName}-${index}`} className="flex gap-2">
                  <span className="w-5 shrink-0 font-semibold tabular-nums text-[#14181a]">{index + 1}.</span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: zone.color }} />
                    {zone.zoneName}
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        )}

        <Agreed record={record} />
        <NotIncluded record={record} />
        <AddedLater record={record} />
        <Expectations record={record} />
        <Communications record={record} />
        <Evaluation record={record} />
        <OnSite record={record} />
        <FieldReports record={record} />
        <Money record={record} />
        <Photos record={record} />
        <Timeline record={record} />
      </div>

      <Footer record={record} />
    </article>
  );
}

function Letterhead({ record }: { record: JobRecord }) {
  const lines = addressLines({ address: record.business.address });
  return (
    <header className="flex flex-col gap-3 border-b-4 border-[#2f6d3c] px-6 py-6 sm:flex-row sm:items-start sm:justify-between sm:px-10 print:flex-row print:px-0">
      <div>
        <p className="text-lg font-bold leading-tight">{record.business.name}</p>
        <p className="text-xs uppercase tracking-wide text-[#5b6660]">
          {record.title} · {record.clientCopy ? "Client copy" : "Full copy, for the team"}
        </p>
      </div>
      <address className="text-left text-xs not-italic leading-5 text-[#5b6660] sm:text-right print:text-right">
        {lines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
        {record.business.phone && <span className="block">{record.business.phone}</span>}
        {record.business.email && <span className="block">{record.business.email}</span>}
        {record.business.website && <span className="block">{record.business.website}</span>}
      </address>
    </header>
  );
}

function Parties({ record }: { record: JobRecord }) {
  return (
    <div className="[break-inside:avoid]">
      <h1 className="text-2xl font-bold tracking-tight">{record.address || record.job.name}</h1>
      <p className="mt-0.5 text-sm text-[#5b6660]">
        {record.customer.name}
        {record.customer.phone && ` · ${record.customer.phone}`}
        {record.customer.email && ` · ${record.customer.email}`}
      </p>
      {record.accountManager && (
        <p className="text-sm text-[#5b6660]">
          Account manager: {record.accountManager.name}
          {record.accountManager.phone && ` · ${record.accountManager.phone}`}
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4 print:grid-cols-4">
        {record.facts.map((fact) => (
          <div key={fact.label}>
            <dt className="text-[11px] uppercase tracking-wide text-[#5b6660]">{fact.label}</dt>
            <dd className="font-medium">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Agreed({ record }: { record: JobRecord }) {
  const agreed = record.agreed;
  if (!agreed) {
    return (
      <Section title="What was agreed">
        <p className="text-sm">No proposal was written for this job, so nothing was put in writing for either side.</p>
        {record.job.clientNotes && <Quote label="What they wrote when they booked">{record.job.clientNotes}</Quote>}
      </Section>
    );
  }
  return (
    <Section title="What was agreed" hint={agreed.outcome}>
      {record.job.clientNotes && <Quote label="What they wrote when they booked">{record.job.clientNotes}</Quote>}
      {agreed.groups.map((group) => (
        <div key={group.service} className="mt-4 first:mt-0 [break-inside:avoid]">
          <h3 className="text-base font-semibold">{group.service}</h3>
          <div className="mt-1 divide-y divide-[#e3e7e2] rounded-lg border border-[#e3e7e2]">
            {group.zones.map((zone, index) => (
              <div key={`${zone.name}-${index}`} className="px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">{zone.name}</p>
                  {zone.priceCents != null && (
                    <p className="shrink-0 text-sm tabular-nums text-[#5b6660]">{money(zone.priceCents)}</p>
                  )}
                </div>
                {zone.performedBy === "partner" && (
                  <p className="text-xs text-[#5b6660]">Carried out by {zone.partnerName ? `our partner ${zone.partnerName}` : "a partner business"}</p>
                )}
                {zone.scopeText.trim() ? (
                  <div className="mt-1 [&_p]:text-[#14181a] [&_li]:text-[#14181a]">
                    <ScopeText text={zone.scopeText} />
                  </div>
                ) : (
                  <p className="mt-1 text-sm italic text-[#5b6660]">No written scope for this area.</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="mt-4 flex flex-col items-end gap-0.5 text-sm [break-inside:avoid]">
        {agreed.discountCents > 0 && (
          <p className="text-[#5b6660]">
            Discount {money(agreed.discountCents)}
            {agreed.discountReason && ` (${agreed.discountReason})`}
          </p>
        )}
        {agreed.totalCents != null && (
          <p className="text-lg font-bold tabular-nums">Proposal total {money(agreed.totalCents)}</p>
        )}
        {agreed.paymentPath && <p className="text-[#5b6660]">{agreed.paymentPath}</p>}
        {agreed.clientChosenDay && <p className="text-[#5b6660]">Work day they chose: {shortDay(agreed.clientChosenDay)}</p>}
      </div>
      {agreed.responseNote && <Quote label="What they wrote when they answered">{agreed.responseNote}</Quote>}
    </Section>
  );
}

function NotIncluded({ record }: { record: JobRecord }) {
  const { notIncluded } = record;
  return (
    <Section title="What was not included" tone="rule">
      <ul className="space-y-1 text-sm">
        {notIncluded.rule.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {notIncluded.removed.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold">Taken off the proposal</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {notIncluded.removed.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {notIncluded.askedNotQuoted.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold">Asked about at booking, never quoted</h3>
          <p className="mt-1 text-sm">{notIncluded.askedNotQuoted.join(", ")}. These were not on the proposal and are not part of the job.</p>
        </div>
      )}
      {notIncluded.declined.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold">Asked for later and turned down</h3>
          <div className="mt-1 space-y-2">
            {notIncluded.declined.map((change, index) => (
              <ChangeCard key={index} change={change} />
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

function AddedLater({ record }: { record: JobRecord }) {
  if (record.addedLater.length === 0 && record.pendingChanges.length === 0) return null;
  return (
    <Section title="Work added after the sale">
      {record.addedLater.length > 0 ? (
        <div className="space-y-2">
          {record.addedLater.map((change, index) => (
            <ChangeCard key={index} change={change} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-[#5b6660]">Nothing has been agreed beyond the proposal.</p>
      )}
      {record.pendingChanges.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold">Requested, not yet agreed</h3>
          <div className="mt-1 space-y-2">
            {record.pendingChanges.map((change, index) => (
              <ChangeCard key={index} change={change} />
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

function ChangeCard({ change }: { change: RecordChange }) {
  return (
    <div className="rounded-lg border border-[#e3e7e2] px-3 py-2 text-sm [break-inside:avoid]">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium">{change.requestedNote}</p>
        {change.priceCents != null && <p className="shrink-0 tabular-nums">{money(change.priceCents)}</p>}
      </div>
      <p className="text-xs text-[#5b6660]">
        Requested {whenLine(change.requestedAt)}
        {change.requestedByName && ` by ${change.requestedByName}`} · {change.statusLabel}
      </p>
      {change.terms && <p className="mt-1 text-xs">{change.terms}</p>}
      {change.reviewNote && <p className="mt-1 text-xs text-[#5b6660]">Office: {change.reviewNote}</p>}
      {change.clientDecision && (
        <p className="mt-1 text-xs">
          Client {change.clientDecision}
          {change.clientDecisionAt && ` ${whenLine(change.clientDecisionAt)}`}
          {change.clientDecisionChannel && ` by ${change.clientDecisionChannel.replace(/_/g, " ")}`}
          {change.clientDecisionNote && `: "${change.clientDecisionNote}"`}
        </p>
      )}
    </div>
  );
}

function Expectations({ record }: { record: JobRecord }) {
  const agreed = record.agreed;
  if (!agreed) return null;
  return (
    <Section title="What they were told to expect" hint="Printed on the proposal they accepted">
      {agreed.expectations.length > 0 && (
        <div className="space-y-2">
          {agreed.expectations.map((expectation) => (
            <div key={expectation.heading} className="rounded-lg border border-[#e3e7e2] px-3 py-2 text-sm [break-inside:avoid]">
              <p className="font-medium">{expectation.heading}</p>
              <p className="mt-0.5">{expectation.body}</p>
              <p className="mt-0.5 text-xs text-[#5b6660]">How long: {expectation.timeframe}</p>
              {expectation.theirPart && <p className="text-xs text-[#5b6660]">Their part: {expectation.theirPart}</p>}
            </div>
          ))}
        </div>
      )}
      <div className={agreed.expectations.length > 0 ? "mt-3" : ""}>
        <h3 className="text-sm font-semibold">The terms on every proposal</h3>
        <dl className="mt-1 space-y-1.5 text-sm">
          {agreed.terms.map((term) => (
            <div key={term.heading} className="[break-inside:avoid]">
              <dt className="font-medium">{term.heading}</dt>
              <dd className="text-[#3d4743]">{term.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}

function Communications({ record }: { record: JobRecord }) {
  const nothing = record.communications.length === 0 && record.objections.length === 0 && record.internalNotes.length === 0;
  return (
    <Section title="Everything that was said" hint={record.clientCopy ? undefined : "Messages, texts, emails and notes, oldest first"}>
      {nothing && <p className="text-sm text-[#5b6660]">No messages on file for this job.</p>}
      {record.communications.length > 0 && (
        <div className="space-y-2">
          {record.communications.map((message, index) => (
            <MessageCard key={index} message={message} />
          ))}
        </div>
      )}
      {record.objections.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold">Questions they raised on the proposal</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {record.objections.map((objection, index) => (
              <li key={index} className="[break-inside:avoid]">
                <span className="text-xs text-[#5b6660]">{whenLine(objection.at)} · </span>
                <span className="font-medium">{objection.question}</span>
                {objection.note && <span> — they wrote: &ldquo;{objection.note}&rdquo;</span>}
                {objection.resolution && (
                  <span className="text-[#5b6660]"> · we offered: {objection.resolution.replace(/_/g, " ")}{objection.resolved === true ? " (settled)" : objection.resolved === false ? " (not settled)" : ""}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {record.internalNotes.length > 0 && (
        <div className="mt-3 rounded-lg border border-dashed border-[#c9a227] bg-[#fdf8e7] p-3">
          <h3 className="text-sm font-semibold">Team notes · not for the client</h3>
          <div className="mt-1 space-y-2">
            {record.internalNotes.map((message, index) => (
              <MessageCard key={index} message={message} />
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

function MessageCard({ message }: { message: RecordMessage }) {
  const who = message.from === "client" ? message.name : message.from === "system" ? "Sent automatically" : message.name;
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm [break-inside:avoid] ${message.from === "client" ? "border-[#2f6d3c]/40 bg-[#f3f8f4]" : "border-[#e3e7e2]"}`}>
      <p className="text-xs text-[#5b6660]">
        {whenLine(message.at)} · <span className="font-medium text-[#14181a]">{who}</span> · {message.channel}
        {message.reference && ` · about ${message.reference}`}
      </p>
      <p className="mt-0.5 whitespace-pre-wrap">{message.body}</p>
    </div>
  );
}

function Evaluation({ record }: { record: JobRecord }) {
  if (record.evalEdits.length === 0 && record.scopeRequests.length === 0 && record.marks.length === 0) return null;
  return (
    <Section title="Changes to the evaluation after the walk">
      {record.evalEdits.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {record.evalEdits.map((edit, index) => (
            <li key={index} className="[break-inside:avoid]">
              <p className="text-xs text-[#5b6660]">
                {whenLine(edit.at)}
                {edit.byName && ` · ${edit.byName}`}
                {edit.requestedVia && ` · asked by ${edit.requestedVia.replace(/_/g, " ")}`}
              </p>
              <ul className="list-disc pl-5">
                {edit.changes.map((change, i) => (
                  <li key={i}>{change}</li>
                ))}
              </ul>
              {edit.note && <p className="text-[#5b6660]">{edit.note}</p>}
            </li>
          ))}
        </ul>
      )}
      {record.marks.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold">Pinned on the map by the evaluator · team only</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {record.marks.map((mark, index) => (
              <li key={index}>
                {mark.note}
                {mark.authorName && <span className="text-xs text-[#5b6660]"> · {mark.authorName}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function OnSite({ record }: { record: JobRecord }) {
  const nothing =
    record.visits.length === 0 && record.tickets.length === 0 && record.walkthroughs.length === 0 && !record.job.completedAt;
  if (nothing) return null;
  return (
    <Section title="What happened on site">
      {record.visits.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Visits</h3>
          <ul className="mt-1 space-y-0.5 text-sm">
            {record.visits.map((visit, index) => (
              <li key={index}>
                {visit.startsOn === visit.endsOn ? shortDay(visit.startsOn) : `${shortDay(visit.startsOn)} to ${shortDay(visit.endsOn)}`}
                {" · "}
                {visit.status.replace(/_/g, " ")}
                {visit.purpose && ` · ${visit.purpose}`}
                {visit.pauseReason && <span className="text-[#5b6660]"> · paused: {visit.pauseReason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {record.job.completedAt && (
        <p className="mt-3 text-sm">
          Marked complete {whenLine(record.job.completedAt)}
          {record.job.completedByName && ` by ${record.job.completedByName}`}
          {record.job.completionNotes && `: "${record.job.completionNotes}"`}
        </p>
      )}
      {record.walkthroughs.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold">Final walkthroughs</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {record.walkthroughs.map((walk, index) => (
              <li key={index} className="[break-inside:avoid]">
                Requested {whenLine(walk.requestedAt)} · {walk.status}
                {walk.reviewedAt && ` ${whenLine(walk.reviewedAt)}`}
                {walk.requestedNote && <p className="text-[#5b6660]">Crew: {walk.requestedNote}</p>}
                {walk.reviewNotes && <p className="text-[#5b6660]">Manager: {walk.reviewNotes}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {record.tickets.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold">Callbacks</h3>
          <div className="mt-1 space-y-2">
            {record.tickets.map((ticket, index) => (
              <div key={index} className="rounded-lg border border-[#e3e7e2] px-3 py-2 text-sm [break-inside:avoid]">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">{ticket.title}</p>
                  <p className="shrink-0 text-xs text-[#5b6660]">{ticket.status.replace(/_/g, " ")}</p>
                </div>
                <p className="text-xs text-[#5b6660]">
                  Raised {whenLine(ticket.at)} · {ticket.severity}
                  {ticket.cause && ` · cause: ${ticket.cause}`} · {ticket.billable ? "billable" : "at our cost"}
                </p>
                {ticket.detail && <p className="mt-0.5">{ticket.detail}</p>}
                {ticket.resolution && (
                  <p className="mt-0.5 text-[#3d4743]">
                    Resolved{ticket.resolvedAt && ` ${whenLine(ticket.resolvedAt)}`}: {ticket.resolution}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

function FieldReports({ record }: { record: JobRecord }) {
  if (record.issues.length === 0 && record.exceptions.length === 0) return null;
  return (
    <Section title="Issues and reports from the field · team only">
      {record.issues.length > 0 && (
        <ul className="space-y-1 text-sm">
          {record.issues.map((issue, index) => (
            <li key={index} className="[break-inside:avoid]">
              <span className="text-xs text-[#5b6660]">{whenLine(issue.at)} · {issue.type} · {issue.severity} · </span>
              <span className="font-medium">{issue.title}</span>
              {issue.description && <p>{issue.description}</p>}
              <p className="text-xs text-[#5b6660]">
                {issue.status.replace(/_/g, " ")}
                {issue.ownerName && ` · with ${issue.ownerName}`}
                {issue.resolution && ` · ${issue.resolution}`}
              </p>
            </li>
          ))}
        </ul>
      )}
      {record.exceptions.length > 0 && (
        <ul className={`space-y-1 text-sm ${record.issues.length > 0 ? "mt-3" : ""}`}>
          {record.exceptions.map((exception, index) => (
            <li key={index} className="[break-inside:avoid]">
              <span className="text-xs text-[#5b6660]">
                {whenLine(exception.at)} · {exception.kind}
                {exception.reportedByName && ` · ${exception.reportedByName}`} ·{" "}
              </span>
              <span className="font-medium">{exception.summary}</span>
              {exception.detail && <p>{exception.detail}</p>}
              {exception.resolution && <p className="text-xs text-[#5b6660]">{exception.resolution}</p>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Money({ record }: { record: JobRecord }) {
  const { money: m } = record;
  return (
    <Section title="Money">
      <table className="w-full text-sm">
        <tbody>
          {m.quotedCents != null && <Row label="Proposal total" value={money(m.quotedCents)} />}
          {m.discountCents > 0 && <Row label="Of which discount" value={money(m.discountCents)} muted />}
          {m.addedCents > 0 && <Row label="Work added afterwards" value={money(m.addedCents)} />}
          {m.dueCents != null && <Row label="Total for the job" value={money(m.dueCents)} strong />}
          {m.invoices.map((invoice, index) => (
            <Row
              key={`i${index}`}
              label={`Invoice ${invoice.status}${invoice.sentAt ? `, sent ${shortDay(invoice.sentAt)}` : ""}${invoice.paidAt ? `, paid ${shortDay(invoice.paidAt)}` : ""}`}
              value={money(invoice.amountCents)}
              muted
            />
          ))}
          {m.payments.map((payment, index) => (
            <Row
              key={`p${index}`}
              label={`Paid ${shortDay(payment.at)} by ${payment.method}${payment.receiptNumber ? ` · receipt ${payment.receiptNumber}` : ""}`}
              value={money(payment.amountCents)}
            />
          ))}
          {m.payments.length === 0 && <Row label="Payments received" value="None" muted />}
          {m.outstandingCents != null && (
            <Row label="Outstanding" value={m.outstandingCents > 0 ? money(m.outstandingCents) : "Nothing owed"} strong />
          )}
        </tbody>
      </table>
      {record.job.disputeOpenedAt && (
        <p className="mt-2 text-sm">
          Dispute opened {whenLine(record.job.disputeOpenedAt)}
          {record.job.disputeKind && ` (${record.job.disputeKind.replace(/_/g, " ")})`}
          {record.job.disputeReason && `: ${record.job.disputeReason}`}
        </p>
      )}
    </Section>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <tr className={`border-b border-[#e3e7e2] last:border-0 ${muted ? "text-[#5b6660]" : ""} ${strong ? "font-semibold" : ""}`}>
      <td className="py-1.5 pr-4">{label}</td>
      <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{value}</td>
    </tr>
  );
}

function Photos({ record }: { record: JobRecord }) {
  const withUrl = record.photos.filter((photo) => photo.url);
  if (withUrl.length === 0) return null;
  const phases = [...new Set(withUrl.map((photo) => photo.phase))];
  return (
    <Section title="Photographs on file" hint={`${withUrl.length} photo${withUrl.length === 1 ? "" : "s"}`}>
      {phases.map((phase) => (
        <div key={phase} className="mt-3 first:mt-0">
          <h3 className="text-sm font-semibold capitalize">{phase.replace(/_/g, " ")}</h3>
          <div className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-4 print:grid-cols-4">
            {withUrl
              .filter((photo) => photo.phase === phase)
              .map((photo, index) => (
                <figure key={index} className="[break-inside:avoid]">
                  {/* Signed, short-lived URL from a private bucket; a Next image
                      loader would refuse the host and the page must print. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url!} alt={photo.caption ?? photo.zoneName ?? "Job photo"} className="aspect-square w-full rounded-md object-cover" />
                  <figcaption className="mt-0.5 text-[10px] leading-tight text-[#5b6660]">
                    {shortDay(photo.at)}
                    {photo.zoneName && ` · ${photo.zoneName}`}
                    {photo.caption && ` · ${photo.caption}`}
                  </figcaption>
                </figure>
              ))}
          </div>
        </div>
      ))}
    </Section>
  );
}

function Timeline({ record }: { record: JobRecord }) {
  if (record.timeline.length === 0) return null;
  return (
    <Section title="The whole job, in order">
      <ol className="space-y-1 text-sm">
        {record.timeline.map((entry, index) => (
          <li key={index} className="flex gap-3 [break-inside:avoid]">
            <span className="w-40 shrink-0 text-xs leading-5 tabular-nums text-[#5b6660]">{whenLine(entry.at)}</span>
            <span className="min-w-0">
              <span className="font-medium">{entry.what}</span>
              {entry.internal && <span className="text-xs text-[#5b6660]"> · team only</span>}
              {entry.detail && <span className="block whitespace-pre-wrap text-[#3d4743]">{entry.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Footer({ record }: { record: JobRecord }) {
  return (
    <footer className="flex flex-col items-center gap-0.5 border-t border-[#e3e7e2] px-6 py-4 text-center text-[11px] text-[#5b6660] sm:flex-row sm:justify-between sm:px-10 print:flex-row print:justify-between print:px-0">
      <span>
        {record.business.name} · {record.title.toLowerCase()} for {record.customer.name}
        {record.job.number && ` · job ${record.job.number}`}
      </span>
      <span className="whitespace-nowrap">Printed {whenLine(record.generatedAt)}</span>
    </footer>
  );
}

function Section({
  title,
  hint,
  tone,
  children,
}: {
  title: string;
  hint?: string;
  tone?: "attention" | "rule";
  children: React.ReactNode;
}) {
  const frame =
    tone === "attention"
      ? "rounded-lg border border-[#2f6d3c] bg-[#f3f8f4] p-4"
      : tone === "rule"
        ? "rounded-lg border border-[#e3e7e2] bg-[#fafbfa] p-4"
        : "";
  return (
    <section className={`mt-7 ${frame}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b-2 border-[#2f6d3c] pb-1">
        <h2 className="text-lg font-bold">{title}</h2>
        {hint && <p className="text-xs text-[#5b6660]">{hint}</p>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Quote({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <blockquote className="mt-3 rounded-lg border-l-4 border-[#2f6d3c] bg-[#f3f8f4] px-3 py-2 text-sm [break-inside:avoid]">
      <p className="text-xs text-[#5b6660]">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap">{children}</p>
    </blockquote>
  );
}
