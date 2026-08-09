"use client";

import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import DrawRectangleMode from "mapbox-gl-draw-rectangle-mode";
import type { Feature, Geometry } from "geojson";

import { env } from "@/lib/env";

import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

export type DrawShapeMode =
  | "simple_select"
  | "draw_polygon"
  | "draw_rectangle"
  | "draw_line_string"
  | "draw_point";

export interface InitialFeature {
  id: string;
  geometry: Feature<Geometry>;
}

export interface MapboxMapHandle {
  changeMode: (mode: DrawShapeMode) => void;
  deleteFeature: (id: string) => void;
  flyTo: (center: [number, number]) => void;
  /** Swaps a client-generated temp Draw feature id for the real DB id once persisted. */
  replaceFeatureId: (tempId: string, newId: string, feature: Feature<Geometry>) => void;
}

interface MapboxMapProps {
  center: [number, number];
  initialFeatures: InitialFeature[];
  onFeatureCreate: (tempId: string, feature: Feature<Geometry>) => void;
  onFeatureUpdate: (id: string, feature: Feature<Geometry>) => void;
  onFeatureDelete: (id: string) => void;
  onSelectionChange: (ids: string[]) => void;
}

export const MapboxMap = forwardRef<MapboxMapHandle, MapboxMapProps>(
  function MapboxMap(
    { center, initialFeatures, onFeatureCreate, onFeatureUpdate, onFeatureDelete, onSelectionChange },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<mapboxgl.Map | null>(null);
    const drawRef = useRef<MapboxDraw | null>(null);
    // Callback refs so we never need to re-bind mapbox event listeners
    // when parent-provided callbacks change identity across renders.
    const callbacksRef = useRef({
      onFeatureCreate,
      onFeatureUpdate,
      onFeatureDelete,
      onSelectionChange,
    });
    callbacksRef.current = {
      onFeatureCreate,
      onFeatureUpdate,
      onFeatureDelete,
      onSelectionChange,
    };

    useImperativeHandle(ref, () => ({
      changeMode(mode: DrawShapeMode) {
        // "draw_rectangle" is a custom mode not in @types' built-in DrawMode
        // union, so the overloaded changeMode signature can't narrow a
        // mixed union cleanly — cast through `never` like the mode
        // registration above.
        drawRef.current?.changeMode(mode as never);
      },
      deleteFeature(id: string) {
        drawRef.current?.delete(id);
      },
      flyTo(c: [number, number]) {
        mapRef.current?.flyTo({ center: c, zoom: 20 });
      },
      replaceFeatureId(tempId: string, newId: string, feature: Feature<Geometry>) {
        drawRef.current?.delete(tempId);
        drawRef.current?.add({ ...feature, id: newId } as never);
      },
    }));

    useEffect(() => {
      if (!containerRef.current || mapRef.current) return;

      mapboxgl.accessToken = env.mapboxToken;

      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        center,
        zoom: 20,
        pitch: 0,
      });
      mapRef.current = map;

      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: {},
        modes: {
          ...MapboxDraw.modes,
          draw_rectangle: DrawRectangleMode,
        },
      });
      drawRef.current = draw;
      map.addControl(draw);

      map.on("load", () => {
        for (const f of initialFeatures) {
          draw.add({ ...f.geometry, id: f.id } as never);
        }
      });

      map.on("draw.create", (e: { features: Feature<Geometry>[] }) => {
        const feature = e.features[0];
        if (feature?.id != null) {
          callbacksRef.current.onFeatureCreate(String(feature.id), feature);
        }
      });

      map.on("draw.update", (e: { features: Feature<Geometry>[] }) => {
        const feature = e.features[0];
        if (feature?.id != null) {
          callbacksRef.current.onFeatureUpdate(String(feature.id), feature);
        }
      });

      map.on("draw.delete", (e: { features: Feature<Geometry>[] }) => {
        for (const feature of e.features) {
          if (feature.id != null) {
            callbacksRef.current.onFeatureDelete(String(feature.id));
          }
        }
      });

      map.on("draw.selectionchange", (e: { features: Feature<Geometry>[] }) => {
        callbacksRef.current.onSelectionChange(
          e.features.map((f) => String(f.id)).filter(Boolean)
        );
      });

      return () => {
        map.remove();
        mapRef.current = null;
        drawRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return <div ref={containerRef} className="h-full w-full" />;
  }
);
