import Link from "next/link";

import { Row, Screen, Sub, money } from "@/components/phone/parts";
import { EstimateButton } from "@/components/phone/estimate-button";
import { NewEstimate } from "@/components/phone/new-estimate";
import { ProposalButtons } from "@/components/phone/proposal-buttons";
import { AddonEditor } from "@/components/phone/addon-editor";
import type { ClientFile, FileJob } from "@/lib/data/client-file";
import { crewPath } from "@/lib/crew-link";

const TZ = "America/New_York";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });
const dayTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ });
const dateOnly = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

const JOB_STATUS: Record<string, string> = {
  estimating: "Estimate",
  quoted: "Proposal sent",
  approved: "Sold, not started",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};
const PROPOSAL: Record<string, string> = { needs_approval: "Needs your OK", sent: "Sent", accepted: "Signed", declined: "Declined" };
const INVOICE: Record<string, string> = { open: "Not paid", paid: "Paid", void: "Void", uncollectible: "Written off" };

/**
 * A client, as the account manager's breakdown draws it: their job and its
 * status, Text and Call, then Messages, Proposals, Invoices, Schedule and Site
 * map, each closed until tapped. With `jobId`, that job comes first and opens.
 */
export function ClientFileView({ file, jobId }: { file: ClientFile; jobId?: string }) {
  const jobs = jobId ? [...file.jobs].sort((a, b) => (a.id === jobId ? -1 : b.id === jobId ? 1 : 0)) : file.jobs;
  return (
    <Screen hello="Client" role={file.doNotContact ? "Do not contact" : ""}>
      <Link href="/me" className="vx-cl-back">
        ‹ Back
      </Link>
      <div>
        <div className="vx-cl-h">{file.name}</div>
        <div className="vx-cl-s">{file.town || file.jobs[0]?.address}</div>
      </div>
      {jobs.length === 0 && (
        <div className="vx-card">
          <Row a="No projects yet" />
          <Contact file={file} />
        </div>
      )}
      {jobs.map((j) => (
        <JobCard key={j.id} job={j} file={file} />
      ))}
      <NewEstimate
        customerId={file.id}
        name={file.name}
        phone={file.phone ?? ""}
        email={file.email ?? ""}
        address={file.jobs[0]?.address ?? ""}
        label={jobs.length ? "New estimate for this client" : "New estimate"}
      />
    </Screen>
  );
}

function Contact({ file }: { file: ClientFile }) {
  if (!file.phone || file.doNotContact) return null;
  const tel = file.phone.replace(/[^\d+]/g, "");
  return (
    <div className="vx-2b">
      <a href={`sms:${tel}`} className="vx-cta">
        Text
      </a>
      <a href={`tel:${tel}`} className="vx-cta vx-alt">
        Call
      </a>
    </div>
  );
}

const APP = (process.env.NEXT_PUBLIC_APP_URL || "https://app.jslandscapingmd.com").replace(/\/$/, "");

/** A text to the client with their estimate's link, ready to send from the phone. */
function estimateText(file: ClientFile, token: string) {
  const tel = (file.phone ?? "").replace(/[^\d+]/g, "");
  const first = file.name.trim().split(/\s+/)[0] || "there";
  const body = `Hi ${first}, here is your estimate from JS Landscaping: ${APP}/prep/${token}/estimate`;
  return `sms:${tel}?&body=${encodeURIComponent(body)}`;
}

function JobCard({ job, file }: { job: FileJob; file: ClientFile }) {
  const p = job.proposal;
  const est = job.estimate;
  const open = job.invoices.filter((i) => i.status === "open");
  return (
    <div className="vx-card">
      <Row a={job.name} b={JOB_STATUS[job.status] ?? job.status} />
      {job.address && <div className="vx-sm">{job.address}</div>}
      <Contact file={file} />

      <Sub title="Messages" sum={job.messages.length}>
        {job.messages.length ? job.messages.slice(0, 8).map((m, i) => <Row key={i} a={`${day(m.at)} · ${m.fromClient ? "them" : "us"}`} b={`"${m.body.length > 80 ? `${m.body.slice(0, 80)}…` : m.body}"`} />) : <Row a="No messages yet" />}
      </Sub>

      <Sub title="Proposals" sum={(p ? 1 : 0) + (est?.total != null ? 1 : 0)}>
        {est?.total != null && (
          <Row
            a={`Estimate · ${money(est.total)}`}
            b={est.paidAt ? (est.choice === "evaluation" ? "Paid for a visit" : "Deposit paid") : "Not paid yet"}
            href={est.token ? `/prep/${est.token}/estimate` : undefined}
          />
        )}
        {est?.total != null && est.token && file.phone && !file.doNotContact && !est.paidAt && (
          <a href={estimateText(file, est.token)} className="vx-cta vx-alt">
            Text them this estimate
          </a>
        )}
        {job.status !== "completed" && job.status !== "cancelled" && !est?.paidAt && (
          <EstimateButton jobId={job.id} label={est?.total != null ? "Change it on the map" : "Price it on the map"} />
        )}
        {p ? (
          <>
            <Row a={`${p.sentAt ? `${day(p.sentAt)} · ` : ""}${money(p.total)}`} b={PROPOSAL[p.status] ?? p.status} href={`/proposal/${p.token}`} />
            {(p.status === "needs_approval" || (p.status === "sent" && !p.respondedAt)) && <ProposalButtons jobId={job.id} status={p.status} />}
            {(p.status === "needs_approval" || (p.status === "sent" && !p.respondedAt)) && <AddonEditor jobId={job.id} addons={p.addons} />}
            {p.status === "accepted" &&
              p.addons.filter((a) => a.chosen).map((a) => <Row key={a.key} a={`Added: ${a.name}`} b={money(a.priceCents / 100)} />)}
          </>
        ) : (
          !est?.total && <Row a="No proposal yet" />
        )}
      </Sub>

      <Sub title="Crew map" sum="No login">
        <Row a="Open the crew map" b="Copy its link to text the crew" href={crewPath(job.id)} />
      </Sub>

      <Sub title="Invoices" sum={open.length ? `${open.length} · ${money(open.reduce((s, i) => s + i.amount, 0))}` : job.invoices.length}>
        {job.invoices.length ? (
          job.invoices.map((i) => <Row key={i.id} a={`${i.sentAt ? `${day(i.sentAt)} · ` : ""}${money(i.amount)}`} b={i.status === "paid" && i.paidAt ? `Paid ${day(i.paidAt)}` : INVOICE[i.status] ?? i.status} href={i.url ?? undefined} />)
        ) : (
          <Row a="No invoices yet" />
        )}
      </Sub>

      <Sub title="Schedule" sum="">
        {job.evaluationDate && <Row a="Visit" b={`${dayTime(job.evaluationDate)}${job.evaluationStatus === "completed" ? " · done" : ""}`} />}
        {job.startDate ? <Row a="Work" b={`${dateOnly(job.startDate)}${job.endDate && job.endDate !== job.startDate ? ` to ${dateOnly(job.endDate)}` : ""}`} /> : <Row a="Work" b="Not scheduled" />}
        {job.completedAt && <Row a="Finished" b={day(job.completedAt)} />}
      </Sub>

      <Sub title="Site map" sum="">
        {job.address ? <Row a="Open in maps" b="›" href={`https://maps.apple.com/?q=${encodeURIComponent(job.address)}`} /> : <Row a="No address" />}
      </Sub>
    </div>
  );
}
