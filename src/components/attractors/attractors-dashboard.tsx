"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Settings2, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isMapboxConfigured } from "@/lib/env";
import { FilterBar } from "./filter-bar";
import { WaveList } from "./wave-list";
import { ClientList } from "./client-list";
import { SatelliteMapView } from "./satellite-map-view";
import { GalaxyView } from "./galaxy-view";
import { CalendarView } from "./calendar-view";
import { CreateWavePanel } from "./create-wave-panel";
import { WaveDetailPanel } from "./wave-detail-panel";
import { JobDetailPanel } from "./job-detail-panel";
import { ManageAttractorTypes } from "./manage-attractor-types";
import { ManageLocations } from "./manage-locations";
import type {
  AttractorType,
  AttractorVariant,
  AttractorWave,
  AttractorWaveStatus,
  BusinessLocation,
  JobStatus,
  LatLng,
  LocationArea,
  Profile,
} from "@/types/domain";
import type { JobWithLocation } from "@/lib/data/jobs";
import type { PropertyWithCustomer } from "@/lib/data/properties";

type ViewMode = "satellite" | "galaxy" | "calendar";
type SidebarTab = "waves" | "clients";
type DrawTarget = "wave" | "location-area";

export function AttractorsDashboard({
  types,
  variants,
  waves,
  jobs,
  locations,
  areas,
  properties,
  profiles,
  currentProfileId,
}: {
  types: AttractorType[];
  variants: AttractorVariant[];
  waves: AttractorWave[];
  jobs: JobWithLocation[];
  locations: BusinessLocation[];
  areas: LocationArea[];
  properties: PropertyWithCustomer[];
  profiles: Profile[];
  currentProfileId: string | null;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>(isMapboxConfigured ? "satellite" : "galaxy");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("waves");
  const [managingTypes, setManagingTypes] = useState(false);
  const [managingLocations, setManagingLocations] = useState(false);

  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<AttractorWaveStatus>>(new Set());
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showProjects, setShowProjects] = useState(true);
  const [showLocations, setShowLocations] = useState(true);
  const [jobStatusFilter, setJobStatusFilter] = useState<Set<JobStatus>>(new Set());
  const [manuallyHiddenWaveIds, setManuallyHiddenWaveIds] = useState<Set<string>>(new Set());

  const [selectedWaveId, setSelectedWaveId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [drawMode, setDrawMode] = useState<"polygon" | "route" | null>(null);
  const [drawTarget, setDrawTarget] = useState<DrawTarget | null>(null);
  const [drawnPoints, setDrawnPoints] = useState<LatLng[] | null>(null);

  const filteredWaves = useMemo(
    () =>
      waves.filter((w) => {
        if (typeFilter.size > 0 && !typeFilter.has(w.type_id)) return false;
        if (statusFilter.size > 0 && !statusFilter.has(w.status)) return false;
        const anchorDate = w.date_planned ?? w.date_completed;
        if (dateFrom && (!anchorDate || anchorDate < dateFrom)) return false;
        if (dateTo && (!anchorDate || anchorDate > dateTo)) return false;
        return true;
      }),
    [waves, typeFilter, statusFilter, dateFrom, dateTo]
  );

  const visibleWaveIds = useMemo(
    () => new Set(filteredWaves.filter((w) => !manuallyHiddenWaveIds.has(w.id)).map((w) => w.id)),
    [filteredWaves, manuallyHiddenWaveIds]
  );

  const filteredJobs = useMemo(
    () => (showProjects ? jobs.filter((j) => jobStatusFilter.size === 0 || jobStatusFilter.has(j.status)) : []),
    [jobs, showProjects, jobStatusFilter]
  );

  const clientCount = useMemo(() => new Set(properties.map((p) => p.customer_id)).size, [properties]);

  const selectedWave = waves.find((w) => w.id === selectedWaveId) ?? null;
  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null;
  // First property on file for the selected client — enough to fly the map there.
  const selectedClientProperty = properties.find((p) => p.customer_id === selectedClientId) ?? null;

  function toggleInSet<T>(setter: (fn: (prev: Set<T>) => Set<T>) => void, value: T) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function selectWave(id: string | null) {
    setSelectedWaveId(id);
    setSelectedJobId(null);
    setSelectedClientId(null);
    setCreating(false);
  }

  function selectJob(id: string | null) {
    setSelectedJobId(id);
    setSelectedWaveId(null);
    setSelectedClientId(null);
    setCreating(false);
  }

  function selectClient(id: string | null) {
    setSelectedClientId(id);
    setSelectedWaveId(null);
    setSelectedJobId(null);
    setCreating(false);
    if (id) setViewMode("satellite");
  }

  function startCreating() {
    setCreating(true);
    setSelectedWaveId(null);
    setSelectedJobId(null);
    setSelectedClientId(null);
    setDrawnPoints(null);
  }

  function requestDraw(geometryType: "polygon" | "route") {
    setViewMode("satellite");
    setDrawMode(geometryType);
    setDrawTarget("wave");
  }

  function requestAreaDraw() {
    setViewMode("satellite");
    setDrawMode("polygon");
    setDrawTarget("location-area");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Project Data</h1>
          <p className="text-muted-foreground">
            Clients and the marketing waves that generate them — on the same map.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-white/60 bg-card/60 text-sm backdrop-blur-md">
            <button
              type="button"
              onClick={() => setViewMode("satellite")}
              className={`px-3 py-1.5 ${viewMode === "satellite" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              Satellite View
            </button>
            <button
              type="button"
              onClick={() => setViewMode("galaxy")}
              className={`px-3 py-1.5 ${viewMode === "galaxy" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              Galaxy View
            </button>
            <button
              type="button"
              onClick={() => setViewMode("calendar")}
              className={`px-3 py-1.5 ${viewMode === "calendar" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              Calendar
            </button>
          </div>
          <Button type="button" variant="outline" onClick={() => setManagingTypes((v) => !v)}>
            <Settings2 className="h-4 w-4" />
            Types
          </Button>
          <Button type="button" variant="outline" onClick={() => setManagingLocations((v) => !v)}>
            <Star className="h-4 w-4" />
            Locations
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href="/">
              <Plus className="h-4 w-4" />
              New Property
            </Link>
          </Button>
          <Button type="button" onClick={startCreating}>
            <Plus className="h-4 w-4" />
            New Wave
          </Button>
        </div>
      </div>

      {managingTypes && (
        <Card>
          <CardContent className="pt-6">
            <ManageAttractorTypes types={types} variants={variants} />
          </CardContent>
        </Card>
      )}

      {managingLocations && (
        <Card>
          <CardContent className="pt-6">
            <ManageLocations
              locations={locations}
              areas={areas}
              drawnPoints={drawTarget === "location-area" ? drawnPoints : null}
              onRequestDraw={requestAreaDraw}
            />
          </CardContent>
        </Card>
      )}

      <FilterBar
        types={types}
        typeFilter={typeFilter}
        onToggleType={(id) => toggleInSet(setTypeFilter, id)}
        onClearTypeFilter={() => setTypeFilter(new Set())}
        statusFilter={statusFilter}
        onStatusChange={(s) => setStatusFilter(s ? new Set([s]) : new Set())}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        showProjects={showProjects}
        onToggleShowProjects={() => setShowProjects((v) => !v)}
        jobStatusFilter={jobStatusFilter}
        onJobStatusChange={(s) => setJobStatusFilter(s ? new Set([s]) : new Set())}
        showLocations={showLocations}
        onToggleShowLocations={() => setShowLocations((v) => !v)}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr] xl:grid-cols-[280px_1fr_340px]">
        <Card className="flex max-h-[70vh] flex-col overflow-hidden">
          <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as SidebarTab)} className="flex flex-1 flex-col overflow-hidden">
            <TabsList className="m-2 shrink-0">
              <TabsTrigger value="waves">Waves ({filteredWaves.length})</TabsTrigger>
              <TabsTrigger value="clients">Clients ({clientCount})</TabsTrigger>
            </TabsList>
            <TabsContent value="waves" className="mt-0 flex-1 overflow-y-auto">
              <WaveList
                waves={filteredWaves}
                types={types}
                visibleWaveIds={visibleWaveIds}
                onToggleVisible={(id) => toggleInSet(setManuallyHiddenWaveIds, id)}
                selectedWaveId={selectedWaveId}
                onSelect={selectWave}
              />
            </TabsContent>
            <TabsContent value="clients" className="mt-0 flex-1 overflow-y-auto">
              <ClientList
                properties={properties}
                jobs={jobs}
                profiles={profiles}
                selectedClientId={selectedClientId}
                onSelect={selectClient}
              />
            </TabsContent>
          </Tabs>
        </Card>

        <Card className="relative h-[70vh] overflow-hidden p-0">
          {viewMode === "satellite" ? (
            isMapboxConfigured ? (
              <SatelliteMapView
                waves={waves}
                jobs={filteredJobs}
                visibleWaveIds={visibleWaveIds}
                selectedWaveId={selectedWaveId}
                onSelectWave={selectWave}
                selectedJobId={selectedJobId}
                onSelectJob={selectJob}
                locations={locations}
                areas={areas}
                showLocations={showLocations}
                flyToTarget={selectedClientProperty ? { lat: selectedClientProperty.lat, lng: selectedClientProperty.lng } : null}
                drawMode={drawMode}
                onGeometryDrawn={(points) => {
                  setDrawnPoints(points);
                  setDrawMode(null);
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                Add <code className="mx-1">NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code> to <code>.env.local</code> to enable
                Satellite View. Galaxy View works without it.
              </div>
            )
          ) : viewMode === "galaxy" ? (
            <GalaxyView
              waves={waves}
              jobs={filteredJobs}
              visibleWaveIds={visibleWaveIds}
              selectedWaveId={selectedWaveId}
              onSelectWave={selectWave}
              selectedJobId={selectedJobId}
              onSelectJob={selectJob}
              locations={locations}
              areas={areas}
              showLocations={showLocations}
            />
          ) : (
            <CalendarView
              jobs={jobs}
              selectedJobId={selectedJobId}
              onSelectJob={selectJob}
              currentProfileId={currentProfileId}
            />
          )}
          {drawMode && (
            <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white shadow-lg">
              Click points on the map to draw the {drawMode === "polygon" ? "area — click the first point again to close it." : "route — double-click to finish."}
            </div>
          )}
        </Card>

        {(creating || selectedWave || selectedJob) && (
          <Card className="max-h-[70vh] overflow-y-auto">
            <CardContent className="pt-6">
              {creating && (
                <CreateWavePanel
                  types={types}
                  variants={variants}
                  drawnPoints={drawTarget === "wave" ? drawnPoints : null}
                  onRequestDraw={requestDraw}
                  onCancel={() => {
                    setCreating(false);
                    setDrawnPoints(null);
                    setDrawMode(null);
                  }}
                  onCreated={() => {
                    setCreating(false);
                    setDrawnPoints(null);
                  }}
                />
              )}
              {selectedWave && (
                <WaveDetailPanel
                  key={selectedWave.id}
                  wave={selectedWave}
                  types={types}
                  variants={variants}
                  onClose={() => setSelectedWaveId(null)}
                  onDeleted={() => setSelectedWaveId(null)}
                />
              )}
              {selectedJob && (
                <JobDetailPanel
                  key={selectedJob.id}
                  job={selectedJob}
                  waves={waves}
                  types={types}
                  profiles={profiles}
                  onClose={() => setSelectedJobId(null)}
                />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
