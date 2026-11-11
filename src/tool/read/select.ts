const STOP = new Set(
  "the and for with what how does are was were has have from that this your you its can any about into than then them they there their when which who why will would should could also just only more most some such very much many per".split(" "),
);
const PRICE_Q = /\b(price|prices|pricing|cost|costs|fee|fees|rate|rates|plan|plans|tier|subscription|cheap|expensive)\b|[$£€¥]/i;
const MONEY = /[$£€¥]\s?\d|\d(?:[.,]\d+)?\s?(?:usd|eur|gbp|dollars|euros|pounds)\b|\/\s?(?:mo|month|yr|year|user|seat|gb)\b|per (?:month|year|user|seat|gb)/i;
const CHUNK = 1500;

export function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.+-]*/gu) ?? [])]
    .map((w) => w.replace(/[.]+$/, ""))
    .filter((w) => (w.length >= 3 || /\d/.test(w)) && !STOP.has(w));
}

/** Split at headings; break long sections into paragraph groups of about CHUNK characters. */
export function splitSections(md: string): string[] {
  const sections: string[] = [];
  let cur: string[] = [];
  for (const line of md.split("\n")) {
    if (/^#{1,6}\s/.test(line) && cur.join("").trim()) {
      sections.push(cur.join("\n").trim());
      cur = [];
    }
    cur.push(line);
  }
  if (cur.join("").trim()) sections.push(cur.join("\n").trim());
  return sections.flatMap((s) => {
    if (s.length <= CHUNK) return [s];
    const out: string[] = [];
    let buf = "";
    for (const para of s.split(/\n\s*\n/)) {
      if (buf && buf.length + para.length > CHUNK) {
        out.push(buf);
        buf = "";
      }
      buf = buf ? `${buf}\n\n${para}` : para;
    }
    if (buf) out.push(buf);
    // a single huge paragraph (one-line pages) still gets cut into pieces
    return out.flatMap((p) => (p.length > CHUNK * 2 ? (p.match(new RegExp(`[\\s\\S]{1,${CHUNK}}`, "g")) ?? []) : [p]));
  });
}

export function scoreSection(section: string, terms: string[], wantsPrice: boolean): number {
  const lower = section.toLowerCase();
  let score = 0;
  for (const t of terms) {
    const hits = lower.split(t).length - 1;
    if (hits) score += 2 + Math.min(hits, 3);
  }
  if (/^\s*\|.*\|\s*$/m.test(section)) score += 2;
  if (wantsPrice && MONEY.test(section)) score += 4;
  return score;
}

/** Keep the best-scoring sections, in page order, up to `budget` characters. */
export function selectSections(md: string, query: string, budget = 6000): string {
  if (md.length <= budget) return md;
  const terms = queryTerms(query);
  const wantsPrice = PRICE_Q.test(query);
  const ranked = splitSections(md)
    .map((text, i) => ({ text, i, score: scoreSection(text, terms, wantsPrice) }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const keep: typeof ranked = [];
  let used = 0;
  for (const s of ranked) {
    if (s.score === 0 && keep.length) break;
    if (used + s.text.length > budget) continue;
    keep.push(s);
    used += s.text.length + 5;
  }
  return keep.sort((a, b) => a.i - b.i).map((s) => s.text).join("\n\n…\n\n");
}
