import { YouTubePlayer } from "@/components/video/youtube-player";

export default function VideosPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Videos</h1>
      <p className="mb-6 text-muted-foreground">
        Paste a YouTube link to watch it right here in the app.
      </p>
      <YouTubePlayer />
    </div>
  );
}
