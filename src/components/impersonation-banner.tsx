import { stopImpersonation } from "@/lib/actions/impersonation-actions";

export function ImpersonationBanner({ name }: { name: string }) {
  return (
    <div className="flex items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-sm font-medium text-amber-950">
      <span>Viewing as {name}</span>
      <form action={stopImpersonation}>
        <button type="submit" className="underline underline-offset-2 hover:no-underline">
          Return to admin
        </button>
      </form>
    </div>
  );
}
