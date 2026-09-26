import { IntakeForm } from "@/components/intake/intake-form";
import { emptyAnswers } from "@/lib/evaluation-intake";

/**
 * The pre-evaluation form as a client sees it, for the owner to click
 * through. Nothing on it is saved: no job, no answers, no photos.
 */
export default function PrepDemoPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pt-4">
      <header className="mb-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Demo · nothing here is saved</p>
        <h1 className="text-lg font-semibold">Before we come out</h1>
        <p className="truncate text-xs text-muted-foreground">123 Example Lane · Tuesday at 10:00 am</p>
      </header>
      <IntakeForm
        token={"0".repeat(24)}
        initial={emptyAnswers()}
        initialPhotos={[]}
        submittedAt={null}
        together={false}
        businessPhone={null}
        greeting="Sarah, a few quick questions, one at a time, so we arrive with ideas instead of guesses. Nothing here is binding."
        demo
      />
    </main>
  );
}
