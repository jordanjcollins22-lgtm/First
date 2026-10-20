import Link from "next/link";

import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { DesignPreview } from "@/components/store/design-preview";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listMerchProducts } from "@/lib/data/merch";
import { isSupabaseConfigured } from "@/lib/env";
import { formatCents } from "@/lib/merch/format";
import { renderSamplePreview } from "@/lib/merch/sample";

export default async function StorePage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const products = await listMerchProducts();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mb-1 text-2xl font-bold">Team Store</h1>
          <p className="text-muted-foreground">
            Order a truck magnet with your own affiliate QR code. Every scan is credited to you. Our print
            vendor makes it and ships it to you.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/store/orders">Orders</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/admin/store">Manage items</Link>
          </Button>
        </div>
      </div>

      {products.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing in the store yet. <Link href="/admin/store" className="underline">Add a design</Link> to get started.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => {
          const preview = renderSamplePreview(product);
          return (
            <Card key={product.id}>
              <CardContent className="flex flex-col gap-3 pt-6">
                {preview ? (
                  <DesignPreview svg={preview} alt={product.name} />
                ) : (
                  <p className="text-sm text-destructive">This design can&apos;t render. Check it in Manage items.</p>
                )}
                <div>
                  <p className="font-semibold">{product.name}</p>
                  <p className="text-sm text-muted-foreground">{formatCents(product.price_cents)} each</p>
                  {product.description && <p className="mt-1 text-sm">{product.description}</p>}
                </div>
                <Button asChild className="self-start">
                  <Link href={`/store/${product.id}`}>Customize &amp; order</Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
