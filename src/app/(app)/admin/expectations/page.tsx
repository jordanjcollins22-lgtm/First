import { requireTab } from "@/lib/data/access";
import { EVALUATOR_BRIEFING, EXPECTATIONS } from "@/lib/expectations";
import { PROPOSAL_TERMS } from "@/lib/proposal-terms";

/**
 * What every evaluator says on the walk round, and why.
 *
 * The complaint this exists to prevent is almost never about quality. It is
 * about time. Somebody looks at a photograph of a finished garden, agrees a
 * price, and stands on their lawn a fortnight later wondering why it does not
 * look like the photograph. It does not, because the photograph is of a garden
 * in its third season and theirs is in its second week.
 *
 * That is not a thing you can fix afterwards. Said first, it is how planting
 * works. Said after somebody has complained, it is an excuse, and it will be
 * heard as one however true it is. So it belongs in the evaluation, out loud,
 * before any numbers are discussed.
 *
 * The second half of the page is the same content the client gets in writing
 * on their proposal, shown here so an evaluator can see exactly what they are
 * being asked to say and what the client will read afterwards. Two versions of
 * one promise is how a business ends up arguing with its own paperwork.
 */
export const dynamic = "force-dynamic";

export default async function ExpectationsPage() {
  await requireTab("expectations", "/more");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Setting Expectations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We work with living things and with the weather, and neither finishes on the day we
          leave. Almost every complaint this business gets is somebody comparing a two week old
          lawn to a photograph of a three year old one. This is how to head that off, on the walk
          round, before anybody talks about price.
        </p>
      </header>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">On the walk round</h2>
          <p className="text-sm text-muted-foreground">
            Eight things to cover, in roughly this order. The words in quotes are close to what to
            actually say, because an evaluator handed a policy improvises around it and one handed
            a sentence uses the sentence.
          </p>
        </div>

        <ol className="space-y-3">
          {EVALUATOR_BRIEFING.map((point, index) => (
            <li key={point.heading} className="rounded-lg border border-border p-3">
              <div className="flex gap-2">
                <span className="text-sm font-semibold text-muted-foreground tabular-nums">
                  {index + 1}.
                </span>
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold">{point.heading}</p>
                  <p className="text-sm text-muted-foreground">{point.why}</p>
                  <blockquote className="border-l-2 border-primary/50 pl-3 text-sm italic">
                    &ldquo;{point.say}&rdquo;
                  </blockquote>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">What the client reads afterwards</h2>
          <p className="text-sm text-muted-foreground">
            These go on the proposal automatically, and only the ones that match the work on it.
            A job with no seeding on it says nothing about germination. Know what is on there, so
            what you say on the day and what they read that evening are the same promise.
          </p>
        </div>

        <ul className="divide-y divide-border rounded-lg border border-border">
          {EXPECTATIONS.map((item) => (
            <li key={item.heading} className="space-y-1 p-3">
              <p className="text-sm font-semibold">{item.heading}</p>
              <p className="text-sm text-muted-foreground">{item.body}</p>
              <p className="text-xs font-medium">{item.timeframe}</p>
              {item.theirPart && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Their part: </span>
                  {item.theirPart}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">The terms on every proposal</h2>
          <p className="text-sm text-muted-foreground">
            Shown to every client above the accept button, whatever the work is.
          </p>
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {PROPOSAL_TERMS.map((term) => (
            <li key={term.heading} className="space-y-1 p-3">
              <p className="text-sm font-semibold">{term.heading}</p>
              <p className="text-sm text-muted-foreground">{term.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
        The one that matters most is the last of the eight. The point is not that you said it, it
        is that they understood it, and the only way to know is to hear them say it back.
      </p>
    </div>
  );
}
