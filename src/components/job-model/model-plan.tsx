"use client";

import { useMemo, useRef } from "react";

import { areaCenter, modelBounds, stepPins, PLANT_COLOR, type LngLat, type ModelArea, type ModelPlant, type ModelStep } from "@/lib/job-model";

const FT_PER_DEG_LAT = 364_000;

/**
 * The job from straight above, for when the 3D map can't load: the same beds,
 * plants at their real spread, steps and truck, north up.
 */
export function ModelPlan({
  areas,
  plants,
  steps,
  truck,
  house,
  selectedPlantId,
  activeStep,
  placing,
  onMapClick,
  onSelectPlant,
  onSelectStep,
}: {
  areas: ModelArea[];
  plants: ModelPlant[];
  steps: ModelStep[];
  truck: LngLat | null;
  house: LngLat[] | null;
  selectedPlantId: string | null;
  activeStep: number | null;
  placing: boolean;
  onMapClick: (at: LngLat) => void;
  onSelectPlant: (id: string | null) => void;
  onSelectStep: (index: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const frame = useMemo(() => {
    const b = modelBounds(areas, plants, truck) ?? [
      [-76.35, 39.53],
      [-76.35, 39.53],
    ];
    const pts: LngLat[] = [b[0], b[1], ...(house ?? []), ...(truck ? [truck] : [])];
    const lngs = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    const mid: LngLat = [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
    const ftPerLng = FT_PER_DEG_LAT * Math.cos((mid[1] * Math.PI) / 180);
    const w = Math.max(40, (Math.max(...lngs) - Math.min(...lngs)) * ftPerLng) + 30;
    const h = Math.max(40, (Math.max(...lats) - Math.min(...lats)) * FT_PER_DEG_LAT) + 30;
    return { mid, ftPerLng, w, h };
  }, [areas, plants, truck, house]);

  const xy = ([lng, lat]: LngLat): [number, number] => [(lng - frame.mid[0]) * frame.ftPerLng, -(lat - frame.mid[1]) * FT_PER_DEG_LAT];
  const toGround = (x: number, y: number): LngLat => [frame.mid[0] + x / frame.ftPerLng, frame.mid[1] - y / FT_PER_DEG_LAT];
  const path = (ring: LngLat[]) => ring.map((p, i) => `${i ? "L" : "M"}${xy(p).join(",")}`).join(" ") + "Z";
  const route = steps.filter((s) => s.at).map((s) => xy(s.at!));

  return (
    <svg
      ref={svgRef}
      viewBox={`${-frame.w / 2} ${-frame.h / 2} ${frame.w} ${frame.h}`}
      className={`h-full w-full bg-[#3f5a2c] ${placing ? "cursor-crosshair" : ""}`}
      onClick={(e) => {
        const svg = svgRef.current;
        if (!svg) return;
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const local = pt.matrixTransform(svg.getScreenCTM()?.inverse());
        if (placing) onMapClick(toGround(local.x, local.y));
        else onSelectPlant(null);
      }}
    >
      {house && house.length >= 3 && <path d={path(house)} fill="#d6d3d1" stroke="#78716c" strokeWidth={0.4} />}
      {areas.map((a, i) => {
        if (a.ring.length < 3) return null;
        const c = areaCenter(a);
        return (
          <g key={a.id}>
            <path d={path(a.ring)} fill={a.color} fillOpacity={0.35} stroke={a.color} strokeWidth={0.6} />
            {c && (
              <text x={xy(c)[0]} y={xy(c)[1]} fontSize={2.4} fill="#fff" stroke="#000" strokeWidth={0.15} paintOrder="stroke" textAnchor="middle">
                {i + 1}. {a.name}
              </text>
            )}
          </g>
        );
      })}
      {route.length > 1 && <polyline points={route.map((p) => p.join(",")).join(" ")} fill="none" stroke="#fff" strokeWidth={0.4} strokeDasharray="1 1" />}
      {plants
        .filter((p) => p.at)
        .map((p) => {
          const [x, y] = xy(p.at!);
          const r = p.spreadFt / 2;
          return (
            <g
              key={p.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelectPlant(p.id);
              }}
              className="cursor-pointer"
            >
              <circle cx={x} cy={y} r={r} fill={PLANT_COLOR[p.status]} fillOpacity={p.status === "remove" ? 0.6 : 0.9} stroke={p.id === selectedPlantId ? "#facc15" : "#fff"} strokeWidth={p.id === selectedPlantId ? 0.5 : 0.2} />
              <circle cx={x} cy={y} r={r * 0.5} fill="#fff" fillOpacity={0.18} />
              {p.status === "remove" && <path d={`M${x - r},${y - r}L${x + r},${y + r}M${x + r},${y - r}L${x - r},${y + r}`} stroke="#fff" strokeWidth={0.35} />}
            </g>
          );
        })}
      {truck && (
        <g transform={`translate(${xy(truck).join(",")})`}>
          <rect x={-3} y={-1.6} width={6} height={3.2} rx={0.6} fill="#f97316" stroke="#fff" strokeWidth={0.3} />
          <text y={0.8} fontSize={1.8} textAnchor="middle" fill="#fff">
            Truck
          </text>
        </g>
      )}
      {stepPins(steps).map((pin) => {
        const [x, y] = xy(pin.at);
        const active = activeStep != null && pin.numbers.includes(activeStep + 1);
        const label = pin.numbers.join("·");
        const w = 1.6 + label.length * 1.1;
        return (
          <g
            key={pin.ids.join()}
            transform={`translate(${x},${y - 3})`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectStep(pin.numbers[0] - 1);
            }}
            className="cursor-pointer"
          >
            <rect x={-w / 2} y={-1.5} width={w} height={3} rx={1.5} fill={active ? "#facc15" : "#0f172a"} stroke="#fff" strokeWidth={0.25} />
            <text y={0.7} fontSize={1.9} fontWeight={700} textAnchor="middle" fill={active ? "#000" : "#fff"}>
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
