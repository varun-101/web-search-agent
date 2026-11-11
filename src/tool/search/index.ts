import { exa } from "./exa.ts";
import { tavily } from "./tavily.ts";
import { withFixture } from "./fixtures.ts";
import type { SearchProvider, SearchResult } from "./types.ts";

function providers(): SearchProvider[] {
  const list: SearchProvider[] = [];
  if (process.env.EXA_API_KEY) list.push(exa(process.env.EXA_API_KEY));
  if (process.env.TAVILY_API_KEY) list.push(tavily(process.env.TAVILY_API_KEY));
  return list;
}

/** Fixed order, Exa then Tavily. Any failure (429, 5xx, timeout, bad key) moves on to the next provider. */
export function search(query: string, opts: { site?: string } = {}): Promise<{ provider: string; results: SearchResult[] }> {
  return withFixture("search", { query, site: opts.site ?? null }, async () => {
    const list = providers();
    if (!list.length) throw new Error("no search provider configured (set EXA_API_KEY or TAVILY_API_KEY)");
    const errors: string[] = [];
    for (const p of list) {
      try {
        return { provider: p.name, results: await p.search(query, opts) };
      } catch (err) {
        errors.push(`${p.name}: ${(err as Error).message}`);
        console.warn(`[search] ${p.name} failed: ${(err as Error).message}`);
      }
    }
    throw new Error(errors.join("; "));
  });
}
