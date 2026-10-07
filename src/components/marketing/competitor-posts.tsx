import type { CompetitorPost, CompetitorSummary } from "@/lib/competitor-posts";
import { PITCH_LABELS, type Pitch } from "@/lib/post-sorting";

const n = (v: number | null) => (v == null ? "–" : v.toLocaleString("en-US"));

/**
 * What works for the other businesses: their adverts by kind of pitch, with
 * the response each kind gets, the best-received posts to read, and who
 * posts most and where.
 */
export function CompetitorPostsCard({ summary }: { summary: CompetitorSummary }) {
  if (summary.total === 0) {
    return <p className="text-sm text-muted-foreground">No adverts from other businesses read in the last 90 days yet.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {summary.total} adverts from other businesses in the last 90 days. {summary.counted} have their reactions and comments counted: the
        finder counts them from version 2.11 on, and counts again each time it passes a post.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1.5 pr-3 font-medium">Pitch</th>
              <th className="py-1.5 pr-3 text-right font-medium">Posts</th>
              <th className="py-1.5 pr-3 text-right font-medium">Avg reactions</th>
              <th className="py-1.5 text-right font-medium">Avg comments</th>
            </tr>
          </thead>
          <tbody>
            {summary.byPitch.map((row) => (
              <tr key={row.pitch} className="border-b border-border/60 align-top">
                <td className="py-2 pr-3">
                  <p className="font-medium">{row.label}</p>
                  {row.best && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">Best: {row.best.text}</p>}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{row.posts}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{n(row.avgReactions)}</td>
                <td className="py-2 text-right tabular-nums">{n(row.avgComments)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {summary.top.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-semibold">Best-received posts</p>
          <ul className="divide-y divide-border/60">
            {summary.top.map((p) => (
              <TopPost key={p.id} post={p} />
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-sm font-semibold">Who posts most</p>
          <ul className="text-sm">
            {summary.busiest.map((b) => (
              <li key={b.business} className="flex justify-between gap-2 py-0.5">
                <span className="min-w-0 truncate">{b.business}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{b.posts} posts</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 text-sm font-semibold">Where adverts get a response</p>
          <ul className="text-sm">
            {summary.groups.map((g) => (
              <li key={g.group} className="flex justify-between gap-2 py-0.5">
                <span className="min-w-0 truncate">{g.group}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {g.posts} posts{g.avgScore != null ? ` · score ${g.avgScore}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function TopPost({ post }: { post: CompetitorPost }) {
  return (
    <li className="py-2">
      <p className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">{post.business ?? "A business"}</span>
        {post.pitch && <span>{PITCH_LABELS[post.pitch as Pitch] ?? post.pitch}</span>}
        <span className="tabular-nums">
          {n(post.reactions)} reactions · {n(post.comments)} comments
        </span>
        {post.group && <span>{post.group}</span>}
      </p>
      <p className="mt-0.5 line-clamp-3 text-sm">{post.text}</p>
      {post.url && (
        <a href={post.url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
          Open the post
        </a>
      )}
    </li>
  );
}
