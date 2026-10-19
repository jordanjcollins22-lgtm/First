import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { cleanAnswers, INTAKE_QUESTIONS, type IntakeAnswers } from "@/lib/evaluation-intake";
import { instantPrice } from "@/lib/instant-price";
import { DEFAULT_PHOTO_QUOTES, readPhotoQuoteSettings, type PhotoQuoteOutcome, type PhotoQuoteSettings } from "@/lib/photo-quote";
import type { LotData } from "@/lib/lot-map";

/**
 * Photo quotes, against the database: the owner's switch and line, the job
 * a later visit should land on, and the list the office prices from.
 *
 * The settings are read on their own rather than with the autopilot's other
 * columns, so the pipeline's automatic pricing keeps working before
 * migration 0369 is applied: a select naming a column that is not there yet
 * fails whole.
 */

// The new columns are newer than the generated types.
const untyped = (c: unknown) => c as SupabaseClient;

export interface StoredPhotoQuotes extends PhotoQuoteSettings {
  /** False until migration 0369 is applied: nothing can be saved, and bookings get visits. */
  ready: boolean;
}

/** The switch and the line, or the defaults (off). Never writes. */
export async function readPhotoQuotes(client: unknown, organizationId: string): Promise<StoredPhotoQuotes> {
  const { data, error } = await untyped(client)
    .from("sales_autopilot_settings")
    .select("photo_quotes, photo_quote_line")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) return { ...DEFAULT_PHOTO_QUOTES, ready: false };
  return { ...readPhotoQuoteSettings(data as { photo_quotes?: boolean; photo_quote_line?: number } | null), ready: true };
}

/**
 * A photo quote on this property still waiting to be priced or visited, so
 * the visit the client books from "Needs a visit" lands on the same job
 * rather than starting a second one. Null when there is none, or before the
 * migration.
 */
export async function waitingPhotoQuoteJob(admin: unknown, propertyId: string): Promise<string | null> {
  const { data, error } = await untyped(admin)
    .from("jobs")
    .select("id, evaluation_date, cancelled_at, created_at, intake:evaluation_intakes!inner(photo_quote, photo_quote_outcome)")
    .eq("property_id", propertyId)
    .is("evaluation_date", null)
    .is("cancelled_at", null)
    .eq("intake.photo_quote", true)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error || !data) return null;
  const rows = data as unknown as { id: string; intake: { photo_quote_outcome: string | null } | { photo_quote_outcome: string | null }[] | null }[];
  const open = rows.find((r) => {
    const intake = Array.isArray(r.intake) ? r.intake[0] : r.intake;
    return intake && intake.photo_quote_outcome !== "priced";
  });
  return open?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* The office's list                                                   */
/* ------------------------------------------------------------------ */

export interface PhotoQuoteArea {
  id: string;
  /** "Area 1". */
  label: string;
  wants: string;
  services: string[];
  noPhotos: boolean;
  photos: string[];
  /** The suggestions they ticked. */
  interested: string[];
  /** The ones they left. */
  passed: string[];
}

export interface PhotoQuoteRow {
  jobId: string;
  intakeId: string;
  clientName: string;
  phone: string | null;
  email: string | null;
  address: string;
  budget: string | null;
  submittedAt: string | null;
  outcome: PhotoQuoteOutcome | null;
  outcomeAt: string | null;
  /** A visit has since been booked on the job. */
  visitAt: string | null;
  areas: PhotoQuoteArea[];
  /** The rough price from the rate card, in cents, or null when it couldn't be worked out. */
  estimateCents: number | null;
  /** Some of the estimate's numbers are typical stand-ins, not the rate card's. */
  estimateTypical: boolean;
  hasProposal: boolean;
}

export interface PhotoQuotesData {
  settings: StoredPhotoQuotes;
  /** Sent in and not decided yet, newest first. */
  waiting: PhotoQuoteRow[];
  /** Decided in the last month, or started and not sent in yet. */
  recent: PhotoQuoteRow[];
  /** Started (job made) but not sent in yet. */
  unsent: number;
}

const SERVICE_LABEL = new Map((INTAKE_QUESTIONS[0].options ?? []).map((o) => [o.value, o.label]));
/** Signed photo links last as long as somebody might look at the screen. */
const PHOTO_URL_SECONDS = 60 * 60;
const MONTH = 30 * 86_400_000;

type IntakeRow = {
  id: string;
  job_id: string;
  answers: unknown;
  submitted_at: string | null;
  photo_quote_outcome: PhotoQuoteOutcome | null;
  photo_quote_outcome_at: string | null;
  job: {
    id: string;
    budget_range: string | null;
    evaluation_date: string | null;
    cancelled_at: string | null;
    property: { address: string | null; parcel: unknown; customer: { name: string | null; phone: string | null; email: string | null } | null } | null;
    proposal: { id: string }[] | { id: string } | null;
  } | null;
};

