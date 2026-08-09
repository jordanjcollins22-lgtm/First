export function SetupRequiredNotice() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-muted-foreground">
        Supabase is not configured yet — copy <code>.env.example</code> to{" "}
        <code>.env.local</code> and add your Supabase project credentials to see
        this page.
      </p>
    </div>
  );
}
