import { createClient } from "@/lib/supabase/server";
import { readShirtLine, type ShirtLine, type ShirtOrderStatus } from "@/lib/shirts";

export interface ShirtOrder {
  id: string;
  status: ShirtOrderStatus;
  lines: ShirtLine[];
  note: string | null;
  printerNote: string | null;
  by: string | null;
  createdAt: string;
  orderedAt: string | null;
  receivedAt: string | null;
}

type Row = {
  id: string;
  status: string;
  lines: unknown;
  note: string | null;
  printer_note: string | null;
  created_at: string;
  ordered_at: string | null;
  received_at: string | null;
  creator: { full_name: string | null; email: string } | null;
};

const COLUMNS = "id, status, lines, note, printer_note, created_at, ordered_at, received_at, creator:profiles!shirt_orders_created_by_fkey(full_name, email)";

function toOrder(r: Row): ShirtOrder {
  return {
    id: r.id,
    status: r.status as ShirtOrderStatus,
    lines: (Array.isArray(r.lines) ? r.lines : []).map(readShirtLine).filter((l): l is ShirtLine => l != null),
    note: r.note,
    printerNote: r.printer_note,
    by: r.creator?.full_name || r.creator?.email || null,
    createdAt: r.created_at,
    orderedAt: r.ordered_at,
    receivedAt: r.received_at,
  };
}

/** Every shirt order, newest first. Null when the table isn't there yet (migration 0338). */
export async function listShirtOrders(): Promise<ShirtOrder[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("shirt_orders").select(COLUMNS).order("created_at", { ascending: false }).limit(100);
  if (error) return null;
  return ((data ?? []) as unknown as Row[]).map(toOrder);
}

export async function getShirtOrder(id: string): Promise<ShirtOrder | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("shirt_orders").select(COLUMNS).eq("id", id).maybeSingle();
  return data ? toOrder(data as unknown as Row) : null;
}