/**
 * Every photo quote the office has to look at, under the signed-in owner's
 * own row security. Returns an empty list before the migration rather than
 * failing the screen.
 */
export async function loadPhotoQuotes(organizationId: string, now = new Date()): Promise<PhotoQuotesData> {
  const supabase = await createClient();
  const settings = await readPhotoQuotes(supabase, organizationId);
  const empty: PhotoQuotesData = { settings, waiting: [], recent: [], unsent: 0 };
  const { data, error } = await untyped(supabase)
    .from("evaluation_intakes")
    .select(
      "id, job_id, answers, submitted_at, photo_quote_outcome, photo_quote_outcome_at, job:jobs!inner(id, budget_range, evaluation_date, cancelled_at, property:properties(address, parcel, customer:customers(name, phone, email)), proposal:job_proposals(id))"
    )
    .eq("organization_id", organizationId)
    .eq("photo_quote", true)
    .order("created_at", { ascending: false })
    .limit(80);
  if (error || !data) return empty;

  const rows = (data as unknown as IntakeRow[]).filter((r) => r.job && !r.job.cancelled_at);
  const unsent = rows.filter((r) => !r.submitted_at).length;
  const sent = rows.filter((r) => r.submitted_at);
  // Waiting until somebody decides: a proposal written from the site map
  // counts as priced, so pricing it the usual way takes it off the list.
  const proposed = (r: IntakeRow) => Boolean(Array.isArray(r.job?.proposal) ? r.job?.proposal.length : r.job?.proposal);
  const waitingRows = sent.filter((r) => !r.photo_quote_outcome && !proposed(r)).sort((a, b) => (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""));
  const recentRows = sent
    .filter((r) => (r.photo_quote_outcome || proposed(r)) && now.getTime() - new Date(r.photo_quote_outcome_at ?? r.submitted_at ?? 0).getTime() < MONTH)
    .slice(0, 10);
  const shown = [...waitingRows.slice(0, 25), ...recentRows];
  if (shown.length === 0) return { ...empty, unsent };

  const answersOf = new Map(shown.map((r) => [r.id, cleanAnswers(r.answers)]));
  const paths = [...answersOf.values()].flatMap((a) => a.photos);
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage.from("job-photos").createSignedUrls(paths, PHOTO_URL_SECONDS);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }
  const catalog = await getCanvasCatalog().catch(() => null);

  const toRow = (r: IntakeRow): PhotoQuoteRow => {
    const answers = answersOf.get(r.id)!;
    const job = r.job!;
    const lot = (job.property?.parcel ?? null) as LotData | null;
    const estimate = catalog ? estimateFor(answers, lot, catalog) : null;
    const proposal = Array.isArray(job.proposal) ? job.proposal[0] : job.proposal;
    return {
      jobId: job.id,
      intakeId: r.id,
      clientName: job.property?.customer?.name?.trim() || "Unnamed client",
      phone: job.property?.customer?.phone ?? null,
      email: job.property?.customer?.email ?? null,
      address: job.property?.address ?? "",
      budget: job.budget_range,
      submittedAt: r.submitted_at,
      outcome: r.photo_quote_outcome,
      outcomeAt: r.photo_quote_outcome_at,
      visitAt: job.evaluation_date,
      areas: answers.spots.map((spot, i) => ({
        id: spot.id,
        label: `Area ${i + 1}`,
        wants: spot.wants,
        services: spot.services.map((s) => SERVICE_LABEL.get(s) ?? s),
        noPhotos: spot.noPhotos,
        photos: answers.photos.filter((p) => answers.photo_areas[p] === spot.id).flatMap((p) => (signed.get(p) ? [signed.get(p)!] : [])),
        interested: spot.ideas.filter((i) => i.interested).map((i) => i.text),
        passed: spot.ideas.filter((i) => !i.interested).map((i) => i.text),
      })),
      estimateCents: estimate?.totalCents ?? null,
      estimateTypical: estimate?.usesTypical ?? false,
      hasProposal: Boolean(proposal),
    };
  };

  return { settings, waiting: waitingRows.slice(0, 25).map(toRow), recent: recentRows.map(toRow), unsent };
}

/**
 * The instant price for a photo quote: the services ticked across its areas.
 * The areas are pins rather than parts of the yard, so it is sized as the
 * instant price sizes a form that named no part: half the open ground.
 */
function estimateFor(answers: IntakeAnswers, lot: LotData | null, catalog: Parameters<typeof instantPrice>[2]) {
  const services = [...new Set([...answers.services, ...answers.spots.flatMap((s) => s.services)])];
  if (services.length === 0) return null;
  try {
    const price = instantPrice({ ...answers, services }, lot, catalog);
    return price.totalCents > 0 ? price : null;
  } catch {
    return null;
  }
}
