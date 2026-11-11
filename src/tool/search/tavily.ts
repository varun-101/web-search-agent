import type { SearchProvider } from "./types.ts";

export function tavily(apiKey: string): SearchProvider {
  return {
    name: "tavily",
    async search(query, opts) {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          max_results: 5,
          chunks_per_source: 3,
          ...(opts?.site ? { include_domains: [opts.site] } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`tavily HTTP ${res.status}`);
      const body = (await res.json()) as { results?: any[] };
      return (body.results ?? []).map((r) => ({
        url: r.url,
        title: r.title ?? undefined,
        content: r.content ?? undefined,
        published: r.published_date ?? undefined,
      }));
    },
  };
}
