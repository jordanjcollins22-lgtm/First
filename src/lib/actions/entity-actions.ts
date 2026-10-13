"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { ENTITY_HANDLERS } from "@/lib/entities/registry";
import type { ActionResult, EntityContext, EntityRef, EntityView } from "@/lib/entities/types";
import { getRealProfile } from "@/lib/data/team";
import { log } from "@/lib/log";
import { isOwnerLevel } from "@/lib/roles";
import { v2RolesOf } from "@/lib/v2-roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Opening and acting on anything listed in the new layout, checked against
 * the account actually signed in: the owner for everything, an account
 * manager for their own kinds of thing.
 */
/**
 * What an account manager may open and act on: their clients, jobs, sales
 * and invoices. Pay, roles, commissions, integrations and settings stay the
 * owner's.
 */
const ACCOUNT_MANAGER_KINDS = /^(sales\.(?!service$|evaluator$)|admin\.(customer|invoice|job|job_issue|payment|work_day|message|coi)$|ops\.(job|work_day|issue|exception|client|walkthrough|review)$)/;

/**
 * Buttons inside a drawer an account manager may open but not press: held
 * emails are released by the owner, job costs and job stops are the owner's
 * call. They are taken off the drawer, not left there to be refused.
 */
const OWNER_ONLY_ACTIONS: Record<string, string[]> = {
  "sales.approval": ["send", "decline"],
  "admin.job": ["recompute_cost"],
  "ops.job": ["recost"],
  "ops.issue": ["blocking"],
  // Moving payments is admin-only in the action itself.
  "admin.payment": ["detach"],
};

const ownerOnly = (kind: string, action: string) => OWNER_ONLY_ACTIONS[kind]?.includes(action) ?? false;

async function context(kind: string): Promise<(EntityContext & { isOwner: boolean }) | null> {
  const me = await getRealProfile();
  if (!me) return null;
  const allowed = isOwnerLevel(me.roles) || (v2RolesOf(me).includes("account-manager") && ACCOUNT_MANAGER_KINDS.test(kind));
  if (!allowed) return null;
  return {
    sb: (await createClient()) as unknown as SupabaseClient,
    admin: createAdminClient() as unknown as SupabaseClient,
    organizationId: me.organization_id,
    profileId: me.id,
    isOwner: isOwnerLevel(me.roles),
  };
}

export async function openEntity(ref: EntityRef): Promise<{ ok: true; view: EntityView } | { ok: false; error: string }> {
  const ctx = await context(ref.kind);
  if (!ctx) return { ok: false, error: "That isn't something your role opens." };
  const handler = ENTITY_HANDLERS[ref.kind];
  if (!handler) return { ok: false, error: "This can't be opened yet." };
  try {
    const view = await handler.load(ctx, ref.id);
    if (!view) return { ok: false, error: "It isn't there any more." };
    if (ctx.isOwner) return { ok: true, view };
    const actions = view.actions.filter((a) => !ownerOnly(ref.kind, a.id));
    const hidden = actions.length < view.actions.length;
    // A row that would open something this role can't (a crew member's pay, a
    // purchase order) is shown as plain words rather than a dead end.
    const sections = view.sections?.map((s) => ({
      ...s,
      rows: s.rows.map((r) => (r.ref && !ACCOUNT_MANAGER_KINDS.test(r.ref.kind) ? { text: r.text } : r)),
    }));
    return { ok: true, view: { ...view, sections, actions, note: hidden && !actions.length ? "The owner deals with this one." : view.note } };
  } catch (err) {
    log.error("entity.open_failed", err, { kind: ref.kind });
    return { ok: false, error: "Couldn't load it just now." };
  }
}

export async function runEntityAction(ref: EntityRef, action: string, value?: string): Promise<ActionResult> {
  const ctx = await context(ref.kind);
  if (!ctx || (!ctx.isOwner && ownerOnly(ref.kind, action))) return { ok: false, error: "That isn't something your role can change." };
  const handler = ENTITY_HANDLERS[ref.kind];
  if (!handler?.act) return { ok: false, error: "Nothing can be done to this here." };
  try {
    const result = await handler.act(ctx, ref.id, action, value);
    if (result.ok) revalidatePath("/v2", "layout");
    return result;
  } catch (err) {
    log.error("entity.action_failed", err, { kind: ref.kind, action });
    return { ok: false, error: "That didn't work. Try again." };
  }
}
