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
import { isClientSide } from "@/lib/contact-types";
import {
  clusterCells,
  densityCells,
  disambiguate,
  intensityOf,
  rankAreas,
  type DensityMode,
  type DensityPoint,
} from "@/lib/area-density";
import { DensityPanel } from "./density-panel";
import { CreateWavePanel } from "./create-wave-panel";
import { WaveDetailPanel } from "./wave-detail-panel";
import { JobDetailPanel } from "./job-detail-panel";
import { ManageAttractorTypes } from "./manage-attractor-types";
import { ManageLocations } from "./manage-locations";
import { RankGridPanel } from "./rank-grid-panel";
import { bandColour, rankLabel, type ScanPoint } from "@/lib/rank-grid";
import type { Keyword, Scan } from "@/lib/data/rank-grid";
import type {
  AttractorType,
  AttractorVariant,
  AttractorGeometryType,
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
import type { MapHouse } from "@/lib/house-geojson";
import type { EddmRouteFeature, EddmStreetFeature } from "@/lib/eddm";
import { loadEddmRoutes } from "@/lib/actions/eddm-actions";
import { EddmMailingPanel } from "./eddm-mailing-panel";
import type { EddmMailing } from "@/lib/data/eddm";
import type { MailingRates } from "@/lib/eddm-mailing";
import { unionBoundary } from "@/lib/eddm-mailing";
import { EddmBuildPanel } from "./eddm-build-panel";
import { MarketingTodo } from "@/components/marketing/marketing-todo";
import type { MarketingPlay } from "@/lib/marketing-plays";
import { OwnershipPanel } from "./ownership-panel";
import type { SdatStatus } from "@/lib/actions/sdat-actions";
import type { OwnershipSummary } from "@/lib/data/ownership";
import type { PointColorMode } from "@/lib/house-geojson";
import type { MatrixRow, PointHighlight } from "@/lib/house-highlight";
import type { ZoneRow } from "@/lib/data/zones";
import type { HouseKind } from "@/lib/house-geojson";
import type { EddmBuildStatus } from "@/lib/actions/eddm-build-actions";
import type { EddmRouteSummary } from "@/lib/data/eddm-build";
import type { UnservedCluster } from "@/lib/eddm-clusters";

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
  houses,
  eddmRates,
  eddmMailings,
  eddmBuild,
  eddmSummary,
  unservedClusters,
  sdatJob,
  ownership,
  ownershipMatrix,
  houseKinds,
  zones,
  plays,
  initialZoneId,
  densityPoints,
  keywords,
  rankScans,
  previousRankPoints,
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
  /** Every house with a story, coloured by stage on the map. */
  houses: MapHouse[];
  /** What an EDDM piece costs to post and to print, for pricing a mailing. */
  eddmRates: MailingRates;
  eddmMailings: EddmMailing[];
  /** The last USPS-routes build, the routes it left, and the houses none reach. */
  eddmBuild: EddmBuildStatus | null;
  eddmSummary: EddmRouteSummary;
  unservedClusters: UnservedCluster[];
  /** The State's roll: the last read of it, and what it says in counts. */
  sdatJob: SdatStatus | null;
  ownership: OwnershipSummary;
  ownershipMatrix: MatrixRow[];
  houseKinds: Partial<Record<HouseKind, number>>;
  /** The door-hanger zones, built from the USPS routes as a partition of the county. */
  zones: ZoneRow[];
  /** The marketing to do, made from evaluations and clients. */
  plays: MarketingPlay[];
  /** A zone to open on arrival, from a link on another page. */
  initialZoneId: string | null;
  /** Every address with what it has actually paid, for ranking areas. */
  densityPoints: DensityPoint[];
  /** Phrases we track, and the latest grid for each. */
  keywords: Keyword[];
  rankScans: Scan[];
  previousRankPoints: Record<string, ScanPoint[]>;
  profiles: Profile[];
  currentProfileId: string | null;
}) {

  /**
   * Addresses with no work on them.
   *
   * The map draws jobs, so a property that has never had one is invisible on
   * it — which is every property that arrived by import. These are those:
   * somewhere we know about rather than somewhere we have worked.
   */
  const leadProperties = useMemo(() => {
    const withJobs = new Set(jobs.map((j) => j.property_id));
    return properties
      .filter((p) => !withJobs.has(p.id) && isClientSide(p.customer?.contact_type))
      .map((p) => ({
        id: p.id,
        customerId: p.customer_id,
        name: p.customer?.name ?? "Contact",
        address: p.address,
        lat: p.lat,
        lng: p.lng,
      }));
  }, [properties, jobs]);

  const [viewMode, setViewMode] = useState<ViewMode>(isMapboxConfigured ? "satellite" : "galaxy");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("waves");
  const [rankKeywordId, setRankKeywordId] = useState<string | null>(null);
  const [managingTypes, setManagingTypes] = useState(false);
  const [managingLocations, setManagingLocations] = useState(false);

  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<AttractorWaveStatus>>(new Set());
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showProjects, setShowProjects] = useState(true);
  const [showLocations, setShowLocations] = useState(true);
  // Off by default: a book of a few thousand imported addresses would bury the
  // handful of real jobs under dots the first time somebody opened the page.
  const [showLeads, setShowLeads] = useState(false);
  // On by default: these are the houses that are ours to act on, and a
  // corrected address should appear the moment it is saved.
  const [showHouses, setShowHouses] = useState(true);
  // Off by default and fetched by viewport: the county is a hundred and
  // seventeen thousand dots, and the point of them is only visible up close.
  const [showAllAddresses, setShowAllAddresses] = useState(false);
  // The houses no USPS route reaches; on once a build has run, because they
  // are the point of it.
  const [showUnserved, setShowUnserved] = useState(false);
  const [showZones, setShowZones] = useState(zones.length > 0);
  const [focusZone, setFocusZone] = useState<{ id: string; at: number } | null>(initialZoneId ? { id: initialZoneId, at: 0 } : null);
  // The zones with an evaluation, a client or marketing to do in them are
  // the ones the office works; the rest of the county is behind a switch.
  const [zoneScope, setZoneScope] = useState<"active" | "all">("active");
  const [pointColorMode, setPointColorMode] = useState<PointColorMode>("stage");
  // A question over the county's dots, from the cross-check table; the map
  // shows only the houses that answer yes.
  const [pointHighlight, setPointHighlight] = useState<{ key: string; value: PointHighlight } | null>(null);
  // A cross-check is a question, and the map answers only it: while one is
  // active every other layer is off, so the dots left are the whole answer.
  const focused = pointHighlight !== null;
  const [flyTo, setFlyTo] = useState<LatLng | null>(null);
  // USPS carrier routes for one ZIP at a time. Loaded on request, kept for
  // the page; the toggle only hides them.
  const [showEddm, setShowEddm] = useState(false);
  const [eddmZip, setEddmZip] = useState("21014");
  const [eddmRoutes, setEddmRoutes] = useState<EddmRouteFeature[]>([]);
  const [eddmStreets, setEddmStreets] = useState<EddmStreetFeature[]>([]);
  // Routes ticked for a mailing, kept as features so a selection survives
  // loading another ZIP's routes.
  const [mailingSelection, setMailingSelection] = useState<Map<string, EddmRouteFeature>>(new Map());
  const [createName, setCreateName] = useState<string | undefined>(undefined);
  const [createQuantity, setCreateQuantity] = useState<number | undefined>(undefined);

  function toggleMailingRoute(id: string) {
    setMailingSelection((current) => {
      const next = new Map(current);
      if (next.has(id)) next.delete(id);
      else {
        const feature = eddmRoutes.find((f) => f.properties.id === id);
        if (feature) next.set(id, feature);
      }
      return next;
    });
  }

  function makeWaveFromMailing(routes: EddmRouteFeature[], name: string, quantity: number) {
    const ring = unionBoundary(routes.map((f) => f.geometry.coordinates[0]));
    if (!ring) return;
    setCreateName(name);
    setCreateQuantity(quantity);
    openWaveFromRoute(ring.map(([lng, lat]) => ({ lat, lng })));
  }
  const [eddmBusy, setEddmBusy] = useState(false);
  const [eddmStatus, setEddmStatus] = useState<string | null>(null);
  // A route handed in as a wave shape opens the form as a polygon; the key
  // remounts the form so the preset takes.
  const [createPreset, setCreatePreset] = useState<AttractorGeometryType | undefined>(undefined);
  const [createKey, setCreateKey] = useState(0);

  async function loadRoutes(refresh: boolean) {
    setEddmBusy(true);
    setEddmStatus(null);
    const result = await loadEddmRoutes(eddmZip, refresh);
    setEddmBusy(false);
    if (!result.ok) {
      setEddmStatus(result.error);
      return;
    }
    setEddmRoutes(result.routes);
    setEddmStreets(result.streets);
    setShowEddm(true);
    const total = result.routes.reduce((sum, r) => sum + (r.properties.total ?? 0), 0);
    setEddmStatus(
      result.note ??
        `${result.routes.length} routes in ${result.zip}, ${total.toLocaleString()} USPS deliveries` +
          (result.source === "stored" && result.fetchedAt ? ` (saved ${new Date(result.fetchedAt).toLocaleDateString()})` : " (from USPS just now)")
    );
  }

  function openWaveFromRoute(points: LatLng[]) {
    setCreating(true);
    setSelectedWaveId(null);
    setSelectedJobId(null);
    setSelectedClientId(null);
    setDrawnPoints(points);
    setDrawTarget("wave");
    setDrawMode(null);
    setCreatePreset("polygon");
    setCreateKey((k) => k + 1);
  }
  // The grid for whichever phrase is selected, ready for the map. Nothing
  // selected means nothing drawn — every phrase at once would be a mess of
  // overlapping dots saying nothing.
  const rankOverlay = useMemo(() => {
    if (!rankKeywordId) return [];
    const scan = rankScans.find((s) => s.keywordId === rankKeywordId);
    if (!scan) return [];
    return scan.points.map((point) => ({
      lat: point.lat,
      lng: point.lng,
      rank: point.rank,
      label: rankLabel(point.rank),
      colour: bandColour(point.rank),
    }));
  }, [rankKeywordId, rankScans]);

  const [densityMode, setDensityMode] = useState<DensityMode | null>(null);

  // Ranked once per mode change rather than per render: this walks every
  // address in the book, and the book is the point.
  // Cells joined into places before ranking. A half-mile cell is a counting
  // unit; a town is not, and ranking the units put the same town in the list
  // four times.
  const allAreas = useMemo(
    () => (densityMode ? disambiguate(clusterCells(densityCells(densityPoints))) : []),
    [densityPoints, densityMode]
  );

  const rankedCells = useMemo(
    () => (densityMode ? rankAreas(allAreas, densityMode) : []),
    [allAreas, densityMode]
  );

  const mapCells = useMemo(() => {
    if (!densityMode) return [];
    return rankedCells.map((area, i) => ({
      key: area.key,
      // Every cell it is made of, so an L-shaped run of streets draws as that
      // rather than as a box around it.
      cells: area.cells.map((c) => c.bounds),
      lat: area.lat,
      lng: area.lng,
      intensity: intensityOf(area, allAreas, densityMode),
      rank: i + 1,
      label: area.area,
    }));
  }, [allAreas, densityMode, rankedCells]);

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
    setCreateName(undefined);
    setCreateQuantity(undefined);
    setCreatePreset(undefined);
    setCreateKey((k) => k + 1);
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
            Contacts and the marketing waves that generate them — on the same map.
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

      <DensityPanel mode={densityMode} onModeChange={setDensityMode} cells={rankedCells} />

      <Card>
        <CardContent className="pt-6">
          <RankGridPanel
            keywords={keywords}
            scans={rankScans}
            previousPoints={previousRankPoints}
            selectedKeywordId={rankKeywordId}
            onSelectKeyword={setRankKeywordId}
            base={locations[0] ? { lat: locations[0].lat, lng: locations[0].lng } : null}
          />
        </CardContent>
      </Card>

      <FilterBar
        showLeads={showLeads}
        leadCount={leadProperties.length}
        onToggleShowLeads={() => setShowLeads((v) => !v)}
        showHouses={showHouses}
        houseCount={houses.length}
        onToggleShowHouses={() => setShowHouses((v) => !v)}
        showAllAddresses={showAllAddresses}
        onToggleShowAllAddresses={() => setShowAllAddresses((v) => !v)}
        showZones={showZones}
        zoneCount={zones.length}
        onToggleShowZones={() => setShowZones((v) => !v)}
        showUnserved={showUnserved}
        unservedCount={unservedClusters.reduce((sum, c) => sum + c.houses, 0)}
        onToggleShowUnserved={() => setShowUnserved((v) => !v)}
        showEddm={showEddm}
        onToggleShowEddm={() => setShowEddm((v) => !v)}
        eddmZip={eddmZip}
        onEddmZipChange={setEddmZip}
        onLoadEddm={(refresh) => void loadRoutes(refresh)}
        eddmBusy={eddmBusy}
        eddmStatus={eddmStatus}
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
              <TabsTrigger value="clients">Contacts ({clientCount})</TabsTrigger>
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
                waves={focused ? [] : waves}
                jobs={focused ? [] : filteredJobs}
                leadProperties={showLeads && !focused ? leadProperties : []}
                houses={showHouses && !focused ? houses : []}
                showAllAddresses={showAllAddresses || focused}
                eddmRoutes={showEddm && !focused ? eddmRoutes : []}
                eddmStreets={showEddm && !focused ? eddmStreets : []}
                selectedEddmIds={[...mailingSelection.keys()]}
                onToggleMailingRoute={toggleMailingRoute}
                onUseRouteAsWave={openWaveFromRoute}
                showUnserved={showUnserved && !focused}
                unservedClusters={unservedClusters}
                showZones={showZones && !focused}
                zoneScope={zoneScope}
                focusZone={focused ? null : focusZone}
                pointColorMode={pointColorMode}
                pointHighlight={pointHighlight?.value ?? null}
                densityCells={focused ? [] : mapCells}
                rankPoints={focused ? [] : rankOverlay}
                visibleWaveIds={focused ? new Set<string>() : visibleWaveIds}
                selectedWaveId={selectedWaveId}
                onSelectWave={selectWave}
                selectedJobId={selectedJobId}
                onSelectJob={selectJob}
                locations={focused ? [] : locations}
                areas={focused ? [] : areas}
                showLocations={showLocations && !focused}
                flyToTarget={flyTo ?? (selectedClientProperty ? { lat: selectedClientProperty.lat, lng: selectedClientProperty.lng } : null)}
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

        {!creating && !selectedWave && !selectedJob && (
          <Card className="max-h-[70vh] overflow-y-auto">
            <CardContent className="pt-6">
              <MarketingTodo
                plays={plays}
                onFocusZone={(id) => {
                  setShowZones(true);
                  setFocusZone({ id, at: Date.now() });
                }}
                onFlyTo={(target) => setFlyTo({ ...target })}
              />
            </CardContent>
          </Card>
        )}

        {!creating && !selectedWave && !selectedJob && (
          <Card>
            <CardContent className="pt-6">
              <OwnershipPanel
                job={sdatJob}
                summary={ownership}
                colorMode={pointColorMode}
                onColorMode={(mode) => {
                  setPointColorMode(mode);
                  if (mode !== "stage") setShowAllAddresses(true);
                }}
                matrix={ownershipMatrix}
                kinds={houseKinds}
                highlight={pointHighlight}
                onHighlight={(next) => {
                  setPointHighlight(next);
                  if (next) setShowAllAddresses(true);
                }}
              />
            </CardContent>
          </Card>
        )}

        {!creating && !selectedWave && !selectedJob && (
          <Card>
            <CardContent className="pt-6">
              <EddmBuildPanel
                build={eddmBuild}
                summary={eddmSummary}
                clusters={unservedClusters}
                zones={zones}
                zoneScope={zoneScope}
                onZoneScope={setZoneScope}
                onFocusZone={(id) => {
                  setShowZones(true);
                  setFocusZone({ id, at: Date.now() });
                }}
                showUnserved={showUnserved}
                onToggleShowUnserved={() => setShowUnserved((v) => !v)}
                onFlyTo={(target) => {
                  setShowUnserved(true);
                  setFlyTo({ ...target });
                }}
              />
            </CardContent>
          </Card>
        )}

        {(mailingSelection.size > 0 || (showEddm && eddmRoutes.length > 0)) && !creating && !selectedWave && !selectedJob && (
          <Card className="max-h-[70vh] overflow-y-auto">
            <CardContent className="pt-6">
              <EddmMailingPanel
                selected={[...mailingSelection.values()]}
                rates={eddmRates}
                mailings={eddmMailings}
                onRemove={toggleMailingRoute}
                onClear={() => setMailingSelection(new Map())}
                onMakeWave={makeWaveFromMailing}
              />
            </CardContent>
          </Card>
        )}

        {(creating || selectedWave || selectedJob) && (
          <Card className="max-h-[70vh] overflow-y-auto">
            <CardContent className="pt-6">
              {creating && (
                <CreateWavePanel
                  key={createKey}
                  types={types}
                  variants={variants}
                  initialGeometryType={createPreset}
                  initialName={createName}
                  initialQuantity={createQuantity}
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
