import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { listBusinessLocations } from "@/lib/data/locations";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { InventorySetupFlow } from "@/components/inventory/inventory-setup-flow";

export default async function InventorySetupPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const [{ allowed: toolsAllowed }, { allowed: materialsAllowed }] = await Promise.all([
    checkTabAccess("tools"),
    checkTabAccess("materials"),
  ]);
  if (!toolsAllowed && !materialsAllowed) redirect("/attractors");

  const businessLocations = await listBusinessLocations().catch(() => []);
  const storageLocations = businessLocations.map((location) => location.name);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Set up your inventory</h1>
      <p className="mb-6 text-muted-foreground">
        Add what you already have — you can fill in the rest later, and anything new gets added automatically
        the first time you quote it.
      </p>
      <InventorySetupFlow storageLocations={storageLocations} />
    </div>
  );
}
