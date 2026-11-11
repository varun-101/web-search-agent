// npm run eval [-- EX-01 ADV-03 ...] [--no-judge] [--concurrency 4]
// Each case: set the clock to `today`, seed notes from `history`, send `message`, then grade with an LLM judge.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chat } from "../src/agent/chat.ts";
import { saveNotes, parseJsonObject, type Note } from "../src/agent/notes.ts";
import { zonedToUtc } from "../src/agent/clock.ts";
import { llm, models } from "../src/agent/llm.ts";

interface Case { id: string; today: string; history: string; message: string; good_answer: string; trap: string }

const TZ = process.env.EVAL_TZ || "Europe/London";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// Zone hints the cases use in `today`; anything else runs in TZ.
const ZONES: [RegExp, string][] = [
  [/sydney/i, "Australia/Sydney"],
  [/los angeles|pacific|\bPST\b|\bPDT\b/i, "America/Los_Angeles"],
  [/new york|eastern|ohio|\bEST\b|\bEDT\b/i, "America/New_York"],
  [/london/i, "Europe/London"],
];

/** "Wednesday 11 November 2026, 10:15 (user in New York)" -> the UTC instant and the user's zone */
export function parseToday(s: string): { now: string; timeZone: string } {
  const m = /(\d{1,2}) (\w+) (\d{4}),? (\d{1,2}):(\d{2})/.exec(s);
  if (!m) throw new Error(`can't parse today: ${s}`);
  const timeZone = ZONES.find(([re]) => re.test(s))?.[1] ?? TZ;
  const month = MONTHS.findIndex((x) => x.startsWith(m[2].toLowerCase().slice(0, 3))) + 1;
  let at = zonedToUtc(+m[3], month, +m[1], +m[4], +m[5], timeZone).getTime();
  // an explicit "HH:MM UTC" wins: local times repeat on the night clocks go back
  const utc = /(\d{1,2}):(\d{2}) UTC/.exec(s);
  if (utc) {
    const day = new Date(at);
    const base = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), +utc[1], +utc[2]);
    at = [base - 86_400_000, base, base + 86_400_000].reduce((a, b) => (Math.abs(b - at) < Math.abs(a - at) ? b : a));
  }
  return { now: new Date(at).toISOString(), timeZone };
}

/** One note per dated entry. Seeded notes carry their date in the text, as the case wrote it. */
export function seedNotes(history: string): Note[] {
  if (!history.trim() || /^none\.?$/i.test(history.trim())) return [];
  const parts = history.split(/(?<=[.!?'"’)])\s+(?=(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w* \d{1,2} \w+ \d{4}|Stored \d{4}-)/);
  return parts.map((text, i) => ({ id: `seed-${i + 1}`, conversationId: `seed-${i + 1}`, text: text.trim() }));
}

const JUDGE = `You grade a chat assistant's answer against a rubric. You get the test case (today's date, the memory the assistant had, the user's message, what a good answer does, and the trap to avoid), the assistant's answer, and the searches it made.
Score: 2 = does what the good answer describes; 1 = partly; 0 = misses or wrong. trap = true if the answer falls into the trap.
Judge behaviour and reasoning, not exact wording. Live web facts may differ from the rubric's examples; don't penalise correct current facts.
What the assistant actually had and can do:
- MEMORY is exactly what it remembered: one short summary per past conversation. Details absent from MEMORY (product names, links, figures) were not available to it. Saying a detail is missing and asking for it is correct; still expect it to do whatever useful part it could without that detail.
- Forgetting is real: its memory notes are rewritten to remove the item, so telling the user it will be removed from memory is true.
- It cannot message the user later, set reminders or monitor anything.
Reply with only JSON: {"score": 0|1|2, "trap": true|false, "reason": "<one sentence>"}`;

async function judge(c: Case, answer: string, searches: string[]) {
  const res = await llm().chat.completions.create({
    model: models.judge,
    messages: [
      { role: "system", content: JUDGE },
      {
        role: "user",
        content: `TODAY: ${c.today}\nMEMORY: ${c.history}\nUSER: ${c.message}\nGOOD ANSWER: ${c.good_answer}\nTRAP: ${c.trap}\n\nSEARCHES:\n${searches.join("\n") || "(none)"}\n\nASSISTANT ANSWER:\n${answer}`,
      },
    ],
  });
  const j = parseJsonObject(res.choices[0]?.message?.content ?? "");
  return { score: Number(j?.score ?? 0), trap: Boolean(j?.trap), reason: String(j?.reason ?? "judge returned no JSON") };
}

async function runCase(c: Case, runDir: string, useJudge: boolean) {
  const dataDir = path.join(runDir, c.id);
  await rm(dataDir, { recursive: true, force: true });
  await saveNotes(dataDir, seedNotes(c.history));
  try {
    const { now, timeZone } = parseToday(c.today);
    const r = await chat({ dataDir, conversationId: "eval", message: c.message, timeZone, now, writeNote: false });
    const searches = r.toolCalls.map((t) => (t.url ? `read ${t.url} :: ${t.query}` : `search ${t.query}`));
    const grade = useJudge ? await judge(c, r.text, searches) : undefined;
    return { id: c.id, ms: r.ms, usage: r.usage, searches, removedCitations: r.removedCitations, answer: r.text, sources: r.sources.map((s) => s.url), ...grade };
  } catch (err) {
    return { id: c.id, error: (err as Error).message, score: 0, trap: false, reason: "run failed" };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const useJudge = !argv.includes("--no-judge");
  const ci = argv.indexOf("--concurrency");
  const concurrency = ci >= 0 ? Number(argv[ci + 1]) || 4 : 4;
  const ids = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--concurrency");
  const all: Case[] = JSON.parse(await readFile(path.resolve("evals/test-cases.json"), "utf8"));
  const cases = ids.length ? all.filter((c) => ids.includes(c.id)) : all;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.resolve("evals/.runs", stamp);

  const results: Awaited<ReturnType<typeof runCase>>[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
    while (next < cases.length) {
      const c = cases[next++];
      const r = await runCase(c, runDir, useJudge);
      results.push(r);
      const s = "score" in r && r.score !== undefined ? `score ${r.score}${r.trap ? " TRAP" : ""}` : "";
      console.log(`${c.id.padEnd(8)} ${"ms" in r ? `${((r.ms ?? 0) / 1000).toFixed(1)}s`.padStart(6) : "  fail"} ${s}  ${"error" in r ? r.error : (r.reason ?? "")}`);
    }
  }));

  results.sort((a, b) => a.id.localeCompare(b.id));
  const ok = results.filter((r) => !("error" in r));
  const total = (f: (r: any) => number) => ok.reduce((s, r) => s + f(r), 0);
  const summary = {
    cases: results.length,
    failedRuns: results.length - ok.length,
    score: useJudge ? `${results.reduce((s, r) => s + (r.score ?? 0), 0)} / ${results.length * 2}` : "not judged",
    traps: results.filter((r) => r.trap).length,
    avgSeconds: ok.length ? +(total((r) => r.ms) / ok.length / 1000).toFixed(1) : 0,
    avgSearches: ok.length ? +(total((r) => r.searches.length) / ok.length).toFixed(1) : 0,
    tokens: { input: total((r) => r.usage.input), output: total((r) => r.usage.output) },
    model: models.main,
    searchMode: process.env.SEARCH_MODE || "live",
  };
  await mkdir(path.resolve("evals/results"), { recursive: true });
  const out = path.resolve("evals/results", `${stamp}.json`);
  await writeFile(out, JSON.stringify({ summary, results }, null, 2));
  console.log("\n", summary, `\nfull results: ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
