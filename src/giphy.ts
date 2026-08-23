/*
 * GIPHY REST client. Calls the same-origin dev proxy (see vite.config.ts), which
 * appends the server-side API key — so the key never enters the client bundle.
 */

/** A search result distilled to what the canvas needs. */
export type GiphyResult = {
  id: string;
  title: string;
  /** Intrinsic aspect (width/height) of the fixed_width rendition. */
  width: number;
  height: number;
  /** Static still image URL (used for placement in this phase). */
  still: string;
  /** Small still for the results grid thumbnail. */
  preview: string;
  /** Animated video URL (mp4) — used later for playback. */
  mp4?: string;
};

type GiphyImage = { url?: string; width?: string; height?: string; mp4?: string };
type GiphyItem = { id?: string; title?: string; images?: Record<string, GiphyImage> };

function toResult(g: GiphyItem): GiphyResult | null {
  const img = g.images;
  if (!img || !g.id) {
    return null;
  }
  const fw = img.fixed_width ?? {};
  const still = img.fixed_width_still?.url ?? fw.url;
  if (!still) {
    return null;
  }
  const result: GiphyResult = {
    id: String(g.id),
    title: String(g.title ?? ''),
    width: Number(fw.width ?? img.original?.width ?? 200),
    height: Number(fw.height ?? img.original?.height ?? 200),
    still,
    preview: img.fixed_width_small_still?.url ?? img.fixed_width_small?.url ?? still,
  };
  const mp4 = fw.mp4 ?? img.original?.mp4;
  if (mp4) {
    result.mp4 = mp4;
  }
  return result;
}

/** Search GIPHY GIFs; returns distilled results (empty on error). */
export async function searchGifs(query: string, limit = 24): Promise<GiphyResult[]> {
  const q = query.trim();
  if (!q) {
    return [];
  }
  const url = `/giphy/v1/gifs/search?q=${encodeURIComponent(q)}&limit=${limit}&rating=pg-13`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GIPHY search failed: ${res.status}`);
  }
  const json = (await res.json()) as { data?: GiphyItem[] };
  return (json.data ?? []).map(toResult).filter((r): r is GiphyResult => r !== null);
}
