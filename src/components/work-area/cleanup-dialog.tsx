"use client";

import { useEffect, useState, useTransition } from "react";
import type { Feature, Geometry } from "geojson";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  previewShapeCleanup,
  applyShapeCleanup,
} from "@/lib/actions/work-area-actions";

interface CleanupDialogProps {
  workAreaId: string | null;
  onClose: () => void;
  onApplied: () => void;
}

interface PreviewState {
  forWorkAreaId: string;
  cleanedGeometry: Feature<Geometry>;
  areaDeltaPercent: number | null;
  autoApplied: boolean;
}

export function CleanupDialog({ workAreaId, onClose, onApplied }: CleanupDialogProps) {
  const [state, setState] = useState<PreviewState | null>(null);
  const [isPending, startTransition] = useTransition();

  const open = workAreaId !== null;
  const preview = state && state.forWorkAreaId === workAreaId ? state : null;
  const loading = open && !preview;

  useEffect(() => {
    if (!workAreaId) return;
    let cancelled = false;
    previewShapeCleanup(workAreaId).then((result) => {
      if (!cancelled) {
        setState({ forWorkAreaId: workAreaId, ...result });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [workAreaId]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setState(null);
      onClose();
    }
  }

  function handleApply() {
    if (!workAreaId || !preview) return;
    startTransition(async () => {
      await applyShapeCleanup(workAreaId, preview.cleanedGeometry);
      setState(null);
      onApplied();
    });
  }

  const deltaPct = preview?.areaDeltaPercent != null ? preview.areaDeltaPercent * 100 : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clean Up Shape</DialogTitle>
          <DialogDescription>
            Straightens jagged traces and closes the outline. Your original trace is
            always kept.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {preview && (
          <div className="space-y-3">
            <div className="rounded-md border border-border p-3 text-sm">
              <p>
                Area change from cleanup:{" "}
                <span className="font-semibold">
                  {deltaPct !== null ? `${deltaPct.toFixed(2)}%` : "n/a"}
                </span>
              </p>
              {preview.autoApplied ? (
                <p className="mt-1 text-primary">
                  Within the 2% safety threshold — safe to apply.
                </p>
              ) : (
                <p className="mt-1 text-destructive">
                  Exceeds the 2% threshold. Review carefully before applying — this
                  will change the measured quantity used for pricing.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={!preview || isPending} size="lg">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply Cleanup"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
