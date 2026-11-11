import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DIR = path.resolve("evals/fixtures");

/**
 * SEARCH_MODE=live|record|replay|cache. Record saves real responses keyed by a hash of the request;
 * replay serves only saved ones; cache serves saved ones and records the rest (for reruns after prompt edits).
 */
export async function withFixture<T>(kind: string, request: unknown, live: () => Promise<T>): Promise<T> {
  const mode = process.env.SEARCH_MODE || "live";
  if (mode === "live") return live();
  const key = createHash("sha256").update(JSON.stringify([kind, request])).digest("hex").slice(0, 24);
  const file = path.join(DIR, `${kind}-${key}.json`);
  if (mode === "replay" || mode === "cache") {
    let text: string | undefined;
    try {
      text = await readFile(file, "utf8");
    } catch {
      if (mode === "replay") throw new Error(`no recorded fixture for this ${kind} request (SEARCH_MODE=replay)`);
    }
    if (text !== undefined) return JSON.parse(text).response as T;
  }
  const response = await live();
  await mkdir(DIR, { recursive: true });
  await writeFile(file, JSON.stringify({ kind, request, response }, null, 1));
  return response;
}
