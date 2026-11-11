import type { SearchProvider } from "./types.ts";

export function exa(apiKey: string): SearchProvider {
  return {
    name: "exa",
    async search(query, opts) {
      const res = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "x-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          query,
          type: "auto",
          numResults: 5,
          contents: { highlights: { maxCharacters: 1000 } },
          // never send an empty list: Exa treats it as set
          ...(opts?.site ? { includeDomains: [opts.site] } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`exa HTTP ${res.status}`);
      const body = (await res.json()) as { results?: any[] };
      return (body.results ?? []).map((r) => ({
        url: r.url,
        title: r.title ?? undefined,
        content: Array.isArray(r.highlights) && r.highlights.length ? r.highlights.join(" … ") : (r.text ?? r.summary),
        published: r.publishedDate ?? undefined,
      }));
    },
  };
}
