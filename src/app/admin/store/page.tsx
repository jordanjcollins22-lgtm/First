import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { AddProductForm } from "@/components/store/add-product-form";
import { ProductAdminRow } from "@/components/store/product-admin-row";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listMerchProducts } from "@/lib/data/merch";
import { isSupabaseConfigured } from "@/lib/env";

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
