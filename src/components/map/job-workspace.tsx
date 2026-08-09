"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as turf from "@turf/turf";
import type { Feature, Geometry } from "geojson";
import {
  Hexagon,
  Layers,
  MapPin as MapPinIcon,
  MousePointer2,
  Minus,
  Route,
  Sparkles,
  Square,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  MapboxMap,
  type DrawShapeMode,
  type MapboxMapHandle,
} from "@/components/map/mapbox-map";
import { AssignServiceDialog } from "@/components/work-area/assign-service-dialog";
import { CleanupDialog } from "@/components/work-area/cleanup-dialog";
import { WorkAreaCard } from "@/components/work-area/work-area-card";
import { ZoneList } from "@/components/zone/zone-list";
import {
  createWorkArea,
  deleteWorkArea,
  lockWorkAreaGeometry,
  updateWorkAreaGeometry,
  updateWorkAreaServiceTemplate,
} from "@/lib/actions/work-area-actions";
import { autoClusterZones } from "@/lib/actions/zone-actions";
import { generateSequence } from "@/lib/actions/sequence-actions";
import type { JobWithProperty, WorkAreaWithPhotos } from "@/lib/data/jobs";
import type { ServiceTemplate, Zone } from "@/types/domain";

interface JobWorkspaceProps {
  job: JobWithProperty;
  zones: Zone[];
  workAreas: WorkAreaWithPhotos[];
  serviceTemplates: ServiceTemplate[];
}

interface PendingFeature {
  tempId: string;
  geometry: Feature<Geometry>;
}

const DRAW_TOOLS: { mode: DrawShapeMode; label: string; icon: typeof Square }[] = [
  { mode: "simple_select", label: "Select / Edit", icon: MousePointer2 },
  { mode: "draw_polygon", label: "Polygon", icon: Hexagon },
  { mode: "draw_rectangle", label: "Rectangle", icon: Square },
  { mode: "draw_line_string", label: "Line", icon: Minus },
  { mode: "draw_point", label: "Point", icon: MapPinIcon },
];

