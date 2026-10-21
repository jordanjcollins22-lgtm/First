import { listServiceTemplates } from "@/lib/data/service-templates";
import { isSupabaseConfigured } from "@/lib/env";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreateServiceTemplateForm } from "@/components/service-template/create-service-template-form";
import { DeactivateButton } from "@/components/service-template/deactivate-button";
import { SetupRequiredNotice } from "@/components/setup-required-notice";

export default async function ServiceTemplatesPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const templates = await listServiceTemplates();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Service Templates</h1>
      <p className="mb-6 text-muted-foreground">
        Data-driven service definitions. These drive what appears when assigning a
        service to a drawn work area — nothing here is hardcoded into the map UI.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Add a service template</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateServiceTemplateForm />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        {templates.map((t) => (
          <Card key={t.id}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold">{t.name}</p>
                  {t.description && (
                    <p className="text-sm text-muted-foreground">{t.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {t.allowed_geometry_types.map((g) => (
                      <Badge key={g} variant="outline">
                        {g}
                      </Badge>
                    ))}
                    <Badge variant="secondary">{t.required_photo_count} photos required</Badge>
                  </div>
                </div>
                <DeactivateButton id={t.id} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
