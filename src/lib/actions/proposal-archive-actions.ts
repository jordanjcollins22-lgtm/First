"use server";

import { randomBytes } from "crypto";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import {
  ACCEPTED_TYPES,
  extensionFor,
  isOutcome,
  MAX_FILE_BYTES,
} from "@/lib/proposal-archive";

export type ArchiveResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

/**
 * A place to put the file, before the file goes anywhere.
 *
 * The browser uploads straight to storage with a short-lived signed URL and
 * only the path comes back through an action. Server Actions carry a one
 * megabyte body, and a scanned quote is several — sending the file through
 * the app would fail on exactly the documents somebody most wants to keep.
 */
export async function createArchiveUpload(input: {
  customerId: string;
  fileType: string;
  fileSize: number;
}): Promise<ArchiveResult<{ path: string; token: string }>> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Not signed in." };
    if (!ACCEPTED_TYPES.includes(input.fileType)) {
      return { ok: false, message: "That needs to be a PDF, a PNG or a JPG." };
    }
    if (input.fileSize > MAX_FILE_BYTES) {
      return { ok: false, message: "That file is too big to store." };
    }

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();

    const path = `${organizationId}/${input.customerId}/${randomBytes(16).toString("hex")}.${extensionFor(input.fileType)}`;
    const { data, error } = await supabase.storage
      .from("proposal-archive")
      .createSignedUploadUrl(path);
    if (error || !data) {
      return { ok: false, message: error?.message ?? "Couldn't get a place to put that." };
    }

    return { ok: true, path, token: data.token };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't do that." };
  }
}

/**
 * Records the quote once its file is up.
 *
 * The outcome is required. A pile of PDFs with nothing said about them is a
 * filing cabinet; the reason to carry these across at all is that each one
 * says whether we got the work.
 */
export async function saveArchivedProposal(input: {
  customerId: string;
  filePath: string;
  fileName: string;
  outcome: string;
  jobDate?: string;
  title?: string;
  amount?: string;
  notes?: string;
}): Promise<ArchiveResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };
    if (!isOutcome(input.outcome)) {
      return { ok: false, message: "Say whether we got this one." };
    }

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();

    const amount = input.amount ? Number(input.amount.replace(/[^0-9.]/g, "")) : null;

    const { error } = await supabase.from("archived_proposals").insert({
      organization_id: organizationId,
      customer_id: input.customerId,
      file_path: input.filePath,
      file_name: input.fileName,
      outcome: input.outcome,
      job_date: input.jobDate?.trim() || null,
      title: input.title?.trim() || null,
      amount: amount != null && Number.isFinite(amount) ? amount : null,
      notes: input.notes?.trim() || null,
      created_by: profile.id,
    });
    if (error) return { ok: false, message: error.message };

    revalidatePath(`/clients/${input.customerId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't save that." };
  }
}

/** Correcting an outcome or a date after the fact, which is most of them:
 * these are being typed in from memory while looking at an old file. */
export async function updateArchivedProposal(
  id: string,
  customerId: string,
  patch: { outcome?: string; jobDate?: string; title?: string; amount?: string; notes?: string }
): Promise<ArchiveResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Not signed in." };
    if (patch.outcome !== undefined && !isOutcome(patch.outcome)) {
      return { ok: false, message: "That isn't one of the three." };
    }

    const supabase = await createClient();
    const amount = patch.amount ? Number(patch.amount.replace(/[^0-9.]/g, "")) : undefined;

    const { error } = await supabase
      .from("archived_proposals")
      .update({
        ...(patch.outcome !== undefined ? { outcome: patch.outcome } : {}),
        ...(patch.jobDate !== undefined ? { job_date: patch.jobDate.trim() || null } : {}),
        ...(patch.title !== undefined ? { title: patch.title.trim() || null } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes.trim() || null } : {}),
        ...(amount !== undefined ? { amount: Number.isFinite(amount) ? amount : null } : {}),
      })
      .eq("id", id);
    if (error) return { ok: false, message: error.message };

    revalidatePath(`/clients/${customerId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't save that." };
  }
}

/**
 * A link to read the file, good for a few minutes.
 *
 * The bucket is private on purpose: these carry a client's name, address and
 * what they were charged, and a public URL is a filing cabinet anybody with
 * the address can read. So the link is minted per view for somebody signed in.
 */
export async function archiveFileLink(filePath: string): Promise<ArchiveResult<{ url: string }>> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Not signed in." };

    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from("proposal-archive")
      .createSignedUrl(filePath, 300);
    if (error || !data) return { ok: false, message: error?.message ?? "Couldn't open that." };

    return { ok: true, url: data.signedUrl };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't open that." };
  }
}

export async function deleteArchivedProposal(
  id: string,
  customerId: string,
  filePath: string
): Promise<ArchiveResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Not signed in." };

    const supabase = await createClient();
    const { error } = await supabase.from("archived_proposals").delete().eq("id", id);
    if (error) return { ok: false, message: error.message };

    // The row is the record; a file left behind is invisible clutter rather
    // than a problem, so a failure here is not worth failing the delete over.
    try {
      await supabase.storage.from("proposal-archive").remove([filePath]);
    } catch {
      // Left where it is.
    }

    revalidatePath(`/clients/${customerId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't delete that." };
  }
}
