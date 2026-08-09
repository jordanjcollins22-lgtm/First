import { ImageCanvasBoard } from "@/components/canvas/image-canvas-board";
import { PlantsSidebar } from "@/components/canvas/plants-sidebar";

export default function CanvasPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold">Design Canvas</h1>
        <p className="text-muted-foreground">
          Upload a reference photo and lock it in place, then drag plants onto it and
          draw work zones to plan the job.
        </p>
      </div>

      <div className="flex flex-col gap-6 md:flex-row">
        <PlantsSidebar />
        <div className="min-w-0 flex-1">
          <ImageCanvasBoard />
        </div>
      </div>
    </div>
  );
}
