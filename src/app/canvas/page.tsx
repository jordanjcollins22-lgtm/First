import { ImageCanvasBoard } from "@/components/canvas/image-canvas-board";

export default function CanvasPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold">Design Canvas</h1>
        <p className="text-muted-foreground">
          Upload a reference photo and lock it in place, then draw work zones and fill in
          the service details to build a scope of work.
        </p>
      </div>

      <ImageCanvasBoard />
    </div>
  );
}
