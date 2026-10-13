import type { SupabaseClient } from "@supabase/supabase-js";
import { CheckCircle2, MapPin } from "lucide-react";

import { isSupabaseAdminConfigured } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { dayOnly, timeOnly } from "@/lib/time-zone";
import { PRODUCT_LABEL, type SaltProduct } from "@/lib/snow/application";
import { SNOW_PHOTO_BUCKET } from "@/lib/data/snow-ops";

/**
 * Proof of service, for the client. No login: the link in their text or on
 * their invoice carries a long random token, and that token opens this one
 * stop and nothing else.
 *
 * The first question on any snow bill is "did you actually come", and this
 * page is the answer: when, what went down, and the photos. The GPS point is
 * recorded but not shown, because "the phone was here" is the office's proof
 * and a map pin on a public page is more than a client needs.
 */
export const dynamic = "force-dynamic";

const SERVICE_LABEL: Record<string, string> = {
  pretreat: "Pre-treated before the storm",
  salt: "Salted",
  plow: "Plowed",
  plow_and_salt: "Plowed and salted",
};

export default async function ServicedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseAdminConfigured || !/^[a-f0-9]{24,64}$/.test(token)) return <NotFound />;

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data } = await admin
    .from("snow_event_stops")
    .select("name, address, status, serviced_at, service, product, salt_lbs, surface_temp_f, depth_in, pushes, photo_paths, gps_lat, organizations(name)")
    .eq("proof_token", token)
    .maybeSingle();
  const stop = data as {
    name: string;
    address: string;
    status: string;
    serviced_at: string | null;
    service: string | null;
    product: SaltProduct | null;
    salt_lbs: number | null;
    surface_temp_f: number | null;
    depth_in: number | null;
    pushes: number;
    photo_paths: string[] | null;
    gps_lat: number | null;
    organizations: { name: string } | null;
  } | null;
  if (!stop || stop.status !== "done" || !stop.serviced_at) return <NotFound />;

  const paths = stop.photo_paths ?? [];
  const { data: signed } = paths.length
    ? await admin.storage.from(SNOW_PHOTO_BUCKET).createSignedUrls(paths, 60 * 60)
    : { data: [] as { signedUrl: string | null }[] };
  const photos = (signed ?? []).map((s) => s.signedUrl).filter((u): u is string => Boolean(u));
  const business = stop.organizations?.name ?? "JS Landscaping";

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        <h1 className="text-xl font-semibold">Your property was serviced at {timeOnly(stop.serviced_at)}</h1>
        <p className="text-sm text-muted-foreground">
          {dayOnly(stop.serviced_at)} · {stop.address}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 rounded-xl border bg-card p-4 text-sm">
        {stop.service && (
          <>
            <dt className="text-muted-foreground">What we did</dt>
            <dd>{SERVICE_LABEL[stop.service] ?? stop.service}</dd>
          </>
        )}
        {stop.product && stop.product !== "none" && (
          <>
            <dt className="text-muted-foreground">Product</dt>
            <dd>
              {PRODUCT_LABEL[stop.product]}
              {stop.salt_lbs ? `, ${stop.salt_lbs} lb` : ""}
            </dd>
          </>
        )}
        {stop.pushes > 0 && (
          <>
            <dt className="text-muted-foreground">Plow passes</dt>
            <dd>{stop.pushes}</dd>
          </>
        )}
        {stop.depth_in != null && (
          <>
            <dt className="text-muted-foreground">Snow on the ground</dt>
            <dd>{stop.depth_in} in</dd>
          </>
        )}
        {stop.surface_temp_f != null && (
          <>
            <dt className="text-muted-foreground">Pavement temperature</dt>
            <dd>{stop.surface_temp_f}°F</dd>
          </>
        )}
      </dl>

      {stop.gps_lat != null && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="h-4 w-4" /> The crew&apos;s location was recorded when this was logged.
        </p>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {photos.map((url, i) => (
            // Signed, short-lived URLs from storage: next/image would need the
            // storage host configured and adds nothing for two photos.
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={url} alt={`Photo ${i + 1} of the service`} className="aspect-square w-full rounded-lg object-cover" />
          ))}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">{business}</p>
    </main>
  );
}

function NotFound() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16 text-center">
      <h1 className="text-lg font-semibold">This link isn&apos;t working</h1>
      <p className="mt-2 text-sm text-muted-foreground">It may have been typed wrong. Reply to the text you got and we&apos;ll send it again.</p>
    </main>
  );
}
