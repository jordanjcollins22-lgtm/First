import type { MhicBlock } from "@/lib/data/mhic-contract";

/**
 * The Maryland home-improvement contract wording, on a proposal for work
 * that needs it: planting, beds, grading, stone, irrigation. Sits with the
 * terms, above the Accept button, because the client is agreeing to it by
 * accepting. Exempt work (mowing, cleanups, snow) never shows it.
 */
export function MhicContractBlock({ block }: { block: MhicBlock }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/30 p-4" aria-labelledby="mhic-heading">
      <h2 id="mhic-heading" className="text-lg font-semibold">
        Maryland home improvement contract
      </h2>
      <ul className="flex flex-col gap-3">
        {block.clauses.map((clause) => (
          <li key={clause.heading}>
            <p className="text-sm font-semibold">{clause.heading}</p>
            <p className="text-sm text-muted-foreground">{clause.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
