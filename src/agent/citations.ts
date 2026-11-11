import type { Evidence } from "../tool/web_search.ts";

/**
 * Every [n] in the answer must match a source the tool actually returned.
 * Unknown numbers are removed (and logged by the caller); returns the sources the answer cites, in order.
 */
export function checkCitations(text: string, known: Evidence[]): { text: string; cited: Evidence[]; removed: number[] } {
  const byN = new Map(known.map((e) => [e.n, e]));
  const cited = new Map<number, Evidence>();
  const removed: number[] = [];
  const out = text.replace(/ ?\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g, (match, list: string) => {
    const nums = list.split(",").map((s) => Number(s.trim()));
    const ok = nums.filter((n) => byN.has(n));
    for (const n of nums) if (!byN.has(n)) removed.push(n);
    for (const n of ok) cited.set(n, byN.get(n)!);
    if (!ok.length) return "";
    return `${match.startsWith(" ") ? " " : ""}${ok.map((n) => `[${n}]`).join("")}`;
  });
  return { text: out, cited: [...cited.values()].sort((a, b) => a.n - b.n), removed };
}
