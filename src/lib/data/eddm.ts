import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import type { MailingRates, MailingRoute } from "@/lib/eddm-mailing";

/** A mailing as the screen and the order package read it. */
export interface EddmMailing {
  id: string;
  name: string;
  audience: "residential" | "all";
  routes: MailingRoute[];
  pieces: number;
  postagePerPiece: number | null;
  printCostPerPiece: number;
  postageCents: number;
  printCostCents: number;
  dropFacilities: string[];
  status: string;
  mailedOn: string | null;
  waveId: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  name: string;
  audience: string;
  routes: unknown;
  pieces: number;
  postage_per_piece: number | string | null;
  print_cost_per_piece: number | string;
  postage_cents: number;
  print_cost_cents: number;
  drop_facilities: unknown;
  status: string;
  mailed_on: string | null;
  wave_id: string | null;
  created_at: string;
}

function toMailing(row: Row): EddmMailing {
  return {
    id: row.id,
    name: row.name,
    audience: row.audience === "all" ? "all" : "residential",
    routes: (Array.isArray(row.routes) ? row.routes : []) as MailingRoute[],
    pieces: row.pieces,
    postagePerPiece: row.postage_per_piece == null ? null : Number(row.postage_per_piece),
    printCostPerPiece: Number(row.print_cost_per_piece ?? 0),
    postageCents: row.postage_cents,
    printCostCents: row.print_cost_cents,
    dropFacilities: (Array.isArray(row.drop_facilities) ? row.drop_facilities : []) as string[],
    status: row.status,
    mailedOn: row.mailed_on,
    waveId: row.wave_id,
    createdAt: row.created_at,
  };
}

const COLUMNS =
  "id, name, audience, routes, pieces, postage_per_piece, print_cost_per_piece, postage_cents, print_cost_cents, drop_facilities, status, mailed_on, wave_id, created_at";

/** The rates a mailing is priced at. Postage is null until somebody enters it. */
export async function getEddmRates(): Promise<MailingRates> {
  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("eddm_postage_per_piece, eddm_print_cost_per_piece")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return {
    postagePerPiece: data?.eddm_postage_per_piece == null ? null : Number(data.eddm_postage_per_piece),
    printCostPerPiece: Number(data?.eddm_print_cost_per_piece ?? 0),
  };
}

export async function listEddmMailings(limit = 12): Promise<EddmMailing[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("eddm_mailings")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(toMailing);
}

export async function getEddmMailing(id: string): Promise<EddmMailing | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("eddm_mailings").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toMailing(data as unknown as Row) : null;
}
