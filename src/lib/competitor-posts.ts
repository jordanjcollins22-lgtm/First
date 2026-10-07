/**
 * What works for the other businesses: their adverts the finder read, with
 * how many people responded to each, put together by the kind of pitch, by
 * who posts and by where. Pure, so the sums are tested.
 *
 * A response is a reaction, a comment or a share. A comment counts more than
 * a reaction, because it is somebody asking or vouching where others read it.
 */

import { PITCH_LABELS, type Pitch } from "@/lib/post-sorting";

export interface CompetitorPost {
  id: string;
  business: string | null;
  group: string | null;
  pitch: string | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  text: string;
  url: string | null;
  at: string;
}

export interface PitchRow {
  pitch: string;
  label: string;
  posts: number;
  /** How many of them were counted: older reads have no counts. */
  counted: number;
  avgReactions: number | null;
  avgComments: number | null;
  /** The best-received one, to read. */
  best: CompetitorPost | null;
}

export interface CompetitorSummary {
  total: number;
  counted: number;
  byPitch: PitchRow[];
  top: CompetitorPost[];
  busiest: { business: string; posts: number; avgScore: number | null }[];
  groups: { group: string; posts: number; avgScore: number | null }[];
}

export function responseScore(p: Pick<CompetitorPost, "reactions" | "comments" | "shares">): number | null {
  if (p.reactions == null && p.comments == null && p.shares == null) return null;
  return (p.reactions ?? 0) + 3 * (p.comments ?? 0) + 2 * (p.shares ?? 0);
}

const average = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null);

export function summariseCompetitors(posts: CompetitorPost[]): CompetitorSummary {
  const counted = posts.filter((p) => responseScore(p) != null);
  const byScore = (a: CompetitorPost, b: CompetitorPost) => (responseScore(b) ?? -1) - (responseScore(a) ?? -1);

  const pitches = new Map<string, CompetitorPost[]>();
  for (const p of posts) {
    const key = p.pitch ?? "unsorted";
    pitches.set(key, [...(pitches.get(key) ?? []), p]);
  }
  const byPitch: PitchRow[] = [...pitches.entries()]
    .map(([pitch, list]) => {
      const withCounts = list.filter((p) => responseScore(p) != null);
      return {
        pitch,
        label: PITCH_LABELS[pitch as Pitch] ?? "Not sorted yet",
        posts: list.length,
        counted: withCounts.length,
        avgReactions: average(withCounts.map((p) => p.reactions ?? 0)),
        avgComments: average(withCounts.map((p) => p.comments ?? 0)),
        best: [...withCounts].sort(byScore)[0] ?? null,
      };
    })
    .sort((a, b) => (b.avgComments ?? -1) - (a.avgComments ?? -1) || (b.avgReactions ?? -1) - (a.avgReactions ?? -1) || b.posts - a.posts);

  const group = <K extends "business" | "group">(key: K) => {
    const map = new Map<string, CompetitorPost[]>();
    for (const p of posts) {
      const name = p[key]?.trim();
      if (!name) continue;
      map.set(name, [...(map.get(name) ?? []), p]);
    }
    return [...map.entries()].map(([name, list]) => ({
      name,
      posts: list.length,
      avgScore: average(list.map(responseScore).filter((s): s is number => s != null)),
    }));
  };

  return {
    total: posts.length,
    counted: counted.length,
    byPitch,
    top: [...counted].sort(byScore).slice(0, 10),
    busiest: group("business")
      .sort((a, b) => b.posts - a.posts || (b.avgScore ?? -1) - (a.avgScore ?? -1))
      .slice(0, 10)
      .map(({ name, posts: n, avgScore }) => ({ business: name, posts: n, avgScore })),
    groups: group("group")
      .sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1) || b.posts - a.posts)
      .slice(0, 10)
      .map(({ name, posts: n, avgScore }) => ({ group: name, posts: n, avgScore })),
  };
}
