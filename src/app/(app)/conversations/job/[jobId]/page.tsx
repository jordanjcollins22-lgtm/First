import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { requireJobAccess } from "@/lib/data/access";
import { listJobMessages } from "@/lib/data/job-messages";
import { getJobCustomerContact } from "@/lib/job-customer";
import { createClient } from "@/lib/supabase/server";
import { isTwilioConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ClientThread } from "@/components/conversations/client-thread";

/**
 * One client's conversation, on its own screen.
 *
 * Opening a conversation used to drop somebody on the job page, where the
 * messages are one panel among fifteen. A conversation is a thing in its own
 * right and reads like one here.
 */
export default async function JobThreadPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { jobId } = await params;
  await requireJobAccess(jobId, ["conversations", "job-detail"]);

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, property_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) notFound();

  const { data: property } = await supabase
    .from("properties")
    .select("address")
    .eq("id", job.property_id)
    .maybeSingle();

  const [contact, external, internal] = await Promise.all([
    getJobCustomerContact(jobId),
    listJobMessages(jobId, "external"),
    listJobMessages(jobId, "internal"),
  ]);

  // Both sides of the conversation in one thread. Keeping them apart is what
  // made somebody read two panels to find out what had been said.
  const messages = [...external, ...internal].map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.created_at,
    fromClient: m.author_type === "client",
    authorName: m.author_name,
    channel: m.channel,
  }));

  return (
    <ClientThread
      jobId={jobId}
      customerName={contact?.customerName ?? ""}
      propertyAddress={property?.address ?? ""}
      customerId={contact?.customerId ?? null}
      phone={contact?.phone ?? null}
      email={contact?.email ?? null}
      smsReady={isTwilioConfigured}
      messages={messages}
    />
  );
}
