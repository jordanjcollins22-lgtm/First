import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { AddProductForm } from "@/components/store/add-product-form";
import { ProductAdminRow } from "@/components/store/product-admin-row";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listMerchProducts } from "@/lib/data/merch";
import { isSupabaseConfigured, serverEnv } from "@/lib/env";

export default async function StoreAdminPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const products = await listMerchProducts({ includeInactive: true });

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Store Items</h1>
      <p className="mb-6 text-muted-foreground">
        Upload a design once. Each order swaps in that person&apos;s barcode and details to make a print-ready
        file for your vendor.
      </p>

      {(!serverEnv.appUrl || !serverEnv.affiliateLandingUrl) && (
        <p className="mb-6 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm">
          Before printing affiliate QR codes, set <code>APP_URL</code> to this app&apos;s permanent public
          address (it&apos;s baked into every printed code) and <code>AFFILIATE_LANDING_URL</code> to the page
          scans should land on.
        </p>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Add an item</CardTitle>
        </CardHeader>
        <CardContent>
          <AddProductForm />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        {products.map((product) => (
          <ProductAdminRow key={product.id} product={product} />
        ))}
      </div>
    </div>
  );
}
