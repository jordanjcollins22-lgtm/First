import Link from "next/link";
import { notFound } from "next/navigation";

import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { OrderForm } from "@/components/store/order-form";
import { getMerchProduct, listActiveTeamMemberOptions } from "@/lib/data/merch";
import { isSupabaseConfigured } from "@/lib/env";
import { formatCents } from "@/lib/merch/format";
import { renderSamplePreview } from "@/lib/merch/sample";

export default async function OrderProductPage({ params }: { params: Promise<{ productId: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { productId } = await params;
  const [product, teamMembers] = await Promise.all([getMerchProduct(productId), listActiveTeamMemberOptions()]);
  if (!product || !product.active) notFound();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/store" className="text-sm text-muted-foreground hover:text-primary">
        &larr; Team Store
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-bold">{product.name}</h1>
      <p className="mb-6 text-muted-foreground">
        {formatCents(product.price_cents)} each
        {product.print_specs ? ` · ${product.print_specs}` : ""}
      </p>
      {teamMembers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Add people on the <Link href="/team" className="underline">Team</Link> page before ordering.
        </p>
      ) : (
        <OrderForm
          product={product}
          teamMembers={teamMembers}
          initialPreviewSvg={renderSamplePreview(product) ?? ""}
        />
      )}
    </div>
  );
}
