"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { signClientOut } from "@/lib/actions/client-auth-actions";

/** Leave. Small and quiet: nobody comes here to sign out. */
export function SignOutLink() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await signClientOut();
          router.replace("/my");
          router.refresh();
        })
      }
      className="shrink-0 text-xs text-muted-foreground underline"
    >
      Sign out
    </button>
  );
}
