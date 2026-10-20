"use client";

import { useEffect, useState } from "react";

import { previewMerchDesign } from "@/lib/actions/merch-actions";

type PreviewInput = Parameters<typeof previewMerchDesign>[0];

/** Re-renders the design on the server shortly after the inputs stop changing. */
export function useDesignPreview(input: PreviewInput | null, initialSvg: string | null = null) {
  const [svg, setSvg] = useState<string | null>(initialSvg);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(input);

  useEffect(() => {
    if (!input) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await previewMerchDesign(input);
      if (cancelled) return;
      if (result.error !== undefined) {
        setError(result.error);
      } else {
        setError(null);
        setSvg(result.svg);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `key` captures every field of `input`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { svg, error };
}
