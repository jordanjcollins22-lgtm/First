"use server";

import { redirect } from "next/navigation";

import { normalizePhone } from "@/lib/check-ins/phone";
import { addOns, isVehicleSize, membershipPrices } from "@/lib/detailing";
import { isGhlConfigured } from "@/lib/env";
import { upsertDetailingLeadContact } from "@/lib/ghl/client";
import { createAdminClient } from "@/lib/supabase/admin";

export interface LeadFormState {
  error?: string;
  values?: { vehicle: string; name: string; phone: string; email: string; address: string };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Step 1: save who they are and where the car will be, then go to the plan page. */
export async function createDetailingLead(_prev: LeadFormState, formData: FormData): Promise<LeadFormState> {
  const values = {
    vehicle: String(formData.get("vehicle_size") ?? ""),
    name: String(formData.get("name") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim(),
  };

  if (!isVehicleSize(values.vehicle)) return { error: "Pick what we're detailing.", values };
  if (!values.name) return { error: "Please enter your name.", values };
  const phone = normalizePhone(values.phone);
  if (!phone) return { error: "Enter a valid phone number, e.g. (443) 555-0123.", values };
  if (!EMAIL_RE.test(values.email)) return { error: "Enter a valid email address.", values };
  if (values.address.length < 5) return { error: "Enter the address where your car will be.", values };

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("detailing_leads")
    .insert({
      name: values.name,
      phone,
      email: values.email.toLowerCase(),
      service_address: values.address,
      vehicle_size: values.vehicle,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[detailing] lead insert failed", error);
    return { error: "Something went wrong saving your info. Please try again or call 443-528-0896.", values };
  }

  // Best-effort: put the lead in GoHighLevel too. The lead is already saved, so
  // a GHL outage never blocks the customer.
  if (isGhlConfigured()) {
    try {
      const contactId = await upsertDetailingLeadContact({
        name: values.name,
        phone,
        email: values.email,
        address: values.address,
        tags: ["apex-shine-lead"],
      });
      await supabase.from("detailing_leads").update({ ghl_contact_id: contactId }).eq("id", data.id);
    } catch (err) {
      console.error("[detailing] GHL contact upsert failed", err);
    }
  }

  redirect(`/detailing/start/plan?lead=${data.id}`);
}

/**
 * Step 2: record the membership request with the vehicle and add-ons they
 * picked. Boats and RVs have no set price, so monthly_price stays null and the
 * request is a quote request.
 */
export async function requestMembership(formData: FormData) {
  const leadId = String(formData.get("lead") ?? "");
  if (!UUID_RE.test(leadId)) redirect("/detailing/start");

  const size = formData.get("vehicle_size");
  if (!isVehicleSize(size)) redirect(`/detailing/start/plan?lead=${leadId}`);
  const plan = membershipPrices[size];

  // Prices come from the server-side config, never from the form.
  const picked = addOns.filter((a) => formData.getAll("add_ons").includes(a.id));

  const supabase = createAdminClient();
  const { data: lead, error } = await supabase
    .from("detailing_leads")
    .update({
      status: "membership_requested",
      vehicle_size: size,
      monthly_price: plan.price,
      add_ons: picked.map((a) => a.id),
      add_ons_total: picked.reduce((sum, a) => sum + a.price, 0),
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)
    .select("name, phone, email, service_address, ghl_contact_id")
    .single();
  if (error || !lead) {
    console.error("[detailing] membership request failed", error);
    redirect("/detailing/start");
  }

  if (isGhlConfigured()) {
    try {
      await upsertDetailingLeadContact({
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        address: lead.service_address,
        tags: ["apex-shine-lead", "complete-care-requested"],
      });
    } catch (err) {
      console.error("[detailing] GHL tag update failed", err);
    }
  }

  redirect(`/detailing/start/done?lead=${leadId}`);
}
