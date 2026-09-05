import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { JOURNEY_TEMPLATES } from "./definitions";

/**
 * Keeps code-managed journeys lined up with the app they describe: which
 * steps exist, their order, and how they connect always follow
 * definitions.ts. Numbers an admin has already entered (clicks, time,
 * comms, notes) are left alone on an existing step; a step removed from
 * the code definition is deleted here too, so nothing fictional lingers
 * once the app changes. Runs on every admin visit to the dashboard — cheap
 * enough for a low-traffic admin page.
 */
export async function syncCodeManagedJourneys(): Promise<void> {
  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();

  for (const template of JOURNEY_TEMPLATES) {
    const { data: existingJourney } = await supabase
      .from("journeys")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("role_key", template.roleKey)
      .maybeSingle();

    let journeyId = existingJourney?.id as string | undefined;
    if (!journeyId) {
      const { data: created, error } = await supabase
        .from("journeys")
        .insert({ organization_id: organizationId, role_key: template.roleKey, name: template.name, description: template.description })
        .select("id")
        .single();
      if (error) throw error;
      journeyId = created.id;
    } else {
      await supabase
        .from("journeys")
        .update({ name: template.name, description: template.description })
        .eq("id", journeyId);
    }

    const { data: existingSteps } = await supabase
      .from("journey_steps")
      .select("id, step_key")
      .eq("journey_id", journeyId);
    const existingByKey = new Map((existingSteps ?? []).map((s) => [s.step_key, s.id] as const));
    const codeKeys = new Set(template.steps.map((s) => s.stepKey));

    await Promise.all(
      template.steps.map((step) => {
        const structural = {
          order_index: step.order,
          label: step.label,
          step_type: step.stepType,
          role_label: step.roleLabel ?? null,
          inputs: step.inputs ?? [],
          outputs: step.outputs ?? [],
          automations: step.automations ?? [],
          next_steps: step.nextSteps ?? [],
          is_built: true,
        };
        const existingId = existingByKey.get(step.stepKey);
        if (existingId) {
          // Structure follows code; leave the admin's own numbers/notes as-is.
          return supabase.from("journey_steps").update(structural).eq("id", existingId);
        }
        return supabase.from("journey_steps").insert({
          journey_id: journeyId,
          step_key: step.stepKey,
          ...structural,
          clicks: step.clicks ?? 0,
          manual_inputs: step.manualInputs ?? 0,
          customer_comms: step.customerComms ?? 0,
          internal_comms: step.internalComms ?? 0,
          texts: step.texts ?? 0,
          emails: step.emails ?? 0,
          calls: step.calls ?? 0,
          est_minutes: step.estMinutes ?? null,
          notes: step.notes ?? null,
        });
      })
    );

    const staleIds = (existingSteps ?? []).filter((s) => !codeKeys.has(s.step_key)).map((s) => s.id);
    if (staleIds.length > 0) {
      await supabase.from("journey_steps").delete().in("id", staleIds);
    }
  }
}
