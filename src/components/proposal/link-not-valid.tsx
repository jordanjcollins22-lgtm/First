/** The one thing to say when a token matches nothing. Shared so all three
 * steps of the client's journey say it the same way. */
export function LinkNotValid() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <p className="text-lg font-semibold">This proposal link isn&apos;t valid.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Double check the link, or contact us directly.
      </p>
    </div>
  );
}
