import { ImageCanvasBoard } from "@/components/canvas/image-canvas-board";

export default function CanvasPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold">Image Canvas</h1>
        <p className="text-muted-foreground">
          Upload an image, position it on the canvas, then lock it in place as a background.
        </p>
      </div>

      <ImageCanvasBoard />
    </div>
  );
}
