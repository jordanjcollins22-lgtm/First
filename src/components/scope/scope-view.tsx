import { generateScope } from "@/lib/scope-generation";
import type { CalculatedMeasurements, ServiceTemplate } from "@/types/domain";

interface ScopeViewProps {
  template: ServiceTemplate;
  measurements: CalculatedMeasurements;
}

export function ScopeView({ template, measurements }: ScopeViewProps) {
  const scope = generateScope("preview", template, measurements);

  return (
    <div className="flex flex-col gap-3 rounded-md bg-muted p-3 text-sm">
      <p className="font-semibold">Generated Scope of Work</p>

      {scope.materials.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Materials
          </p>
          <ul className="mt-1 list-inside list-disc">
            {scope.materials.map((m) => (
              <li key={m.material}>
                {m.material}: {m.quantity} {m.unit}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs font-medium uppercase text-muted-foreground">
          Crew Steps
        </p>
        <ol className="mt-1 list-inside list-decimal">
          {scope.crew_steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </div>

      {scope.tools_required.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Tools</p>
          <p>{scope.tools_required.join(", ")}</p>
        </div>
      )}

      {scope.equipment_required.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Equipment
          </p>
          <p>{scope.equipment_required.join(", ")}</p>
        </div>
      )}

      {scope.quality_control_requirements.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Quality Control
          </p>
          <ul className="mt-1 list-inside list-disc">
            {scope.quality_control_requirements.map((qc, i) => (
              <li key={i}>{qc}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
