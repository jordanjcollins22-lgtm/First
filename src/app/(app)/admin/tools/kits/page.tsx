import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { listKitTools } from "@/lib/data/tools";
import { listKitContainers } from "@/lib/data/kit-containers";
import { kitNumbers, toolsInKit, toolsInNoKit } from "@/lib/kit-sheet";
import { storedInLabel } from "@/lib/kit-containers";
import { PrintPdfButton } from "@/components/print/print-pdf-button";
import { ContainerPanel } from "@/components/kit/container-panel";

/**
 * The kit checklists, and what is on each one.
 *
 * A kit is a set of tools that travels together. The question at the end of a
 * day is always the same — is it all back, and is it back in the right bin —
 * and that gets answered at a van with a pen rather than at a screen.
 *
 * Nothing is stored. The sheets are drawn from the tools table when somebody
 * asks for one, so a tool put in a kit this morning is on the sheet printed
 * this afternoon, and there is no saved copy anywhere to go stale.
 */
export const dynamic = "force-dynamic";

export default async function KitsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("tools", "/my-day");

  const [tools, containers] = await Promise.all([
    listKitTools().catch(() => []),
    listKitContainers().catch(() => []),
  ]);
  const kits = kitNumbers(tools);
  const strays = toolsInNoKit(tools);
  const missingPhoto = tools.filter((tool) => !tool.imagePath).length;
  const missingDescription = tools.filter((tool) => !(tool.description ?? "").trim()).length;
  const missingBin = tools.filter((tool) => !(tool.storageLocation ?? "").trim()).length;
  const kitsWithNoContainer = kitNumbers(tools).filter((kit) => !storedInLabel(containers, kit));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Kit Checklists</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One printed sheet per kit, on 8.5 × 11, with a box to tick beside every tool, a photo of it and
          the bin it goes back to. The sheet names what the kit travels in and lists that thing&apos;s own
          parts, so a cracked crate gets caught at the van. Made fresh each time you print, so a tool
          added to a kit today is on today&apos;s sheet.
        </p>
      </header>

      {kits.length === 0 ? (
        <p className="rounded-lg border border-border bg-card/60 px-3 py-3 text-sm text-muted-foreground">
          No kits yet. Open{" "}
          <Link href="/admin/tools" className="text-primary hover:underline">
            Inventory
          </Link>{" "}
          and tick a kit number on a tool — the kit exists the moment you do.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {kits.map((kit) => {
            const inKit = toolsInKit(tools, kit);
            const storedIn = storedInLabel(containers, kit);
            return (
              <div key={kit} className="rounded-lg border border-border p-3">
                <p className="text-sm font-semibold">Kit {kit}</p>
                <p className="text-xs text-muted-foreground">
                  {inKit.length} tool{inKit.length === 1 ? "" : "s"}
                  {storedIn ? ` · in the ${storedIn}` : ""}
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {inKit.map((tool) => tool.name).join(", ")}
                </p>
                <PrintLinks query={`kit=${kit}`} />
              </div>
            );
          })}
        </div>
      )}

      <ContainerPanel containers={containers} />

      <section className="rounded-lg border border-border p-3">
        <h3 className="text-sm font-semibold">Everything at once</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">
              Every kit, each starting its own sheet so nothing gets ticked against the wrong van.
            </p>
            <PrintLinks query="kit=all" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">
              The whole shop as one checklist, for a stocktake rather than a van.
            </p>
            <PrintLinks query="kit=inventory" />
          </div>
        </div>
      </section>

      {strays.length > 0 && (
        <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <h3 className="text-sm font-semibold">{strays.length} tools are in no kit</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {strays.map((tool) => tool.name).join(", ")}
          </p>
          <PrintLinks query="kit=unassigned" />
        </section>
      )}

      {(missingPhoto > 0 || missingDescription > 0 || missingBin > 0 || kitsWithNoContainer.length > 0) && (
        <section className="rounded-lg border border-border p-3 text-sm">
          <h3 className="font-semibold">What would make the sheets more useful</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {missingPhoto > 0 && (
              <li>
                {missingPhoto} tool{missingPhoto === 1 ? " has" : "s have"} no photo. A name alone means
                somebody has to know what it looks like already.
              </li>
            )}
            {kitsWithNoContainer.length > 0 && (
              <li>
                Kit{kitsWithNoContainer.length === 1 ? " " : "s "}
                {kitsWithNoContainer.join(", ")} {kitsWithNoContainer.length === 1 ? "has" : "have"} no
                container recorded, so the sheet cannot say what the whole lot travels in.
              </li>
            )}
            {missingBin > 0 && (
              <li>
                {missingBin} tool{missingBin === 1 ? " has" : "s have"} no bin set, so the sheet cannot say
                where to put it back — which is half of what it is for.
              </li>
            )}
            {missingDescription > 0 && (
              <li>
                {missingDescription} tool{missingDescription === 1 ? " has" : "s have"} no description of
                what it is for.
              </li>
            )}
          </ul>
          <Link href="/admin/tools" className="mt-2 inline-block text-xs text-primary hover:underline">
            Fill them in on Inventory
          </Link>
        </section>
      )}
    </div>
  );
}

function PrintLinks({ query }: { query: string }) {
  const href = `/admin/tools/kits/pdf?${query}`;
  return (
    <div className="mt-2 flex flex-wrap items-start gap-3">
      {/* Not a plain link. On a phone with the app on the home screen there is
          no browser toolbar, so a PDF opened in a tab has no print button at
          all — this hands the file to the operating system instead. */}
      <PrintPdfButton href={href} fallbackName="kit-checklist.pdf" />
      <a href={`${href}&download=1`} className="mt-1.5 text-xs text-primary hover:underline">
        Save it
      </a>
    </div>
  );
}