export function JobWorkspace({ job, zones, workAreas, serviceTemplates }: JobWorkspaceProps) {
  const router = useRouter();
  const mapHandleRef = useRef<MapboxMapHandle>(null);

  const [pendingFeature, setPendingFeature] = useState<PendingFeature | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cleanupTargetId, setCleanupTargetId] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<DrawShapeMode>("simple_select");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clusterBusy, setClusterBusy] = useState(false);

  const center: [number, number] = [job.property.lng, job.property.lat];

  const initialFeatures = useMemo(
    () => workAreas.map((wa) => ({ id: wa.id, geometry: wa.geometry })),
    // Seed the map once on mount only — subsequent edits are driven by
    // Draw interactions, not by re-syncing from server props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const zoneById = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);
  const workAreaCountByZone = useMemo(() => {
    const map = new Map<string, number>();
    for (const wa of workAreas) {
      if (!wa.zone_id) continue;
      map.set(wa.zone_id, (map.get(wa.zone_id) ?? 0) + 1);
    }
    return map;
  }, [workAreas]);

  function refresh() {
    router.refresh();
  }

  function handleModeClick(mode: DrawShapeMode) {
    setActiveMode(mode);
    mapHandleRef.current?.changeMode(mode);
  }

  function handleFeatureCreate(tempId: string, geometry: Feature<Geometry>) {
    setPendingFeature({ tempId, geometry });
    setActiveMode("simple_select");
  }

  function handleFeatureUpdate(id: string, geometry: Feature<Geometry>) {
    if (pendingFeature && pendingFeature.tempId === id) {
      setPendingFeature({ tempId: id, geometry });
      return;
    }
    updateWorkAreaGeometry({ workAreaId: id, geometry }).then(refresh);
  }

  function handleFeatureDelete(id: string) {
    if (pendingFeature && pendingFeature.tempId === id) {
      setPendingFeature(null);
      return;
    }
    deleteWorkArea(id).then(refresh);
  }

  function handleSelectionChange(ids: string[]) {
    const id = ids[0] ?? null;
    if (id && workAreas.some((wa) => wa.id === id)) {
      setSelectedId(id);
    }
  }

  async function handleAssignConfirm(serviceTemplateId: string) {
    if (!pendingFeature) return;
    const newWorkArea = await createWorkArea({
      jobId: job.id,
      serviceTemplateId,
      geometry: pendingFeature.geometry,
    });
    mapHandleRef.current?.replaceFeatureId(
      pendingFeature.tempId,
      newWorkArea.id,
      pendingFeature.geometry
    );
    setPendingFeature(null);
    refresh();
  }

  function handleAssignCancel() {
    if (pendingFeature) {
      mapHandleRef.current?.deleteFeature(pendingFeature.tempId);
    }
    setPendingFeature(null);
  }

  function handlePanelSelect(workArea: WorkAreaWithPhotos) {
    setSelectedId(workArea.id);
    const centroid = turf.centroid(workArea.geometry).geometry
      .coordinates as [number, number];
    mapHandleRef.current?.flyTo(centroid);
  }

  async function handlePanelServiceChange(id: string, templateId: string) {
    setBusyId(id);
    await updateWorkAreaServiceTemplate(id, templateId);
    setBusyId(null);
    refresh();
  }

  async function handlePanelDelete(id: string) {
    setBusyId(id);
    await deleteWorkArea(id);
    mapHandleRef.current?.deleteFeature(id);
    setBusyId(null);
    refresh();
  }

  async function handlePanelLock(id: string) {
    setBusyId(id);
    await lockWorkAreaGeometry(id);
    setBusyId(null);
    refresh();
  }

  async function handleAutoCluster() {
    setClusterBusy(true);
    await autoClusterZones(job.id);
    setClusterBusy(false);
    refresh();
  }

  async function handleGenerateSequence() {
    setClusterBusy(true);
    await generateSequence(job.id);
    setClusterBusy(false);
    refresh();
  }

  const sortedWorkAreas = [...workAreas].sort((a, b) => {
    const zoneA = a.zone_id ? zoneById.get(a.zone_id)?.sequence_order ?? 999 : 999;
    const zoneB = b.zone_id ? zoneById.get(b.zone_id)?.sequence_order ?? 999 : 999;
    if (zoneA !== zoneB) return zoneA - zoneB;
    return (a.sequence_order ?? 999) - (b.sequence_order ?? 999);
  });

  return (
    <div className="flex h-[calc(100vh-65px)] min-h-[520px] flex-col md:flex-row">
      <div className="relative flex-1">
        <MapboxMap
          ref={mapHandleRef}
          center={center}
          initialFeatures={initialFeatures}
          onFeatureCreate={handleFeatureCreate}
          onFeatureUpdate={handleFeatureUpdate}
          onFeatureDelete={handleFeatureDelete}
          onSelectionChange={handleSelectionChange}
        />

        <div className="absolute left-3 top-3 flex flex-col gap-1 rounded-lg border border-border bg-card p-1.5 shadow-md">
          {DRAW_TOOLS.map(({ mode, label, icon: Icon }) => (
            <Button
              key={mode}
              type="button"
              size="icon"
              variant={activeMode === mode ? "default" : "ghost"}
              title={label}
              onClick={() => handleModeClick(mode)}
            >
              <Icon className="h-4 w-4" />
            </Button>
          ))}
        </div>
      </div>

      <aside className="flex w-full flex-col overflow-y-auto border-t border-border bg-secondary/30 md:w-[400px] md:border-l md:border-t-0">
        <div className="border-b border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">{job.property.customer.name}</p>
          <h1 className="text-lg font-bold">{job.property.address}</h1>
        </div>

        <div className="flex flex-col gap-2 border-b border-border p-4">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Layers className="h-4 w-4" /> Zones
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={clusterBusy || workAreas.length === 0}
                onClick={handleAutoCluster}
              >
                <Sparkles className="h-3.5 w-3.5" /> Auto-cluster
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={clusterBusy || zones.length === 0}
                onClick={handleGenerateSequence}
              >
                <Route className="h-3.5 w-3.5" /> Sequence
              </Button>
            </div>
          </div>
          <ZoneList
            jobId={job.id}
            zones={zones}
            workAreaCountByZone={workAreaCountByZone}
            onChanged={refresh}
          />
        </div>

        <div className="flex flex-1 flex-col gap-2 p-4">
          <p className="text-sm font-semibold">
            Work Areas ({workAreas.length})
          </p>
          {sortedWorkAreas.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Use the tools on the map to draw your first work area.
            </p>
          )}
          {sortedWorkAreas.map((wa) => (
            <WorkAreaCard
              key={wa.id}
              workArea={wa}
              serviceTemplates={serviceTemplates}
              zoneName={wa.zone_id ? zoneById.get(wa.zone_id)?.name ?? null : null}
              selected={selectedId === wa.id}
              busy={busyId === wa.id}
              onSelect={() => handlePanelSelect(wa)}
              onCleanUp={() => setCleanupTargetId(wa.id)}
              onChanged={refresh}
              onServiceChange={(templateId) => handlePanelServiceChange(wa.id, templateId)}
              onDelete={() => handlePanelDelete(wa.id)}
              onLock={() => handlePanelLock(wa.id)}
            />
          ))}
        </div>

        <Separator />
        <div className="p-4">
          <Button asChild variant="outline" className="w-full">
            <a href={`/jobs/${job.id}/crew`}>Open Crew Preview &rarr;</a>
          </Button>
        </div>
      </aside>

      <AssignServiceDialog
        open={pendingFeature !== null}
        geometry={pendingFeature?.geometry ?? null}
        serviceTemplates={serviceTemplates}
        onConfirm={handleAssignConfirm}
        onCancel={handleAssignCancel}
      />

      <CleanupDialog
        workAreaId={cleanupTargetId}
        onClose={() => setCleanupTargetId(null)}
        onApplied={() => {
          setCleanupTargetId(null);
          refresh();
        }}
      />
    </div>
  );
}
