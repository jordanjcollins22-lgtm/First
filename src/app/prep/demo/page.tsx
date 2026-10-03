import { DemoForm } from "./demo-form";

/**
 * The pre-evaluation form as a client sees it, for the owner to click
 * through. Nothing on it is saved: no job, no answers, no photos. An
 * address can be put in first, marked as not part of the form, so the
 * property question shows a real lot.
 */
export default function PrepDemoPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pt-4">
      <DemoForm />
    </main>
  );
}
