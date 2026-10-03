import Link from "next/link";
import { notFound } from "next/navigation";

import { FlyerPrintRun } from "@/components/eddm/flyer-print-run";
import { requireAnyTab } from "@/lib/data/access";
import { getEddmMailing } from "@/lib/data/eddm";
import { getFlyerToPrint, getPrintSupplies } from "@/lib/data/flyer-print";

/**
 * Printing one EDDM mailing's flyers: the paper to set aside, the printer
 * settings, and a button per tray that sends exactly that tray's flyers.
 */
export default async function EddmPrintPage({ params }: { params: Promise<{ mailingId: string }> }) {
  await requireAnyTab(["project-data"], "/attractors");
  const { mailingId } = await params;
  const [mailing, flyer, supplies] = await Promise.all([getEddmMailing(mailingId), getFlyerToPrint(), getPrintSupplies()]);
  if (!mailing) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-bold">Print the flyers</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {mailing.name} · {mailing.pieces.toLocaleString()} flyers ·{" "}
        <Link href={`/eddm/mailings/${mailing.id}/order`} className="underline">
          order package
        </Link>
      </p>
      <FlyerPrintRun mailingId={mailing.id} pieces={mailing.pieces} paper={supplies.paper} printer={supplies.printer} runName={flyer.runName} />
    </div>
  );
}
