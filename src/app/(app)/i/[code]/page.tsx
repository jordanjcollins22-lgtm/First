import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { getScannedItem } from "@/lib/data/inventory-tracking";
import { normaliseCode } from "@/lib/inventory-codes";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ScanBoard } from "@/components/inventory/scan-board";

/**
 * The page a sticker opens.
 *
 * The code is folded on the way in, so a hand-typed O is the same as a Q and
 * a 1 is the same as a 7 — somebody reading a scuffed label out loud should
 * still land on the right thing.
 */
export default async function ScanPage({ params }: { params: Promise<{ code: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { code } = await params;
  const normalised = normaliseCode(code);

  const [profile, item] = await Promise.all([
    getCurrentProfile().catch(() => null),
    getScannedItem(normalised).catch(() => null),
  ]);

  if (!item) {
    return (
      <div className="mx-auto max-w-md px-4 py-6">
        <h1 className="mb-1 text-2xl font-bold">Nothing on {normalised}</h1>
        <p className="text-sm text-muted-foreground">
          That code isn&apos;t on anything yet. Print labels from{" "}
          <Link href="/admin/labels" className="underline">
            Labels &amp; Codes
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <ScanBoard
      code={item.code.code}
      name={item.name}
      unit={item.unit}
      kind={item.kind}
      onHand={item.onHand}
      reorderThreshold={item.reorderThreshold}
      movements={item.movements}
      expectedQuantity={item.code.expectedQuantity}
      signedIn={Boolean(profile)}
    />
  );
}
