import { notFound } from "next/navigation";

import { PreEvalLoader } from "@/components/pre-eval/pre-eval-loader";
import { getPreEvalForClient } from "@/lib/data/pre-evals";

export default async function PreEvalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const preEval = await getPreEvalForClient(id);
  if (!preEval) notFound();

  return <PreEvalLoader preEval={preEval} />;
}
