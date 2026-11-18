import { notFound, redirect } from "next/navigation";

import { ClientFileView } from "@/components/phone/client-file-view";
import { loadClientFile } from "@/lib/data/client-file";
import { getCurrentProfile } from "@/lib/data/team";

export const dynamic = "force-dynamic";

/** One client, everything about them, in the new look. Row-level security decides who may read it. */
export default async function ClientPage({ params }: { params: Promise<{ customerId: string }> }) {
  if (!(await getCurrentProfile())) redirect("/login");
  const { customerId } = await params;
  const file = await loadClientFile(customerId);
  if (!file) notFound();
  return <ClientFileView file={file} />;
}
