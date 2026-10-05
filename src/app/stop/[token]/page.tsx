import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { stopCompany } from "@/lib/data/pm-sender";

/**
 * Where "Don't want to hear from us?" lands. No sign-in. It asks before it
 * acts, because mail scanners open every link in an email.
 */
export const dynamic = "force-dynamic";

async function unsubscribe(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  if (!isSupabaseAdminConfigured || !/^[0-9a-f]{32}$/.test(token)) return;
  const admin = createAdminClient();
  const { data: company } = await admin.from("pm_companies").select("id").eq("unsubscribe_token", token).maybeSingle();
  if (company) await stopCompany(admin, company.id, "unsubscribed");
}

export default async function StopPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  let stopped = Boolean(done);
  if (!stopped && isSupabaseAdminConfigured && /^[0-9a-f]{32}$/.test(token)) {
    const { data } = await createAdminClient().from("pm_companies").select("status").eq("unsubscribe_token", token).maybeSingle();
    stopped = data?.status === "unsubscribed";
  }
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">JS Landscaping MD</h1>
      {stopped ? (
        <p className="mt-4 text-sm">Done. You won&apos;t get any more emails from us.</p>
      ) : (
        <form
          action={async (formData) => {
            "use server";
            await unsubscribe(formData);
            const { redirect } = await import("next/navigation");
            redirect(`/stop/${token}?done=1`);
          }}
          className="mt-4 flex flex-col items-center gap-3"
        >
          <p className="text-sm">Stop getting emails from us?</p>
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white">
            Yes, stop the emails
          </button>
        </form>
      )}
    </main>
  );
}
