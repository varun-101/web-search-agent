// Try the tool by hand: npm run search -- "neon postgres pricing" [--url https://neon.com/pricing]
import { runWebSearch, newTurnContext } from "../tool/web_search.ts";
import { now, safeZone } from "../agent/clock.ts";

const args = process.argv.slice(2);
const urlAt = args.indexOf("--url");
const url = urlAt >= 0 ? args.splice(urlAt, 2)[1] : undefined;
const query = args.join(" ").trim();
if (!query) {
  console.error('usage: npm run search -- "query" [--url https://...]');
  process.exit(1);
}
const ctx = newTurnContext(now(), safeZone(Intl.DateTimeFormat().resolvedOptions().timeZone));
const t0 = Date.now();
console.log(await runWebSearch({ query, url }, ctx));
console.error(`\n(${Date.now() - t0} ms, ${ctx.evidence.length} sources)`);
